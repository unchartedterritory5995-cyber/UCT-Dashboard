# W5-T7b: result digest and warm-up on the wire (desktop lane)

Branch `feat/pine-w5-t7b-result-integrity`. Base **f526d609e4** (on origin; the parent of W5-T9's
commits): W5-T7 5e6c63e24e merged `--no-ff` with W5-T4 eb922686fe, which carries T3's
`runtime/columnDigest.js`. Code tip **f8726b84f4**; this evidence is in a docs-only commit on top of it.
Engine bump: **no**. No engine source changes; `serverEntry.js` only re-exports more names. HP-1
digests use the artifact-neutral bundle sha, so they do not move (HP-1 stays 166/166).

## The gaps, and what changed
Found by W5-T11 (schema finding 1) and W5-T16 (`runtime:warmup-unreported`):
1. T7 results carried no `digest`. T11 requires one on every `ok` (design 2.3, 3.2), so it withheld
   every ok answer as `runtime:server-integrity`.
2. Results carried no warm-up, which T16 needs.

Fixed on the service side:
- `services/pine_runtime/protocol.mjs`: the response schema is now explicit and closed.
  - `RUNNER_RESULT_FIELDS`: ok = `job, status, columns, refusals, warmup` (+ optional `ms`);
    withheld = `job, status, refusals` (+ optional `ms`).
  - `RESULT_FIELDS` = the runner's fields plus `digest`. `REFUSAL_FIELDS` = `key, guard, sentence, bar`.
    `WARMUP_FIELDS` = `withheldBars`.
  - `sealRunResults(codec, identity, jobs, results)` checks every runner result against those
    closed sets, in order and by id. It decodes each column with the bundle's T3 `decodeColumn`
    (exactly `bars.n` canonical values) and stamps
    `digest = columnDigest({engine: <service identity>, columns: <decoded wire bytes>, refusals, rows: n})`.
    It also checks `warmup.withheldBars` is an integer in [0, n]. An unknown or missing field anywhere,
    a run-wide refusal on an ok result, or a withheld result with no `*` reason all refuse the
    request whole.
- `server.mjs`: the seal is step 6. It replaces `wellFormedResults`, which is deleted, so one guard
  remains. A seal refusal returns `500 runtime:server-failed` with no results.
  `loadBundle` refuses to boot when the bundle exports no `columnDigest` or `decodeColumn`, and
  `door.codec` is the bundle's own export. The digest has **one implementation**, T3's, and it ships
  inside the artifact, because the image copies no source file.
- `job.mjs`: every ok result carries `warmup: {withheldBars}` from `rt.runtimeWarmupOf(cols)`, the
  same function `runtimeWorker.js` posts. The value is 0 when the run withheld none. Only the bar
  count crosses the wire; `shift` and `secondRunStoppedAt` stay in the service.
- `sandbox.mjs`: a job worker refuses a bundle without `runtimeWarmupOf`, so a missing reader never
  silently reports 0.
- `runtime/serverEntry.js`: re-exports `columnDigest`, `decodeColumn` and `runtimeWarmupOf`.
  T1's entry-surface rail is updated, and it checks that the bundle's codec equals the module's.
- Wire cost: the seal digests on the supervisor thread. Measured at about 1.3 ms per 2-column
  5,000-bar job (pure-JS sha256, about 60 MB/s), so a 500-job on-demand request costs about 0.7 s.
  This is noted for T9's capacity numbers.

## Field names, and how they match T11 / T16 (MISMATCHES, for the coordinator)
- `digest`: matches the design (3.2, one per result) and T11 (`_RESULT_KEYS`, verified with T3
  `column_digest(self.identity, columns, refusals)`). The service sends it on withheld results too,
  and T11 verifies it when present.
- `warmup: {"withheldBars": n}`: a result-level field. Warm-up is run-wide in the engine:
  `computeOffListing` blanks `[0, from)` of every key. The design has no wire field for it (T16's row
  only says "warm-up pad from the run"), so the name follows the engine's record and T16's read
  (`column.warmup["withheldBars"]`).
  - **MISMATCH 1 (T11):** `pine_runtime_client._RESULT_KEYS` is closed and lacks `warmup`, so
    unmodified T11 refuses every ok answer as "is not a job result". T11 needs a one-line key
    addition, and it must carry the value into `JobResult`.
  - **MISMATCH 2 (T11 → T16):** `runtime_server_lane.runtime_column_fn` returns a plain `list`. T16
    reads `.warmup` on that list, so T11's lane adapter must return a list carrying
    `.warmup = {"withheldBars": n}` from the result.
  - The e2e rail pins MISMATCH 1 exactly: the unmodified reply is refused for that reason alone, and
    the same bytes minus `warmup` pass. Once T11 names the key, the rail requires the unmodified
    reply to pass instead.
