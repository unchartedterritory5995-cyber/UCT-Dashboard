# The evidence ledger (2026-11-13): licence-held verdicts that count, and stay fresh

Branch `data/pine-evidence-ledger`. The licence gate (`docs/pine/LICENSING.md`,
`corpus_licence.is_permitted`, the evidence engine's licence gate) keeps captures of licence-held
scripts out of git. That is DECIDED and unchanged. This makes their verdicts count.

## What was built

**`tools/vendor_harness/evidence_ledger.py`** is the one authority over the row, its check, its
append and its freshness rule.

A row (`uct.evidence-ledger/v2`) carries:
- `sourceSha256`, never the text;
- `scriptKey` (the capture stem) and `script` (the declared title);
- `symbol`, `timeframe`, `bars`;
- `receipt` and `captureSha256`;
- `verdicts` for BOTH lanes, `{production, runtime-on}` (`null` for a lane not graded);
- `scriptEngineVersion` and `graderVersion` (a sha over the corpus harness files) at grade time,
  and `gradedAtUTC`;
- `licence`, `filedBy` (`promote` or `regrade`).

`row_problems` refuses a row that has:
- any key outside `ROW_FIELDS` (so no source, no provenance, no account);
- any string over 600 characters;
- any line of the capture's source of 40 characters or more, found in any of its strings.

`append` dedupes on capture x engine x grader, so a regrade at a new engine is a new row.

**`evidence_engine.py`:**
- `grade` writes `grade-stamp.json` beside verdicts.json: the engine and grader the verdicts were
  graded AT.
- The packet carries that stamp and the run's lane.
- `promote` writes v2 rows through `make_row`, and refuses a run with no stamp: a verdict whose
  engine is unknown can never be judged fresh.
- Promote rows no longer carry the run's provenance/account fingerprint.
- `regrade` (new) re-grades the out-of-git capture store, `$UCT_VENDOR_CAPTURE_STORE` (default
  `%LOCALAPPDATA%/uct-vendor-batch/runs/*/captures`), in both lanes, under the heavy lock (it
  re-invokes itself through the lock tool and refuses without one), and appends one row per
  capture. The captures are staged into a temp dir; only verdicts are filed.

**Freshness** (`classify`): rows are grouped per capture and per lane, and the newest row wins, so a
regrade supersedes. A row counts only when:
- it was graded at the current `SCRIPT_ENGINE_VERSION`;
- its source sha256 is the sample's.

Otherwise:
- stale counts as `unproven (stale)`;
- a sample whose script key names the row but whose source does not hash to it is a sha mismatch,
  never counted;
- a DIVERGE is a DIVERGE;
- a capture already graded from a committed fixture is skipped, never counted twice.

**`coverage_map.py`:**
- `--ledger` defaults to the committed ledger.
- `ledger_evidence` + `fold_ledger`: a fresh ledger MATCH proves the sample script and the names
  it uses exactly as a committed MATCH capture does ("supported-and-verified").
- A script proven only by stale rows is `unproven (stale)`.
- `parity.ledger` reports fresh, stale, shaMismatch, unjoined and skipped, and only appears when the
  ledger has rows, so an absent ledger leaves the map byte-identical.

**`capability_admission.py evidence`:**
- `--ledger` likewise. A licence-held reference or builtin script's fresh runtime-on MATCH counts
  when its source sha is the script's own hash and the runtime lane drew it (`lanes`).
- Each entry is marked `ledger: true` with its `scriptEngineVersion`.
- `rollout_gate._pine_capability_evidence_counts` re-asks freshness at every admission: an engine
  bump retires a ledger entry until a regrade refreshes it.

## The first real regrade (this box, 2026-11-13)

`python tools/vendor_harness/evidence_engine.py regrade` took 76 s under the heavy lock. It found 67
captures in the store and filed 67 rows at engine 54, grader `0d24464e1be1`.

| licence | rows |
|---|---|
| corpus | 47 |
| probe | 19 |
| held | 1 |

| lane | MATCH | DIVERGE | INCONCLUSIVE |
|---|---|---|---|
| production | 33 | 17 | 17 |
| runtime-on | 36 | 18 | 13 |

The largest row is 1,456 bytes. Every row passes `row_problems` (rail L9).

## Not done here

- `docs/pine/coverage-map.json` was not regenerated: that needs the local census cache, which is not
  on this box. The next map run reads the ledger by default.
- The capture queue's committed snapshot is unchanged (`queue --check` PASS with the ledger present).

## Rails and mutants

The rails are listed in `tests/test_evidence_ledger.py` (L1-L9), plus three in
`tests/test_evidence_engine.py`: the promote row shape, the held capture never committed, and no
grade stamp means no promote. Mutants are listed in the PR body. All were killed, and each file was
restored from a saved copy and checked blob-equal to HEAD.
