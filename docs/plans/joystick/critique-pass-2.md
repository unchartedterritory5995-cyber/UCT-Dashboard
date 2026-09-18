# R8 — critique pass 2

> Against the **rebuilt bundle** (both pass-1 fixes shipped), 24 captured / 4 inconclusive.
> Frames: `scratchpad/critique/pass2built/` and `pass3/` (the first real light-theme run).

---

## Fixed since pass 1, verified in the built artifact

| | |
|---|---|
| **F1** the fan was drawn while closed | **FIXED.** Shipped CSS now carries `._fanOpen_… ._bubble_…{opacity:1;transform:none}`. At rest 0 bubbles visible; after a drag, 6. |
| **F2** the bottom band | **FIXED.** The chip lifts by `FAN_RADIUS_OUTER + CHIP_GAP_PX` while the fan is open, clearing the arc instead of announcing the ring from underneath it. |

---

## ⛔⛔ TWO DEFECTS IN THE INSTRUMENT, BOTH CAUGHT BY THE NEXT CHECK

Recorded first because both would have published a false result, and both are the same family
the owner's probe-control rule names.

### I1 — the open/closed test could never say no

`fan-open` was decided by *"are there `hub-bubble-*` elements in the DOM"*. `HubFan` mounts every
bubble at all times (spec §5), so that was true at rest, mid-drag and after release alike. Pass 1's
four "fan-open CAPTURED" rows rested on a predicate with one possible answer. Now decided on
**computed opacity**, and it must exceed the count visible **at rest**.

### I2 — the screenshot was changing the gesture

With I1 fixed, pass 2's first run reported **eight** fan-open rows INCONCLUSIVE while a hand-run
probe of the same build opened the fan every time. I did not pick a side — I reproduced the tool's
exact sequence and found it: the tool took the *pressed* screenshot **between `pointerdown` and
`pointermove`**. A Playwright screenshot takes ~1 s and `HOLD_MS` is **500**, so the engine had
already classified the gesture as a **hold** — which is a scrub, not a fan push
(`useJoystick.js:408`). **The instrument was changing the gesture it was photographing and
reporting the result as a property of the product.** The gesture now completes uninterrupted and
the state is photographed after (`stickyFan` keeps it open).

### I3 — twelve frames labelled "light" were dark

`color_scheme` sets `prefers-color-scheme`, which **appears nowhere in this app's stylesheets**.
The theme is `documentElement.dataset.theme`, written from `prefs.theme` (`Layout.jsx:81`). Every
"light" frame in passes 1 and 2 was the dark one filed twice. The capture now serves
`theme` through the preferences route, **asserts `dataset.theme` matches what was asked** before
keeping any frame, and records `page_bg` so the two can never silently converge again.

> **Control:** dark `rgb(16,16,18)` · light `rgb(255,255,255)`. They differ, so the light pass is real.

⭐ Note the chain: the stricter predicate from I1 is what exposed I2, and only a real theme
switch exposed I3. **Each fix made the next defect visible** — which is the argument for the
critique loop being more than one pass.

---

## New findings — the first genuine light-theme render

### F9 — ⛔ the scrim's edge is a hard two-tone seam

Measured with the fan open: `hub-scrim` is **390×626** on an 844-high viewport — it deliberately
excludes the bottom (`scrimExcludeBottom`). Its colour is theme-correct
(`rgba(16,16,18,.7)` dark · `rgba(255,255,255,.7)` light), but because it covers only ~74 % of the
screen, **its boundary is a straight horizontal edge across the display.** In dark theme that edge
is invisible (dark over dark). In light theme it is a glaring light/dark split with a ruler-straight
border, and it reads as a rendering error rather than a dimming.

⚠️ **What this harness CANNOT settle:** whether the region below the seam is legitimately dark.
Every API returns `{}`, so the charts page may be showing an empty dark container rather than its
real content. **The seam is real; the darkness beneath it is INCONCLUSIVE** and needs the sandbox.

### F10 — ⭐ the light-theme tokens are NOT broken, and that corrects my first read

`tokens.css:359` says *"No `[data-theme="light"]` `--hub-*` set anywhere in this file — deliberate …
light-theme adaptation is deferred"*, and the first frame looked like the cost of that deferral.
Measured, it is not: the hub tokens derive from `--text-heading` / `--bg`, which **do** flip per
theme, so glass, rim and chip all adapt on their own —

```
dark   --text-heading #ffffff   glass = #ffffff @ 8%     chip rgba(255,255,255,.08)
light  --text-heading #161a1e   glass = #161a1e @ 8%     chip rgba(22,26,30,.08)
```

⛔ **So "light theme is broken" would have been the wrong finding.** What is wrong is F9's seam and
the legibility that follows from it — not the token derivation. The deferral note is accurate.

### F11 — ⚠️ labels go dark-on-dark below the seam

In light theme, `Flag` / `Home` / `Draw` / `Voice` sit in the un-scrimmed dark region while their
text colour comes from the **light** palette. Downstream of F9; fixing the seam most likely fixes
this, and it should be re-judged after, not patched separately.

---

## Still open from pass 1

**F3** wedge renders as a visible rectangle · **F4** bubbles off the arc · **F5** "Plan t…"
truncation · **F6** 9 px inner labels · **F7** arbitrary colour, `confirm` the quietest ·
**F8** the pad reads as a disabled radio button.

## The four INCONCLUSIVE rows, unchanged

`/dashboard` mounts no hub on this harness. Still **INCONCLUSIVE, not a defect** — and still the
one frame that would settle **D-53** (Home's one-bubble fan).

⛔ **Pass 3 must run on the sandbox**, not this harness: F9's darkness, the `/dashboard` mount, and
any judgement about glass over live data all need real page content.
