# W5: the Pine runtime on the server, as a separate sandboxed service

Written 2026-11-02 by W5 of the Pine full-parity programme
(`_resume-2026-11-01/PINE-FULL-PARITY-PLAN.md`, section 2 and wave W5).
Read on `origin/master` @ `6272ed7fa3`. **Design and implementation plan only.** This branch
changes no product code, creates no Railway service and sets no variable.

**Owner decision this builds on (2026-11-02):** run the SAME interpreter the browser runs,
server-side, as a SEPARATE sandboxed service for isolation from member-supplied code. It does
not run inside the web pod.

This supersedes one sentence of an older decision. C4 Phase 2A
(`docs/superpowers/specs/universal-indicator-ecosystem/PHASE2_RUNTIME_ARCHITECTURE.md`, section 1)
chose ONE authoritative JavaScript runtime. That still stands. It also put the server half in a
"long-lived Node sidecar process owned by the Python backend", inside the web pod. The owner has
now moved that half into its own service. The reasons for one JS runtime are unchanged: Python ran
the same bytecode 33x slower, and two implementations would drift.

It also changes a safety statement in `PHASE3-RUNTIME-PLAN.md`. Section 1.3 and checklist row S1
say "the server never executes Pine". Once this lands, that becomes "the server executes Pine only
inside the isolated `pine-runtime` service, which holds no member data and no credentials". Rewrite
S1 in the same commit that first lets a server lane call the service (task T13 below).

---

## 0. The answer in one screen

- **The runtime already runs under plain Node.** Its import closure from `runtimeColumns.js` is
  **82 modules and 95,194 lines** (static walk, section 2.1). It has **one** bare npm import
  (`jsep`) and **four** JSON imports. The web image already runs engine source this way:
  `tools/ast_conformance.run_js` uses a JSON-import loader hook to run `interpret.js` under a bare
  `node` on every user-formula alert arm (`Dockerfile.web:211-220`). Nothing needs a rewrite.
  What has to change is a short list of **host leaks**: wall clocks used as verdicts, two
  `import.meta.env` reads, three `fetch` sites reached through the registry, module-level session
  caches, and `Intl`/`Math` precision across engines. Section 2.2 gives each one its fix.
- **One semantic source, two hosts, proved equal by digest.** The same `npm run build` produces
  the browser worker chunk and a server bundle (`pine-runtime.mjs`) from the same files, with the
  same `VITE_*` values. A **host-parity rail** runs one corpus through both, Node and the real
  Chromium worker chunk, and compares canonical column digests bit for bit. A different digest,
  or a different refusal guard, fails by name. A mutation control proves the rail can fail
  (section 2.3).
- **The service** (`pine-runtime`, a new Railway service, private network only, with no volume
  and no secrets beyond one HMAC key) is a **pure compute box**:
  - The caller sends the document, the bars and the context.
  - The service sends back the columns and its refusals.
  - It never reads a database, a volume or the market data feed.
  - Results are cached on `engine identity + document sha256 + context + bars hash`.
  - Each job runs in a recycled `worker_thread` with a hard V8 heap cap and a hard kill.
  - The existing deterministic instruction budgets decide verdicts. Wall time is only a safety
    stop (section 3).
- **It fails closed.** Every failure has a named `runtime:server-*` reason:
  - unreachable, timeout, 5xx, auth failure;
  - engine mismatch, hash mismatch;
  - a crashed worker, a full queue.
  Every one is **withheld by name**. The caller never uses a stale or partial value. Columns are
  all-or-nothing, and a cached value is keyed on the exact bars it was computed from.
- **One gate on the server lanes, one authority each.** Kill list, allowlist, stage and cohort are
  read from `runtime_definitions.py` on the web pod, the same functions the chart's serving path
  uses. The service keeps no second copy of any of them. A new **server-lane stage**
  (`PINE_RUNTIME_SERVER_STAGE`) can only narrow the pane stage, never widen it.
  `engine_withheld_reason`, `consumer_refusal`, `meta.blockRuns` and the runtime's own guards
  compose in one fixed order (section 5.2).
- **Build plan: 18 required tasks**, each sized for one agent: 11 S, 6 M and 1 L. There is also
  one optional S (editor status) and the owner's Railway step. They run in four phases: P0 single
  source, P1 service, P2 lanes, P3 deploy (section 7). The first wave is T1, T3, T5, T6 and T12,
  with no file collisions.
- **Owner questions: 8** (section 9). The ones that block the design:
  - **R3**: verdicts on instructions, not wall time.
  - Who pays for sweep compute: the size of the service and the cap on runtime documents in the
    nightly sweep.
  - Whether runtime alerts may fire on a forming bar.

---

## 1. What exists today (read, with citations)

### 1.1 Server lanes refuse every runtime document

| lane | where it refuses `compute.kind != "ast"` | what a member sees |
|---|---|---|
| alert arm and cycle | `api/services/alert_user_series.py:882` `_gate_lane` raises `AdmissionRefused("lane")` | the alert refuses to arm: "is not a formula" |
| nightly / live sweep | `api/services/screener/scan_evaluator.py:2670-2672` skips it silently | not swept |
| on-demand scan | `scan_run.py:353` `_load_definition` → evaluator | refused (`gate:not-scannable`) |
| backtest replay | `api/routers/screener_backtest.py:419` → 400 "carries no `compute.ast` tree" | 400 |
| rule record | `api/services/definition_record.py:485` `record_pass(ast=…)` only takes a tree | never recorded |

In every lane, the stored-verdict check `user_definitions.engine_withheld_reason`
(`user_definitions.py:2317`) runs **before** the lane check. Its call sites are:

- `alert_user_series.py:876`;
- `scan_evaluator.py:2668`;
- `scan_run.py:362`;
- `routers/user_definitions.py:309`;
- `routers/screener_backtest.py:413`.

The host lane on the server is the **Python** columnar interpreter (`api/services/ast_interpret.py`).
For alerts, it is cross-checked at 1e-9 against the **JS** interpreter, run as a `node` subprocess
(`alert_user_series._gate_cross_lane`, `:1052`; `tools/ast_conformance.py`). That subprocess is
the precedent this design upgrades. It already runs shipped engine source under a bare `node` in
production, with a JSON loader hook (`ast_conformance.py:619-640`).

### 1.2 The runtime lane in the browser

The runtime lane is described in `PHASE3-RUNTIME-PLAN.md` section 1.1. Its public compute entry is
one function:

```
computeRuntimeColumns(def, rows, ctx, opts)       // runtime/runtimeColumns.js:396
  def  = { id, version, meta: {runtimeLanguage, runtimeFrontend, runtimeIr, runtimeOutputSignature,
                               runtimeHistory?, engineVersion?}, compute: {kind:'runtime', fn, source, outputs, objects?} }
  rows = [{t, o, h, l, c, v}]  oldest first
  ctx  = { tf, newestBarIsForming, symbol:{ticker, exchange}, historyFromListing, runtimeInputs, framed }
  opts = { budgetMs, now, incremental, limits, ... }
  -> { [plotKey]: number[] }   or throws a refusal (err.guard) / the script's runtime.error
```

The browser calls it from `runtimeWorker.js:21-41`, a 40-line message handler. The **worker is
transport, not semantics**: "ONE COMPUTATION, NOT A SECOND" (`runtimeWorker.js:9-12`). The server
gets its own transport around the same call. It gets no second computation.

### 1.3 Where the services and the deploy rules stand

- Railway: seven services today (`CLAUDE.md`; derive the roster with `railway status --json`).
  `web` deploys from **`production`**. Only the promotion workflow advances that branch, after
  `master deploy gate` passes (`docs/runbooks/deploy-windows.md:7-30`,
  `.github/workflows/master-deploy-gate.yml`).
- Service-to-service precedent: `chart-renderer`.
  - It has its own Dockerfile (`services/chart_renderer/Dockerfile`).
  - It is reached at `CHART_RENDERER_URL` on the private network, with a shared
    `CHART_RENDERER_SECRET` (`api/services/discord_chart_house.py:359-362`).
  - It uses a **dual-stack** listener. Railway peer traffic is IPv6 and the healthcheck is IPv4,
    and a `--host ::` listener cost 11 failed deploys (`services/chart_renderer/serve.py`
    docstring).
