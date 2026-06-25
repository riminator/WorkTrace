"""
Ingestion pipeline: walk a file or directory, extract text, embed with Ollama,
and upsert into pgvector.
"""
from __future__ import annotations

import pathlib
from typing import Generator

from rich.console import Console
from rich.progress import Progress, SpinnerColumn, TextColumn, BarColumn, TaskProgressColumn
from sqlalchemy import select

from kb.db import Document, get_session, init_db
from kb.embedder import embed
from kb.extractors import extract

console = Console()

SUPPORTED_SUFFIXES: set[str] = {
    # documents
    ".pdf", ".docx", ".doc", ".txt", ".md", ".rst", ".csv",
    ".json", ".yaml", ".yml", ".xml", ".html", ".htm",
    ".log", ".toml", ".ini", ".cfg",
    # code
    ".py", ".js", ".ts", ".go", ".java", ".c", ".cpp", ".h", ".rb", ".sh",
    # images
    ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".tiff", ".tif", ".webp",
}


def _iter_files(root: pathlib.Path) -> Generator[pathlib.Path, None, None]:
    """Yield all files under *root* that match supported suffixes."""
    if root.is_file():
        yield root
        return
    for path in sorted(root.rglob("*")):
        if path.is_file() and path.suffix.lower() in SUPPORTED_SUFFIXES:
            yield path


def _already_indexed(session, source: str) -> bool:
    return session.execute(
        select(Document.id).where(Document.source == source).limit(1)
    ).first() is not None


def ingest(path: str | pathlib.Path, *, force: bool = False) -> None:
    """
    Ingest a single file or every supported file inside a directory.

    Args:
        path:  File or directory path.
        force: Re-index files that are already in the database.
    """
    init_db()
    root = pathlib.Path(path).expanduser().resolve()

    files = list(_iter_files(root))
    if not files:
        console.print(f"[yellow]No supported files found under {root}[/yellow]")
        return

    console.print(f"[bold]Found {len(files)} file(s) to process.[/bold]")

    with Progress(
        SpinnerColumn(),
        TextColumn("[progress.description]{task.description}"),
        BarColumn(),
        TaskProgressColumn(),
        console=console,
        transient=False,
    ) as progress:
        task = progress.add_task("Ingesting…", total=len(files))

        for file_path in files:
            progress.update(task, description=f"[cyan]{file_path.name}[/cyan]")
            session = get_session()
            try:
                source_key = str(file_path)

                if not force and _already_indexed(session, source_key):
                    console.print(f"  [dim]skip (already indexed):[/dim] {file_path.name}")
                    progress.advance(task)
                    continue

                file_type, chunks = extract(file_path)

                if not chunks:
                    console.print(f"  [yellow]no text extracted:[/yellow] {file_path.name}")
                    progress.advance(task)
                    continue

                # Remove old records when force re-indexing
                if force:
                    session.query(Document).filter(Document.source == source_key).delete()
                    session.commit()

                for idx, chunk in enumerate(chunks):
                    vector = embed(chunk)
                    doc = Document(
                        source=source_key,
                        file_type=file_type,
                        chunk_index=idx,
                        content=chunk,
                        embedding=vector,
                    )
                    session.add(doc)

                session.commit()
                console.print(
                    f"  [green]✓[/green] {file_path.name} "
                    f"[dim]({file_type}, {len(chunks)} chunk(s))[/dim]"
                )
            except Exception as exc:
                session.rollback()
                console.print(f"  [red]✗ {file_path.name}:[/red] {exc}")
            finally:
                session.close()
                progress.advance(task)

    console.print("[bold green]Done.[/bold green]")
