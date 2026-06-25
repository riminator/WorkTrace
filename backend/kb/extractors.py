"""
File-type extractors.  Each returns a list of text chunks from the source file.
Supports: PDF, TXT/MD/CSV/any plain-text, DOCX, images (OCR via Tesseract),
and a generic binary fallback that extracts printable ASCII characters.
"""
from __future__ import annotations

import pathlib
import re
import textwrap

# ── optional imports ─────────────────────────────────────────────────────────
try:
    import pypdf
except ImportError:
    pypdf = None  # type: ignore

try:
    from docx import Document as DocxDocument
except ImportError:
    DocxDocument = None  # type: ignore

try:
    from PIL import Image
    import pytesseract
except ImportError:
    Image = None  # type: ignore
    pytesseract = None  # type: ignore


CHUNK_SIZE = 800        # target characters per chunk
CHUNK_OVERLAP = 100     # overlap between consecutive chunks


# ── helpers ───────────────────────────────────────────────────────────────────

def _chunk_text(text: str, size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> list[str]:
    """Split *text* into overlapping fixed-size character chunks."""
    text = re.sub(r"\s+", " ", text).strip()
    if not text:
        return []
    chunks: list[str] = []
    start = 0
    while start < len(text):
        end = start + size
        chunks.append(text[start:end])
        start += size - overlap
    return chunks


# ── per-format extractors ─────────────────────────────────────────────────────

def extract_pdf(path: pathlib.Path) -> list[str]:
    if pypdf is None:
        raise RuntimeError("pypdf is not installed — run: pip install pypdf")
    reader = pypdf.PdfReader(str(path))
    pages = [page.extract_text() or "" for page in reader.pages]
    full_text = "\n".join(pages)
    return _chunk_text(full_text)


def extract_txt(path: pathlib.Path) -> list[str]:
    """Plain text, markdown, CSV, JSON, YAML, source code, etc."""
    text = path.read_text(errors="replace")
    return _chunk_text(text)


def extract_docx(path: pathlib.Path) -> list[str]:
    if DocxDocument is None:
        raise RuntimeError("python-docx is not installed — run: pip install python-docx")
    doc = DocxDocument(str(path))
    full_text = "\n".join(p.text for p in doc.paragraphs)
    return _chunk_text(full_text)


def extract_image(path: pathlib.Path) -> list[str]:
    """Run OCR on an image and return text chunks."""
    if Image is None or pytesseract is None:
        raise RuntimeError(
            "Pillow / pytesseract not installed — run: pip install pillow pytesseract"
        )
    img = Image.open(path)
    text = pytesseract.image_to_string(img)
    return _chunk_text(text)


def extract_generic(path: pathlib.Path) -> list[str]:
    """Best-effort extraction for unknown binary files (printable ASCII only)."""
    raw = path.read_bytes()
    printable = re.sub(rb"[^\x20-\x7e\n\t]", b" ", raw).decode("ascii", errors="replace")
    return _chunk_text(printable)


# ── dispatcher ────────────────────────────────────────────────────────────────

_SUFFIX_MAP: dict[str, str] = {
    ".pdf": "pdf",
    ".docx": "docx",
    ".doc": "docx",
    ".png": "image",
    ".jpg": "image",
    ".jpeg": "image",
    ".gif": "image",
    ".bmp": "image",
    ".tiff": "image",
    ".tif": "image",
    ".webp": "image",
}

_TEXT_SUFFIXES = {
    ".txt", ".md", ".csv", ".json", ".yaml", ".yml",
    ".xml", ".html", ".htm", ".rst", ".log",
    ".py", ".js", ".ts", ".go", ".java", ".c", ".cpp",
    ".h", ".rb", ".sh", ".toml", ".ini", ".cfg",
}


def extract(path: pathlib.Path) -> tuple[str, list[str]]:
    """
    Auto-detect file type and extract text chunks.

    Returns:
        (file_type, chunks)  — file_type is a short label string.
    """
    suffix = path.suffix.lower()
    file_type = _SUFFIX_MAP.get(suffix)

    if file_type is None:
        if suffix in _TEXT_SUFFIXES:
            file_type = "text"
        else:
            file_type = "generic"

    dispatch = {
        "pdf": extract_pdf,
        "docx": extract_docx,
        "image": extract_image,
        "text": extract_txt,
        "generic": extract_generic,
    }
    chunks = dispatch[file_type](path)
    return file_type, chunks
