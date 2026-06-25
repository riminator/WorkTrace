"""
CLI entry-point for the knowledge base.

Commands
--------
  kb ingest <path>        — index a file or directory
  kb search <query>       — semantic search
  kb list                 — list all indexed sources
  kb delete <source>      — remove a source from the database
  kb init                 — create the pgvector extension + table
"""
from __future__ import annotations

import click
from rich.console import Console
from rich.table import Table

console = Console()


@click.group()
def cli() -> None:
    """Knowledge Base — powered by pgvector + Ollama."""


@cli.command()
def init() -> None:
    """Create the pgvector extension and documents table."""
    from kb.db import init_db

    init_db()
    console.print("[bold green]Database initialised.[/bold green]")


@cli.command()
@click.argument("path")
@click.option("--force", is_flag=True, default=False, help="Re-index already-indexed files.")
def ingest(path: str, force: bool) -> None:
    """Ingest a FILE or every supported file inside a DIRECTORY."""
    from kb.ingest import ingest as _ingest

    _ingest(path, force=force)


@cli.command()
@click.argument("query")
@click.option("--top-k", "-k", default=5, show_default=True, help="Number of results.")
@click.option("--file-type", "-t", default=None, help="Filter by file type (pdf, image, …).")
@click.option("--source", "-s", default=None, help="Filter by source path substring.")
def search(query: str, top_k: int, file_type: str | None, source: str | None) -> None:
    """Semantic search over the knowledge base."""
    from kb.search import search as _search

    results = _search(query, top_k=top_k, file_type=file_type, source_filter=source)

    if not results:
        console.print("[yellow]No results found.[/yellow]")
        return

    for i, r in enumerate(results, 1):
        console.rule(f"[bold]#{i}  score={r.score}  [{r.file_type}][/bold]")
        console.print(f"[dim]{r.source}  chunk #{r.chunk_index}[/dim]")
        console.print(r.content[:600] + ("…" if len(r.content) > 600 else ""))


@cli.command("list")
def list_sources() -> None:
    """List all indexed source files."""
    from kb.search import list_sources as _list

    sources = _list()
    if not sources:
        console.print("[yellow]No documents indexed yet.[/yellow]")
        return

    table = Table(title="Indexed sources", show_lines=True)
    table.add_column("#", style="dim", width=4)
    table.add_column("Source", overflow="fold")
    table.add_column("Type", width=8)
    table.add_column("Chunks", justify="right", width=7)

    for i, s in enumerate(sources, 1):
        table.add_row(str(i), s["source"], s["file_type"], str(s["chunks"]))

    console.print(table)


@cli.command()
@click.argument("source")
@click.confirmation_option(prompt="Delete all chunks for this source?")
def delete(source: str) -> None:
    """Remove a source and all its chunks from the database."""
    from kb.search import delete_source

    n = delete_source(source)
    console.print(f"[green]Deleted {n} chunk(s) for:[/green] {source}")


if __name__ == "__main__":
    cli()