- The web image pins `node v20.18.0` and copies that same binary into the runtime stage
  (`Dockerfile.web:52, 201`).

---

## 2. One semantic source, two hosts

### 2.1 Measured: the runtime's import closure

This was a static walk of every relative import from `engine/runtime/runtimeColumns.js`,
including `import()`, extensionless paths and `index.js`. The tool is a 40-line script; its method
is in section 10.

| measure | value |
|---|---|
| modules reached | **82** |
| lines | **95,194** |
| bare npm imports | **1**: `jsep` (`ast/parse.js:29`) |
| JSON imports | **4**: `ast/closedTable.json`, `ast/symbolScope.json`, `lib/marketClock/market_calendar.json`, `builder/authoring/crossContext.json` |
| `import.meta.env` reads | **2**: `lowerTfGate.js:35`, `runtimePaneGate.js:52` |
| `fetch(` in reachable code | **3**: `serverCompute.js:346`, `runtimeKill.js:61`, `lib/runtimePanePermission.js:86`. The last two are guarded by `typeof window === 'undefined'`. |
| wall clocks (`performance.now` / `Date.now`) | `vm.js:43` (VM `WALL_TIME`), `runtimeColumns.js:403, 590, 1287` (pane budget), `ast/pine.js:6708-6734` (translator deadline `TRANSLATE_BUDGET`) |
| `Intl` | `runtime/clockFns.js:48` (New York formatter), `indicators.js` (`etClockAt`), `lib/marketClock/sessionCalendar.js` |
| module-level mutable state | `runtimeColumns.js`: `_sessions` (:670), `_ledgers` (:887), `probeVerdictCache`, `_readsIsNew` (:956), `_runner` (:1394), `_memo`/`_objectMemo` (WeakMaps); `lowerIr.js:52` `NA_TESTS`; WeakMap memos in `ast/pine.js` |
| `eval` / `new Function` / `importScripts` / storage / WebSocket | **none** (agrees with PHASE3 1.3) |

⚠️ **Not yet measured: an end-to-end run under bare Node.** A probe that imports the closure
through the JSON hook and runs a 5,000-bar script was queued behind the machine's heavy-job lock,
which the W0 census held. It is not reported here. Task T1's first rail is exactly that run, with
its timing. The `ast_conformance` lane is evidence the parser half runs under bare `node` in
production. It is not evidence for the VM half.

### 2.2 Browser-only dependencies, and how each one is abstracted

The rule for every row below: **the host-specific code is transport and injection only.** No row
may add a second implementation of anything the run computes.

| # | dependency | why it matters on the server | fix (task) |
|---|---|---|---|
| H1 | **The Worker transport**: `runtimeAsync.js`, `runtimeWorker.js` (`self.onmessage`, `new Worker(new URL(…, import.meta.url))`) | browser API | **Not shared.** The service gets its own host adapter (`services/pine_runtime/job.mjs`) that calls `computeRuntimeColumns` with the same arguments `runtimeWorker.js` passes. A rail diffs the two adapters' argument construction, so neither can add an option the other lacks (T2). |
| H2 | **JSON imports** | bare Node ≥ 22 refuses an attribute-less JSON import; 20.18 warns | The server **bundle** inlines them, the same way vite does for the browser (T1). The bundle is preferred over a loader hook, because the service image then carries no `node_modules` at all and `jsep` is inlined. Precedent: `app/dist/cot-facts.cjs`, built by `npm run build` and executed by `node` in production. |
| H3 | **`import.meta.env`** (`lowerTfGate`, `runtimePaneGate`) | `undefined` under Node. Worse, a build flag read **inside** the compute closure becomes a second authority if the server reads a different value from the browser. | The server bundle is built in the **same Docker build stage, with the same `ARG`/`ENV` `VITE_*` values**, so both builds bake one value (T1). Then cut the edge (T2): the gates decide whether a pane runs at all, so they belong to the door, not to `computeRuntimeColumns`'s closure. A closure rail fails if either module comes back into it. |
| H4 | **`fetch` reached through the registry**: `objectColumns.registerObjectRuntimeValues` → `nativeRegistry` → `runtimeKill`/`serverCompute` | network from inside the compute closure; side-effect registration on import | T2 cuts these edges, so the compute closure imports no module that talks to the network. The sandbox also removes `fetch`/`WebSocket` from the job's global scope (H9, T7). A rail runs the bundle with a `fetch` that throws and asserts it is never called. |
| H5 | **Wall clocks used as verdicts**: VM `WALL_TIME` 5,000 ms, pane budget 1,000 ms, translator `TRANSLATE_BUDGET` | **Non-deterministic.** fibonacci-dolphintradebot measured 0.8-1.24 s on one box (PHASE3 3.5). A script can attach on the chart and be withheld on the server, or the reverse. That breaks "a chart never draws what the alerts withhold" (`user_definitions.py:2339`). | Every clock becomes an **injected `opts.now`**: the VM already accepts one (`vm.js:43` `defaultNow`) and the pane budget does too (`runtimeColumns.js:403`). The translator deadline must take the same parameter (T2). **The verdict comes from the deterministic instruction budgets** (`limits.js` `INSTRUCTIONS_PER_BAR` 200,000, a standing ruling never to raise it; 200 M per run). Wall time stays a **safety stop**: its refusal is named `runtime:time-budget`, it is never cached, and it never becomes a stored verdict. Owner question R3 (section 9). |
| H6 | **Module-level state**: sessions, ledgers, probe-verdict cache, `_runner` | a shared server process would carry one member's session into another's run | v1 calls with **`incremental: false`** (no session; the path the cold rails already compare against, `runtimeBuildCache.test.js:6-10`), and calls `resetRuntimeSessions()`/`resetRuntimeLedgers()` after every job. Each worker is **recycled after K jobs** (T7). The content-keyed WeakMap memos are safe, because they key on immutable objects created inside the job. |
| H7 | **`Intl` and time-zone data**: `clockFns.js:48` and `etClockAt` for the New York clock | the ICU/tzdata version differs between Node 20.18 and each Chrome build | A tz fixture covers every DST transition from 1990 to 2030, plus `time()`/`hour`/`dayofweek` at session edges, and runs in both hosts (T5). Text formatting (`str.tostring`, `Intl.NumberFormat`) affects only drawings and labels, which **no server lane consumes in v1**. |
| H8 | **`Math` precision across engines** | V8 ships one fdlibm port, so Chromium and Node agree bit for bit. JavaScriptCore (Safari) and SpiderMonkey (Firefox) can differ in the last ulp of `pow`/`exp`/`log`/trig. | **The byte-identical claim is scoped to V8**: Chromium against Node. For Safari and Firefox the parity rail **measures and reports** the differences without gating on them (T5). Server lanes take Node's answer, which is Chromium's. A Safari member's chart may already differ in the last bit from a Chrome member's today. That is pre-existing and is now measured instead of unknown. |
| H9 | **Global capability surface** (`process`, `require`, `fetch`, timers) | sandbox | A worker preamble deletes or freezes these before the bundle is evaluated (T7, section 4). |

### 2.3 The proof that both hosts produce byte-identical columns

**Canonical encoding (T3), one function per host, held equal by a shared fixture:**

- Each column is a little-endian Float64 array of length `rows.length`. `null`, `undefined` and
  every NaN payload are canonicalised to `0x7FF8000000000000`. `-0` stays distinct from `+0`:
  bit-identical means bit-identical, and a consumer that cares about the difference must be able
  to see it.
- Each refusal is sorted `[{key | '*', guard, bar|null}]`. The sentence is excluded, because
  sentences are allowed to change wording (PHASE3 3.6 item 6: "map by guard, never by sentence").
- `digest = sha256(engine identity ‖ sorted keys ‖ column bytes ‖ refusals)`.
- `engine identity = SCRIPT_ENGINE_VERSION ‖ RUNTIME_FRONTEND_LANGUAGE ‖ RUNTIME_FRONTEND_VERSION ‖
  RUNTIME_IR_VERSION ‖ bundle sha256`. These are read from the modules that declare them
  (`scriptEngineVersion.js`, `pineRuntimeFrontend.js`, `ir.js`), never retyped.
- Python decodes the same bytes (`pine_runtime_client.decode`). A round-trip rail checks Python
  against JS on a fixture written by the JS side, in the `block_runs_parity.json` pattern.

