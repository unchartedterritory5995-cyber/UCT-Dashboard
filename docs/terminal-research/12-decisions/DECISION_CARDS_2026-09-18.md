# DECISION CARDS — 2026-09-18

⚠️ Compiled from O.2 (S6 rulings, fork-verified), O.3 (F-NAV-1, fork-verified against
live production `page_views`), and O.4 (S7 price-level flip, live production
telemetry read via `railway ssh` this session). Each card is one screen; every claim
is sourced.

---

## CARD 1 — S6 ruling: SET vs WEIGHTED SET for member-interest aggregation

**Question:** does the S6 member-interest resolver treat every signal source as an
equally-weighted SET, or a WEIGHTED SET (some sources count more)?

**Recommendation: WEIGHTED SET.** SPEC-S6 states this as its own default when the
question is left open.

**Status: DEFAULTABLE.** The spec already names its own fallback; applying it is not
an owner decision unless the owner wants to override the spec's stated default.

**If you want the alternative instead:** plain SET (every source counts equally) —
name it and Q.3 builds against that instead.

---

## CARD 2 — S6 ruling: derive vs mirror for `importance.js`'s personal boost

**Question:** should the personal-interest boost be DERIVED from the my-sets join at
read time, or continue to MIRROR it via a hardcoded literal (`app/src/pages/
calendar/importance.js:74-81`'s `boost()` — confirmed today, still a literal `if
(src.includes('positions')) boost += 3.0` chain, whose own docstring says "mirrors
the my-sets join")?

**Recommendation: DERIVE.** SPEC-S6 states this as its own default. The mirror is
also a live maintenance hazard: it is a second authority over one value
(`lesson_a_second_authority_over_one_value`) that has to be hand-kept in sync with
the join it copies.

**Status: DEFAULTABLE.** Same basis as Card 1 — the spec already names DERIVE as its
default.

---

## CARD 3 — S6 ruling: may the resolver read `personal_edge`? — OWNER-ONLY

**Question:** `api/services/personal_edge.py` exists in production (confirmed). May
S6's member-interest resolver read it as an additional signal source?

**Status: OWNER-ONLY.** SPEC-S6 explicitly leaves this open — it is a product-scope
call about what counts as "interest," not a code question. No default exists to
apply.

**Choose:** A) yes, include it  B) no, keep interest and edge as separate concepts
C) something else: ______________

---

## CARD 4 — S6 ruling: paid-gating for the member-interest surface — OWNER-ONLY

**Question:** is S6 CP4's `GET /api/member/interest` endpoint (not yet built —
confirmed absent from `api/` today) free-tier or paid-gated?

**Status: OWNER-ONLY.** No default exists in the spec; this is a monetization
decision, not a technical one. Blocks CP4's build.

**Choose:** A) free tier  B) paid  C) something else: ______________

---

## CARD 5 — F-NAV-1: which routes get a sidebar entry — DEFAULTABLE, applied

**Question:** of the 9 real routes with no sidebar entry (AST-derived, packet
`packet-d-nav-tabs-gate.md`), which get one under the default rule (inbound links
AND non-zero 16-day traffic, read from live production `auth.db.page_views`)?

**Result, under the default:** exactly two qualify —

| route | inbound links | 16-day traffic | verdict |
|---|---|---|---|
| `/formulas/reference` | yes | 5 | **sidebar entry** |
| `/catalysts/history` | yes | 3 | **sidebar entry** |
| `/live-flow`, `/dark-pool`, `/post-market`, `/setup-library`, `/journal-2-0/report` | yes | 0 | stays unlisted, recorded |
| `/educational-videos` | no | 0 | stays unlisted, recorded |
| `/traders` | — | — | follows its own existing decision (voice-assistant door), not this default |

**Status: DEFAULTABLE, already applied** — this is a recorded decision, not an open
question. A sidebar-entry unit for `/formulas/reference` and `/catalysts/history` is
BUILDABLE (Q.3) if you want it built this session; otherwise it is filed and waits.

⚠️ **One flag worth a look before building:** `/live-flow`'s own retired-test-file
name (`liveFlowRetired.route.test.jsx`) suggests it may be a stale duplicate of
`/live-massive` rather than a genuine no-nav-entry gap — the fork flagged this as
worth a one-line check, not assumed.

---

## CARD 6 — S7 price-level: the flip (dark comparison → live delivery) — OWNER-ONLY

**Question:** flip `ALERT_TAXONOMY_PRICE_LEVEL_DARK_ENABLED`'s comparison into a real
FLIP (turn on delivery of the new price-level evaluator's alerts, turn off the
legacy `watchlist_alerts` rule)?

**Status: OWNER-ONLY. REWRITTEN 2026-09-18** after a dedicated, worktree-isolated
investigation (read-only, production-verified via `railway ssh --service web` +
independent yfinance quotes pulled outside the app entirely) replaced the earlier
reading of this data with real ground truth. **The earlier version of this card said
"total disagreement" on the one predicate with volume — that was wrong, and the
correction matters:** it was one real crossing event before the observation window
opened, counted as ~2178 one-minute ticks, not 2178 distinct events. See below.

### The 10 armed predicates, and what actually happened to each

**9 of 10 are genuine, verified true negatives — not silence, not a bug.** Each
predicate's own stored "last live price the sweep used" was independently
cross-checked against a real-time yfinance quote pulled from outside the app; all 9
matched real market prices to within ordinary quote-timing noise, proving the dark
sweep is pricing every one of them against real data and that zero outcomes means
the armed condition simply hasn't become true yet — SNDK is ~1% from its target and
close; DFTX/SPY/DIA/GME/BLZE/DDOG carry suspiciously precise multi-decimal targets
far (30%–5x) from the real market and read as synthetic/dogfooding fixtures rather
than organic member behavior. **This caps how representative n=10 is for a
platform-wide flip decision.**

**The 10th (`legacy:08d68edb-d4b`, RMIX, target 14.2067 below) is the real story,
and it is NOT disagreement — it is the two rules' designed semantics doing exactly
what they were specified to do:**
- RMIX crossed below its target **exactly once**, on 2026-09-10 — **before** the
  comparison window opened (2026-09-14 09:00 ET). It has stayed below every session
  since, never crossing back up and re-crossing down.
- The legacy rule is a **stateless level test**, re-run every minute with no memory
  — true on effectively every tick since the span opened (~2178 of ~2209 possible
  ticks), which is what the "2178 legacy_only" figure actually is: **a tick count of
  a level staying crossed, not 2178 distinct events.**
- The new evaluator implements a **cross** (a transition), per the PRD's own
  written definition, quoted exactly: *"A scoped entity's price crosses a
  registered threshold in a registered direction."* Under the already-ruled
  "no replay, ever, forward-only" decision (GATE-S7-PRICE-LEVEL §3a, owner ruling
  2026-09-12), the new evaluator is **correct** to have never counted a crossing
  that happened before the window opened. **This is designed behavior working
  exactly as specified — not a defect, and not "the new system disagreeing."**
- **On the PRD's own stated definition, the new evaluator is the more faithful
  implementation.** The open product question — quoted verbatim from
  `price_level_projection.py`'s own docstring — is real and distinct: *"[whether
  a flipped alert should re-fire persistently, the way legacy incidentally did] …
  is a product call,"* not resolved here.

### One real bug found and already fixed this session (F-S7-6)

The investigation also found a genuine plumbing gap, unrelated to the above: **2 of
the 12 armed admin-cohort predicates (both on `UCTA5`, a UCT-breadth pseudo-ticker)
were structurally invisible to the comparison report** — the dark sweep's price
resolver had no path to a breadth pseudo-ticker's quote (Massive has none), so they
never even got a comparison span. **Fixed and merged this session**
(`s7-price-level-f6-build-record.md`, CP3-scoped, no new authorization needed) by
resolving breadth symbols the same way the real legacy checker already does. Live
production now correctly prices all 12 armed predicates.

### What this data cannot tell you

**None of the 10 armed predicates uses the trendline/anchor-rewrite machinery**
(anchor_version=0 for all 10) — the more complex code path F-S7-2/F-S7-3 exist to
handle has **zero dark-period exercise** in this run. A flip decision made on this
evidence is a decision about fixed-price alerts only.

**A traceability gap, worth its own line:** the governing gate packet
(`s7-price-level-pre-implementation-gate.md`) does not exist on the code branches
that carry the shipped CP1–CP3 code — only on the `terminal-research` docs branch.
The shipped, running code has no in-branch link back to its own approval record.

### Recommendation

**The data no longer supports "hold, something looks wrong" — it supports "the new
evaluator is behaving correctly by its own written spec, on a thin and partly
synthetic sample."** The real open items are: (1) the persistence-semantics product
call quoted above (one-shot vs. re-firing) is still genuinely unmade, and a flip
ships SOME answer to it whether or not anyone decides it on purpose; (2) zero
trendline coverage means a flip should stay scoped to fixed-price alerts until that
path gets its own dark exercise; (3) the sample is thin (10, several apparently
synthetic) for a platform-wide rollout decision.

**Choose:** A) flip fixed-price alerts now, ship the "one-shot" legacy-matching
behavior as the v1 answer to the persistence question  B) flip fixed-price alerts
now, ship "re-fires on each new cross" as the v1 answer instead  C) hold for a
larger/more organic sample before flipping anything  D) something else:
______________
