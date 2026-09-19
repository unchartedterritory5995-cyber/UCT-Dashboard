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

**RULED 2026-09-18, under explicit owner delegation ("make judgement calls on
everything remaining").** **B) No — interest and edge stay separate concepts.**
S6's own resolver (`member_interest.interest_for`, S6 CP2'/CP4) answers *"what does
this member track"* — a set of explicitly-owned/watched/flagged entities, SPEC-S6's
shape 1/2. `personal_edge` answers a categorically different question — *"how has
this member's OWN trading performed on this setup historically"* — SPEC-S6 §2's own
shape-3 classification (a DERIVED PROFILE), already reachable by two other
consumers (`grade_watchlist.py`, `ai_search_personal.py`) built for that exact
purpose. Blending a performance signal into an attention/tracking signal would
answer a *different* member-facing question than S6 CP4 was built and sized to
answer ("what am I watching, and why"), and CP4's own build record sized the
checkpoint at S/M against a ~40-line budget with no room to add a personal_edge
read plus its own cold-start/soft-mute handling. **No code change; the resolver
stays as CP4 shipped it.** Revisit if/when S6's own personalization roadmap
reaches a checkpoint that explicitly asks "should watching a symbol be weighted by
how well I've traded it" — that is a new product surface, not a missing wire.

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