**The corpus (T4).** It is committed under `app/src/components/chart/engine/runtime/__fixtures__/hostParity/`:

- every runtime-lane vitest fixture source (`runtime/__tests__/*`);
- the census's runtime-attaching scripts (216 on the 2026-10-31 run);
- the allowlist scripts;
- the hostile corpus from section 4.

Each script runs over five fixed bar sets:

1. 5,000 daily bars;
2. 32,768 five-minute bars (the history ceiling);
3. a listing-start series (`historyFromListing: true`);
4. a series whose newest bar is forming;
5. a `calc_bars_count` window.

**The rails:**

| rail | runs | what it proves | where |
|---|---|---|---|
| **HP-1 Node half** | `node tools/pine_runtime_host_parity.mjs --host node` runs the **server bundle**, not the source, over the corpus and compares with the committed `expected-digests.json` | the server artifact computes what was recorded | **master deploy gate** (offline, seconds) |
| **HP-2 Chromium half** | Playwright drives the **real in-app `runtimeWorker-*.js` chunk** (the `runtime_pane_worker_probe.py` machinery) over the same corpus | the browser artifact computes the same digests | pre-merge, by the coordinator under the heavy lock (Chromium is too heavy for the gate) |
| **HP-3 cross-host** | the digests from HP-1 and HP-2 are equal for every case | **one semantic source, two hosts** | pre-merge |
| **HP-4 mutation control** | a bundle with one deliberate perturbation (for example, one operator through `Math.fround`) must turn HP-1 red **by case name**; a fixture whose cases all produce one digest is rejected (the "a fixture that cannot distinguish is not a rail" lesson) | the rail can fail | gate |
| **HP-5 refusal parity** | each case's guard set is equal across hosts | a host cannot turn a refusal into a value | inside HP-1/HP-3 |
| **HP-6 engine-identity agreement** | the bundle's engine identity equals what `user_definitions.read_script_engine_version()` reads | the service and the web pod agree on "today's engine" | gate (pytest) |
| **HP-7 adapter agreement** | `runtimeWorker.js` and `services/pine_runtime/job.mjs` build the same `(def, rows, ctx, opts)` minus `now`, compared by a static parse | transport cannot drift into semantics | gate |
| **HP-8 other engines** | HP-2 again on WebKit and Firefox; differences **reported**, not gated | the size of the H8 caveat | weekly, report only |

`expected-digests.json` is regenerated **only** by the coordinator's engine bump
(`SCRIPT_ENGINE_VERSION`, AGENT-RULES). A digest change without a bump fails the gate. That is the
"output-changing engine work" rule, made mechanical.

---

## 3. The service

### 3.1 Shape

```
  web (uvicorn)                                      pine-runtime (new Railway service, private only)
  ┌───────────────────────────────────────┐          ┌──────────────────────────────────────────────┐
  │ alert arm / cycle   scan sweep / live │          │ supervisor (Node, dual-stack HTTP)           │
  │ on-demand scan      backtest replay   │  HMAC    │   auth -> schema -> hash checks -> cache     │
  │ rule record         current-value     │ ───────> │   -> priority queue (alert > on-demand >     │
  │        │                              │  POST    │      backtest > sweep)                       │
  │        ▼                              │ /v1/run  │   -> worker_threads pool (N = vCPU)          │
  │ runtime_definitions.server_lane_      │          │        each: sandbox preamble, the bundle,   │
  │   refusal()  (kill/allow/stage/       │ <─────── │        computeRuntimeColumns(incremental:    │
  │   cohort/engine: ONE authority)       │ columns  │        false), resourceLimits, hard kill,    │
  │ pine_runtime_client.py (ONE door)     │ +refusals│        recycle after K jobs                  │
  │ bars: bars_sqlite (local, as today)   │          │ no volume, no DB, no R2, no market feed      │
  └───────────────────────────────────────┘          └──────────────────────────────────────────────┘
```

- **Callers.** All are on `web` today. The sweep and alert schedulers live in `api/main.py`
  (`scan_evaluator.sweep_job` at `:2243-2281`, the live sweep at `:2359-2368`, the alert cycle in
  `indicator_alert_service`). `worker` gets no caller in v1. If a job moves there, it uses the
  same client module.
- **Bars travel with the request.** The web pod already reads bars locally (`bars_sqlite`, through
  `scan_evaluator._read_bars:1053`, "No network, ever"). The service never fetches bars, which
  keeps it free of network and credentials (section 4). The cost is the request size: about
  240 KB per 5,000-bar symbol as packed Float64. That is fine for alerts (one `(sym, tf)` group)
  and on-demand runs (≤ 500 symbols, `MAX_RUN_SYMBOLS`, `scan_run.py:106`). The nightly sweep is
  sent in chunks of 50 symbols. If sweep traffic is ever measured as the bottleneck, the
  escalation is for the **supervisor** (never a job) to read bars from `bars-api` over the
  private network, re-hashed against the caller's hash. This is not built in v1.
- **Stateless and volume-less.** That makes it the opposite of `web` for deploys: Railway can
  overlap deployments of a service with no volume, so a healthcheck-gated swap costs no 502
  window (`deploy-windows.md:46-67` explains why `web` cannot).
- **Runtime.** Node **20.18.0**, the same pin and the same binary as `Dockerfile.web:52`. Raising
  it is a separate decision, because it moves V8 and therefore HP-3.
- **Image.** `services/pine_runtime/Dockerfile` is built **from the repo root context**. Its
  frontend stage is the same `npm run build` invocation as `Dockerfile.web` stage 1, with the same
  `VITE_*` ARGs (H3). It copies only `node`, `app/dist-server/pine-runtime.mjs` and
  `services/pine_runtime/*.mjs`. ⚠️ Like `chart-renderer`, files are copied individually, so a
  rail lists them, after `chart_renderer/Dockerfile`'s "a new module not listed here is an
  ImportError at boot" lesson.
- **Watch patterns** (to be set on the service when the owner creates it):
  - `services/pine_runtime/**`;
  - `app/src/components/chart/engine/**`;
  - `app/src/lib/marketClock/**`;
  - `app/src/components/chart/indicators.js`;
  - `app/src/components/chart/builder/authoring/crossContext.json`;
  - `app/package*.json`, `app/vite.config.js`.

  ⛔ Every one of these must stay in step with the closure. The T2 closure rail prints any module
  that is in the closure and outside the patterns, the same idea as
  `tools/flow_worker_watch_coverage.py`.

### 3.2 Request contract (`POST /v1/run`)

```jsonc
{
  "protocol": 1,
  "profile": "alert" | "on-demand" | "backtest" | "sweep" | "record",   // priority + limits
  "engine": { "script_engine": 4, "runtime_frontend": "...", "runtime_ir": "...", "bundle_sha256": "..." },
  "definition": {
    "def_id": "u_0123456789ab", "version": 7,
    "doc_sha256": "...",               // sha256 of the canonical JSON of the document sent/cached
    "doc": { ... } | null               // omitted when the service already holds doc_sha256 (409 doc-unknown -> resend)
  },
  "owner": "hmac:9f1c...",              // HMAC(PUSH_SECRET-style key, user_id): quotas + telemetry, never the id (S8 pattern)
  "jobs": [
    {
      "job": "AAPL|D",                  // caller's correlation id
      "symbol": { "ticker": "AAPL", "exchange": "NASDAQ" },
      "tf": "D",
      "bars": { "n": 5000, "t": "<b64 f64le>", "o": "...", "h": "...", "l": "...", "c": "...", "v": "...",
                "sha256": "..." },      // over the canonical encoding; the service recomputes and refuses a mismatch
      "ctx": { "newestBarIsForming": false, "historyFromListing": true, "runtimeInputs": { ... } },
      "want": ["value", "signal"]        // plot keys; empty = all outputs
    }
  ]
}
```

```jsonc
{
  "protocol": 1,
  "engine": { ...the service's own identity... },
  "results": [
    {
      "job": "AAPL|D",
      "status": "ok" | "withheld",
      "columns": { "value": "<b64 f64le, length n>" },          // only on ok; never partial
      "refusals": [ { "key": "signal" | "*", "guard": "runtime:limit", "sentence": "...", "bar": 4123 } ],
      "digest": "...",                                         // section 2.3, so a caller can audit
      "cache": "hit" | "miss", "ms": 41, "instructions": 1830551
    }
  ]
}
```

