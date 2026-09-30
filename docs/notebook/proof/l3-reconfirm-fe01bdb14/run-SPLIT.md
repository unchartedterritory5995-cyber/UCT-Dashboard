# run.json split into parts for the 5 MB hygiene limit (R-RAW; this is not a summary)

- **Why:** the instrument wrote `run.json` at 11,854,014 bytes.
- **Method:**
  - `run-meta.json` holds every top-level key except `rows`, unchanged. That includes `summary`, `integrity` and `tip`.
  - `run-rows-<i>-<pass>.json` holds `{"pass", "row_count", "rows"}` for one pass, in the original order: 8 passes, 280 rows in total.
  - `run-SPLIT-index.json` lists the files and the original pass order.
- **Verified before the combined file was deleted:**
  - the metadata is equal to the original;
  - the row count is equal;
  - the multiset of rows, each serialised with sorted keys, is equal: LOSSLESS True.

To rebuild the object: `{**json.load(open("run-meta.json")), "rows": [r for f in index["files"] for r in json.load(open(f))["rows"]]}`, where `index` is `run-SPLIT-index.json`.