- Not covered by the digest: `warmup`. The T3 preimage has no field for it, and T3 is not changed
  here. The bytes partly attest it, since the withheld bars are na on the wire (the rails check this).
  A client can cross-check that all of `[0, withheldBars)` is na.

## Daily bar time: what the service reads (coordinator question, W5-T15 / W5-T11)
- On the wire `bars.t` is a Float64. The door checks only that it is finite and strictly
  increasing, so **any numeric spelling is accepted**.
- The runtime reads a numeric `t` as **UNIX SECONDS, verbatim, as the bar's instant**
  (`indicators.js::barOpenInstant` number branch; `vm.js` `time = t * 1000`). The chart's ISO-date
  branch (`"YYYY-MM-DD"` → 09:30 ET open) cannot cross this wire.
- The clock is New York time (`etClockAt`).
- Railed through the service on the real bundle (`result.test.mjs`, "a daily bar time is read as unix
  seconds verbatim"), for Mon-Wed 2026-01-05..07 with `plot(dayofweek)` and `plot(dayofmonth)`:
  - seconds at the 09:30 ET open (the chart's own reading): dow 2,3,4, dom 5,6,7. Correct.
  - **seconds at UTC midnight (what W5-T15 sends): dow 1,2,3, dom 4,5,6, hour 19.** Every clock
    built-in reads 19:00 ET on the PREVIOUS day, one day early. Scripts using `dayofweek`, `time`,
    sessions and similar would differ from the chart.
  - YYYYMMDD ints: below the 1990 unit floor, so every clock built-in is na (never a guess).
  - milliseconds: read as seconds, giving far-future garbage that is NOT refused.

### THE ONE RULE (for aligning W5-T14 and W5-T15)
**A bar's `t` on the wire is the UNIX SECONDS of the instant the bar OPENED, read on the New York
clock. For D/W/M that is `barOpenInstant(date, tf)`: 09:30 America/New_York on the session date
(W = the week's first vendor session, M = the month's first). The DST offset is that date's own.**
- The source of the rule is `app/src/components/chart/indicators.js:1609-1627` (`barOpenInstant`). A
  number is taken verbatim (`:1610`, floor `VWAP_MIN_INSTANT = 631152000` at `:302`). An ISO date is
  mapped to the 09:30 ET open (`:1611-1626`). The Python twin is
  `api/services/indicator_compute.py:1834` (`bar_open_instant`).
- Who reads the rule:
  - the clock columns that serve `time`, `dayofweek`, `dayofmonth`, `hour` and the like
    (`indicators.js:1732`, `:1910`, both through `barOpenInstant`);
  - the runtime VM's own clock reads, `OP.READ_CLOCK` (`runtime/vm.js:630`) and `OP.SESSION`
    (`runtime/vm.js:648-652`, `time = t * 1000`), both through `etClockAt` (`indicators.js:2103`).
    These read `barTimes = rows[i].t` raw (`runtime/runtimeColumns.js:1280`, `runtime/vm.js:234`).
- The browser chart feeds a stock's daily bar as `"YYYY-MM-DD"`, which `barOpenInstant` maps to the
  09:30 open. An index's daily bar arrives as UTC-midnight seconds (`engine/symbolProjection.js:216-220`
  names the two spellings).
- The host-parity corpus generates 09:30 ET open seconds (`tools/pine_runtime_host_parity.mjs:81-91`,
  "Weekday session opens (unix seconds of 09:30 New York)"). That is what HP-1 / HP-3 and the T9
  canary are measured on.
- The wire is Float64 only (`services/pine_runtime/protocol.mjs` `barsOf`), so the date branch cannot
  cross it. The caller must send the 09:30 ET open seconds: `bar_open_instant(date, tf)` in Python.
- **W5-T14 (09:30 ET open seconds) follows the rule. W5-T15 (UTC-midnight seconds) does not:** every
  clock read is a day early (railed above). It should send `indicator_compute.bar_open_instant(day, tf)`.
- Caveat to name: an index's daily bar on the browser chart is UTC-midnight seconds, read verbatim by
  the same rule. So the chart itself is one day early for clock-reading scripts on index dailies (the
  `symbolProjection` join handles alignment, not the clock). This lane does not decide it; it is
  flagged for the coordinator.

### PROPOSAL: a declared time unit (not built here; protocol 1 is unchanged)
Add a REQUIRED closed field `bars.tclock: "open-s"` in protocol 2. Its one value means unix seconds of
the bar's opening instant. Any other value, or the field missing, is `400 runtime:server-schema`.
For `tf` in D/W/M the door also refuses (400, by row) a `t` whose New York wall clock is not that
date's open, by asking the bundle's own `barOpenInstant`/`etClockAt` (one authority, no second clock).
That catches T15's UTC midnight (19:00/20:00 ET), YYYYMMDD ints (below the floor) and milliseconds
(far future) at the door, where today they are accepted silently. The client (T11) sends the field
and converts with `bar_open_instant`. The cost is one bundle export (`barOpenInstant`) and one closed
field. Until it is built, the rule above is enforced only by the callers.

## Checks (code tip f8726b84f4, base f526d609e4)
| check | command | result |
|---|---|---|
| node rails | `node --test --test-force-exit --test-concurrency=2 --test-timeout=200000 services/pine_runtime/test/*.test.mjs` (lock heavy-mut) | tests 87, pass 87, fail 0 (`runs/w5t7b-mut/node2.log`) |
| vitest | `serverBundle.rail.test.js` + `columnDigest.test.js` | 2 files, 157/157 (`runs/w5t7b-mut/vitest.log`) |
| e2e + codec pytest | `PINE_RUNTIME_T11_CLIENT=<T11 copy> python -m pytest tests/test_pine_runtime_result_integrity.py tests/test_pine_runtime_codec.py` | 216 passed, 0 skipped (`runs/w5t7b-mut/py.log`) |
| HP-1 (W5-T4) | `node tools/pine_runtime_host_parity.mjs --host node --check` | **GREEN 166/166** (`runs/w5t7b-mut/hp1.log`) |
| HP-7 | `node tools/pine_runtime_host_parity.mjs --adapters` | GREEN (`runs/w5t7b-mut/hp7.log`) |
| final-tip (lock `dsk/heavy-final3.lock`) | `PINE_RUNTIME_T11_CLIENT=<T11 copy> bash $S/final-tip.sh pine-dsk-w5t7b dsk-w5t7b-final tests/test_pine_runtime_result_integrity.py tests/test_pine_runtime_codec.py tests/test_script_engine_version_gate.py` on tip f8726b84f4 | gate pytest 46 passed; hygiene clean (34762 files); rails pytest 222 passed; full chart+hooks vitest: Test Files 1 failed / 1336 passed / 27 skipped, Tests 1 failed / 22536 passed / 118 skipped. The only failure is `src/hooks/pollingSites.rail.test.js`, the known baseline. No app/dist or dist-server was left behind. |

The T11 client is used READ-ONLY: `git show 86218da704:api/services/pine_runtime_client.py` into a
temp dir (sha256 e902c910ba49...), loaded through `PINE_RUNTIME_T11_CLIENT`. No T11 or T16 file is
edited. Without the variable, and with no client on the tree, the rail SKIPS by name; after T11
merges it loads `api/services/pine_runtime_client.py`.

## End-to-end proof (`tests/test_pine_runtime_result_integrity.py`)
T11's `PineRuntimeClient` builds, signs and sends a real request over loopback to the real T6
supervisor with the T7 pool (1 worker) on a freshly built bundle, started by `main()` and stopped at
teardown. It then decodes the reply and recomputes the digest over what it received, with its own
`caller_identity`.
- `test_the_ok_answer_passes_t11s_decoder_and_digest_check`: ok, full length, digest equal. **Red on
  base** (withheld integrity); green on the tip.
- `test_a_flipped_column_byte_is_still_refused_as_integrity`: one mantissa bit of row 200 is
  flipped and re-encoded as valid base64, and the result is withheld "does not match its digest".
  Green on base and tip, as a guard that must stay.
- `test_a_digest_dropped_from_an_ok_answer_is_refused`: withheld integrity.
- `test_the_reply_carries_the_runs_warm_up_and_those_bars_are_na`: off the listing,
  `withheldBars` > 0 and those bars are na; from the listing, 0. Red on base.
- `test_the_t11_result_key_mismatch_is_exactly_warmup`: MISMATCH 1, pinned. Red on base.
- After every run the service process is gone: `proc.poll()` is asserted, and no `node.exe` with the
  launcher remained (checked by command line).

## Rails red on base, green on tip
`python docs/pine/evidence/2026-11-04-w5-t7b/redbase.py` writes the base bytes of the 5 production
files, runs the rails, then restores byte-exact and asserts it (`runs/w5t7b-mut/redbase2.log`).
- node seal+result: rc 1. `seal.test.mjs` fails to load (no `sealRunResults`), and 3 `result.test.mjs`
  real-bundle tests are red. The daily-time characterisation rail passes on base, as expected: it pins
  engine behaviour that this lane does not change.
- pytest e2e: 4 failed, 1 passed (the flipped-byte guard).
- vitest `serverBundle.rail`: 1 failed (the entry surface).
- Restored byte-exact.

New rail files: `services/pine_runtime/test/seal.test.mjs` (11), `services/pine_runtime/test/result.test.mjs` (4),
`tests/test_pine_runtime_result_integrity.py` (5). Fixtures updated for the closed schema:
- `helpers.mjs` DOOR gains `codec` (T3's module);
- the `server.test.mjs` count runner and the `bundle.test.mjs` stub runner answer in-schema;
- the `job.test.mjs` recorder gains `runtimeWarmupOf`;
- `fakeBundle.mjs` gains `runtimeWarmupOf` and a `warmup:<n>` behaviour.

## Mutations (lock `dsk/heavy-mut.lock`; restores byte-exact by `$S/mutate.py`)
- Node: `python docs/pine/evidence/2026-11-04-w5-t7b/mutate_node.py $S/mutate.py docs/pine/evidence/2026-11-04-w5-t7b/muts.json services/pine_runtime/test/{seal,result,job,server}.test.mjs`.
  **30/30 killed**; the control survived, as it must (`runs/w5t7b-mut/mut.log`).
- Vitest (from `app/`): `muts-vitest.json` on `serverBundle.rail.test.js`, **2/2 killed** (`mut-vitest.log`).
- E2E (pytest wrapper `mutate_pytest.py`, T11 client): `muts-e2e.json`, **4/4 killed**; the control
  survived (`mut-e2e.log`).

| mutation | killed by |
|---|---|
| seal:result-not-closed | the schema stays CLOSED...; server step 6 ... 500 with no results |
| seal:status-any-shape | the schema stays CLOSED |
| seal:plain-check-off | the schema stays CLOSED (a null result) |
| seal:job-order-off, seal:count-off | every job answered once, in order, by id |
| seal:refusal-not-closed | the schema stays CLOSED |
| seal:refusal-key-empty-ok, -guard-empty-ok, sentence-unchecked, bar-negative-ok, withheld-no-reason-ok, ok-runwide-ok, served-and-refused-ok, ms-unchecked | the ok / withheld rules |
| seal:columns-plain-off, b64-lenient, length-unchecked | a column must decode to exactly n canonical values |
| seal:warmup-not-closed, warmup-over-n-ok, warmup-negative-ok, warmup-nonint-ok | the warm-up is a bar count from 0 to n |
| seal:digest-neutral-identity, digest-no-columns | real bundle ... T3 digest of its own bytes; e2e ok-answer test |
| seal:digest-no-refusals | an ok result is sealed with the T3 digest...; real bundle run-wide stop |
| server:seal-bypassed | real bundle tests; e2e ok-answer test |
| server:seal-refusal-ignored | server step 6; T6's "a runner that does not answer every job exactly once is a 500" |
| server:codec-check-off | loadBundle refuses a bundle that carries no T3 codec |
| job:warmup-always-zero | real bundle off the listing; job.mjs warm-up rail; e2e warm-up test |
| job:warmup-null-unhandled | runJob / want rails (every plain run becomes run-wide failed) |
| sandbox:warmup-export-unchecked | the pool refuses to start on a bundle with no runtimeWarmupOf |
| entry:warmup-export-dropped, entry:codec-export-dropped | exports the entry surface ... (vitest) |
No equivalent survivors.

## Stacked READY lanes that need a merge of this after it lands
- **W5-T9** (`feat/pine-w5-t9-canary`, same base f526d609e4): edits `server.mjs::run` near the old
  `wellFormedResults` (it adds `metrics.answered(..., results)`), so expect a textual conflict.
  `metrics.answered` should take `sealed.results`. Its canary reads pool results (pre-seal) with the
  neutral identity, so it is unaffected, and the extra `warmup` field is ignored.
- **W5-T8** (`feat/pine-w5-t8-cache`): its result cache stores `{columns, refusals, digest}`. It must
  also store `warmup`, or a cached ok result loses its warm-up. If the cache sits before the seal,
  the closed schema refuses it (missing `warmup`); if after, T16 is answered without warm-up. Its
  validity check (`status ok|withheld`, guards) should be read against `RUNNER_RESULT_FIELDS`.
- **W5-T10** (`feat/pine-w5-t10-image`): no new production `.mjs` was added, so its copy list is
  unchanged. Re-run its Dockerfile rail on the merged tip.
- **W5-T19**: no branch on origin at the time of writing; nothing to rebase.
- **W5-T11 / W5-T16** (not stacked on this): MISMATCH 1 and 2 above.

## Logs
`C:/Users/Patrick/uct-worktrees/_resume-2026-11-01/runs/w5t7b-mut/` (node.log, node2.log, vitest.log, py.log, hp1.log,
hp7.log, redbase.log, redbase2.log, mut.log, mut-vitest.log, mut-e2e.log) and
`runs/dsk-w5t7b-final/` (gate.log, hyg.log, py.log, js.log).
