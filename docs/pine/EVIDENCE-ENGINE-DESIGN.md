# Evidence engine (programme track E): from a queued probe to a graded, filed fixture

Branch `feat/pine-evidence-engine`, 2026-11-02. Programme plan:
`_resume-2026-11-01/PINE-FULL-PARITY-PLAN.md` section 4, row E.

> **The problem.** Parity is proven only where a TradingView capture exists: 336 captures,
> 34 of 679 sample scripts transfer AND MATCH. Every wave (W1-W9) adds refusals that stay
> refused until a capture settles them, and the rows that say so are spread over 33
> hand-written `docs/pine/capture-queue-*.md` files. Captures are taken largely by hand.
>
> **The rule this design keeps.** A render of our own output is never evidence. Only the
> vendor's own numbers, read off its chart model on its own bars, graded by the vendor
> harness, are. Nothing in this engine changes what counts as evidence; it changes how many
> captures one owner session can produce, and how few of them depend on a person's memory.

---

## 0. What already exists (this engine composes it, it does not replace it)

| piece | file | state |
|---|---|---|
| capture format v1, receipt, source sha | `tools/vendor_harness/schema.mjs` | proven, 336 fixtures |
| chart-model reader (no pixels, no `exportData()`) | `tools/vendor_harness/tv_capture.js` | proven live (CAP2, 2026-10-02) |
| chunk assembler + verifier | `tools/vendor_harness/verify_capture.mjs` | proven |
| unattended per-script driver, resumable | `tools/vendor_harness/batch_capture.py` | proven against a recording double; never run live unattended |
| comparator + our side (the member door) | `compare.mjs`, `__tests__/vendorHarness/*` | proven |
| corpus-derived target list | `tools/vendor_harness/batch_manifest.py` | proven; only covers attached corpus scripts, not queue rows |
| dedicated TradingView profile | `%LOCALAPPDATA%\uct-capture-profile\tradingview` (`pine_vendor_capture.resolve_profile`) | exists, signed in once by the owner |

**What is missing** (and what this branch builds):

1. Nothing reads the capture queues. Each row's probe, chart, and the scripts it would
   unblock live in prose. There is no list of "what to capture next, and why".
2. `batch_capture.py` takes ONE symbol and timeframe per run. Queue rows name their own
   charts (RDDT 1D from the listing, SPY 1D, SPY 15...).
3. No provenance beyond what the capture itself carries: the run, the account, the queue
   rows a capture answers are not recorded anywhere durable.
4. No licence gate between a capture and git. A capture embeds its Pine source verbatim;
   a builtin or reference-only script's source must not be committed (`LICENSING.md`).
5. No human checkpoint between "a capture verified" and "a fixture is committed", and no
   filing of the verdict back against the queue row.

## 1. The pipeline

```
 capture-queue-*.md  +  probes/*.pine  +  coverage-map.json  +  tests/fixtures/vendor/harness
            |
   [Q] evidence_engine.py queue      -> docs/pine/vendor-harness/capture-queue.json   (offline)
            |
   [M] evidence_engine.py manifest   -> <run>/manifest.json (uct.vendor-batch-manifest/v1,
            |                             per-script symbol / tf / listing date)      (offline)
   [C] evidence_engine.py batch      -> batch_capture.py run: the owner's rig, one sign-in,
            |                             <run>/captures/*.json + results/ + ledger    (ONLINE, owner starts it)
   [V] validate (inside packet)      -> verify_capture.mjs + naming + licence + no-overwrite (offline)
   [G] evidence_engine.py grade      -> the corpus harness over <run>/captures under heavy_lock
            |                             -> <run>/verdicts.json, summary.md, evidence-report.json (offline)
   [P] evidence_engine.py packet     -> <run>/PROMOTION-PACKET.md + promotion-packet.json, sha256  (offline)
            |
        HUMAN CHECKPOINT: the owner (or the coordinator on the owner's word) reads the packet
            |
   [F] evidence_engine.py promote --packet-sha <12 hex>
                                     -> tests/fixtures/vendor/harness/<id>.json (licence-clear only)
                                     -> docs/pine/vendor-harness/evidence-ledger.jsonl (every verdict)
            |
   [Q] next queue build sees the fixture / ledger row and closes the queue target by itself
```

