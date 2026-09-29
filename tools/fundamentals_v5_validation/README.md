# Fundamentals V5 post-grind validation + freeze

Run: `v5-20260925T124921Z`. Methodology code: `7dfda83de` (pinned tree `37878950…`).
Runner: `fundamentals/v5-runner` @ `49b3063e2`.

Every script runs on the `fundamentals-v5-runner` service under the pinned code
(`srun.sh <service> <dir> <name> <script>`: sha-verified upload + detached run with PID 1's env).
Every store is opened read-only. Anything that rebuilds does it on a scratch copy.
Outputs land in `/data/fundamentals_pit_v5/validation/`.

| Order | Script | Output | What it checks |
|---|---|---|---|
| 0 | `stage0_identity.py` | `stage0.json` | Run identity, pre-validation sha256, censuses, V4 copy equals the prod baseline, no write since DERIVATION_COMPLETE |
| 1 | `stage1_compare.py` | `compare.json`, `v4v5_diff.db` | Full V4/V5 differential; every differing key stored in the diff DB |
| 1b | `trace_flagged_points.py` | `trace.json` | Provenance and later-report chains for every flagged point |
| 1c | `attrib_company.py` | `attrib.json` | Series differ ⇒ evidence differ (derivation code identical) |
| 1d | `counterfactual.py` | `cf.json` | Causal cause of every value→gap / unexplained point; V4 evidence reproduces V4 exactly |
| 1e | `gapjust2.py`, `corroborate_evidence.py` | `gapjust2.json`, `corrob.json` | Gap justification and companyfacts corroboration |
| 2 | `stage2_established.py` | `stage2.json` | Goldens, 1,500-point provenance/lookahead sample, 40-company full-vs-incremental parity + idempotency |
| 2x | `stage2x_full_artifact.py` | `stage2x.json` | Invariants over all 4.72M points, full-rebuild determinism, 1,358 PIT prefix truncations, gap reproduction |
| 2d | `diag1_flags.py` … `diag4_served_vs_rederived.py` | `diag1..4.json` | Adjudication evidence for the stage-2x flags |
| — | `v4_untouched_worker.py` (worker) | `v4_untouched_worker.json` | V4 logical digest, R2 v4 index, R2 v5 absent |
| 3 | `stage3_freeze.py <validation_commit>` | `freeze.json`, `artifacts/` | Gate re-evaluation, then freeze (v5.db bytes untouched; read-only perms) |

The parity inputs are the SEC bulk files the source store was built from, staged through the private
`_runs/fundamentals_pit_v5/<run>/validation_inputs/` prefix (`inputs_export_worker.py` → `inputs_import_runner.py`).

`adjudication.json` is the human classification of every flagged item, with the evidence file for each.
