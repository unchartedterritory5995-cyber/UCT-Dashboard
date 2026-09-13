# Phase 2 — run 2 diagnostics

Two questions were sent for diagnosis before any fix: the sticky fan's 5/10, and the Galaxy
S24's 29.9 fps. Both are answered below from recordings, not theory. **Neither is a product
defect.** No product code was changed to produce any number here.

Harness: `C:\tools\hub-devicetests\tests\diagStickyFan.js` · `diagFps.js`.
Raw traces: `results/diag-sticky-*.json`, `results/diag-fps-*.json`.

---

## ⛔ First: run 2 itself is VOID. A second server was on the test port.

**This has to come before the diagnostics, because it explains most of run 2's failures and
it invalidates the numbers the diagnostics were commissioned to explain.**

At **23:52:03** a concurrent session on this machine started
`tools/local_backend_sandbox.py --port 8077 --ocr --stub-ask --email p3ocr@local.dev`
— on **port 8077**, the port the hub sandbox was already serving. Windows allowed the second
bind. From that moment the phones in BrowserStack were driving **a different server** through
the tunnel.

Run 2 ran **23:40 → 23:54**, so it straddles that boundary, and the symptoms line up exactly:

| device | when | what happened |
|---|---|---|
| iPhone 15 Pro | before | hub mounted; gesture rows failed on a real iOS harness bug |
| iPhone SE 3rd gen | before | hub mounted; sticky fan 10/10 |
| Galaxy S24 | at the boundary | **no results at all** |
| Pixel 8 | after | mounted, then `hub-pad not present` for every later step |

The tell that this was not a product regression: `signup` and `login` returned **200** against
a store `C:\data-hubtest\auth.db` could not see — the account simply was not in the sandbox
database afterwards. Nothing errored. HTTP kept answering. The results read like a hub that
had stopped mounting.

⭐ **A device result gathered against an unknown server is not a weak result — it is not a
result.** Run 2's matrix is therefore **not reported as findings**, and
`40-phase2-device.md` records it as void.

**Fixed:** `hub_sandbox_boot.py` now refuses to start if anything is already listening on its
port, naming the command to find the owner. The suite's base URL honours `HUB_TEST_PORT`, and
everything below ran on a dedicated **port 8099**. Live `C:\data` verified CLEAN throughout.

⚠️ The other session's process was **left running**. It is not mine to kill.

---

## 1. Sticky fan — NOT a product defect. The 5/10 was the harness.

**Method.** Ten trials per device, fresh page load each. Recorded per trial: every pointer
event on the pad `(t, x, y)`, a rAF-sampled DOM trace of which bubble the engine had
selected, whether the scrim was present, whether the scrim itself received a `pointerdown`,
the URL, and `data-hub-last-action`. Classification is arithmetic over the recording.

**Result: 10/10 held open on both devices. Zero failures. Nothing to classify.**

| device | held open | session |
|---|---|---|
| Google Pixel 8 | **10/10** | `5909675fe10b4d32dc9e2753c11a47f357caf255` |
| Samsung Galaxy S24 | **10/10** | `8283040226b5f2313d781bffc893c86f02314b3f` |

Every trial, both devices, identical shape:

```
held=YES  dur=~350ms  maxR=63  relR=61  relAng=0  sel@rel=null  scrimDown=0  fired=-
```

Against the three candidate mechanisms:

- **(a) released with a target selected — NO.** `sel@rel=null` in all 20 trials. Release
  angle is **0°**, outside `QUADRANT_DEG` [60, 210], so `resolveTarget` returns null and
  `stickyFan` holds the fan open. That is the documented design working.
- **(b) release re-read as a tap — NO.** Duration ~350ms exceeds `DOUBLE_TAP_MS` (280) and
  travel 63px exceeds `OPEN_AT_PX` (10). Neither tap condition is met, in any trial.
- **(c) scrim received the pointerdown — NO.** `scrimDown=0` in all 20 trials.

**So where did 5/10 come from?** The old implementation split one gesture across two
`perform()` calls and used `Origin.POINTER` for the jitter. iOS rejects that outright
("There is no previous item for '{origin = pointer}'"), and on Android it delivered the
wobble unreliably — some trials never moved past the open threshold at all. The fix that
made iOS work (one self-contained sequence per gesture) also made the Android jitter
deterministic. **The 5/10 measured the harness's pointer delivery, not the product's sticky
fan.**

