"""PC-side Brain KB sync for Wisdom rows (D18 step 4; docs/wisdom/CONTRACTS.md §6.6).

Reads the Wisdom KB export and writes it into the ENGINE knowledge base
(C:\\Users\\Patrick\\uct-intelligence\\data\\uct_intelligence.db, passed explicitly as --db).

THE RULES, each enforced below and railed in tests/test_wisdom_publish_adapters_kb_sync.py
- DRY-RUN BY DEFAULT. Without --commit the KB is opened read-only (sqlite `mode=ro`),
  so a dry run cannot write even by mistake.
- --commit REFUSES when the export says the flag is off (the swap is the owner's flip).
- BACKUP FIRST, through sqlite's backup API (captures WAL), then `integrity_check` on the copy.
- ONE `BEGIN IMMEDIATE` transaction: the 21:00 CT Brain Pack export can never snapshot a
  half-applied sync.
- UPDATE in place when content changed, INSERT when new, `active=0` when superseded.
  NEVER DELETE, never REPLACE: a delete+insert gives every row a new AUTOINCREMENT id, so
  the web pod re-embeds all of them and every "KB #id" citation changes.
- Keyed on `source='wisdom' AND source_ref LIKE 'wisdom:%'`, never source_ref alone: the
  KB's source_ref is free text and a legacy citation could collide.
- FINISHES BEFORE 20:55 CT OR ABORTS: checked before starting and again before COMMIT
  (a late run rolls back and writes nothing).
- Legacy rows (the misattributed "Bonde" rows, D18) are deactivated only from a reviewed
  plan file AND --apply-legacy-plan. Nothing here decides attribution.

Recommended invocation (never on the web pod; one heavy job at a time on this box):
    python C:\\Users\\Patrick\\uct-clips\\tools\\heavy_lock.py run --label wisdom-kb-sync -- ^
      python tools\\wisdom\\publish_kb_sync.py --db C:\\Users\\Patrick\\uct-intelligence\\data\\uct_intelligence.db ^
      --url https://uctintelligence.com --commit
PUSH_SECRET comes from the environment and is never printed.

This script imports nothing from the `api` package. The one shared definition it needs
(the KB row hash) is loaded by FILE PATH from adapters/kbrow.py, which is standard-library
only — so no `/data` path can be captured by an import (CLAUDE.md "C:\\data IS REAL").
"""
from __future__ import annotations

import argparse
import datetime as dt
import importlib.util
import json
import os
import pathlib
import sqlite3
import sys
import urllib.request
from typing import Callable, Iterable, Optional
from zoneinfo import ZoneInfo

REPO = pathlib.Path(__file__).resolve().parents[2]
CT = ZoneInfo("America/Chicago")
DEFAULT_DEADLINE_CT = "20:55"
EXPORT_PATH = "/api/internal/wisdom/publish/adapters/kb-export"
REVIEW_PATH = "/api/internal/wisdom/publish/adapters/review-items"
BROWSER_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
              "Chrome/126.0 Safari/537.36")
_SUNDAY_SCANS_INTAKE = "intake:substack_unchartedterritory_sunday_scans%"


