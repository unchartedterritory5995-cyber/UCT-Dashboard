---
id: PACKET-L
title: The "Open Flow" searchable options-flow board — a full member page, pre-implementation gate
role: the packet an approval line must name a checkpoint in
status: PROPOSED, unsigned
date: 2026-09-22
---

# PACKET L — a real feature, not a badge: the missing Open Flow board

## ⛔ APPROVAL — EMPTY, and that is its correct state

```
APPROVED BY:
APPROVED ON:
APPROVED AT SHA:
SCOPE APPROVED:
```

> ⛔⛔ **NOT AUTHORIZED. PROPOSED** — no existing checkpoint governs this connection.
> **Non-collision:** `PACKET-L` appears nowhere in either worktree (checked before writing this
> file — `PACKET-K` is already taken by an unrelated, already-signed 2026-09-14 packet).

⛔ **ZERO NEW BACKEND CODE, but this is BIGGER than Packets G–J.** Those were small badges on an
existing page. This is a new standalone member-facing PAGE — the read endpoint already exists,
correct and proven, but there is no page for it at all today, not just a missing card.

---

## 1 · The gap, checked directly against source

`GET /api/live/massive/flow-board` (`api/live_massive_router.py:6027-6041`, backed by
`api/weekly_flow.py::board_data()`) already computes the full **still-open directional options-flow
board** — every name with open directional positioning (not just a top-N split), each with
bull/bear/net/bullPct, top contract, days-open, and since-open performance. Gated by
`require_flow_user` — **any logged-in session, not paid, not admin** (verified directly:
`api/flow_admin_auth.py:93-105` is a plain "logged in or PUSH_SECRET or proxy-trusted" check).
Options Flow is a free-tier page per this app's own auth model, and this endpoint matches that
exactly.

**The engine is production-proven, not experimental:** `board_data()` calls the same
`load_directional_trades`/`aggregate` functions that already power the scheduled "Open Flow"
Discord card today. Only the JSON-serving wrapper for a searchable UI tab is unused. It never
raises — `{"ok": False, "reason": ..., "rows": []}` on any internal failure, verified by reading
the function directly.

**Checked directly: this endpoint has ZERO frontend callers anywhere in `app/src`.** Grepped every
casing/variant of `flow-board` — no hits, and confirmed no server-to-server caller either (unlike
the sibling `/confluence-flow` endpoint, which IS consumed internally by `api/confluence_screen.py`
and correctly not counted as a gap).

**This was built and then had its home removed, not merely never started:** `LiveFlowMassive.jsx`
still carries a dead `viewMode: "openflow"` branch with a comment explaining a stale
`localStorage` value must fall back to `"print"` because that mode "no longer renders" — a
searchable Open Flow board existed inside that admin-dense page and was deliberately pulled from
it. The backend was left behind, gated for regular members (not admin), which only makes sense if
it was meant to resurface as its own product surface.

**A safe build path already exists in this codebase, used for exactly this shape of problem:**
`app/src/pages/FlowScoreboard.jsx` is a small, self-contained page — one `useSWR` call, its own
CSS module, reuses `TickerPopup` — that was built as its own standalone route (`/flow-scoreboard`,
nav-labeled "Flow Record") specifically so a flow-adjacent feature would NOT need to touch the
partner-owned `OptionsFlow.jsx`. This packet follows that exact precedent.

## 2 · Proposed checkpoint

| CP | scope | strands? | size |
|---|---|---|---|
| **CP1** | One new standalone page + route, first coverage of `board_data()`'s row-shaping | none | **S** |

### MUST-BUILD, exactly

1. **`tests/test_flow_board_endpoint.py`** (new file): the endpoint's first test coverage —
   logged-in-but-unauthenticated refusal (401), a real board response's row shape, the `cap`/`days`/
   `limit` query params passed through correctly, and the honest `{"ok": False, ...}` degradation
   path when `board_data()`'s own try/except fires. No isolation trickery needed here (unlike the
   `uct_intelligence` cross-repo tests) — `weekly_flow.py` is a same-repo module; mock
   `load_directional_trades`/`aggregate` directly rather than hitting the real flow.db.
2. **`app/src/pages/OpenFlow.jsx`** (new file): modeled directly on `FlowScoreboard.jsx`'s idiom —
   one `useSWR('/api/live/massive/flow-board', fetcher)` call, a sortable/searchable table (sym,
   bull/bear/net, bullPct, top contract, days-open, since-open perf), `TickerPopup` on each symbol.
   A cap-band filter (all/mega/large/mid_small) matching the endpoint's own `cap` param.
3. **`app/src/pages/OpenFlow.module.css`** (new file): its own stylesheet, not shared with
   `OptionsFlow.jsx` or `FlowScoreboard.module.css`.
4. **`App.jsx`**: register the new route (e.g. `/open-flow`) — a plain route addition, same pattern
   as `/flow-scoreboard`'s own registration.
5. A rail test confirming the page renders the board for a real response and degrades honestly
   (a clear "no data" state, not a broken table) on the `{"ok": False}` shape.

### Explicitly deferred, NOT authorized by this line

- **A permanent NavBar entry.** Deliberately deferred — this app already has several real,
  reachable-but-unlisted routes by design (`/traders`, `/dark-pool`, `/post-market`,
  `/setup-library`), and adding one here means running `node tools/nav_manifest.mjs` to
  regenerate CLAUDE.md's generated nav table, which this packet does not authorize. The owner can
  decide whether it earns a permanent nav slot after seeing it live; until then it is reachable by
  direct URL, exactly like the routes above.
- Any change to `weekly_flow.py`, `board_data()`, or the underlying flow.db/OI-snapshot pipeline.
- Any change to `LiveFlowMassive.jsx` (its dead `openflow` viewMode branch stays exactly as-is —
  removing it is a separate, unrelated cleanup, not part of this packet).
- Any change to `OptionsFlow.jsx` (partner-owned; this packet touches it nowhere).

### Risk

**Low, but not as low as a badge packet — say so plainly.** This is a new page a member can
navigate to and interact with (search/sort/filter), not a passive card. The data source is
production-proven (same engine as the live Discord card) and the endpoint never raises, but a new
interactive surface has more room for a frontend bug than a read-only badge does. No backend
change at all; worst case is a broken page at an unlisted URL, not a regression to any existing
page.