- **Run-wide refusal** (`key: "*"`): the job is `withheld`, with no columns at all. Examples:
  `runtime:version`, `runtime:limit`, `runtime:time-budget`, `runtime:failed`, the script's own
  `runtime.error`, and `runtime:calc-bars-count`.
- **Per-output refusal**: the job is `ok`, and that key is absent from `columns` and listed in
  `refusals`. Examples: an output the run withholds, and its drawings, which are not served in v1.
- **Validated at the door, closed sets, unknown keys rejected** (the `extra="forbid"` habit of
  `pine_runtime_telemetry.py`):
  - `ctx` keys;
  - `tf` against the chart's TF set;
  - `profile`;
  - `bars.n ≤ 32,768`, all values finite, `t` strictly increasing;
  - `jobs ≤ 500`;
  - `doc` ≤ 128 KiB (`RUNTIME_MAX_DEFINITION_BYTES`);
  - source ≤ 512 KiB (`PROGRAM_SIZE`, re-asked through `sourceSizeRefusal`);
  - body ≤ 16 MiB.
- The service re-runs **`runtimeVersionRefusal`** (`runtimeColumns.js:337`) on every document. A
  document minted by a different front end is `runtime:version`, by the same function and the
  same sentence the chart uses.
- **No `user_id`, no member email, and no source in any log line.** Logs carry a 12-hex
  `doc_sha256` prefix and the owner HMAC, the same pseudonymity S8 states.

### 3.3 Caching

| cache | key | holds | bound | never caches |
|---|---|---|---|---|
| document | `doc_sha256`, recomputed by the service, never trusted from the caller | the parsed document | 2,000 docs / 256 MB LRU | — |
| result | `sha256(engine identity ‖ doc_sha256 ‖ canonical ctx ‖ bars.sha256 ‖ sorted want ‖ profile limits)` | columns + refusals + digest | 512 MB LRU per replica | `runtime:time-budget`, `runtime:server-*`, a worker crash (not deterministic) |
| caller (web) | the same key | the decoded column | per-cycle only | anything across a bars change: the bars hash is in the key, so a stale value **cannot** be served for new bars |

- **Kill and stage are not in the key.** The caller asks `server_lane_refusal` **before every
  use**, so a kill reaches the next use and never waits on cache expiry (section 3.5).
- **Incremental resume (v2, not v1).** The browser resumes a forming bar from the last confirmed
  bar's checkpoint (`runtimeColumns.js:530-621`). The live alert cycle would gain the most from
  it. It needs a session keyed on `(doc, ctx, closed-bars-prefix hash)` and isolated per owner.
  It ships only after B5's tick cost is measured on the service. v1 is stateless; that is
  correctness first.

### 3.4 Resource limits

| limit | value | source |
|---|---|---|
| **instructions (the verdict)** | `INSTRUCTIONS_PER_BAR` 200,000; 200 M per run; loops 5 M per run, 10,000 per `while`; call depth 64; history 32,768 bars | `limits.js` `DEFAULT_LIMITS`, **unchanged and shared**. The server passes no `opts.limits` override. A different number would be a second authority over the verdict. |
| memory (estimate) | `MEMORY` 64 MiB, strings counted since WS-H | `limits.js:194`, `vm.js` `CONCAT` |
| memory (hard) | worker `resourceLimits.maxOldGenerationSizeMb = 256`, `maxYoungGenerationSizeMb = 32`, `stackSizeMb = 4` | new. An overrun kills the worker: `runtime:server-worker-oom`, withheld. |
| wall (safety stop, not a verdict) | VM `WALL_TIME` 5,000 ms (existing); job hard kill 10 s through `worker.terminate()`; a killed worker is **never reused** | the browser rule "a hung worker is never re-run" (PHASE3 1.3) |
| per request | 120 s total; per-profile deadlines: alert 15 s, on-demand 60 s, backtest 60 s, sweep chunk 120 s | new |
| concurrency | workers = vCPU; queue depth 2,000 jobs; full ⇒ `runtime:server-busy` (429) | new |
| fairness | priority alert > on-demand > backtest > record > sweep; per-owner in-flight cap 4 jobs at on-demand (keyed on the owner HMAC); the sweep yields between chunks | new |
| recycle | a worker exits after 500 jobs or 30 min, whichever is first | H6 |

**Sizing is unmeasured on the pod.** The only numbers to hand:

- the browser worker runs 15-94 ms (p95, desktop) per 5,000-bar run for the graded scripts
  (PHASE3 4.3 B2);
- the C4 spike measured 5.5 ns per VM instruction in Node.

So a nightly sweep of one runtime document over the 3,742-symbol universe costs about
**3,742 × ~50 ms ≈ 3 CPU-minutes**. Ten documents is about half an hour of one vCPU. T9 measures
it on the service, and the cap on runtime documents per sweep is owner question Q2.

### 3.5 Kill list, allowlist, stage and cohort parity with the browser

**One authority: `api/services/runtime_definitions.py` on the web pod.** The service holds none of
these values, and it has no variables for them. That prevents a second copy that could disagree.
Every server lane calls one new function before every evaluation:

```python
# runtime_definitions.py (T12) -- the ONLY admission question a server lane asks of a runtime doc
def server_lane_refusal(row, *, lane) -> Optional[tuple[str, str]]:   # (guard, sentence) or None
    1. killed(def_id, source)                  -> ("runtime:killed", ...)          # same fn as stamp_served
    2. not_graded(source)                      -> ("runtime:not-yet-graded", ...)  # same allowlist, R1 admission
    3. owner may draw it:  pane_permitted(owner_role, owner_id)                    # same stage + cohort
                                               -> ("runtime:stage", ...)
    4. server lanes on for that owner: server_permitted(owner_role, owner_id)
                                               -> ("runtime:server-stage", ...)
    5. service configured: PINE_RUNTIME_SERVICE_URL set
                                               -> ("runtime:server-unavailable", ...)
```

- **`PINE_RUNTIME_SERVER_STAGE`** (`off`/`admins`/`cohort`/`all`, unset = `off`, read per call)
  uses the same ladder as `PINE_RUNTIME_STAGE` (`runtime_definitions.py:70-79`). The effective
  server stage is **`min(pane stage, server stage)`**, so the server lanes can never reach a
  member whose chart cannot draw the script.
- It is checked against the definition's **owner**, at **evaluation** time, every cycle. It is not
  checked only at arm time. `USER_FUNCS` keeps the column function; the admission is re-asked on
  each call. Turning the variable down therefore withholds every runtime alert **by name on the
  next cycle**, and nothing is deleted (`feedback_kill_switch_never_a_delete`).
- The shared-link path already stamps kill and allowlist (S4, `stamp_served`). A share install
  re-saves through `_save_runtime`, so the installer's stage applies (PHASE3 1.3).
- Ledger rows go into `docs/feature_flags.json` for:
  - `PINE_RUNTIME_SERVER_STAGE`;
  - `PINE_RUNTIME_SERVICE_URL`;
  - `PINE_RUNTIME_SERVICE_SECRET` (secret, value never recorded);
  - the two PHASE3 S7 rows still owed: `PINE_RUNTIME_KILL_LIST` and `PINE_RUNTIME_ALLOWLIST`.

### 3.6 Authentication between services

- **The private network only.** The service gets **no public domain**. It is reachable only at
  `pine-runtime.railway.internal`.
- **Request signing.** The header is `X-Pine-Runtime-Signature: t=<unix>,v1=<hex>`, where `v1` is
  `HMAC-SHA256(secret, t ‖ "." ‖ sha256(body))`. The service allows 60 s of skew and refuses
  replays inside that window with an in-memory seen-set. The secret is
  `PINE_RUNTIME_SERVICE_SECRET` on both `web` and the service. This is the `CHART_RENDERER_SECRET`
  idiom, strengthened by binding the signature to the body.
- **Rotation.** The service accepts a comma-separated list of secrets, and the web pod signs with
  the first. The sequence is: add the new secret to the service, switch web to it, then remove the
  old one. No step needs both services to restart together.
- **Unauthenticated means 401, and nothing runs.** The client maps 401 to
  `runtime:server-auth` and withholds. It is never retried silently.
