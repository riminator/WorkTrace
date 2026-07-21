const BASE = import.meta.env.VITE_API_URL || "http://localhost:8000";

// ── auth header helper ────────────────────────────────────────────────────────

function authHeaders(token, extra = {}) {
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extra,
  };
}

// ── error parsing ─────────────────────────────────────────────────────────────

async function throwApiError(res) {
  const text = await res.text();
  let msg;
  try {
    const body = JSON.parse(text);
    msg = body?.detail || JSON.stringify(body);
  } catch {
    msg = text;
  }
  throw new Error(msg);
}

// ── API calls ─────────────────────────────────────────────────────────────────

export async function searchDocs({ query, top_k = 5, file_type, source_filter }, token) {
  const res = await fetch(`${BASE}/search`, {
    method: "POST",
    headers: authHeaders(token, { "Content-Type": "application/json" }),
    body: JSON.stringify({ query, top_k, file_type: file_type || null, source_filter: source_filter || null }),
  });
  if (!res.ok) await throwApiError(res);
  return res.json();
}

export async function uploadFile(file, force = false, token, { projectCode, docType } = {}) {
  const form = new FormData();
  form.append("file", file);
  form.append("force", force);
  if (projectCode) form.append("project_code", projectCode);
  if (docType)     form.append("doc_type", docType);
  const res = await fetch(`${BASE}/upload`, {
    method: "POST",
    headers: authHeaders(token),
    body: form,
  });
  if (!res.ok) await throwApiError(res);
  return res.json();
}

export async function getSources(token, viewAs) {
  const params = new URLSearchParams();
  if (viewAs) params.append("view_as", viewAs);
  const res = await fetch(`${BASE}/sources?${params}`, {
    headers: authHeaders(token),
  });
  if (!res.ok) await throwApiError(res);
  return res.json();
}

export async function deleteSource(source, token) {
  const res = await fetch(`${BASE}/sources?source=${encodeURIComponent(source)}`, {
    method: "DELETE",
    headers: authHeaders(token),
  });
  if (!res.ok) await throwApiError(res);
  return res.json();
}

export async function ingestMeeting({ file, force = false }, token) {
  const form = new FormData();
  form.append("file", file);
  form.append("force", force);
  const res = await fetch(`${BASE}/ingest-meeting`, {
    method: "POST",
    headers: authHeaders(token),
    body: form,
  });
  if (!res.ok) await throwApiError(res);
  return res.json();
}

export async function summarizeMeeting({ filename, project_code, organizer, attendees }, token) {
  const res = await fetch(`${BASE}/summarize-meeting`, {
    method: "POST",
    headers: authHeaders(token, { "Content-Type": "application/json" }),
    body: JSON.stringify({
      filename,
      project_code: project_code || null,
      organizer:    organizer   || null,
      attendees:    attendees   || null,
    }),
  });
  if (!res.ok) await throwApiError(res);
  return res.json();
}

export async function chatWithKB({ question, history = [], top_k = 5, source_filter, file_type }, token, signal) {
  const res = await fetch(`${BASE}/chat`, {
    method: "POST",
    headers: authHeaders(token, { "Content-Type": "application/json" }),
    body: JSON.stringify({ question, history, top_k, source_filter: source_filter || null, file_type: file_type || null }),
    signal,
  });
  if (!res.ok) await throwApiError(res);
  return res.json();
}

export async function submitFeedback({ question, answer, sources, rating, note }, token) {
  const res = await fetch(`${BASE}/feedback`, {
    method: "POST",
    headers: authHeaders(token, { "Content-Type": "application/json" }),
    body: JSON.stringify({ question, answer, sources, rating, note: note || null }),
  });
  if (!res.ok) await throwApiError(res);
  return res.json();
}

export async function getFeedbackStats(token, limit = 20) {
  const res = await fetch(`${BASE}/feedback/stats?limit=${limit}`, {
    headers: authHeaders(token),
  });
  if (!res.ok) await throwApiError(res);
  return res.json();
}

export async function agenticMeeting({ filename, project_code, organizer, attendees }, token) {
  const res = await fetch(`${BASE}/agentic-meeting`, {
    method: "POST",
    headers: authHeaders(token, { "Content-Type": "application/json" }),
    body: JSON.stringify({
      filename,
      project_code: project_code || null,
      organizer:    organizer    || null,
      attendees:    attendees    || null,
    }),
  });
  if (!res.ok) await throwApiError(res);
  return res.json();
}
