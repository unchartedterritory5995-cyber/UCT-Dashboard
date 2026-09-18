# R8 — critique pass 5 · W4 MATERIAL, second pass

> **F13 (the shadow was a glow) and D3 (the specular follows the drag).** Against the
> rebuilt bundle on the harness with `--backdrop`, both themes, iPhone profile.
> Frames: `scratchpad/contrast_pass2/`.
>
> ⭐ **Both findings in this pass were invisible to every number and were found by LOOKING at
> a frame.** Pass 4 closed with twelve contrast rows, all passing, on a build that painted
> white halos in light theme and — once D3 landed — lit the knob from below.

---

## F13 — a shadow is not a ground

```
[data-theme="light"] --bg: #ffffff
--hub-shadow:         0 10px 28px -8px  color-mix(in srgb, var(--bg) 65%, transparent)
--hub-shadow-ambient: 0 12px 28px -10px color-mix(in srgb, var(--bg) 70%, transparent)
--hub-shadow-key:     0 2px 5px -1px    color-mix(in srgb, var(--bg) 55%, transparent)
--hub-rim-lowlight:                     color-mix(in srgb, var(--bg) 30%, transparent)
```

On light theme every one of those composes to **white**. The bubbles wore halos; the rim's
*lowlight* became a second highlight on the bottom edge, so the glass lost its edge exactly
where an eye looks for thickness.

⭐ **The derivation is deliberate and correct for the dark family.** The OLED block says so:
*"--hub-shadow/--hub-scrim already derive a deeper black automatically because they're built
from --bg, which OLED already redefines."* It has no meaning on the one theme with no
`--hub-*` overrides.

**The fix separates two ideas that looked identical.** A SCRIM takes the page's own ground —
so `--hub-scrim` **should** follow `--bg`, and is deliberately untouched. A SHADOW is ink:
dark in every theme, because that is what a shadow is. Same construction, opposite
correctness.

⚠️ **Scoped by enumeration, not by eye.** Exactly five `--hub-*` tokens reference `var(--bg)`.
A first version of that scan matched the substring `var(--bg` and reported **ten**, sweeping
in every `--bg-elevated` SURFACE — including `--hub-label-plate`, the token that makes the
light-theme labels readable at 5.88:1. **A classifier that cannot tell a ground from a
surface would have "fixed" the half that works.** That output was discarded rather than
reported.

⛔ **This corrects pass 2's F10.** That pass concluded *"the light-theme tokens are NOT
broken"* after measuring three tokens that derive from `--text-heading` — which flips
correctly — and stating the result about the whole family. The shadow family derives from
the other end of the palette.

---

## D3 — the specular follows the drag, and it cost no render

`--hub-drag-angle` is written by `HubKnob` from `state.knob`; the knob face paints its
gradient at that angle. **Measured live, not asserted:**

| gesture | `--hub-drag-angle` |
|---|---|
| at rest | `0deg` (light from above — D2's single light direction) |
| drag up | `0deg` |
| drag right | `90deg` |
| drag down-left | `-135deg` |

⛔ **No new render, and that is the whole safety argument.** D3's plan warns that a per-frame
custom property is an H14 render-loop hazard — the 4.5-hour navigation freeze — and
prescribes `element.style.setProperty` on a ref. That prescription guards against ADDING a
per-frame state update. This adds none: `offset` **is** `state.knob`, so `HubRoot` already
re-renders on every `pointermove` to move the knob at all. Riding an existing render adds a
property, not a render.

⚠️ **It is not independently safe.** If the knob is ever moved off React state onto a
transform ref, this must move with it. Written at the call site, not only here.

### ⚰️ Two mistakes in D3's first attempt

| | what it was | how it was caught |
|---|---|---|
| **1** | `linear-gradient(180deg, transparent, X)` puts X at the **bottom** — at rest the knob read as lit **from below** | the light frame; every number still passed |
| **2** | it painted with `--hub-rim-highlight` = `--text-heading` at 35% — white on dark, **near-black on light**. The "specular" became a dark cap in light theme | the same frame |

⭐ **Rim and specular had been sharing one token for two different jobs.** A rim on a light
UI is *correctly* a dark edge; a specular is a reflection of a light source and is light in
every theme. `--hub-specular` now exists for the second job, and `--hub-rim-highlight` is
untouched for the first.

---

## Contrast, re-measured after the change

| cell | graded | worst |
|---|---|---|
| dark · un-scrimmed | 3 | 11.27:1 |
| light · un-scrimmed | 3 | **5.88:1** |
| dark · scrimmed | ⛔ 0 — UNMEASURED | — |
| light · scrimmed | ⛔ 0 — UNMEASURED | — |

Light's worst fell from 6.40 to 5.88 — **that is the fix working**, not a regression: the
surround is no longer being lifted by a white glow. Still comfortably over AA 4.5:1.

The two scrimmed cells are unchanged and still reported as a hole (exit 2). The only bubbles
whose centres land inside the scrim are the three the harness cannot enable.

---

## What this pass deliberately did not touch

- **F12** — `Home` overlaps the Actions button. Geometry (`fanGeometry.js`), not material.
- **F6 / F7** — deferred from pass 3, unchanged.
- **D1's depth scale** — five surfaces still share one blur; the bubble now has its own
  (14 px vs 18 px), which is a crack in the defect, not its fix.
- **The two near-identical springs** — `hubMotionTokens.test.js` pins the count at two
  precisely so collapsing them is a visible, deliberate act. Not smuggled into a material pass.
