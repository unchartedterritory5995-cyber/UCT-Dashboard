# Capture queue — 2026-10-04 F9, colour rules this door withholds or reads at the wrong line

Branch `pine/f9-divergence-sweep`. For the capture lane to run on the live TradingView rig with
`tools/vendor_harness/tv_capture.js` (procedure as `docs/pine/capture-queue-2026-09-28.md`).
⚠️ The probe is not compiled on TradingView yet: if a row does not compile, the error names the line — split it out.

The rules are in `docs/pine/vendor-harness/objects-triage-2026-09-28.md` § F9.

| id | probe / script | chart | question | what the engine does today | what the capture changes |
|---|---|---|---|---|---|
| Q-F9a | `tools/visual_conformance/probes/vw-f9-colour-rules.pine` rows N01-N03 | NYSE:RDDT 1D from the listing (AMEX:SPY 1D second) | an `na` leaf that a TEST selects, inside `color.new(..., t)`: black at `t` (RT9's C03 reading of `color.new(color(na), 40)`) or nothing? | `pine.js::colorNewOverRule` DECLINES a rule with an `na` leaf (`colorDynamic`: the pane's gold, the pre-F9 state) | carry N01-N03 as a palette with the measured `na` entry |
| Q-F9b | same probe, rows V01-V02 | same | a `var` colour with an `na` write, bare and under `color.new` | V01: carried (`colourStateRule`, the `na` entry transparent, as a chain's `na` leaf). V02: declined (the `na` leaf rule above) | confirms V01's transparent entry; settles V02 with Q-F9a |
| Q-F9c | same probe, rows R01-R02 | same | a colour NAME read above its own reassignment: the colour at the plot's line (red) or the program's last word? | every colour reader resolves names against the END-of-program env (`outputPresentation`'s `env`), so R01 is read as R02's rule — a `var` colour (F9) checks the plot's own line and declines, a plain name does not | if TradingView draws R01 red (Pine's top-to-bottom rule), colour readers move to the output's `positionEnv`. Measured on the way (F9): reading plot colours against `positionEnv` moves 0 of the 266 committed corpus scripts' outputs, so the change is cheap once witnessed; not made without the capture |
