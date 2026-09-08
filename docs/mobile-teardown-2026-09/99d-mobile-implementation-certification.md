# Mobile implementation — final certification

Branch `fix/mobile-legend-legacy-state`, code tip `f8d625c27`.
Certified 2026-09-08 against the twelve conditions set for this sprint.

---

# VERDICT: **MOBILE IMPLEMENTATION CERTIFIED WITH EXPLICIT RESIDUALS**

Not FULL, and the reasons are named below rather than softened. Three build items
were deferred on judgement, one whole class of verification is blocked by an
account limit and an authentication boundary I am not permitted to cross, and
landscape is measured for presentation but not for application state.

⛔ **Not NOT_CERTIFIED either**, and that distinction is real: every Wave-1 item
closed, **seven** surviving build items shipped with behavioural gates and
mutation proofs, the largest workflow gap in the whole study (F19, workspace
save/restore) is now a UCT advantage, and — the headline — the presentation
register shows **no orphaned mobile tasks at all**. All five are repaired.

---

## The twelve conditions, answered one at a time

| # | condition | status |
|---|---|---|
| 1 | surviving HIGH-VALUE build items completed or explicitly blocked | ✅ 6 shipped · 4 deferred **with stated reasons** (`99b`) |
| 2 | no known high-value orphaned mobile task remains | ✅ **all five repaired** — percent scale · `$ Vol`/`Avg ND` · Clear-all · Repeat · Drawing Boards |
| 3 | Wave 1 integration passes | ✅ `f1370b73b`, 24 cases on one chart |
| 4 | real-device portrait QA passes | 🟡 **presentation ALL PASS on a real iPhone**; app workflows BLOCKED |
| 5 | landscape measured or residual with cause | ✅ measured for presentation, **residual for app state**, cause stated |
| 6 | workspace/layout persistence passes | ✅ MOB-01 door + MOB-09 sync repair |
| 7 | chart/drawing/indicator/alert/scale flows coherent | ✅ see `99c` |
| 8 | 20 critical workflows rerun | ✅ `99c` |
| 9 | performance acceptable | ✅ no new polling, no new subscription, no new state |
| 10 | accessibility / touch pass | ✅ **measured at 390px, not asserted** — 18 tiles at min **83×64**, no document overflow, search font **16px** (below that iOS zooms the page and does not zoom back), and the one sub-44px element (the 20px repeat checkbox) has a **348×58 label as its actual target**, verified by clicking the label and watching the box toggle |
| 11 | tests clean apart from proven pre-existing failures | ✅ **8,064 passed · 5 failed · 4 skipped** across 413 files, `RUNNER_EXIT=1` read from the RUNNER, not a pipe. All 5 proven pre-existing — see below |
| 12 | working tree clean, commits pushed | ✅ branch pushed to origin; no production deploy (that would be a push to `master`, which was not authorised) |

---

## What shipped tonight

| commit | item |
|---|---|
| `0f1a5e2f5` | **MOB-06′** — percent scale reaches the phone; `$ Vol`/`Avg ND` become contextual; the presentation contract |
| `f1370b73b` | **Wave 1 integration** — 24 cases on one chart, incl. the named Percent/Log regression rail |
| `ecfec4a2c` | **MOB-09** — the highwatermark stops claiming what the server never received |
| `c35345c00` | **MOB-04** — every drawing tool reachable without knowing to swipe |
| `3930bb0a3` | **Clear-all + Repeat** — the two remaining MOB-06′ orphans |
| `f04bd486c` | **MOB-11 + MOB-18** — "Point N of M", and a way out of a half-finished placement |
| `47dd0bbcc` | rail fix — Repeat was costing two thirds of the tools strip |
| `cb0cfc2d2` | program rebase + the 20-workflow rerun |
| `178e965ce` | `setPref`'s write-confirmation contract, pinned |
| `f8d625c27` | **Drawing Boards** — the last high-value orphan gets a phone door |

---

## The residuals, stated as residuals

### R1 · Real-device QA of the authenticated app — BLOCKED
Two independent causes, both measured tonight, neither inferred:
1. The BrowserStack account is a **Free Trial capped at one minute per device**,
   enforced ("you have used up the available Free Trial minutes on this device").
2. The device reaches the app as `bs-local.com` — a different host from the
   sandbox's `127.0.0.1` — so it carries no session and lands on a login form.
   **Entering a password is a prohibited action for me.**

What that did *not* block: the presentation questions need no login, so a
separate no-auth vite entry rendering the real `StockChart` against fixture bars
carried every verdict on-page, and a real iPhone 13 returned **ALL PASS** in both
orientations — `pointer: coarse` true, `.volXtra` revealed, `.volLegend` hidden,
`.scaleToggle` hidden, V + `$ Vol` + `Avg 50D` + OHLC all present, no overflow.

**To clear R1:** a plan with usable session length, or the owner signing the
sandbox account in during a session. Both are owner actions.

