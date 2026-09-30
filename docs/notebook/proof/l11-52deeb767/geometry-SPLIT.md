# geometry.json split into four files for the 5 MB hygiene limit (R-RAW; this is not a summary)

- **Why:** the walk wrote `geometry.json` at 5,649,146 bytes, over the 5 MB limit in `tools/check_repo_hygiene.py`.
- **Method:** the same as `../wk4-e1ef47435/geometry-SPLIT.md`.
  - `geometry-controls.json` holds `modes` and `controls`, unchanged.
  - `geometry-phone.json`, `geometry-tablet.json` and `geometry-desktop.json` each hold `{"mode", "cell_count", "cells"}` for their mode. Together they cover 129 cells, the same as the original.
- **Verified before the combined file was deleted:** `modes` and `controls` are equal to the original. The multiset of cells, each serialised with sorted keys, is equal to the original's, and the counts match: LOSSLESS True.

To read it as one object again:
`{**json.load(open("geometry-controls.json")), "cells": [*json.load(open("geometry-phone.json"))["cells"], *json.load(open("geometry-tablet.json"))["cells"], *json.load(open("geometry-desktop.json"))["cells"]]}`
