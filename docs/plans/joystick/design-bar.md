# The design bar — what "flagship" means for this control, and how it is measured

> **Owner ruling, 2026-09-17: "looks like a $5 project."** That judgement stands until this reads as
> a flagship mobile feature from a multi-billion-dollar consumer company. This document is the bar
> it is measured against, written **before** any visual work, so the critique loop (R8) has
> something to fail against rather than an opinion to agree with.
>
> ⛔ **Every "what this hub does not do" below is MEASURED from the current source, with the value
> quoted.** A bar built from adjectives is a bar nothing can fail.

---

## 0 · What this control actually is, before comparing it to anything

A **thumb instrument for a trading screen**, used one-handed, on a phone, while the other hand is
doing something else and the eyes are on a chart. That is the brief, and it is not a generic mobile
menu. It has consequences the reference set does not all share:

- It is used in a **dark room at 6am**, and again in **daylight**. Both themes are load-bearing, not
  a checkbox.
- It sits over **dense, moving data**. Anything it draws competes with a price that is changing.
- It is operated by **feel more than sight** — the thumb is on it, the eyes are not.
- Its job is to **disappear**. A control that is constantly announcing itself over a chart is
  failing regardless of how good it looks.

⭐ **So the aesthetic target is not "pretty". It is INSTRUMENT.** Precision, restraint, and a
material that reads as a physical thing resting on glass — not a card, not a menu, not a widget.

---

## 1 · The reference set, and the specific thing each one does

### Apple — Liquid Glass controls (iOS 26)

| what it does | what this hub does today |
|---|---|
| The material **refracts what is behind it** — the blur is lensed, brighter at the rim, and the tint shifts with content | **TEN `backdrop-filter` declarations, every one of them the byte-identical string `blur(18px) saturate(160%)`** — measured with comments stripped. Not merely "uniform": the pad, the knob, the chip, the bubbles, the scrim and the sheets sit at different depths over different content and are all given one value. No lensing, no edge brightening, no variation by role. |
| A **specular highlight that tracks motion** — the rim catches light as the element moves | `inset 0 1px 0 var(--hub-rim-highlight)` — a **static** top-edge line. It does not move, ever. |
| **Layered depth**: an ambient shadow plus a tighter key shadow, so it sits *above* rather than *on* | `--hub-shadow: 0 10px 28px -8px` — **one layer**. |
| Material **thickens on press** and relaxes on release | Bubbles: `transition: transform 0.15s, background-color 0.15s` — no named curve, so the browser default `ease`. Reads as CSS. |

### Apple — the home indicator, and the Camera zoom dial

These are the two best references for *gesture feel* on iOS, and neither is about looks.

- **The home indicator** is the standard for *disappearing*: it is present, it is never in the way,
  and it never competes. **The hub currently draws a pad, a chip and an Actions button at rest** —
  three elements, permanently, over the data.
- **The Camera zoom dial** is the standard for *a control that follows a thumb*: it tracks
  continuously, it has detents you can feel, and it settles with physics rather than snapping.

  ⚰️ **THIS SAID THE HUB HAS "ONE" SPRING-ISH CURVE. IT HAS TWO, AND TWO IS WORSE THAN ONE.**
  Measured from `hub.module.css` with comments stripped — **8 `transition` declarations: 2 carry a
  named curve, 3 are browser-default `ease`, 3 are `none`** (the deliberate mid-drag suppressions).
  The two named curves are:

  | where | duration | curve | overshoot |
  |---|---|---|---|
  | knob return | `0.28s` | `cubic-bezier(0.34, 1.56, 0.64, 1)` | 1.56 |
  | bubble in | `0.26s` | `cubic-bezier(0.34, 1.4, 0.64, 1)` | 1.40 |

  ⭐ **They differ by 0.16 of overshoot and 20 ms — a difference no thumb can feel and no eye can
  see.** So this is not two considered motions; it is one motion typed twice and drifted. A single
  named token used in both places would look identical and would mean something. That is a sharper
  criticism than the one it replaces, and it only appeared because the value was quoted.

  ⚠️ The remaining three are `opacity 0.18s`, `opacity 0.1s`, and `transform 0.15s,
  background-color 0.15s` — no curve named, so the browser default `ease` applies. The bubble's own
  transition bundles four properties (`transform`, `opacity`, `background-color`, `border-color`)
  on three different durations in one declaration.

### The fintech set — Robinhood order ticket · Revolut card controls · Apple Stocks · Linear mobile

| reference | the specific thing | this hub |
|---|---|---|
| **Robinhood order ticket** | one primary action, enormous hit target, everything else subordinate; the sheet knows it is the only thing that matters | the fan presented up to **nine** peers of equal weight; **the R4 cut (§5) takes that to six**, and the remaining defect is the EQUAL WEIGHT, which the cut does not touch |
| **Revolut card controls** | destructive/consequential actions look different *before* you touch them | `kind: 'confirm'` exists (4 actions) but reads visually identical to `run` at rest |
| **Apple Stocks** | typography does the work — tabular numerals, tight tracking, no chrome | chip uses `--text-sm` with `font-variant-numeric: tabular-nums` ✅ *(already right)* |
| **Linear mobile** | motion is fast and unshowy; 150–200ms, never bouncy for its own sake | knob return is **280ms with a 1.56 overshoot** — bouncier and slower than the reference |

