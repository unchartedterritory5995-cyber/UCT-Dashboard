"""Read-only scan for named-layout CROSS-WRITES (the defect #2926 closed): a member's layout row that holds the
board of ANOTHER of their layouts.

How it happened (the live production sweep, 2026-11-27): a preferences read that began before a dock switch answered
after it and put the old `charts_active_template` back under the new board; the dock's auto-save then wrote the new
board into the old layout's row, by name. The signature it leaves:

  * NOW: two of one member's own (scope 'user') layout rows hold the same arrangement (the same widget-id set);
  * HISTORY (``artifact_versions``, armed since 2026-10-02): a ``save`` version of one layout whose arrangement
    another of the member's layouts held EARLIER, and which is not the version before it (the row JUMPED to it).

Two rows can share an arrangement on purpose (a member's duplicate, a layout re-saved from another): a finding is a
row to LOOK AT, not a verdict. Restoring one is the Layout Dock's History (or a pod-side
``charts_layout_service.restore_content``), never this tool.

READ ONLY. Both databases are opened ``mode=ro`` with ``PRAGMA query_only=ON``; nothing is written, created or
migrated. The output names a member by a hash of their id (sha256, 12 hex) and a layout by its row id, and lists
widget IDS only: no layout name, no widget settings, no tickers, no other content. ⚠️ The hashes are PSEUDONYMOUS,
not anonymous (anyone with the member list can recompute them): keep the output with the owner, never post it.

BOUNDED. The stores are read through cursors, each version reduced to (member, layout, version, source, time,
widget-id tuple) as it streams, and kept per member. ⛔ A heavy script on the production pod can take the pod down
(an OOM is a member outage), so:

    python tools/layout_crosswrite_scan.py --count     # row counts, payload bytes, an estimated peak: FIRST
    python tools/layout_crosswrite_scan.py             # /data/charts_layouts.db + /data/workspace_docs.db
    python tools/layout_crosswrite_scan.py --since 2026-11-17 --json
    python tools/layout_crosswrite_scan.py --layouts-db X.db --versions-db Y.db

If ``--count`` estimates more than a few tens of MB, run the scan OFF the pod on a copy of the two files: take the
copy with SQLite's own backup (``sqlite3 SRC ".backup DST"``, or the nightly store backup), never a plain file copy
(a WAL database's latest writes are in its ``-wal`` file).

Exit 0 after a scan or a count (findings or not), 2 when a store cannot be opened.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sqlite3
import sys
from datetime import datetime, timezone
from typing import Iterator, Optional

DEFAULT_LAYOUTS_DB = os.environ.get("CHARTS_LAYOUTS_DB_PATH", "/data/charts_layouts.db")
DEFAULT_VERSIONS_DB = os.environ.get("WORKSPACE_DOCS_DB_PATH", "/data/workspace_docs.db")
_FETCH = 500   # rows per cursor batch


def member_hash(user_id) -> str:
    return hashlib.sha256(str(user_id).encode("utf-8")).hexdigest()[:12]


def widget_ids(layout_json) -> tuple:
    """The arrangement's widget-id set, sorted; () for an unreadable or empty layout (never a finding)."""
    try:
        layout = json.loads(layout_json) if isinstance(layout_json, str) else layout_json
    except (TypeError, ValueError):
        return ()
    widgets = layout.get("widgets") if isinstance(layout, dict) else None
    if not isinstance(widgets, list):
        return ()
    return tuple(sorted(str(w["id"]) for w in widgets if isinstance(w, dict) and w.get("id") is not None))


def _open_ro(path: str) -> sqlite3.Connection:
    if not os.path.exists(path):
        raise FileNotFoundError(path)
    conn = sqlite3.connect("file:" + path.replace("\\", "/") + "?mode=ro", uri=True, timeout=10.0)
    conn.execute("PRAGMA query_only = ON")
    return conn


def _stream(conn: sqlite3.Connection, sql: str, params=()) -> Iterator[tuple]:
    cur = conn.execute(sql, params)
    while True:
        batch = cur.fetchmany(_FETCH)
        if not batch:
            return
        yield from batch


def _since_epoch(since: Optional[str]) -> Optional[int]:
    if not since:
        return None
    if since.isdigit():
        return int(since)
    return int(datetime.fromisoformat(since).replace(tzinfo=timezone.utc).timestamp())


def _has_versions(conn: sqlite3.Connection) -> bool:
    return conn.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'artifact_versions'").fetchone() is not None


def load_rows(layouts_db: str) -> list:
    """Every member's own layout row, reduced as it streams to (member, layout id, widget-id tuple, time)."""
    conn = _open_ro(layouts_db)
    try:
        return [(str(uid), str(lid), widget_ids(lj), up or cr or 0) for uid, lid, lj, up, cr in _stream(
            conn, "SELECT user_id, id, layout_json, updated_at, created_at FROM charts_layouts WHERE scope = 'user' "
                  "ORDER BY user_id, id")]
    finally:
        conn.close()


def scan_rows(rows: list) -> list:
    """Findings NOW: each member's own rows grouped by arrangement; a group of two or more is a finding."""
    groups: dict = {}
    for uid, lid, ids, t in rows:
        if ids:
            groups.setdefault((uid, ids), []).append((lid, t))
    out = []
    for (uid, ids), members in groups.items():
        if len(members) < 2:
            continue
        out.append({
            "kind": "rows-share-an-arrangement",
            "member": member_hash(uid),
            "layout_ids": [int(lid) if lid.isdigit() else lid for lid, _ in members],
            "updated_at": [t for _, t in members],
            "widget_ids": list(ids),
        })
    return out


