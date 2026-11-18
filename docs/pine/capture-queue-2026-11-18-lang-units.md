# Capture queue: language units and the evidence audit (2026-11-18)

Filed for coordinator patrick-2b by the language-units engine work (U-STMT, U-COLOUR, U-COND, U-BLOCK,
U-LOOP; `docs/pine/PARITY-ROADMAP-2026-11-18.md` section 5) and the evidence audit. Probes only: no engine
change rides on this file, and no engine change is built on these rows until their captures are read.

Every chart is a daily chart with the inputs at their defaults (no probe has an input it needs set). A line
that does not compile is a reading: record the error text and the line, remove only that row, and capture
the rest. Captures are read after the close.

## CR-C1: a block that runs on one historical bar (U-COND)

committed:trendlinesample__61d59f90bc (v4) does all its work inside `if barstate.islast`: it draws two lines,
deletes `sup[1]` / `res[1]` there, and alerts on a cross read there. Pine keeps a call's history per call site
(C48), and on a closed chart that block runs once. The runtime lane refuses it today
(`runtime:conditional-history`); what TradingView answers for a block local's `[1]`, a stateful built-in's
first run and a `line.delete(l[1])` there is not captured. Each row's reading is a label on the newest bar.

| id | probe | chart | live | what to record | unblocks |
|---|---|---|---|---|---|
| Q-ISLAST-1 | `tools/visual_conformance/probes/vw-lastbar-block-history.pine` | NYSE:RDDT 1D | no | the text of every label on the newest bar (L1-L6, E3-E5); the line count and the line's coordinates | U-COND: trendlinesample__61d59f90bc |
| Q-ISLAST-2 | `tools/visual_conformance/probes/vw-lastbar-block-history.pine` | AMEX:SPY 1D | no | the same | the same, on a second symbol: trendlinesample__61d59f90bc |
| Q-ISLAST-3 | `tools/visual_conformance/probes/vw-lastbar-block-history-v4.pine` | NYSE:RDDT 1D | no | the same, plus L5N | trendlinesample__61d59f90bc is written in v4 |
| Q-ISLAST-4 | `tools/visual_conformance/probes/vw-lastbar-block-history-v4.pine` | AMEX:SPY 1D | no | the same | the same, on a second symbol: trendlinesample__61d59f90bc |

## CR-B1: a `switch` with no default and an `if` with no `else`, over colour, string and bool arms (U-BLOCK)

The v6 reference (`switch`, Remarks): "If the result of the switch statement is assigned to a variable and a
default_local_block is not specified, the statement returns na if no local_block is executed." What that `na` is
for a colour, a string and a bool arm (a v6 bool is never `na`) is not captured, so the runtime lane refuses
such a block by name (`runtime:block-value`). In each probe `m = bar_index % 3`; on m == 0 no arm runs.

| id | probe | chart | live | what to record | unblocks |
|---|---|---|---|---|---|
| Q-BV1 | `tools/visual_conformance/probes/vw-block-na-arms.pine` | AMEX:SPY 1D | no | every plot on every bar; the text of the newest 30 labels | U-BLOCK: the no-default colour, string and bool shapes (v6) |
| Q-BV2 | `tools/visual_conformance/probes/vw-block-na-arms.pine` | NYSE:RDDT 1D | no | the same | the same, on a second symbol |
| Q-BV3 | `tools/visual_conformance/probes/vw-block-na-arms-v5.pine` | AMEX:SPY 1D | no | the same, plus the two bool na() rows | the same shapes in v5 |
| Q-BV4 | `tools/visual_conformance/probes/vw-block-na-arms-v5.pine` | NYSE:RDDT 1D | no | the same | the same, on a second symbol |

## CR-S1: the `input.time` default forms (RULING-0927 r1)

Re-forwarded, already queued and still uncaptured (capture-queue-2026-10-31-wsd-input-kinds.md, AMEX:SPY 1D):
Q-D2 `vw-input-time-zones.pine` (its row T01 is exactly the form committed:machine-learning-knn-based-strategy
writes, "01 Jan 2000 00:00:00 GMT+10"), Q-D1 `vw-input-time-default.pine` and Q-D4 `vw-input-time-forms.pine`.
New here: the MONTH-FIRST form two sample scripts write, which no probe held.

| id | probe | chart | live | what to record | unblocks |
|---|---|---|---|---|---|
| Q-D6 | `tools/visual_conformance/probes/vw-input-time-month-first.pine` | AMEX:SPY 1D | no | every plot (each is constant on every bar) | RULING-0927 r1: the month-first `timestamp` default (atr-god-strategy-by-tradesmart__4369755a29) |

## Evidence audit: `varip` on history and the OSGSRR matrix members

`vw-wsf-realtime-var-varip.pine` (Q-WSF1..4) needs a live session, and its row R03 (`barstate.isnew`) is a name
the runtime lane refuses, so a capture of it cannot be graded whole. Q-VARIP-2 reads the same counters on
history only. Q-MAT-1 uses only the four matrix members committed:one-sided-gaussian-support-resistance-rate-loxx__c801e68b6c
uses (`matrix.new<float>`, `matrix.set`, `matrix.get`, `matrix.rows`), in its shapes.

| id | probe | chart | live | what to record | unblocks |
|---|---|---|---|---|---|
| Q-VARIP-2a | `tools/visual_conformance/probes/vw-varip-history.pine` | NYSE:RDDT 1D from the listing | no | every plot on every bar; whether R02 equals R01 on every historical bar | admit:varip |
| Q-VARIP-2b | `tools/visual_conformance/probes/vw-varip-history.pine` | AMEX:SPY 1D from the listing | no | the same | the same, on a second symbol |
| Q-MAT-1a | `tools/visual_conformance/probes/vw-matrix-osgsrr-members.pine` | NYSE:RDDT 1D from the listing | no | every plot on every bar | admit:collections:matrix: one-sided-gaussian-support-resistance-rate-loxx__c801e68b6c |
| Q-MAT-1b | `tools/visual_conformance/probes/vw-matrix-osgsrr-members.pine` | AMEX:SPY 1D from the listing | no | the same | the same, on a second symbol: one-sided-gaussian-support-resistance-rate-loxx__c801e68b6c |

## Built probes

Each probe's sha256 is the queue's (`python tools/vendor_harness/evidence_engine.py queue`), read off the
committed file; a capture records the source it ran, so a capture of an edited probe never closes its row.

- `vw-lastbar-block-history.pine`: `c41763d56cc4edd4f40d3f68ab0d41a71bf6b7b5f6d09149c70d4af61a90d07e`
- `vw-lastbar-block-history-v4.pine`: `d1fcefd1dc5e481ecfa5e3d085eed1eb25d2d8f0504e1d5b42ffbd1b0092cf0a`
- `vw-block-na-arms.pine`: `941677e7308e19e57c4cece2256ce1d926d4fefbd8ad76552331f0b8dd96d372`
- `vw-block-na-arms-v5.pine`: `6e6cf42621a632ef417b342ef5daafd1904e317e9dab3b8c6d3ec701eb54ec4c`
- `vw-input-time-month-first.pine`: `8e3f9df481631b2a9551ea23994f31769c7b451b213ae45ebaffc3b54abdf5f6`
- `vw-varip-history.pine`: `acf6fe35241ff5fac19afb0fe5ba3f4b59e896819d30ccdd23724e336ec31a91`
- `vw-matrix-osgsrr-members.pine`: `9c5ff840f1de50c4eed8650f89fc556947df919dfa1845cacb048fc341768783`