⭐ And the number that first looked *good* was also wrong: the original 10/10 came from
counting `[data-action-id]`, which `HubFan` keeps mounted at all times. Both the false pass
and the false failure came from the same file. **Recommendation: no product change.**

---

## 2. Galaxy S24 frame rate — NOT the hub. The device runs at 30 fps.

**Environment (measured on-device, not assumed):**

| | Galaxy S24 | Pixel 8 |
|---|---|---|
| GPU renderer | **ANGLE (Samsung Xclipse 940) on Vulkan 1.3.231** | Mali-G715 |
| silicon | **Exynos 2400** (Xclipse ⇒ Exynos, not Snapdragon) | Tensor G3 |
| Chrome | 149.0.0.0 | 149.0.7827.160 |
| cores / DPR | 10 / 3 | 9 / 2.625 |

**The finding is condition (i).**

| condition | Galaxy S24 | Pixel 8 |
|---|---|---|
| **i — hub at rest, fan CLOSED (baseline)** | **30.1 fps** | **60.3 fps** |
| ii — fan open, scrim blur as shipped | 30.1 | 60.1 |
| iii — fan open, scrim blur disabled | 30.2 | 59.8 |
| iv — fan open, bubble blur disabled | 30.1 | 60.3 |
| v — fan open, chart canvas hidden | 30.2 | 60.0 |

**With the hub idle and no fan open at all, the S24 already renders at 30.1 fps.** Run 2's
29.9 is that baseline. The hub cannot be responsible for a ceiling that is already there
before any hub surface is drawn — and the Pixel 8, running the identical build, sits at 60
throughout. This reads as a 30 Hz cap on that BrowserStack unit (Exynos/Xclipse under ANGLE,
or device-farm throttling), not as a cost the hub imposes.

⚠️ **CONDITIONS ii–v ARE INCONCLUSIVE, AND I AM NOT TREATING THEM AS EVIDENCE.** The harness
verifies the fan is still open when a measurement ends, and that check **failed on ii–v on
both devices** (`WARNING: fan was NOT open`). The 5-second drag ends somewhere that dismisses
or fires the fan, so those four rows did not hold the condition they name. They are reported
because the reading is real, but **they do not establish that blur is free** — only (i) is
load-bearing, and (i) is sufficient to answer the question asked.

To close ii–v properly the drag must end inside the non-selecting sector with the fan still
open, verified before the counter is read. Not done; not needed for the ruling.

**Recommendation:** the S24's 29.9 is a **device/session characteristic, not a hub
regression**. Either waive it with the number recorded, or re-measure on a Snapdragon S24
unit before treating it as a gate failure. Per §3 of the Phase 2.5 plan, that waiver is the
owner's call and the number belongs in `40-phase2-device.md`.

---

## Harness defects found while producing these diagnostics

- **Port collision unguarded** — above. The guard now refuses to boot on a busy port.
- **`openFanSticky` opened to the RIGHT**, off the edge of a narrower phone. The pad sits
  24px from the right edge, so +80px left the viewport and Appium rejected the whole sequence
  ("move target out of bounds") — it passed on the wider Pixel 8 and failed on the S24. Now
  opens down-left (~225°, still outside the acceptance band) with viewport clamping.
  ⭐ A gesture whose validity depends on screen width silently only tests wide phones.
- **Test account drift** — the sandbox account authenticated against the foreign server, so
  the local store's copy went stale. Recreated; role `admin` verified in
  `C:\data-hubtest\auth.db` directly rather than trusting a 200.

---

## 3. `/charts` — the fan does not open. It is PRODUCT, and the touch never reaches the pad.

Sessions (Pixel 8): `a684c1441a27c2783fe27829af3fccf794528d6c` ·
`5296dd8f262fb7bbea3e6b7b039d248ab3da48b0` · `a4593125088120a5cf24a751ad9a0d154258865f` ·
`fa33dd0208010d58838b27efc33fecfa1a238210` · `1ba86f59851eaec3b1f6d2e4943dd1411765de36`.
Every probe ran `/dashboard` first as a control, where the same gesture works.

### (a) MOUNT — fine, and identical to the working route

