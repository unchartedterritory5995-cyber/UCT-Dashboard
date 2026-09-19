# Z-order — the implementation contract

Pine orders every visual into **nine ascending buckets**; Lightweight Charts offers **four
effective slots**. The reconciliation — which bucket lands where, and why — is
[`lwc5-capability-map.md` §3](lwc5-capability-map.md), and **that document is the authority**.

⛔ **This page deliberately does not restate the bucket table.** A second copy of an ordered
list of nine things is the exact defect this repo keeps paying for, and an ordering is the worst
case of it: a transposed pair produces a chart that is wrong in a way no test of any individual
primitive can see. `app/src/components/chart/engine/zorder.js` **parses the bucket order out of
the capability map in its tests**, so the code and the map cannot drift; if you need the table,
read it there.

What follows is only what the *implementation* guarantees, refuses, and requires of its callers.

---

## 1. The module

`app/src/components/chart/engine/zorder.js` computes order and draws nothing. It imports no
chart library and holds no canvas, so every rule below is a pure function with a unit test.

| Export | What it answers |
|---|---|
| `PINE_BUCKETS` | the nine buckets, ascending (index 0 painted first) |
| `BUCKET_SOURCES` | which Pine construct lands in which bucket |
| `LWC_ASSIGNMENT` | per bucket: mechanism, zOrder slot, sub-pass, attach position, physical rank |
| `ATTACH_SEQUENCE` | ⛔ the one true attach order for the four layers that share a slot |
| `paintOrder(elements, opts)` | the elements in the exact order Pine paints them |
| `placementFor(bucket, flags)` | the LWC placement **plus what it refuses to express** |
| `validate(placements)` | does a proposed placement preserve Pine's rules? |
| `KNOWN_LOSSES` | the capability map's loss ids, so the two can be diffed |

## 2. ⛔⛔ The attach rule — the one thing a caller must not get wrong

Nine buckets collapse onto **six** distinct physical positions. Buckets 5–8 — linefills, lines,
boxes, labels — all land in the *same* slot (`'normal'` + `draw()`) and are separated by
**nothing except the order their layers were attached**.

That works because LWC keeps primitives in a plain array (`push` on attach, `filter` on detach),
so draw order within one zOrder layer *is* attach order. It is a structural guarantee, not a
convention — and it is fragile in one specific way:

> **Any other `'normal'` primitive attached to the drawings' host series after the label layer
> jumps above the labels.** There is no id, no dedupe, no cap.

So: **attach from one place, in `ATTACH_SEQUENCE` order, and never let application code attach
to the drawings' host series.** `primitiveGate.test.js` already polices *which* call sites may
attach at all; `zorder.js` says in what order.

```js
import { ATTACH_SEQUENCE } from './zorder'   // ['linefills', 'lines', 'boxes', 'labels']
```

Three tests hold this down: the sequence is exactly the attach-ordered buckets, it runs
low-bucket to high-bucket, and all four genuinely share one slot and one sub-pass — because if
they did not, attach order would not be what separates them and the sequence would be decoration.

## 3. What the module refuses, by name

`placementFor` returns a `refusals` array rather than a placement that looks fine and is wrong.
A caller that ignores a refusal ships the wrong z-order; a caller that never sees one cannot
know to ask.

| Refusal | Why |
|---|---|
| `pine:explicit-zorder-hline` | `explicit_plot_zorder = true` collapses fills/plots/hlines into call order, but `priceLineView` is hard-wired *after* `seriesPaneView` inside `Series.paneViews()`. While an hline is a `createPriceLine` it can never be pushed below a plot. Render hlines inside the ordered primitive layers instead. (Loss **L3**) |
| `pine:behind-chart` | `behind_chart` **defaults to `true`**, so the script's visuals belong behind the chart's own candles — but the main series is just another series and there is no "chart layer" to hide behind. The fix is to sort the main price series last, whose paint-order semantics are **UNVERIFIED**. (Losses **L4**, **L2**) |

## 4. Two rules that hold structurally, not by checking

**A plot can never appear on top of a table.** Pine states this as its hard rule. It holds here
because a *pane* primitive at `'normal'` always paints beneath *every* series primitive — you
cannot reorder that — so a table at `'normal'` would sit under the plots. Tables therefore go to
`'top'` or the DOM, and that mechanism *is* the enforcement. (Loss **L5**)

**Within a bucket, the element created last paints on top.** `paintOrder` sorts stably and
honours an explicit `seq`. ⚠️ An unstable sort would reorder same-bucket elements arbitrarily
between renders — a flicker nobody can reproduce.

## 5. The correction to the generic advice

The plugin guidance says to use `drawBackground()` at `'normal'` for fills that belong under the
series. **That is right for `bgcolor` and wrong for the other two:**

- **`linefill` is bucket 5 — above the plots.** In `drawBackground` it renders *below* every plot.
- **A box's fill is part of bucket 7 — also above the plots.** Putting box fills in
  `drawBackground` for the sake of translucency sinks them below the plot lines. A translucent
  box fill is *supposed* to tint the plots it covers.
- Only **`fill()`** (bucket 2) genuinely belongs in `drawBackground`, and **`bgcolor`** (bucket 1)
  belongs lower still, at `'bottom'`.

`validate()` catches both inversions by name.

## 6. Verification status

32 unit tests. Mutation-verified in both directions, each probe restored from a pristine copy:
transposing two buckets reddens 7 · reversing the attach sequence reddens 2 · demoting tables to
`'normal'` reddens 2 · sinking linefills into `drawBackground` reddens 4 · deleting the
`explicit_plot_zorder` refusal reddens 1 · flipping the stability tiebreak reddens 2.

⚠️ **The stability probe initially reported a false pass**, and the cause is worth recording: the
fixture used three structurally identical objects, so `toEqual` could not distinguish a reversed
array from an unchanged one. The elements are tagged now. A mutation that does not redden is
either a missing rail or an unapplied mutation — check which before believing either.

⚠️ **UNVERIFIED and inherited from the capability map**: `setSeriesOrder`'s paint-order semantics
(**L2**, which **L4** depends on), and whether TradingView draws its own grid above or below a
Pine `bgcolor` (**L7**). Neither is decided here; both are named where they bite.
