# G3-15 chip clearance — re-measured 2026-09-13, and one filed symptom was the instrument

**Base:** `https://uctintelligence.com`, live `web` SHA **`58c63b806`** (Railway SUCCESS).
**Tool:** `tools/hub_chip_clearance.py`, signed in as `smoke@uctintelligence.internal`.
**Widths:** 360 · 375 · 430. **27 (mode, width) pairs**, 9 routed modes.

> ⛔⛔ **THE CONTROLLED COMPARISON IS THE POINT.** Both runs below are the same tool, against the
> same deployed SHA, minutes apart. The **only** difference is that the second one waits for the
> cinematic intro overlay to detach before it samples. One filed failure disappears; the rest do
> not move. That is what makes this a measurement rather than an opinion.

## Run 1 — as the tool stood (fixed 1200 ms after `hub-root` mounts)

```
⛔ G3-15 FAILS on 7 counts
✗ breadth  @360  56/56 points inside the chip resolve to something else (x=154->span, x=155->span, …)
✗ notebook @360  10/57  (x=25->Log a trade, …)
✗ journal  @360  10/57  (x=25->Log a trade, …)
✗ notebook @375  10/58  (x=29->Log a trade, …)
✗ journal  @375  10/58  (x=25->Log a trade, …)
✗ notebook @430   3/58  (x=84->Log a trade, x=92->Log a trade, x=100->div)
✗ journal  @430   4/59  (x=77->Log a trade, …, x=101->div)
```

## Run 2 — waiting `[aria-label="Welcome"]` out first, nothing else changed

```
⛔ G3-15 FAILS on 6 counts
✓ breadth  @360  56 points, all chip; chip.left 32 is -214px clear of the button (button found by testid)
✗ notebook @360  10/57  (x=25->Log a trade, …)      ← unchanged
✗ journal  @360  10/57  (x=25->Log a trade, …)      ← unchanged
✗ notebook @375  10/58  ← unchanged
✗ journal  @375  10/58  ← unchanged
✗ notebook @430   3/58  ← unchanged
✗ journal  @430   4/59  ← unchanged
```

## What this settles

⚰️ **“a Breadth span at 360” was the CINEMATIC INTRO ANIMATION.** `IntroAnimation.jsx` plays on
every real page load for **~9.3 s** and paints a full-screen overlay across the whole app; this
sweep performs a page **load** per (mode, width) and then measured **1.2 s** later. Its capability
pills are anonymous `<span>` elements, and the probe's `what` field fell back to a tag name — so a
full-screen animation was written down as page furniture, and it entered **D-39** as a product
defect with an acceptance target built around it.

⭐ **The other half of D-39 is CONFIRMED, not withdrawn.** `Log a trade` is the Journal page's own
fixed FAB, reported by its own `aria-label`, on journal and notebook at all three widths. It is
unaffected by the intro wait, which is exactly what a real page-furniture overlap should look like.

⭐ **An independent probe agrees.** Sampling the same pages at **1.2 s / 3 s / 11 s**, `/journal
@430` resolves to `span._pill … < div._overlay …[aria-label="Welcome"]` at 1.2 s and 3 s and is
**CLEAR at 11 s**; `/breadth @360` is clear at every age.

## What changed in the tool, and what deliberately did not

- It **waits the overlay out** (`state="detached"`, 15 s bound). Absence resolves immediately, so a
  build without the intro pays nothing. A timeout is **reported**, never silently measured through.
- A covered point inside the overlay is named **`INTRO-ANIMATION`** instead of `span`.
- A reading whose every covered point is inside the overlay is reported as an **instrument
  artifact** — and is **still a failure**. ⛔ An invalid measurement must never read as a pass.
- ⛔ **The verdict logic and the thresholds are untouched.** `--self-check` (6 verdict cases) and
  the fixture control both still pass, and the fixture control now drives the selector both ways:
  `fixture[clear] btnBy=testid → PASS` · `fixture[overlapping] btnBy=testid → FAIL` ·
  `fixture[clear-no-testid] btnBy=label → PASS`.

## Consequence for D-39

**Acceptance target: 7 failing pairs → 6.** journal + notebook at 360/375/430, with the other
**21** pairs passing. Severity is unchanged — cosmetic-plus, non-blocking for stage 1 and stage 2
by owner ruling; the covering element stays on top and tappable, so nothing is unreachable.

⚠️ **This does not make D-39 smaller than it is.** Six pairs still fail for a real reason, and the
fix ruled on 2026-09-12 (shrink the chip's `max-width` at layout with a floor at `.chipMode`'s
width) is unchanged.
