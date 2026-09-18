# W4 — the material plan

> **What gets built, per element, to close the gaps `design-bar.md` §1 measured.** The bar is the
> bar; this is the build. ⛔ **No threshold is restated here** — M1–M8 live in `design-bar.md` and a
> second copy would agree with it right up until the moment the two disagreed, which is the only
> moment anyone would read either (`lesson_a_second_authority_over_one_value`).
>
> ⛔ **Written before the visuals, judged after them.** R7 requires the bar before any visual work;
> R8 requires the critique to fail against rendered frames. This plan exists so the build is fast
> when a memory window opens and so the critique has a stated intention to hold it against —
> *"did it do what it said"* is a different and better question than *"do I like it"*.

---

## 0 · What is already right, and must survive

Two of these are the expensive mistakes NOT made, and W4 can undo either by accident:

| measured | why it matters |
|---|---|
| **No animating element carries a `backdrop-filter`.** `.knobFace`, `.knobDot`, `.bubble` animate `transform` and have none; all five filtered elements are static | a blurred surface that MOVES re-samples its backdrop every frame. On a phone that is the difference between gliding and smearing. **Every effect below is painted with gradients and shadows, never a filter that reads the backdrop.** |
| **Every transition is `transform` / `opacity` / colour.** Zero layout properties | M6 already holds. Nothing here introduces a `width`, `top` or `font-size` transition. |
| `font-variant-numeric: tabular-nums` on the chip · 4 `env(safe-area-inset-*)` usages · `prefers-reduced-motion` zeroed app-wide · the `--hub-*` theme-island discipline · the 44px floor | all railed already |

---

## 1 · The four defects, and the mechanism for each

### D1 — one blur for five depths

**Measured:** `.pad`, `.chip`, `.actionsButton`, `.coachMark`, `.edgeTabGrip` all carry the
byte-identical `blur(18px) saturate(160%)`.

**Build:** a **depth scale**, assigned by how far back the element sits and how much moving data it
has to suppress.

| element | role | blur | why |
|---|---|---|---|
| `.coachMark` | teaching overlay, front of everything | lightest | it sits on its own dimmed ground; heavy blur there is wasted cost |
| `.chip` | a readout, read while the thumb moves | light | it must stay legible over a changing price |
| `.pad` | the instrument's own surface | medium | the reference point the rest is judged against |
| `.actionsButton` | the no-drag door, at rest over data | medium | |
| `.edgeTabGrip` | a 12×36px sliver | heaviest per pixel | it is tiny, so it needs the most separation to read as a thing rather than a smudge |

⛔ **The pair of spellings stays.** Safari ships only `-webkit-backdrop-filter`; dropping it makes
the material vanish on the one browser this feature targets.

### D2 — one shadow layer, no light source

**Measured:** 6 `box-shadow` declarations over 2 distinct values — `var(--hub-shadow)` and
`var(--hub-shadow), inset 0 1px 0 var(--hub-rim-highlight)`. One ambient layer, no key.

**Build:** two layers everywhere a surface sits above another — a wide soft **ambient** and a tight
offset **key** — from one consistent light direction (above, very slightly behind the thumb, so the
key shadow falls toward the bottom of the screen where the hand already is). Plus the **thickness**
inset that makes glass read as having an edge rather than being a decal.

### D3 — a specular rim that never moves

**Measured:** `inset 0 1px 0 var(--hub-rim-highlight)` — a static top-edge line.

**Build:** the rim catches light **as a function of where the knob is**, which this hub already
knows — the drag vector is in hand every frame.

⭐ **This is the one place the hub can beat its reference set cheaply**, because the Camera zoom
dial's specular is faked from a model and ours is driven by the actual input. The highlight angle
is set from the drag vector as a CSS custom property on the knob, painted as a gradient.

⛔ **A custom property set per frame from JS is a render-loop hazard** — rule H14, and the 4.5-hour
app-wide navigation freeze. It must be written with `element.style.setProperty` on a **ref**, never
through React state, and never in a way that re-renders the hub. The existing
`--hub-bubble-color` / `--hub-slice-*` inline pattern (`HubFan.jsx`) is the precedent and it is
already sanctioned by `tokens.reachable.test.js`'s "defined in JS" scan.

