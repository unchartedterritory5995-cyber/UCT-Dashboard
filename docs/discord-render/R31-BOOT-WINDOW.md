# R31 — the boot window, exposure-normalised

**Instrument:** `docs/discord-render/instruments/r31_boot_window.py` (`--self-check` PASS 3/3).
**Readings:** `docs/discord-render/evidence/d14-monitor/loop-boot-windows.jsonl`.
**Run of 2026-09-17 09:26 ET:** 38 pods · 42 stall events ≥ 1,000 ms · 35.2 h of wall clock ·
31 gaps · 0 pods failing the identity-coherence check.

```
  uptime (min)  pod-hours   n>=1s  per pod-h   n>=5s  per pod-h     max ms
           0-3       1.13       4       3.55       4       3.55      38869
           3-5       1.04       0       0.00       0       0.00          0
           5-8       1.41       1       0.71       0       0.00       1519
          8-11       1.25       3       2.41       2       1.60      12108
         11-15       1.36       4       2.94       0       0.00       4420
         15-20       1.34       3       2.24       1       0.75       6093
         20-25       1.22       1       0.82       0       0.00       3042
           25+      25.22      26       1.03       4       0.16      80249

  boot (0-15 min): 12 events over  6.19 pod-h = 1.94/pod-h
  tail (15+  min): 30 events over 27.78 pod-h = 1.08/pod-h
  ratio boot/tail: 1.80x
```

## ⭐ This reconciles Q6 and the OI-44 census, which were never actually in conflict

D-12 concluded **STARTUP** from seven windows on one pod. The OI-44 census overturned it: 27 of
42 stalls are provably settled-pod. **Both readings are true, of different quantities, and the
disagreement was RATE versus COUNT.**

- **RATE** — the boot window is worse: 1.94 vs 1.08 stalls per pod-hour, **1.80×**.
- **COUNT** — the tail holds far more events (30 of 42) and the single largest ever measured
  (80,249 ms), because **a pod spends ~82% of its observed life past minute 15** (27.8 of 34.0
  pod-hours). Counting events without dividing by exposure reports how long pods live.

⛔ **So "is it a startup problem?" was the wrong question, and answering it either way was going
to be wrong.** The honest statement is: *stalls are ~1.8× more frequent per unit time in the
first fifteen minutes, and most stalls still happen after them.* Neither half can be dropped.

## The tier-1 class is where the boot window really separates

`LOOP_STALL_PAGE_ALWAYS_MS = 5000` is what pages at any uptime. Split that class out:

| band | ≥5 s events | per pod-hour |
|---|---|---|
| 0–3 min | **4** | **3.55** |
| 3–8 min | 0 | 0.00 |
| 8–11 min | 2 | 1.60 |
| 11–25 min | 1 | 0.26 |
| 25+ min | 4 | **0.16** |

**Minutes 0–3 carry a ≥5 s rate ~22× the settled tail's.** Every one of the four is a page under
R34 tier 1 — and R35 says the number does not move to quiet them, so this band is the first place
to look for the cause.

⚠️ **AND THE BOOT BUCKETS ARE THIN — read n, not the rate.** Each holds ~1.1–1.4 pod-hours
against the tail's 25.2, so **one extra event moves a boot rate by ~0.8/pod-h**. A 4-event bucket
does not establish a rate; it establishes that the band is worth instrumenting. The 22× figure is
a ratio of two small numbers and should be quoted with both.

## What this does NOT say

⛔ **A ratio is not a cause.** This says WHERE stalls fall in a pod's life, never WHY. The census
already named the leading hypothesis for the tail — the post-close cluster on `fea2778d85cd`
between 16:23 and 17:03 ET, where the breadth collector, the EOD updaters and `/api/push` land —
and **that remains unattributed**. The join key is W1's durable stall record (wall-clock + uptime
per stall), which is live and armed but has recorded nothing yet: the current pod's window max is
664.9 ms against a 1,000 ms threshold, so the record is honestly silent rather than broken.

⛔ **The 11–15 minute band is NOT the tier-1 problem it was hypothesised to be.** It is elevated
for the ≥1 s class (2.94/pod-h, 4 events) and contributes **zero** ≥5 s events. If there is a
"minute-11-to-15 block", this dataset does not show it paging anyone.

## Method notes, because both were bugs waiting to happen

- **Exposure is OBSERVED, never assumed.** A pod contributes to a bucket only over the overlap of
  its own first-to-last reading span with that bucket, so a pod first polled at uptime 200 s adds
  nothing to 0–3 min. Assuming full coverage would dilute the boot rate with minutes nobody
  watched — and the dilution always flatters the boot window, which is the conclusion under test.
  `--self-check` proves a late-polled pod contributes zero early exposure.
- **A single-reading pod contributes no exposure at all** — it spans no time, and counting it as a
  bucket's worth would invent coverage.
- **The clustering and event derivation are imported from `d14_stall_census`, not restated.** The
  `(sha, boot)` identity with its 120 s tolerance, the first-reading clause and the
  rise-against-the-preceding-reading detector were each a measured bug; a second copy here would
  be a second authority over one number.

---

## Re-run at 09:28 ET, with 3 more pods and 4 more events — the finding strengthened

⭐ **Shown as a SERIES, not an overwrite.** A number that moves should be visible moving; replacing
the first reading would hide that this is a small-n measurement still filling in.

```
  41 pods, 46 stall events >= 1000 ms, 35.7 h, 31 gaps        (was 38 / 42 / 35.2 h)

  uptime (min)  pod-hours   n>=1s  per pod-h   n>=5s  per pod-h     max ms
           0-3       1.20       7       5.84       5       4.17      38869
           3-5       1.12       1       0.89       1       0.89      10470
           5-8       1.47       1       0.68       0       0.00       1519
          8-11       1.30       3       2.31       2       1.54      12108
         11-15       1.43       4       2.81       0       0.00       4420
         15-20       1.35       3       2.23       1       0.74       6093
         20-25       1.22       1       0.82       0       0.00       3042
           25+      25.22      26       1.03       4       0.16      80249

  boot (0-15 min): 16 events over  6.52 pod-h = 2.46/pod-h     (was 1.94)
  tail (15+  min): 30 events over 27.79 pod-h = 1.08/pod-h     (unchanged)
  ratio boot/tail: 2.27x                                        (was 1.80x)
```

**Every new event landed in the boot window**, and four of them were ≥5 s. The tail did not move
at all. So:

- the ≥1 s ratio went **1.80× → 2.27×**;
- minutes **0–3** now carry **4.17 ≥5 s events per pod-hour** against the settled tail's **0.16** —
  a ~26× separation on n=5;
- the 3–5 minute band, which was clean in the first run, now holds the **10,470 ms event that
  actually paged** (uptime 103.6 s).

⚠️ **This is what a small-n measurement filling in looks like, and the honest reading is the
DIRECTION, not the ratio.** Both runs agree that the boot window is worse per unit time and that
the ≥5 s class is where the separation lives; neither pins the multiplier, and the boot buckets
still hold ~1.1–1.5 pod-hours each against the tail's 25.2.

⛔ **And the minute-11-to-15 band still pages nobody** — 4 events ≥1 s, **zero** ≥5 s, across both
runs. Whatever the "minute-11-to-15 block" hypothesis was about, this dataset does not show it
reaching tier 1.