- **Responses are not signed in v1.** They travel on the private network, from the only peer that
  holds no secret worth forging. If the topology ever leaves the private network, responses must
  be signed too.

### 3.7 Failure modes: fail closed, withheld by name

| failure | client guard | alert | scan (sweep / live / on-demand) | backtest |
|---|---|---|---|---|
| `PINE_RUNTIME_SERVICE_URL` unset | `runtime:server-unavailable` | not armed / needs-attention | symbol counted `withheld`, never `no hit` | 503 + sentence |
| connect error, DNS, timeout, 5xx | `runtime:server-unavailable` | no fire this cycle; needs-attention after the existing grace | `withheld` | 503 |
| 401 / 403 | `runtime:server-auth` | as above | as above | 503 |
| engine identity ≠ the caller's (the deploy window between web and service) | `runtime:server-engine-mismatch` | as above | as above | 409 |
| doc or bars hash mismatch | `runtime:server-integrity` (a bug: logged loudly) | as above | as above | 500 |
| 429 queue full | `runtime:server-busy` | retried **once** inside the cycle's deadline, then withheld | chunk retried with backoff ≤ 3 times, then the remainder `withheld` with a coverage line | 503 |
| worker OOM / crash / hard kill | `runtime:server-worker-oom` / `-failed` / `runtime:time-budget` | withheld | `withheld` | 409 |
| a run-wide runtime refusal (`runtime:limit`, `runtime:version`, `runtime.error`, …) | the guard itself | withheld, with the guard's sentence | `withheld` | 409 |
| per-output refusal | the guard itself | that plot's alerts withheld; others run | that plot not computable | that plot 409 |
| column length ≠ `bars.n`, or a non-finite value | `runtime:server-integrity` | withheld | `withheld` | 500 |

Rules the client enforces, each with a rail:

1. **Never a stale value.** No last-good fallback exists anywhere. The cache key includes the bars
   hash, so a value can only describe the bars it was computed on.
2. **Never a partial value.** A column is the full length or absent. A batch reply is per-job: one
   job failing withholds that job only, and an `ok` job is never assembled from two runs.
3. **A refusal is never a "no".** A withheld scan symbol goes into `withheld` / `not_computable`
   with its reason, never into the denominator as a non-hit. That is the same discipline as
   `scan_evaluator.evaluate_one`'s four outcomes.
4. **The surface carries the sentence.** The alert path uses `refusal_for_alert` →
   `withheld_alert_detail` (`alert_user_series.py:1325, 1564`).

### 3.8 Observability

- **Boot fingerprint** (one line, grep-able):
  `[pine-runtime] boot engine=<script_engine>/<frontend>/<ir> bundle=<sha12> node=v20.18.0 workers=N`.
- **`GET /health`** is liveness, and it is the Railway `healthcheckPath`. **`GET /ready`** answers
  200 once the bundle is loaded and the canary has passed.
  - ⛔ The healthcheck must not point at `/ready`. The memory rule "NEVER point Railway
    `healthcheckPath` at `/api/ready`" applies by analogy: a readiness probe that withholds the
    only replica turns a slow canary into an outage.
- **`GET /v1/metrics`** (HMAC-signed, the same key) returns:
  - jobs by profile and status;
  - refusals by guard;
  - p50/p95 ms and instructions by profile;
  - queue depth;
  - worker starts, recycles and kills;
  - cache hit rate;
  - heap.
  Web proxies it as admin-only **`GET /api/admin/pine-runtime-status`**, which also reports the
  web side: calls, client-side guards and the last error.
- **Parity canary.** At boot and then every 15 minutes, the service runs 10 corpus cases and
  compares their digests with `expected-digests.json`, which is baked into the image. A mismatch
  sets `/ready` false and logs `[pine-runtime] CANARY DIVERGED case=<name>`. That catches a bad
  build or a V8 surprise before any alert reads it.
- **Telemetry parity with S8.** Stop events use the same closed guard set as
  `api/routers/pine_runtime_telemetry.py`, carry no source and no member id, and are counted by
  the server.
- **Post-deploy smoke** (`tools/pine_runtime_service_smoke.py`, read-only). It uses the exit-code
  convention of `runtime_pane_smoke.py`: 0 PASS, 1 FAILED (roll back), 2 INCONCLUSIVE (never a
  rollback trigger). Its checks are:
  1. the boot fingerprint's engine equals web's;
  2. the canary is green;
  3. a signed `/v1/run` of the allowlisted `adx-and-di-for-v4` over a fixed series returns the
     committed digest;
  4. an unsigned request gets 401.

### 3.9 Rollback

| scope | lever | reach | deletes? |
|---|---|---|---|
| one script | its sha256 or def id on `PINE_RUNTIME_KILL_LIST` (web) | next evaluation | no |
| all server lanes | `PINE_RUNTIME_SERVER_STAGE=off` (web) | next evaluation; every runtime alert reads "withheld" by name | no |
| the service | unset `PINE_RUNTIME_SERVICE_URL` (web), then `railway redeploy --service web` (a delete stages without restarting: CLAUDE.md "`--set` REDEPLOYS, `delete` DOES NOT") | after the redeploy | no |
| a bad service build | Railway rollback to the previous service deployment. It is stateless, so this is instant and needs no data migration. | minutes | no |
| the code | revert on `master` → gate → `production` | a deploy | no |

**The engine-mismatch window.** Web and the service deploy from the same `production` commit but
on separate triggers. Between the two swaps they can disagree on engine identity. During that
window the client answers `runtime:server-engine-mismatch` and withholds. It never computes with a
mismatched engine. Expected duration: minutes, once per engine bump. This is accepted and stated,
not hidden.

---

## 4. Security model for member-supplied code

This builds on PHASE3 1.3, whose controls all still hold: no code generation, a switch-dispatch VM
over a flat instruction array, no clock, network or module state in the VM (`vm.js:19-22`), the
CPU and memory limits, and the kill list and allowlist. W5 changes **where** the code runs. The
layers below are what make that change safe.

**Threat model.** A member's Pine source (or a published or shared one) tries to:

1. read other members' data or the platform's secrets;
2. reach the network;
3. exhaust CPU or memory to deny alerts to other members;
4. learn about another member's job (cross-tenant leakage or cache poisoning);
5. persist across jobs.

| # | layer | control | rail (task) |
|---|---|---|---|
| L1 | **language** | No `eval` / `new Function` / dynamic `import` in the server bundle. The VM is a switch over `[op, a, b]`. The script's only inputs are OHLCV, inputs, ticker, exchange and tf. | a scan of the built `pine-runtime.mjs` for `eval(`, `Function(`, `import(`, `require(`, `process.`, `child_process`, `fs`, `net`, `http` — **red on any hit outside an allowlisted line** (T7) |
| L2 | **nothing worth stealing** | The service has **no volume, no database, no R2 keys, no Massive key, no member data at rest, and no env except `PORT` and `PINE_RUNTIME_SERVICE_SECRET`**. Even a full escape from the VM finds only the in-flight request and the inbound HMAC key. | a boot check refuses to start if any variable outside an allowlist is set (T6). It catches a copy-pasted service that inherits web's env, which Railway copies on duplication (CLAUDE.md, "REJECTED: Railway PR environments"). |
| L3 | **worker isolation** | Each job runs in a `worker_thread`. The worker's preamble deletes `fetch`, `WebSocket`, `XMLHttpRequest`, `EventSource`, `process.binding`, `require`, and timers beyond what the VM needs, then freezes `globalThis`, **before** the bundle is evaluated. `resourceLimits` set a hard heap. `terminate()` is the hard stop, and a terminated worker is never reused. | hostile corpus (below): every case ends in a named stop and the supervisor stays healthy (T7) |
| L4 | **process / OS** | Non-root user, read-only root filesystem except `/tmp`. Run Node with `--disallow-code-generation-from-strings` (V8 refuses `eval` even if L1 regressed). Also run with `--experimental-permission --allow-fs-read=/app --allow-worker` (Node 20 permission model: no fs writes, no child processes, no native addons). ⚠️ Node 20's permission model does **not** cover the network, and Railway has no egress firewall. Network denial therefore rests on L1 + L3, and L2 bounds the damage. | a boot self-test tries `fs.writeFileSync('/app/x')` and `child_process.spawn` from inside a worker, and both must throw (T7) |
| L5 | **input validation** | Closed schema at the door (section 3.2). `doc_sha256` and `bars.sha256` are **recomputed** by the service. Sizes are capped before parse. `runtimeInputs` are validated by the shipped `runtimeBuildInputs`. | fuzz rail: malformed, oversized or extra-key bodies give 400 with zero jobs run (T6) |
| L6 | **multi-tenancy** | `incremental: false` plus a session and ledger reset per job, plus recycling (H6). The result cache is keyed on content the service hashed itself, so a caller cannot file a result under another document's key. Responses carry only their own jobs. | a cross-tenant rail: job A then job B on the same worker, where B's columns equal a cold run of B (T7) |
| L7 | **denial of service** | The instruction budgets decide, and they are deterministic. Wall time and heap are hard stops. Queue depth, priority and per-owner caps (section 3.4) apply, and per-script kills need no deploy. | a load rail: 50 hostile jobs at sweep priority, where one alert job still completes inside its deadline (T7) |
| L8 | **supply chain** | The bundle is built in the same Docker build from the same lockfile. The only third-party code is `jsep` (inlined). The bundle's sha256 is part of the engine identity, so an unexpected build changes the identity and fails HP-6 and the canary. | HP-1, HP-6 |

