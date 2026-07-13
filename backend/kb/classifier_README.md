# ML-powered meeting classifier

## What it does

`kb/classifier.py` replaces the regex rules in `_classify()` with a **zero-shot LLM
call** that assigns three fields to every time entry:

| Field | Possible values | How it's decided |
|---|---|---|
| `projectCode` | any project code string | inferred from title keywords, attendees, organizer |
| `taskType` | `meeting` · `standup` · `planning` · `review` · `development` · `admin` · `learning` · `other` | inferred from meeting title semantics |
| `billable` | `true` / `false` | inferred from title/context (client-facing vs internal) |
| `confidence` | 0.0 – 1.0 | self-reported by the model; falls back to 0.5 on parse error |

The response is always structured JSON so no regex post-processing is needed.

---

## How it works

```
title + optional organizer
        │
        ▼
  kb/classifier.py
  llm_classify(title, organizer)
        │
        ├─ USE_LLM_CLASSIFY=false  →  original regex _classify()  (default, zero latency)
        │
        └─ USE_LLM_CLASSIFY=true   →  get_provider().chat(messages)
                                            │
                                            ▼
                                    JSON parse → {"projectCode", "taskType",
                                                  "billable", "confidence"}
                                            │
                                    on any parse error → fall back to regex _classify()
```

1. A structured system prompt instructs the configured LLM to respond **only** with a
   JSON object (no prose, no markdown fences).
2. `llm_classify()` calls `kb.llm.get_provider()` — whichever LLM is active
   (`watsonx`, `openai`, `ollama`) without any new dependencies.
3. The JSON is parsed with `json.loads`. If the model returns anything unparseable the
   function **silently falls back to the regex classifier** so no request ever fails.
4. The result is a drop-in replacement for the existing `_classify()` return shape,
   so all callers (`POST /ttt/classify`, agentic meeting pipeline, `POST /ttt/import/*`)
   are unaffected.

---

## Enabling it

Set one environment variable — everything else picks it up automatically:

```bash
# In openshift/deploy.env (then run ./openshift/deploy.sh to re-apply secrets)
USE_LLM_CLASSIFY=true
```

Or test locally:

```bash
export USE_LLM_CLASSIFY=true
uvicorn api:app --reload
```

To revert to the fast regex classifier:

```bash
USE_LLM_CLASSIFY=false   # or just unset it — false is the default
```

---

## Why zero-shot instead of a trained model

- **No labelling work** — the LLM already understands meeting vocabulary.
- **No model file to ship** — stays inside the existing container image.
- **No new Python dependencies** — reuses `kb/llm.py` which is already imported.
- **Graceful degradation** — parse errors fall back to the regex rules, never HTTP 500.
- **Easy to improve** — add a `few_shot_examples` list to `classifier.py` to feed
  representative title→label pairs to the prompt when you want higher accuracy.

---

## Prompt used

```
You are a meeting classifier. Given a meeting title (and optional organizer),
output ONLY a JSON object with these exact keys:
  projectCode  – short uppercase project identifier (e.g. "GENERAL", "SCRUM", "SALES")
  taskType     – one of: meeting, standup, planning, review, development, admin, learning, other
  billable     – true if the meeting is likely client-facing or billable, false otherwise
  confidence   – float 0.0–1.0 reflecting your certainty

No explanation. No markdown fences. Just the JSON object.
```

---

## Files changed

| File | Change |
|---|---|
| `backend/kb/classifier.py` | **New** — `llm_classify()` function |
| `backend/kb/config.py` | +1 line — `USE_LLM_CLASSIFY` env var |
| `backend/ttt_api.py` | `_classify()` delegates to `llm_classify()` when flag is on |
