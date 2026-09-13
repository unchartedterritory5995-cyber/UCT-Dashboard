# The review feed, measured — 2026-09-08

The design set a performance budget "up front so it can fail". This is the run
that tried to fail it. Instrument: `tools/review_feed_probe.py` (Playwright,
Chromium, 390×844 phone context, `is_mobile` + `has_touch`, refuses to report on
a fine pointer), against the fail-closed sandbox on :8093 with real bar data.

Three runs, 40 cards each, scrolled card by card and then back to the top with a
forced GC.

## What the budget asked for, and what came back

| budget | asked | measured | verdict |
|---|---|---|---|
| mounted charts at any time | ≤ 3 | **3, 3, 3** (peak in the feed) | ✅ held |
| heap growth over the scroll | < 150 MB | **+59.7 / +28.6 / +42.9 MB** | ✅ held, with room |
| returns to baseline after scrolling back | yes | residual **+8.2 / +10.2 / −9.7 MB** | ✅ within noise of baseline |
| 60 fps scroll | 60 | ~4% of frames > 32 ms; **worst frame 33 / 167 / 667 ms** | 🟠 see below |

Baselines were 111–132 MB and peaks 161–172 MB.

## 🔴 The one that did not pass cleanly

**The worst frame varies by an order of magnitude between identical runs: 33 ms,
167 ms, 667 ms.** The median is fine — around 4% of ~780 frames exceeded 32 ms in
every run, which is roughly one dropped frame per card transition and reads as
smooth. The tail does not match that story, and three samples cannot say why. It
is one chart mount, one GC pause, or one layout — and until that is separated,
"60 fps" is not a claim this feature can make.

⚠️ **And frame timing here is OPTIMISTIC by construction.** This is desktop
Chromium wearing a phone viewport, not an iPhone 12-class device. The memory
figures transfer reasonably; the frame figures do not. A device run is the only
thing that closes this row, and it stays open.

## ⚰️ Two instrument defects found by this run, both of which reported success

1. **`add_init_script` EVALUATES, it does not CALL.** The seed was written as
   `() => { … }` — the shape every `page.evaluate` in this repo takes — so the
   function was created and discarded, no session was ever seeded, and the probe
   refused with "the session did not reach the chart". That refusal reads as a
   product defect in the handoff. It was the harness.

2. **`performance.memory` is quantized and cached without
   `--enable-precise-memory-info`.** The first successful run returned *the
   identical byte value for all 39 samples* and printed **"heap growth 0.0 MB"**.
   That is the single biggest risk in this feature being retired by an instrument
   that was not moving — `lesson_a_saturated_instrument_reports_zero`, exactly.
   The probe now refuses to print heap figures as a result when every sample is
   identical, and says they are ABSENT rather than zero.

The second one is the reason this document exists rather than a one-line "budget
met" in a commit message.

## What else the run established

- **The handoff works end to end.** The probe seeds a `pending` session exactly
  as a scan entry does and navigates to `/charts?sym=…`. The transport control
  appearing is the proof the session survived the shell's own hydrated symbol —
  `handoff: adopted` in all three runs. That is the mechanism whose absence would
  have made every scan review destroy itself between the click and the chart.
- **The page holds FOUR charts during a review, not three.** The feed's three
  plus the chart shell's own, which stays mounted under the sheet by design
  ("returning is free"). Both numbers are real and they answer different
  questions; the probe reports them separately, because a page-wide count of 4
  against a budget of 3 reads as a breach and is not one.

## Reproducing

```
python tools/e2e_sandbox_launcher.py --port 8093          # fail-closed sandbox
UCT_SANDBOX_PASSWORD=<one you choose> \
  python tools/review_feed_probe.py --base http://127.0.0.1:8093 --cards 40
```

⛔ The password must be exported **before the first run** — `sandbox_account`
generates a fresh one per run, so a second run against an already-provisioned
sandbox fails login with 401 and measures nothing.
