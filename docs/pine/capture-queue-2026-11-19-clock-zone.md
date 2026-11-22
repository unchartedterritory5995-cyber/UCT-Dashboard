# Capture queue: the exchange's zone off New York (2026-11-19)

Filed for coordinator patrick-2b by the language-units engine work (C1, the time-related queue). This file holds
probes only. No engine change rides on it, and none is built on these rows until their captures are read.

## Q-CLK-1: the exchange's zone on a crypto and an FX symbol

The runtime lane reads `timestamp(year, month, day, hour, minute)` and the clock fields (`hour`, `dayofweek`, ...)
in the exchange's zone, with the zone left implicit. The v6 reference, for `timestamp`, says: "The default is
syminfo.timezone".

This engine answers the exchange's zone only on a New York symbol: NYSE, NASDAQ and NYSE Arca are witnessed
(`pineRuntimeFrontend.js::requireNewYorkExchange`). Everywhere else it refuses by name (`runtime:clock-zone`).
Widening that needs TradingView's own answer on a symbol whose exchange keeps another zone. The coordinator
ruled on 2026-11-19 not to widen until this capture is read.

Every row is a daily chart from the listing, with the inputs at their defaults (the probe has none). A line that
does not compile is itself a reading: record the error text and the line, remove only that row, and capture the
rest.

| id | probe | chart | live | what to record | unblocks |
|---|---|---|---|---|---|
| Q-CLK-1a | `tools/visual_conformance/probes/vw-clk1-exchange-zone.pine` | BITSTAMP:BTCUSD 1D from the listing | no | every plot on every bar (T01, T02, D01, H01, H02, W01); the text of the newest label (`Z00 <syminfo.timezone>`) | the exchange's zone on a crypto symbol: `timestamp(y, m, d, h, mm)` with the zone implicit, the clock fields |
| Q-CLK-1b | `tools/visual_conformance/probes/vw-clk1-exchange-zone.pine` | FX:EURUSD 1D from the listing | no | the same | the same, on an FX symbol |

## Built probes

Each probe's sha256 is the queue's (`python tools/vendor_harness/evidence_engine.py queue`), read off the
committed file. A capture records the source it ran, so a capture of an edited probe never closes its row.

- `vw-clk1-exchange-zone.pine`: `27f4b11e3dcf4ece337aed981f5f5e8a0a7b1538757a44b817e83bc754313d4d`
