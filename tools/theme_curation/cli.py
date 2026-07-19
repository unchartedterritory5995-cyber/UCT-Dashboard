"""Curation pipeline CLI."""
import argparse
import subprocess
import sys

from tools.theme_curation import loaders, apply as A


def is_git_clean(path: str) -> bool:
    out = subprocess.run(["git", "status", "--porcelain", path],
                         capture_output=True, text=True).stdout.strip()
    return out == ""


def load_approved(ledger_path: str, review_dir: str):
    """Assemble approved Proposals from the ledger + parsed review docs. Owner-run;
    monkeypatched in tests."""
    from tools.theme_curation.ledger import Ledger
    from tools.theme_curation.proposals import Proposal
    lg = Ledger(ledger_path)
    import sqlite3
    con = sqlite3.connect(ledger_path); con.row_factory = sqlite3.Row
    props = []
    import json as _j
    for r in con.execute("SELECT * FROM decisions WHERE decision='approve'"):
        props.append(Proposal(r["theme_id"], r["action"], r["sym"], 1.0,
                              _j.loads(r["fields"] or "{}")))
    return props


def _cmd_apply(args) -> int:
    if not is_git_clean(args.taxonomy) and not args.force:
        print("refusing to apply: git tree for the taxonomy is not clean "
              "(commit/stash first, or pass --force).")
        return 2
    tax = loaders.load_taxonomy(args.taxonomy)
    approved = load_approved(args.ledger, args.review_dir)
    new_tax, rejects = A.apply_proposals(tax, approved, loaders.cap_universe_set(args.cap))
    for r in rejects:
        print(f"  rejected: {r}")
    errs = A.self_validate(new_tax)
    if errs:
        print("self-validation FAILED — refusing to write:")
        for e in errs:
            print(f"  {e}")
        return 3
    import difflib, json as _json
    before = _json.dumps(tax, indent=2, ensure_ascii=False, sort_keys=True).splitlines()
    after = _json.dumps(new_tax, indent=2, ensure_ascii=False, sort_keys=True).splitlines()
    diff = list(difflib.unified_diff(before, after, "current", "proposed", lineterm=""))
    print("\n".join(diff) if diff else "(no content change)")
    print(f"\n{len(approved) - len(rejects)} change(s) staged.")
    if not args.confirm:
        print("dry run — re-run with --confirm to write and bump the version.")
        return 4
    ver = A.bump_version(new_tax)
    loaders.save_taxonomy(args.taxonomy, new_tax)
    print(f"written; version bumped to {ver}. Review the git diff and commit.")
    return 0


def _cmd_audit(args) -> int:
    from datetime import date
    from tools.theme_curation import audit
    tax = loaders.load_taxonomy(args.taxonomy)
    result = audit.audit_taxonomy(tax, loaders.cap_universe_set(args.cap),
                                  loaders.ipo_dates(), date.today().toordinal())
    md = audit.write_audit_md(result, tax)
    with open(args.out, "w", encoding="utf-8") as f:
        f.write(md)
    print(f"audit written to {args.out}")
    return 0


def _cmd_discover(args) -> int:
    # Owner-run orchestration over the tested primitives (network — not unit-tested).
    from tools.theme_curation import discover, corroborate, propose
    from tools.theme_curation.ledger import Ledger
    corroborate.ensure_industry_map()                    # hard-fails without FINVIZ_API_KEY
    tax = loaders.load_taxonomy(args.taxonomy)
    cap = loaders.cap_universe_set(args.cap)
    tind = corroborate.load_theme_industries(args.industries)
    lg = Ledger(args.ledger)
    import os, json
    os.makedirs(args.proposals_dir, exist_ok=True)
    for t in tax["themes"]:
        art = os.path.join(args.proposals_dir, f"{t['id']}.json")
        if args.resume and os.path.exists(art):
            continue
        expected = tind.get(t["id"])                     # None => concept-theme
        disc = discover.discover(t["name"], args.run_id, confirm=(expected is None))
        cands = [c for c in disc["tickers"] if c in cap]
        corrob = corroborate.corroborate(cands, expected)
        res = propose.propose_theme(t, cands, corrob, loaders.holding_syms(t),
                                    {"dead": [], "thin": False}, args.model, cap_set=cap)
        kept = propose.suppress_rejected(res["proposals"], lg)
        with open(art, "w", encoding="utf-8") as f:
            json.dump({"theme_id": t["id"], "error": disc["error"],
                       "proposals": [p.__dict__ for p in kept]}, f, indent=2)
        print(f"  {t['id']}: {len(kept)} proposal(s){' [ERR:'+disc['error']+']' if disc['error'] else ''}")
    return 0