Every stage but [C] runs with no TradingView access, so every stage but [C] is built and
tested on this branch. [C] is the existing driver plus four small changes (section 6); it is
written and tested against the recording double, and it is NOT run against TradingView by any
agent.

## 2. [Q] The queue: one machine-readable list, derived, never typed

`python tools/vendor_harness/evidence_engine.py queue` reads every
`docs/pine/capture-queue-*.md` and writes `docs/pine/vendor-harness/capture-queue.json`
(`schema: uct.capture-queue/v1`). `--check` compares without writing. The file is a derived
snapshot (the `batch-manifest.json` precedent): regenerate, never hand-edit. The docs stay
the authority for what a row asks; the JSON is the authority for nothing.

### 2.1 Rows

Every markdown table row in a queue doc is a **row** (`<doc-stem>#<first cell>`), with its
text, its doc's wave tag (the filename after the date: `wsc-history`, `c47`, ...) and:

- **sources**: what Pine to run, resolved to a file and its sha256, in this order
  1. a probe named in the row (`x.pine`, `tools/visual_conformance/probes/x.pine`, or a bare
     probe stem such as `vw-ratchet-stops`) that exists under `tools/visual_conformance/probes/`
     or `docs/pine/probes/`;
  2. a corpus file (`corpus/committed/<slug>.pine`);
  3. a version VARIANT (`line 1 //@version=4`): the sibling file `<stem>-v4.pine` when it
     exists, else the row needs a probe;
  4. nothing in the row: the doc's preamble (text before its first table) when it names
     exactly one probe;
  5. otherwise the row is **NEEDS_PROBE** (an inline shape, prose, or a builtin by id). The
     engine never writes Pine from prose; a person writes the probe file, and the next build
     picks it up.
- **charts**: `EXCH:SYM tf` pairs named in the row (`NYSE:RDDT **1D**`, `AMEX:SPY 15`, a bare
  `SPY 1D`), else the preamble's, else the house default `NYSE:RDDT 1D` marked
  `chartDefaulted: true`. "from the listing" sets the listing-date assertion.
- **flags**: `needsLive` (market hours, realtime, forming bar, `varip`, twice minutes apart,
  1m), `needsVariant`, `needsTwoWitnesses`. A `needsLive` row is never in an unattended
  batch: a forming bar cannot be captured after the close.
- **guards**: every refusal token the row names (`pine:*`, `runtime:*`, `fn:*`, `paint:*`,
  `lower-tf:*`).
- **named scripts**: corpus slugs the row names (`engulfingcandle__0df91dc775`).
- **stated unblocks**: a bold number in a column headed "unblock" / "would move" / "confirms";
  kept as the author's claim, never as the priority.

How the parser reads the docs (they were written by hand, by many sessions, in several
shapes; these rules are what makes them machine-readable without rewriting them):

- A table whose header has a cell `settled` / `served` / `was` / `now` / `witness`, or whose
  first header is `refused as`, is a LEDGER of what is already known, not a queue. It is
  counted per doc (`contextTables`), never silently dropped.
- Inheritance is by SECTION first: a row with no source takes the one `.pine` file named in
  the heading above its table (`### 6. vw-mintick.pine ...`), else the one named in the doc's
  preamble. Only explicit `.pine` names are handed down, never a bare stem in prose.
- A timeframe is read only as the list that immediately follows a symbol (`NYSE:RDDT **15**,
  **60**, **240**`, `AMEX:SPY 1D (and 1W)`); a number later in the sentence (`bars 0 and 1`,
  `1,800 bars`) is never a timeframe.
- A target needing a live session is `NEEDS_LIVE` at status derivation, the single place that
  rule lives; the manifest selects by status alone.

### 2.2 Targets (the unit of work)

A **target** is one capture to take: `(source sha, symbol, timeframe)`. Rows that need the
same capture collapse onto one target, which lists every row it answers. Status, derived
from disk on every build:

