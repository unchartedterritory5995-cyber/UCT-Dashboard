"""Per-row rights review for withheld Trading Brain knowledge rows (Track C safeguard a). Owner / reviewer run only.

  python tools/kn_rights_review.py status
  python tools/kn_rights_review.py worksheet --kb-id 123 --out C:/reviews/kb123.json
  python tools/kn_rights_review.py validate C:/reviews/kb123.json [...]
  python tools/kn_rights_review.py emit C:/reviews/kb123.json [...] [--policy docs/agent/knowledge/policy.json] [--apply --by NAME]

`sign-bulk` (owner only, on the server where UCT_KN_RIGHTS_KEY is set) prints a signed bulk approval. Applying a
clearance also needs that key: nobody who only edits policy.json can clear or approve anything.
`status` prints counts only. `worksheet` writes ONE row's review sheet (it holds the row's text, so it must be written
OUTSIDE the repository and never committed). `emit` prints the cleared_rows entries; only with --apply does it write
them into the policy file (and bump policy_version). No bulk re-admission: at most 10 rows per run, each with its own
rights_review_ref. See api/services/uct_agent/knowledge/rights.py and docs/agent/knowledge/RIGHTS-REVIEW.md.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO))

from api.services.uct_agent.knowledge import policy, rights  # noqa: E402


def _inside_repo(p: Path) -> bool:
    try:
        p.resolve().relative_to(REPO)
        return True
    except ValueError:
        return False


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("status")
    w = sub.add_parser("worksheet")
    w.add_argument("--kb-id", type=int, required=True)
    w.add_argument("--out", required=True)
    v = sub.add_parser("validate")
    v.add_argument("files", nargs="+")
    e = sub.add_parser("emit")
    e.add_argument("files", nargs="+")
    e.add_argument("--policy", default=str(policy.DEFAULT_PATH))
    e.add_argument("--apply", action="store_true")
    e.add_argument("--by", default="", help="the person applying these clearances (required with --apply)")
    b = sub.add_parser("sign-bulk", help="OWNER ONLY, where UCT_KN_RIGHTS_KEY is set: print a signed bulk approval")
    b.add_argument("--by", required=True)
    b.add_argument("--on", required=True, help="YYYY-MM-DD")
    b.add_argument("--max-rows", type=int, required=True)
    b.add_argument("--reason", required=True)
    b.add_argument("--expires", required=True, help="YYYY-MM-DD, at most 90 days after --on")
    b.add_argument("--policy", default=str(policy.DEFAULT_PATH))
    r = sub.add_parser("revoke", help="where UCT_KN_RIGHTS_KEY is set: remove clearances with signed audit records")
    r.add_argument("--kb-id", type=int, action="append", required=True)
    r.add_argument("--by", required=True)
    r.add_argument("--reason", required=True)
    r.add_argument("--policy", default=str(policy.DEFAULT_PATH))
    ra = sub.add_parser("reanchor", help="OWNER ONLY, key required: accept the current verified files as the anchored state")
    ra.add_argument("--by", required=True)
    ra.add_argument("--reason", required=True)
    ra.add_argument("--policy", default=str(policy.DEFAULT_PATH))
    a = ap.parse_args(argv)

    if a.cmd == "sign-bulk":
        try:
            print(json.dumps({"bulk_clearance_approval": rights.sign_bulk(a.by, a.on, a.max_rows, a.reason, a.expires,
                                                                                Path(a.policy))}, indent=2))
        except ValueError as err:
            print(f"refused: {err}", file=sys.stderr)
            return 1
        return 0
    if a.cmd == "revoke":
        try:
            print(f"revoked: {rights.revoke(a.kb_id, Path(a.policy), revoked_by=a.by, reason=a.reason)}")
        except ValueError as err:
            print(f"refused: {err}", file=sys.stderr)
            return 1
        return 0
    if a.cmd == "reanchor":
        try:
            print(f"re-anchored: {rights.reanchor(Path(a.policy), by=a.by, reason=a.reason)}")
        except ValueError as err:
            print(f"refused: {err}", file=sys.stderr)
            return 1
        return 0
    if a.cmd == "status":
        print(json.dumps(rights.status(), indent=2))
        return 0
    if a.cmd == "worksheet":
        out = Path(a.out)
        if _inside_repo(out):
            print("refused: write the worksheet OUTSIDE the repository (it holds the row's text)", file=sys.stderr)
            return 2
        if out.exists():
            print(f"refused: {out} exists", file=sys.stderr)
            return 2
        try:
            ws = rights.worksheet(a.kb_id)
        except ValueError as err:
            print(f"refused: {err}", file=sys.stderr)
            return 2
        out.write_text(json.dumps(ws, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"wrote the worksheet for kb_id {a.kb_id} ({len(ws['withheld_because'])} reason(s) withheld)")
        return 0
    wss = [json.loads(Path(f).read_text(encoding="utf-8")) for f in a.files]
    if a.cmd == "validate":
        bad = 0
        for f, ws in zip(a.files, wss):
            probs = rights.validate(ws)
            bad += bool(probs)
            print(f"{f}: {'OK' if not probs else 'NOT VALID: ' + '; '.join(probs)}")
        return 1 if bad else 0
    try:
        ents = rights.entries(wss)
    except ValueError as err:
        print(f"refused: {err}", file=sys.stderr)
        return 1
    print(json.dumps(ents, indent=2))
    if not a.apply:
        print("dry run: nothing written (pass --apply to write these entries into the policy file)")
        return 0
    try:
        res = rights.apply(ents, Path(a.policy), applied_by=a.by)
    except ValueError as err:
        print(f"refused: {err}", file=sys.stderr)
        return 1
    print(f"applied: {res} (audit log: {rights.audit_path_for(Path(a.policy)).name})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
