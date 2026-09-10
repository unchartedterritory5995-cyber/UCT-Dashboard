# Probe scripts for the live-chart visit

Pine sources pasted into the TradingView editor during a capture session. Kept in the
repo so a visit is a paste-and-read rather than an authoring session, and so the exact
text that produced a fixture is versioned beside it.

| File | Answers | Ruling |
|---|---|---|
| `barstate-append.pine` | `isrealtime` / `isnew` / `islastconfirmedhistory` | barstate capture |
| `fold-pass.pine` | does a timeframe ternary fold to an integer window? | Ruling 1g · Volume line 233 |
| `tickerid-containment.pine` | what does a `tickerid` look like per instrument class? | Ruling h · Volume line 222 |
| `exchange-spelling.pine` | what string does `syminfo.exchange` return? | `symbolScope.json::confirmed` |
| `tuple-security.pine` | 8-field tuple order · gaps×lookahead incl. the DEFAULTS · na before first HTF bar · forming vs closed HTF · same-tf | runbook item 3 · Volume line 259 |

⛔⛔ **`tickerid-containment.pine` and `exchange-spelling.pine` ARE NOT INTERCHANGEABLE.** They read different `syminfo` fields and answer different questions. The 2026-09-09 capture ran the first and `symbolScope.json::confirmed` stayed empty, because the map is keyed on `syminfo.exchange` and that run never read it. The vendor can rewrite a prefix (`SP:SPX` → `SP_DLY:SPX`), so a tickerid prefix is not evidence about `syminfo.exchange` — `exchange-spelling.pine` N11 measures that gap rather than assuming it closed.

Aroon needs no probe — it is a TradingView built-in; add it at length 14 and read the pane.

⚠️ **Every predicate is plotted as `? 1 : 0`.** The capture reads plot VALUES out of the
chart model and a bool plot carries no numeric value. That is the instrument, not the
semantics.

⛔ **Follow `docs/pine/capture-procedure.md`.** In particular: never add a study while the
tab is hidden, and restore symbol, timeframe, pane stretch factors and study visibility
afterwards.
