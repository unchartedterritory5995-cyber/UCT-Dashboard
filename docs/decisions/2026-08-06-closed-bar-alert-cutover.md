# Decision: the indicator alert evaluator is rebuilt closed-bar

**Status:** 🟡 **OPEN — the evaluator reads the FORMING bar with cycle-granularity crossings, and its fires may not enter the Signature ledger.**

**Date opened:** 2026-08-06 · **Phase:** C · **Applied:** — · **Record of the measurement:** §3

## 1. The fact

`api/services/indicator_alert_evaluator._evaluate_one` computes the indicator over
every bar the store holds — including the bar currently forming — and takes `prev`
from `alert["last_value"]`, which is whatever the **previous 60-second poll cycle**
wrote. So "crossed above 70" can fire on a wick that unwinds before the bar closes,
and the same bar can be judged five times with five different answers.

Spec §8: *"nothing enters the ledger unless it is closed-bar evaluated."* That
constraint has been carried since B1 and is unmet.

## 2. Why this record exists before the rebuild does

⛔ **An alert cannot be un-sent, and no screenshot catches a wrong one.** Phase B
had a pixel gate: a picture either changed or it did not, and the number of changed
pixels was the price of every decision. Phase C ships **notifications**. There is no
image to diff, and the analogous artefact — the fire log — is only an artefact once
something has recorded it. So the sequence is inverted relative to B: the
*instrument* is built and committed on the unmodified tree (Task 2), the rebuild
lands dark behind `ALERT_EVAL_MODE`, and this record is what the cutover commit
(Task 8) flips.

⚠️ **`.superpowers/` IS GITIGNORED.** Every number this phase measures has to
survive in the repo or it survives nowhere, which is why the baseline in §10 is
here rather than in the SDD ledger. The programme has corrected a prose count six
times already (7→16→20→21→22→32 enumeration sites; "84 chart pytest" matching no
command; "25 alert addresses" when the dict holds **28** — see §10.3).

## 3. The measurement — NOT YET TAKEN

**Owner: Task 2.** This section is deliberately EMPTY and deliberately not deleted.

The repaint oracle — the same real bars replayed at K intra-bar cycle
granularities — has not been run. Today's evaluator **must** disagree across K;
Task 2's gate is that the disagreement is *measured and non-zero*, and a zero
**aborts as vacuous** rather than reading as good news.

⛔ Do not write a number here from a prediction. A decision record whose
measurement section is filled in by the task that *planned* the measurement is the
shape this programme has corrected six times.

## 10. Baseline, by command

**Measured 2026-08-06 at `bb089bf2`** (branch `feat/phase-c-alerts`), working tree
clean, before any Phase C source change. Every later task compares against **these**
numbers, never against the four in the plan header.

| # | command | measured | exit |
|---|---|---|---|
| 1 | `cd app && npx vitest run` | **5,494 tests / 499 files** | 0 |
| 2 | `PYTHONDONTWRITEBYTECODE=1 python -m pytest tests/test_indicator_alert_evaluator.py tests/test_indicator_alert_service.py tests/test_indicator_compute.py tests/test_indicator_golden.py -q` | **150 passed** | 0 |
| 3 | `PYTHONDONTWRITEBYTECODE=1 python -m pytest tests/test_admin_chart_health.py tests/test_chart_health_alerts.py tests/test_chart_markers.py tests/test_chart_news.py tests/test_chart_parity_harness.py tests/test_charts_layout_service.py -q` | **164 passed** | 0 |
| 4 | `PYTHONDONTWRITEBYTECODE=1 python -m pytest tests/test_signature_*.py tests/test_confluence.py -q` | **186 passed** | 0 |

⚠️ **THE PLAN'S PREDICTION FOR COMMAND 1 WAS "~5,493 / 5,494, one known
master-side flake". Measured: 5,494 / 5,494, exit 0 — every test passed.** The
named flake is §11, and it did not reproduce in this run. All four plan-header
numbers for commands 2–4 were confirmed exactly.

### 10.1 After Task 1

Task 1 adds three cases to `enumerationSites.test.js` — the Python discovery scan,
the two-Python-`C`-rows sizing case, and `stripPyComments`' own code-not-prose rail
— and touches no shipped source, on either lane.