**The hostile corpus** is committed with the host-parity corpus. Each case must end in a named stop
in both hosts:

| case | expected stop |
|---|---|
| infinite `while` | `runtime:limit` / `WHILE_ITERATIONS` |
| `for` up to 1e12 | `runtime:limit` |
| string doubling | `MEMORY_EXCEEDED` (S2) |
| array growth | the `ARRAY_ELEMENTS` limit |
| deep UDF recursion | refused at build (recursion is refused) |
| 512 KiB + 1 source | `PROGRAM_SIZE` |
| 200k-node expression | IR limit |
| `request.security` | `runtime:request` |
| `varip` on a sliding window | `runtime:varip` |

---

## 5. Integration, file by file

### 5.1 The changes

**New files:**

| file | role | task |
|---|---|---|
| `app/src/components/chart/engine/runtime/serverEntry.js` | the server bundle's entry: re-exports `computeRuntimeColumns`, `runtimeVersionRefusal`, `resetRuntimeSessions`, `resetRuntimeLedgers` and the engine-identity constants. **No logic.** | T1 |
| `app/scripts/build-pine-runtime.mjs` (+ `npm run build` hook) | builds `app/dist-server/pine-runtime.mjs` with the same `define`s as the client build | T1 |
| `app/src/components/chart/engine/runtime/columnDigest.js` + `api/services/pine_runtime_codec.py` | canonical encoding and digest, one per host, held equal by `tests/fixtures/pine_runtime/codec_parity.json` | T3 |
| `tools/pine_runtime_host_parity.mjs` + `tools/pine_runtime_host_parity.py` (Chromium half) + `runtime/__fixtures__/hostParity/` | HP-1 … HP-8 | T4, T5 |
| `services/pine_runtime/{Dockerfile, server.mjs, protocol.mjs, auth.mjs, pool.mjs, job.mjs, sandbox.mjs, cache.mjs, canary.mjs, railway.json}` | the service | T6-T10 |
| `api/services/pine_runtime_client.py` | **the one door**: signs, sends, decodes, verifies length and digest, and maps every failure to a guard from section 3.7. A fake service for tests lives in `tests/fakes/pine_runtime_fake.py`. | T11 |
| `api/services/runtime_server_lane.py` | `runtime_column_fn(row, plot_key, lane)` → a callable `(bars, params) -> column` that asks `server_lane_refusal` and `engine_withheld_reason` on **every call** | T11 |
| `tools/pine_runtime_service_smoke.py` | post-deploy smoke (3.8) | T9 |
| `docs/runbooks/pine-runtime-service.md` | operator steps, levers, smoke | T19 |

**Changed files** (line numbers at `6272ed7fa3`):

| file | change | task |
|---|---|---|
| `api/services/runtime_definitions.py` | `server_stage()`, `server_permitted()` and `server_lane_refusal()` (3.5) beside `stage()`/`pane_permitted()` (`:146-175`), plus their mode-flag table entry (`:86`) | T12 |
| `api/services/alert_user_series.py` | `_gate_lane` (`:882`) admits `kind == "runtime"` when `server_lane_refusal` is None; otherwise it raises `AdmissionRefused` with the guard's sentence (new fragment `server-lane`). New `_make_runtime_value_fn` beside `_make_value_fn` (`:537`), returning the last finite value of the service's column through the same `_last_finite` (`:270`). For runtime documents, `_gate_cross_lane` (`:1052`) is **replaced** by `_gate_runtime_service`: one service run on the alert's own bars must return `ok` for the plot at arm. The host parity is proved by HP-3 at build time, not per arm. `_gate_repaint` (`:916`) reads `runtime_definitions.repaint_stamp`. `_gate_budget` (`:968`) does not apply (the runtime's budgets are in the service). `lookback_for_alert` (`:812`) returns the profile's window (5,000 D / 32,768 intraday) for a runtime document, because it has no tree to measure. `user_value_function` (`:1213`, prefill) and `user_catalog` (`:1453`) list runtime plots. | T13 |
| `api/services/indicator_alert_service.py` | `create` (`:376`) is unchanged (it goes through `arm_for_alert`). The cycle batches every runtime alert of one `(sym, tf)` group into **one** service request over the group's bars. | T13 |
| `api/services/screener/scan_evaluator.py` | the sweep candidate filter (`:2668-2672`) admits runtime documents that pass `server_lane_refusal(lane="sweep")`. `evaluate_one` (`:1410`) gets a runtime branch that sends universe chunks with `_read_bars` (`:1053`) and maps service outcomes onto its existing `answered / dropped / not_computable / withheld` counts. `result_identity` uses the runtime handle (`runtime_definitions.HASH_PREFIX`, `:108`). The live sweep (`live_sweep_job`) uses profile `sweep` at a priority below alerts. | T14 |
| `api/services/screener/scan_run.py` | `_load_definition` (`:353-367`): a runtime refusal becomes `gate:not-scannable` with the guard's sentence | T14 |
| `api/routers/screener_backtest.py` | `:419`: a runtime document replays through the client (profile `backtest`) instead of the 400 | T15 |
| `api/services/definition_record.py` | `record_runtime_pass` beside `record_pass` (`:485`). `def_hash` is **derived** from the stored runtime handle (never accepted), and the warm-up pad is read from the run's own warm-up (`runtimeWarmupOf`, returned by the service) instead of `ast_interpret.max_lookback`. The forward-only origin rule is unchanged. | T16 |
| `api/services/user_definitions.py` | `engine_withheld_reason` (`:2317`) is unchanged for `ast`. For runtime documents, the stored `refused` verdict binds the same way, and `_awaits_retranslation` (`:2302`) answers False, because a runtime document is recompiled from source on every run. `consumer_refusal` (`:1734`) gets a runtime requirements read (a runtime document that names `request.*` is already refused at mint, `runtime:request`). | T17 |
| `api/routers/user_definitions.py` | `_stamped` (`:309`) adds `server_lanes: {alerts, screener, scans}`, each `true` or `{guard, sentence}`, computed by `server_lane_refusal`, so the editor's "Runs on" line (programme plan 3.1) reads the server's answer | T17 |
| `docs/feature_flags.json` | four rows (3.5) | T12 |
| `docs/pine/PHASE3-RUNTIME-PLAN.md` | S1 and 1.3 rewritten (top of this doc) | T13 |
| `.github/workflows/master-deploy-gate.yml` | section 8 | T19 |

### 5.2 How `meta.blockRuns`, `engine_withheld_reason` and the runtime's refusals compose

There is one fixed order. The **first** refusal that applies is the one shown, by name. Each step
is a different question, and no step re-derives another's answer.

