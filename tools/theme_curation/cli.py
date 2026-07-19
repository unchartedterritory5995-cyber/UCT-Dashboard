"""Curation pipeline CLI."""
import argparse
import os
import subprocess
import sys

from tools.theme_curation import loaders, apply as A


def is_git_clean(path: str) -> bool:
    out = subprocess.run(["git", "status", "--porcelain", path],
                         capture_output=True, text=True).stdout.strip()
    return out == ""


def load_approved(ledger_path, review_dir, proposals_dir):
    """Approved Proposals from BOTH the ledger (interactive) AND owner-edited batch
    review docs (parsed; fields recovered from the proposals-dir artifacts by pid)."""
    import json as _j, glob, os, sqlite3
    from tools.theme_curation.ledger import Ledger
    from tools.theme_curation.proposals import Proposal, pid
    from tools.theme_curation.review_doc import parse_review_md
    Ledger(ledger_path)                       # ensure the decisions table exists
    out, seen = [], set()
    def _add(p):
        k = pid(p)
        if k not in seen:
            seen.add(k); out.append(p)
    con = sqlite3.connect(ledger_path); con.row_factory = sqlite3.Row
    try:
        for r in con.execute("SELECT * FROM decisions WHERE decision='approve'"):
            _add(Proposal(r["theme_id"], r["action"], r["sym"], 1.0, _j.loads(r["fields"] or "{}")))
    finally:
        con.close()
    by_pid = {}
    for art in glob.glob(os.path.join(proposals_dir, "*.json")):
        with open(art, encoding="utf-8") as f:
            for d in _j.load(f).get("proposals", []):
                p = Proposal(**d); by_pid[pid(p)] = p
    for doc in sorted(glob.glob(os.path.join(review_dir, "*.md"))):
        with open(doc, encoding="utf-8") as f:
            decisions = parse_review_md(f.read())   # HARD-FAILS on an unparseable block (safety)
        for pid_str, approved in decisions.items():
            if approved and pid_str in by_pid:
                _add(by_pid[pid_str])
    return out


def _select_themes(themes, sector=None, theme=None):
    """Filter the theme list for a bounded discover run (one sector or one theme)."""
    out = themes
    if sector:
        out = [t for t in out if t.get("sector_id") == sector]
    if theme:
        out = [t for t in out if t["id"] == theme]
    return out


def _cmd_apply(args) -> int:
    if not is_git_clean(args.taxonomy) and not args.force:
        print("refusing to apply: git tree for the taxonomy is not clean "
              "(commit/stash first, or pass --force).")
        return 2
    tax = loaders.load_taxonomy(args.taxonomy)
    approved = load_approved(args.ledger, args.review_dir, args.proposals_dir)
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
    if not diff:
        print("(no content change) — nothing to apply.")
        return 0
    print("\n".join(diff))
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
    cap = loaders.cap_universe_set(args.cap)
    live = None
    if args.check_live:
        from tools.theme_curation import liveness
        dead = audit.dead_syms(tax, cap)
        live = liveness.live_syms(dead)
        print(f"liveness: {len(live)}/{len(dead)} not-in-cap holdings still trade "
              f"(cap_universe gap); {len(dead) - len(live)} look delisted.")
    result = audit.audit_taxonomy(tax, cap, loaders.ipo_dates(),
                                  date.today().toordinal(), live=live)
    md = audit.write_audit_md(result, tax)
    with open(args.out, "w", encoding="utf-8") as f:
        f.write(md)
    print(f"audit written to {args.out}")
    return 0


