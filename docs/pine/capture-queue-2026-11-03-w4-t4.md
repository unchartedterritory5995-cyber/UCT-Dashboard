# Capture queue: 2026-11-03, W4 T4 `?:` arms that run only when chosen

Branch `feat/pine-w4-t4-conditional-arms`. Same procedure as `docs/pine/capture-queue-2026-09-28.md`:
visibility gate, **Create new > Indicator**, the "Add to chart" binding gate, `__uctVH.capture({...})`,
chunks, `verify_capture.mjs --assemble`. Inputs at defaults. None of the probes below has been compiled
on TradingView: a row that does not compile names its line, so split it out and capture the rest.

## What the runtime lane does now

A Pine v6 `?:` lowered at the root of the script, whose test changes from bar to bar, and whose arms
hold `ta.sma`, `ta.ema`, `ta.rma` or a one-argument `ta.change` (over a source with no history of its
own), is lowered as a jump: only the picked arm runs, so those calls keep the history of that arm's runs
(`pineRuntimeFrontend.js` `armHistoryGuard`, `servedCondCall`; `lowerIr.js` `EXPR.TERNARY` `lazy`).
Witnessed by `vw-arm-history-rddt-1d-2026-10-02` and `vw-arm-history-spy-1d-2026-10-02` rows T03 / T04 /
T05 / K02 / K03 / N02, all MATCH through the runtime lane (`vendorHarness.w4ArmHistory.test.js`).

Every other arm shape stays refused by name (`runtime:conditional-history`). The rows already queued
elsewhere are reused by their ids, not copied:
- Pine v5 `?:` arms: Q-PT1 (`capture-queue-2026-10-31-prod-ternary.md`, `vw-arm-history-v5.pine`);
- v1-v4 `?:` arms: Q-PT3 / Q-PT4; v4 `iff`: H10 (`capture-queue-2026-10-31-wsc-history.md`);
- other `ta.*` in an arm: H1 (`stdev` / `sum` / `median`), H3 (`atr` / `rsi`), H5 (`highest` /
  `lowest`); `(expr)[k]` in an arm: H9; v6 `and` / `or`: H7.

## Rows

| row | probe | chart | guards | named scripts | settles | gates |
|---|---|---|---|---|---|---|
| W4-A1 | `vw-w4-arm-runs.pine` rows C01 / C02 (and E01) | NYSE:RDDT 1D from the listing; AMEX:SPY 1D | `runtime:conditional-history` | none in the sample yet | `ta.change(x, n)` with n >= 2 in an arm: n RUNS back (the one-argument form's rule) or n BARS back. Refused now; the every-bar two-argument form is also a closed-table gap (`runtime:statement`) | serving `ta.change(x, n)` in an arm |
| W4-A2 | `vw-w4-arm-runs.pine` rows R01 / R02 (and E02) | NYSE:RDDT 1D from the listing; AMEX:SPY 1D | `runtime:conditional-history` | none in the sample yet | `ta.rma` in an arm: the `ta.ema` recurrence with alpha 1/n, seeded by the mean of its first n RUNS. SERVED now by inference from `ta.ema` (T04) and the block rule (WS-C `bf17bd46c8`, a reference rail, no capture). A mismatch takes `rma` out of the served set for arms AND blocks | confirming `ta.rma` (arms and blocks) |
| W4-A3 | `vw-w4-arm-runs.pine` row N01 | NYSE:RDDT 1D from the listing; AMEX:SPY 1D | `runtime:conditional-history` | none in the sample yet | a `?:` inside an arm: the inner call counts the runs where both tests pick it. Refused now (the outer arm is not served when it holds a nested arm with history) | serving nested arms |
| W4-A4 | `vw-w4-arm-runs.pine` rows W01 / W02 / W03 (and E03 / E04) | NYSE:RDDT 1D from the listing; AMEX:SPY 1D | `runtime:conditional-history` | none in the sample yet | Pine's carried built-ins in an arm (`ta.valuewhen`, `ta.barssince`, `fixnan`) step only on that arm's runs. Before W4 T4 this lane served these with `SELECT` (every bar, no note); they are refused now | serving carried built-ins in arms |