```
 1. definition gates      _gate_definition (exists, this account, this version)        -> "definition"
 2. stored verdict        user_definitions.engine_withheld_reason(row)                 -> "withheld" (engine-refused: ...)
 3. consumer contract     user_definitions.consumer_refusal(lane, requirements)        -> "requirements"
 4. runtime admission     runtime_definitions.server_lane_refusal(row, lane)           -> runtime:killed | not-yet-graded |
                                                                                           stage | server-stage | server-unavailable
 5. per-plot block gates  block_runs.block_runs_for(definition, key)                   -> pine:block
       ast documents only. meta.blockRuns is stamped by the HOST translation (blockRuns.js). A runtime
       document carrying meta.blockRuns is malformed: refused "definition" (validate() rejects it at save, T17).
       The runtime lane's own analogue (conditional ta.*, PHASE3 3.6 item 1) is decided INSIDE the run and
       comes back at step 6 as a guard.
 6. the run               the service: runtime:version, run-wide guards (limit, time-budget, failed,
                          runtime.error, calc-bars-count, varip, request), per-output guards
 7. transport             runtime:server-* (3.7)
```

- Steps 1-3 are **unchanged** from today. They already run before the lane check in every lane
  (1.1).
- Step 4 runs **before** any network call, so a killed script costs no service time.
- Step 6's guards are the **same guard names** the chart shows (HP-5). A member therefore reads
  the same reason on the chart and on the alert, which is the property `engine_withheld_reason`'s
  docstring states (`user_definitions.py:2339`): "a chart never draws what the alerts withhold,
  or the reverse".
- **The known exception is wall time.** It stays a host property until R3 is ruled. Until then a
  `runtime:time-budget` stop on either side is shown as such on that side and is never stored as
  a verdict.
- **A composition rail** (T17) builds one row per step, each with exactly that step's condition
  set. It asserts the reported guard and that no service call happens for steps 1-5. It is
  mutation-proved per step: drop a step and its row goes red.

### 5.3 Out of scope for v1, and refused by name

- **Drawings** (labels, lines, boxes, tables) in server lanes. No server lane consumes drawings
  today. If a request asks for one, it is refused as a per-output refusal.
- **`alertcondition()`** in runtime documents. It needs its own alert-address shape, so it is a
  follow-up.
- **Firing on a forming bar.** v1 evaluates closed bars only (`newestBarIsForming: false`, last
  closed bar). Q3.
- **Other symbols or timeframes** (`request.*`). They are refused at mint today (`runtime:request`)
  and stay refused (W7).

---

## 6. Performance and capacity (what is known, what is not)

| | value | status |
|---|---|---|
| browser worker, 5,000 D bars, graded scripts | p95 15-94 ms desktop, 46-566 ms at x4 throttle | measured (PHASE3 4.3 B2) |
| VM dispatch in Node | 5.5-6.2 ns per instruction | measured (C4 spike, a toy program) |
| bare-Node run of the shipped closure | — | **not measured here** (2.1); T1 rail |
| service request overhead | — | T9 |
| sweep, 1 runtime doc × 3,742 symbols | ≈ 3 CPU-min (estimate: 3,742 × ~50 ms) | estimate; T9 measures |
| alert cycle | one request per `(sym, tf)` group carrying every runtime alert on it | design |

---

## 7. Phased build plan (one agent per task)

Sizes: **S** ≤ 1 day, **M** 2-4 days, **L** 1-2 weeks. Each task lists its own files, so parallel
tasks do not collide. Every guard a task adds is mutation-proved (AGENT-RULES): remove it, a named
rail goes red, then restore it from the saved bytes.

### P0: one source, two hosts (no infrastructure)

| task | size | owns | delivers | rails | depends |
|---|---|---|---|---|---|
| **T1 Server bundle** | S | `runtime/serverEntry.js`, `app/scripts/build-pine-runtime.mjs`, `app/package.json` build script | `app/dist-server/pine-runtime.mjs`, built from the same sources with the same `define`s; **the first measured bare-Node run** (5,000 D bars, timing recorded) | the bundle imports under bare `node` with no `node_modules`; no bare imports remain; every JSON is inlined; identity constants are exported | — |
| **T2 Host-neutral closure** | M | `runtimeColumns.js` (clock injection lines only), `ast/pine.js` `TRANSLATE_DEADLINE` (`:6700-6735`), the import edges into `runtimeKill`/`serverCompute`/`nativeRegistry`/`runtimePaneGate`/`lowerTfGate`, `objectColumns.js` registration seam | every clock injectable; compute closure free of network modules and build gates; `tools/pine_runtime_closure.mjs` (2.1 walk) as a rail with a forbidden-module list and a watch-pattern coverage print | closure rail + mutation (re-add one import → red); **0 C18 diffs** (AGENT-RULES; the coordinator measures) | T1 |
| **T3 Canonical codec** | S | `runtime/columnDigest.js`, `api/services/pine_runtime_codec.py`, `tests/fixtures/pine_runtime/codec_parity.json` | the encoding and digest from 2.3 in both languages | round-trip rail; NaN-payload, `-0`, `null`/`undefined` cases; a fixture-distinguishes control | — |
| **T4 Host-parity rail** | L | `tools/pine_runtime_host_parity.{mjs,py}`, `runtime/__fixtures__/hostParity/**` | HP-1 … HP-7: corpus, committed digests, Node half, Chromium half on the real worker chunk, mutation control | itself; HP-4 must go red on the perturbed bundle | T1, T3 |
| **T5 Cross-engine report** | S | `docs/pine/evidence/w5-host-parity/` | HP-8 on WebKit and Firefox, plus the tz/DST fixture (H7), as a report | — (report only) | T4 (or T3 alone for tz) |

### P1: the service (built and tested locally; no Railway)

| task | size | owns | delivers | rails | depends |
|---|---|---|---|---|---|
| **T6 Supervisor + protocol + auth** | M | `services/pine_runtime/{server.mjs,protocol.mjs,auth.mjs}` | dual-stack listener (the chart-renderer lesson), closed schema, HMAC with rotation, `/health` `/ready`, env allowlist boot check (L2) | fuzz rail (L5); unsigned → 401 with zero jobs; replay refused; dual-stack connects on both families | T1 |
| **T7 Pool + sandbox** | M | `services/pine_runtime/{pool.mjs,job.mjs,sandbox.mjs}` | worker_threads, preamble (L3), resourceLimits, hard kill, recycle, per-job reset (H6), priority queue, per-owner caps; HP-7 adapter agreement | hostile corpus; cross-tenant rail (L6); load rail (L7); L1 bundle scan; L4 self-test | T1, T6 |
| **T8 Caches** | S | `services/pine_runtime/cache.mjs` | document and result LRU (3.3), with no caching of non-deterministic stops | key-sensitivity rail: each key component changes the key; a mismatched `doc_sha256` is refused | T6 |
| **T9 Observability + canary + smoke** | S | `services/pine_runtime/canary.mjs`, `/v1/metrics`, `tools/pine_runtime_service_smoke.py` | 3.8 and **the first capacity numbers** (request overhead, sweep CPU/symbol on a container capped at the proposed vCPU) | the canary goes red on a perturbed bundle; smoke exit codes 0/1/2 each produced by a fixture | T4, T7 |
| **T10 Image** | S | `services/pine_runtime/{Dockerfile,railway.json}` | root-context build, same Node binary, same `VITE_*` ARGs as `Dockerfile.web`, non-root, read-only FS, node flags (L4), files listed individually | a test parses both Dockerfiles: the Node pin and the `VITE_*` ARG set are equal (one authority, read not retyped); every `services/pine_runtime/*.mjs` is copied | T6, T7 |

### P2: the server lanes (web pod; against the fake service, then a local real one)

