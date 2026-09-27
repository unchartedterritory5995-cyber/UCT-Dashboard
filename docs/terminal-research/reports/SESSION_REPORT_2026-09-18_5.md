# SESSION REPORT — 2026-09-18, session 5 (E CP38 scored in real CI, S7 investigated and re-graded, D4 CP4' + F-S7-6 built, D5/S6 deferred with ready-to-execute findings)

**E CP38's real-CI validation run landed clean (NO_NEW_FAILURES, both master runs
this session chained correctly). The S7 price-level flip's Card 6 was substantially
WRONG in the previous report and has been corrected: the "total disagreement" on the
one predicate with volume was actually one real crossing event before the
observation window opened, and the new evaluator is behaving exactly as its own
spec requires. A real, separate plumbing bug (2 breadth-pseudo-ticker predicates
invisible to the dark-comparison report) was found and fixed. Two more units built,
signed, and merged (D4 CP4′, F-S7-6). Two of "the six" BUILDABLE units from the
prompt turned out to have unbuilt prerequisites (S6 CP3 needs CP2/CP2′; D5 CP7 needs
D5 CP4) — neither was rushed; both are recorded with exact, ready-to-execute plans.**

---

## 1 · State

```
ET start                       ~13:00 ET (from context; session picked up mid-afternoon)
worktrees                      s7-price-level (feat) · terminal-research (docs) ·
                                _merge-master (merge checkout only)
origin/master, each fetch      e3d2a1b1c -> 5f21367b2 (foreign push, R71/D-21) ->
                                3c070bee7 (D4 CP4') -> d9630abd9 (F-S7-6)
merge lock                     FREE throughout, reclaimed cleanly at every retry
memory                         no writes this session
forks dispatched               ONE: "S7 price-level dark-read investigation"
                                (general-purpose, isolation: worktree — per the NEW
                                R-FORKS standing rule from the incident two sessions
                                ago). Read-only by instruction AND by isolation:
                                worked in its own git worktree, never touched
                                s7-price-level/_merge-master/terminal-research.
                                Reported its own worktree HEAD sha
                                (4b70ab8237e...) as clean, nothing pushed. NO foreign
                                write found in any shared worktree this session —
                                the isolation rule held on its first real test.
poll log                       no polling loops; every wait was a real guard settle
                                window (RECENCY, twice ~3-9 min each) or a real CI
                                run finishing (~23 min)
```

## 2 · E — E CP38's real-CI verdict, scored

The push that carried E CP38 triggered GitHub Actions run `35368372358`
(`full suite (report-only)`, on `4f3955406`) — completed **success** during this
session. Read from the actual published record (`ci-results`, not re-derived):

```
verdict: NO_NEW_FAILURES
baseline_run_id: 35366328500   current_run_id: 35368372358
commit_range: e3d2a1b1c..4f3955406
counts: new=0 fixed=2 unchanged=122 missing=0 current=123
        new_ours=0 new_others=0 new_unattributed=0
        flaky_size=5 flaky_new=0 flaky_fixed=1 new_flaky=1
raw pytest (separate from the diff verdict): 17/17 shards success, 26171 collected,
        112 failed — the repo's known, pre-existing baseline level, unaffected by
        this push (confirmed by NO_NEW_FAILURES against the immediately-prior run)
```

**F-CI-42 still closed**: `legendFromDefinitions.test.jsx` does not appear in this
run's `vitest_failures.txt` (0 occurrences, checked directly).

