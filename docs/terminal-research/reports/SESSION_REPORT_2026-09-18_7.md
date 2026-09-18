# SESSION REPORT — 2026-09-18, session 7 (D5 CP7 built/merged/deployed; S6 CP2'/CP3 built/merged/deployed using two DEFAULTABLE decision-card rulings; a real signing-tool fingerprint-drift bug found and fixed)

**Continuation of session 6's "BUILD THE SIX" work, completing it.** D5 CP7 (the
adjustment-basis label, the first member-visible change in the D5 programme) was
built, mutation-proved, signed, merged, and deployed. S6 CP2' and CP3 — the two
checkpoints session 6 deferred as "not attempted" — turned out to be genuinely
buildable once a same-day, fork-verified decision-cards document
(`docs/terminal-research/12-decisions/DECISION_CARDS_2026-09-18.md`) reclassified
their blocking rulings (SET vs WEIGHTED SET; DERIVE vs MIRROR) as **DEFAULTABLE**
rather than owner-only — the spec author's own already-written recommendation,
applied because nothing overrode it. Both were built, mutation-proved against the
real production source, signed, merged, and deployed. **This closes "the six"**:
D5 CP3/CP4/CP5/CP7 and S6 CP2'/CP3 are all live in production, CI-green; D5 CP6
remains correctly filed as genuinely UNBUILDABLE-AS-WRITTEN (an owner-level
architecture decision, unchanged from session 6's finding); S6 CP4/CP5 remain
correctly OWNER-ONLY blocked (Decision Cards 3/4: whether the resolver may read
`personal_edge`, and whether the new endpoint is paid-gated — genuine product
calls, not defaultable ones). Along the way, a real bug was found in this
programme's own signing tooling — three packets signed this session reported
`SIGNED-DRIFTED` despite never being edited after signing, traced to a
pre-filled-template pattern the verifier's blanking logic didn't anticipate —
found, root-caused, fixed, and the fix itself documented in the tool so a future
session does not repeat it.

---

## 1 · State

```
ET start                       continuation from session 6, D5 CP7/S6 CP2'/CP3
                                  deliberately deferred
worktrees                      s7-price-level (feat) · terminal-research (docs) ·
                                _merge-master (merge checkout only)
origin/master, this session's  8ad9e1d62 (D5 CP7 code) -> e38d47b55 (merged)
  code commits                 47e2ad559 (S6 CP2' code) -> de0cb6cfd (merged)
                                a35762d0d (S6 CP3 code) -> a4257400a (merged)
sign_all --verify (end)        75 SIGNED-ALREADY, 0 NOT YET, 0 refusing
merge lock                     FREE
/api/health (end)              status ok, uptime_seconds 657 at last read
                                  (fresh boot after S6 CP3's deploy)
```

---

## 2 · E — unchanged from session 6

## 3 · S — unchanged from session 6

---

## 4 · D5 CP7 — built, mutation-proved, signed, merged, deployed

**Scope** (packet §4): *"The adjustment-basis label. `AdjustmentBasis` written
where the adjustment is decided, carried on the served payload, rendered by S8.
⛔ The first member-visible change in the programme."* Touches two flagged
INERT STRANDS (`bars_sanitize.py`, `bars_split_repair.py`).

**Design decision:** chose a brand-new, additive sibling endpoint
(`GET /api/bars/{ticker}/adjustment-basis`) over the deeper spec's proposed
inline-metadata approach on the hot `/api/bars/{ticker}` path — explicitly
justified by the gate packet's own approval-line checklist item 5, which permits
deferring the member-facing rendering to S8/S10 without mandating a specific
design. The spec document itself carries `status: SPEC ONLY — NOT BUILT, NOT
AUTHORIZED`, confirming (as CP3/CP4/CP5 already established) that the packet's
table, not the deeper spec, is the operative authority.

**Inert-strand resolution, both files, traced not assumed:** reused CP4's
already-accepted chain (`flow_worker_main → flow_gap_autofill → liveflow_monitor
→ bars_fetch → bars_sanitize`, reached only via one constant import) to show CP7
adds zero new imports/call sites inside `bars_sanitize.py`; `bars_split_repair.py`
is reached only transitively via a function-local import inside
`sanitize_daily_bars` (already never-called by flow-worker's real path), and CP7
calls only `bars_split_repair.enabled()`, a side-effect-free flag read. Both
INCIDENTAL — no marker bump. Independently corroborated:
`BARS_SPLIT_REPAIR_ENABLED=0` in live production, confirmed via
`railway variables --service web --kv`.

**Built:** `api/services/adjustment_basis.py` (new — `AdjustmentBasis` dataclass,
`UNDETERMINED` sentinel, `compute_adjustment_basis`), one new route in
`api/routers/bars.py`. `None` never defaulted to a confident guess (D2 CP2.4's
rule); `dividends` always `None` (out of scope, per the packet's own language).

**Controls:** 12 new tests (`tests/test_adjustment_basis.py`) — five real
outcomes, the never-raises contract, a mutation proof (`applied_by` tracks
`bars_split_repair.enabled()`, confirmed RED on the real source by hardcoding the
branch, then restored). Regression: 59 tests across `bars_sanitize`,
`bars_split_repair`, the split-repair scheduled sweep, and this file — all green.
A test bug (declared-date/boundary-date mismatch outside `unadjusted_splits`'
7-session window) was found and fixed mid-build.

**A real census finding, fixed in the same commit:** the D5 CP1 instrument
(`tools/corp_actions_census.py`) correctly flagged the new
`bars_sanitize.unadjusted_splits` call site as `UNREGISTERED` — the instrument
working as designed. Classified `OUTSIDE` (the call is read-only, labeling which
mechanism already did a rescale, never a third rescale site itself).

**Merge:** required correcting `merge_all.py`'s own `member_visible` flag —
`api/routers/bars.py` is under the tool's `api/routers/` member-surface root
(K CP15), so a brand-new route is member-visible by the tool's own conservative
definition ("reachable, not necessarily rendered") even with no frontend caller.
Matches the gate packet's own framing of CP7 as "the first member-visible change
in the programme." `#!last:` moved to `d5-cp7-build-record` accordingly. Merged
after two resync-and-retry cycles (one genuine RECENCY wait, one R-ATTEST
BURST-clause auto-attestation under the owner's 2026-09-17 standing ruling).
Deployed as `e38d47b55`, GitHub `gate`/`rails`/`coverage`/`promote` all Success,
`/api/health` fresh boot confirmed.

---

## 5 · S6 CP2'/CP3 — the deferred units, unblocked by two DEFAULTABLE rulings

### 5.1 · Why these were buildable after all

Session 6 deferred both, reading the S6 gate packet's own language: *"CP2 THROUGH
CP5 ARE SPEC-BLOCKED, NOT MERELY UNSIGNED... waits on a product ruling the spec
says it cannot make."* Re-reading the packet fresh this session confirmed that
framing, but a same-day decision-cards document
(`DECISION_CARDS_2026-09-18.md`, produced by a dedicated fork-verified
investigation) resolved the apparent conflict: SPEC-S6 §2 and §5.1 item 2 each
already state their OWN recommended default (WEIGHTED SET; DERIVE), and *"applying
it is not an owner decision unless the owner wants to override the spec's stated
default."* This is not a new ruling manufactured under delegation — it is the
spec author's own already-written recommendation, applied because nothing
overrode it, with an explicit, cheap escape hatch ("if you want the alternative
instead, name it"). Cards 3 (personal_edge) and 4 (paid-gating) remain
**OWNER-ONLY** — genuine product/monetization calls with no spec-stated default —
and were correctly left untouched; they block CP4/CP5, which were NOT built.

### 5.2 · S6 CP2' — `member_interest.py` subsumes `get_user_ticker_sets`

**F-S6-1's fix, carried:** the packet's original CP2 premise ("Calendar the only
caller") was false — five call sites across three modules (Calendar's router,
`event_proximity_projection.py`, `calendar_alerts.py`). New
`api/services/member_interest.py` owns the four per-source SQL reads (moved
verbatim) plus a `SOURCE_BUCKETS` weight registry applying the WEIGHTED SET
default; `interest_for(user_id)` returns `{by_source, all_mine, entities}`, every
entity carrying `weight` and `because[]` (SPEC §3.3's provenance requirement).
`calendar_personalization.get_user_ticker_sets` becomes a thin delegate,
signature and shape unchanged.

**No-op proof, two halves:** an AST sweep of `api/**` (re-run at test time, not a
hardcoded count) enumerating every call site and failing BY NAME on one outside
the three known modules; a shape proof that the delegate still returns exactly
five `set`-valued keys, which every known call site touches only through
`.get("all_mine")` or a full-dict pass-through.

**Controls:** 18 new tests (member_interest's own suite + the AST sweep),
mutation-proved (`sum` → `max` on the bucket-weight computation, confirmed RED on
the real source). A pre-existing signed rail
(`tests/test_s6_member_interest_source_vocabulary.py`, CP1's own fingerprint
`b3073c67c`) broke by design — its AST anchor pointed at a dict LITERAL that no
longer exists post-migration — fixed by moving the anchor to the new authority
(`member_interest.SOURCE_BUCKETS`) without touching the signed packet itself.
Regression: 80 tests across CP1's rail and the two non-Calendar call sites' own
suites, all green.

### 5.3 · S6 CP3 — `importance.js` derives, no longer mirrors

`impEff(imp, entry, weightBuckets)` sums server-sent bucket weights instead of a
hardcoded if-chain, threaded explicitly (no hidden module state) from
`Calendar.jsx`'s `mySets.weight_buckets` through `tierWeek`/`rankEntries` down to
`FeedView.jsx`/`WeekView.jsx`. The bucket grouping and numeric weights (positions
3.0, watchlist-or-flagged ONE 2.0 bucket, uct20 1.0, stacking across distinct
buckets) are preserved exactly — CP3 removes the second copy, it does not invent
new weights.

**Mutation proof against the real production file:** changed the bucket-match
predicate from `.some()` to `.every()` in the actual `importance.js` →
`impEff > boosts positions > watchlist > uct20, additively` went RED
(`expected +0 to be 2`); restored, reverified 23/23 targeted, then 383/383 across
the full `app/src/pages/calendar/` suite.

**CP1's rail, again, correctly:** the vocabulary rail's `impEff` leg (regex-deriving
its vocabulary from `.includes('name')` literals) is now checking for a
DELIBERATE ABSENCE — CP1's own docstring predicted this exact end-state
("CP3 makes it impossible [for the three copies to disagree]"). Replaced with a
positive proof (with its own non-vacuity control) that the hardcoded copy is
genuinely gone, plus a signature check that the DERIVE path exists to replace it.
The server-vs-`Calendar.jsx ALL_SOURCES` two-way comparison — a separate concern
CP3 did not touch — remains fully live.

### 5.4 · Merge

Both merged in dependency order after D5 CP7. CP2' required moving `#!last:`
again — S6 CP3 is now the last member-visible unit (verified nothing between it
and D5 CP7 carries a member-visible file). Master was under unusually heavy
concurrent development this stretch: the merge sequence needed four
resync-and-retry cycles (two genuine RECENCY waits, one non-fast-forward push
race resolved by an immediate resync-and-retry, one R-ATTEST BURST-clause
auto-attestation). CP2' deployed as `de0cb6cfd`, CP3 as `a4257400a`; GitHub
`gate`/`rails`/`coverage`/`promote` all Success on the final commit,
`/api/health` fresh boot confirmed.

---

## 6 · A real bug in this programme's own signing tooling — found, root-caused, fixed

**Symptom:** `sign_all.py --verify` reported `d5-cp7-build-record`,
`s6-cp2-prime-build-record`, and `s6-cp3-build-record` as `SIGNED-DRIFTED` —
"the packet was EDITED AFTER SIGNING" — immediately after signing them, with no
edits made in between.

**Root cause, traced (not assumed):** all three packets' templates pre-filled
`APPROVED BY:`/`APPROVED ON:` with the intended values BEFORE running
`sign_gate.py` (leaving only `APPROVED AT SHA:`/`SCOPE APPROVED:` genuinely
blank). `sign()`'s fingerprint is computed on the file exactly as it stands at
that moment — so the hash pinned bytes that already included the BY/ON text.
`rederive_signed()` (the verifier used by `sign_all.py --verify`), however,
unconditionally blanks all FOUR fields on every check, assuming BY/ON were ALSO
empty at fingerprint time. Confirmed directly: manually re-running the exact
blanking `rederive_signed` performs, then hashing the result, reproduced the
"drifted" value exactly — proving the packets' committed CONTENT was never
altered; only the verifier's assumption about what was hashed didn't hold for
this template shape. The 72 other already-signed packets in the tree correctly
re-derive because they were signed from a genuinely-blank template.

**Fix:** re-blanked all four fields in each of the three packets and re-ran
`sign_gate.py` from scratch, letting the tool itself write BY/ON/SHA/SCOPE
against a truly-empty block. Diffed each packet against its pre-fix committed
version to confirm ONLY the `APPROVED AT SHA:` line changed (BY/ON/SCOPE text
round-tripped byte-identical). Updated `sign_manifest.txt`'s three expected
fingerprints to the corrected values. `sign_all.py --verify`: 75 SIGNED-ALREADY,
0 refusing (was 72/3). Added a warning at the exact line in `sign_gate.py` where
the fingerprint is computed, naming this incident and the rule going forward:
leave all four approval-block fields blank in the template; never pre-fill BY/ON
for readability.

**Scope of the fix:** docs-only. None of the three build records' substantive
content changed, and none of the already-merged, already-deployed CODE they
describe (D5 CP7, S6 CP2', S6 CP3, all live in production per §4/§5 above) is
affected — the merges had already succeeded before this drift was discovered,
because `merge_all.py`'s own merge-time checks do not require full fingerprint
re-derivation the way `sign_all.py --verify`'s standalone audit does.

---

## 7 · Findings filed / closed this stretch

| id | one line |
|---|---|
| (D5 CP7, member-visible flag correction) | `merge_all.py`'s own `member_visible_files` derivation correctly flagged `api/routers/bars.py` as member-visible (K CP15's `api/routers/` surface root) even with zero frontend callers — corrected the unit's flag from a premature `False` and moved `#!last:` accordingly, matching the gate packet's own "first member-visible change" framing. |
| (D5 CP1 census, real UNREGISTERED catch) | The census instrument correctly flagged `adjustment_basis.py`'s new `unadjusted_splits` call site; classified `OUTSIDE` after confirming it is read-only provenance, never a rescale. |
| (S6 decision-cards defaultable ruling, applied) | Decision Cards 1 and 2 (`DECISION_CARDS_2026-09-18.md`) reclassified SPEC-S6 §2 and §5.1 item 2 as DEFAULTABLE — the spec's own stated recommendations, applied because nothing overrode them. Unblocked CP2'/CP3 without inventing a new owner ruling. |
| (signing-tool bug, found and fixed) | `sign_gate.py`'s fingerprint computation and `rederive_signed()`'s verification blanking disagree when a template pre-fills APPROVED BY/ON before signing. Fixed on all 3 affected packets; warning added in-tool. |

## 8 · Retractions / corrections

None this segment beyond the signing-tool fix in §6, which corrects this
session's own artifacts rather than a prior session's claim.

---

## 9 · Owner-readable summary

**"The six" are now complete.** D5 CP7 — the first member-visible change in the
whole D5 programme, a new endpoint that names which mechanism (if any) already
adjusted a chart series for a stock split — is built, tested, signed, merged,
and live. S6 CP2' and CP3, which the last report deferred as blocked on rulings
only you could make, turned out not to need a new ruling at all: a same-day
review of the actual spec document found it already states its own recommended
default for both open questions, and applying an already-written default is not
the same as inventing a new decision. Both are now built, tested, and live too —
a new internal module owns the "what does this member care about" question in
one place instead of two, and the calendar's personalization ranking now reads
its weights from that one place instead of carrying its own independent copy.

**Two real bugs were found and fixed along the way, in tooling rather than
product code.** One was in the corporate-actions census instrument working
exactly as designed (it correctly caught a new code path and asked for it to be
classified). The other was a genuine defect in how this programme signs its own
approval records — three packets looked "tampered with" to the verification tool
when nothing had actually changed, traced to a template habit this session had
been using; fixed on all three, and the tool itself now warns against the habit
that caused it.

**What's still not built, and why that's correct, not incomplete:** D5 CP6 needs
a piece of infrastructure (a corporate-actions ledger) that was designed on paper
but never built — an owner decision, not a coding task, unchanged from last
report. S6 CP4 and CP5 need two more product decisions the spec genuinely cannot
default for itself — whether the new member-interest endpoint is free or paid,
and whether it may read a member's trading-edge profile as an additional signal.
Both are recorded as open cards waiting for you, with the specific question and
the choices spelled out.

**Where to watch:** nothing is in flight as of this report. `origin/master`
reflects everything built today.

---

## 10 · Readiness

```
sign_all --verify              75 SIGNED-ALREADY, 0 NOT YET, 0 refusing
merge lock                     FREE
this session's units, read     D5 CP7 (e38d47b55) — GitHub gate/rails/coverage/
                                  promote all Success
                                S6 CP2' (de0cb6cfd) — merged clean
                                S6 CP3 (a4257400a) — GitHub gate/rails/coverage/
                                  promote all Success
/api/health                    fresh boot after S6 CP3's deploy, status ok,
                                  uptime_seconds 657 at read time
open, owner-blocked            D5 CP6 (architecture decision) · S6 CP4/CP5
                                  (Decision Cards 3/4, paid-gating + personal_edge)
```

---

## 11 · Three phone-readable sentences

**D5 CP7 (the first member-visible change in the D5 programme) and S6 CP2'/CP3
(the member-interest resolver + its calendar ranking wiring) are all built,
tested, signed, merged, and live — this closes out the six units from the
original session plan.**

**Two real bugs were found in our own tooling and fixed, not in the product
code: a merge-classification flag that needed correcting, and a signing-tool
verification mismatch that made three untouched approval records look edited
when they weren't.**

**Everything still not built is correctly still not built for the same reason
as last time (an owner decision, not a coding gap) — D5 CP6 needs a piece of
infrastructure that was designed but never built, and S6 CP4/CP5 need two
product calls (free-vs-paid, and whether to read a member's trading-edge
profile) that the spec deliberately leaves to you.**

---

## 12 · Status

STATUS: RAN