### What none of them do, and neither should this

Decorative motion. Gradient washes. A shadow under everything. Identical radii regardless of
hierarchy.

⛔ **`--radius-pill` is on SEVEN selectors, not the four this said**: `.pad`, `.padRing`,
`.knobFace`, `.knobDot`, `.bubble`, `.chip`, `.actionsButton`. Seven different jobs — a surface, a
ring, a face, a dot, a target, a readout and a button — and one radius across all of them. (The
file's most-used radius is actually `--radius-sm`, 9 times, but every one of those is the Report
scaffolding and the sheets, not the instrument.)

⛔ **And `box-shadow` is 6 declarations over 2 distinct values** — `var(--hub-shadow)` and
`var(--hub-shadow), inset 0 1px 0 var(--hub-rim-highlight)`. One ambient layer, no key light, and
the inset rim is a static top edge that never moves.

---

## 2 · The measurable bar

⛔ **Every number here is checked with a control showing the instrument could have failed it.** A
metric nobody has seen go red is not a metric (`lesson_gate_that_cannot_fail`).

| # | property | threshold | how |
|---|---|---|---|
| M1 | dropped frames, full drag→open→select→release | **zero** | Chrome device emulation, **4× CPU throttle**, mid-tier Android profile **and** an iPhone profile |
| M2 | pointer-event → paint | **< 16 ms at p95** | W3's overlay, recorded into the trace ring |
| M3 | fan open / close | **< 250 ms** including spring settle | measured, not the CSS duration |
| M4 | thumb return | **< 200 ms** | ditto |
| M5 | hit targets | **every one ≥ 44 pt** | `styles/tapFloor.test.js` already rails this |
| M6 | layout shift on open | **none** | transform/opacity only; no top/left/width animation |
| M7 | `prefers-reduced-motion` | respected | already handled — `tokens.css` zeroes durations app-wide |
| M8 | both themes | every state readable | light, dark, and the `[data-hub-contrast="high"]` island |

⚠️ **M2–M4 are measured on an emulated profile, which is a CPU-throttle proxy, not a device.** It is
honest about motion and jank. It says **nothing** about flick, hold or scrub — those are
`INCONCLUSIVE-TRANSPORT` until a real finger produces a trace (R9), and no number here may be quoted
as if it settled them.

---

## 3 · The critique rubric (R8) — what a reviewer looks for

Rendered in every state — idle, pressed, dragging, fan open, action selected, releasing — in each
mode, both themes, both device profiles. Then, against each screenshot:

1. **Material** — does it read as glass, or as a semi-transparent box? Is the blur doing anything a
   flat fill would not?