| status | meaning |
|---|---|
| `CAPTURED` | a fixture under `tests/fixtures/vendor/harness/` carries this source sha on this symbol and timeframe |
| `VERDICT_LOCAL` | a licence-held capture was graded and its verdict filed in the evidence ledger (no fixture in git, by design) |
| `STALE` | a fixture exists for this probe stem and chart, but the probe file changed since (sha differs): re-capture to grade the current probe |
| `QUEUED` | runnable unattended: source on disk, licence-clear or local-evidence mode, not live |
| `NEEDS_LIVE` | runnable only with the owner watching a live session (excluded from batches) |
| `NEEDS_PROBE` | no runnable source yet (row-level; no target is formed) |
| `LICENCE_HOLD` | the source exists only in the gitignored survey cache (builtin / reference-only); capturable in local-evidence mode only |

### 2.3 Priority = scripts unblocked, derived from the census, never typed

From `docs/pine/coverage-map.json` (the 679-script census: each script's host walls, first
guards, stuck reason, and the runtime-lane walls):

- `firm`: sample scripts that do NOT transfer today and whose every wall is a guard this
  target's rows name. If the capture settles its rows, these scripts have nothing else in
  the way.
- `upper`: sample scripts that do not transfer and touch any guard the rows name (a ceiling:
  one capture usually settles one shape of a broad guard, not all of it).