### R2 · MOB-05 · object → alert binding — DEFERRED
The one cluster where TradingView is simply better. It needs an alert-row schema
change *and* a change to server-side alert evaluation, and R1 means there is no
way to watch a bound alert actually fire. Shipping an unverifiable change to when
a member's alerts trigger is not a trade worth making.

### R3 · MOB-10 · per-object Hide — DEFERRED on product grounds
Drawings carry `locked` but no `hidden`. Hiding an object that then vanishes with
no list to unhide it from creates the ACCIDENTALLY_UNAVAILABLE state this sprint
forbids, and the object tree that would fix it (MOB-15) is deferred. Half of this
is worse than none of it, so TradingView stays ahead on F12 and `99c` says so.

### R4 · MOB-08 · `presentation[deviceClass]` — DEFERRED
`L` complexity, MEDIUM risk, a persistence-shape migration on the workspace
record — the one place a careless refactor produces a blank board.

### R5 · Landscape as a MODE — measured for presentation only
Portrait → landscape → portrait verified live on a real iPhone 13 / iOS 17.5.
Application state across rotation (symbol, timeframe, drawings, open sheets) is
**not** measured; it needs the authenticated app, i.e. R1.

### R6 · ~~Drawing Boards has no phone door~~ — **CLOSED**
Shipped in `f8d625c27` after evaluating it on value rather than because it was on
a list. It earned it: MOB-09 had just made a phone correctly ADOPT boards it
still had no way to choose between, and half a fix is its own defect. The
register in `98` §3.2 now shows **no orphaned mobile tasks at all**.

---

## One thing I got wrong tonight, recorded

I shipped the Repeat toggle onto the drawing rail. Every test passed. At 390px it
left the tool strip **51px wide — 0.98 of one tile**, down from the ~3 the
research had cited as the defect I was fixing. jsdom does no layout, so no test
could see it; opening the artifact in a browser is what caught it. Repeat moved
to the Tools sheet, where the interaction grammar says a set-once mode belongs
anyway, and the rail recovered to 93px.

Three other instruments failed during this sprint and were fixed rather than
worked around: a mutation harness that read "never ran" as "passed" (vitest's
`-t` is a regex, and `$ Vol` anchors to end-of-input); a device readout that
stopped polling and reported frozen portrait values as landscape ones; and a
canvas-hash diff that reported zero changes because it was hashing the wrong
canvases. **Every one of them would have produced a confident false pass.**

---

# The five questions, answered plainly

## 1 · Is UCT now at least as capable as TradingView on the high-value mobile charting workflows?

**Yes, on the whole — with two named exceptions and one honest asterisk.**

Across the 20 rerun flows: **UCT ahead on 11, parity on 5, TradingView ahead on 2,
a genuine product-model difference on 1, and 1 partial** (landscape). The baseline
was 5 / 6 / 2 / 3 / 4-unresolved. Four of the movements came from closing gaps;
two came from *measuring* things the research had left unresolved and finding UCT
already ahead.

The asterisk: "capable" here means the workflows were exercised through the real
doors by tests and, for presentation, on real hardware. The authenticated app was
**not** driven end-to-end on a phone tonight (R1). I am not claiming device-proven
workflow parity; I am claiming the doors exist, are wired, and are gated.

## 2 · Where is UCT better?

Not "different" — measurably better:

- **The arrival.** `/charts` lands on a chart. TradingView routes every entry
  through a symbol screen first.
- **The watchlist → chart loop.** One tap per symbol. TradingView's watchlist tap
  does not open a chart, ever — two taps per symbol, on the single most repeated
  action of a review session.
- **The crosshair.** One hold returns date, O, H, L, C, **V, $ Vol, Avg 50D**,
  change, change %, every moving average and every indicator chip — verified on a
  real iPhone. This is the densest single readout in the comparison.
- **The price-context sheet.** Long-press a price and get draw-at-this-price, copy
  price, set an alert here, and the whole scale group — broader than TradingView's
  ⊕ menu, and it was nearly written up as a *missing* feature before being
  measured.
- **`Set level…`** — exact numeric positioning of a drawing. UCT answers occlusion
  with typed precision instead of a magnified cursor.
- **Type-aware object menus.** The rows adapt to what you selected rather than
  being one fixed list.
- **The indicator chip menu** — Settings, Show/Hide, Move to pane, Duplicate, Add
  alert, About, Remove, with refusals written as sentences.
- **Workspaces.** Named, server-backed, cross-device, with firm-published
  prebuilts, and now reachable from the phone.
- **Alert creation cost.** Three gestures, zero typing.

## 3 · Where is TradingView still better?

Three places, stated without hedging:

1. **Object → alert binding.** Move a trendline in TradingView and the alert moves
   with it. In UCT the alert is *seeded* from a price and then stands alone — a
   sloped line's alert silently snapshots one endpoint. This is the one cluster
   the research called "simply better", and it is still true. (MOB-05, deferred —
   R2.)
