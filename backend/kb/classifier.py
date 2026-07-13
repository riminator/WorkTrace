"""
kb/classifier.py — LLM-powered zero-shot meeting classifier.

When USE_LLM_CLASSIFY=true, llm_classify() replaces the regex _classify() in
ttt_api.py. It sends the meeting title (and optional organizer) to the configured
LLM provider and expects a JSON object back with projectCode, taskType, billable,
and confidence.

On any failure (LLM error, JSON parse error, missing keys) it returns None so
the caller can fall back to the regex classifier — no request ever fails.
"""
from __future__ import annotations

import json
import logging

logger = logging.getLogger(__name__)

_SYSTEM_PROMPT = """\
You are a meeting classifier. Given a meeting title (and optional organizer name),
output ONLY a JSON object with these exact keys:

  projectCode  - short uppercase project identifier inferred from the title
                 (e.g. "GENERAL", "SCRUM", "SALES", "DEVOPS"). Use "GENERAL" when unsure.
  taskType     - one of: meeting, standup, planning, review, development, admin, learning, other
  billable     - true if the meeting is likely client-facing or externally billable, false otherwise
  confidence   - float 0.0-1.0 reflecting your certainty

Rules:
- "Daily Standup", "Daily Scrum", "Stand-up" → taskType "standup"
- "Sprint Planning", "Sprint Review", "Retrospective" → taskType "planning" or "review", projectCode "SCRUM"
- "1:1", "One on One", "Skip Level" → taskType "meeting", projectCode "ADMIN"
- Words like "client", "customer", "consulting", "demo" → billable true
- Words like "internal", "team sync", "all hands", "training" → billable false
- No explanation. No markdown fences. No extra text. Just the raw JSON object.
"""

_TASK_TYPES = {"meeting", "standup", "planning", "review", "development", "admin", "learning", "other"}


def llm_classify(title: str, organizer: str | None = None) -> dict | None:
    """
    Classify a meeting title using the configured LLM (zero-shot).

    Returns a dict with keys: projectCode, taskType, billable, confidence.
    Returns None on any error so the caller can fall back to regex rules.
    """
    from kb.llm import get_provider

    organizer_line = f"\nOrganizer: {organizer}" if organizer else ""
    user_message = f"Meeting title: {title}{organizer_line}"

    try:
        llm = get_provider()
        raw = llm.chat([
            {"role": "system", "content": _SYSTEM_PROMPT},
            {"role": "user",   "content": user_message},
        ])
    except Exception as exc:
        logger.warning("llm_classify: LLM call failed (%s), falling back to regex", exc)
        return None

    # Strip accidental markdown fences the model may still emit
    text = raw.strip()
    if text.startswith("```"):
        text = "\n".join(
            line for line in text.splitlines()
            if not line.startswith("```")
        ).strip()

    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        logger.warning("llm_classify: could not parse JSON from LLM response: %r", raw[:200])
        return None

    # Validate and coerce required fields
    project_code = str(data.get("projectCode") or "GENERAL").upper().strip()
    task_type    = str(data.get("taskType") or "meeting").lower().strip()
    if task_type not in _TASK_TYPES:
        task_type = "meeting"
    billable     = bool(data.get("billable", False))
    confidence   = float(data.get("confidence", 0.5))
    confidence   = max(0.0, min(1.0, confidence))

    return {
        "projectCode": project_code,
        "taskType":    task_type,
        "billable":    billable,
        "confidence":  confidence,
    }
