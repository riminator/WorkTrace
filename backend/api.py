"""
FastAPI application — exposes:
  POST /upload          multipart file upload → ingest into pgvector
  POST /search          JSON body → semantic search
  GET  /sources         list all indexed sources
  DELETE /sources       delete a source by path
  POST /chat            RAG chatbot — retrieve + generate
  POST /ingest-meeting  ingest meeting file + push to Time Task Tracker
"""
from __future__ import annotations

import pathlib
import shutil
import tempfile
from datetime import date
from typing import Annotated

import httpx
from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from kb.chat import ChatMessage, ask as kb_ask
from kb.db import init_db
from kb.ingest import ingest
from kb.pusher import push_meeting_entry
from kb.search import delete_source, list_sources
from kb.search import search as kb_search

# ── app setup ────────────────────────────────────────────────────────────────

app = FastAPI(title="KnowledgeBase API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup() -> None:
    init_db()


# ── schemas ───────────────────────────────────────────────────────────────────

class SearchRequest(BaseModel):
    query: str
    top_k: int = 5
    file_type: str | None = None
    source_filter: str | None = None


class SearchResultOut(BaseModel):
    id: int
    source: str
    file_type: str
    chunk_index: int
    content: str
    snippet: str
    score: float


class SourceOut(BaseModel):
    source: str
    file_type: str
    chunks: int


class ChatTurn(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    question: str
    history: list[ChatTurn] = []
    top_k: int = 5
    source_filter: str | None = None
    file_type: str | None = None


class ChatSourceOut(BaseModel):
    source: str
    score: float
    chunk_index: int


class ChatResponseOut(BaseModel):
    answer: str
    sources: list[ChatSourceOut]


class IngestMeetingResponse(BaseModel):
    status: str
    filename: str
    answer: str
    sources: list[ChatSourceOut]
    ttt_entry_id: str | None = None
    ttt_error: str | None = None


class IngestMeetingIngestResponse(BaseModel):
    status: str
    filename: str


class SummarizeMeetingRequest(BaseModel):
    filename: str
    project_code: str | None = None
    organizer: str | None = None
    attendees: str | None = None


# ── routes ───────────────────────────────────────────────────────────────────

@app.post("/upload", summary="Upload and ingest a file")
async def upload_file(
    file: Annotated[UploadFile, File(description="Any supported file type")],
    force: Annotated[bool, Form()] = False,
) -> dict:
    suffix = pathlib.Path(file.filename or "upload").suffix or ".bin"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        shutil.copyfileobj(file.file, tmp)
        tmp_path = pathlib.Path(tmp.name)

    try:
        ingest(tmp_path, force=force, source_name=file.filename)
    finally:
        tmp_path.unlink(missing_ok=True)

    return {"status": "ok", "filename": file.filename}


@app.post("/search", response_model=list[SearchResultOut], summary="Semantic search")
def search(req: SearchRequest) -> list[SearchResultOut]:
    results = kb_search(
        req.query,
        top_k=req.top_k,
        file_type=req.file_type,
        source_filter=req.source_filter,
    )
    return [SearchResultOut(**vars(r)) for r in results]


@app.get("/sources", response_model=list[SourceOut], summary="List indexed sources")
def sources() -> list[SourceOut]:
    return [SourceOut(**s) for s in list_sources()]


@app.delete("/sources", summary="Delete a source by path")
def delete(source: str = Query(..., description="Exact source path to delete")) -> dict:
    n = delete_source(source)
    if n == 0:
        raise HTTPException(status_code=404, detail="Source not found")
    return {"status": "ok", "deleted_chunks": n}


@app.post("/chat", response_model=ChatResponseOut, summary="RAG chatbot")
def chat(req: ChatRequest) -> ChatResponseOut:
    history = [ChatMessage(role=t.role, content=t.content) for t in req.history]
    result = kb_ask(
        req.question,
        history=history,
        top_k=req.top_k,
        source_filter=req.source_filter,
        file_type=req.file_type,
    )
    return ChatResponseOut(
        answer=result.answer,
        sources=[ChatSourceOut(**s) for s in result.sources],
    )


@app.post("/ingest-meeting", response_model=IngestMeetingIngestResponse, summary="Ingest meeting file into the knowledge base")
async def ingest_meeting(
    file: Annotated[UploadFile, File(description="Meeting transcript or notes file")],
    force: Annotated[bool, Form()] = False,
) -> IngestMeetingIngestResponse:
    """
    Ingest the uploaded file into pgvector (same as /upload).
    Call POST /summarize-meeting next to generate the summary and push to TTT.
    Split into two requests so each stays well under the 30-second server timeout.
    """
    suffix = pathlib.Path(file.filename or "upload").suffix or ".bin"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        shutil.copyfileobj(file.file, tmp)
        tmp_path = pathlib.Path(tmp.name)

    try:
        ingest(tmp_path, force=force, source_name=file.filename)
    finally:
        tmp_path.unlink(missing_ok=True)

    return IngestMeetingIngestResponse(status="ok", filename=file.filename or "upload")


@app.post("/summarize-meeting", response_model=IngestMeetingResponse, summary="Summarize an ingested meeting and push to Time Task Tracker")
def summarize_meeting(req: SummarizeMeetingRequest) -> IngestMeetingResponse:
    """
    Run RAG summarization on an already-ingested meeting file and push the result to TTT.
    Called as a second step after POST /ingest-meeting succeeds.
    """
    summary_question = (
        "In 3-5 sentences summarise this meeting: topics discussed, decisions made, action items."
    )
    try:
        rag_result = kb_ask(summary_question, source_filter=req.filename, top_k=3, skip_ttt=True)
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 429:
            raise HTTPException(
                status_code=503,
                detail="The AI provider is rate-limited right now. Wait 30–60 seconds and try again.",
            )
        raise

    # Pull all header metadata from the indexed doc_metadata.
    # Prefer values from the file header; fall back to what was passed in the request.
    file_meta: dict = {}
    try:
        meta_hits = kb_search(req.filename, top_k=1, source_filter=req.filename)
        if meta_hits:
            file_meta = meta_hits[0].doc_metadata or {}
    except Exception:
        pass  # non-fatal

    entry_date: date | None = None
    raw_date = file_meta.get("meeting_date")
    if raw_date:
        try:
            entry_date = date.fromisoformat(raw_date)
        except ValueError:
            pass

    duration_minutes: float | None = file_meta.get("duration_minutes")
    project_code = req.project_code or file_meta.get("project_code") or None
    organizer    = req.organizer    or file_meta.get("organizer")    or None
    attendees    = req.attendees    or file_meta.get("attendees")    or None
    meeting_title = file_meta.get("meeting_title") or req.filename
    meeting_time  = file_meta.get("meeting_time") or None
    billable      = file_meta.get("billable", False)

    ttt_id: str | None = None
    ttt_error: str | None = None
    try:
        pushed = push_meeting_entry(
            filename=meeting_title,
            summary=rag_result.answer,
            project_code=project_code,
            organizer=organizer,
            attendees=attendees,
            entry_date=entry_date,
            meeting_time=meeting_time,
            duration_minutes=duration_minutes,
            billable=billable,
        )
        ttt_id = pushed.get("id")
    except Exception as exc:
        ttt_error = str(exc)

    return IngestMeetingResponse(
        status="ok",
        filename=req.filename,
        answer=rag_result.answer,
        sources=[ChatSourceOut(**s) for s in rag_result.sources],
        ttt_entry_id=ttt_id,
        ttt_error=ttt_error,
    )
