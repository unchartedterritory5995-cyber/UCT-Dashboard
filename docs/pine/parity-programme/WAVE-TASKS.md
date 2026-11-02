# Pine full-parity programme: detailed task list (work from this on any machine)

Read first: `PLAN.md` (why/what), `AGENT-RULES.md` (rules every worker follows), `RESUME-LAPTOP.md`
(setup + ship loop). Numbers come from `docs/pine/COVERAGE-MAP.md` and
`docs/pine/PHASE3-RUNTIME-PLAN.md` unless a newer W0 doc exists
(`docs/pine/COVERAGE-MAP-2026-11-02.md` on branch `docs/pine-coverage-2026-11-02`): prefer it.

## 0. How to pick up a workstream that was in flight

Each running stream pushed a `WIP(<stream>): ...` commit at hand-off. Its message states what is
done, half-done, next, and the exact test/measurement it was waiting on.
```
git fetch origin
git log --format='%h %s%n%b' origin/master..origin/<branch> | head -60   # read the WIP state
git worktree add ~/uct-worktrees/<name> origin/<branch> -b <branch>-cont  # or track the branch
```
Then hand the WIP message + this file's section for that stream to a fresh agent (or do it
yourself), with `AGENT-RULES.md`. If a branch was never pushed, restart that stream from its
section below.

## 1. Definition of done (every task)
1. Exact vs TradingView where drawn (vendor capture MATCH or reference-formula rail), otherwise
   refused by name with a capture-queue row.
2. Rails red before the fix, green after; every new guard mutation-proved.
3. Independent opus review GO.
4. Full `src/components/chart` + `src/hooks` vitest on the merged tip (only known pre-existing
   failures allowed), deploy-gate pytest + hygiene clean.
5. Engine changes: `scripts/measure-pair.sh` vs master shows 0 unintended C18 / plot / harness /
   census diffs; every intended diff classified in the PR body.
6. SCRIPT_ENGINE_VERSION +1 if translator output changed. Merge, `scripts/verify_deploy.sh`,
   SMOKE PASS. Update the stream table in `RESUME-LAPTOP.md`.

## 2. Streams and tasks

### W0 Measurement (branch `docs/pine-coverage-2026-11-02`)
- W0.1 Production-lane census + runtime-on census on current master (separate caches).
- W0.2 Vendor harness both lanes.
- W0.3 Regenerate the coverage map with `tools/pine_coverage/coverage_map.py`; per wall, the exact
  script list it blocks; per wave, its target script list.
- W0.4 Rank TradingView captures by "attaches -> MATCH" conversions; feed to E.
- Re-run W0 after every 2-3 merged waves; it is the programme's scoreboard.

### W1 Names and robustness (branch `feat/pine-w1-names`) ~+40 upper / +24 firm
- W1.1 Derive the missing-name list from code + census (do not trust old docs).
- W1.2 Volume family: `ta.obv`, `ta.cmf`, `ta.accdist`, `ta.nvi`, `ta.pvi` (both lanes).
- W1.3 Oscillators: `ta.tsi`, `ta.swma`, any remaining from the census.
- W1.4 Calendar/time names per lane: `dayofmonth/month/year/hour/minute/dayofweek`,
  `timeframe.in_seconds`, `timeframe.isdwm` (respect the pre-1990 clock fix and weekend/session
  withholds already live).
- W1.5 `fixnan`, `barstate.isnew`, `line.get_price`, `input.time`, `input.enum`.
- W1.6 Role-order maps: `ta.cci`, `ta.valuewhen`, `ta.barssince` (positional vs named args).
- W1.7 Translator timeouts / round-trip failures: fix root causes, never raise budgets.
- Ship in batches of 4-6 names. Each name: na/warmup semantics pinned; capture row if no MATCH.

### W2 Arm the runtime lane (branch `feat/pine-w2-arming`) owner decision
- W2.1 Evaluate PHASE3 s4 checklist item by item on master (cite file:line + measurement).
- W2.2 Close small safety gaps (e.g. mount the S8 telemetry router if still unmounted, string
  memory accounting, kill/allowlist stamping on /shared, stop telemetry).
- W2.3 `docs/pine/ARMING-PACKET-2026-11-02.md`: per-item PASS/FAIL/NEEDS-OWNER, stage-1 allowlist
  (graded-MATCH scripts + capture ids), exact env/flag changes per stage, rollback, watch list.
- W2.4 OWNER: approve stage 1 (admins), then allowlist, cohort `rollout:pine-runtime-pane`, all.
  Never set Railway variables without the owner's explicit go.