def _load_kbrow():
    path = REPO / "api" / "services" / "wisdom" / "publish" / "adapters" / "kbrow.py"
    spec = importlib.util.spec_from_file_location("wisdom_kbrow_standalone", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


kbrow = _load_kbrow()


class SyncAborted(RuntimeError):
    pass


# ── export I/O ───────────────────────────────────────────────────────────────

def _request(url: str, *, secret: str, body: Optional[bytes] = None, timeout: int = 60) -> dict:
    req = urllib.request.Request(url, data=body, method="POST" if body is not None else "GET")
    req.add_header("Authorization", f"Bearer {secret}")
    req.add_header("User-Agent", BROWSER_UA)  # Cloudflare 1010-blocks script user agents
    if body is not None:
        req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310 - operator-supplied https URL
        return json.loads(resp.read().decode("utf-8"))


def fetch_export(base_url: str, secret: str) -> dict:
    return _request(base_url.rstrip("/") + EXPORT_PATH, secret=secret)


def load_export(path: str) -> dict:
    return json.loads(pathlib.Path(path).read_text(encoding="utf-8"))


def validate_export(export: dict) -> list[dict]:
    if not isinstance(export, dict) or not export.get("ok"):
        raise SyncAborted(f"export is not usable: {export.get('error') if isinstance(export, dict) else export!r}")
    rows = export.get("rows") or []
    for row in rows:
        if not kbrow.is_wisdom_ref(row.get("source_ref")):
            raise SyncAborted(f"export row without a wisdom: source_ref: {row.get('source_ref')!r}")
        if int(row.get("priority", 3)) != 3:
            raise SyncAborted(f"export row {row['source_ref']} is not priority 3")
        if not row.get("knowledge_epoch"):
            raise SyncAborted(f"export row {row['source_ref']} has no explicit knowledge_epoch")
        if kbrow.kb_row_sha(row) != row.get("content_sha256"):
            raise SyncAborted(f"export row {row['source_ref']} fails its content hash")
    return rows


# ── plan (pure read) ─────────────────────────────────────────────────────────

def _kb_columns(conn: sqlite3.Connection) -> set:
    return {r[1] for r in conn.execute("PRAGMA table_info(knowledge_base)")}


def plan(conn: sqlite3.Connection, export: dict, *, legacy_ids: Iterable[int] = ()) -> dict:
    rows = validate_export(export)
    superseded = set(export.get("superseded_refs") or [])
    conn.row_factory = sqlite3.Row
    existing = {r["source_ref"]: dict(r) for r in conn.execute(
        "SELECT id, source_ref, active, category, title, content, tags, trader, knowledge_epoch, priority, "
        "regime_context FROM knowledge_base WHERE source = 'wisdom' AND source_ref LIKE 'wisdom:%'")}
    out = {"insert": [], "update": [], "reactivate": [], "unchanged": 0, "deactivate": [], "legacy_deactivate": []}
    exported = set()
    for row in rows:
        ref = row["source_ref"]
        exported.add(ref)
        prev = existing.get(ref)
        if prev is None:
            out["insert"].append(row)
        elif kbrow.kb_row_sha(prev) != row["content_sha256"]:
            out["update"].append((prev["id"], row))
        elif not prev["active"]:
            out["reactivate"].append(prev["id"])
        else:
            out["unchanged"] += 1
    for ref, prev in existing.items():
        if prev["active"] and (ref not in exported or ref in superseded):
            out["deactivate"].append(prev["id"])
    wanted = sorted({int(i) for i in legacy_ids})
    if wanted:
        marks = ",".join("?" * len(wanted))
        out["legacy_deactivate"] = [r[0] for r in conn.execute(
            f"SELECT id FROM knowledge_base WHERE id IN ({marks}) AND active = 1 AND source <> 'wisdom'", wanted)]
    return out


def summarize(p: dict) -> dict:
    return {"insert": len(p["insert"]), "update": len(p["update"]), "reactivate": len(p["reactivate"]),
            "unchanged": p["unchanged"], "deactivate": len(p["deactivate"]),
            "legacy_deactivate": len(p["legacy_deactivate"])}


def _counts(conn: sqlite3.Connection) -> dict:
    row = conn.execute(
        "SELECT COUNT(*), COALESCE(SUM(active), 0), "
        "COALESCE(SUM(CASE WHEN source = 'wisdom' THEN 1 ELSE 0 END), 0), "
        "COALESCE(SUM(CASE WHEN source = 'wisdom' AND active = 1 THEN 1 ELSE 0 END), 0) FROM knowledge_base"
    ).fetchone()
    return {"rows": row[0], "active": row[1], "wisdom_rows": row[2], "wisdom_active": row[3]}


# ── run ──────────────────────────────────────────────────────────────────────

def _deadline(now: dt.datetime, hhmm: str) -> dt.datetime:
    hour, minute = (int(x) for x in hhmm.split(":"))
    local = now.astimezone(CT)
    return local.replace(hour=hour, minute=minute, second=0, microsecond=0)


def _backup(db_path: str, backup_dir: Optional[str], now: dt.datetime) -> str:
    target_dir = pathlib.Path(backup_dir) if backup_dir else pathlib.Path(db_path).resolve().parent / "wisdom_kb_backups"
    target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / f"uct_intelligence.pre_wisdom_sync.{now.astimezone(CT):%Y%m%d-%H%M%S}.db"
    src = sqlite3.connect(db_path, timeout=30)
    dst = sqlite3.connect(str(target))
    try:
        src.backup(dst)
        verdict = dst.execute("PRAGMA integrity_check").fetchone()[0]
    finally:
        dst.close()
        src.close()
    if verdict != "ok":
        raise SyncAborted(f"backup failed integrity_check: {verdict}")
    return str(target)


def run_sync(db_path: str, export: dict, *, commit: bool = False, now: Optional[dt.datetime] = None,
             clock: Optional[Callable[[], dt.datetime]] = None, deadline_ct: str = DEFAULT_DEADLINE_CT,
             backup_dir: Optional[str] = None, legacy_ids: Iterable[int] = (), apply_legacy: bool = False,
             trace: Optional[Callable[[str], None]] = None) -> dict:
    clock = clock or (lambda: dt.datetime.now(CT))
    now = now or clock()
    legacy = list(legacy_ids) if apply_legacy else []
    if not commit:
        uri = f"file:{pathlib.Path(db_path).resolve().as_posix()}?mode=ro"
        conn = sqlite3.connect(uri, uri=True, timeout=30)
        try:
            if trace:
                conn.set_trace_callback(trace)
            p = plan(conn, export, legacy_ids=legacy_ids)
            return {"dry_run": True, "enabled": bool(export.get("enabled")), "plan": summarize(p),
                    "counts": _counts(conn)}
        finally:
            conn.close()

    if not export.get("enabled"):
        raise SyncAborted("the export reports WISDOM_BRAINKB_PUBLISH_ENABLED off; --commit refused (dry-run only)")
    deadline = _deadline(now, deadline_ct)
    if now.astimezone(CT) >= deadline:
        raise SyncAborted(f"it is past {deadline_ct} CT; the 21:00 CT Brain Pack export must not race this sync")
    backup = _backup(db_path, backup_dir, now)
    conn = sqlite3.connect(db_path, timeout=30, isolation_level=None)
    try:
        conn.execute("PRAGMA busy_timeout = 30000")
        if trace:
            conn.set_trace_callback(trace)
        conn.execute("BEGIN IMMEDIATE")
        try:
            before = _counts(conn)
            p = plan(conn, export, legacy_ids=legacy)
            cols = _kb_columns(conn)
            for row in p["insert"]:
                values = {"category": row["category"], "title": row["title"], "content": row["content"],
                          "tags": row.get("tags") or "", "trader": row.get("trader") or "",
                          "source_ref": row["source_ref"], "regime_context": row.get("regime_context") or "",
                          "priority": 3, "active": 1, "source": "wisdom", "knowledge_epoch": row["knowledge_epoch"]}
                values = {k: v for k, v in values.items() if k in cols}
                stamps = [c for c in ("created_at", "updated_at") if c in cols]
                conn.execute(
                    f"INSERT INTO knowledge_base({', '.join([*values, *stamps])}) "
                    f"VALUES ({', '.join(['?'] * len(values) + ['datetime(' + repr('now') + ')'] * len(stamps))})",
                    list(values.values()))
            stamp = ", updated_at = datetime('now')" if "updated_at" in cols else ""
            for kb_id, row in p["update"]:
                conn.execute(
                    "UPDATE knowledge_base SET category = ?, title = ?, content = ?, tags = ?, trader = ?, "
                    f"knowledge_epoch = ?, priority = 3, regime_context = ?, active = 1{stamp} "
                    "WHERE id = ? AND source = 'wisdom'",
                    (row["category"], row["title"], row["content"], row.get("tags") or "", row.get("trader") or "",
                     row["knowledge_epoch"], row.get("regime_context") or "", kb_id))
            for kb_id in p["reactivate"]:
                conn.execute(f"UPDATE knowledge_base SET active = 1{stamp} WHERE id = ? AND source = 'wisdom'", (kb_id,))
            for kb_id in p["deactivate"]:
                conn.execute(f"UPDATE knowledge_base SET active = 0{stamp} WHERE id = ? AND source = 'wisdom'", (kb_id,))
            for kb_id in p["legacy_deactivate"]:
                conn.execute(f"UPDATE knowledge_base SET active = 0{stamp} WHERE id = ? AND source <> 'wisdom'",
                             (kb_id,))
            after = _counts(conn)
            if clock().astimezone(CT) >= deadline:
                raise SyncAborted(f"reached {deadline_ct} CT before COMMIT; rolled back, nothing written")
            conn.execute("COMMIT")
        except BaseException:
            conn.execute("ROLLBACK")
            raise
    finally:
        conn.close()
    return {"dry_run": False, "enabled": True, "backup": backup, "plan": summarize(p), "before": before,
            "after": after,
            "rollback_sql": "UPDATE knowledge_base SET active = 0 WHERE source = 'wisdom' AND source_ref LIKE 'wisdom:%';"}


# ── D18 diff + archive plan (never executed here) ────────────────────────────

def diff_report(db_path: str, export: dict) -> list[dict]:
    """Review-queue items for the owner: the stale Sunday Scans intake rows, grouped by
    credited trader, beside the Wisdom rows proposed to replace them. Read-only."""
    uri = f"file:{pathlib.Path(db_path).resolve().as_posix()}?mode=ro"
    conn = sqlite3.connect(uri, uri=True, timeout=30)
    conn.row_factory = sqlite3.Row
    try:
        groups = conn.execute(
            "SELECT trader, COUNT(*) AS n, MIN(created_at) AS first_at, MAX(created_at) AS last_at, "
            "group_concat(id) AS ids FROM knowledge_base WHERE active = 1 AND source LIKE ? "
            "GROUP BY trader ORDER BY n DESC", (_SUNDAY_SCANS_INTAKE,)).fetchall()
    finally:
        conn.close()
    refs = [r["source_ref"] for r in (export.get("rows") or [])]
    items = []
    for g in groups:
        ids = [int(x) for x in (g["ids"] or "").split(",") if x]
        items.append({
            "tab": "attribution",
            "subject_ref": f"engine_kb:sunday_scans_intake:{g['trader'] or 'uncredited'}",
            "summary": (f"{g['n']} stale Sunday Scans KB rows credited to '{g['trader'] or ''}' "
                        f"(created {g['first_at']} to {g['last_at']}); {len(refs)} dated, signed Wisdom rows proposed."),
            "old": {"count": g["n"], "trader": g["trader"], "kb_ids_sample": ids[:100]},
            "new": {"wisdom_rows": len(refs), "wisdom_refs_sample": refs[:50]},
            "evidence": {"source_filter": _SUNDAY_SCANS_INTAKE, "export_generated_at": export.get("generated_at")},
            "recommendation": ("D18: grounding eval old/new/merged, then swap behind WISDOM_BRAINKB_PUBLISH_ENABLED "
                               "(admin cohort), then archive the superseded rows. Attribution per "
                               "tools/wisdom/publish_bonde_attribution.py."),
        })
    return items


def archive_plan_sql(kb_ids: Iterable[int]) -> str:
    ids = sorted({int(i) for i in kb_ids})
    id_list = ", ".join(str(i) for i in ids) or "NULL"
    return "\n".join((
        "-- D18 archive plan. NOT EXECUTED by any Wisdom tool. Run only after the owner approves the",
        "-- review-queue diff and the admin-cohort swap has held. Take a backup first. No DELETE.",
        "BEGIN IMMEDIATE;",
        "CREATE TABLE IF NOT EXISTS knowledge_base_archive AS SELECT * FROM knowledge_base WHERE 0;",
        "ALTER TABLE knowledge_base_archive ADD COLUMN archived_at TEXT;  -- skip if it already exists",
        "ALTER TABLE knowledge_base_archive ADD COLUMN archive_reason TEXT;  -- skip if it already exists",
        f"INSERT INTO knowledge_base_archive SELECT *, datetime('now'), 'D18 superseded by Wisdom' "
        f"FROM knowledge_base WHERE id IN ({id_list});",
        f"UPDATE knowledge_base SET active = 0 WHERE id IN ({id_list});",
        "COMMIT;",
    )) + "\n"


# ── CLI ──────────────────────────────────────────────────────────────────────

def main(argv: Optional[list] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--db", required=True, help="ENGINE KB sqlite path (explicit; no default)")
    src = ap.add_mutually_exclusive_group()
    src.add_argument("--export-file", help="a saved kb-export JSON")
    src.add_argument("--url", help="dashboard base URL, e.g. https://uctintelligence.com (PUSH_SECRET from env)")
    ap.add_argument("--commit", action="store_true", help="write (default: dry run, read-only)")
    ap.add_argument("--backup-dir")
    ap.add_argument("--deadline-ct", default=DEFAULT_DEADLINE_CT)
    ap.add_argument("--legacy-plan", help='reviewed JSON {"deactivate_ids": [...]} (e.g. from the Bonde attribution tool)')
    ap.add_argument("--apply-legacy-plan", action="store_true")
    ap.add_argument("--diff-out", help="write the D18 review-queue items JSON here")
    ap.add_argument("--archive-plan-out", help="write the (unexecuted) archive SQL plan here")
    ap.add_argument("--push-review", help="POST a review-items JSON file to the dashboard (needs --url)")
    args = ap.parse_args(argv)

    secret = os.environ.get("PUSH_SECRET", "")
    if args.push_review:
        if not args.url or not secret:
            print("--push-review needs --url and PUSH_SECRET in the environment", file=sys.stderr)
            return 2
        items = json.loads(pathlib.Path(args.push_review).read_text(encoding="utf-8"))
        items = items.get("items", items) if isinstance(items, dict) else items
        out = _request(args.url.rstrip("/") + REVIEW_PATH, secret=secret,
                       body=json.dumps({"items": items}).encode("utf-8"))
        print(json.dumps(out, indent=2))
        return 0
    if args.export_file:
        export = load_export(args.export_file)
    elif args.url:
        if not secret:
            print("PUSH_SECRET is not set", file=sys.stderr)
            return 2
        export = fetch_export(args.url, secret)
    else:
        print("one of --export-file / --url is required", file=sys.stderr)
        return 2

    legacy_ids: list = []
    if args.legacy_plan:
        legacy_ids = [int(i) for i in json.loads(pathlib.Path(args.legacy_plan).read_text(encoding="utf-8"))
                      .get("deactivate_ids", [])]
    if args.diff_out:
        items = diff_report(args.db, export)
        pathlib.Path(args.diff_out).write_text(json.dumps({"items": items}, indent=2), encoding="utf-8")
        print(f"diff: {len(items)} review item(s) -> {args.diff_out}")
    if args.archive_plan_out:
        pathlib.Path(args.archive_plan_out).write_text(archive_plan_sql(legacy_ids), encoding="utf-8")
        print(f"archive plan ({len(legacy_ids)} ids, not executed) -> {args.archive_plan_out}")
    try:
        result = run_sync(args.db, export, commit=args.commit, deadline_ct=args.deadline_ct,
                          backup_dir=args.backup_dir, legacy_ids=legacy_ids, apply_legacy=args.apply_legacy_plan)
    except SyncAborted as exc:
        print(f"ABORTED: {exc}", file=sys.stderr)
        return 3
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
