# Bob Integration — MCP Server & Skill

This document describes the Bob (AI assistant) integrations added to WorkTrace:
a local MCP server that gives Bob live access to WorkTrace data, and a skill that
gives Bob permanent context about the app's architecture and deploy workflow.

---

## What was added

| Artefact | Location | Purpose |
|---|---|---|
| **MCP server source** | `~/.bob/mcp-servers/worktrace-mcp/` | Node.js/TypeScript stdio server — exposes WorkTrace REST API as Bob tools |
| **MCP registration** | `~/.bob/settings/mcp.json` — `"worktrace"` entry | Tells Bob how to spawn the server |
| **worktrace skill** | `~/.bob/skills/worktrace/SKILL.md` | Permanent context: stack, URLs, env vars, deploy workflow, gotchas |
| **worktrace-deploy skill** | `.bob/skills/worktrace-deploy/SKILL.md` | Guided deploy wizard for fresh/renewal clusters + full debug decision tree |

---

## MCP Server

### What it is

A local [Model Context Protocol](https://modelcontextprotocol.io) server that runs as a
child process of Bob. It calls the WorkTrace REST API on behalf of Bob so Bob can answer
questions about your actual live data — time entries, project summaries, indexed documents —
without you having to copy-paste anything.

### Tools exposed

| Tool | Endpoint called | Example use |
|---|---|---|
| `list_time_entries` | `GET /api/ttt/entries` | "Show me all entries for PROJ-001 this month" |
| `get_time_summary` | `GET /api/ttt/summary` | "How many hours did I log last week?" |
| `list_projects` | `GET /api/ttt/projects` | "What project codes do I have?" |
| `create_time_entry` | `POST /api/ttt/entries` | "Log 2 hours on Honda today, task type review" |
| `update_time_entry` | `PUT /api/ttt/entries/{id}` | "Mark that entry as billable" |
| `delete_time_entry` | `DELETE /api/ttt/entries/{id}` | "Delete the duplicate entry" |
| `search_knowledge_base` | `POST /api/search` | "Find everything I've indexed about onboarding" |
| `list_sources` | `GET /api/sources` | "What documents are in my knowledge base?" |
| `chat_with_kb` | `POST /api/chat` | "Summarise what was decided in the Honda kickoff meeting" |

### Source files

```
~/.bob/mcp-servers/worktrace-mcp/
├── src/index.ts        Full server implementation (~310 lines)
├── build/index.js      Compiled output (run by Bob)
├── package.json
└── tsconfig.json
```

### Authentication

The server authenticates to WorkTrace using a long-lived HS256 JWT token (10-year expiry)
signed with the `SUPABASE_JWT_SECRET`. It is scoped to user ID
`b0a962b6-9803-4c49-b4c1-536012e0f2f1` (the primary WorkTrace account).

The token and the cluster URL are stored in the `"worktrace"` entry in
`~/.bob/settings/mcp.json`. **If the cluster URL changes** (TechZone cluster expiry), update
`WORKTRACE_URL` in that file. **If the JWT secret rotates**, regenerate the token — see the
worktrace skill for the one-liner.

### Rebuilding after changes

```bash
cd ~/.bob/mcp-servers/worktrace-mcp
npm run build
# Bob hot-reloads automatically — no restart required
```

---

## Bob Skills

### `worktrace` — app context skill

A skill is a markdown file that Bob loads into context whenever a relevant conversation
starts. The `worktrace` skill means Bob already knows the full stack, all env vars,
the exact build commands, and common gotchas — **before reading a single file in this repo**.

**What it covers:**

- Full service topology (nginx → FastAPI → pgvector → Supabase auth)
- All key URLs, image names, OC project and cluster identifiers
- Complete env var reference (baked vs runtime, where each lives)
- The exact `docker buildx` commands for both images with all build args
- Known gotchas: `./backend` build context, `TTT_PGSSL=false`, VITE vars baked at build,
  multi-arch requirement, cluster expiry procedure
- MCP server tool reference and token regeneration instructions
- Useful `oc` one-liners for debugging

**Location:** `~/.bob/skills/worktrace/SKILL.md`

**Activates when you say:** "WorkTrace", "my app", "the time tracker", "rebuild", "redeploy",
"my knowledge base", or ask about the OpenShift cluster.

---

### `worktrace-deploy` — deploy wizard & debug skill

An interactive guided skill for deploying WorkTrace to a new or replacement OCP cluster,
and for diagnosing broken deployments. It prompts for every required credential, runs
`./openshift/deploy.sh`, and walks through each failure mode with exact fix commands.

**Location:** `.bob/skills/worktrace-deploy/SKILL.md` *(workspace-scoped)*

**Activates when you say:** "deploy to new cluster", "new OCP cluster", "cluster expired",
"redeploy", "pods crashing", "backend error", or ask to set up WorkTrace on a fresh cluster.

**Four modes:**

| Mode | When to use |
|---|---|
| **A — Full fresh deploy** | Brand-new cluster, no `deploy.env` yet |
| **B — Cluster renewal** | Same credentials, just new `OC_SERVER` + `OC_TOKEN` |
| **C — Debug** | Pods crashing, blank page, secrets wrong, Postgres issues |
| **D — Dump before expiry** | Save DB before your TechZone reservation ends |

**Mode A walkthrough (fresh deploy):**
1. Checks `oc`, `docker`, `buildx` are installed and daemon is running
2. Creates `deploy.env` from example if missing
3. Prompts for credentials group by group — OCP login, registry, Supabase, Postgres password, Nomic, LLM provider (Groq or watsonx)
4. Runs `./openshift/deploy.sh`
5. Reminds you to update Supabase redirect URLs (login fails without this)
6. Verifies all pods are healthy

**Mode C debug decision tree:**

| Symptom | Diagnostic command | Common cause |
|---|---|---|
| Backend CrashLoopBackOff | `oc logs deployment/knowledgebase-backend --previous` | Wrong DATABASE_URL, missing secret, wrong arch build |
| Frontend crash | `oc exec deployment/knowledgebase-frontend -- nginx -t` | nginx config error |
| App loads, blank page | Check VITE vars in image | `VITE_*` baked at build time — needs full image rebuild |
| Login fails | Check Supabase redirect URLs | New cluster URL not added to Supabase auth config |
| Postgres won't start | `oc get pvc postgres-data` | PVC Pending — wrong storage class for this cluster |
| Rotate one secret | `oc patch secret knowledgebase-secrets ...` | No full redeploy needed |

---

## How they work together

```
You: "How many hours did I log on Honda this month?"
  └─ Bob loads worktrace skill (knows the stack/auth context)
  └─ Bob calls MCP tool: list_time_entries(project_code="Honda",
                           start_date="2025-07-01", end_date="2025-07-31")
  └─ MCP server calls: GET /api/ttt/entries?project_code=Honda&...
                         → WorkTrace backend → in-cluster Postgres
  └─ Bob answers with live data, no copy-paste needed

You: "Log 1.5 hours on that project today"
  └─ Bob calls MCP tool: create_time_entry(date="...", durationMinutes=90,
                           projectCode="Honda", taskType="review")
  └─ Entry created in WorkTrace directly from the conversation
```

---

## Changing the cluster URL

TechZone clusters expire roughly every 2 weeks. When you migrate:

1. Run `./openshift/dump.sh` before the old cluster dies
2. Deploy to new cluster: update `OC_SERVER` + `OC_TOKEN` in `openshift/deploy.env`, run `./openshift/deploy.sh`
3. Get the new route: `oc get route -n knowledgebase`
4. Update `WORKTRACE_URL` in `~/.bob/settings/mcp.json`
5. Update Supabase redirect URLs to the new route host (Authentication → URL Configuration)

That's all that changes — the JWT token and all other secrets stay valid.

> **Tip:** Say *"cluster expired"* or *"deploy to new cluster"* and the `worktrace-deploy` skill
> will guide you through steps 2–5 interactively, prompting for each value.
