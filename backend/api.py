"""
FastAPI application — exposes:
  POST /upload          multipart file upload → ingest into pgvector
  POST /search          JSON body → semantic search
  GET  /sources         list all indexed sources
  DELETE /sources       delete a source by path
  POST /chat            RAG chatbot — retrieve + generate
  POST /ingest-meeting  ingest meeting file + push to Time Task Tracker

All routes (except GET /health) require a valid Supabase JWT in the
Authorization: Bearer <token> header. The user_id extracted from the token
is used to scope every DB operation so users only see their own data.
"""
from __future__ import annotations

import datetime as dt
import json
import pathlib
import shutil
import tempfile
import uuid
from datetime import date, datetime
from typing import Annotated

import httpx
import psycopg2
import psycopg2.extras
from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from kb.auth import UserInfo, get_current_user
from kb.chat import ChatMessage, ask as kb_ask
from kb.config import TTT_DATABASE_URL, TTT_PGSSL
from kb.db import init_db
from kb.ingest import ingest
from kb.llm import get_provider
from kb.pusher import push_meeting_entry
from kb.search import delete_source, list_sources
from kb.search import search as kb_search
from ttt_api import router as ttt_router

# ── app setup ────────────────────────────────────────────────────────────────

app = FastAPI(title="KnowledgeBase API", version="0.2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


app.include_router(ttt_router)


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


class FeedbackRequest(BaseModel):
    question: str
    answer: str
    sources: list[dict] = []
    rating: int          # 1 = thumbs up, -1 = thumbs down
    note: str | None = None


class AgenticMeetingRequest(BaseModel):
    filename: str
    project_code: str | None = None
    organizer: str | None = None
    attendees: str | None = None


class AgentStep(BaseModel):
    tool: str
    input: str
    output: str


class AgenticMeetingResponse(BaseModel):
    status: str
    filename: str
    answer: str
    sources: list[ChatSourceOut]
    steps: list[AgentStep]
    ttt_entry_id: str | None = None
    ttt_error: str | None = None


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

@app.get("/health", summary="Health check — no auth required")
def health() -> dict:
    return {"status": "ok"}


@app.get("/me", summary="Return the current user's id and role flags")
def me(current_user: UserInfo = Depends(get_current_user)) -> dict:
    return {"user_id": current_user.user_id, "is_admin": current_user.is_admin}


@app.get("/me/sync-token", summary="Issue a long-lived HS256 JWT for use in local sync scripts")
def me_sync_token(current_user: UserInfo = Depends(get_current_user)) -> dict:
    """
    Returns a JWT that expires in 10 years, signed with SUPABASE_JWT_SECRET.
    Safe to embed in a local sync script — it is scoped to this user only.
    """
    import hmac, hashlib, base64, json as _json  # noqa: E401

    from kb.config import SUPABASE_JWT_SECRET

    if not SUPABASE_JWT_SECRET:
        raise HTTPException(status_code=503, detail="JWT secret not configured.")

    now = int(dt.datetime.now(dt.timezone.utc).timestamp())
    header  = {"alg": "HS256", "typ": "JWT"}
    payload = {
        "sub":  current_user.user_id,
        "role": "authenticated",
        "iat":  now,
        "exp":  now + 10 * 365 * 24 * 3600,  # 10 years
    }

    def _b64(data: dict) -> str:
        return base64.urlsafe_b64encode(
            _json.dumps(data, separators=(",", ":")).encode()
        ).rstrip(b"=").decode()

    header_b64  = _b64(header)
    payload_b64 = _b64(payload)
    signing_input = f"{header_b64}.{payload_b64}".encode()
    sig = hmac.new(SUPABASE_JWT_SECRET.encode(), signing_input, hashlib.sha256).digest()  # type: ignore[attr-defined]
    sig_b64 = base64.urlsafe_b64encode(sig).rstrip(b"=").decode()

    token = f"{header_b64}.{payload_b64}.{sig_b64}"
    return {"token": token, "expires_in_years": 10}


@app.get("/admin/users", summary="List all distinct users (admin only)")
def admin_users(current_user: UserInfo = Depends(get_current_user)) -> list[dict]:
    """
    Returns every distinct user_id that has at least one time entry or document,
    together with a display label. Admin-only.
    """
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Admin access required.")

    sslmode = "require" if TTT_PGSSL else "disable"
    conn = psycopg2.connect(TTT_DATABASE_URL, sslmode=sslmode)
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT au.user_id, COALESCE(su.email, au.user_id) AS email
                FROM (
                    SELECT DISTINCT user_id FROM (
                        SELECT user_id::text AS user_id FROM time_entries
                        UNION
                        SELECT user_id::text AS user_id FROM documents WHERE user_id IS NOT NULL
                    ) AS combined
                ) AS au
                LEFT JOIN auth.users su ON su.id::text = au.user_id
                ORDER BY email
                """
            )
            rows = cur.fetchall()
        return [{"user_id": r[0], "email": r[1]} for r in rows]
    finally:
        conn.close()


@app.post("/upload", summary="Upload and ingest a file")
async def upload_file(
    file: Annotated[UploadFile, File(description="Any supported file type")],
    force: Annotated[bool, Form()] = False,
    project_code: Annotated[str | None, Form()] = None,
    doc_type: Annotated[str | None, Form()] = None,
    current_user: UserInfo = Depends(get_current_user),
) -> dict:
    user_id = current_user.user_id
    suffix = pathlib.Path(file.filename or "upload").suffix or ".bin"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        shutil.copyfileobj(file.file, tmp)
        tmp_path = pathlib.Path(tmp.name)

    extra_meta: dict = {}
    if project_code:
        extra_meta["project_code"] = project_code
    if doc_type:
        extra_meta["doc_type"] = doc_type

    try:
        ingest(tmp_path, force=force, source_name=file.filename, user_id=user_id, extra_meta=extra_meta)
    finally:
        tmp_path.unlink(missing_ok=True)

    return {"status": "ok", "filename": file.filename}


@app.post("/search", response_model=list[SearchResultOut], summary="Semantic search")
def search(
    req: SearchRequest,
    current_user: UserInfo = Depends(get_current_user),
) -> list[SearchResultOut]:
    uid = None if current_user.is_admin else current_user.user_id
    results = kb_search(
        req.query,
        top_k=req.top_k,
        file_type=req.file_type,
        source_filter=req.source_filter,
        user_id=uid,
    )
    return [SearchResultOut(**vars(r)) for r in results]


@app.get("/sources", response_model=list[SourceOut], summary="List indexed sources")
def sources(
    view_as: str | None = Query(None, description="Admin only: scope to this user_id"),
    current_user: UserInfo = Depends(get_current_user),
) -> list[SourceOut]:
    if view_as:
        if not current_user.is_admin:
            raise HTTPException(status_code=403, detail="Admin access required to use view_as.")
        uid = view_as
    else:
        uid = None if current_user.is_admin else current_user.user_id
    return [SourceOut(**s) for s in list_sources(user_id=uid)]


@app.delete("/sources", summary="Delete a source by path")
def delete(
    source: str = Query(..., description="Exact source path to delete"),
    current_user: UserInfo = Depends(get_current_user),
) -> dict:
    # Admins can delete any source; regular users are scoped to their own.
    uid = None if current_user.is_admin else current_user.user_id
    n = delete_source(source, user_id=uid)
    if n == 0:
        raise HTTPException(status_code=404, detail="Source not found")
    return {"status": "ok", "deleted_chunks": n}


@app.post("/chat", response_model=ChatResponseOut, summary="RAG chatbot")
def chat(
    req: ChatRequest,
    current_user: UserInfo = Depends(get_current_user),
) -> ChatResponseOut:
    uid = None if current_user.is_admin else current_user.user_id
    history = [ChatMessage(role=t.role, content=t.content) for t in req.history]
    result = kb_ask(
        req.question,
        history=history,
        top_k=req.top_k,
        source_filter=req.source_filter,
        file_type=req.file_type,
        user_id=uid,
    )
    return ChatResponseOut(
        answer=result.answer,
        sources=[ChatSourceOut(**s) for s in result.sources],
    )


@app.post("/ingest-meeting", response_model=IngestMeetingIngestResponse, summary="Ingest meeting file into the knowledge base")
async def ingest_meeting(
    file: Annotated[UploadFile, File(description="Meeting transcript or notes file")],
    force: Annotated[bool, Form()] = False,
    current_user: UserInfo = Depends(get_current_user),
) -> IngestMeetingIngestResponse:
    user_id = current_user.user_id
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
        ingest(tmp_path, force=force, source_name=file.filename, user_id=user_id)
    finally:
        tmp_path.unlink(missing_ok=True)

    return IngestMeetingIngestResponse(status="ok", filename=file.filename or "upload")


@app.post("/summarize-meeting", response_model=IngestMeetingResponse, summary="Summarize an ingested meeting and push to Time Task Tracker")
def summarize_meeting(
    req: SummarizeMeetingRequest,
    current_user: UserInfo = Depends(get_current_user),
) -> IngestMeetingResponse:
    user_id = current_user.user_id
    """
    Run RAG summarization on an already-ingested meeting file and push the result to TTT.
    Called as a second step after POST /ingest-meeting succeeds.
    """
    summary_question = (
        "In 3-5 sentences summarise this meeting: topics discussed, decisions made, action items."
    )
    try:
        rag_result = kb_ask(
            summary_question,
            source_filter=req.filename,
            top_k=3,
            skip_ttt=True,
            user_id=user_id,
        )
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
        meta_hits = kb_search(req.filename, top_k=1, source_filter=req.filename, user_id=user_id)
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
            user_id=user_id,
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


# ── Feedback ──────────────────────────────────────────────────────────────────

def _feedback_conn():
    if not TTT_DATABASE_URL:
        raise HTTPException(status_code=503, detail="TTT_DATABASE_URL is not configured.")
    sslmode = "require" if TTT_PGSSL else "disable"
    return psycopg2.connect(TTT_DATABASE_URL, sslmode=sslmode)


@app.post("/feedback", summary="Submit thumbs up/down rating for a chat response")
def submit_feedback(
    req: FeedbackRequest,
    current_user: UserInfo = Depends(get_current_user),
) -> dict:
    user_id = current_user.user_id
    if req.rating not in (1, -1):
        raise HTTPException(status_code=422, detail="rating must be 1 or -1")
    conn = _feedback_conn()
    try:
        with conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO chat_feedback (id, user_id, question, answer, sources, rating, note)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        str(uuid.uuid4()),
                        user_id,
                        req.question,
                        req.answer,
                        json.dumps(req.sources),
                        req.rating,
                        req.note,
                    ),
                )
    finally:
        conn.close()
    return {"status": "ok"}


@app.get("/feedback/stats", summary="Feedback statistics and low-rated queries")
def feedback_stats(
    limit: int = Query(20, ge=1, le=100),
    current_user: UserInfo = Depends(get_current_user),
) -> dict:
    user_id = current_user.user_id
    conn = _feedback_conn()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            # Overall counts
            cur.execute(
                "SELECT rating, COUNT(*) AS n FROM chat_feedback WHERE user_id = %s GROUP BY rating",
                (user_id,),
            )
            counts = {r["rating"]: r["n"] for r in cur.fetchall()}

            # Most recent low-rated entries
            cur.execute(
                """
                SELECT id, question, answer, sources, rating, note, created_at
                FROM chat_feedback
                WHERE user_id = %s AND rating = -1
                ORDER BY created_at DESC
                LIMIT %s
                """,
                (user_id, limit),
            )
            low_rated = []
            for row in cur.fetchall():
                low_rated.append({
                    "id":         row["id"],
                    "question":   row["question"],
                    "answer":     row["answer"],
                    "sources":    row["sources"] if isinstance(row["sources"], list) else json.loads(row["sources"] or "[]"),
                    "note":       row["note"],
                    "createdAt":  row["created_at"].isoformat() if isinstance(row["created_at"], datetime) else str(row["created_at"]),
                })

            # High-rated entries for reference
            cur.execute(
                """
                SELECT COUNT(*) AS n FROM chat_feedback
                WHERE user_id = %s AND rating = 1
                """,
                (user_id,),
            )
            thumbs_up = cur.fetchone()["n"]

    finally:
        conn.close()

    total = sum(counts.values())
    return {
        "total":      total,
        "thumbsUp":   counts.get(1, 0),
        "thumbsDown": counts.get(-1, 0),
        "score":      round(counts.get(1, 0) / total * 100, 1) if total else None,
        "lowRated":   low_rated,
    }


# ── Agentic meeting summariser ────────────────────────────────────────────────

@app.post("/agentic-meeting", response_model=AgenticMeetingResponse,
          summary="Multi-step agentic meeting summariser")
def agentic_meeting(
    req: AgenticMeetingRequest,
    current_user: UserInfo = Depends(get_current_user),
) -> AgenticMeetingResponse:
    user_id = current_user.user_id
    """
    Agentic pipeline for meeting summarisation.

    When USE_LANGCHAIN=true: delegates to kb/lc_agent.py — a LangChain
    AgentExecutor where the LLM dynamically decides which tools to call.

    When USE_LANGCHAIN=false (default): runs the fixed 5-step sequence below
    (search_kb → lookup_ttt → classify → synthesise → push_ttt).
    """
    from kb.config import USE_LANGCHAIN
    if USE_LANGCHAIN:
        from kb.lc_agent import run_agentic_meeting
        lc_result = run_agentic_meeting(
            filename=req.filename,
            project_code=req.project_code,
            organizer=req.organizer,
            attendees=req.attendees,
            user_id=user_id,
        )
        return AgenticMeetingResponse(
            status="ok",
            filename=req.filename,
            answer=lc_result["answer"],
            sources=[],
            steps=[AgentStep(**s) for s in lc_result["steps"]],
            ttt_entry_id=lc_result["ttt_entry_id"],
            ttt_error=lc_result["ttt_error"],
        )

    # ── Custom fixed-step pipeline (fallback / default) ───────────────────────
    steps: list[dict] = []
    sources: list[dict] = []

    # ── Tool 1: search_kb ────────────────────────────────────────────────────
    search_query = f"meeting summary topics decisions action items {req.filename}"
    raw_chunks = kb_search(search_query, top_k=5, source_filter=req.filename, user_id=user_id)
    chunk_text = "\n\n".join(
        f"[chunk {r.chunk_index}] {r.content}" for r in raw_chunks
    ) or "No transcript chunks found."
    sources = [{"source": r.source, "score": r.score, "chunk_index": r.chunk_index} for r in raw_chunks]
    steps.append({
        "tool":   "search_kb",
        "input":  f'query="{search_query}" source_filter="{req.filename}"',
        "output": f"Retrieved {len(raw_chunks)} chunks (scores: {', '.join(f'{r.score:.3f}' for r in raw_chunks)})",
    })

    # ── Tool 2: lookup_ttt ───────────────────────────────────────────────────
    from kb.ttt import query_ttt  # local import — avoids circular on startup
    project_hint = req.project_code or req.filename.split(".")[0]
    ttt_context = query_ttt(
        f"recent meetings for project {project_hint}",
        force_meetings=True,
        user_id=user_id,
    )
    steps.append({
        "tool":   "lookup_ttt",
        "input":  f'project="{project_hint}"',
        "output": ttt_context[:300] + "…" if len(ttt_context) > 300 else (ttt_context or "No past entries found."),
    })

    # ── Tool 3: classify ─────────────────────────────────────────────────────
    from ttt_api import _classify  # local import — ttt_api not imported at module level
    classification = _classify(req.filename, req.organizer)
    steps.append({
        "tool":   "classify",
        "input":  f'title="{req.filename}" organizer="{req.organizer}"',
        "output": f"projectCode={classification['projectCode']} taskType={classification['taskType']} billable={classification['billable']} confidence={classification['confidence']}",
    })

    # ── Tool 4: synthesise ───────────────────────────────────────────────────
    context_block = ""
    if ttt_context:
        context_block += f"=== Past TTT entries for this project ===\n{ttt_context}\n\n"
    context_block += f"=== Meeting transcript chunks ===\n{chunk_text}"

    system_prompt = (
        "You are a meeting analyst. Using the transcript chunks and historical TTT context below, "
        "write a concise 3-5 sentence meeting summary covering: topics discussed, decisions made, "
        "action items, and how this meeting relates to past work on the project.\n\n"
        f"Context:\n{context_block}"
    )
    llm = get_provider()
    answer = llm.chat([
        {"role": "system", "content": system_prompt},
        {"role": "user",   "content": f"Summarise the meeting: {req.filename}"},
    ])
    steps.append({
        "tool":   "synthesise",
        "input":  f"chunks={len(raw_chunks)} ttt_context={'yes' if ttt_context else 'no'}",
        "output": answer[:300] + "…" if len(answer) > 300 else answer,
    })

    # ── Tool 5: push_ttt ─────────────────────────────────────────────────────
    ttt_id: str | None = None
    ttt_error: str | None = None

    # Pull header metadata from indexed doc
    file_meta: dict = {}
    try:
        meta_hits = kb_search(req.filename, top_k=1, source_filter=req.filename, user_id=user_id)
        if meta_hits:
            file_meta = meta_hits[0].doc_metadata or {}
    except Exception:
        pass

    entry_date: date | None = None
    raw_date = file_meta.get("meeting_date")
    if raw_date:
        try:
            entry_date = date.fromisoformat(raw_date)
        except ValueError:
            pass

    try:
        pushed = push_meeting_entry(
            filename=file_meta.get("meeting_title") or req.filename,
            summary=answer,
            project_code=req.project_code or classification["projectCode"],
            organizer=req.organizer or file_meta.get("organizer"),
            attendees=req.attendees or file_meta.get("attendees"),
            entry_date=entry_date,
            meeting_time=file_meta.get("meeting_time"),
            duration_minutes=file_meta.get("duration_minutes"),
            billable=file_meta.get("billable", classification["billable"]),
            user_id=user_id,
        )
        ttt_id = pushed.get("id")
        steps.append({
            "tool":   "push_ttt",
            "input":  f'project="{req.project_code or classification["projectCode"]}"',
            "output": f"Entry created: id={ttt_id}",
        })
    except Exception as exc:
        ttt_error = str(exc)
        steps.append({
            "tool":   "push_ttt",
            "input":  f'project="{req.project_code or classification["projectCode"]}"',
            "output": f"Error: {ttt_error}",
        })

    return AgenticMeetingResponse(
        status="ok",
        filename=req.filename,
        answer=answer,
        sources=[ChatSourceOut(**s) for s in sources],
        steps=[AgentStep(**s) for s in steps],
        ttt_entry_id=ttt_id,
        ttt_error=ttt_error,
    )
