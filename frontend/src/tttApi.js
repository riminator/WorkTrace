const BASE = import.meta.env.VITE_API_URL || "http://localhost:8000";

function authHeaders(token, extra = {}) {
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extra,
  };
}

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

export async function getEntries({ startDate, endDate, projectCode, viewAs } = {}, token) {
  const params = new URLSearchParams();
  if (startDate)   params.append("start_date",   startDate);
  if (endDate)     params.append("end_date",     endDate);
  if (projectCode) params.append("project_code", projectCode);
  if (viewAs)      params.append("view_as",      viewAs);
  const res = await fetch(`${BASE}/ttt/entries?${params}`, {
    headers: authHeaders(token),
  });
  if (!res.ok) await throwApiError(res);
  return res.json();
}

export async function getEntry(id, token) {
  const res = await fetch(`${BASE}/ttt/entries/${id}`, {
    headers: authHeaders(token),
  });
  if (!res.ok) await throwApiError(res);
  return res.json();
}

export async function createEntry(entry, token) {
  const res = await fetch(`${BASE}/ttt/entries`, {
    method: "POST",
    headers: authHeaders(token, { "Content-Type": "application/json" }),
    body: JSON.stringify(entry),
  });
  if (!res.ok) await throwApiError(res);
  return res.json();
}

export async function updateEntry(id, updates, token) {
  const res = await fetch(`${BASE}/ttt/entries/${id}`, {
    method: "PUT",
    headers: authHeaders(token, { "Content-Type": "application/json" }),
    body: JSON.stringify(updates),
  });
  if (!res.ok) await throwApiError(res);
  return res.json();
}

export async function deleteEntry(id, token) {
  const res = await fetch(`${BASE}/ttt/entries/${id}`, {
    method: "DELETE",
    headers: authHeaders(token),
  });
  if (!res.ok) await throwApiError(res);
}

export async function bulkDeleteEntries(ids, token) {
  const res = await fetch(`${BASE}/ttt/entries/bulk-delete`, {
    method: "POST",
    headers: authHeaders(token, { "Content-Type": "application/json" }),
    body: JSON.stringify({ ids }),
  });
  if (!res.ok) await throwApiError(res);
  return res.json();
}

export async function getSummary({ startDate, endDate, viewAs } = {}, token) {
  const params = new URLSearchParams();
  if (startDate) params.append("start_date", startDate);
  if (endDate)   params.append("end_date",   endDate);
  if (viewAs)    params.append("view_as",    viewAs);
  const res = await fetch(`${BASE}/ttt/summary?${params}`, {
    headers: authHeaders(token),
  });
  if (!res.ok) await throwApiError(res);
  return res.json();
}

export async function getProjects(token, viewAs) {
  const params = new URLSearchParams();
  if (viewAs) params.append("view_as", viewAs);
  const res = await fetch(`${BASE}/ttt/projects?${params}`, {
    headers: authHeaders(token),
  });
  if (!res.ok) await throwApiError(res);
  return res.json();
}

export async function classifyMeeting(title, organizer, token) {
  const res = await fetch(`${BASE}/ttt/classify`, {
    method: "POST",
    headers: authHeaders(token, { "Content-Type": "application/json" }),
    body: JSON.stringify({ title, organizer }),
  });
  if (!res.ok) await throwApiError(res);
  return res.json();
}

export async function importCSV(file, token) {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${BASE}/ttt/import/csv`, {
    method: "POST",
    headers: authHeaders(token),
    body: form,
  });
  if (!res.ok) await throwApiError(res);
  return res.json();
}

export async function importICS(file, token) {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${BASE}/ttt/import/ics`, {
    method: "POST",
    headers: authHeaders(token),
    body: form,
  });
  if (!res.ok) await throwApiError(res);
  return res.json();
}

export async function exportCSV(token, startDate, endDate) {
  const params = new URLSearchParams();
  if (startDate) params.append("start_date", startDate);
  if (endDate)   params.append("end_date",   endDate);
  const res = await fetch(`${BASE}/ttt/export/csv?${params}`, {
    headers: authHeaders(token),
  });
  if (!res.ok) await throwApiError(res);
  return res.blob();
}