### D4 — seven jobs, one radius; and one motion typed twice

**Measured:** `--radius-pill` on `.pad`, `.padRing`, `.knobFace`, `.knobDot`, `.bubble`, `.chip`,
`.actionsButton`. And 8 transitions: 2 named curves that differ by 0.16 of overshoot and 20 ms
(imperceptible — one motion typed twice and drifted), 3 browser-default `ease`, 3 `none`.

**Build:**
- **Radius by role.** Circular things stay circular (knob face, knob dot, bubbles — a pill on a
  circle is a circle anyway). Surfaces that are *containers* get a radius that reads as a panel.
  The chip is a readout and takes the pill it has earned. ⛔ `--radius-pill` stops being the
  default everything falls back to.
- **One spring token**, replacing the two drifted curves, and **named curves on the three
  browser-default eases**. ⛔ **The token is introduced in a commit that changes no rendered
  value** — same numbers, one authority — and tuned in a separate commit with eyes on it. A
  refactor and a retune in one diff is a change nobody can review and nobody can bisect.

---

## 2 · The flag

`HUB_VISUAL_V2`, default **ON in admin preview**, per the brief.

⛔ **It does not ship until there is something behind it.** A flag with nothing behind it is worse
than no flag: `project_feature_flag_ledger`'s whole finding is that OFF-and-unset is
indistinguishable from off-on-purpose, and an empty flag adds a third state that means nothing. The
flag lands in the same commit as the first material change it gates.

⛔ **And it gets a ledger entry** in `docs/feature_flags.json` in that same commit, with its
exposure and default declared — the flip-time rule this repo already pays for.

---

## 3 · What the critique loop will be asked (R8)

Rendered in every state — idle, pressed, dragging, fan open, action selected, releasing — in each
mode, both themes, both device profiles. The rubric is §3 of `design-bar.md`; these are the
plan-specific questions on top of it:

1. Does the depth scale read as **depth**, or just as different amounts of fog?
2. Is the light source **consistent** across pad, chip, bubbles and button — one direction, or four?
3. Does the specular actually **track**, and does tracking read as physical or as a gimmick?
4. Are the radii now legible as **roles**, or merely as variety?
5. Did any of it cost a frame? (M1–M4 come from `hubSmoothness.js`, and R9's rule holds: **the
   mirror never judges flick, hold or scrub** — those are `INCONCLUSIVE-TRANSPORT` until a real
   finger produces a trace.)
6. **The $5 test**: name the single cheapest-looking thing in the frame. There is always one.

⛔ **Three full passes minimum, and the first clean one does not end it.** Every pass written down
with its screenshot paths; a pass that names nothing and has no screenshots is not a pass.

---

## 4 · The order of work, once a memory window opens

Each step is a boundary the resource rule can stop at cleanly
(`resource-manifest.md` §3 — below 3.5 GB free, stop at the next boundary, record
`INCONCLUSIVE-RESOURCE`, resume from the boundary; that is a void step, never a failed one).

| # | step | boundary |
|---|---|---|
| 0 | `npm run build` once; serve the static bundle; one Chrome tab | build completes |
| 1 | **BEFORE** frames + recording, current default surface | frames written to disk |
| 2 | token refactor — one spring, named eases, **no rendered value changes** | suite green |
| 3 | D1 depth scale + D2 two-layer light | suite green |
| 4 | D4 radius by role | suite green |
| 5 | D3 tracking specular (the render-loop-hazard one; its own commit, its own rail) | suite green + a render-count rail |
| 6 | critique pass 1 → fix → pass 2 → fix → pass 3 | each pass written down |
| 7 | **AFTER** frames + recording; before/after pair | R10's recording exists |

⛔ Steps 2–5 are separate commits on purpose. If the critique says the material got worse, the
question *"which of the four did that"* must be answerable by `git bisect`, not by memory.
