# R8 — critique pass 4 · W4 MATERIAL

> **The bubble becomes the material.** Against the rebuilt bundle on the 26 MB harness with
> `--backdrop`, iPhone + Pixel profiles, both themes. Instruments: `tools/hub_contrast.py`
> (new), `tools/hub_smoothness_run.py` (new), `tools/hub_critique_capture.py`.
>
> ⚠️ **Harness, not a device.** Synthetic pointer events, synthetic backdrop, emulated
> profile. R9 stands for everything about feel.

---

## The finding this pass fixes, and it was hiding in plain sight

Measured on the shipped bundle, not read from the plan:

| surface | `blur(18px) saturate(160%)` |
|---|---|
| `.pad` · `.chip` · `.actionsButton` · `.coachMark` · `.edgeTabGrip` | ✅ all five |
| **`.bubble`** | ❌ **none** |

**The fan — the only thing a member looks at for the whole gesture — was the one part of
the hub not made of the hub's own material.** F11 in pass 3 had moved it further away, to
`color-mix(--hub-bubble-color 60%, --bg-elevated)`: a solid pill. That fix was real (it
cured a dark-on-dark label) and it spent the material to buy legibility.

⭐ **The split that resolves it: the RIM is glass, the CENTRE is a backplate.** One
background, two layers — a radial ground of `--hub-label-plate` under the text, and an
accent wash that stays transparent at the edge. The contrast token lives *inside* the
material, so the pill never goes opaque.

---

## ⛔ The collision with §0, and why it needed no JS

`w4-material-plan.md` §0 records a measured rule: **no animating element carries a
`backdrop-filter`**, because a blurred surface that moves re-samples its backdrop every
frame. The bubble animates `transform` and `opacity` on every open. So "the bubbles must be
glass" and that rule are in direct conflict.

⭐ **They only conflict DURING the animation.** The filter now has a zero-duration
transition with a delay past the spring: it snaps on ~40 ms after the transform settles and
snaps off instantly on close. Every animating frame is unfiltered; the fan a member
actually reads is real glass. Nothing transitions the filter's *value*, so M6 still holds,
and there is no per-frame custom property — so no H14 render-loop hazard.

---

## Contrast — WCAG from sampled pixels, with a control

⛔ **Not derived from the declared `background`.** The bubble is translucent over a
`backdrop-filter`, so the colour reaching an eye is a composite of the plate, the wash, the
blurred backdrop and the page beneath. No stylesheet states that number.

**Method:** the page is shot twice from one scroll position — once normally, once with
every bubble label set to `visibility: hidden`. The second shot *is* the composited ground
behind the text, with no glyph pixels in it. No glyph detection, no estimation.

**Control, run first every time, never opt-in:** `#777` on `#808080` → **1.13** (must be
< 3) · black on white → **21.00** exactly. The instrument can report both verdicts.

| cell | graded | worst |
|---|---|---|
| dark · un-scrimmed | 3 | **11.47:1** |
| light · un-scrimmed | 3 | **6.40:1** |
| dark · scrimmed | ⛔ **0 — UNMEASURED** | — |
| light · scrimmed | ⛔ **0 — UNMEASURED** | — |

Every enabled label clears AA 4.5:1 with room. **The backplate-inside-the-material works.**

⛔ **The two empty cells are reported as a hole, not as a pass.** The only bubbles whose
centres land inside the scrim (`planTrade` cy=584, `alert` cy=604, against a scrim bottom
edge of y=626) are exactly the three the harness cannot enable: every `/api/*` returns `{}`,
so no symbol exists, `requires` is unmet, and they render at 0.4 opacity. **WCAG 1.4.3
exempts inactive components**, so grading them would manufacture a finding out of a
deliberate affordance. The tool exits **2 = INCONCLUSIVE**.

⚠️ The earlier version of this tool printed *"0 below AA"* over those empty cells, which
reads exactly like "both regions passed". That is the saturated-instrument shape — a cell
with nothing in it is not a cell that passed. Coverage is now printed **before** the
verdict.

### ⚠️ The exempt numbers are worth reading anyway

WCAG lets a disabled control off, but a member still has to look at it:

| | dark | light |
|---|---|---|
| `planTrade` (disabled) | 12.33:1 | 3.87:1 |
| `alert` (disabled) | 14.60:1 | 3.25:1 |
| `flag` (disabled) | 14.78:1 | **2.19:1** |

Dark is fine. **In light theme a disabled label falls to 2.19:1** — the 0.4 opacity that
makes "this needs a symbol first" legible as a *state* is also what makes the word hard to
read. Not a WCAG failure and not a defect; a question for the owner about whether "disabled"
should dim the ICON and the RIM rather than the text. Recorded, not acted on.

---

## M1 — and the control matters more than the number

4× CPU throttle, full `drag → open → select → release`, six samples per arm:

| | droppedFrames | mean | fps mean |
|---|---|---|---|
| **control** (no glass, HEAD's bundle) | 1, 4, 4, 3, 1, 4 | 2.83 | 52.1 |
| **glass** | 3, 5, 4, 4, 1, 2 | 3.17 | 49.5 |

The ranges overlap almost entirely (1–4 vs 1–5). **No measurable regression at this sample
size** — which is not the same sentence as "no regression".

⛔ **AND BOTH ARMS FAIL M1's ABSOLUTE "ZERO DROPPED FRAMES" — INCLUDING THE BUILD THAT
ALREADY SHIPPED.** An absolute frame bar on this rig measures the harness, not the feature.
That is precisely the ruling the design bar already made about fps on the Galaxy S24
(*"a ratio measures the feature; an absolute threshold measures the device"*), arriving in
a second costume. **Recommend M1 be restated as a ratio to the same build's own control**,
the way the fps criterion already is.

⛔⛔ **AND THE INSTRUMENT IS STRUCTURALLY INSENSITIVE TO WHAT IT IS BEING ASKED.** CPU
throttling throttles the main thread; `backdrop-filter` runs on the **GPU compositor**. So
"no difference detected" is partly what this rig would report whether or not a cost exists.
⭐ **M1-on-an-emulator cannot settle the glass question.** R9 stands, and the owner's device
tap is the only thing that can.

---

## ⚰️ Two corrections paid for in this pass

### A regression I introduced, and caught

Moving the open transition onto `.fanOpen .bubble` — specificity (0,2,0) — made it **beat
the reduced-motion block's bare `.bubble`** at (0,1,0). So `prefers-reduced-motion` silently
stopped reaching the bubble the moment that rule was written, and the fan would have kept
animating for exactly the members who asked it not to. **M7 is "respected", and a rule that
cannot win is not respect.** Both selectors are now listed in the media block, with a note
that any future specificity raise must be added there too.

### A documented mechanism that does not do what it says

`hub_critique_capture` states the fan is photographed after release *"because `stickyFan`
keeps it open"*, and `HARNESS-NOTES.md` repeats it. Probed on this build: at 600 ms after
`pointerup` the fan shows **zero** visible bubbles — with `stickyFan` defaulted **and**
with it stubbed `true`. The fan closes on release.

⭐ **The capture tool is correct for a different reason than its comment gives:** it
measures *before* releasing. Nothing was broken; the explanation was. A comment naming a
mechanism is a claim about a run.

---

## ⛔ F13 — the hub's "shadow" is a GLOW in light theme, and it corrects pass 2's F10

**Found by LOOKING at a frame, after the numbers had all passed.** In the light-theme
capture the bubbles wear a white halo rather than a drop shadow.

The cause is in the token, not the rule:

```
--hub-shadow:         … color-mix(in srgb, var(--bg) 65%, transparent)   (pre-existing)
--hub-shadow-ambient: … color-mix(in srgb, var(--bg) 70%, transparent)   (W4 pass 1)
--hub-shadow-key:     … color-mix(in srgb, var(--bg) 55%, transparent)   (W4 pass 1)

:root                --bg: #101012      -> near-black   ✅ a shadow
[data-theme="oled"]  --bg: #000000      -> pure black   ✅ a deeper shadow, deliberately
[data-theme="light"] --bg: #ffffff      -> WHITE        ⛔ a glow
```

⭐ **The derivation is deliberate and correct for the dark family** — the OLED block says so
in as many words: *"--hub-shadow/--hub-scrim already derive a deeper black automatically
because they're built from --bg, which OLED already redefines."* It simply inverts on the
one theme that has no `--hub-*` overrides.

⛔ **THIS CORRECTS PASS 2's F10.** That pass concluded *"the light-theme tokens are NOT
broken"* after measuring that glass, rim and chip derive from `--text-heading`, which flips
correctly. That was true of the tokens it checked and **false by omission about the shadow
family**, which derives from the other end of the palette. A conclusion drawn from three
tokens was stated about all of them.

⚠️ **Pre-existing, and amplified by this pass.** `--hub-shadow` already did this to the pad,
chip and knob; W4 pass 1 added two more layers of it to every bubble.

**Fix (pass 5):** the shadow ink becomes theme-invariant dark rather than `--bg`-derived —
which costs the dark family nothing (they are already near-black) and gives light theme an
actual shadow. ⛔ Not folded into this pass: it is a change every hub surface can feel, and
a material change and a shadow change in one diff is a diff nobody can bisect.

---

## ⚠️ F12 — the bottom cluster collides again, in a new form

Visible in both frames: **`Home` overlaps the Actions button**, and `Draw` / `Home` /
Actions form a crowded knot at the pad's left. F2 fixed the chip's collision by lifting it
clear of the arc; the inner-ring bubbles still land on top of the one control that is
always on screen.

⚠️ Recorded rather than fixed here — it is geometry (`fanGeometry.js`), not material, and
this pass deliberately touched only material.

---

## Still open

- **The two scrimmed cells** — need production, where a real symbol enables `flag`, `alert`
  and `planTrade` and puts graded labels inside the scrim.
- **F6** (9 px inner labels) and **F7** (colour reads as arbitrary; `confirm` is the
  quietest) — untouched by this pass, still deferred from pass 3.
- **Motion** — pass 5's subject: spring physics for fan open/close and thumb return,
  scale-on-press, the refraction highlight following drag direction, every curve a named
  token. Nothing in this pass touched feel.
- **D1's depth scale** — five surfaces still share one byte-identical blur. The bubble now
  has its own (`--hub-blur-bubble`, 14 px vs their 18 px), which is the first crack in the
  "one blur for five depths" defect but not the fix.
