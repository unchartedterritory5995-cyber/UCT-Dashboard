"""Apply a REVIEWED Bonde attribution plan: relabel the ENGINE KB rows it re-attributes (D18).

`publish_bonde_attribution.py --out plan.json` proposes, from evidence only, who actually wrote
each "Bonde"-credited KB row. Its `legacy_plan.reattribute` list is what this tool applies:
`trader` becomes the author's KB label (from docs/wisdom/authors.json: the name in the display
name's parentheses, else the display name, e.g. "Patrick (TSDR)" -> "TSDR"). Rows the plan
calls unknown are NOT touched here; they retire through `publish_kb_sync.py --legacy-plan`.

THE RULES
- DRY-RUN BY DEFAULT: without --commit the KB is opened read-only (sqlite mode=ro).
- A row is relabelled only if it is still active, still credited to Bonde, and its content
  hash still equals the one the owner reviewed in the plan. Anything else is skipped and named.
- BACKUP FIRST and ONE `BEGIN IMMEDIATE` transaction (the same helpers as publish_kb_sync.py),
  finishing before 20:55 CT or rolling back, so the 21:00 CT Brain Pack never sees half of it.
- §8c.3: the provenance marker is appended to `content` of every row this writes, so an audit
  can see who relabelled it. UPDATE only; NEVER DELETE.

    python tools/wisdom/publish_bonde_attribution.py --db <kb> --intake <sunday scans intake .txt> --out <plan>
    (owner reviews <plan>)
    python tools/wisdom/publish_bonde_reattribute.py --db <kb> --plan <plan>             (dry run)
    python tools/wisdom/publish_bonde_reattribute.py --db <kb> --plan <plan> --commit    (write)

Imports nothing from the `api` package; its helpers are loaded BY PATH (stdlib only).
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import importlib.util
import json
import pathlib
import re
import sqlite3
import sys
from typing import Callable, Optional

REPO = pathlib.Path(__file__).resolve().parents[2]


def _load(module: str, path: pathlib.Path):
    spec = importlib.util.spec_from_file_location(module, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


kb_sync = _load("wisdom_kb_sync_standalone", REPO / "tools" / "wisdom" / "publish_kb_sync.py")
authors = _load("wisdom_authors_standalone_reattr", REPO / "api" / "services" / "wisdom" / "core" / "authors.py")
provenance = kb_sync.provenance
SyncAborted = kb_sync.SyncAborted
FLAG_ENV = "WISDOM_BRAINKB_PUBLISH_ENABLED"
_PAREN_RE = re.compile(r"\(([^()]+)\)")


def kb_label(author_id: str) -> Optional[str]:
    """The KB's trader label for an author, derived from authors.json (never restated here)."""
    for a in authors.authors():
        if a["author_id"] == author_id:
            name = (a.get("display_name") or "").strip()
            m = _PAREN_RE.search(name)
            return (m.group(1) if m else name).strip() or None
    return None


def plan_changes(conn: sqlite3.Connection, plan: dict) -> dict:
    wanted = (plan.get("legacy_plan") or {}).get("reattribute") or []
    out = {"relabel": [], "skipped": []}
    for item in wanted:
        kb_id, author_id = int(item["kb_id"]), item.get("author_id")
        label = kb_label(author_id) if author_id else None
        row = conn.execute("SELECT trader, content, active FROM knowledge_base WHERE id = ?", (kb_id,)).fetchone()
        reason = None
        if label is None:
            reason = f"no KB label for author {author_id!r}"
        elif row is None:
            reason = "row not found"
        elif not row[2]:
            reason = "row inactive"
        elif "bonde" not in (row[0] or "").lower():
            reason = "no longer credited to Bonde"
        elif hashlib.sha256((row[1] or "").encode("utf-8")).hexdigest() != item.get("content_sha256"):
            reason = "content changed since the plan was reviewed"
        if reason:
            out["skipped"].append({"kb_id": kb_id, "reason": reason})
        else:
            out["relabel"].append({"kb_id": kb_id, "label": label, "evidence": item.get("evidence")})
    return out


def _summary(p: dict) -> dict:
    by_label: dict = {}
    for r in p["relabel"]:
        by_label[r["label"]] = by_label.get(r["label"], 0) + 1
    reasons: dict = {}
    for s in p["skipped"]:
        reasons[s["reason"]] = reasons.get(s["reason"], 0) + 1
    return {"relabel": len(p["relabel"]), "by_label": by_label, "skipped": len(p["skipped"]), "skip_reasons": reasons}


def run(db_path: str, plan: dict, *, commit: bool = False, clock: Optional[Callable[[], dt.datetime]] = None,
        deadline_ct: str = kb_sync.DEFAULT_DEADLINE_CT, backup_dir: Optional[str] = None) -> dict:
    clock = clock or (lambda: dt.datetime.now(kb_sync.CT))
    if not commit:
        conn = sqlite3.connect(f"file:{pathlib.Path(db_path).resolve().as_posix()}?mode=ro", uri=True, timeout=30)
        try:
            return {"dry_run": True, **_summary(plan_changes(conn, plan))}
        finally:
            conn.close()
    now = clock()
    deadline = kb_sync._deadline(now, deadline_ct)
    if now.astimezone(kb_sync.CT) >= deadline:
        raise SyncAborted(f"it is past {deadline_ct} CT; the 21:00 CT Brain Pack export must not race this write")
    backup = kb_sync._backup(db_path, backup_dir, now)
    conn = sqlite3.connect(db_path, timeout=30, isolation_level=None)
    try:
        conn.execute("PRAGMA busy_timeout = 30000")
        conn.execute("BEGIN IMMEDIATE")
        try:
            p = plan_changes(conn, plan)
            for r in p["relabel"]:
                mark = provenance.marker_text(consumer="brainkb", subject_ref=f"knowledge_base:{r['kb_id']}",
                                              locator="bonde_reattribution", flag_env=FLAG_ENV)
                conn.execute(
                    "UPDATE knowledge_base SET trader = ?, content = content || ?, updated_at = datetime('now') "
                    "WHERE id = ? AND active = 1 AND LOWER(trader) LIKE '%bonde%'",
                    (r["label"], "\n" + mark, r["kb_id"]))
            if clock().astimezone(kb_sync.CT) >= deadline:
                raise SyncAborted(f"reached {deadline_ct} CT before COMMIT; rolled back, nothing written")
            conn.execute("COMMIT")
        except BaseException:
            conn.execute("ROLLBACK")
            raise
    finally:
        conn.close()
    return {"dry_run": False, "backup": backup, **_summary(p),
            "rollback": f"restore {backup}, or set trader back to 'Bonde' for the relabelled ids"}


def main(argv: Optional[list] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--db", required=True, help="ENGINE KB sqlite path")
    ap.add_argument("--plan", required=True, help="the REVIEWED plan from publish_bonde_attribution.py --out")
    ap.add_argument("--commit", action="store_true", help="write (default: read-only dry run)")
    args = ap.parse_args(argv)
    plan = json.loads(pathlib.Path(args.plan).read_text(encoding="utf-8"))
    try:
        result = run(args.db, plan, commit=args.commit)
    except SyncAborted as exc:
        print(f"ABORTED: {exc}", file=sys.stderr)
        return 2
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
