"""Market Cap V1 REPORT SUITE -- the reports the automated gates (gates.py) read, for one build.

The same modules, arguments and order the accepted candidate's suite ran (scratchpad candidate.sh), minus the
comparisons against earlier report sets (three_columns / four_columns / history_10x), which are review aids, not
gates. Review inputs are FROZEN and hash-pinned in the refresh config:

  baseline            production Market Cap BEFORE (baseline.py) -- the comparison side of gates B / C
  v5_shares           the V5 served shares export the baseline was computed from
  first_build         the first-pass shadow build (blocker dispositions in magnitude_scan)
  blockers            blockers63.json
  adjudication_dir    the human adjudications (split / historical / cap-step dossiers, second-order findings)
  identity_reference  the ACCEPTED build whose history this build must retain (gate R); "NONE_FIRST_BUILD" only for a
                      first build. Missing = gate R fails.
  identity_attestations  optional human attestations of identity-boundary changes (identity_delta.py)

Steps run `parallel` at a time (default 2: the production host is memory-tight).
"""
from __future__ import annotations

import os
import shutil
import time
from concurrent.futures import ThreadPoolExecutor


def run_suite(build: str, data: str, out: str, review: dict, cmd, parallel: int | None = None) -> dict:
    from .refresh import mod
    os.makedirs(out, exist_ok=True)
    os.makedirs(os.path.join(out, "adjudication"), exist_ok=True)
    os.makedirs(os.path.join(out, "cap_steps"), exist_ok=True)
    open(os.path.join(out, "build_path.txt"), "w").write(build)
    base, v5, adj = review["baseline"], review["v5_shares"], review["adjudication_dir"]
    R = lambda n: os.path.join(out, n)
    A = lambda n: os.path.join(adj, n)
    first_wave = {
        "universe_audit": mod("universe_audit", "--build", build, "--baseline", base, "--data", data, "--v5", v5,
                              "--out", R("universe_audit.json"), "--csv", R("universe_per_security.csv")),
        "magnitude_scan": mod("magnitude_scan", "--build", build, "--baseline", base, "--data", data, "--first", review["first_build"],
                              "--blockers", review["blockers"], "--out", R("magnitude_scan.json")),
        "final_checks": mod("final_checks", "--build", build, "--baseline", base, "--data", data, "--out", R("final_checks.json")),
        "golden": mod("golden", "--build", build, "--data", data, "--out", R("golden.json")),
        "arm": mod("session_report", "--ticker", "ARM", "--build", build, "--baseline", base, "--data", data, "--v5", v5,
                   "--out", R("arm_before_after.json"), "--csv", R("arm_sessions.csv")),
        "validate_build": mod("validate_build", "--build", build, "--data", data, "--out", R("validate.json")),
        "history_adjudicate": mod("history_adjudicate", "--build", build, "--baseline", base, "--out", R("history_adjudication.json")),
        "adjudication_records": mod("adjudication_records", "--build", build, "--baseline", base, "--data", data,
                                    "--accepted-splits", A("split_dossier.json"), "--cohort", A("hist_cohort_final.json"),
                                    "--hist-dispositions", A("hist_dispositions.json"), "--out-dir", R("adjudication")),
        "adjudicate_steps": mod("adjudicate_steps", "--build", build, "--baseline", base, "--data", data, "--out", R("steps_dossier.json")),
        "step_records": mod("step_records", "--build", build, "--baseline", base, "--data", data,
                            "--cohort", A("cap_steps_unadjudicated.json"), "--dossier", A("steps_dossier_accepted.json"),
                            "--out-dir", R("cap_steps")),
        "scan2": mod("scan2", "--build", build, "--baseline", base, "--data", data, "--out", R("scan2.json")),
        "identity_delta": mod("identity_delta", "--build", build, "--reference", review.get("identity_reference") or "",
                              *(["--attestations", review["identity_attestations"]] if review.get("identity_attestations") else []),
                              "--out", R("identity_delta.json")),
    }
    res = {}
    t0 = time.time()
    with ThreadPoolExecutor(max(1, int(parallel or review.get("suite_parallel", 2)))) as ex:
        futs = {k: ex.submit(cmd, v, f"suite_{k}.log") for k, v in first_wave.items()}
        for k, f in futs.items():
            res[k] = f.result()
    res["stale15"] = cmd(mod("stale15", "--build", build, "--audit-rows", R("universe_audit_rows.json.gz"), "--out", R("stale15.json")),
                         "suite_stale15.log")
    for n in ("second_order_adjudication.json", "blockers63.json"):
        if os.path.exists(A(n)):
            shutil.copyfile(A(n), R(n))
    res["final_summary"] = cmd(mod("final_summary", "--reports", out, "--data", data, "--out", R("final_summary.json")),
                               "suite_final_summary.log")
    peak = max((r.get("peak_rss_mb") or 0) for r in res.values())
    return {"steps": res, "seconds": round(time.time() - t0, 1), "max_step_peak_rss_mb": peak}