2. **Depth** — is there a light source, and is it consistent across pad, chip, bubbles and button?
3. **Motion** — does anything ease when it should spring, or spring when it should just move?
4. **Hierarchy** — can you tell the primary action from the others without reading?
5. **Radii and spacing** — one scale, applied by role, or one value applied everywhere?
6. **Typography** — does the text belong to the material it sits on?
7. **Restraint** — what can be removed? *(Chanel's rule: take one thing off.)*
8. **The $5 test** — name the single cheapest-looking thing in the frame. There is always one.

⛔ **Three full passes minimum, and the first clean one does not end it.** The second pass looks for
what the first excused. Every pass is written down with its screenshot paths; a pass that names
nothing and has no screenshots is not a pass.

---

## 4 · What is already right, and must not be lost

Restraint in the critique cuts both ways — these are measured, not assumed:

- `font-variant-numeric: tabular-nums` on the chip — numbers do not jitter as they change.
- **4** `env(safe-area-inset-*)` usages — the notch and home indicator are already handled.
- `prefers-reduced-motion` zeroed app-wide in `tokens.css`, with the hub's own `transition: none`
  overrides where a transition would fight a live drag.
- The theme-island discipline: `--hub-*` tokens are pinned in every island, railed by
  `styles/themeIslands.test.js`.
- `styles/tapFloor.test.js` already enforces the 44px floor.

⚰️ **AND A DEFECT I NEARLY PUT IN THIS DOCUMENT THAT DOES NOT EXIST.** An earlier draft of §4 said
*"`--color-border` is used 4× in `hub.module.css` and is defined nowhere — a silent no-op"*, and
listed it as a real contributor to "cheap-looking".

**It is used ZERO times.** `--color-border` is indeed defined nowhere in `app/src/**/*.css`, but the
four usages I counted were **my own first draft** of the Report affordance's CSS, written and
replaced within the same hour. I measured the file while my own mistake was still in it and filed
the result as a pre-existing product defect.

⭐ **Caught by the probe-control rule the owner set the same day** — the control (`--hub-rim` found
3×, `--hub-shadow` 1×) proved the search could find a token that exists, so the zero was
trustworthy, and the zero contradicted me. Without the control I would have "fixed" a defect that
was already gone and reported a win.

⛔ **The rule this leaves:** when a survey of a file happens mid-edit, it is measuring the edit, not
the product. Re-measure from `git show master:<file>` before calling anything pre-existing.

⭐ **And the honest sweep, done properly from master, with a control:** the hub's CSS uses **42**
custom properties. **37** are defined in `tokens.css` / `index.css` / the file itself. The remaining
five are **not defects**: `--hub-bubble-color`, `--hub-slice-a0`, `--hub-slice-a1` and
`--hub-slice-color` are set inline per element from `HubFan.jsx` (a correct pattern — a per-bubble
value cannot live in a stylesheet), and `--x` was a fragment of my own comment. Control: a planted
`--definitely-not-a-real-token` **was** detected, so the zero is trustworthy.

**There are no undefined tokens in the hub's stylesheet.** Whatever makes it read as "$5", this is
not it — which is worth knowing before spending a pass looking there.

---

## 5 · The cut, as shipped — and what it does NOT fix

R4 made the cut the agent's call and the strong cut the **default** surface; the full 62-action
surface is the switchable variant. `registry.js`'s `STRONG_CUT` is the table and the block comment
above it is the reasoning. Measured from the module, not from a plan:

| | modes with verbs | outer actions | total actions | most bubbles on one fan |
|---|---:|---:|---:|---:|
| before | 8 | 30 | 62 | **9** (Home) |
| **after (default)** | **6** | **18** | **37** | **6** (chart, notebook) |
| after (`full` variant) | 8 | 30 | 62 | 9 |

⛔ **THE CUT IS A SUBSEQUENCE — it subtracts, it never re-ranks.** A fan's order is its bubble
angles, which is muscle memory, and `full`/`simplified` are two surfaces of one control that a
member switches between. If the cut re-ordered, every surviving bubble would jump to a different
angle on the switch. `fanResolutionParity.test.js` rails it, and caught the first draft doing
exactly that to `chart`.

### ⭐ What the cut answers, and what it cannot

The owner's sentence was five complaints, not one: *"too glitchy"*, *"not smooth"*, *"clunky from
the 90s"*, *"not high class smooth Liquid Glass"*, *"too much going on"*. **Only the last is about
count.** The cut answers that one — the hub stopped being a second navigation menu — and it
answers nothing about the other four, which are material and motion. Treating 62→37 as the fix
would be reading one clause of five and calling the job done.

⛔ **And it does not touch the defect §1 actually names.** Robinhood's lesson is *one primary
action, everything else subordinate*; six equal-weight peers is better than nine equal-weight
peers and is still **equal weight**. Hierarchy is W4's, not the cut's.

### ⚠️ Open, for the R8 critique loop to answer from a rendered frame

1. **`home` is left with a ONE-bubble fan** (Voice — it has no Home action, being home already).
   A fan of one may be worse than no fan: the drag-to-open ceremony for a single destination.
2. **`calendar`, `breadth` and `flow` carry only the universal pair.** Four modes where a drag
   opens two bubbles that are the same two bubbles everywhere.
3. **Voice and Home cost two bubbles on EVERY fan.** Moving the pair into the Actions sheet would
   take the busiest fan from six to four. That is a component change, not a data change, so it is
   deliberately not in the cut.

⛔ None of the three is settled here, on purpose. Deciding "does one bubble read as restraint or
as ceremony" from a table is judging the artifact instead of the product — the mistake §4 already
records once.

### ⚰️ Two instrument failures paid for during this pass, both mine

**1 — the cut was first fitted to a number I had written down.** `simplification-proposal.md` §4
costed a "3 modes × 4 actions" shape, and I built that shape instead of applying the four tests
per action. It deleted `wire.flag`, `wire.note`, `catalysts.flag` and `catalysts.note` — four run
actions that act on the row under the cursor and are not one tap away on a phone, i.e. four
actions that pass all four tests. The rails caught it: `linkTickerWritesTheNote` (R-17) and
`notebookTemplatesPicker` (R-19) each drive a real end-to-end write and each went red. ⭐ **A
target count is an input to a plan and must never become an input to the decision the plan was
written to inform.**

**2 — a line-ending probe with no control reported the opposite of the truth.** Checking whether
the generated artifacts were stored CRLF, `git cat-file blob <sha> | grep -c $'\r'` in Git Bash
lost the CR, and **an empty grep pattern matches every line** — so it answered "172 CRLF of 172",
i.e. uniformly CRLF, for two files that are stored **uniformly LF**. Re-run in Python with a
positive control (`deferred.md`, which CLAUDE.md records as mixed) the probe found 87 CRLF there
and 0 in both artifacts, so the control proves the instrument can see CRLF and the zero is real.

⭐ Nothing was damaged — the writer preserved whatever was stored either way — but the **claim**
was published before the control was run, which is the owner's standing rule verbatim: *before any
ad-hoc probe's first result is reported or acted on, show it returning the OTHER answer on a known
case.* This is the fifth instance of that class in two days and the first since the rule was
recorded in `CLAUDE.md`.

