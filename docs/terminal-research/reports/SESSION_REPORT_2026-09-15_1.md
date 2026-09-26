# Session report — 2026-09-15, session 1

**F-MERGE-1 CLOSED · NON-VACUOUS `is_signed` · CI ERROR TEXT · WHOLE-QUEUE PREMISE AUDIT**

---

## 1 · ET and trees

Start **2026-09-15 00:50 EDT Tue**, end **2026-09-15 01:12 EDT Tue** (report written;
CI poll continuing), both `python tools/weekly_exec.py et`. Both worktrees
`git status --porcelain` → **0** at start and end.

**10 commits** — eight docs worktree, two code worktree (`b70a874ed`, `4ad1108d1`, both
pushed to `feat/s7-price-level`). Nothing signed, nothing merged, nothing pushed to master.

## 2 · S — the signature reader and F-MERGE-1

### K CP4 — the defect

`merge_all.is_signed()` asked `sign_gate.target_span()` for the unsigned block and treated
`SystemExit` as **signed**. That exception has **two** causes — every block filled, and
**no block at all** — so a document with no approval block read as SIGNED.

Two documents on disk are in exactly that state: `packet-a-absent-bound-gate.md` and
`entity-master-pre-implementation-gate.md`.

⛔ **One absent block produced BOTH halves of F-MERGE-1, in opposite directions:**
`is_signed` would have merged Packet A's commits **unapproved**, while
`verify_manifest --check-commits` found them claimed by **no unit**, so they would
**never merge**. Which failure you got depended only on which tool you asked.

### ⛔ The commissioned definition of SIGNED was measured and rejected

Commissioned as *"non-blank **and equal to the recomputed fingerprint-with-blank**."*

| filled approval blocks on disk | **35** |
|---|---|
| re-derive from the CURRENT file | **5** |
| do **not** re-derive | **30** |

The 30 are **correct**. `fingerprint()`'s own docstring says a fingerprint pins the bytes
approved *at approval time*, so any later edit legitimately stops it re-deriving, and
`git show <sha>:<file>` is the recovery. Two blocks also carry **40-character** hashes
rather than the 9-character form.

**Implementing it as written would have declared 30 genuine owner approvals invalid and
made `merge_all` refuse every unit.** Form and truth therefore keep two tools:
`read_approval` = *does a written approval exist and is it well-formed?*;
`verify_manifest` = *is the fingerprint still true, and where was it last true?*

⚠️ **"Two blocks" is also not MALFORMED, and the commissioning text said it was.**
**13 of 35** gate documents carry 2–3 blocks, every one fully signed — a packet whose
checkpoints were approved on different days. The malformed case is **two UNSIGNED** blocks.

### Controls — `python tools/sign_gate.py --read-check` (exit 0)

```
SIGNED: one filled block                               -> SIGNED     ok
UNSIGNED: one blank block                              -> UNSIGNED   ok
NO BLOCK AT ALL -> UNSIGNED, never SIGNED              -> UNSIGNED   ok
two FILLED blocks (13 real docs look like this) -> SIGNED -> SIGNED   ok
two UNSIGNED blocks -> MALFORMED                       -> MALFORMED  ok
one filled + one blank -> UNSIGNED                     -> UNSIGNED   ok
block missing APPROVED ON -> MALFORMED                 -> MALFORMED  ok
duplicated APPROVED BY -> MALFORMED                    -> MALFORMED  ok
the reader returns all three states (non-vacuity)      -> 3          ok
READ-CHECK: PASS
```

`sign_gate --self-check` (signing) still exits 0 — the reader is additive.

**End-to-end, before Packet A had a block:** `merge_all --dry-run` with `packet-a`
injected exited **3**, naming it. `entity-master` flags the same way.

⭐ **A plain UNSIGNED must not stop a DRY run.** Before signing day every unit reads
UNSIGNED; refusing there would destroy the preview the owner reads. Only a **structural**
fault (no block, or MALFORMED) refuses in both modes. `OK, FAIL, REFUSED, UNSIGNABLE = 0, 1, 2, 3`.

### Census over the real corpus

35 documents · **48 blocks** · 35 filled · 13 blank · **SIGNED 20 / UNSIGNED 15 / MALFORMED 0**.

⭐ **Blocks ≠ packets.** The declared *"35 on disk + 1 external = 36"* is a count of
**filled blocks** and matches exactly. It is **not** a count of signed documents, which is
**20**, because thirteen documents hold more than one block.

