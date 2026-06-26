"""
File-type extractors.  Each returns a list of text chunks from the source file.
Supports: PDF, TXT/MD/CSV/any plain-text, DOCX, images (OCR via Tesseract),
and a generic binary fallback that extracts printable ASCII characters.
"""
from __future__ import annotations

import pathlib
import re
import textwrap
from datetime import date

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

# ── meeting header extraction ────────────────────────────────────────────────

# Patterns for the structured header block at the top of meeting transcripts.
_HEADER_FIELDS = {
    "meeting_date":  re.compile(r"^Date:\s*(.+)", re.IGNORECASE | re.MULTILINE),
    "meeting_title": re.compile(r"^Meeting Title:\s*(.+)", re.IGNORECASE | re.MULTILINE),
    "organizer":     re.compile(r"^Organizer:\s*(.+)", re.IGNORECASE | re.MULTILINE),
    "attendees":     re.compile(r"^Attendees:\s*(.+)", re.IGNORECASE | re.MULTILINE),
    "platform":      re.compile(r"^Platform:\s*(.+)", re.IGNORECASE | re.MULTILINE),
}


def extract_meeting_metadata(text: str) -> dict:
    """
    Parse structured key/value header fields from meeting transcript text.
    Returns a dict with any fields found; all values are stripped strings.
    ``meeting_date`` is normalised to an ISO-8601 string (YYYY-MM-DD) when
    possible so it can be compared chronologically.
    """
    meta: dict = {}
    for key, pattern in _HEADER_FIELDS.items():
        m = pattern.search(text)
        if m:
            meta[key] = m.group(1).strip()

    # Normalise the date to ISO format for easy comparison
    if "meeting_date" in meta:
        raw_date = meta["meeting_date"]
        for fmt in ("%Y-%m-%d", "%B %d, %Y", "%b %d, %Y", "%m/%d/%Y", "%d/%m/%Y"):
            try:
                meta["meeting_date"] = date.fromisoformat(
                    __import__("datetime").datetime.strptime(raw_date, fmt).strftime("%Y-%m-%d")
                ).isoformat()
                break
            except ValueError:
                continue

    return meta


def _build_header_prefix(meta: dict) -> str:
    """Build a short human-readable prefix to prepend to every chunk."""
    parts = []
    if meta.get("meeting_title"):
        parts.append(f"Meeting: {meta['meeting_title']}")
    if meta.get("meeting_date"):
        parts.append(f"Date: {meta['meeting_date']}")
    if meta.get("organizer"):
        parts.append(f"Organizer: {meta['organizer']}")
    if not parts:
        return ""
    return "[" + " | ".join(parts) + "]\n"


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


def extract_txt(path: pathlib.Path) -> tuple[list[str], dict]:
    """
    Plain text, markdown, CSV, JSON, YAML, source code, etc.

    Returns:
        (chunks, metadata) — metadata is populated when the file looks like a
        meeting transcript (has a 'Date:' / 'Meeting Title:' header block).
    """
    raw = path.read_text(errors="replace")
    meta = extract_meeting_metadata(raw)
    prefix = _build_header_prefix(meta)
    chunks = _chunk_text(raw)
    if prefix:
        chunks = [prefix + c for c in chunks]
    return chunks, meta


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


def extract(path: pathlib.Path) -> tuple[str, list[str], dict]:
    """
    Auto-detect file type and extract text chunks.

    Returns:
        (file_type, chunks, metadata)
        - file_type is a short label string.
        - metadata is a dict with any structured fields found (e.g. meeting_date).
    """
    suffix = path.suffix.lower()
    file_type = _SUFFIX_MAP.get(suffix)

    if file_type is None:
        if suffix in _TEXT_SUFFIXES:
            file_type = "text"
        else:
            file_type = "generic"

    if file_type == "text":
        chunks, meta = extract_txt(path)
    else:
        dispatch = {
            "pdf": extract_pdf,
            "docx": extract_docx,
            "image": extract_image,
            "generic": extract_generic,
        }
        chunks = dispatch[file_type](path)
        meta = {}

    return file_type, chunks, meta