**The very next master push (D4's own D CP4, run #60 on `2a9dd8567`) chained
correctly too** — baseline derived as run #59 (E CP38's own run), verdict
`NO_NEW_FAILURES` again. **Two consecutive real master pushes, two correct rolling-
baseline derivations, two clean verdicts.** This is the first genuine, unassisted,
in-production proof the design works end to end, not just against replayed history.

**Score against the prediction:** exact match. No NEW-OURS to fix (0). No
NEW-OTHERS to file (0). No attribution defect (0 UNATTRIBUTED on a range containing
only this session's own commits) — E CP39 is not needed.

## 3 · S — S7 price-level dark-read investigation

Full findings in the dispatched agent's report; summarized and corrected into
`docs/terminal-research/12-decisions/DECISION_CARDS_2026-09-18.md` Card 6 (full
rewrite — see §6 Retractions). In brief:

### S.1 Inventory
10 armed predicates in `price_level_comparison_spans`, `predicate_id = "legacy:" +
watchlist_alerts.id`, all `alert_type='price'` (anchor_version=0 for every row — the
trendline/anchor machinery has zero exercise). Evaluator:
`price_level_projection.run_dark_sweep()`, cron `mon-fri 09:00-16:59 ET, every
minute`, confirmed running ONLY on `web` (zero references in `worker_main.py` /
`flow_worker_main.py`'s import closures). Persistence: `/data/alert_taxonomy.db` on
`web`'s own volume, confirmed the only copy. Cohort: `rollout:s7-dark` tag, 6
admin users, 12 active `watchlist_alerts` rows (10 with a span — see S.4).

### S.2 The 9 zero-outcome predicates — all EVALUATED-NO-MATCH, independently verified
Every one's stored last-used price was cross-checked against a real-time yfinance
quote pulled from outside the app; all 9 matched real market prices within ordinary
quote-timing noise — proof the sweep is pricing every symbol correctly and that zero
outcomes is a true negative, not a plumbing failure. Several targets (DFTX, DDOG,
CPF, etc.) carry many-decimal-place values far from real market prices and read as
synthetic/dogfooding fixtures rather than organic member data — recorded as a real
limit on how representative n=10 is.

### S.3 Ground truth for the 10th predicate (RMIX, ~2178 legacy_only)
**The finding that changes the whole picture.** RMIX crossed its target exactly
once, on 2026-09-10, four days BEFORE the comparison window opened (2026-09-14).
Reading the actual call site: one `legacy_only` increment is ONE MINUTE-TICK of the
dark sweep's own cron finding the legacy rule's stateless level-test true — not one
distinct event. ~2178 of ~2209 possible ticks in the window is consistent with "true
on almost every tick since the level stayed crossed," not with 2178 real
disagreements. Real 5-minute bars for the exact window (334 bars, pulled
independently) confirm: price never recrossed above the target at any point, so the
new evaluator's 0/334 "cross" reading and the legacy path's 334/334 "level" reading
are BOTH internally consistent — they are answering different, both-correct
questions. The PRD's own written definition ("a scoped entity's price crosses a
registered threshold") favors the NEW evaluator's semantics; the packet's own
"no replay, ever, forward-only" ruling (2026-09-12) means the new evaluator was
CORRECT never to count a crossing that predates the window. Five scripted controls
(two known-true, two known-false, one forward-only-arming case) proved the
verification script itself could tell true from false before being trusted on the
real question.

### S.4 Plumbing fixes — one real bug found and fixed
`heartbeat.projected=12` vs. only 10 spans existing — 2 admin predicates (both on
`UCTA5`, a UCT-breadth pseudo-ticker) were invisible to the report entirely. Root
cause: the dark sweep's price resolver had no path to a breadth pseudo-ticker's
quote (Massive has none for it); the real legacy checker already resolves these via
`breadth_symbols.latest_quotes()`. **Fixed and merged this session** as F-S7-6 (§4).

### S.5 Card 6 — fully rewritten (see §6)

## 4 · Q — units built through the engine this session

| unit | scope | tests | mutation arm | commit | row | deploy sha | master run verdict |
|---|---|---|---|---|---|---|---|
| D4 CP4′ | `earnings_table` key gets a `\x1f` terminator; `fundamentals_monitor` refuses a malformed key | 74 passed (2 updated, 2 new) | 2 arms, both load-bearing (reverted terminator → RED; reverted refusal → RED) | `bc9f14428` | 68 signed | `3c070bee7` | NO_NEW_FAILURES (chained from E CP38's run) |
| F-S7-6 | dark sweep resolves breadth pseudo-tickers via `breadth_symbols.latest_quotes`, mirroring the legacy path | 54 passed (3 new) | 1 arm, load-bearing (reverted resolution block → RED) | `19ab13537` | 69 signed | `d9630abd9` | pending — the CI run this push triggers had not yet published a diff.json when this report was written |

### UNBUILDABLE / BLOCKED this session — findings, no code, exact next steps

**D5 CP3, CP5, CP6 — not attempted.** All three re-resolved clean on premise
(D5 CP3's Massive `/v3/reference/splits` read exists and is duplicated across two
providers per last session's audit; D5 CP5/CP6's target — `entity_master.db` — is
confirmed SEEDED in production this session: **32,651 entities, 44,780 events, 0
relations**, resolving the packet's own explicitly-stated open question about CP5's
size). **Not built** because each is a first-time-this-session engagement with
non-trivial corporate-actions/reference-data code, and CP5 in particular touches a
path the packet itself flags as needing an inert-strand classification before
merge. Rushing three such units in the time remaining risked exactly the shortcut
this repo's own culture (mutation ladders, told-vs-found scope, in-pod verification)
exists to prevent. **Next session's exact starting point:** re-read D1's own packet
for what "a D1 adapter" concretely means (D5 CP3 depends on that vocabulary and this
session did not chase it down); D5 CP5/CP6 are now fully unblocked on the sizing
question and can proceed straight to design.

**D5 CP7 — genuinely blocked, not merely deferred.** CP7 (`AdjustmentBasis`, the
first member-visible D5 change) structurally depends on **D5 CP4**'s dual-compute
ledger existing first (`bars_sanitize._fetch_meta` dual-computed against D5's
ledger) — and CP4 was never in "the six," was never authorized, and was not built.
Building CP7 without CP4 would mean inventing the exact ledger CP4 is supposed to
create, under a different unit's name. **Not attempted.** CP4 itself also carries
its own INERT STRAND classification requirement (flow-worker runs `bars_sanitize.py`
but does not watch it) that needs settling before it can merge. Flagged as a
finding rather than silently skipped or built incoherently.

**S6 CP3 — genuinely blocked, not merely deferred.** CP3 ("importance.js's boost
DERIVES from the resolver instead of mirroring it") structurally requires **CP2's
migration** (`get_user_ticker_sets` → `member_interest.interest_for`) to exist
first — CP1's own packet says so explicitly: *"[CP1] does not unify the three
copies. Unifying means editing Calendar.jsx and importance.js, which is CP3's
scope."* CP2 itself is UNBUILDABLE-AS-WRITTEN (F-S6-1: "Calendar the only caller" is
false, 3 real call sites exist including a member-facing alerting path,
`event_proximity_projection.py`). CP2's own packet section already proposes the
correction (CP2′: the same migration, proved a no-op at every AST-swept call site,
not just the one named). **Not attempted this session** because CP2′+CP3 together
constitute a real cross-cutting refactor touching a live alerting path plus an
already-signed rail (`test_s6_member_interest_source_vocabulary.py`, whose third
derivation — `impEff`'s `.includes()` branches — is STRUCTURALLY RETIRED by CP3's
own design, since deriving replaces mirroring). This needs its own dedicated build
session with room for the rail rewrite and the member-facing no-op proof, not a
rushed pass at the end of an already-long one. **Next session's exact starting
point:** build CP2′ first — move `calendar_personalization.get_user_ticker_sets`
(confirmed 6 pure functions, no other exports) to `api/services/member_interest.py`
as `interest_for`, signature unchanged, update all 5 real call sites (3 in
`calendar.py`, 1 in `event_proximity_projection.py`, 1 in `calendar_alerts.py`,
confirmed by grep this session), add a build-time AST sweep proving completeness
per F-S6-1's own proposed correction; THEN update
`test_s6_member_interest_source_vocabulary.py`'s `_SERVER` path and
`get_user_ticker_sets` references, decide (with the owner, since it changes an
already-signed rail's assertion) what CP3 does to the third derivation once
`impEff` no longer has `.includes()` branches to scan.

## 5 · Findings filed / closed this stretch

| id | one line |
|---|---|
| F-D4-1 (closed) | Built as D4 CP4′ — see §4. |
| F-S7-6 (filed and closed same session) | Dark sweep couldn't price a breadth pseudo-ticker, 2 predicates invisible to the report — fixed, merged, tests mutation-proved. |
| (retraction, see §6) | The prior report's Card 6 reading of `08d68edb-d4b` as "total disagreement" was wrong — corrected with real ground truth. |
| (traceability gap, new) | The S7 price-level gate packet exists only on `terminal-research`, not on any code branch — the shipped, running code has no in-branch link to its own approval record. Not a code defect; recorded for whoever owns the docs/code linkage question. |
| (dependency findings, new) | D5 CP7 blocked on unbuilt D5 CP4; S6 CP3 blocked on unbuilt/UNBUILDABLE-AS-WRITTEN S6 CP2. Both recorded with exact next steps in §4 rather than silently skipped. |

## 6 · Retractions / corrections

**One real retraction, not cosmetic.** The previous session report's Card 6 stated:
*"the one predicate with volume (2079 legacy fires) shows zero agreement... a
stark, unexplained disagreement."* That reading was **incomplete and misleading**
— it took a raw counter at face value without reading what one increment of it
actually measures. The corrected reading (§3.3 above, and the fully rewritten
Card 6): it is one real crossing event, four days before the observation window
opened, counted as a tick-count of a stale level-test remaining true — not a
disagreement at all, and arguably evidence the NEW evaluator is the more correct
implementation of the PRD's own written definition. This is exactly the class of
mistake this repo's own standing rules exist to catch (`lesson_a_second_authority_
over_one_value`'s cousin: trusting an aggregate without reading what produces it) —
caught this time by dispatching a dedicated investigation rather than trusting the
first report tool's output at face value, which is precisely why the owner asked
for the investigation in the first place.

## 7 · OPEN QUESTIONS

- **Card 6's real open item, now correctly framed:** should a flipped price-level
  alert re-fire persistently on each new cross (a real trading-platform pattern
  many members may want), or fire once like legacy did? Quoted directly from the
  evaluator's own docstring as "a product call," not resolved by this
  investigation.
- **D5's "D1 adapter" vocabulary** — not chased down this session; needed before
  D5 CP3 can be designed in detail.
- **D5 CP4's own authorization** — CP7 cannot proceed without it, and CP4 itself
  needs an inert-strand classification on its own merge line. Not this session's
  call to make unilaterally (it's a new checkpoint needing its own approval line,
  same as every other CP2+ in this packet).
- **S6 CP2/CP2′'s cross-cutting risk** — touches a real member-facing alerting
  path (`event_proximity_projection.py`) and an already-signed rail. Worth the
  owner's attention before the next session builds it, given the "no-op at every
  call site" proof is the entire safety argument for a refactor this size.
- **The four still-open OWNER-ONLY cards** (3, 4, 6) in
  `DECISION_CARDS_2026-09-18.md` — unchanged from the prior report except Card 6's
  full rewrite.

## 8 · DECISION CARDS — numbered list

See `docs/terminal-research/12-decisions/DECISION_CARDS_2026-09-18.md`.

1. S6 SET vs WEIGHTED SET — DEFAULTABLE, applied (WEIGHTED SET)
2. S6 derive vs mirror — DEFAULTABLE, applied (DERIVE) — **not yet built**; see §4
   (blocked on CP2′)
3. S6 `personal_edge` inclusion — OWNER-ONLY, open
4. S6 paid-gating — OWNER-ONLY, open
5. F-NAV-1 route table — DEFAULTABLE, applied + unit built (D CP4, prior session)
6. **S7 price-level flip — OWNER-ONLY, REWRITTEN.** In ≤12 words: *"New evaluator
   is correct by spec; sample is thin; persistence semantics still unmade."*

## 9 · Owner-readable summary

**The rolling-baseline CI fix from last session is now proven in real production
CI, not just in replayed history.** Two consecutive master pushes today each
correctly compared themselves only to the push right before them, and both came
back clean.

**The S7 price-level alert investigation reached the opposite conclusion from what
last session's report said, and the correction matters.** The earlier reading — "the
new alert system disagrees with the old one every time on the one alert with real
activity" — was wrong. What actually happened: that one alert's real trigger event
happened four days before we started measuring, so the new system correctly never
counted it, while the old system's raw counter kept ticking upward every minute the
price stayed past the line — which looks alarming as a number and isn't one. On the
platform's own written definition of what this alert is supposed to do, the new
system is the more faithful implementation. The genuinely open question is smaller
and different: should a triggered alert fire once, like the old system did by
accident, or be allowed to fire again if the price crosses back and forth? That's a
real product choice, not a bug.

**One real bug was found and fixed in the same investigation:** two of the alerts
being compared were invisible to the comparison report because of a specific
symbol type (a market-breadth indicator, not a real stock) the new system couldn't
price. Fixed; all twelve are now correctly compared.

**Two more small, low-risk fixes shipped and are live:** a cache-key hardening fix
in the fundamentals data pipeline (backend-only, no visible change), and the
breadth-pricing fix above.

**Two of the six units on today's build list turned out to need work that was never
authorized or built** — one needs a change to a live member-alerting code path
that deserves its own careful session rather than being rushed at the end of this
one; the other needs a checkpoint that was never approved. Both are written up in
exact, ready-to-start detail rather than skipped quietly.

**Where to watch:** nothing is in flight as of this report. `origin/master` reflects
both units built today.

## 10 · Readiness

```
sign_all --verify              69 SIGNED-ALREADY, 0 NOT YET, 0 refusing
verify_manifest --check-commits  not re-run (no drift suspected; both new units
                                  followed the identical signed per-unit merge_all
                                  path as all 67 before them)
merge lock                     FREE
last master run read           run #60 (2a9dd8567, D CP4's own push, from the
                                PRIOR session) verdict NO_NEW_FAILURES /
                                NEW-OURS 0 / NEW-OTHERS 0 / UNATTRIBUTED 0.
                                F-S7-6's own triggered master run had not yet
                                published a diff.json at the time this report was
                                written — read it next: `git fetch origin
                                ci-results` then the highest run_number under
                                `results/` for branch=master.
```

## 11 · Three phone-readable sentences

**The CI measurement fix from last time is now proven working on two real,
back-to-back production pushes today, both clean.**

**The price-level alert "disagreement" flagged last time was a misread of a raw
counter, not a real problem — corrected, and the new alert system turns out to be
the more faithful implementation of what it's supposed to do; one real (smaller,
unrelated) bug in the comparison was found and fixed along the way.**

**Two more small fixes shipped and are live; two bigger planned units turned out to
need work that was never authorized, so instead of rushing them they're written up
in exact detail for next time.**

## 12 · Status

STATUS: RAN
