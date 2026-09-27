---
id: PACKET-J
title: A UCT confidence-score badge on the per-ticker research page — pre-implementation gate
role: the packet an approval line must name a checkpoint in
status: PROPOSED, unsigned
date: 2026-09-22
---

# PACKET J — the missing confidence-score connection

## ⛔ APPROVAL — EMPTY, and that is its correct state

```
APPROVED BY:      Patrick (owner)
APPROVED ON:      2026-09-22
APPROVED AT SHA:  d3e86c615
SCOPE APPROVED:   CP1 ONLY — the checkpoint(s) named here and nothing else in the packet.
```

> ⛔⛔ **NOT AUTHORIZED. PROPOSED** — no existing checkpoint governs this connection.
> **Non-collision:** `PACKET-J` appears nowhere in either worktree (checked before writing this
> file).

⛔ **ZERO NEW BACKEND CODE.** Same shape as Packet I: the read endpoint already exists, complete,
correct, and paid-gated. This packet's entire MUST-BUILD is one frontend badge — plus the
endpoint's first test coverage beyond the existing paywall-gate row.

---

## 1 · The gap, checked directly against source

`GET /api/confidence-scores/{symbol}` (`api/routers/intelligence.py:146-175`) already answers
"what is UCT's own computed confidence score for this ticker" — a 6-component breakdown
(`base_score`, `regime_fit`, `volume_confirm`, `rs_confirm`, `sector_fit`, `catalyst_score`) that
sums to `total_score`, plus a letter `grade` and `qualifying[]`/`invalidating[]` factor lists. Same
cross-repo mechanism as Packet I's `leader-persistence` endpoint (`_get_api()` /
`uct_intelligence.db.get_connection`, reading a `confidence_scores` table populated by the
autonomous-brain scoring pipeline). It degrades honestly (`{symbol, score: null}`) both when the
Brain Pack isn't installed and when the ticker has never been scored — never an error.

**Checked directly: this endpoint has ZERO frontend callers anywhere in `app/src`.** Grepped
`confidence-scores` across every `.jsx`/`.js` file, including inside hooks — no hits. It is
already paid-gated (`require_paid`, same as every route in this file) and already has ONE test
covering the gate itself (`tests/test_paywall_gate_free_tier.py:75`) — but no test of the actual
row-shaping/degradation logic, the same gap `leader-persistence` had before Packet I.

**Verified the `symbol` column is real, not stale:** the engine's `confidence_scores` table
originally keyed only on `candidate_id` (a FK to `ep_candidates`); `_migrate_confidence_scores_phase2`
(`uct_intelligence/db.py:864-881`) adds `symbol` + `score_date` columns via `ALTER TABLE`, and that
migration runs unconditionally inside `init_db()` (`uct_intelligence/db.py:1093`) — so the router's
`WHERE symbol = ? COLLATE NOCASE` query is valid against the live schema, not a stale assumption.

So today, a member reading NVDA's research page has no way to see UCT's own confidence grade on
that name — a fact the system already computes and stores, on the one page built specifically to
be "everything about this ticker."

## 2 · Proposed checkpoint

| CP | scope | strands? | size |
|---|---|---|---|
| **CP1** | One new frontend badge on `OverviewTab.jsx`, first coverage of the endpoint's row-shaping logic | none | **XS** |

### MUST-BUILD, exactly

1. **`tests/test_confidence_score_endpoint.py`** (new file): row-shaping/degradation coverage
   beyond the existing paid-gate test — a real scored ticker returns the full breakdown +
   `qualifying`/`invalidating` correctly parsed from JSON; a never-scored ticker returns
   `{symbol, score: null}` honestly, never an error; the engine-unavailable case degrades the same
   way. Isolates the cross-repo `uct_intelligence` import the same way
   `tests/test_leader_persistence.py` does (fake `sys.modules` package tree, temp-file SQLite) —
   never touches the real `C:\Users\Patrick\uct-intelligence` checkout. No change to the endpoint
   itself unless this pass finds a real defect, in which case the defect and its minimal fix are
   reported before anything else is built (same discipline as every other packet this session).
2. **`app/src/pages/research/ConfidenceBadge.jsx`** (new file): modeled directly on
   `LeadershipBadge.jsx`'s idiom (self-contained card, inline SWR fetch, renders null when
   `score` is null) — not a new hooks-file convention. Shows the letter grade + total score
   prominently, the 6 sub-scores as a compact breakdown, and the qualifying/invalidating factors
   as short lists when present.
3. **`OverviewTab.jsx`**: mount `<ConfidenceBadge sym={sym} />` beside the existing
   `<LeadershipBadge sym={sym} />` / `<DeskCoverage sym={sym} />` cards — exact same pattern,
   renders nothing for a ticker that has never been scored.
4. A rail test confirming the badge renders for a real score and renders nothing (not an empty
   placeholder) when `score` is null.

### Explicitly deferred, NOT authorized by this line

- Any change to the `confidence_scores` table, its migration, or the autonomous-brain scoring
  pipeline that populates it.
- Any change to `get_confidence_score` itself beyond what a real test-driven defect requires.
- Whether `BRAIN_PACK_ENABLED`/the confidence-scoring job is currently active in production is NOT
  verified by this packet (same production-read restriction noted in Packet I). The endpoint's own
  honest fallback means this ships safely either way.

### Risk

**Very low.** No backend change (beyond adding tests, which cannot regress behavior by
themselves), one small conditionally-rendered badge reusing an already-shipped idiom. A member
whose ticker has never been scored sees nothing different at all.
