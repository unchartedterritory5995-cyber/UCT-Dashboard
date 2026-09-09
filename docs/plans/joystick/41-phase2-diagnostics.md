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