def _cmd_discover(args) -> int:
    # Owner-run orchestration over the tested primitives (network — not unit-tested).
    from datetime import date
    from tools.theme_curation import discover, corroborate, propose, audit, liveness
    from tools.theme_curation.ledger import Ledger
    tax = loaders.load_taxonomy(args.taxonomy)
    cap = loaders.cap_universe_set(args.cap)
    themes = _select_themes(tax["themes"], args.sector, args.theme)
    if (args.sector or args.theme) and not themes:
        print(f"no themes match sector={args.sector!r} theme={args.theme!r}")
        return 1
    corroborate.ensure_industry_map()                    # hard-fails without FINVIZ_API_KEY
    # Liveness-split the SELECTED themes' dead names so the DROP/REMAP prompt is grounded
    # on genuinely-gone names only — a live-but-off-cap ticker (FI, PAYO…) must not be
    # pushed toward a drop. Skippable (--no-liveness) for an offline dry run.
    live = None
    if not args.no_liveness:
        sel_dead = {s for t in themes for s in loaders.holding_syms(t) if s not in cap}
        live = liveness.live_syms(sel_dead)
        print(f"liveness: {len(live)}/{len(sel_dead)} not-in-cap holdings still trade "
              f"(kept out of DROP/REMAP grounding).")
    aud = audit.audit_taxonomy(tax, cap, loaders.ipo_dates(),
                               date.today().toordinal(), live=live)
    tind = corroborate.load_theme_industries(args.industries)
    lg = Ledger(args.ledger)
    import os, json
    os.makedirs(args.proposals_dir, exist_ok=True)
    print(f"discovering {len(themes)} theme(s)"
          + (f" in sector {args.sector}" if args.sector else "")
          + (f" (theme {args.theme})" if args.theme else "") + " …")
    for t in themes:
        art = os.path.join(args.proposals_dir, f"{t['id']}.json")
        if args.resume and os.path.exists(art):
            continue
        expected = tind.get(t["id"])                     # None => concept-theme
        disc = discover.discover(t["name"], args.run_id, confirm=(expected is None))
        cands = [c for c in disc["tickers"] if c in cap]
        corrob = corroborate.corroborate(cands, expected)
        flags = aud["themes"].get(t["id"], {"dead": [], "dups": []})
        res = propose.propose_theme(t, cands, corrob, loaders.holding_syms(t),
                                    flags, args.model, cap_set=cap)
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
    allp = []
    for art in glob.glob(os.path.join(args.proposals_dir, "*.json")):
        with open(art, encoding="utf-8") as f:
            arts = json.load(f)
        allp.extend(Proposal(**d) for d in arts.get("proposals", []))
    # High-confidence -> batch doc; low-confidence AND rename-class DROPs -> interactive
    # (a rename-cited DROP like FI must never auto-batch even at high confidence).
    hi, lo = review_doc.route_for_review(allp, args.threshold)
    forced = sum(1 for p in allp if p.confidence >= args.threshold and review_doc.is_rename_drop(p))
    os.makedirs(args.review_dir, exist_ok=True)
    review_path = os.path.join(args.review_dir, "review.md")
    if os.path.exists(review_path) and not args.regenerate:
        print(f"{review_path} exists — edit it (or pass --regenerate to rewrite).")
    else:
        with open(review_path, "w", encoding="utf-8") as f:
            f.write(review_doc.write_review_md(hi))
    review_cli.review_interactive(lo, lg)                 # writes ledger as it goes
    print(f"batch doc: {len(hi)} proposal(s); interactive: {len(lo)}"
          + (f" ({forced} rename-class DROP(s) forced to interactive)" if forced else ""))
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
    a.add_argument("--check-live", action="store_true",
                   help="ask Massive which not-in-cap holdings still trade; "
                        "split delisted (drop/remap) from cap_universe gaps (network)")

    d = sub.add_parser("discover")
    d.add_argument("--taxonomy", default="themes_taxonomy.json")
    d.add_argument("--cap", default="api/data/cap_universe.json")
    d.add_argument("--industries", default="tools/theme_curation/theme_finviz_industries.json")
    d.add_argument("--ledger", default="tools/theme_curation/curation_ledger.db")
    d.add_argument("--proposals-dir", default="tools/theme_curation/proposals")
    d.add_argument("--run-id", required=True)
    d.add_argument("--model", default=os.environ.get("TAXONOMY_LLM_MODEL", "claude-opus-4-8"))
    d.add_argument("--resume", action="store_true")
    d.add_argument("--sector", default=None, help="limit to one sector_id (e.g. traditional_energy)")
    d.add_argument("--theme", default=None, help="limit to one theme id")
    d.add_argument("--no-liveness", action="store_true",
                   help="skip the Massive liveness split (offline/dry-run); all "
                        "not-in-cap holdings are then treated as delisted grounding")

    r = sub.add_parser("review")
    r.add_argument("--proposals-dir", default="tools/theme_curation/proposals")
    r.add_argument("--review-dir", default="tools/theme_curation/review")
    r.add_argument("--ledger", default="tools/theme_curation/curation_ledger.db")
    r.add_argument("--threshold", type=float, default=0.85)
    r.add_argument("--regenerate", action="store_true")

    sub.add_parser("bootstrap-finviz")

    ap_apply = sub.add_parser("apply")
    ap_apply.add_argument("--taxonomy", default="themes_taxonomy.json")
    ap_apply.add_argument("--cap", default="api/data/cap_universe.json")
    ap_apply.add_argument("--ledger", default="tools/theme_curation/curation_ledger.db")
    ap_apply.add_argument("--review-dir", default="tools/theme_curation/review")
    ap_apply.add_argument("--proposals-dir", default="tools/theme_curation/proposals")
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


if __name__ == "__main__":
    sys.exit(main())
