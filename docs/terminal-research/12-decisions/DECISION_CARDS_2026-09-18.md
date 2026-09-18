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

**Status: OWNER-ONLY**, and the VERDICT GATE (five full trading sessions of forward
data, per predicate) is now formally **READY** — but the data underneath that READY
status should give real pause, read live from production this session
(`railway ssh --service web -- python tools/s7_price_level_report.py`, 2026-09-18):

```
predicates seen ....... 10        comparison spans ...... 10        recorded outcomes: 2079

  predicate                   agreed  new-only legacy-only  not-comparable sessions verdict
  legacy:08d68edb-d4b              0         0        2079               0        5 ready
  legacy:2cc1f7db-61b              0         0           0               0        5 ready
  legacy:4896a625-3d9              0         0           0               0        5 ready
  legacy:7b69ac30-1ae              0         0           0               0        5 ready
  legacy:b4996557-2b7              0         0           0               0        5 ready
  legacy:b99aae00-577              0         0           0               0        5 ready
  legacy:c591ef0b-081              0         0           0               0        5 ready
  legacy:e07ea57a-999              0         0           0               0        5 ready
  legacy:f0d66360-4ad              0         0           0               0        5 ready
  legacy:fb781c79-e44              0         0           0               0        5 ready
```

**Two findings worth reading before deciding, neither of them "the flip is safe":**

1. **9 of 10 predicates show ZERO outcomes of any kind** (agreed/new-only/legacy-only/
   not-comparable all 0) across all five sessions. That is either a genuinely quiet
   market for those specific price levels, or the new evaluator silently not firing
   against them — the report cannot tell the two apart, and "five sessions of
   silence" is a weaker READY than "five sessions of agreement."
2. **One predicate (`08d68edb-d4b`) shows 2079 legacy-only fires and 0 agreement.**
   The legacy rule triggered 2079 times; the new evaluator matched it ZERO of those
   times, over five full sessions. This is the one predicate with real volume to
   judge by, and on it the two paths disagree completely.
3. **The tool's own documented blind spot points the flattering way**: the legacy
   path is one-shot (fires once, then the row goes inactive and leaves the
   comparison), so a `new-only` of 0 does not mean the new evaluator never fires
   early — it means this report cannot see a second crossing once legacy has fired
   once. The 2079 legacy-only figure is real; the 0-agreement figure next to it is
   not proof of total disagreement, only proof that agreement was never OBSERVED.
4. **Live-ticking check right now (2026-09-18, Friday ~12:22 ET, inside the trading
   window) shows NO heartbeat at all for any of the 7 S7 dark crons** — price-level
   included. Worth checking `ALERT_TAXONOMY_PRICE_LEVEL_DARK_ENABLED`'s live value
   and the web log for a "DARK sweep failed" line before trusting this READY status
   as still current; the five-session data above may be looking backward at a sweep
   that has since gone quiet.

**Recommendation: do not flip on this data alone.** The gate says READY by session
count, but the underlying signal is either near-silent or a stark, unexplained
disagreement on the one predicate with real volume. Recommend: (a) confirm the
crons are still ticking today before trusting the READY verdict at all, (b)
investigate why 9/10 predicates recorded zero outcomes (silent evaluator vs quiet
market), (c) specifically investigate the 08d68edb-d4b predicate's 2079-to-0 gap
before flipping that predicate's delivery on.

**Choose:** A) flip now, accepting the risk on 08d68edb-d4b  B) hold, investigate
the two findings above first  C) flip everything except 08d68edb-d4b
D) something else: ______________
