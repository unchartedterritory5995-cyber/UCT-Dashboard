# R8 — critique pass 1

> **Rendered, not read.** Chromium, two coarse-pointer profiles (390×844 iPhone, 412×915 Pixel 8),
> both colour schemes, `/charts` and `/journal/trades`, states idle → pressed → fan-open → released.
> 36 frames, 32 captured, 4 inconclusive. Instrument: `tools/hub_critique_capture.py`;
> harness: `tools/hub_critique_server.py`.
>
> ⛔ **SYNTHETIC POINTER EVENTS.** Valid for material, layout, hierarchy and typography. **Not**
> evidence about flick, hold or scrub — R9 stands, those need a real finger. Every manifest row is
> stamped `synthetic: true` for that reason.
>
> ⚠️ **The backdrop is a synthetic field, not live data.** The harness stubs every API, so the blur
> is being judged over the easiest backdrop it will ever have. "Does the glass hold up over a live
> chart" is NOT answered here.

Frames: `scratchpad/critique/pass1/` (36 PNG) · `pass2/` (the before/after pair for finding 1).

---

## F1 — ⛔⛔ THE FAN WAS DRAWN WHILE CLOSED. **FIXED.**

The hub never disappeared. At rest, no gesture, coach mark dismissed:

```
chart.planTrade 0.4   chart.draw  1
chart.alert     0.4   chart.voice 1      transform: none on all six
chart.flag      0.4   chart.home  1
```

The 0.4s are only `.bubbleDisabled` — that fixture had no symbol. **On a page with a symbol all six
sit at full opacity, permanently, over the data.**

Cause: `open` toggled exactly one rule, `.fanOpen .fanWedge { opacity: 1 }`. Nothing in the
stylesheet touched the bubbles.

⭐ **So the hub at rest drew NINE things, not three** — six bubbles, the chip, the pad, the Actions
button — overlapping each other with labels truncated to *"Plan t…"*. This is the design bar's own
first principle failed (*"its job is to disappear"*) and, before any question of material or motion,
the single largest contributor to **"too much going on"** and **"clunky from the 90s"**.

**Fixed** — closed fan is `opacity: 0; transform: scale(0.72)`; `.fanOpen` restores it; the disabled
0.4 signal is preserved. Verified both ways in the browser (at rest 0 visible → after drag 6),
because *invisible at rest* and *invisible always* look identical in a single frame.

---

## The open state — what the member actually spends the gesture looking at

Everything below is from `pass2/after_fanopen.png`, i.e. **after** F1 was fixed.

### F2 — ⛔ The bottom band is illegible mush. **This is the $5 answer.**

In one horizontal strip, overlapping: the `CHART` chip · the word **"Actions"** printed straight
across it · the **Draw** bubble · the **Home** bubble · the Actions button. Five elements, one band,
all semi-transparent, all on top of each other. **Name the single cheapest-looking thing in the
frame — it is this**, and it is a layout collision rather than a material failure.

### F3 — ⛔ The wedge backdrop renders as a visible rectangle

`fanWedge` at `opacity: 1` shows **hard straight edges** — a lighter translucent box with a
quarter-circle arc drawn over it. It reads as an unclipped bounding box, not as a lens. The arc and
the box disagree about what shape the fan is.

### F4 — ⛔ The bubbles do not sit on the arc they are drawn against

A thin guide arc sweeps bottom-left → top-right, and the bubbles sit at visibly different radii from
it. Two rings (46 px outer / 36 px inner) is the intent; **scatter** is the reading.

### F5 — ⛔ Labels truncate at the first word

*"Plan t…"* — `.bubbleLabel` is `overflow: hidden; text-overflow: ellipsis; white-space: nowrap` in a
46 px circle. A label that cannot show its own verb is decoration.

### F6 — ⚠️ Inner-ring labels are 9 px

`.bubbleInner { font-size: 9px }` against `.bubbleOuter`'s `--text-xs`. Nine pixels on a phone, over
moving data, for **Voice / Home / Draw** — the three a thumb reaches most often.

### F7 — ⚠️ Colour reads as arbitrary

`Plan trade` green, `Home` green, `Voice` violet, `Alert`/`Flag` grey. Per-action `--hub-bubble-color`
with no rule a member could infer. Revolut's lesson from §1 is the opposite: consequence should be
legible **before** you touch it, and `confirm` actions (`Alert`) currently read as the quietest.

### F8 — ⚠️ The pad reads as a disabled radio button

A large flat grey circle with a small dot. No lensing, no rim light, no depth — §1's D1/D2/D3
measured this from source and the frame confirms it. It is the one element that is always on screen
and it looks like a placeholder.

---

## The four INCONCLUSIVE rows, and they are a finding of their own

`/dashboard` — **the hub does not mount at all**, on both profiles and both themes:
`no hub-root in the DOM`.

⚠️ **Almost certainly the harness, not the product**: every API returns `{}`, and the Dashboard is
the most data-dependent route in the app, so a tile is likely throwing into a route-level error
boundary that takes `Layout` — and therefore the hub — with it. ⛔ **Recorded as INCONCLUSIVE, not
as a defect**, because this harness cannot tell that from a real mount failure. It needs one check
on the sandbox, where the tiles have data.

⭐ Worth noting anyway: Home is exactly the mode R4 cut to a single bubble, so a Home frame is the
one most likely to change the `D-53` decision, and it is the one frame this pass could not take.

---

## What pass 2 must look at

1. **F2** — the bottom band. Highest impact, and it is geometry, not material.
2. **F3/F4** — does the fan read as one shape?
3. Then and only then, material: **F8**, and D1/D2/D3 from `w4-material-plan.md`.
4. `/dashboard` on the sandbox, to settle the four INCONCLUSIVE rows.

⛔ **Three full passes minimum, and this is one.** The first clean pass does not end it.