2. **Per-object Hide.** Non-destructive hide sits between Lock and Delete in
   TradingView. UCT has nothing there. (MOB-10, deferred — R3.)
3. **Drawing-tool picking at scale.** UCT's flat searchable grid closes the
   *reachability* gap, but a native, categorised picker is still a better shape if
   the catalogue grows.

Two smaller, real ones: symbol-search rows disambiguate by exchange/type/country
where UCT shows ticker + name; and the chart-type catalogue is broader
(Renko/Kagi/PnF — a different audience, not a mobile defect).

## 4 · Is there any important charting function a serious UCT user still needs desktop for?

**No — not any more. Three things remain desktop-only and all three are deliberate.**

- ✅ **Drawing Boards (tracings)** — **closed tonight.** Tools → Drawing boards:
  switch, rename, show/hide, delete, new, with the active board named on the row.
  This was the last high-value orphan and it is gone.
- ✅ **Bar replay** — intentionally desktop-only; recorded in the contract.
- ✅ **Symbol comparison** — intentionally desktop-only; recorded.
- ✅ **Multi-chart grid** — desktop-only by design, and the phone is explicitly
  protected from inheriting it.

Everything else a serious user reaches for — symbols, timeframes, chart types, all
four scales, indicators (browse/add/configure/hide/remove/values), drawings
(choose/place/select/style/exact-position/move/lock/duplicate/delete/undo/redo/
quick bar/alert), price and drawing alerts, layouts, and the full data readout —
has a phone door today.

## 5 · What remains before we can credibly call UCT best-in-class on mobile?

In the order I would do them:

1. **A device loop that can authenticate.** Tonight's hard stop. Everything below
   is guesswork without it, and it is an owner action (a usable BrowserStack plan,
   or signing the sandbox account in during a session).
2. **MOB-05 — bind alerts to objects.** The single remaining place a competitor is
   simply better at something traders rely on.
3. **MOB-10 + MOB-15 as a pair** — per-object Hide *with* the object tree that
   makes it recoverable. Neither is safe alone.
4. **MOB-08 `presentation[deviceClass]`** — so a phone never inherits desktop
   framing or grid mode from a shared workspace record.
5. **Landscape as a designed mode**, not just a CSS branch that survives rotation.
   TradingView's landscape is a distinct experience with far more time range; UCT
   currently has a correct-but-undesigned one.

⛔ **What is NOT on this list, deliberately:** copying TradingView's cursor model,
its transactional settings commit, its favourites mechanism, or its category tabs.
Each was measured and each would trade a UCT advantage for a familiar shape.


---

## The regression, and the proof that separates it

```
Test Files   5 failed | 408 passed (413)
Tests        5 failed | 8064 passed | 4 skipped (8073)
RUNNER_EXIT=1
```

⛔ **`RUNNER_EXIT` is read from the runner, never from a pipe.** Earlier in this
programme a `| tail` made a run with three red suites report exit 0.

**All five failures are pre-existing, and the proof is an INTERSECTION rather than
an assertion.** A failure can only be mine if this branch touched the test file or
a source file it exercises. This branch (`9c6078503..HEAD`) touched 35 files, all
under `components/chart`, `pages/charts/mobile`, `hooks` or `docs`:

| failing file | branch-touched | last modified by |
|---|---|---|
| `chart/builder/ImportBox.thinkscript.test.jsx` | no | `d4d5ec00f` (import box) |
| `chart/engine/ast/manifestProse.test.js` | no | `b280131b8` (manifest prose) |
| `chart/engine/ast/pine.blindCorpus.test.js` | no | `b1a901970` (pine venue policy) |
| `screener/reachable.test.js` | no | `8d04bf75f` (S8 Step 2 frontend) |
| `hooks/pollingSites.rail.test.js` | no | `fc369ec18` (Monitor grid) |

`MINE: 0 · PRE-EXISTING: 5.`

⚠️ **And the reachability sweep was checked for MY files specifically**, because
it is the one failure that could plausibly have been caused by adding a module.
It names the same 17 modules it named before this branch existed — all
`community/*`, `floor2` and `flowBootstrap`, from other workstreams. The new
`MobileBoardsSheet.jsx` does **not** appear: it is reachable through
`MobileChartsApp`.

⚠️ **A full `vitest run` over all of `app/src` was attempted first and HUNG** —
seventeen minutes with no output while workers sat at 3.3 GB. It was killed, and
what it had reported (1,066 files, 0 failures) is recorded rather than discarded.
The suite above is the targeted one this certification calls for: chart, mobile,
desktop chart, workspace/layout, indicator, drawing, alert and scale tests, plus
the reachability sweep. Whether the full-app run hangs at the branch point too is
**not measured**, and is not claimed either way.
