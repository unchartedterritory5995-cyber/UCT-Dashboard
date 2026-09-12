# Python test baseline

**Status: sweep IN PROGRESS at the time of writing.** Live counts are in
`scratchpad/pytest-baseline/progress.json`; this file records the method, the
partial result, and the cross-check. **Do not quote the counts below as final.**

## Method

`tools/python_failure_baseline.py sweep --batch-size 20`

- **1,407 test files** — 1,263 under `tests/`, 144 under `api/`.
- 71 batches of 20, **by explicit file path**, sequential, never parallel.
- `-p no:cacheprovider --timeout=120`, JUnit XML per batch.
- Free physical memory read via `ctypes.GlobalMemoryStatusEx` before every batch;
  the sweep **stops** rather than pushes through below 3 GB.
- A batch that crashes, is interrupted or times out is **split in half and retried
  once**; a group that still cannot run is recorded UNRUNNABLE with its reason,
  never skipped silently.

⛔ **Never `pytest tests/` and never `-k`.** Collection over the whole tree has
reached 6.6 GB here and a full run reached 18 GB before the OOM killer took it.
`-k` filters AFTER collection, so it contains nothing — which is exactly why a run
that *looked* scoped killed two background tasks on 2026-09-13.

## Partial result (12 of 71 batches)

| | |
|---|---|
| tests collected | 4,292 |
| failed | **1** |
| errors | 0 |
| skipped | 4 |
| unrunnable groups | **0** |
| min free memory | 14.24 GB |
| elapsed | 884 s (projected ~87 min total) |

### The one failure so far

| file | test | class | diagnosis |
|---|---|---|---|
| `api/services/journal_two/test_obsidian_parity_fixtures.py` | `test_regeneration_is_byte_identical_to_the_committed_fixtures` | assertion | **Almost certainly a line-ending environment artefact, not converter drift.** CLAUDE.md records that `core.autocrlf=true` on this box would rewrite the committed fixtures to CRLF and make this exact test "report every fixture as stale for a line-ending reason that has nothing to do with converter drift" — which is why `.gitattributes` pins those fixture paths `text eol=lf`. Verify by comparing bytes, not content, before treating it as real. **Not bisected.** |

⭐ **4,292 tests with a single failure is itself the headline.** The "9 pre-existing
Python failures" this sweep set out to enumerate are not visible in the first 17% of
the suite, so whatever that number referred to is either concentrated later, or was a
different runner, or has since been fixed.

## Cross-check against the recorded `gate_shards` baseline

That baseline (`docs/plans/joystick/gate-baseline.json`, measured 2026-09-10 at
`62a228e5d`, corroborated at two merge-bases) covers the **JS/vitest** suite, not
pytest — the two do not overlap, so there is nothing for this sweep to confirm or
contradict. It records **7 failures across 5 files**, plus three names that are
deliberately **not** baseline entries because each fails only under full-shard load and
passes alone: `flowSearchProduct`, `sharedScreen.route`, and
`ArticlesSection.native > clearing the query brings the full archive back`. A timeout
is never banked, because banking one leaves a slot a real failure can occupy unnoticed.

## The rail

`tools/python_failure_baseline.py check --files <explicit paths>` re-runs a named
subset and compares its red set to the recorded baseline:

- **0** the red set matches
- **1** it changed — a baseline failure started PASSING (update the baseline) or a NEW
  failure appeared
- **2** INCONCLUSIVE — the subset could not run at all. **Never a pass.**

**On-demand, not CI.** A full sweep is ~87 minutes, far past the ~5-minute bar for a
CI job, and a check over a named subset is only meaningful once the baseline is
complete.