`hub-root` and `hub-pad` are both present and displayed. `padRect` is **byte-identical on both
routes**: `{x:303, y:632, w:84, h:84}`. `display:block`, `visibility:visible`, `opacity:1`,
`pointer-events:auto`, `position:fixed`, `z-index:360`. **No ancestor transform or filter.**
`hidden` is false. Nothing about the mount differs.

### (d) ROUTE — fine

`data-mobile-chart-shell` correctly true on `/charts`, false on `/dashboard`.
`(pointer:coarse) and (max-width:640px) and (orientation:portrait)` = true; landscape-immersive
= false; no mode sets `hideOnRoute`. Viewport identical on both routes: `411×808`,
`visualViewport` `411×808`, `scale 1`, `scroll 0,0`. Route detection is not involved.

### (b) DELIVERY — ⛔ THE FAULT. The pad never receives the touch.

Capture-phase listeners at every level of the path:

```
/dashboard   window -> document -> html -> body -> hub-root -> pad-capture -> pad-bubble
/charts      window -> document -> html -> body            (stops)
```

It stops at `body` because **`hub-root` is not an ancestor of the event target**. The target is
a chart `CANVAS`:

```
/dashboard   aimed (345,674)  delivered (345,674)  target=hub-pad  elementFromPoint(there)=hub-pad
/charts      aimed (345,674)  delivered (345,674)  target=CANVAS   elementFromPoint(there)=CANVAS
```

Ruled out **by measurement**, not by reasoning:

- **Not a coordinate problem** — delivered `clientX/clientY` equal the aimed point exactly, with
  `scroll 0,0` and `visualViewport.scale 1`.
- **Not node replacement** — the instrumented pad is still the live pad (`sameNode: true`,
  `isConnected: true`), so no React re-render swapped it.
- **Not an overlay in the paint order at rest** — at load the pad IS the top element.

### (c) ENGINE — moot

`useJoystick` never receives a `pointerdown`, so travel, `OPEN_AT_PX`, a CSS transform on the
fixed container and pointer capture cannot be involved. The scrim never mounts and the `fanOpen`
class never appears — exactly what an engine that was never told anything happened looks like.

### ⚠️ The mechanism is NOT plain stacking, and it is time-dependent

`elementFromPoint` at the pad centre, after `/charts` loads:

| t | top element |
|---|---|
| 0 ms | **hub-pad** (z-index 360, fixed) |
| 500 ms → 7 s | **CANVAS** (z-index 2, absolute, rect `x:334 y:653 w:76 h:52`) |

The full ancestor walk puts **both elements in the ROOT stacking context**: the pad's chain is
`hub-pad(fixed, z360) → hub-root(fixed, z auto) → ._shell → body`, the canvas's is
`CANVAS(absolute, z2) → … → #mobile-charts-app → main → ._shell → body`, and there is **no
stacking context anywhere between either element and `body`**. On those facts `z-index 360` must
beat `z-index 2` — and at t=0 it does.

**I have not established what changes at ~500 ms, and I am not naming a one-line fix I cannot
support.** Proposing "raise the z-index" against measurements that already show 360 losing to 2
would be a guess dressed as a diagnosis.

**Strongest untested candidate, recorded as a hypothesis:** `hub-pad` is the only element in
either chain carrying **`backdrop-filter`**, which promotes it to its own compositing layer on
Android Chrome, while the Lightweight Charts canvases are separately composited. Layer-promotion
hit-testing against a late-painting canvas would explain an outcome plain stacking cannot, and
would explain why it only appears once the chart finishes painting.

**Next measurement — cheap and decisive:** re-run the time-sampled probe with
`backdrop-filter: none` injected on `.pad` through test-only CSS.

- If the pad stays hit-testable ⇒ layer promotion is the cause, and the fix is **hub-side**
  (`isolation: isolate` on `hub-root`, or moving the glass onto an inner element so the hit
  surface itself is unfiltered). No chart-shell change, no `requests.md` entry.
- If the canvas still wins ⇒ the cause is in the chart shell's compositing, and it goes to
  `requests.md` under the concurrent-work rule.

⚠️ **Pixel 8 only so far** — not yet reproduced on the other three devices, so the finding is
one device wide until run 4.

### RESOLVED — root cause found, fixed hub-side, verified on three devices

**Probe A (backdrop-filter: none on `.pad`) FALSIFIED the hypothesis.** With the filter off the
canvas still won at every sample. Layer promotion was not the cause, and the §3 preference
order — (1) move the glass inward, (2) `isolation: isolate`, (3) `will-change` — was built on
that premise, so none of the three was the right fix. Good that it was measured before it was
applied.