### W3 Drawing-object completeness (branch `feat/pine-w3-drawings`) ~+119 / +64
Slices, in order of scripts unblocked (re-rank from W0):
- W3.1 Conditional create (`guard:create`, 129 scripts).
- W3.2 Labels created per bar (`create:label`, 83) within pool limits / creation order / ids.
- W3.3 `table.cell` text (`cell:text`, 80).
- W3.4 Conditional delete / update (68 / 66).
- W3.5 Drawings in loops (`guard:loop`, 62).
- W3.6 Collection-held drawings (`coll:diverged`, 41).
- W3.7 `polyline.new`, `chart.point`, `linefill.new` completeness.
- W3.8 Paint-only output contract.
Keep: never draw where TradingView hides; C37 version colour defaults; objectPool limits.

### W4 Finish the runtime lane (after W2 stage 1) ~+170 upper / +48 firm (PHASE3 s0)
- W4.1 History and series semantics (+44/+12).
- W4.2 Statement and block-value grammar (+39/+5) (WS-A shipped the first part).
- W4.3 Drawing and presentation from the run (+34/+8).
- W4.4 Builtins over runtime state + missing names (+32/+17).
- W4.5 Input kinds (+16/+3).
- W4.6 `varip` and realtime (+5/+3).
Each slice must keep C18 door output identical unless an intended, classified change.

### W5 Server-side interpreter (branch `docs/pine-w5-server-runtime`) owner chose a separate sandboxed service
- W5.1 Finish `docs/pine/SERVER-RUNTIME-DESIGN.md` (contract, caching, limits, security, failure
  = withheld by name, observability, rollback).
- W5.2 Make runtime modules host-agnostic (browser + Node), one semantic source.
- W5.3 Browser/server parity rail over the corpus (byte-identical columns).
- W5.4 Service skeleton (no prod infra until owner go), auth between services, kill/allowlist
  stamping parity.
- W5.5 Wire alerts / scans / screener / backtest to call it for runtime-lane definitions.
- W5.6 OWNER: create the Railway service + variables; staged enable.

### Editor status panel (branch `feat/pine-editor-status`, flag `VITE_PINE_EDITOR_STATUS`, dark)
- E1 Spec (`docs/pine/EDITOR-STATUS-PANEL-SPEC.md`) - pushed.
- E2 Panel + per-line markers wired into PineBox from the existing refusal/withheld sources
  (no second source of reason text); mobile per breakpoints; a11y.
- E3 Paste-from-TradingView flow (paste / URL for open-source -> verdict -> chart / screener /
  alert in one click).
- E4 Ship dark, then OWNER turns the flag on.

### W6 Collections, UDTs, methods, enums, generics, `for...in` (after W4) ~+30 / +11
- W6.1 `array.*` complete on the runtime lane; W6.2 `map.*`; W6.3 `matrix.*`;
- W6.4 `type` / `method` / `enum` / generics; W6.5 `for...in`.

### W7 `request.*` (after W4; part data) ~+41 / +19
- W7.1 Same-symbol higher TF with `lookahead` / `gaps` and repaint semantics (capture-pinned).
- W7.2 Other symbols beyond the benchmark roster (data contract; OWNER).
- W7.3 Lower-TF arrays (`request.security_lower_tf`, ship C41 work).
- W7.4 Other `request.*` (financials/economic/dividends/splits) only where data exists; else
  refused by name with the data source named.

### W8 Libraries `import` (after W4, W6) ~+59 / +19
- W8.1 Resolve published open-source libraries (fetch, cache, version pin).
- W8.2 Module translation / runtime linking; exported functions, types, methods.
- W8.3 Version semantics and license handling (docs/pine/LICENSING.md).

### W9 Strategy tester (after W4) ~+70 / +28 (owner: in scope)
- W9.1 Broker emulator (fills, slippage, commission, pyramiding, `process_orders_on_close`,
  bar magnifier off/on) pinned by captures.
- W9.2 `strategy.*` read-backs (position_size, equity, openprofit, ...).
- W9.3 Trade markers on chart + tester report (performance summary, list of trades).
- W9.4 Server-side backtests via W5.

### E Evidence engine (branch `feat/pine-evidence-engine`)
- E.1 Design doc - pushed. E.2 Offline half: capture-queue aggregator (priority = scripts
  unblocked), fixture writer/validator, grader wiring, tests. E.3 Online capture script the OWNER
  runs with the dedicated Chrome rig (own profile; never the everyday browser; never sign in for
  the owner; read numbers from the chart model, not pixels). E.4 Burn down the queue in priority
  order after each wave.

## 3. Sequencing summary
Now: W0, W1, W2 packet, W3, Editor, W5 design, E offline (parallel; heavy jobs serialized by lock).
After W2 stage 1: W4. After W4: W5 build, W6, W7, W9. After W6: W8. E runs throughout.
Re-run W0 after every couple of merges; update `RESUME-LAPTOP.md` table at every hand-off.
