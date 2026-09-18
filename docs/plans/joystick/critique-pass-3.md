# R8 — critique pass 3

> Against the rebuilt bundle (F1, F2, F3, F5, F8, F9, F11 shipped). 24 captured / 4 inconclusive.
> Frames: `scratchpad/critique/pass{4,5,6,7,8}built/`.

---

## Fixed since pass 2

| | before | after |
|---|---|---|
| **F1** fan drawn while closed | 6 bubbles at rest, `opacity 1`, `transform none` | at rest 0 visible; after drag 6 |
| **F2** chip buried in the fan | "CHART Actions Draw Home + button" in one strip | chip lifts by `FAN_RADIUS_OUTER + CHIP_GAP_PX` |
| **F3** wedge as rectangle | `border-left` + `border-top` drew two straight rim lines meeting the arc at 90° | just the arc, from the radial-gradient background |
| **F5** labels truncated at "Plan t…" | `overflow:hidden; text-overflow:ellipsis` in a 46 px circle | 2-line wrap, tighter tracking; **"Plan trade" reads in full** |
| **F8** pad reads as a disabled radio button | 8 ticks 1° wide (~0.7 px sub-pixel) | 4° wide, 0.9 opacity, thinner mask — reads as a dial |
| **F9** the ruler-straight scrim seam | `bottom: calc(22% + 32px)` ended in a hard horizontal line | 56 px `mask-image` gradient at the boundary |
| **F11** dark-on-dark labels below the seam (light theme) | `.bubble` was 22% accent + 78% transparent glass → labels rendered against the un-scrimmed page region and inherited its theme | `60% accent + 40% --bg-elevated`; **paint no longer depends on the page theme** |

---

## An instrument correction worth stating explicitly

**F4 — struck.** Pass 1 said *"the bubbles do not sit on the arc they are drawn against"*. Re-read
against `fanGeometry.js`: the fan is **two concentric rings** (`FAN_RADIUS_OUTER = 150`,
`FAN_RADIUS_INNER = 110`), and the "arc" I identified was the outer wedge's border. The bubbles
sit on two arcs, which is the intent. The "scatter" reading was mine misreading the wedge as a
guide. This is `lesson_a_projection_drops_what_it_does_not_name` in reverse — I read a shape into
the frame that wasn't the design's.

⚠️ **Recording it rather than deleting the row** because a critique that never retracts is
suspect. Every pass so far has had at least one instrument or reader defect to correct beside its
real findings; a run with none would be the more surprising thing.

---

## Two attempts on F11, one measured

- **Attempt 1 (pass 7):** substitute `--hub-glass-tint-strong` for the resting tint. Sounded right.
  Verified in the rebuilt bundle: **no visible shift.** The bubble was still ~78% mostly-transparent;
  the strong tier is only 5-percentage-points more opaque than resting.
- **Attempt 2 (pass 8, shipped):** raise the accent to 60 % and mix against `--bg-elevated` — a
  theme-aware surface token. Verified in the rebuilt bundle: solid pills, labels clear on both
  regions in both themes.

⭐ **The pattern the attempt one exposed** — sounding right and doing nothing — is the exact family
of defect the probe-control rule was written for. The measurement is what settled it.

---

## Still open, deferred rather than solved

### F6 — inner-ring labels are still 9 px

`.bubbleInner { font-size: 9px }`. **On paths the strong cut keeps, inner-ring labels are Voice,
Home, Draw** — the three most-reached actions on the fan. Nine pixels on a phone over moving data
is not readable. A separate pass, because raising them changes ring geometry and would confuse the
diff of an already-productive one.

### F7 — colour reads as arbitrary; `confirm` is the QUIETEST

Structural (Revolut's lesson from §1 inverted — consequence should be legible *before* you touch
it, and `Alert` reads as the *least* important bubble). A different critique dimension from what
this pass touched.

### Residual on chip

On the un-scrimmed dark region below the fade, the chip's *own* text and background still track
the page theme rather than the fan's. Same family as F11 was for bubbles. The chip already lifts
clear of the fan (F2), so it does not sit on the un-scrimmed region — recorded as polish rather
than a legibility break.

### The four INCONCLUSIVE rows

Unchanged: `/dashboard` mounts no hub on the harness because every API returns `{}`. Still the one
frame that would settle **D-53** (Home's one-bubble fan) and it needs the sandbox.

---

## Passes so far: three, and R8's minimum is met

- **Pass 1** — F1 fixed, F2 named as the $5 answer
- **Pass 2** — F2 fixed, F9 uncovered by the first real light-theme render, three instrument defects
  found and fixed
- **Pass 3** — F3, F5, F8 fixed; F11 fixed on the second attempt after the first was verified inert;
  F4 struck as an instrument mistake

⛔ **R8 requires three passes minimum, and the first clean pass does not end it.** This is not the
first clean pass: it has three deferred rows (F6, F7, chip residual) and a struck row (F4). The
sequence continues, on the sandbox next, so the four INCONCLUSIVE rows can be judged instead of
recorded.

⚠️ **What none of these passes touched:** motion, spring feel, glide. `hubSmoothness.js` is wired
and mutation-proved and has produced no number from a device (D-54). R9 stands: a mirror never
judges flick, hold or scrub. **The material now holds up; the feel is still the open question.**