def _versions(conn: sqlite3.Connection) -> Iterator[tuple]:
    """Each layout version reduced as it streams: (member, layout, version, source, time, widget-id tuple)."""
    for uid, aid, ver, src, payload_json, at in _stream(
            conn, "SELECT user_id, artifact_id, version, source, payload_json, created_at FROM artifact_versions "
                  "WHERE kind = 'layout' ORDER BY user_id, artifact_id, version"):
        try:
            payload = json.loads(payload_json)
        except (TypeError, ValueError):
            payload = None
        ids = widget_ids(payload.get("layout_json")) if isinstance(payload, dict) else ()
        yield str(uid), str(aid), ver, src, at or 0, ids


def scan_history(rows: list, versions_db: str, since: Optional[int] = None) -> list:
    """Findings in HISTORY: a 'save' version of a layout that jumped to an arrangement ANOTHER of the member's layouts
    held EARLIER (its row, or a recorded version of it, older than this save). Two streamed passes: when each layout
    first held each arrangement (kept per member), then the jumps."""
    first_held: dict = {}   # member -> arrangement -> layout -> earliest time

    def held(uid, lid, ids, t):
        if not ids:
            return
        by_layout = first_held.setdefault(uid, {}).setdefault(ids, {})
        if lid not in by_layout or t < by_layout[lid]:
            by_layout[lid] = t

    for uid, lid, ids, t in rows:
        held(uid, lid, ids, t)
    conn = _open_ro(versions_db)
    try:
        if not _has_versions(conn):
            return []
        for uid, aid, _ver, _src, at, ids in _versions(conn):
            held(uid, aid, ids, at)
        out = []
        prev_key, prev_ids = None, ()
        for uid, aid, ver, src, at, ids in _versions(conn):
            key = (uid, aid)
            before = prev_ids if key == prev_key else ()
            prev_key, prev_ids = key, ids
            if src != "save" or not ids or ids == before:
                continue
            if since is not None and at < since:
                continue
            others = sorted(int(a) if a.isdigit() else a
                            for a, t in first_held.get(uid, {}).get(ids, {}).items() if a != aid and t < at)
            if not others:
                continue
            out.append({
                "kind": "save-jumped-to-another-layout",
                "member": member_hash(uid),
                "layout_id": int(aid) if aid.isdigit() else aid,
                "version": ver,
                "created_at": at,
                "matches_layout_ids": others,
                "widget_ids": list(ids),
            })
        return out
    finally:
        conn.close()


def count(layouts_db: str, versions_db: str) -> dict:
    """What a scan would read, without reading it: row counts, payload bytes, and an estimated peak (the reduced
    tuples it keeps, plus the largest single payload parsed at a time)."""
    conn = _open_ro(layouts_db)
    try:
        n_rows, row_bytes, row_max = conn.execute(
            "SELECT COUNT(*), COALESCE(SUM(LENGTH(layout_json)), 0), COALESCE(MAX(LENGTH(layout_json)), 0) "
            "FROM charts_layouts WHERE scope = 'user'").fetchone()
    finally:
        conn.close()
    vconn = _open_ro(versions_db)
    try:
        if _has_versions(vconn):
            n_ver, ver_bytes, ver_max = vconn.execute(
                "SELECT COUNT(*), COALESCE(SUM(LENGTH(payload_json)), 0), COALESCE(MAX(LENGTH(payload_json)), 0) "
                "FROM artifact_versions WHERE kind = 'layout'").fetchone()
        else:
            n_ver, ver_bytes, ver_max = 0, 0, 0
    finally:
        vconn.close()
    # a reduced tuple is ~0.5 KB with its widget ids; a parsed JSON payload is ~10x its text, one at a time
    peak_mb = ((n_rows + n_ver) * 512 + 10 * max(row_max, ver_max) + _FETCH * max(row_max, ver_max)) / 1e6
    return {"layout_rows": n_rows, "layout_json_bytes": row_bytes, "versions": n_ver, "payload_json_bytes": ver_bytes,
            "largest_payload_bytes": max(row_max, ver_max), "estimated_peak_mb": round(peak_mb, 1)}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(
        description="Read-only scan for named-layout cross-writes. Run --count first. The member hashes are "
                    "pseudonymous: keep the output with the owner, never post it.")
    ap.add_argument("--layouts-db", default=DEFAULT_LAYOUTS_DB)
    ap.add_argument("--versions-db", default=DEFAULT_VERSIONS_DB)
    ap.add_argument("--since", default=None, help="history from this ISO date or epoch second")
    ap.add_argument("--count", action="store_true", help="row counts, payload bytes and an estimated peak only")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args(argv)
    try:
        if a.count:
            c = count(a.layouts_db, a.versions_db)
            print(json.dumps(c) if a.json else " ".join(f"{k}={v}" for k, v in c.items()))
            return 0
        rows = load_rows(a.layouts_db)
        now = scan_rows(rows)
        hist = scan_history(rows, a.versions_db, _since_epoch(a.since))
    except (FileNotFoundError, sqlite3.Error) as e:
        print(f"cannot open a store: {e}", file=sys.stderr)
        return 2
    if a.json:
        print(json.dumps({"rows": now, "history": hist}, indent=1))
        return 0
    print(f"rows sharing an arrangement: {len(now)}")
    for f in now:
        print(f"  member {f['member']}  layouts {f['layout_ids']}  widgets {f['widget_ids']}")
    print(f"saves that jumped to another layout's arrangement: {len(hist)}")
    for f in hist:
        print(f"  member {f['member']}  layout {f['layout_id']} v{f['version']} at {f['created_at']}  "
              f"= layouts {f['matches_layout_ids']}  widgets {f['widget_ids']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
