# Q3 Planning Meeting — Notes
**Date:** 2024-07-15  
**Attendees:** Sarah (PM), James (Eng Lead), Priya (Design), Tom (Data)

---

## Agenda

1. Q2 Retrospective
2. Q3 OKR Review
3. Feature prioritisation
4. Resourcing

---

## Q2 Retrospective

- Shipped the new dashboard on time ✓
- Search latency reduced by 40% after index optimisation ✓
- Mobile onboarding flow missed deadline — moved to Q3 backlog ✗
- Customer NPS increased from 32 to 41 ✓

**Action:** James to document root cause of onboarding delay by July 22.

---

## Q3 OKRs

| Objective | Key Result | Owner | Target |
|---|---|---|---|
| Improve retention | Reduce 30-day churn | Sarah | < 8% |
| Expand integrations | Ship Slack + Jira connectors | James | Aug 30 |
| Enhance search | Semantic search v1 | Tom | Sep 15 |
| Redesign settings | Usability score | Priya | ≥ 4.2 / 5 |

---

## Feature Prioritisation (MoSCoW)

### Must Have
- Semantic search using vector embeddings
- Slack integration (OAuth + notifications)
- Password-less login (magic link)

### Should Have
- Bulk export (CSV / PDF)
- Role-based access control (RBAC)
- In-app guided tour

### Could Have
- Dark mode
- Custom dashboards
- Webhook support

### Won't Have (this quarter)
- Mobile native app
- SSO with SAML

---

## Resourcing

- Hiring 2 senior engineers — interviews start July 29
- Design contractor needed for settings redesign (2 weeks)
- Tom requests GPU instance for embedding model training — **approved**

---

## Next Steps

| Action | Owner | Due |
|---|---|---|
| Finalise Q3 roadmap in Jira | Sarah | July 19 |
| Draft Slack integration spec | James | July 23 |
| Share semantic search POC | Tom | July 26 |
| Contractor brief for design | Priya | July 22 |
