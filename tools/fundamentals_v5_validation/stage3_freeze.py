"""POST-GRIND STAGE 3 (runner, pinned V5 code): FREEZE -- only if every gate below holds.
Never writes v5.db (its bytes are frozen exactly as derive left them: the pre-validation sha256 must still match).
Writes: artifacts/ (publication-FORMAT files, LOCAL only -- nothing is published), freeze.json, then read-only perms.
Moves the three scratch copies out of validation/ into scratch/ (not part of the artifact)."""
import sys
CODE = "/data/fundamentals_pit_v5/code/7dfda83de6a7"
sys.path.insert(0, CODE)
import glob, hashlib, json, os, shutil, stat, time
from api.services.fundamentals_pit import publish as P, store as S

ROOT = "/data/fundamentals_pit_v5"
RUN, VAL, ART, VCODE, SCR = f"{ROOT}/run", f"{ROOT}/validation", f"{ROOT}/artifacts", f"{ROOT}/vcode", f"{ROOT}/scratch"
V5DB, SRC = f"{RUN}/v5.db", "/data/fundamentals_pit.db"
FREEZE = f"{ROOT}/freeze.json"
RUNNER_BRANCH, RUNNER_COMMIT = "fundamentals/v5-runner", "49b3063e2"
VALIDATION_BRANCH = "fundamentals/v5-validation"
VALIDATION_COMMIT = sys.argv[1] if len(sys.argv) > 1 else None


