# Typing, quiet box: before and after the memoized draft snapshot

2026-10-01, 08:53 to 09:10 local. Raw files in this directory (`A1..A4`, `B1..B4`, `box-status.txt`), committed at `c2c5bc46b` before this reading was written.

- **A** = the L13 app, tree `ae93f4b64` (master `a680b0d40` plus one test-only commit).
- **B** = the L14 app, tree `25cd7155a`: lane TY2's change (`lib/memoDocJSON.js`, used by `captureLocalState`). The local draft is still written on every keystroke.
- **Harness:** `tools/notebook_perf_harness.py --boot --sizes 1000,2000 --opens 20 --chars 60`, a fresh data dir and port per run, interleaved A1 B1 A2 B2 A3 B3 A4 B4.
- **Box:** `tools/gate_box_lock.py status` read `load: QUIET` before every one of the eight runs (`box-status.txt`). Every sandbox integrity reading is CLEAN.

## Typing per character (budget: p95 under 16 ms, up to 2,000 paragraphs)

| run | 1,000 ¶ p50 | 1,000 ¶ p95 | 2,000 ¶ p50 | 2,000 ¶ p95 |
|---|---:|---:|---:|---:|
| A1 | 8.0 | 16.3 | 11.5 | 18.3 |
| A2 | 6.9 | 15.6 | 11.5 | 18.1 |
| A3 | 9.0 | 17.5 | 10.4 | 17.4 |
| A4 | 7.1 | 16.4 | 10.8 | 17.4 |
| **A median** | **7.55** | **16.35** | **11.15** | **17.75** |
| B1 | 7.9 | 15.8 | 11.1 | 17.8 |
| B2 | 7.2 | 14.5 | 10.9 | 19.6 |
| B3 | 8.1 | 17.2 | 11.2 | 16.9 |
| B4 | 5.3 | 15.8 | 6.7 | 16.3 |
| **B median** | **7.55** | **15.8** | **11.0** | **17.35** |

All values in ms.

## Reading

- **2,000 paragraphs: over the line on both builds.** All four B runs are over 16 ms p95 (16.3 to 19.6); the median is 17.35 ms against A's 17.75 ms.
- **1,000 paragraphs: at the line.** B's median p95 is 15.8 ms and three of its four runs are under 16 ms; A's median is 16.35 ms and one of its four runs is under.
- **The change's effect is small:** 0.4 to 0.55 ms off the median p95, which is inside the run-to-run spread (B's four runs at 2,000 ¶ span 3.3 ms). The medians at p50 are equal at 1,000 ¶ and 0.15 ms apart at 2,000 ¶.
- **Clause 4d stays NOT MET.** The budget covers notes up to 2,000 paragraphs, and at 2,000 no run on either build is under it. The budget was not moved.

This is the first set where every run started on a quiet box. It replaces the loaded sets in `../ty2/README.md` as the reading of record for the change; those were a wash for the same reason this one is small.

## What is left in a keystroke

From lane TY2's attribution at 2,000 paragraphs (`../ty2/ty2-attr-before.json`): the wrapped editor pieces are about 2.8 ms per key (`dispatch`), of which TipTap's `update` listener was 1.66 ms. The rest of a 17 ms p95 sample is the browser's own work on a 2,000-paragraph editable document (style, layout, paint) and one rendering frame, which the harness's sample includes by construction (`perf-budgets.md`, "A typing sample includes one rendering frame").

So the next lever is not in the editor's JavaScript. It is how much of the document the browser has to lay out and paint per key.
