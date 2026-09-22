---
id: PACKET-I
title: A UCT20/Leadership badge on the per-ticker research page — pre-implementation gate
role: the packet an approval line must name a checkpoint in
status: PROPOSED, unsigned
date: 2026-09-22
---

# PACKET I — the missing Leadership-20 connection

## ⛔ APPROVAL — EMPTY, and that is its correct state

```
APPROVED BY:      Patrick (owner)
APPROVED ON:      2026-09-22
APPROVED AT SHA:  830cec48e
SCOPE APPROVED:   CP1 ONLY — the checkpoint(s) named here and nothing else in the packet.
```

> ⛔⛔ **NOT AUTHORIZED. PROPOSED** — no existing checkpoint governs this connection.
> **Non-collision:** `PACKET-I` appears nowhere in either worktree (checked before writing this
> file).

⛔ **ZERO NEW BACKEND CODE.** Unlike Packets G and H, the read endpoint this packet needs already
exists, complete, correct, and paid-gated. This packet's entire MUST-BUILD is one frontend tab —
plus the endpoint's first test coverage, which does not exist anywhere today.

---

## 1 · The gap, checked directly against source

`GET /api/leader-persistence/{symbol}` (`api/routers/intelligence.py`) already answers "how many
consecutive days has this ticker been on Leadership 20 (UCT20)" — real query against
`leadership_snapshots`, weekend-gap-aware consecutive-day counting, `require_paid`-gated. It
returns `{symbol, consecutive_days, total_appearances, first_seen, last_seen}` and degrades
honestly (`{symbol, consecutive_days: 0}`) when the underlying Brain Pack isn't installed —
never an error either way.

**Checked directly: this endpoint has ZERO frontend callers anywhere in `app/src`.** Not on
`/research/:sym`, not on `/uct-20`, not on the Dashboard, nowhere. It was built, is correct, and
has never been wired to anything a member can see. It also has no test coverage anywhere in
`tests/` — checked, zero hits.

So today, a member reading NVDA's research page has no way to learn "this name has been one of
UCT's top-20 leadership picks for the last 40 sessions" — a fact the system already computes and
stores, on the one page built specifically to be "everything about this ticker."

## 2 · Proposed checkpoint

| CP | scope | strands? | size |
|---|---|---|---|
| **CP1** | One new frontend hook, one small badge/card on `ResearchPage.jsx`, first-ever test coverage for the existing endpoint | none | **XS** |

### MUST-BUILD, exactly

1. **`tests/test_leader_persistence.py`** (new file): the endpoint's first test coverage —
   paid-gate refusal, a symbol with a real consecutive run (fixture-seeded `leadership_snapshots`
   rows), a symbol with a gap (consecutive count resets correctly across a >3-day break), and a
   symbol never on the list (`consecutive_days: 0`, `total_appearances: 0`, honest empty — never
   an error). No change to the endpoint itself unless this pass finds a real defect, in which case
   the defect and its minimal fix are reported before anything else is built (same discipline as
   every other packet this session).
2. **`app/src/pages/research/hooks/useLeaderPersistence.js`** (new file): same SWR shape as every
   other tab's hook on this page.
3. **`ResearchPage.jsx`**: a small badge/line — NOT a new full tab (this is one fact, not a
   category of content) — shown on the Overview tab when `consecutive_days > 0` ("On UCT20
   Leadership for N sessions" or equivalent, with `first_seen`/`total_appearances` in a title/
   detail disclosure). Renders nothing when `consecutive_days === 0` — no empty-state banner for
   the common case of "not a current pick," since Overview already carries plenty of content and a
   permanent "not currently a leader" note would be noise on most tickers, not signal.
4. A rail test confirming the badge renders for a real streak and renders nothing (not an empty
   placeholder) when `consecutive_days` is 0.

### Explicitly deferred, NOT authorized by this line

- Any change to `get_leader_persistence` itself, `leadership_snapshots`, or the Brain Pack sync
  pipeline.
- Historical analog data (`GET /api/historical-analogs` and neighboring intelligence-router
  endpoints, glimpsed while reading this file) — a separate, larger surface, not scoped here.
- Whether `BRAIN_PACK_ENABLED` is currently on in production is NOT verified by this packet
  (checking it hit this session's own production-read restriction). The endpoint's own honest
  fallback (zero, not an error) means this ships safely either way: with the pack installed,
  members see real streaks; without it, the badge simply never renders, exactly like a ticker
  that has never been a pick.

### Risk

**Very low.** No backend change (beyond adding tests, which cannot regress behavior by
themselves), one small conditionally-rendered badge, one new read-only hook. A member who has
never seen a UCT20 pick sees nothing different at all.
