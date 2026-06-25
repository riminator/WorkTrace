const BASE = import.meta.env.VITE_API_URL || "http://localhost:8000";

export async function searchDocs({ query, top_k = 5, file_type, source_filter }) {
  const res = await fetch(`${BASE}/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, top_k, file_type: file_type || null, source_filter: source_filter || null }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function uploadFile(file, force = false) {
  const form = new FormData();
  form.append("file", file);
  form.append("force", force);
  const res = await fetch(`${BASE}/upload`, { method: "POST", body: form });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getSources() {
  const res = await fetch(`${BASE}/sources`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function deleteSource(source) {
  const res = await fetch(`${BASE}/sources?source=${encodeURIComponent(source)}`, { method: "DELETE" });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function ingestMeeting({ file, force = false, project_code, organizer, attendees }) {
  const form = new FormData();
  form.append("file", file);
  form.append("force", force);
  if (project_code) form.append("project_code", project_code);
  if (organizer)    form.append("organizer", organizer);
  if (attendees)    form.append("attendees", attendees);
  const res = await fetch(`${BASE}/ingest-meeting`, { method: "POST", body: form });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function chatWithKB({ question, history = [], top_k = 5, source_filter, file_type }) {
  const res = await fetch(`${BASE}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, history, top_k, source_filter: source_filter || null, file_type: file_type || null }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
