---
id: PACKET-Q
title: A live chat can be reported into a queue nobody can see — pre-implementation gate
role: the packet an approval line must name a checkpoint in
status: PROPOSED, unsigned
date: 2026-09-22
---

# PACKET Q — closing a write-with-no-read moderation gap

## ⛔ APPROVAL — EMPTY, and that is its correct state

```
APPROVED BY:
APPROVED ON:
APPROVED AT SHA:
SCOPE APPROVED:
```

> ⛔⛔ **NOT AUTHORIZED. PROPOSED** — no existing checkpoint governs this connection.
> **Non-collision:** `PACKET-Q` appears nowhere in either worktree (checked before writing this
> file — `PACKET-K` is taken by an unrelated 2026-09-14 packet).

⛔ **ZERO NEW BACKEND CODE.** Both endpoints already exist, correct, admin-gated. This packet
builds one small admin panel, directly modeled on an existing 39-line sibling panel in the same
directory.

---

## 1 · The gap, checked directly against source — a real functional dead end, not cosmetic

`GET /api/community/chat/admin/reports` (`api/routers/community.py:1326-1328`) and
`PATCH /api/community/chat/admin/reports/{report_id}` (`:1331-1345`) already exist, admin-gated
(`require_admin`), and let an admin list open chat-message reports and act on them (`hide` —
soft-deletes the message and broadcasts a live removal — or `dismiss`). Verified the row shape
directly: `chat_reports` (`api/services/community_store.py:179-187`) carries
`message_id, reporter_id, reason, preview, status, created_at`, joined with the target message's
`author_id`/`channel_slug`/`deleted` state.

**The write side is live today — members can already generate these reports.**
`ChatView.jsx:524` calls `reportMessage(id)`, which POSTs to `/api/community/chat/reports`,
confirmed a real, reachable member action. **Checked directly: nothing reads
`chat/admin/reports`.** Grepped every casing across `app/src` — zero hits, including in
`Admin.jsx`. So today, a member can report a chat message and it goes into a queue that no admin
page ever opens — a functional dead end, not a missing nicety.

**Verified this is NOT the same as the existing "Community Reports" panel already on `/admin`:**
`components/admin/CommunityReportsPanel.jsx` reads a *different* route,
`/api/community/admin/reports` (thread/post reporting — an older, separate pipeline). The chat
version is a newer, distinct feature (`819ef6606`, "The Floor v2 — live Pulse chat") that never
got its own admin surface. This packet is a direct sibling to that existing panel, not a
duplicate of it.

## 2 · Proposed checkpoint

| CP | scope | strands? | size |
|---|---|---|---|
| **CP1** | One new admin panel on `Admin.jsx`, sibling to the existing `CommunityReportsPanel` | none | **XS** |

### MUST-BUILD, exactly

1. **`app/src/components/admin/ChatModerationPanel.jsx`** (new file): modeled directly on
   `CommunityReportsPanel.jsx`'s exact idiom — `useSWR('/api/community/chat/admin/reports',
   fetcher, {refreshInterval: 60_000})`, renders nothing while `!data` (same "flag off / not
   loaded" convention), a `Hide`/`Dismiss` button pair calling the `PATCH` endpoint and
   `mutate()`-ing on success, an empty-queue message when there are zero open reports. Shows the
   report's `preview`/`reason`/`reporter_id` and the target message's `channel_slug`.
2. **`Admin.jsx`**: mount `<ChatModerationPanel />` alongside the existing `CommunityReportsPanel`
   (same import + render pattern, same section of the page).
3. **`app/src/components/admin/ChatModerationPanel.test.jsx`** (new file): asserts the panel
   renders open reports, the `Hide`/`Dismiss` actions call the correct `PATCH` body, and an empty
   queue renders the "queue is clear" state rather than a blank/broken panel.

### Explicitly deferred, NOT authorized by this line

- A "Mute author" action (the sibling `CommunityReportsPanel` has one calling a *different*,
  thread/post-scoped mute endpoint — whether the same mute mechanism applies to chat authors is
  not verified here and is not assumed).
- `GET /api/community/chat/admin/stats` (connection/ops telemetry, no test coverage, correctly
  lower priority — not part of this packet).
- Any change to `chat_reports`, `list_chat_reports`, `set_chat_report_status`, or the report-
  submission path in `ChatView.jsx`.

### Risk

**Very low.** No backend change, one small admin-only panel copying an already-shipped sibling's
exact pattern. Only admins see it; the `hide` action's effect (soft-delete + live broadcast) is
the same already-tested behavior the endpoint has today, just newly reachable from a button
instead of only via direct API calls.