- `named`: non-transferring sample scripts the rows name by slug.
- `direct`: the target IS a sample script that transfers but has no MATCH; its capture turns
  a transfer into a verified transfer (`verifiedTransfer`, the programme's headline).
- `priority = |firm ∪ named ∪ direct|`, ties broken by `upper`, then the stated number, then
  doc date (older first: it has waited longer).

A target whose rows name no guard and no script scores 0 and is still listed: it is a
confirmation of shipped behaviour, valuable but not unblocking.

### 2.4 The census pool (wave `E-census`)

Besides the queue docs, the census names scripts that already transfer and have never been
graded. These are the cheapest MATCHes there are: no engine work, one capture each.
`committed` scripts (source in git, MPL/MIT/Apache) are `QUEUED`; `builtin` and `reference`
scripts are `LICENCE_HOLD` (their source is in the gitignored cache; `LICENSING.md` forbids
committing it).

### 2.5 Waves

Each target carries `docWave` (the queue doc's tag) and `planWave`, derived from the
capability its unblocked scripts are blocked on (`tools/pine_coverage/coverage_map.py::GUARD_BUCKET`):
drawing-objects -> W3; imperative / history-offsets / user-functions / tuples -> W4;
collections / udt-methods -> W6; request-security -> W7; imports-libraries -> W8;
strategy -> W9; builtin-missing / call-mapping / translator-robustness / output-contract /
text-colour-values -> W1; runtime-only guards -> W4; nothing derived -> `E` (confirmation).

## 3. [M] From queue to manifest

`evidence_engine.py manifest --top N [--wave TAG] [--plan-wave W3] [--local-evidence]`
selects `QUEUED` targets (and `LICENCE_HOLD` only with `--local-evidence`), in priority
order, then groups by chart within each priority band so a batch switches symbol as few
times as it can without letting a lower-priority capture jump a higher one. It writes a
`uct.vendor-batch-manifest/v1` that `batch_capture.py` already reads, with per-script
`symbol`, `tf`, `listingDate`, `captureStem`, `queueTargetId`, `rows`, `localOnly`, and the
production door-flag state (read from `docs/frontend_feature_flags.json`, as
`batch_manifest.py` does) so the grader runs the door the census counted.

## 4. [C] The rig and the live run (owner only)

### 4.1 The rig: one dedicated profile, one sign-in

- The browser is Playwright's persistent context on
  `%LOCALAPPDATA%\uct-capture-profile\tradingview`: a profile that exists only for this rig.
  `resolve_profile` refuses a path inside a git worktree, and `refuse_owner_browser_profile`
  refuses Chrome's and Edge's own `User Data`. The owner's everyday Chrome is never opened,
  read or driven.
- **One profile, one sign-in** (the Wave Q1 rig rule, applied here): the profile is never
  deleted, recreated or replaced by a fresh one; a fresh profile is a signed-out profile.
  A sign-in is a rare event. The tool checks the session itself (the rig layout answers 200
  vs 403 "Chart Not Found") and never asks for a sign-in while that answers 200.
- **Sign-in is the owner's, by hand, in the rig's own window**, with the Email option. The
  tool has no `fill`, `type` or text entry anywhere (a rail greps for them), never reads or
  stores a credential, and waits for the server to say the layout opens.
- **Input goes to the rig's page, never to the foreground window.** Every pointer and key
  event is a CDP event addressed to the Playwright page; nothing calls an OS-level input API,
  so nothing can land in whatever window the owner has in front
  (`lesson_an_os_key_goes_to_the_foreground_window`).
- **Teardown keeps the profile and proves its lock released** (`lockfile` / `SingletonLock`,
  the `window_check.profile_lock_released` rule), so the next run never finds the profile
  busy. A held lock is reported, never killed: the tool never kills a process it did not start.
- **One run per profile at a time.** A second launch on a held profile is INCONCLUSIVE with
  the holders listed (`_profile_holders`), not a retry loop.

### 4.2 Per script (unchanged from `batch_capture.py`, now per-script chart)

gate v2.1 -> still signed in -> scratch layout `01f1AcIj` reads 0 studies (else STOP) ->
the script's own symbol and timeframe set and READ BACK -> `Create new > Indicator` ->
binding gate -> source through the Monaco handle, buffer sha compared -> Add to chart ->
compute -> `requestMoreData` until history stops growing -> `tv_capture.js` reads the chart
model (`metaInfo().plots`, `data()`, `bars()`, `graphics()`, `properties().state()`) ->
chunks verbatim -> `verify_capture.mjs --assemble` -> cleanup always (remove only the study it
added, restore symbol / resolution / stretch, no `__uct*` globals).

**Values come from the chart model, never pixels, never `exportData()`** (plan-gated).

### 4.3 Pacing and terms

- Only the owner's own account and session; only scripts that are open source (corpus,
  builtins, our own probes); nothing private to another user is opened or read.
- `--throttle-s 30` between scripts (default; the tool refuses below 10 s), and a per-session
  cap (`--limit`, default 40 from the evidence engine). A 40-script session is about 40-60
  minutes of the owner's account doing what a person would do by hand, slower than a person.
- Daily captures run after the close (`newestBarIsForming` derived by `tv_capture.js`).
  `needsLive` rows are never batched.
- Nothing is saved to the account: every script goes into an unsaved `Create new` buffer.

### 4.4 Resumability (unchanged)

`<run>/results/<slug>.json` is claimed INCOMPLETE before the first step; `ledger.jsonl` is
append-only and fsynced. Re-running with the same `--run-dir` skips a capture that still
verifies with the same source sha and retries INCOMPLETE / INCONCLUSIVE / GATE_FAILED. A dead
run's orphan study is removed only by the id it recorded.

### 4.5 Provenance (new; recorded per capture, filed with the verdict)

| field | source |
|---|---|
| `runId`, `startedAtUTC`, `finishedAtUTC` | the run |
| `capturedAtUTC`, `page.url`, `tool` | the capture itself (already in v1) |
| `symbol` (pro name, session, timezone), `timeframe`, `newestBarIsForming`, `history.startsAtBar0` | the capture itself |
| `account` | `sha256(username)[:12]` read off the page (`ACCOUNT_JS`), or `unread`. Never the name itself: the repository is public; a fingerprint proves "the same account across captures" without publishing it |
| `profile` | the profile directory's leaf name (`tradingview`), never a full path with the user name |
| `rigLayout` | `01f1AcIj` |
| `engineSha` | `git rev-parse HEAD` of the checkout that drove the run |
| `queueTargetId`, `rows` | from the manifest |
| `operator` | `owner` (only the owner starts the online half) |

## 5. [V] [G] Validate and grade

- **Validate** (`fixture_gate`): `verify_capture.mjs` (shape, receipt, source sha: the one
  authority, called, never re-implemented) + the file name equals `<id>.json` and the id has
  the house form `<script>-<sym>-<tf>-<yyyy-mm-dd>` + **licence** (below) + **no overwrite**
  (an id already under `tests/fixtures/vendor/harness/` is refused; evidence is appended,
  never replaced).
- **Licence gate.** A fixture embeds its Pine verbatim, so a capture may enter git only if
  its source is (a) one of our own probes (sha equals a file under the probe dirs), (b) a
  `corpus/committed/` file (sha match), or (c) carries an explicit permitted header
  (`tools/pine_survey/corpus_licence.is_permitted`: MPL-2.0 / MIT / Apache-2.0). Anything
  else is `LICENCE_HOLD`: graded locally, its verdict filed in the ledger with its source
  sha, its capture kept outside git.
- **Grade** = the existing corpus harness over `<run>/captures`, run through
  `heavy_lock.py` (machine rule: one heavy job at a time), with the door-flag state from the
  manifest. `evidence-report.json` joins each verdict back to its target and rows.

## 6. [P] [F] The human checkpoint, then filing

`packet` writes `<run>/PROMOTION-PACKET.md` (one line per capture: id, chart, rows answered,
verdict, first divergence, licence class, validation problems) and `promotion-packet.json`,
and prints the packet's sha256. `promote` requires `--packet-sha <first 12 hex>`: the sha of
the packet as it is on disk now. If anything changed after the packet was written (a new
capture, a regrade), the sha moves and promote refuses. That is the checkpoint: a person has
read THIS packet, and nothing gets past it unread.

`promote` then:
- copies each licence-clear, valid capture to `tests/fixtures/vendor/harness/<id>.json`;
- appends one row per capture (promoted or held) to
  `docs/pine/vendor-harness/evidence-ledger.jsonl` (`uct.evidence-ledger/v1`): id, source
  sha, chart, verdict, reason, first divergence, rows, target, provenance, licence class,
  `promoted: true|false`;
- never commits. The commit is a person's (or the coordinator's) act, with the packet in the
  commit message.

