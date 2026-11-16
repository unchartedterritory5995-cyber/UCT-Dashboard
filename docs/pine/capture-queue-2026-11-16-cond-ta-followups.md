# Capture queue and follow-up units: COND-TA (engine 58), 2026-11-16

Rows left open by the COND-TA merge. The reasons and measurements are in
`docs/pine/evidence/2026-11-15-cond-ta/EVIDENCE.md`.

## Follow-up unit, next after the RS Rating admission

**Screener-lane run check + the hoist offer.** One unit, three things it closes:

| what | today | closed when |
|---|---|---|
| The right side of a Pine v6 `and` / `or` on the screener lane | SERVED every-bar, as master did. A known TradingView difference (interim ruling B). | The Import door offers to move the call to its own line (the hoist offer, the same surface as the mintick offer), and the screener lane then refuses the un-hoisted shape by name. `pine.screenerCorpus` and the `pine.blindCorpus` accepted floor must not drop. |
| Six over-refused outputs: `smoothed-moving-average` 1, `williams-alligator` 3, `smart-money-concepts-by-welotrades` 2 | REFUSED by name on the screener lane; drawn on the host lane. Master's number was right. | The gate is evaluated per symbol server-side (the run check), so an arm that runs on a prefix of bars is served. |
| A saved Pine Apply import holding the seed shape | HELD, and re-applying refuses. | Same run check. |
| A member notice on the Import door for the v6 `and` / `or` shape | Not built (it needs a new note code; skipped under the ruling's one-hour limit). | With the hoist offer. |

Rails that go red when this unit lands, on purpose: `ast/condTaLanes.test.js` sections 7 and 8.

## Captures to take

| id | probe | what it settles |
|---|---|---|
| Q-CT1 | `tools/visual_conformance/probes/vw-andor-history.pine` (written 2026-10-31, never captured) on NYSE:RDDT 1D from the listing, then AMEX:SPY 1D | A `ta.*` on the right of a v6 `and` / `or`. Today the rule is stated by TradingView's to-v6 migration guide; NOT captured (probe `vw-andor-history` written 2026-10-31, never taken). ⛔ The follow-up unit must not switch the screener-lane refusal on until this row is captured and graded. Top of the next capture session. Rows B01 to B05 against the per-run reference (B01 differs from the every-bar reading on 84 of 636 RDDT bars, B02 on 53, B03 on 7, by the reference that matched `vw-arm-history` T03 to T05). |
| Q-CT3 | `vw-deadband-ticks-brk-a` on NYSE:BRK.A 1D, re-read of `…-2026-11-15` | `D01_mintick` has no column on our side (the member pane did not carry it), which is all that keeps the re-take INCONCLUSIVE on the runtime lane rather than MATCH; every other plot agrees on 11,369 / 11,369 bars. Not a new capture: an engine row (carry the hidden helper, or state why not). Until then the 09-28 capture stays the named `WITHHELD_WHOLE` exception. |
| Q-CT2 | `tools/visual_conformance/probes/vw-pt-na-guard-and.pine` and `vw-wsc-h7-v6-shortcircuit.pine`, same symbols | The same rule beside an `na` guard, and for `or`. |

## Not a capture: a colour gap made visible

| capture | what | owner |
|---|---|---|
| `flying-buddha-inside-bars-indicator-v1-by-justunclel-rddt-1d-2026-11-14` (held store, s7) | `plotarrow(…, colorup = lime, colordown = red, transp = 20)`: `colorup` / `colordown` are not carried. On 16 of 666 bars TradingView paints `#2962ffcc` and we paint the default series colour `#c9a84ccc`. Its five value plots agree on 666 / 666 bars. It was refused whole before COND-TA's parameter guards (`pine:block`), so the capture moved INCONCLUSIVE -> DIVERGE on both lanes: a newly graded gap that was already there, not a value regression. | the next colour unit (coordinator) |