| task | size | owns | delivers | rails | depends |
|---|---|---|---|---|---|
| **T11 Client + lane adapter** | M | `api/services/pine_runtime_client.py`, `api/services/runtime_server_lane.py`, `tests/fakes/pine_runtime_fake.py` | the one door; the failure taxonomy of 3.7; the batch API | one rail per row of 3.7; "never stale" (a bars change → a cache miss); "never partial" (a short column → integrity) | T3 |
| **T12 Admission + flags** | S | `api/services/runtime_definitions.py` (new functions only), `docs/feature_flags.json` | `server_stage`, `server_permitted`, `server_lane_refusal`; `min(pane, server)`; the four ledger rows | stage-ladder rail (typo → off); the server stage can never exceed the pane stage; a kill reaches the next call | — |
| **T13 Alerts** | M | `api/services/alert_user_series.py` (gates listed in 5.1), `indicator_alert_service.py` (cycle batching), `PHASE3-RUNTIME-PLAN.md` S1 | arm and cycle for runtime plots | arm, refuse, kill-mid-life, service-down → needs-attention; one request per group | T11, T12 |
| **T14 Scans** | M | `scan_evaluator.py` (filter + runtime branch), `scan_run.py` `_load_definition` | sweep, live and on-demand | withheld counted as withheld, never a non-hit; chunking; coverage line on partial failure | T11, T12 |
| **T15 Backtest** | S | `api/routers/screener_backtest.py` | replay through the client | 409/503 mapping; no 400 for runtime | T11, T12 |
| **T16 Rule record** | S | `api/services/definition_record.py` | `record_runtime_pass` | the forward-only origin still enforced; `def_hash` derived; warm-up pad from the run | T11 |
| **T17 Composition + stamps** | S | `user_definitions.py` (runtime branches named in 5.1), `routers/user_definitions.py` `_stamped`, `runtime_definitions.validate` (a runtime doc with `meta.blockRuns` is rejected) | 5.2 order; `server_lanes` stamp | composition matrix rail, mutation per step | T12 |
| **T18 Editor status** (optional) | S | the Builder status panel component | "Runs on: chart, alerts, screener" from `server_lanes` | render rail over the four states | T17 |

### P3: deploy

| task | size | owns | delivers | depends |
|---|---|---|---|---|
| **T19 Gate + runbook** | S | `.github/workflows/master-deploy-gate.yml`, `docs/runbooks/pine-runtime-service.md`, a `deploy-windows.md` line | section 8 | T4, T10, T11 |
| **T20 Railway (OWNER)** | — | Railway dashboard | create the `pine-runtime` service from `services/pine_runtime/railway.json`, trigger branch `production`, watch patterns from 3.1, private only; set `PINE_RUNTIME_SERVICE_SECRET` on both services, then `PINE_RUNTIME_SERVICE_URL` on web; `PINE_RUNTIME_SERVER_STAGE` stays unset (off) until the smoke passes | T19 |

**Count: 18 required agent tasks**, plus T18 (optional) and T20 (the owner's Railway step):

- **S × 11:** T1, T3, T5, T8, T9, T10, T12, T15, T16, T17, T19;
- **M × 6:** T2, T6, T7, T11, T13, T14;
- **L × 1:** T4.

Critical path: T1 → T4 → T9/T19 → T20, about 3-4 weeks with the parallel lanes below. That fits
the plan's W5 estimate of 3-6 weeks.

**Parallel waves:**

1. **Wave 1:** T1, T3, T5 (tz half), T6, T12. No shared files.
2. **Wave 2:** T2, T4, T7, T8, T11.
3. **Wave 3:** T9, T10, T13, T14, T15, T16, T17.
4. **Wave 4:** T18, T19, then T20.

**Staged arming, after T20.** These are the PHASE3 4.5 stages, applied to the server stage:

1. `PINE_RUNTIME_SERVER_STAGE=admins` with the allowlist only, for 1 week. Exit needs:
   - zero `runtime:server-integrity`;
   - the canary green;
   - the smoke green on each deploy.
2. `cohort`.
3. `all`. This step never runs ahead of the pane stage.

---

## 8. Rails and deploy-gate additions

**Added to `master deploy gate`.** Each step is offline and cheap. The gate already runs
`npm ci` (`master-deploy-gate.yml:366-368`), so `node` is present.

1. **Server bundle builds and imports under bare Node.** `node app/scripts/build-pine-runtime.mjs
   && node -e "import('./app/dist-server/pine-runtime.mjs')"` (T1).
2. **Host parity, Node half (HP-1 + HP-4 control + HP-5).**
   `node tools/pine_runtime_host_parity.mjs --host node --check` (T4). A digest change without an
   engine bump is red.
3. **Engine identity agrees (HP-6) and adapters agree (HP-7).**
   `pytest tests/test_pine_runtime_engine_identity.py` (T4, T7).
4. **Closure stays host-neutral.** `node tools/pine_runtime_closure.mjs --check` (T2).
5. **Service unit rails.** `node --test services/pine_runtime/` covers protocol, auth, sandbox,
   hostile corpus and caches (T6-T8).
6. **Client + composition.** `pytest tests/test_pine_runtime_client.py
   tests/test_pine_runtime_composition.py tests/test_pine_runtime_server_stage.py` (T11, T12, T17).
7. **Dockerfile agreement.** `pytest tests/test_pine_runtime_dockerfile.py` (T10).

**Pre-merge, by the coordinator, under the heavy lock (too heavy for the gate):** HP-2/HP-3 (the
Chromium half, the full corpus) and the C18 diff count.

**Post-deploy:** `tools/pine_runtime_service_smoke.py`. Exit 1 means roll back first (H15); exit 2
is inconclusive and never a trigger.

**Deploy-windows classification** (to add to `docs/runbooks/deploy-windows.md` in T19, as one
line pointing here):

- The `pine-runtime` service is **Tier 1**.
- It is not on flow-worker's watch list, has no volume, and overlaps on deploy.
- A push that touches `engine/**` restarts both `web` and `pine-runtime`. During the swap, runtime
  evaluations read `runtime:server-unavailable` or `runtime:server-engine-mismatch` for minutes,
  and are withheld by name. That is acceptable, and the never-delay-a-deploy rule stands.
- `tools/flow_worker_watch_coverage.py` is unaffected: nothing here is in flow-worker's closure.

---

## 9. Open owner questions

1. **R3: verdicts on instructions, not wall time.** This is PHASE3 4.6 R3, and W5 makes it
   blocking. The server cannot reproduce a device's wall clock. Until R3 is ruled, the chart and
   the alerts can disagree on any script near the 1,000 ms pane budget.
   - Recommended: verdicts come from the deterministic instruction budget, on both hosts.
   - Wall time is a named safety stop only, never stored.
2. **Q2: capacity and cost.**
   - Service size: proposed 2 vCPU / 2 GB, scaled by T9's numbers.
   - The cap on runtime documents in the nightly sweep: proposed 25 at stage `admins`/`cohort`,
     measured before `all`.
   - Whether sweep compute for member-authored runtime documents is a per-member quota.
3. **Q3: closed bar or forming bar for runtime alerts.**
   - v1 proposal: closed bars only, which is deterministic and needs no session state.
   - Forming-bar alerts need the v2 incremental session (3.3) and a realtime capture (WS-F).
4. **Q4: a separate server stage variable.** `PINE_RUNTIME_SERVER_STAGE` with `min(pane, server)`
   (recommended), or reuse `PINE_RUNTIME_STAGE` for both, which is simpler but cannot arm the
   chart without also arming alerts.
5. **Q5: bars transport.** Bars sent by the caller (v1, recommended: the service stays
   network-free), or the supervisor reading `bars-api` for the sweep later. The second gives the
   service a network peer.
6. **Q6: browser engines outside V8.** Accept that Safari and Firefox charts may differ from
   alerts in the last bit, reported by HP-8, or require a tolerance-free cross-engine gate. That
   would need the runtime's transcendental functions replaced by a shared JS implementation, an
   engine-wide change.
7. **Q7: the deploy-window mismatch.** Accept minutes of `runtime:server-engine-mismatch`
   withholding per engine bump (recommended), or have the service also serve engine N-1. That
   doubles the bundle and the parity matrix.
8. **Q8: who may trigger service work.** At `all`, any member's saved runtime script can consume
   sweep CPU. Should runtime documents be sweepable only after a MATCH grade (the allowlist), as
   the pane is today, or as soon as they attach?

---

## 10. How the numbers here were taken

- **Import closure (2.1).** A static walk from `app/src/components/chart/engine/runtime/runtimeColumns.js`
  on `6272ed7fa3`, run with `node v24.13.1`. It resolves relative `import`/`export … from`/`import()`,
  extensionless and `index.js` forms. It counts modules (excluding `.json`) and their lines. Bare
  specifiers and JSON files are listed separately. Global reads are found with a regex over source
  with comments stripped, and every hit in the table was then confirmed by reading the line (the
  regex over-reports words like "window" in identifiers and prose, so the regex counts are not
  quoted). The script is reproduced as T2's `tools/pine_runtime_closure.mjs`.
- **Everything else** is cited to a file and line, or to the PHASE3 / C4 measurement it comes
  from. **Nothing here was measured against production.** No endpoint, variable or database was
  read.
