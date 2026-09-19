# -*- coding: utf-8 -*-
"""OOS-2 report generator — joins the three measurement sources into the report
shape OOS_2_MEASUREMENT_PROTOCOL.md section 6 requires.

Inputs:
  --layer-a   JSON written by app/src/components/chart/engine/ast/pine.oosBaseline.test.js
  --visual    JSON written by tools/oos_visual_classify.py
  --manifest  tests/fixtures/pine_oos/MANIFEST.json

⛔ IT PUBLISHES ALL THE METRICS OR NONE. The protocol forbids a single headline
compatibility percentage, so this tool has no mode that prints one. Every rate is
reported beside the breakdowns that qualify it.

⛔ IT NEVER INFERS A MISSING MEASUREMENT. A script absent from an input is
reported as absent, never defaulted -- an absent script silently counted as a
failure (or a success) is exactly the accounting defect this program keeps
finding.
"""
import argparse
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

OUTCOMES = [
    "RAW_ACCEPTED", "ASSISTED_ACCEPTED", "CORRECTLY_REFUSED",
    "INVALID_SOURCE", "SILENT_FALSE_SUCCESS", "UNKNOWN_NEEDS_ADJUDICATION",
]
TRUTHFUL = {"RAW_ACCEPTED", "ASSISTED_ACCEPTED", "CORRECTLY_REFUSED", "INVALID_SOURCE"}
TIERS = ["V0", "V1", "V2", "V3", "V4", "V5"]


def pct(n, d):
    return "  n/a" if not d else f"{100.0 * n / d:5.1f}%"


def norm(name):
    """Frozen files are stored `<tier>__<file>.pine`; the visual tool reports the
    same basename. Strip the extension only -- never the tier prefix, or two tiers'
    same-named scripts would collide into one row."""
    return name[:-5] if name.endswith(".pine") else name


