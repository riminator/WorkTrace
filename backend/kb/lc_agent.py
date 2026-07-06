"""
lc_agent.py — LangChain AgentExecutor for agentic meeting summarisation.

This is the LangChain equivalent of the fixed 5-step pipeline in
api.py /agentic-meeting.  Instead of a hard-coded sequence the LLM decides
which tools to call and in what order.

Activated when USE_LANGCHAIN=true.
The original fixed-step implementation in api.py is preserved as a fallback.

Tools exposed to the agent:
  search_kb    — vector search over the indexed transcript
  lookup_ttt   — fetch past TTT entries for a project
  push_to_ttt  — insert a completed entry into the Time Task Tracker

The agent is instructed to: search the KB → look up history → synthesise a
3-5 sentence summary → push the entry to the TTT.
"""
from __future__ import annotations

import threading
from typing import Any

from langchain.agents import AgentExecutor, create_tool_calling_agent
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain_core.tools import tool

from kb.lc_llm import get_lc_llm
from kb.pusher import push_meeting_entry
from kb.search import search as kb_search
from kb.ttt import query_ttt

# ── thread-local request context ─────────────────────────────────────────────
# Tools need access to user_id and filename from the current request.
# We use a threading.local() to avoid global state across concurrent requests.

_ctx = threading.local()


# ── tool definitions ──────────────────────────────────────────────────────────

@tool
def search_kb(query: str) -> str:
    """Search the knowledge base for relevant chunks from the meeting transcript."""
    user_id = getattr(_ctx, "user_id", None)
    filename = getattr(_ctx, "filename", None)
    docs = kb_search(query, top_k=5, source_filter=filename, user_id=user_id)
    if not docs:
        return "No relevant chunks found."
    return "\n\n".join(
        f"[chunk {d.chunk_index}, score {d.score:.3f}]:\n{d.content}"
        for d in docs
    )


@tool
def lookup_ttt(project: str) -> str:
    """Look up past Time Task Tracker entries for a given project code."""
    user_id = getattr(_ctx, "user_id", None)
    result = query_ttt(
        f"recent meetings for project {project}",
        force_meetings=True,
        user_id=user_id,
    )
    return result or "No past entries found for this project."


@tool
def push_to_ttt(
    title: str,
    summary: str,
    project_code: str,
    duration_minutes: int = 60,
) -> str:
    """
    Push a completed meeting summary into the Time Task Tracker.

    Args:
        title:            Meeting title.
        summary:          3-5 sentence summary of the meeting.
        project_code:     Project code (e.g. Honda, DIRECTTV).
        duration_minutes: Estimated duration in minutes (default 60).
    """
    user_id = getattr(_ctx, "user_id", None)
    organizer = getattr(_ctx, "organizer", None)
    attendees = getattr(_ctx, "attendees", None)
    try:
        entry = push_meeting_entry(
            filename=title,
            summary=summary,
            project_code=project_code,
            duration_minutes=float(duration_minutes),
            organizer=organizer,
            attendees=attendees,
            user_id=user_id,
        )
        return f"TTT entry created: id={entry.get('id', 'unknown')}"
    except Exception as exc:
        return f"TTT push failed: {exc}"


# ── agent assembly ────────────────────────────────────────────────────────────

_TOOLS = [search_kb, lookup_ttt, push_to_ttt]

_SYSTEM = (
    "You are a meeting analyst with access to three tools:\n"
    "  - search_kb: search the knowledge base for transcript content\n"
    "  - lookup_ttt: look up past work entries for a project\n"
    "  - push_to_ttt: save a completed summary to the Time Task Tracker\n\n"
    "Your task:\n"
    "  1. Call search_kb to retrieve the meeting transcript.\n"
    "  2. Call lookup_ttt to get historical context for the project.\n"
    "  3. Write a 3-5 sentence summary covering topics discussed, decisions made, "
    "action items, and how this relates to past work.\n"
    "  4. Call push_to_ttt with the title, summary, project code, and duration.\n"
    "  5. Return the final summary as your answer."
)

_PROMPT = ChatPromptTemplate.from_messages([
    ("system", _SYSTEM),
    ("human", "{input}"),
    MessagesPlaceholder("agent_scratchpad"),
])


def run_agentic_meeting(
    *,
    filename: str,
    project_code: str | None,
    organizer: str | None,
    attendees: str | None,
    user_id: str | None,
) -> dict[str, Any]:
    """
    Run the LangChain agent for meeting summarisation.

    Returns a dict with keys:
        answer  — final LLM answer string
        steps   — list of {tool, input, output} dicts (agent trace)
        ttt_entry_id — id from push_to_ttt, or None
        ttt_error    — error string if push failed, or None
    """
    # Set thread-local context so tools can access request-scoped values
    _ctx.user_id = user_id
    _ctx.filename = filename
    _ctx.organizer = organizer
    _ctx.attendees = attendees

    llm = get_lc_llm()
    agent = create_tool_calling_agent(llm, _TOOLS, _PROMPT)
    executor = AgentExecutor(
        agent=agent,
        tools=_TOOLS,
        verbose=False,
        return_intermediate_steps=True,
        max_iterations=8,
        handle_parsing_errors=True,
    )

    result = executor.invoke({
        "input": (
            f"Summarise the meeting: {filename}"
            + (f" (project: {project_code})" if project_code else "")
        )
    })

    # Parse intermediate steps into WorkTrace's AgentStep format
    steps = []
    ttt_entry_id: str | None = None
    ttt_error: str | None = None

    for action, observation in result.get("intermediate_steps", []):
        tool_name = getattr(action, "tool", str(action))
        tool_input = str(getattr(action, "tool_input", ""))
        tool_output = str(observation)

        steps.append({
            "tool":   tool_name,
            "input":  tool_input[:500],
            "output": tool_output[:500],
        })

        # Extract TTT entry id / error from push_to_ttt output
        if tool_name == "push_to_ttt":
            if "id=" in tool_output:
                ttt_entry_id = tool_output.split("id=")[-1].strip()
            elif "failed" in tool_output.lower():
                ttt_error = tool_output

    return {
        "answer":       result.get("output", ""),
        "steps":        steps,
        "ttt_entry_id": ttt_entry_id,
        "ttt_error":    ttt_error,
    }