**Probe B found the trigger and the real mechanism.**

| t | canvases | pad is top? |
|---|---|---|
| 0 ms | **0** | YES |
| 250 ms | 3 | NO |
| 500 ms → 7 s | **15** | NO |

The chart mounts its canvases lazily, `0 → 3 → 15`. At t=0 the pad was "on top" only because
**nothing was there yet**. `/screener` control: pad stays top at all seven samples, 0 canvases —
chart-specific by construction, exactly as suspected.

**THE ROOT CAUSE — `hub-root` is `position: fixed` with `z-index: auto`.**

> **A `position: fixed` element ALWAYS creates a stacking context, z-index or not.**

So every `--z-hub-*` value in the subtree — pad `360`, fan and scrim `401` — was ordering the
hub's children **against each other**, inside a context that itself sat at level `auto` (0) in
the root stacking context. A Lightweight Charts canvas at `z-index: 2` therefore painted above
the entire hub.

⭐ **The whole z-index scale was inert, everywhere — not only on `/charts`.** The documented
ordering (`hub-open > backdrop > hub-rest > fab`) was never in effect against the rest of the
app; it only ever *looked* right because no other route had a positioned element above 0 at that
corner. `hubZIndex.test.js` compared the **tokens**, which were always correct, and structurally
could not see that the element carrying them was pinned to one rung.

**The fix — one line, hub-side, no chart-shell change:**

```jsx
zIndex: state.open ? 'var(--z-hub-open)' : 'var(--z-hub-rest)',   // on hub-root
```

Measured with the fix injected as test-only CSS, `padIsTop` at t = 0/250/500/1000/2000/4000/7000:

| device | as shipped | with the fix |
|---|---|---|
| Google Pixel 8 | NO at every sample | **YES at every sample** |
| Samsung Galaxy S24 | NO at every sample | **YES at every sample**, including while canvases grow 0→3→15 |
| iPhone 15 Pro | NO at every sample | **YES at every sample** |

Then verified **end to end with the real code and no injected CSS**: the `/charts` scrim step,
inconclusive in every run to date, returns
`PASS — scrim bottom 598px of 808px viewport; clearance 210px` on Pixel 8.

**§4 does not apply.** The fix is hub-owned, so `/charts` does **not** go to `hideOnRoute`, no
`requests.md` entry is filed, and the preview ships with `/charts` working rather than gapped.

**New rail** (`hubZIndex.test.js`): `HubRoot` must set `zIndex` from `--z-hub-open` /
`--z-hub-rest`, with the reason recorded that a fixed container without one pins the whole
scale. Mutation-proved — deleting the line turns it red, restored byte-identically
(`sha256 15ebecbbf3f6`). ⚠️ It asserts the source, not layout: jsdom composites nothing, so the
device rail (`elementFromPoint` at the pad centre on `/charts`) stays the real check and lands
in run 4.

⚠️ **CDP `LayerTree` was requested and is UNAVAILABLE** through BrowserStack's hub
(`debuggerAddress.match is not a function`). No layer-tree evidence is claimed — the finding
rests on `elementFromPoint`, computed styles and the full ancestor walk, which were sufficient.

### Evidence basis — recorded explicitly (owner ruling)

**The `/charts` finding rests on `elementFromPoint`, computed styles, and the full ancestor
walk. No layer-tree evidence exists** — CDP `LayerTree` is unavailable through BrowserStack's
hub (`debuggerAddress.match is not a function`), so the 500 ms transition was never explained at
the compositing level. It was explained at the *stacking* level, which is sufficient to justify
the fix but is not the same claim.

⛔ **Because of that gap, the run 4 DEVICE RAIL is the check that matters**, not the source-level
rail and not this document. It samples `elementFromPoint` at the pad centre on `/charts` at
**t = 0, 500, 2000, 7000 ms AND after one chart interaction** (a one-finger 100px pan of the
canvas, then a 500 ms settle), on all four devices.

⭐ The interaction sample exists because of a specific way this could still be wrong: **a pad
that survives first paint but loses to the canvas once the chart re-composites on interaction
would pass every check made so far and still fail for real users.** Lightweight Charts
re-rasterises on pan/zoom, which is exactly the moment a compositing-order defect would
reappear.