def _cmd_review(args) -> int:
    # Split proposals into batch (high-confidence) doc + interactive (low/concept). Owner-run.
    from tools.theme_curation import review_doc, review_cli
    from tools.theme_curation.ledger import Ledger
    from tools.theme_curation.proposals import Proposal
    import os, json, glob
    lg = Ledger(args.ledger)
    hi, lo = [], []
    for art in glob.glob(os.path.join(args.proposals_dir, "*.json")):
        for d in json.load(open(art, encoding="utf-8")).get("proposals", []):
            p = Proposal(**d)
            (hi if p.confidence >= args.threshold else lo).append(p)
    os.makedirs(args.review_dir, exist_ok=True)
    with open(os.path.join(args.review_dir, "review.md"), "w", encoding="utf-8") as f:
        f.write(review_doc.write_review_md(hi))
    review_cli.review_interactive(lo, lg)                 # writes ledger as it goes
    print(f"batch doc: {len(hi)} proposal(s); interactive: {len(lo)}")
    return 0


def _cmd_bootstrap(args) -> int:
    # One-time: propose theme->finviz-industry map for owner confirmation. Owner-run.
    print("bootstrap-finviz: lists distinct industry_map industries + LLM-proposes a "
          "theme->industry map for owner confirmation; writes theme_finviz_industries.json. "
          "See plan Task 6 / spec §5. (LLM output is owner-confirmed, not unit-tested.)")
    return 0


def main(argv=None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    ap = argparse.ArgumentParser(prog="theme_curation")
    sub = ap.add_subparsers(dest="cmd")

    a = sub.add_parser("audit")
    a.add_argument("--taxonomy", default="themes_taxonomy.json")
    a.add_argument("--cap", default="api/data/cap_universe.json")
    a.add_argument("--out", default="tools/theme_curation/audit.md")

    d = sub.add_parser("discover")
    d.add_argument("--taxonomy", default="themes_taxonomy.json")
    d.add_argument("--cap", default="api/data/cap_universe.json")
    d.add_argument("--industries", default="tools/theme_curation/theme_finviz_industries.json")
    d.add_argument("--ledger", default="tools/theme_curation/curation_ledger.db")
    d.add_argument("--proposals-dir", default="tools/theme_curation/proposals")
    d.add_argument("--run-id", required=True)
    d.add_argument("--model", default="claude-opus-4-8")
    d.add_argument("--resume", action="store_true")

    r = sub.add_parser("review")
    r.add_argument("--proposals-dir", default="tools/theme_curation/proposals")
    r.add_argument("--review-dir", default="tools/theme_curation/review")
    r.add_argument("--ledger", default="tools/theme_curation/curation_ledger.db")
    r.add_argument("--threshold", type=float, default=0.85)

    sub.add_parser("bootstrap-finviz")

    ap_apply = sub.add_parser("apply")
    ap_apply.add_argument("--taxonomy", default="themes_taxonomy.json")
    ap_apply.add_argument("--cap", default="api/data/cap_universe.json")
    ap_apply.add_argument("--ledger", default="tools/theme_curation/curation_ledger.db")
    ap_apply.add_argument("--review-dir", default="tools/theme_curation/review")
    ap_apply.add_argument("--confirm", action="store_true")
    ap_apply.add_argument("--force", action="store_true")

    try:
        args = ap.parse_args(argv)
    except SystemExit as e:
        # argparse exits the process on a parse error (e.g. an unknown subcommand);
        # surface it as a non-zero return so main() stays testable (help = 0).
        return e.code if isinstance(e.code, int) else 1
    handlers = {"audit": _cmd_audit, "discover": _cmd_discover, "review": _cmd_review,
                "bootstrap-finviz": _cmd_bootstrap, "apply": _cmd_apply}
    h = handlers.get(args.cmd)
    if h is None:
        ap.print_usage()
        return 1
    return h(args)