The next `queue` build reads the fixtures and the ledger and closes the targets by itself.
A DIVERGE closes the capture target too: the question was answered; the follow-up is engine
work, filed by the wave that owns the guard.

## 7. What this does not do

- It does not write probes from prose rows (NEEDS_PROBE stays a person's job).
- It does not take live / realtime captures (NEEDS_LIVE stays attended).
- It does not widen any tolerance, admit any refusal, or count a render as evidence.
- It does not commit anything on its own.

## 8. What is proven by this branch, and what is not

- **Proven offline (tests):** queue parsing over every committed queue doc, target collapse,
  status derivation from fixtures, priority derivation against a synthetic census, manifest
  emission (live / probe-less / licence-held excluded; per-script chart), per-script chart
  honoured by the driver against the recording double, the licence gate, the no-overwrite
  rule, the packet-sha checkpoint, ledger filing. Each new guard is mutation-proved.
- **Not proven until the owner's first live batch:** that TradingView's page still has every
  hook the driver looks for (`recon` prints each reading first), and that `ACCOUNT_JS`
  finds a username (if not, provenance says `unread`, which is honest, not a failure).

## 9. The owner's command

From the repo root, after the close, rig profile already signed in:

```
python tools/vendor_harness/evidence_engine.py batch --top 20
```

It builds the queue, writes the manifest into a new run directory, runs `batch_capture.py run`
on the rig (one browser window opens; leave it alone), grades under the heavy lock, and writes
the promotion packet. Read `<run>/PROMOTION-PACKET.md`, then:

```
python tools/vendor_harness/evidence_engine.py promote --run-dir <run> --packet-sha <12 hex>
```

First time on a machine: `python tools/vendor_harness/batch_capture.py --self-check` and
`python tools/vendor_harness/batch_capture.py recon` (VENDOR-HARNESS.md, "Owner steps").
