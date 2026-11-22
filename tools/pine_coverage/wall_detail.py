"""W3W4-T0 - the wall DETAIL behind coverage-map.json, per script and per peel step, committed.

    python tools/pine_coverage/wall_detail.py --cache <prod census dir> --runtime-cache <runtime-on census dir> \\
        --out docs/pine/census/wall-detail-<date>.json [--measured-on D] [--master-sha S]

Why: the map carries wall LABELS; a breakdown (and the D3 / I4 / I6 spikes) also needs the guard, the token, the
op kind and the line, and for the runtime lane the decline code and the probe token. That used to come only from
the licence-held `census.jsonl`. This file holds identifiers and counters only: guard names, tokens (already
bounded to 80 characters and read from a script's identifiers), op kinds, line numbers, counts. No message text,
no source text. The licensing is the one the committed w3-object-why file carries.

Both lanes are required and each is refused when its rows name another lane (`coverage_map.read_census`).
"""
import argparse
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import coverage_map as CM  # noqa: E402

# a token is kept only when it reads as an identifier / dotted name: anything else could be a source fragment
_IDENT = re.compile(r"^[A-Za-z_][\w.]*$")


def _tok(t):
    return t if isinstance(t, str) and _IDENT.match(t) else None


def step_detail(st, runtime=False):
    """One census step as identifiers and counters (see the module docstring)."""
    if st.get("threw"):
        return {"threw": True}
    out = {
        "attached": bool(st.get("attached")),
        "refusals": [{"guard": r.get("guard"), "token": _tok(r.get("token")), "line": r.get("line")}
                     for r in st.get("refusals") or []],
        "attemptedOps": st.get("attemptedOps"), "droppedOps": st.get("droppedOps"),
        "split": CM.object_program_split(st),
        "dropReasons": st.get("dropReasons") or {},
        "droppedOpsDetail": [{k: h[k] for k in ("op", "line", "guard")} | {"token": _tok(h["token"])}
                             for h in CM.parse_drop_heads(st.get("dropHeads"))],
        "withheldPaints": st.get("withheldPaints"), "withheldObjects": bool(st.get("withheldObjects")),
        "lossVerdict": st.get("lossVerdict"),
    }
    if runtime:
        rd = st.get("runtimeDeclined") or {}
        pr = st.get("rtProbe") or {}
        out["runtimeDeclined"] = rd.get("code")
        out["probe"] = {"guard": pr.get("guard"), "token": _tok(pr.get("token")), "line": pr.get("line"),
                        "agrees": pr.get("agrees")} if pr else None
    return out


def build(prod_rows, rt_rows, measured_on=None, master_sha=None):
    scripts = {}
    for key in sorted(prod_rows):
        p = prod_rows[key]
        if p.get("clean"):
            continue
        r = rt_rows.get(key) or {}
        scripts[key] = {
            "production": [step_detail(s) for s in p.get("steps") or []],
            "runtimeOn": [step_detail(s, runtime=True) for s in r.get("steps") or []],
        }
    return {"schema": "uct.pine-wall-detail/v1", "generatedBy": "tools/pine_coverage/wall_detail.py",
            "measuredOn": measured_on, "masterSha": master_sha,
            "note": "identifiers and counters only; no message text, no source",
            "scripts": scripts}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--cache", required=True)
    ap.add_argument("--runtime-cache", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--measured-on")
    ap.add_argument("--master-sha")
    a = ap.parse_args()
    prod = CM.read_census(a.cache, CM.LANE_PRODUCTION, "--cache")
    rt = CM.read_census(a.runtime_cache, CM.LANE_RUNTIME_ON, "--runtime-cache")
    doc = build(prod, rt, a.measured_on, a.master_sha)
    tmp = a.out + ".tmp"
    with open(tmp, "w", encoding="utf-8", newline="\n") as f:
        json.dump(doc, f, separators=(",", ":"), sort_keys=False)
        f.write("\n")
    os.replace(tmp, a.out)
    print("wall detail: %d scripts -> %s" % (len(doc["scripts"]), a.out))


if __name__ == "__main__":
    main()
