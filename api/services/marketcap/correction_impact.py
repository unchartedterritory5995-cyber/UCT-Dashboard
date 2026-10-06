"""Market Cap CORRECTION IMPACT driver -- an evidence / review tool. It NEVER publishes and NEVER moves authority.

    python -m api.services.marketcap.correction_impact --root ROOT --accepted-run RUN_ID \
        (--reference-version REF-CORRECTION-... | --price-version PRICE-CORRECTION-...) --out DIR

accepted authority (the run's sealed inputs + its build) + ONE candidate historical correction ->
  * the candidate's inputs: the accepted run's inputs, byte for byte, with only the corrected input replaced (the
    candidate materialized from its store; an UNAPPROVED candidate may be read here and only here);
  * a full Market Cap derivation from them (the builder of this tree, methodology pinned);
  * the full release-gate suite on that build (the refresh's own suite + gates, plus HISTORY vs the accepted build);
  * the exact impact: affected issuers, sessions, old / new values and ratios, added / removed valued days.
A PASS here is what `approve` requires; the approval itself stays a human act.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import sqlite3
import subprocess
import sys

from . import acquire as Q, price_authority as PA, publication as P, reference_authority as RA, refresh as RF


def _link_inputs(src_data: str, dst_data: str, replace: str) -> None:
    os.makedirs(dst_data, exist_ok=True)
    for f in os.listdir(src_data):
        s = os.path.join(src_data, f)
        if os.path.isfile(s) and f != replace:
            d = os.path.join(dst_data, f)
            if not os.path.exists(d):
                os.link(s, d)


def impact(old_build: str, new_build: str, upto: int | None = None) -> dict:
    c = sqlite3.connect(f"file:{new_build}?mode=ro", uri=True)
    c.execute("ATTACH DATABASE ? AS a", (f"file:{old_build}?mode=ro",))
    upto = upto or c.execute("SELECT MAX(d) FROM a.cap_daily").fetchone()[0]
    tick = dict(c.execute("SELECT cik, primary_ticker FROM main.coverage"))
    rows = c.execute("SELECT n.cik, n.d, o.cap, n.cap FROM main.cap_daily n JOIN a.cap_daily o ON o.cik=n.cik AND o.d=n.d "
                     "WHERE n.d<=? AND ABS(n.cap/o.cap-1) > 1e-12 ORDER BY n.cik, n.d", (upto,)).fetchall()
    removed = c.execute("SELECT o.cik, COUNT(*), MIN(o.d), MAX(o.d) FROM a.cap_daily o WHERE NOT EXISTS (SELECT 1 FROM "
                        "main.cap_daily n WHERE n.cik=o.cik AND n.d=o.d) GROUP BY o.cik").fetchall()
    added = c.execute("SELECT n.cik, COUNT(*), MIN(n.d), MAX(n.d) FROM main.cap_daily n WHERE n.d<=? AND NOT EXISTS "
                      "(SELECT 1 FROM a.cap_daily o WHERE o.cik=n.cik AND o.d=n.d) GROUP BY n.cik", (upto,)).fetchall()
    c.close()
    by = {}
    for cik, d, o, n in rows:
        x = by.setdefault(cik, {"ticker": tick.get(cik), "cik": cik, "days": 0, "from": d, "to": d, "min_ratio": n / o,
                                "max_ratio": n / o, "examples": []})
        x["days"] += 1
        x["to"] = d
        x["min_ratio"], x["max_ratio"] = min(x["min_ratio"], n / o), max(x["max_ratio"], n / o)
        if len(x["examples"]) < 5:
            x["examples"].append({"d": d, "old": o, "new": n, "ratio": n / o})
    return {"upto": upto, "changed_values": len(rows), "affected_issuers": sorted(by.values(), key=lambda v: -v["days"]),
            "removed_valued_days": [{"cik": k, "ticker": tick.get(k), "days": n, "from": a, "to": b} for k, n, a, b in removed],
            "added_historical_valued_days": [{"cik": k, "ticker": tick.get(k), "days": n, "from": a, "to": b} for k, n, a, b in added]}


def run(root: str, accepted_run: str, out: str, *, reference_version: str | None = None,
        price_version: str | None = None) -> dict:
    if bool(reference_version) == bool(price_version):
        raise SystemExit("exactly one of --reference-version / --price-version")
    acc = RF.Refresh(root, accepted_run)
    run_row = acc.ledger.run(accepted_run)
    acc_build = os.path.join(acc.data, "builds", f"{run_row['build_id']}.db")
    if not os.path.exists(acc_build):
        raise SystemExit(f"accepted build {acc_build} is not on this volume")
    data = os.path.join(out, "data")
    if os.path.exists(out):
        shutil.rmtree(out)
    if reference_version:
        _link_inputs(acc.data, data, "ref.jsonl")
        cand = RA.materialize(RA.Store(root), reference_version, os.path.join(data, "ref.jsonl"), allow_candidate=True)
    else:
        _link_inputs(acc.data, data, "prices.db")
        cand = PA.materialize(PA.Store(root), price_version, os.path.join(data, "prices.db"), allow_candidate=True)
    bdir = os.path.join(data, "builds")
    os.makedirs(bdir, exist_ok=True)
    for f in os.listdir(bdir):                           # never the accepted builds (hard-linked dirs are not linked)
        os.remove(os.path.join(bdir, f))
    repo = acc.repo
    r = subprocess.run([sys.executable, "-m", "api.services.marketcap.build", "--data", data, "--out", bdir],
                       cwd=repo, capture_output=True, text=True)
    if r.returncode != 0:
        raise SystemExit(f"candidate build failed: {r.stderr[-2000:]}")
    nb = sorted(os.path.join(bdir, f) for f in os.listdir(bdir) if f.endswith(".db"))[-1]
    # the refresh's own suite and gates, in a dark run directory (never a target, never a pointer)
    dark = RF.Refresh(root, accepted_run)
    dark.data, dark.rdir, dark.logs = data, out, os.path.join(out, "logs")
    os.makedirs(dark.logs, exist_ok=True)
    dark._suite(nb)
    from .gates import evaluate
    v = evaluate(nb, os.path.join(out, "reports"), dark.cfg.review.get("adjudication_dir"))
    imp = impact(acc_build, nb)
    hist_bad = [x for x in imp["affected_issuers"] if x["max_ratio"] >= 2 or x["min_ratio"] <= 0.5]
    reint = RF.split_reinterpretations(nb, acc_build, imp["upto"])
    imp["split_reinterpretations"] = reint
    v["gates"]["HISTORY"] = {"pass": not hist_bad, "value": {"factor2_moves": hist_bad[:40], "split_reinterpretations": reint[:40]},
                             "definition": "historical values vs the accepted build: no factor >= 2 move (a correction "
                                           "candidate's split reinterpretations are LISTED -- they are what it proposes)"}
    v["status"] = "PASS" if all(x["pass"] for x in v["gates"].values()) else "FAIL"
    v["failed"] = [k for k, x in v["gates"].items() if not x["pass"]]
    res = {"candidate": cand, "accepted_build": {"build_id": run_row["build_id"], "path": acc_build,
                                                 "db_sha256": P.file_sha(acc_build)[0]},
           "candidate_build": {"path": nb, "db_sha256": P.file_sha(nb)[0]}, "gates": {"status": v["status"],
                                                                                    "failed": v["failed"]},
           "impact": imp, "advanced_authority": False}
    json.dump(v, open(os.path.join(out, "validation.json"), "w"), indent=1, default=str)
    json.dump(res, open(os.path.join(out, "impact.json"), "w"), indent=1, default=str)
    return res


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--root", required=True)
    ap.add_argument("--accepted-run", required=True)
    ap.add_argument("--reference-version")
    ap.add_argument("--price-version")
    ap.add_argument("--out", required=True)
    a = ap.parse_args(argv)
    res = run(a.root, a.accepted_run, a.out, reference_version=a.reference_version, price_version=a.price_version)
    print(json.dumps({k: res[k] for k in ("candidate", "gates", "advanced_authority")} |
                     {"changed_values": res["impact"]["changed_values"],
                      "affected": [(x["ticker"], x["days"], round(x["min_ratio"], 6), round(x["max_ratio"], 6))
                                   for x in res["impact"]["affected_issuers"][:20]]}, indent=1, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