**RULED 2026-09-18, under explicit owner delegation ("make judgement calls on
everything remaining").** **C) HOLD.** Not because the new evaluator is wrong — the
investigation above is explicit that it is behaving correctly by its own written
spec — but because a flip here is a live change to what fires as a real alert on
real trading decisions, and two of this card's own three "what this data cannot
tell you" caveats are unresolved product questions, not implementation risk: (1)
the one-shot vs. re-fires persistence semantics is described in the evaluator's own
docstring as *"a product call,"* genuinely unmade, and a flip ships SOME answer to
it by default whether or not anyone chose it on purpose; (2) the sample is n=10,
several apparently synthetic/dogfooding fixtures, with **zero** trendline/anchor-
rewrite coverage (anchor_version=0 on all 10) — the more complex code path this
system exists to eventually handle has never been dark-exercised. Flipping now
would answer a genuine, stated-as-open product question (persistence semantics) by
default, on a thin and partly non-organic sample, for a surface that changes what
members are told to act on. **This is exactly the class of decision this session's
delegation explicitly declines to make unilaterally** (real external/member-facing
risk, not a spec-stated default) — held pending either (a) a larger/more organic
comparison window, or (b) an explicit owner answer to the persistence-semantics
question first. No code or config change; `ALERT_TAXONOMY_PRICE_LEVEL_DARK_ENABLED`
stays in dark-comparison mode, legacy `watchlist_alerts` continues to be the one
that actually fires.

---

## CARD 7 — OI-06 is CLOSED (answered 2026-09-14); the broader command-palette-UI
## question (HY-05) is a SEPARATE, still-open bet — RULED 2026-09-19

**Two different questions were carried under one name, and conflating them was the
reason this looked like a live decision when most of it was not.**

### 7a · OI-06 itself — CLOSED, not mine to re-decide

**OI-06's literal, formal text** (verified against its own registration this
session): *"Of thinkorswim, TradingView, Finviz, Market Chameleon, Unusual Whales,
SpotGamma — which do you and the partner open by hand on a trading day, and does
the desk run any TradingView alerts?"* This is a narrow, factual input question, not
a strategic one. **It was already answered 2026-09-14**, five days before this
session, in `verification/2026-09-14/OI-06-telemetry-derived-defaults.md`, via real
production telemetry plus the owner's own stated rule for the half telemetry cannot
reach (*"where telemetry is silent, take the shipped palette's current behaviour as
the answer"*): external tools default to NONE, TradingView alerts default to NO,
and the S1 surface manifest's order/membership and S2's command-grammar targets
were derived from real session data (13 active users, 50 admin session-days).

**Status: CLOSED, 2026-09-14. Nothing for this session to rule on.** What this
session found and fixed was pure staleness: S1's and S2's own gate packets still
said *"waits on OI-06, nothing can be signed until that is answered"* five days
after it was answered — and, independently, both packets' own CP1 checkpoints
turned out not to have needed the answer at all (both were built and signed the
day the packets were written, 2026-09-14, before OI-06's own answer landed later
that same day). Corrected in both gate packets and in `COMPLETION_AUDIT.md` §1.1.

### 7b · The command-palette / grammar UI (HY-05) — RULED: HOLD, same reasoning as CARD 6

**This is the question CARD 1 of this document's own predecessor research
conflated with OI-06, and it is a genuine, unresolved product-strategy bet.**
`hypothesis-register.md`'s HY-05 status is **"unknown"** — no keystroke or latency
measurement exists anywhere in the competitive survey, for either side of the
question. The evidence is genuinely split: Bloomberg's own moat is named
explicitly as one this desk **must not** copy (*"difficulty-as-moat... UCT must
not emulate because it has no counterparty lock to absorb the churn"*), and half
of the comparable universe (Fiscal.ai, TradingView, SpotGamma, Benzinga) ships
**no command grammar at all**, deliberately. The C4-01 synthesis's own three
candidate designs (`command-grammars.md` §11) split the same way: Grammar A
(Bloomberg-lite, noun-first) is named "weakest for members" and walks straight
into a real, already-shipped hazard (RS/EMA/MA/GAP/PEG are real tickers); Grammar
B (Ctrl-K palette, zero syntax) is named "the safest option for members"; Grammar
C (context bar + scoped verbs) is the synthesis's own recommendation to test
first but is flagged as needing a real UI gap solved first (widget headers
currently carry no visible label, only a colour dot — "which pane am I typing
into" has no answer today).

**RULED: HOLD on building any VISIBLE palette UI** — same reasoning as CARD 6:
this is real, unmeasured, member-facing risk (a UI surface members would need to
learn, on a competitive argument that explicitly does not transfer to this desk's
situation), not a spec-stated default, and not something this delegation resolves
unilaterally. **NOT held: the low-risk infrastructure underneath it**, which
carries none of HY-05's uncertainty because nothing is mounted or visible either
way — S1 CP1 (the surface manifest), S2 CP1/CP2 (the chord table + collision
rail + one adopting surface) were already built prior to this session under the
same reasoning, and S1 CP2 / S2 CP3 (the next narrow, zero-new-surface-area
checkpoints) are buildable now that OI-06's own narrow question is closed. Building
the actual A/B/C palette UI is the real bet, and it stays open pending either a
keystroke/latency measurement or an explicit owner call on which of A/B/C (if any)
to build.

### 7c · Owner asked to reopen the HY-05 HOLD ("FIND A WAY") — CONFIRMED, not
### lifted; the register's stale citations corrected — 2026-09-19

**The owner's instruction was not "keep it held" or "lift it" — it was to do
everything resolvable from the evidence on file and be precise about the one
thing that is not.** This pass re-read `command-grammars.md` (C4-01) in its
current, fully-updated form — including the Gödel composition-syntax and
TradingView keybinding closures landed the SAME DAY (`1ee7a4904`, 2026-09-19
12:31, after this card's own 7a/7b ruling) — specifically to check whether
either closure moves HY-05. It does not: both are design-space detail (Gödel's
confirmed four-slot `NVDA US EQ DES` syntax; TradingView's full ~130-binding
inventory showing no chord takes a typed argument), not a keystroke, latency,
or retention measurement. C4-01's own `evidence_ceiling` says so directly — no
product was operated with a live seat, and every "feels fast / is learnable"
claim in the file is 🔴. **7b's HOLD is CONFIRMED, not lifted — there is no new
measurement to lift it on, and inventing one would be manufacturing progress
the owner explicitly asked this program not to do.**

**What "finding a way" actually produces, concretely:**

1. **`hypothesis-register.md`'s HY-05 row and its three surrounding notes (§1D
   line, §2 RECOMMENDATION, §GAPS) were stale** — they still said C4-01 was
   unread and pointed at OI-06 as a HY-05 unblocker, five days after this
   card's own 7a closed OI-06 and independently confirmed the C4-01 read
   changes nothing. Corrected in place (⚰️, sourced) rather than restated as a
   fresh row, so both documents now agree.
2. **The low-risk infrastructure this card already cleared (S1 CP2, S2 CP3)
   is reconfirmed buildable today**, unblocked by neither OI-06 nor a
   retention measurement — nothing about it is held. If it has not moved since
   7b, that is a scheduling fact, not a re-opening of the ruling.
3. **OI-06's real remaining substance is separated out and named precisely,**
   because 7a closed OI-06's *formal registration* (the program will not ask
   the question again) without ever putting the question to Patrick — the
   2026-09-14 answer is a conservative default chosen because telemetry
   cannot see third-party tool use, not Patrick's own account of his day.
   **The one narrow thing only Patrick can supply, quoted exactly as
   registered** (`OWNER_INPUTS_REQUESTED.md` §A3): *"Of thinkorswim,
   TradingView, Finviz, Market Chameleon, Unusual Whales, SpotGamma — which do
   you and the partner open by hand on a trading day, and does the desk run
   any TradingView alerts?"* — plus, separately and only if he wants HY-05's
   causal bet resolved rather than left on infrastructure-only footing, **an
   explicit choice among C4-01 §11's Grammar A / B / C** (or a keystroke/
   latency measurement of one workflow). Neither answer is required to keep
   building S1 CP2 / S2 CP3; both are required before any visible palette UI
   ships.
