# Wave 10 F6: the raw benchmark output behind every switcher number (R-RAW)

This directory holds the benchmark output exactly as the runs wrote it, copied from the lane's scratch directory.
Nothing was re-rendered or summarised. The runs wrote CRLF line endings; git stores these files with LF
(`core.autocrlf`), so the content is identical and only the line endings differ. Every `*.json` stamps its own provenance in `meta`:
`git_head`, `git_dirty_paths` (the uncommitted paths under `api/` and `tools/` at run time) and `started_at`.
Each `*.log` is the console output of the same run.

All runs used `tools/notebook_scale_benchmark.py --tiers 50000 --thresholds docs/notebook/perf-budgets.json`
with 20 reps after 2 warm-ups. The budgets checked are given per run below.

| file | when (CT) | code measured | budgets | box | cited as |
|---|---|---|---|---|---|
| `before-50k.*` | 09-27 23:25 | `3c2356270` (pre-F6, clean) | `search` | quiet | perf-budgets.md §8 "before" column |
| `after-50k.*` | 09-27 23:44 | `b249a430e` + the uncommitted F6 code that became `7ee21a7fc` | `search` | **LOADED** (CPU 90% from other work), **discarded** | fix-round-1 "loaded-box reading 273.1 / 139.3" |
| `after2-50k.*` | 09-27 23:56 | `7ee21a7fc` (clean) | `search` | quiet | the **171.2 / 68.4** quiet p95 the two budget lines are derived from |
| `fr1-50k.*` | 09-28 00:12 | `169ed5948` + the uncommitted `matched` field that became `b5ae94167` | `search reads tasks switcher_body_common switcher_body_rare` | quiet | fix-round-1 gate run: VERDICT PASS; switcher p95 word start 37.00, fuzzy 51.64, body common 108.35, body rare 70.36 |
| `fr1-curve.*` | 09-28 00:13-00:14 | same tree as `fr1-50k` | `--curve` (1k, 5k, 10k, 25k, 50k) | quiet at start; the run overlapped this lane's own vitest mutation runs | slopes: body common 0.779 (last segment 0.816), body rare 0.698 (last segment 0.652) |

- **`fr1-curve` verdict.** The run is BUDGET BREACH. The breaches are on `count_notes`, `folder_note_counts`,
  `get_symbol_backlinks` and `list_tasks`, none of which this lane touches. They were already recorded as curve
  breaches in perf-budgets.md at the lane's base.
- **Interleaved A/B.** `ab_interleaved.py` is the harness that made the two A/B files:
  - `ab-interleaved-loaded.json` was 6 rounds x 5 reps and is **discarded** (loaded box).
  - `ab-interleaved-quiet.json` was 8 rounds x 5 reps and is cited in §8.
  - Each value is `[p50, p95]` in ms. The harness loads the pre-F6 `notes.py` (`git show 3c2356270:...`) beside
    the current one in the same process, against the same 50k file.
- **SQLite files not committed.** The per-tier SQLite files (~400 MB each) are not committed. The seed is deterministic
  (`random.Random(42)`), so a re-run rebuilds the same library.
- **Two probe files, run 2026-09-28 00:41 CT on a quiet box** (CPU 0-1%, 18.5 GB available), against the kept
  50k file seeded by the `before-50k` run. Each file's first lines stamp the time and HEAD:
  - `fts-probe.txt` from `fts_probe.py`: the raw full-text statements.
  - `topk-probe.txt` from `topk_probe.py`: a bounded top-k read against `list_notes`, with the answers
    compared for equality.
  - Both scripts read the 50k file from the lane's scratch path; point the glob at your own file to re-run them.
