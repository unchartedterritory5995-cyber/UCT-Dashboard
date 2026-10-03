# Typing on the L15 build: the busy-time reading (ruling D24)

2026-10-01, 19:28 to 19:34 local. Raw files here (`q1..q3.*`, `qN-box.txt`, `build.txt`), committed at `1241e34a1` before this reading was written.

- **Build:** `app/dist` built at `471add8f3`, the head of PR #262 (L15). It carries every typing fix so far:
  - TY2: the draft snapshot's JSON walk is memoized;
  - TY5: the draft's JSON text is reused for unchanged paragraphs;
  - TY7: the link-paste menu and table toolbar stop re-rendering per key; the toolbar's "is this block active" checks no longer walk the document.
- **Harness:** `tools/notebook_perf_harness.py --boot --busy --sizes 1,1000,2000 --opens 20 --chars 60`. The budget reads `typing_busy_per_char` p95 (ruling D24).
- **Box:** q1 was QUIET at both ends. Another session started tests during q2; q2 was QUIET at its start and BUSY at its end, and q3 was BUSY at both ends. Sandbox integrity CLEAN on all three.

## Busy time per keystroke, ms (p50 / p95)

| run | box | 1 ¶ | 1,000 ¶ | 2,000 ¶ |
|---|---|---|---|---|
| **q1** | **QUIET both ends** | 4.24 / 6.73 | 8.45 / 19.56 | 11.56 / 17.12 |
| q2 | quiet, then busy | 6.45 / 8.28 | 11.82 / 16.03 | 16.30 / 22.42 |
| q3 | busy | 5.91 / 8.63 | 11.52 / 18.72 | 15.21 / 20.44 |

Before L15's fixes (`../ty-floor/README.md`, three runs on a busy box), the median at 2,000 ¶ was p50 14.9 / p95 21.0.

## Reading

- **Clause 4d stays NOT MET.** The only run that was quiet at both ends is over the 16 ms line at 1,000 ¶ (19.56) and at 2,000 ¶ (17.12). Every run is under it at 1 ¶.
- **The median moved more than the tail.** At 2,000 ¶ the quiet p50 is 11.6 ms. The p95 sits 1 to 6 ms above the line on every run.
- **One run is not a distribution.** q1's 1,000 ¶ p95 reads higher than its 2,000 ¶ p95, which three more quiet runs would settle.
- **What is left is a tail, not a per-keystroke cost that every key pays.** A p50 of 11.6 against a p95 of 17 at 2,000 ¶ means a minority of keystrokes take much longer than the rest. The next lever is to find what runs on those keys (for example a debounced save, the outline or stats refresh, or a garbage-collection pause landing inside the window), not another per-key walk. This is a hypothesis; it has not been measured.