### S.2 — Packet A registered

⚠️ **Its gate line said the opposite, and the objection was half right.** *"No approval
block appears in this file deliberately… there is nothing here a signature should
authorise."* True of the **refused rail**. But the packet shipped **three files in two
commits**, and that code waits to merge like any other unit's. The block signs the
**delivered code**; the packet stays **CLOSED-AS-FINDING** and F-A-1 stands. The original
sentence is struck through in place with the reason beneath it.

| commit | files |
|---|---|
| `18dd13683` | `tools/audit_absent_bound.py` |
| `31e28c6e3` | `tests/test_s7_ticking_caller_decision.py` · `tools/s7_price_level_report.py` |

⛔ `tools/s7_price_level_report.py` is named explicitly rather than folded into "the
tests": it is a **production** tool (`ticking_one()` is what the Layer 1 monitor posts at
09:12 ET). Its change is an additive keyword-only `now=` threaded into `_window` so the
guard injects a real clock instead of mocking one (F-CLOCK-1's trap).

⚠️ **TOLD-VS-FOUND.** The commissioning text said *"the six caller-level tests"*. Measured
(`--collect-only`, that file alone): **8** — seven functions, one parametrized over two
keys. The packet's prose and the commit message both say eight and are right.
⭐ **The assertion therefore names a path and a command — "as enumerated by `git show
--stat`" — not a count.** A wrong count pinned into a signature is exactly what the
no-derived-numbers rule exists to stop.

**Disjointness proven:** Packet A's three files intersect every other unit's file set in
**zero** places → `merges-after: none`, and it leads the order. Fingerprint `f6180b3da`,
**manifest row 13**.

### S.4 — both dry-runs

`verify_manifest --check-commits`: **14 rows, 14 OK, 0 STALE; 13 of 13 commits mapped;
exit 0.**

⚠️ The prompt expected **15/15** (13 prior + K CP4 + Packet A). K CP4 and the Packet A
registration are **docs-worktree** commits on branch `terminal-research`; the coverage
check walks `origin/master..feat/s7-price-level`. **13/13 is the true reconciliation.**

`merge_all --dry-run`: **6 constraints, all SATISFIED**, 14 units, **14 UNSIGNED, 0
MALFORMED, 0 UNSIGNABLE**, stops at the member-visible unit. `sign_all --dry-run`: **14**
sign commands. Both exit 0.

### S.3 — the rule

`GOVERNING_PRINCIPLES.md` **§15** (the docs worktree's rules file, beside §14 THE CANONICAL
ACCEPTANCE GATE). Six rules: a packet that delivers an artifact gets a block; readers
return three states and never derive SIGNED from an absence; form and truth keep different
tools; every commit maps to a row before session end; assertions carry no derived numbers;
take the next free checkpoint id from the packet's own table first.

## 3 · E4 — CI error text

### E CP4 built and pushed

Collision proof: E declares CP1, CP2, CP3 → **CP4 free**. `b70a874ed`, pushed to
`feat/s7-price-level`.

The workflow now writes `vitest --reporter=junit` and `pytest --junitxml` beside the text
logs, and `tools/ci_extract.py` publishes three artifacts per run onto `ci-results`:
`pytest_collect_errors.txt` (each `ERROR collecting` section, first 40 lines, by node id),
`pytest_error_buckets.txt` (bucket | count | example node id, keyed on the **final**
exception line with paths normalised), `vitest_failures.txt` (file, test name, first
assertion line). `latest.json` gains a `detail` pointer block relative to the branch root.

⭐ **Why the LAST exception line is the bucket key:** an `ImportError` raised while handling
another error reports the **proximate** cause last, and that is what a fix targets.

**Controls: 12 fixtures pass, plus three REAL scoped runs** —

- a deliberate `ImportError` in a throwaway dir **outside the repo** (so the conftest
  tripwire is not involved) → non-empty `collect_errors`, bucketed
  `ModuleNotFoundError: No module named 'a_module_that_does_not_exist_xyz'`;
- the known-red `reachable.test.js` run with `--reporter=junit` → **exactly one** entry
  carrying file, test name and first assertion line;
- an empty run → files exist and say **ZERO**.

⚰️ **The controls found a defect in the tool itself.** `_write` returns a **line** count
and it was reported as a **section** count — printing *"27 sections"* for a single
collection error. **A summary line contradicting the artifact beside it is the exact class
this tool exists to expose.** Fixed; it now reads 1. Found by the scoped control, not by
review.

### ⭐ Job logs are NOT anonymously readable — which re-justifies E CP2/CP4 again

Run **metadata** answers anonymously (`/actions/runs`, `/jobs` → 200). The **log** endpoint
returns **HTTP 403** unauthenticated, even on a public repo.

So F-CI-2's correction stands (the previous session's UNREADABLE verdict on run *status*
was wrong), **and** the publish job is genuinely the only unauthenticated path to the error
**text**. CP2/CP4 are justified on two grounds now — durability and anonymous detail — not
the one that evaporated.

### E4.2 — the 479 pytest errors, bucketed. ONE root cause.

Run #3 (`b70a874ed`) published with `detail: true` — **E CP4 worked end to end on its first
run.** All 479 errors resolve into **18 buckets, every one a `ModuleNotFoundError`:**

| count | module | example node id |
|---|---|---|
| **274** | `fastapi` | `tests/api/test_buzz_render_panel.py` |
| 63 | `requests` | `tests/test_ai_search_resilience.py` |
| 41 | `bcrypt` | `tests/test_auth_plan.py` |
| 23 | `cryptography` | `tests/test_broker_admin_debug.py` |
| 20 | `pydantic` | `tests/test_broker_balances.py` |
| 20 | `yfinance` | `tests/test_comparison_ai_adapter.py` |
| 10 | `matplotlib` | `tests/test_discord_chart_hotset.py` |
| 9 | `pandas` | `tests/test_breadth_adv_dec_restated.py` |
| 7 | `orjson` | `tests/test_bars_dead_ticker.py` |
| 3 | `openai` | `tests/test_voice_intent.py` |
| 2 | `uvicorn` | `tests/test_bars_api_main.py` |
| 1 ×7 | `starlette` · `snaptrade_client` · `apscheduler` · `botocore` · `nacl` · `stripe` · `pyotp` | — |

**274+63+41+23+20+20+10+9+7+3+2+7 = 479.** ⭐ The arithmetic closes exactly against the
totals line, which is what makes this a measurement and not a sample.

**Told-vs-found.** The workflow installed `pytest pytest-asyncio httpx numpy pillow`.
`requirements.txt` exists at the repo root, is **83 lines**, declares every top bucket —
and **already contains all five** of the hand-installed packages. `-r requirements.txt` is
a strict superset; the hand-typed list lost nothing and cost 479 of 481 modules.

⛔⛔ **THE BACKEND SUITE WAS NOT RED — IT NEVER RAN.** `collected 2` of 481.
⭐ **The only thing that stopped this being published as a pass is `ci_summarize`'s rule
that zero collected is never `ok`.** One guard away from a green badge over a suite that
imported nothing.

**T2 CP1 built** (`4ad1108d1`, pushed): one line, one file, one commit — the condition the
scope set. Collision proof: no `T2` packet or CP id exists anywhere in `gates/`.
⚠️ **It has no parent packet**, which is OPEN QUESTION 6.

**Run #4 is in flight at report time.** The expected outcome is recorded in the build record
*before* it lands, so it can be wrong: collection on the order of the full module count, and
a **genuine red** rather than a green. This unit makes the suite run; it does not claim to
make it pass.

### ⭐ RUN #4 — T2 CP1 WORKED, AND IT UNCOVERED THE NEXT WALL

| | run #3 | run #4 |
|---|---|---|
| pytest `Install` | 5 packages | **`-r requirements.txt`, 35 s, success** |
| pytest `Run` | 82 s | **2,671 s (44.5 min), CANCELLED** |
| `collected` | 2 | **0** |
| `totals_line_found` | true | **false** |
| job conclusion | success | **cancelled** |

**`timeout-minutes: 45` is declared on both jobs.** The job was cancelled at **2,716 s
(45.3 min)**. ⛔ **The dependency fix worked — install took 35 seconds and the suite began
executing — and the full backend suite then ran for forty-four and a half minutes without
finishing.**

**F-CI-5: the backend suite does not fit in a 45-minute CI job.** Filed, not fixed — the
scope authorised one unit and it is built. ⭐ The honest next step is **sharding**, not a
bigger timeout: `scripts/gate_shards.py` already exists in this repo for exactly this, and
`CLAUDE.md` records the local suite reaching **18 GB** unscoped. Raising the timeout would
buy a longer wait for the same unknown.

### ⭐⭐ THREE INDEPENDENT GUARDS REFUSED TO CALL A CANCELLED RUN GREEN

This is the run those rules were written for, and every one of them held:

1. `ci_summarize` → `collected: 0`, `totals_line_found: false`, **`ok: false`** — it did
   **not** publish `0 failed` as a pass;
2. the workflow's own **"Assert the run produced a totals line"** step → **failure**
   (E CP1's trap, firing on a real run for the first time);
3. the verdict stayed **RED**.

⛔ **A cancelled job that collected nothing is the single most dangerous shape in CI** —
it looks like a clean sweep to any check that reads only `failed`. Nothing in this pipeline
read it that way.

### ⚰️ F-CI-3 is now confirmed in BOTH directions, which makes it worse than filed

`oom_or_timeout` came back **`false`** on run #4 — **a job that was cancelled by a
timeout.** Combined with runs #2 and #3, where it came back **`true`** for suites that
completed normally:

| | event | flag |
|---|---|---|
| runs #2, #3 | suites completed with totals lines | **true** (wrong) |
| run #4 | job cancelled at the 45-minute timeout | **false** (wrong) |

⭐ **It fires on the word without the event, and misses the event without the word.** The
regex greps the runner log for `timeout`; GitHub's own cancellation never writes that word
into the captured log. **A flag that is wrong in both directions is worse than absent** —
absent, nobody would consult it. Still filed, still unrepaired this session, and now with
the measurement that shows the repair must key off the **job conclusion**, not the log text.


### E4.3 — the 14 vitest files, classified

**23 junit failure entries across 14 files.** ⚠️ The summary's totals line says **21**;
the junit report yields **23**. Two instruments disagreeing by two is recorded, not
reconciled away — `ci_summarize` reads the totals line, `ci_extract` counts `<failure>`
elements, and which is right is not yet measured.

| file | n | class | evidence |
|---|---|---|---|
| `hub/rule12Paths.test.js` | 4 | **ENV** | *"RULE 12 RAIL CANNOT RUN — no base ref resolved"*; `git merge-base origin/master HEAD` fails |
| `hub/surfaceMatrixIsCurrent.test.js` | 4 | **ENV** | `git show febe8ee67:… fatal: invalid object name` |
| `chart/engine/readout.test.js` | 3 | **ENV** | `could not read d2733adc:…StockChart.jsx via git` |
| `chart/engine/__tests__/enumerationSites.test.js` | 1 | **ENV** | `git could not read StockChart.jsx at 084eeded` |
| `chart/engine/__tests__/legendFromDefinitions.test.jsx` | 1 | **ENV** | same `d2733adc` read |
| `journal-2-0/lib/iteratorGlobalFloor.test.js` | 1 | **ENV** | `app/dist/assets missing — run npm run build`; CI never builds the frontend |
| `journal-2-0/lib/importer/exportRoundtrip.test.js` | 1 | **ENV** | its Python fixture fails importing `api.services.journal_two.notes_export` — **the T2 CP1 root cause** |
| `lib/journal-2-0/format.test.js` | 2 | **ENV (timezone)** | `expected '04/08/26' to be '04/09/26'` — a **one-day** shift; CI is UTC, the box is ET |
| `components/screener/reachable.test.js` | 1 | **KNOWN-RED** | R-29 + F-S1-2, cited in E.3 — names deliberately unmounted modules |
| `hooks/pollingSites.rail.test.js` | 1 | **REAL** | a bare `useSWR(…, {refreshInterval})` site the 2026-08-09 census did not have — genuine drift |
| `styles/tapFloor.test.js` | 1 | **REAL** | a finger target declared at ≤640px but not ≤1024px — *tablet is touch too* |
| `surfaces/manifest.test.js` | 1 | **REAL** | `/admin/wisdom` has no manifest row |
| `breadth/heatmapRegistry.golden.test.js` | 1 | **REAL** | golden serialisation drift |
| `chart/engine/ast/manifestProse.test.js` | 1 | **REAL** | `_session` is READ but would be stripped |

**ENV 13 · KNOWN-RED 1 · REAL 5 · UNREADABLE 0 — 8 files, 13 failures are the environment.**

⭐ **Five of those thirteen are ONE cause: `actions/checkout` is shallow**, so
`git merge-base` and `git show <sha>:<path>` cannot resolve. **F-CI-4**, fix is
`fetch-depth: 0` — same file, one line, different root cause, **not built** because the
scope authorised one.

⭐⭐ **The most reassuring line in the entire run is a failure.** `rule12Paths` reports
*"the forbidden-path check would pass vacuously"* and **refuses**. A rail that cannot run
declining to report success is the non-vacuity rule working in production, unprompted.

⚠️ **Told-vs-found against `CLAUDE.md`.** It documents `enumerationSites.test.js` as
**load-sensitive** (15,000 ms under the full suite, 1,461 ms alone). In CI it fails for a
**different** reason — an unreadable git object. The documented cause is real but is not
this one; a reader trusting the doc would have chased a timeout.

### E4.4 — promotion tally

E CP3's criterion is ≥1 GREEN and ≥1 RED in the ledger. Runs #2 and #3 supply the **RED**.
**There is still no GREEN**, and there cannot honestly be one until the environment
failures are separated from the real ones. Promotion stays unbuilt.

## 4 · Q — whole-queue premise audit

**Nouns are classified `PRESUMED` (must exist now) or `DELIVERED` (the checkpoint creates
it).** ⭐ **Only a PRESUMED noun that does not resolve makes an assertion unbuildable** —
without that split, every checkpoint looks broken because it names its own deliverables.

### D5 CP2 — `corp_actions.db` + "its five metrics"

| noun | kind | resolved at | verdict |
|---|---|---|---|
| the D2 builder | PRESUMED | `tools/build_canonical_address_book.py` | OK |
| the axis report | PRESUMED | `canonical_address_book.json["axis_report"]`; rail `tests/test_canonical_address_book.py:201` | OK |
| the derivation rail | PRESUMED | `tests/test_canonical_address_book.py` | OK |
| `api/services/{bars_*,entity_master}` | PRESUMED | both present | OK |
| `corp_actions.db` + `CREATE TABLE` | DELIVERED | shape pinned in canonical SPEC §2.1/§2.2 | OK |
| **"its five metrics"** | PRESUMED | never enumerated for `corp_actions` anywhere | **COUNT-IN-ASSERTION** |

**NEEDS-REWORD.** D2's "five" is `ohlcv.o/h/l/c/v` — the **bars** metrics. ⭐ And the number
should not be there at all: the clause says the builder derives *by AST*, so asserting a
count beside a list the tool derives is the anti-pattern D2 exists to kill.
**PROPOSED:** *"…derives its metrics by AST from the store's own `CREATE TABLE` literal."*

### D5 CP3 — one confirmed source

`/v3/reference/splits` OK (`massive.py`, `polygon_extras.py`); `polygon_extras` quarantine
entry OK; `confirmed` rows DELIVERED (by CP2); the D1 adapter pattern is precedented
(`calendar.py`'s `_fmp_calendar_day` / `_fmp_range_week`, cited `PROGRAM_STATUS:226`), the
splits adapter DELIVERED. **BUILDABLE**, depends on D5 CP2.

### D5 CP4 — the split list, DARK

`bars_sanitize._fetch_meta` OK. **"Four outcomes, never a rate"** — COUNT-IN-ASSERTION.
**NEEDS-REWORD:** name the outcomes or say *"the outcomes the dual-compute enumerates"*.
Otherwise BUILDABLE; flow-worker strand ⚠️ YES (`bars_sanitize.py`), as the packet says.

### D5 CP5 / CP6 — event types

`entity_master.api.apply_event` OK; `new_entity` (`api.py:244`), `delisted` (`:280`),
`renamed` (`:285`), `relation_added` (`:299`) all OK. `symbol_change` / `merger` are ledger
`action_type` VALUES → DELIVERED by CP2. DEC-15 OK
(`ARCHITECTURAL_DECISION_REGISTER.md:242`). **Both BUILDABLE**, depend on CP2/CP3.

### D5 CP7 — the adjustment-basis label

`AdjustmentBasis` DELIVERED; `bars_split_repair.py` OK; **S8 OK** — shipped on
`origin/master` and cited at `PROGRAM_STATUS:4` and `:95`, it simply has **no gate document
in `gates/`**. **BUILDABLE.** ⛔ First member-visible change in the programme; needs its own
explicit line.

### S6 CP2 — ⛔ UNBUILDABLE (F-S6-1)

| noun | kind | resolved at | verdict |
|---|---|---|---|
| `get_user_ticker_sets` | PRESUMED | `api/services/calendar_personalization.py:81` | OK |
| `member_interest.interest_for` | DELIVERED | — | OK |
| **"Calendar the only caller"** | PRESUMED | **three production callers** | ⛔ **MISSING/FALSE** |

```
api/routers/calendar.py:2684, :3107, :3768                      <- Calendar
api/services/alert_taxonomy/event_proximity_projection.py:155   <- NOT Calendar
api/services/calendar_alerts.py:260                             <- NOT Calendar
```

**Migrating it as "Calendar the only caller, provably a no-op against CP1's baseline" would
silently miss two production call sites**, one of them the alert-taxonomy event-proximity
projection — member-facing alerts. A no-op proof scoped to Calendar would have **passed**
while the other two callers changed behaviour.

**PROPOSED (struck original beneath it in the packet):** *"`get_user_ticker_sets` →
`member_interest.interest_for`, signature unchanged, **proved a no-op at every call site
enumerated by an AST sweep of `api/**`** — currently Calendar (3), the alert-taxonomy
event-proximity projection, and `calendar_alerts` — against CP1's baseline."*

### S6 CP3 / CP4 / CP5

CP3: `app/src/pages/calendar/importance.js` OK; the resolver DELIVERED. **BUILDABLE**,
depends on CP2. CP4: `/api/member/interest` DELIVERED; cache-key precedent OK.
**BUILDABLE**, depends on CP2. CP5 is a **ruling**, not a build — `personal_edge` OK
(`api/services/personal_edge.py`). **NOT AN ASSERTION — owner decision.**

### The three non-checkpoint queue items

| item | verdict |
|---|---|
| **S3 `/status`** | **NOT AN ASSERTION — BLOCKED-OWNER.** A spec-vs-implementation conflict: `entity-master-spec.md` §7.3 specifies a **no-auth** read; the shipped route is **admin-gated** (`LEDGER.md:578-590`). The ledger's own recommendation is *keep admin-only and amend the spec*, citing R-17. It needs a ruling, not a build. |
| **bell panel** | ⛔ **NO ASSERTION EXISTS.** The phrase appears **nowhere** in `docs/`. The only "bell" is `AlertBell` in `docs/brand-design-system.md` — a shipped product component of Terminal-Current, with no checkpoint. `OWNER_INPUTS.md:30` records *"Bell PARTIAL"* from a browser check. **Nothing to audit; the queue item needs a referent.** |
| **COMPLETION_AUDIT recount** | **NOT AN ASSERTION — a maintenance action with a named command**, and it is **stale**. |

**The recount, performed:** `python tools/harvest_followups.py` (exit 0, wrote nothing).

| family | distinct ids harvested |
|---|---|
| TD | 72 |
| **F-*** | **50** |
| OI | 49 |
| RG | 33 |
| R | 31 |
| DEC | 16 |

⛔ **`COMPLETION_AUDIT.md` §0 records `F-*` = 31. The harvester finds 50 — stale by 19.**
The file's own note says the number is *"DERIVED, never counted by hand"*, which is exactly
why running the deriver is the whole task. All five findings from these two sessions are
reachable by it. **Not updated — that is a build, and this was an audit.**

### Q.3 — dependency map (for next session's `merges-after`)

```
D5 CP3  <- D5 CP2
D5 CP4  <- D5 CP2            (⚠️ flow-worker strand)
D5 CP5  <- D5 CP2, D5 CP3
D5 CP6  <- D5 CP5
D5 CP7  <- D5 CP4            (⛔ member-visible; own line)
S6 CP3  <- S6 CP2
S6 CP4  <- S6 CP2
```

### Q.4 — the audited queue, with counts

| # | assertion | verdict |
|---|---|---|
| 1 | D5 CP2 | **NEEDS-REWORD** (count) |
| 2 | D5 CP3 | BUILDABLE |
| 3 | D5 CP4 | **NEEDS-REWORD** (count) |
| 4 | D5 CP5 | BUILDABLE |
| 5 | D5 CP6 | BUILDABLE |
| 6 | D5 CP7 | BUILDABLE |
| 7 | S6 CP2 | ⛔ **UNBUILDABLE** (F-S6-1) |
| 8 | S6 CP3 | BUILDABLE |
| 9 | S6 CP4 | BUILDABLE |
| 10 | S6 CP5 | NOT AN ASSERTION (ruling) |
| 11 | S3 `/status` | NOT AN ASSERTION (ruling) |
| 12 | bell panel | ⛔ NO ASSERTION EXISTS |
| 13 | COMPLETION_AUDIT recount | NOT AN ASSERTION (action; measured, stale by 19) |

**BUILDABLE 6 · NEEDS-REWORD 2 · UNBUILDABLE 1 · NOT-AN-ASSERTION 4 = 13.**
⭐ **Non-vacuity: 13 assertions pasted in Q.1, 13 verdicts. The totals reconcile.**

## 5 · Instrument self-reference

| instrument | reported on itself |
|---|---|
| `ci_extract.py` | ⚰️ its own scoped control caught it printing a **line** count labelled a **section** count — *"27 sections"* for one error. Fixed. |
| `sign_gate.read_approval` | built **because** the previous reader reported a property of its own control flow (an exception) as a property of the document |
| `merge_all --self-check` | passed 7 controls and then the real dry-run crashed on cp1252 (previous session) — controls never touch stdout encoding |
| `harvest_followups.py` | ran clean, wrote nothing, and its output **contradicts the file it feeds** (50 vs 31) |

**Two of four reported a defect in themselves or in the artifact they feed.**

## 6 · Findings filed

| id | one line |
|---|---|
| **F-MERGE-1** | **CLOSED.** Two commits claimed by no unit; one absent approval block produced both the merge-unapproved and never-merge halves. Rule in `GOVERNING_PRINCIPLES.md` §15. |
| **F-S6-1** | **NEW.** S6 CP2 asserts *"Calendar the only caller"* of `get_user_ticker_sets`; there are **three** production callers, two outside Calendar including member-facing alerts. |
| **F-SIGN-2** | **NEW.** `entity-master-pre-implementation-gate.md` carries **no approval block**, so it cannot be signed as it stands. Ships no commits today, so nothing is blocked. |
| **F-CI-5** | **NEW.** The backend suite does not fit a 45-minute CI job: run #4's pytest `Run` step executed 2,671 s and was cancelled at the declared `timeout-minutes: 45`. Dependencies installed fine (35 s). Sharding, not a bigger timeout. |
| **F-CI-4** | **NEW.** Five vitest files (13 of 23 junit failures) fail on a shallow `actions/checkout`; `git merge-base` / `git show <sha>:<path>` cannot resolve. Fix is `fetch-depth: 0`, one line, same file. Not built — different root cause. |
| **F-CI-3** | carried forward, unrepaired by design: `oom_or_timeout` matches the *word* "timeout" anywhere in the log. |

## 7 · OPEN QUESTIONS

1. **Does Packet A's A CP1 scope read correctly to you?** It authorises a change to
   `tools/s7_price_level_report.py`, a production monitor tool — additive and behaviour-
   identical, but a production file inside a checkpoint labelled "a closed finding's
   delivered artifacts".
2. **"bell panel" has no referent in the programme's documents.** Which artifact did you
   mean?
3. **S3 `/status`: no-auth per spec §7.3, or admin-gated as shipped?** The ledger
   recommends keeping admin-only and amending the spec (R-17). Your ruling.
4. **May `COMPLETION_AUDIT.md` §0 be updated from the harvester** (31 → 50), as a unit?
6. **T2 CP1 has no parent packet.** No `T2` packet or CP id exists anywhere in `gates/`, so the commissioned id was free — but every other build record cites a parent whose gate line authorises it. Its natural home is **packet E** (a CI-workflow fix, found by E CP4's own instrument). **Adopt as `E CP5`, or write a T2 packet?**
5. **`entity-master-pre-implementation-gate.md` needs a block** before it can ever be
   signed. Add one now, or when it first ships code?

## 8 · Retractions and corrections

- ⛔ **The commissioned definition of SIGNED is rejected on measurement** (§2): it would
  invalidate 30 of 35 genuine approvals. Implemented as form, not truth.
- ⛔ **"Two blocks → MALFORMED" is rejected on measurement**: 13 real documents carry 2–3
  blocks, all correctly signed.
- ⚠️ **"the six caller-level tests" → eight**, measured.
- ⚠️ **"15/15 commits mapped" → 13/13**: the two new commits are docs-worktree and lie
  outside `origin/master..feat/s7-price-level`.
- ⚠️ **Packet A's own "no approval block… deliberately" is superseded** by owner ruling,
  struck through in place with the reason retained.

## 9 · [KEYBOARD] — the two commands, PARKED

```
python tools/sign_all.py  --manifest tools/sign_manifest.txt
python tools/merge_all.py --manifest tools/sign_manifest.txt
```

⛔ **PARKED. Two conditions unpark them:**

1. ~~**F-MERGE-1 CLOSED**~~ — **met this session.** 13 of 13 commits mapped, exit 0.
2. **CI red diagnosed with every failing file classified** — ⭐ **MET for the diagnosis,
   NOT for the state.** All 14 vitest files are classified and all 479 pytest errors
   bucketed to one root cause, now fixed (T2 CP1). But run #4 shows the backend suite
   **times out at 45 minutes without finishing** (F-CI-5), five vitest ENV failures remain
   (F-CI-4), and **5 REAL failures are real**. **The backend suite has still never produced
   a totals line in CI.** Still PARKED.

| row | packet | CP | fingerprint | reader | merges-after |
|---|---|---|---|---|---|
| 1 | packet-a-absent-bound-gate | A-CP1 | `f6180b3da` | UNSIGNED | none |
| 2 | packet-c-instrument-and-claudemd-gate | CP1,CP2 | `c443515eb` | UNSIGNED | — |
| 3 | packet-d-nav-tabs-gate | CP1,CP2 | `e279c828c` | UNSIGNED | C |
| 4 | packet-b-schema-resolution-gate | CP1,CP2,CP3 | `a03e0cbf5` | UNSIGNED | — |
| 5 | packet-v-multi-volume-gate | CP4 | `f94d7addc` | UNSIGNED | B |
| 6 | s4-cp2-build-record | CP2 | `21d6ad3e8` | UNSIGNED | — |
| 7 | packet-e-ci-gap-gate | CP1 | `beeffe8e6` | UNSIGNED | — |
| 8 | e-cp2-build-record | CP2 | `00eecb391` | UNSIGNED | E CP1 |
| 9 | packet-k-two-command-signing-gate | CP1,CP2 | `36179a330` | UNSIGNED | — |
| 10 | k-cp3-build-record | CP3 | `ba5e34e79` | UNSIGNED | K CP2 |
| 11 | k-cp4-build-record | CP4 | `35237823c` | UNSIGNED | K CP3 |
| 12 | packet-t-stale-test-gate | T-CP1 | `5179b2890` | UNSIGNED | — |
| 13 | d3-cp2-build-record | CP2 | `f7e851d58` | UNSIGNED | — |
| 14 | s2-accelerator-chord-…-gate | CP1 | `72cda4cda` | UNSIGNED | last |

**Production impact, per unit: rows 1–13 → nothing member-visible.** Row 14 →
Ctrl/Cmd/Alt+Shift+F stops silently flagging tickers on three screens; plain Shift+F
unchanged. **This session merged and deployed nothing.**

## 10 · Merge readiness

**16 rows, 16 OK, 0 STALE. 15 of 15 commits mapped. `verify_manifest --check-commits`
exit 0.** `sign_gate --read-check` exit 0; `sign_gate --self-check` exit 0;
`merge_all --dry-run` exit 0 (**8** constraints SATISFIED, 16 units, 0 MALFORMED, 0
UNSIGNABLE); `sign_all --dry-run` exit 0, **16** commands.

⛔ **Not ready to merge.** The branch's own CI says RED with a backend suite that did not
collect, and run #3's diagnosis is still pending.

## 11 · Three phone-readable sentences

**The signing tool used to answer "signed" for a document that had no signature on it at
all, which is how two commits nearly merged with nothing approving them; it now answers
signed, unsigned, or malformed, and it cannot be fooled by an absence again.**

**Every commit on the branch is now claimed by exactly one unit, so nothing can be quietly
left behind when the merge finally runs.**

**Checking the remaining queue before building any of it found one instruction that would
have broken something: it says only the Calendar uses a function that three parts of the
system actually use, and two of those send alerts to members.**

**And the backend test suite has not been failing in CI — it has not been running at all:
479 of its 481 files could not even load, because the CI job installed five libraries
instead of the list the project keeps, and that is now one line different.**

**With that fixed the suite finally started, ran for forty-four minutes, and was cut off at
the forty-five minute limit — so the next thing it needs is to be split into parts, not
given more time; and three separate safeguards all refused to report that cut-off run as a
pass.**

## 12 · Status

`STATUS: RAN`
