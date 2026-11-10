# Run log: R-RAW evidence for the 9 title-menu cases

1. **Attempt 1: NOT KEPT.**
   - Probe bug: the menu probe read ⋯ (`watchlist.listMenu`) instead of the menu.
   - In that attempt C3-095 failed once, with a "Do you mean …?" reply. It passed when re-run alone, with the same probe
     bug.
   - I deleted attempt 1's files (JSON and PNGs) before committing. That was wrong: raw output, failed attempts
     included, is committed before interpretation. The files cannot be recovered.
   - Superseded by attempt 2.
2. **Attempt 2: the committed result** (`run.json`, `<id>.json`, `<id>-rightclick-*.png`).
   - Run after the probe fix (`div[data-guide$="Menu"]`, `watchlist.rowMenu`). 9/9.