| # | command | after Task 1 | delta |
|---|---|---|---|
| 1 | `cd app && npx vitest run` | **5,497 tests / 499 files**, exit 0 | **+3**, all three new, all three in the ledger suite |
| 2 | indicator pytest | **150 passed**, exit 0 | 0 — no Python source touched |
| 3 | chart pytest | **164 passed**, exit 0 | 0 — no Python source touched |
| 4 | signature pytest | **186 passed**, exit 0 | 0 — no Python source touched |

`cd app && npx vitest run src/components/chart/engine/__tests__/enumerationSites.test.js`
alone: **33 → 36**, exit 0. Test-file count unchanged at 499: no new file, because
the ledger has exactly ONE writer per phase and the Python half belongs beside the
JS half or it is a second ledger.

### 10.1.1 The third case exists because a mutation fixture failed first

The stripper rail was not planned. The gauntlet's **M2b** — *prepend a four-id `#`
comment to a Python module, and watch the identity stripper make the scan flag it*
— **SURVIVED** on its first run, and not because the stripper is unnecessary: the
fixture read `# … rsi macd bb vwap …`, and `namesIndicators` matches a **quoted**
id, an `id:` key or an `id?.` read, **never a bare word**. The fixture named ZERO
ids raw, so it proved nothing in either direction and would have been reported as
"the stripper is not load-bearing".

It was caught only because the protocol demands the negative fixture trip the RAW
scan first. Corrected to `# … rsi: 14, macd: 26, bb: 20, vwap: session …`, M2b
KILLS. **That control is now a permanent test** rather than a one-off mutation:
*"⭐ the PYTHON scan reads CODE, not prose — and still reads code"*, which carries
the raw-side control the fixture lacked, plus a `#`-inside-a-string case, a
quote-inside-a-`#`-comment case, and a CRLF line-structure case.

### 10.1.2 Mutation results

Nine cases. **CONTROL A** = the unmutated ledger suite, ANSI-stripped, aborting on
a zero/unparseable passed count: `rc=0 passed=36`. **CONTROL B** = each mutation's
own `-t` filter on the unmutated tree, aborting on `passed=None` or `0`: every case
`rc=0 passed=1`. Verdicts from the **exit code**. Restore is byte-level with a
sha256 check (`git checkout -- <file>` does not restore bytes under
`core.autocrlf`), re-verified green at 36 afterwards.

| id | mutation | verdict | why |
|---|---|---|---|
| M1 | append a four-id dict to `indicator_alert_service.py` | **KILLED** | *a PYTHON module hand-lists four or more indicators and is not on the ledger* — a **born** Python site is refused |
| M2 | `stripPyComments` → identity, alone | **SURVIVED — by design** | all three files clear the four-id floor on CODE alone today, so the found-set does not move. Reported as the designed survivor, not a gap |
| M2b-control | four-id `#` comment, **real** stripper | **SURVIVED — required** | the comment must NOT flag the file; otherwise M2b's red proves nothing about the stripper |
| M2b | the same comment **+** identity stripper | **KILLED** | the same unledgered-site message — this is the kill M2 alone cannot make |
| M3 | `keepPython` floor → `[]` | **KILLED** | *the Python scan has no surviving subject to be measured against* — a control that stops looking rots GREEN |
| M4-histogram | swap `_INDICATOR_ALIASES`(C) ↔ `INDICATOR_CHORDS`(keep) | **SURVIVED — the measured blind spot** | total and every bucket preserved, so the histogram passes. This is B5's finding, re-measured on a 7-row ledger |
| M4-mapping | the SAME swap | **KILLED** | *a site is fated to a phase it did not have* — only the sorted-pair literal refuses a permutation |
| M4b | re-fate `indicator_compute.py` `keep` → `C` | **KILLED** | the Python floor collapses to `[]` — proof the new row's fate is load-bearing, not editorial |
| M5 | identity stripper vs the stripper's OWN rail | **KILLED** | *a `#` comment or a docstring still reads as an enumeration* — M2's survival is about the found-set, not about the stripper being untested |

### 10.2 Zero rendered change, asserted rather than screenshotted

Task 1 touches **no render path**: two files under `app/src/**/__tests__/` (which
Vite never bundles and which the discovery scan itself skips), one decision record,
and one new decision record. There is no shipped-source diff for the pixel gate to
measure, so running `tools/chart_parity.py` would produce a 0 that means "nothing
was compared", not "nothing changed" — a green that asserts nothing, which is this
programme's most-repeated defect. **The assertion is the diff:** every path in
Task 1's commits is `app/src/components/chart/engine/__tests__/*` or `docs/**`.