def sha(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


J = lambda n: json.load(open(f"{VAL}/{n}"))
now = lambda: time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
if os.path.exists(FREEZE):
    sys.exit("REFUSED: freeze.json already exists")
for p in os.listdir("/proc"):
    if p.isdigit():
        try:
            if b"fundamentals_pit.v5_rebuild" in open(f"/proc/{p}/cmdline", "rb").read():
                sys.exit(f"REFUSED: v5_rebuild alive pid {p}")
        except Exception:
            pass

s0, s1, s2, s2x = J("stage0.json"), J("compare.json"), J("stage2.json"), J("stage2x.json")
att, cf, d1, d2, d4 = J("attrib.json"), J("cf.json"), J("diag1.json"), J("diag2.json"), J("diag4.json")
adj, w4 = J("adjudication.json"), J("v4_untouched_worker.json")
run = json.load(open(f"{RUN}/run.json"))
db_sha = sha(V5DB)
wal = f"{V5DB}-wal"
A = s2x["A_invariants"]["counts"]
hardA = ["LOOKAHEAD_SOURCE_AFTER_T", "PERIOD_REGRESSED", "GAP_WITH_SOURCES", "NONFINITE_VALUE", "SOURCE_NOT_A_FILING_OF_CIK",
         "GAP_AS_FIRST_POINT", "GAP_NOT_NEWER_THAN_PREVIOUS", "REDUNDANT_REPEAT_POINT"]
g = s2["goldens"]
cfc = cf["by_why_cause"]
gates = {
    "artifact_bytes_unchanged_since_derive": db_sha == s0["v5_db_sha256_pre_validation"],
    "wal_empty": (not os.path.exists(wal)) or os.path.getsize(wal) == 0,
    "stage0_identity": s0["PASS"],
    "stage1_no_errors": not s1["errors"] and s1["n5"] == s0["derive"]["points"] and s1["n4"] == s0["v4_copy"]["points"],
    "stage1_wrong_all_adjudicated": s1["truth"].get("WRONG", 0) == sum(x["points"] for k in ("checker_false_positive", "deliberate_knowledge_rule_shared_with_v4")
                                                                     for x in adj["differential"]["stage1_WRONG_13"][k]),
    "every_difference_evidence_attributed": att["PASS"],
    "counterfactual_v4_evidence_reproduces_v4": cf["C_equals_v4_series_all"] and cf["restored_all"] and not cf["errors"],
    "stage1_unexplained_all_causally_attributed": cfc.get("UNEXPLAINED|NEW_V5_EVIDENCE", 0) + cfc.get("UNEXPLAINED|V5_LACKS_FS_EVIDENCE", 0)
        == s1["classes"].get("UNEXPLAINED", 0) and adj["differential"]["classification"]["UNEXPLAINED"] == 0,
    "value_to_gap_all_causally_attributed": sum(v for k, v in cfc.items() if k.startswith("V4VALUE_TO_V5GAP")) == s1["kinds"]["v4value_to_v5gap"],
    "invariants_hard_zero": all(A.get(k, 0) == 0 for k in hardA) and A["points"] == s0["derive"]["points"],
    "empty_sources_equal_v4_population": A.get("VALUE_WITHOUT_SOURCES", 0) == d1["empty_sources_total_v5"]
        and {r[0] for r in d1["empty_sources_v5"]} == {"fcf_ttm", "fcf_growth_ttm"},
    "impossible_dates_identical_to_v4": d2["v5"] == d2["v4"] == d2["same_keys"],
    "determinism_full_rebuild": s2x["B_determinism"]["PASS"],
    "pit_prefix_truncation_only_split_withholding": s2x["C_prefix_truncation"]["errors"] == 0 and d1["prefix_failures_all_split_withholding"],
    "gap_reproduction": s2x["D_gap_reproduction"]["PASS"],
    "served_is_pit_for_every_explain_divergence": all(x.get("verdict") == "SERVED_IS_PIT" for x in d4["truncation"])
        and d4["summary"]["v5_mismatch_total"] == len(d4["truncation"]),
    "goldens": g["CELH"]["PASS"] and g["TSLA"]["PASS"] and all(g[k]["differences"] == 0 for k in ("AAPL", "NVDA", "JPM", "CAVA", "MSFT", "KO")),
    "provenance_no_lookahead": s2["provenance"]["lookahead"] == 0,
    "full_incremental_parity_and_idempotency": all(s2["parity"][k] == s2["parity"]["n"] for k in ("evidence", "series", "gaps", "t_eff", "idempotent"))
        and s2["parity"]["errors"] == 0,
    "v4_untouched_on_worker": w4["equal_v4"] and w4["equal_r2"] and w4["now"]["r2"]["fundamentals_pit/v5/tickers.json"] is None,
    "validation_commit_given": bool(VALIDATION_COMMIT),
}
if not all(gates.values()):
    print(json.dumps({"FROZEN": False, "failed": [k for k, v in gates.items() if not v]}, indent=1))
    sys.exit(3)

# scratch copies are NOT part of the artifact
os.makedirs(SCR, exist_ok=True)
for f in ("stage2x_copy.db", "cf_copy.db", "parity_copy.db"):
    for suf in ("", "-wal", "-shm"):
        if os.path.exists(f"{VAL}/{f}{suf}"):
            shutil.move(f"{VAL}/{f}{suf}", f"{SCR}/{f}{suf}")

# publication-FORMAT artifacts, written LOCALLY (the bytes a later, separately-authorized publish would upload)
v5 = S.connect(V5DB, readonly=True)
ciks = [r[0] for r in v5.execute("SELECT cik FROM series_build WHERE derivation_version=5 AND status='ok' ORDER BY cik")]
man, total = {}, 0
for cik in ciks:
    doc = P.artifact(v5, cik, 5)
    if doc is None:
        continue
    body, etag = P.encode(doc)
    P._put_local(ART, P.key_for(cik, 5), body)
    man[str(cik)] = {"etag": etag, "sha256": hashlib.sha256(body).hexdigest(), "bytes": len(body)}
    total += len(body)
ibody, ietag = P.encode({"v": P.ARTIFACT_FORMAT, "derivation_version": 5, "tickers": P.ticker_index(v5)})
P._put_local(ART, P.index_key(5), ibody)
v5.close()
amanifest = {"run_id": run["run_id"], "code_sha": run["code_sha"], "code_tree_sha256": run["code_tree_sha256"],
             "companies": len(man), "bytes": total,
             "index": {"etag": ietag, "sha256": hashlib.sha256(ibody).hexdigest(), "tickers": len(json.loads(ibody)["tickers"])},
             "artifacts": man, "note": "LOCAL publication-format files; NOT published. Keys mirror fundamentals_pit/v5/ for a future authorized publish."}
mb = json.dumps(amanifest, sort_keys=True, separators=(",", ":")).encode()
open(f"{ART}/manifest.json", "wb").write(mb)
if sha(V5DB) != db_sha:
    sys.exit("STOP: v5.db changed during artifact export")

files = {}
for d in (RUN, VAL, VCODE):
    for p in sorted(glob.glob(f"{d}/*")):
        if os.path.isfile(p) and not p.endswith("-shm"):
            files[os.path.relpath(p, ROOT)] = {"bytes": os.path.getsize(p), "sha256": sha(p)}
files["artifacts/manifest.json"] = {"bytes": len(mb), "sha256": hashlib.sha256(mb).hexdigest()}
c = s0["v5_census"]
freeze = {
    "status": "VALIDATED + FROZEN", "frozen_at": now(),
    "run_id": run["run_id"], "derivation_version": run["derivation_version"], "methodology": run["methodology"],
    "artifact": {"path": V5DB, "sha256": db_sha, "bytes": os.path.getsize(V5DB), "journal_mode": c["journal_mode"],
                 "sha256_pre_validation": s0["v5_db_sha256_pre_validation"],
                 "logical_digest": s0["v5_logical"]["digest"], "full_digest_with_sources": s0["v5_logical"]["full_digest_with_sources"]},
    "census": {"points": s0["v5_logical"]["points"], "companies_built": c["companies_built"], "companies_with_points": c["companies_with_points"],
               "metrics": len(c["metrics"]), "gaps": c["gaps"], "gaps_by_metric": c["gaps_by_metric"], "t_eff_range": c["t_eff_range"],
               "signal_check": c["signal_check"], "filing_signal": c["filing_signal"]},
    "code": {"methodology_code_sha": run["code_sha"], "code_tree_sha256": run["code_tree_sha256"],
             "runner_branch": RUNNER_BRANCH, "runner_commit": RUNNER_COMMIT,
             "validation_branch": VALIDATION_BRANCH, "validation_commit": VALIDATION_COMMIT},
    "inputs": {"source_store": run["source_store"], "source_sha256": run["source_sha256"],
               "filing_census": run["census"]["filings"], "filing_census_sha256": run["census"]["accn_list_sha256"],
               "companies_with_facts": run["census"]["companies_with_facts"],
               "sec_bulk_inputs": json.load(open("/data/fundamentals_pit_work/inputs_import_report.json"))["files"]},
    "acquisition": {k: s0["acquisition"][k] for k in ("complete", "total", "unresolved_n", "signals", "finished_at", "resumes")},
    "derivation": {k: s0["derive"][k] for k in ("derived", "companies", "failed_n", "points", "gaps", "metrics", "finished_at", "elapsed_s")},
    "differential_v4_v5": {"identical": s1["kinds"]["identical"], "kinds": s1["kinds"], "v4_points": s1["n4"], "v5_points": s1["n5"],
                           "attribution": att["matrix"], "counterfactual": cfc, "truth": s1["truth"],
                           "unexplained_final": adj["differential"]["classification"]["UNEXPLAINED"], "diff_db": "validation/v4v5_diff.db"},
    "pit": {"source_time_lookahead_points": A.get("LOOKAHEAD_SOURCE_AFTER_T", 0), "source_refs_checked": A.get("source_refs_ok"),
            "prefix_truncation": {k: s2x["C_prefix_truncation"][k] for k in ("n", "ok", "errors", "prefix_points_total", "removed_filings_total")},
            "prefix_truncation_failures_all_split_withholding": d1["prefix_failures_all_split_withholding"],
            "explain_divergences": d4["summary"]["v5_mismatch_total"], "explain_divergences_served_is_pit": d4["summary"]["truncation_verdicts"],
            "provenance_sample": {k: s2["provenance"][k] for k in ("n", "matches", "lookahead")}},
    "goldens": {k: (v.get("PASS") if "PASS" in v else {"differences": v.get("differences")}) for k, v in g.items()},
    "parity": {k: v for k, v in s2["parity"].items() if k != "rows"},
    "idempotency": {"incremental_idempotent": s2["parity"]["idempotent"], "of": s2["parity"]["n"],
                    "full_rebuild_determinism": s2x["B_determinism"]["PASS"], "rebuild_digest": s2x["B_determinism"]["digest_rebuilt"]},
    "gaps": {"total": c["gaps"], "v4_total": s2x["A_invariants"]["gaps"]["v4_gaps"], "reproduced_sample": s2x["D_gap_reproduction"]["reproduced"],
             "sampled": s2x["D_gap_reproduction"]["sampled"], "companies_with_gaps": s2x["A_invariants"]["gaps"]["companies_with_gaps"],
             "by_year": s2x["A_invariants"]["gaps"]["by_year"]},
    "known_preexisting_issues": {k: adj["stage2x_flags"][k] for k in ("VALUE_WITHOUT_SOURCES_218755", "PERIOD_END_AFTER_T_1254",
                                                                     "PREFIX_TRUNCATION_26_OF_1358", "EXPLAIN_DIVERGENCE_6")},
    "v4_untouched": w4,
    "gates": gates,
    "artifacts_local": {"root": ART, "companies": len(man), "bytes": total, "index_tickers": amanifest["index"]["tickers"],
                        "manifest_sha256": hashlib.sha256(mb).hexdigest()},
    "files": files,
    "published_to_r2": False, "member_facing": False,
}
fb = json.dumps(freeze, indent=1, sort_keys=True, default=str).encode()
open(FREEZE, "wb").write(fb)
ro = stat.S_IRUSR | stat.S_IRGRP | stat.S_IROTH
rx = ro | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH
for d in (RUN, VAL, ART, VCODE):
    for dp, dns, fs in os.walk(d):
        for f in fs:
            os.chmod(os.path.join(dp, f), ro)
for d in (RUN, VAL, ART, VCODE):
    for dp, dns, fs in os.walk(d, topdown=False):
        os.chmod(dp, rx)
os.chmod(FREEZE, ro)
print(json.dumps({"FROZEN": True, "freeze_sha256": hashlib.sha256(fb).hexdigest(), "v5_db_sha256": db_sha,
                  "artifacts": len(man), "artifact_bytes": total}, indent=1))
