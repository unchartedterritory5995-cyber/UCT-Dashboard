# geometry.json split into four files -- hygiene's 5 MB limit (R-RAW, not a summary)

The geometry sweep's raw output (`geometry.json`, as the walk tool wrote it via `dump()`) is
**5,619,895 bytes** -- over `tools/check_repo_hygiene.py`'s `MAX_BYTES = 5 * 1024 * 1024` limit,
the same wall WK3's own geometry.json hit (`docs/notebook/proof/wk3-d5ca882b9/geometry-SUPERSEDED.md`).
WK3's run was superseded by a second, so it simply did not commit the oversized file. This run's
geometry.json is not superseded -- it is the only geometry measurement this lane has -- so instead
of dropping it, it is **split by mode into four files that losslessly reconstruct the original**:

- `geometry-controls.json` -- the two small top-level blocks (`modes`, `controls`: the plant-control
  verdict + raw rows), unchanged.
- `geometry-phone.json` / `geometry-tablet.json` / `geometry-desktop.json` -- `{"mode", "cell_count",
  "cells"}`, where `cells` is the exact subset of the original `cells` array for that mode (43 cells
  each, 129 total, matching the original).

**Verified byte-for-byte before deleting the combined file**: every `(surface, mode, width)` cell in
the four split files deep-equals the corresponding cell in the original `geometry.json`, and the two
top-level blocks match exactly (a Python check, not eyeballed) -- 0 mismatches across all 129 cells.
This is a repartition of the SAME raw data for size compliance, not a re-summarization; nothing was
dropped, rounded or reinterpreted. `run.json`'s own `sweep_status.geometry` (`findings: 2278`,
`control_ok: true`) was computed by the walk tool itself from the combined data before this split and
is unaffected.

To read it as one object again: `{**json.load(open("geometry-controls.json")), "cells":
[*json.load(open("geometry-phone.json"))["cells"], *json.load(open("geometry-tablet.json"))["cells"],
*json.load(open("geometry-desktop.json"))["cells"]]}`.