The measured non-change that IS a real claim is in the suite: the **JS** discovery
scan's found-set is pinned to the three files it saw before this task
(`instances.js`, `nativeRegistry.js`, `keyboardShortcuts.js`), so adding the Python
half cannot have moved what the JS half sees.

### 10.3 Two prose corrections, and one that had nothing to correct

1. 🔴 **"25 addresses in 14 groups" → 28 in 14.** MEASURED:
   `len(INDICATOR_FUNCS) == 28` (8 legacy + 6 same-base + 14 new-base), 14 catalog
   groups. The two prose sites that carried 25 are both in the **gitignored** B5
   SDD ledger (`progress.md` §ADDRESSING and `alerts-gap-report.md`); they are
   corrected there, and the durable correction is an **assertion** in
   `enumerationSites.test.js` → *"⭐ the two Python C rows are the size the ledger
   says — 28 addresses, and NO `sar` alias"*, which parses the dict literal out of
   comment-stripped Python and refuses 25.
   ⚠️ **The plan named a THIRD site that does not have the defect**: "the
   evaluator's own B5 comment block" also says 25. It does not.
   `indicator_alert_evaluator.py` carries **no address count in prose at all** —
   its only `25` is ADX's conventional guide level in `_DEFAULT_THRESHOLDS`.
   Recorded rather than dropped, because a correction applied to a site that never
   had the defect is indistinguishable from a correction that was skipped.
2. 🔴 **The ledger claimed `_INDICATOR_ALIASES` contains `"parabolic sar" → sar`.
   It does not, and never did.** MEASURED: **eleven** phrases resolving to **seven**
   targets — `vwap`, `avwap`, `ma50`, `ma200`, `bb`, `macd`, `rsi`. Two of those
   seven are not registry ids at all, and `sar` — the one the comment invented — is
   the single id the evaluator **deliberately refuses to offer**
   (`_SAR_IS_NOT_OFFERED`, with `test_sar_is_deliberately_not_offered_and_says_why`
   holding it). The invented example pointed at the one place in the codebase where
   naming `sar` is a decision somebody wrote a paragraph about. A ledger whose whole
   job is stopping a comment from outliving its subject cannot carry a fabricated
   example of its own; the corrected sentence is now **failable** by the case named
   above.
3. ⚠️ **Found while auditing, NOT corrected here, and named so it is not lost.**
   `docs/superpowers/specs/2026-07-31-indicator-platform-design.md` (the
   `VWAP_SESSION_ANCHOR` decision row) argues its blast radius from *"`vwap` is not
   in `INDICATOR_FUNCS` (8 keys) so a VWAP alert can be created but can never
   fire"*. That was true when the decision was taken and is **false now** — B5 put
   `vwap` in the dict and it is one of the 28. The row is a dated record of a
   decision already applied, so rewriting its reasoning would falsify the record;
   what it needs is a dated addendum, and that belongs to whichever Phase C task
   next moves the VWAP lane, not to a baseline task.

## 11. Known-red on the inherited tree

**`app/src/pages/calendar/Calendar.realModal.test.jsx` — inherited, not ours.**

⚠️ **THE PLAN GOT BOTH HALVES OF THIS BACKWARDS, MEASURED AT `bb089bf2`:**

| | plan says | measured |
|---|---|---|
| path | `app/src/pages/Calendar.realModal.test.jsx` | `app/src/pages/**calendar/**Calendar.realModal.test.jsx` — the plan's path resolves to **no test file at all**, and vitest exits 1 with "No test files found", which reads exactly like a failure |
| standalone | "passes 6/6" | **1 failed / 5 passed, 2 unhandled errors, exit 1** |
| full suite | "red under full-suite load" | **green** — the 5,494-test run in §10 has zero failures |

The failing case is *"a slow real enrichment-batch fetch still lands in the modal
once it resolves"*; the two unhandled errors are
`TypeError: Cannot set properties of null (setting 'dpr')` and
`TypeError: Cannot read properties of null (reading 'clearRect')` — a canvas teardown
race, which is why load changes the answer.

**So it is genuinely load-dependent, in the direction opposite to the one recorded,
and Task 1 changed nothing that touches it** (Task 1's whole diff is
`app/src/components/chart/engine/__tests__/**` plus `docs/**`).

⛔ **The rule for later tasks:** this file being red is **NOT a regression**, in
either mode. Before reporting it as one, run it BOTH ways — standalone and in the
full suite — and say which. A single-mode observation of this file has already
produced a wrong conclusion once, in the plan header.