def load(path, label):
    p = Path(path)
    if not p.exists():
        sys.exit(f"missing {label}: {p}")
    return json.loads(p.read_text(encoding="utf-8"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--layer-a", required=True)
    ap.add_argument("--visual", required=True)
    ap.add_argument("--manifest", required=True)
    ap.add_argument("--adjudication", help="optional JSON: {script: outcome} overrides from the SWR audit")
    ap.add_argument("--out")
    args = ap.parse_args()

    la = load(args.layer_a, "layer A report")
    vis_rows = load(args.visual, "visual classification")
    man = load(args.manifest, "freeze manifest")

    vis = {norm(v["file"]): v for v in vis_rows}
    meta = {norm(f"{e['tier']}__{e['file']}"): e for e in man["entries"]}
    rows = {norm(r["name"]): r for r in la["rows"]}

    adjudged = {}
    if args.adjudication:
        adjudged = load(args.adjudication, "adjudication")

    # ── coverage check: every frozen script must appear in every source ──
    missing = []
    for key in meta:
        if key not in rows:
            missing.append(("layer-a", key))
        if key not in vis:
            missing.append(("visual", key))
    extra = [k for k in rows if k not in meta]
    if missing or extra:
        print("!! COVERAGE PROBLEM -- the report is not trustworthy until this is closed")
        for src, k in missing:
            print(f"   missing from {src}: {k}")
        for k in extra:
            print(f"   measured but not in the manifest: {k}")
        print()

    n = len(meta)
    print(f"=== OOS-2 BASELINE — {n} frozen scripts ===")
    print(f"freeze id: {man['freeze_id']}")
    print(f"frozen at: {man['frozen_at']}\n")

    # ── outcomes ──
    def outcome_of(k):
        o = rows.get(k, {}).get("outcome", "UNKNOWN_NEEDS_ADJUDICATION")
        return adjudged.get(k, o)

    oc = Counter(outcome_of(k) for k in meta)
    print("--- OUTCOMES ---")
    for o in OUTCOMES:
        print(f"  {o:<28} {oc.get(o,0):>3}   {pct(oc.get(o,0), n)}")
    truthful = sum(oc.get(o, 0) for o in TRUTHFUL)
    raw, asst = oc.get("RAW_ACCEPTED", 0), oc.get("ASSISTED_ACCEPTED", 0)
    print(f"\n  {'RAW ACCEPTANCE':<28} {raw:>3}   {pct(raw, n)}")
    print(f"  {'ASSISTED ACCEPTANCE':<28} {raw+asst:>3}   {pct(raw+asst, n)}  (raw + assisted)")
    print(f"  {'ASSISTED RECOVERY':<28} {asst:>3}   {pct(asst, n-raw)}  (of the raw shortfall)")
    print(f"  {'TRUTHFUL OUTCOME RATE':<28} {truthful:>3}   {pct(truthful, n)}")
    flagged = [k for k in meta if rows.get(k, {}).get("needsSilentWrongResultAudit")]
    print(f"  {'flagged for SWR adjudication':<28} {len(flagged):>3}   {pct(len(flagged), n)}")

    # ── journey ──
    print("\n--- JOURNEY (static layer; chart/persistence are Layer C) ---")
    accepted = [k for k in meta if outcome_of(k) in ("RAW_ACCEPTED", "ASSISTED_ACCEPTED")]
    def acc(k):
        r = rows[k]
        return r.get("assisted") or r.get("raw") or {}
    scr_bool = [k for k in accepted if acc(k).get("outputsBool", 0) > 0]
    multi = [k for k in accepted if acc(k).get("outputsTotal", 0) > 1]
    params = [k for k in accepted if acc(k).get("inputParams", 0) > 0]
    print(f"  {'accepted at all':<34} {len(accepted):>3}   {pct(len(accepted), n)}")
    print(f"  {'…with a screenable BOOLEAN output':<34} {len(scr_bool):>3}   {pct(len(scr_bool), n)}")
    print(f"  {'…carrying >1 output':<34} {len(multi):>3}   {pct(len(multi), n)}")
    print(f"  {'…with discovered input params':<34} {len(params):>3}   {pct(len(params), n)}")
    print("  NOTE: screener VALUE availability is 0 by construction — the scan gate is")
    print("        boolean-only (scan_definition.py:477-483). See gap S-01.")

    # ── breakdowns ──
    def breakdown(title, keyfn, order=None):
        print(f"\n--- {title} ---")
        buckets = defaultdict(list)
        for k in meta:
            buckets[keyfn(k)].append(k)
        keys = order or sorted(buckets, key=lambda x: str(x))
        width = max((len(str(k)) for k in keys if k in buckets), default=8)
        hdr = f"  {'bucket':<{width}} {'n':>3} {'raw':>10} {'assisted':>10} {'refused':>10} {'truthful':>10}"
        print(hdr)
        for b in keys:
            ks = buckets.get(b)
            if not ks:
                continue
            d = len(ks)
            r = sum(1 for k in ks if outcome_of(k) == "RAW_ACCEPTED")
            a = sum(1 for k in ks if outcome_of(k) in ("RAW_ACCEPTED", "ASSISTED_ACCEPTED"))
            f = sum(1 for k in ks if outcome_of(k) == "CORRECTLY_REFUSED")
            t = sum(1 for k in ks if outcome_of(k) in TRUTHFUL)
            print(f"  {str(b):<{width}} {d:>3} {pct(r,d):>10} {pct(a,d):>10} {pct(f,d):>10} {pct(t,d):>10}")

    breakdown("BY VISUAL COMPLEXITY (predeclared, source-only)",
              lambda k: vis.get(k, {}).get("tier", "?"), TIERS)
    breakdown("BY ENGAGEMENT STRATUM", lambda k: meta[k]["tier"])
    breakdown("BY SOURCE COMPLEXITY (non-comment lines)",
              lambda k: meta[k]["complexity_bucket"], ["short", "medium", "long"])

    def pine_ver(k):
        # ⛔ READ THE VERSION THE TRANSLATOR PARSED, NOT THE SIDECAR PROSE.
        # Sourcing runs spelled it three ways -- "v6", a bare "6", and a whole
        # sentence. Worse, one of those sentences is "unknown (no //@version
        # directive present; legacy pre-v2 default…)", and any regex loose enough
        # to catch the bare digit also catches the "v2" inside "pre-v2" and files
        # an UNVERSIONED script as v2. `translatePine` returns the version it
        # actually read from the source; that is the one authority.
        v = rows.get(k, {}).get("raw", {}).get("version")
        if isinstance(v, int) and v > 0:
            return f"v{v}"
        return "unversioned"
    breakdown("BY PINE VERSION", pine_ver, ["v2", "v3", "v4", "v5", "v6", "unversioned"])

    # ── visual primitive demand vs support ──
    print("\n--- VISUAL PRIMITIVE DEMAND (source-only) vs SUPPORT ---")
    fam = {"P": "plot()", "L": "hline()", "F": "fill()", "B": "bgcolor()/barcolor()",
           "M": "plotshape/char/arrow", "C": "plotcandle/plotbar",
           "O": "label/line/box/table objects"}
    # Support status is the code-verified finding recorded in ENDZONE_GAP_REGISTER.md.
    support = {
        "P": "CARRIED (style/colour/width dropped — V-02..V-05)",
        "L": "DROPPED at import; schema HAS hlines (V-07)",
        "F": "SCHEMA-INERT — validated, drawn by nothing (V-10)",
        "B": "ABSENT — reserved style, refused (V-20/21)",
        "M": "VALUE ONLY — glyph/anchor/direction lost (V-22)",
        "C": "4 numeric columns, no candle (V-23)",
        "O": "ABSENT — refused pine:drawing (V-24)",
    }
    print(f"  {'primitive':<26} {'scripts':>8} {'sites':>7}   status")
    for k in "PLFBMCO":
        used = sum(1 for s in meta if vis.get(s, {}).get("families", {}).get(k, 0) > 0)
        sites = sum(vis.get(s, {}).get("families", {}).get(k, 0) for s in meta)
        print(f"  {fam[k]:<26} {used:>4}/{n:<3} {sites:>7}   {support[k]}")
    dyn = sum(1 for s in meta if vis.get(s, {}).get("dynamic_color_sites", 0) > 0)
    cvis = sum(1 for s in meta if vis.get(s, {}).get("conditional_visibility"))
    print(f"  {'dynamic colour':<26} {dyn:>4}/{n:<3} {'':>7}   PARTIAL — sign-of-zero only (V-12)")
    print(f"  {'conditional visibility':<26} {cvis:>4}/{n:<3} {'':>7}   PARTIAL — via NaN gaps only")

    # ── blockers ──
    print("\n--- PRIMARY BLOCKERS (refused + unknown) ---")
    bl = Counter()
    for k in meta:
        if outcome_of(k) not in ("RAW_ACCEPTED", "ASSISTED_ACCEPTED"):
            b = rows.get(k, {}).get("primaryBlocker")
            if b:
                bl[b] += 1
    for g, c in bl.most_common():
        print(f"  {c:>3}  {g}")

    if args.out:
        Path(args.out).write_text(json.dumps({
            "freeze_id": man["freeze_id"], "scripts": n,
            "outcomes": dict(oc), "truthful_outcome_rate": truthful / n if n else 0,
            "raw_acceptance": raw / n if n else 0,
            "assisted_acceptance": (raw + asst) / n if n else 0,
            "flagged_for_swr_audit": flagged,
            "blockers": dict(bl),
            "per_script": {k: {
                "outcome": outcome_of(k),
                "visual_tier": vis.get(k, {}).get("tier"),
                "engagement": meta[k]["tier"],
                "complexity": meta[k]["complexity_bucket"],
                "pine_version": meta[k].get("pine_version"),
                "primary_blocker": rows.get(k, {}).get("primaryBlocker"),
                "outputs_total": acc(k).get("outputsTotal") if k in accepted else None,
                "outputs_bool": acc(k).get("outputsBool") if k in accepted else None,
            } for k in sorted(meta)},
        }, indent=2), encoding="utf-8")
        print(f"\nWrote {args.out}")


if __name__ == "__main__":
    sys.exit(main())
