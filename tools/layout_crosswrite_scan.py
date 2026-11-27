"""Read-only scan for named-layout CROSS-WRITES (the defect #2926 closed): a member's layout row that holds the
board of ANOTHER of their layouts.

How it happened (the live production sweep, 2026-11-27): a preferences read that began before a dock switch answered
after it and put the old `charts_active_template` back under the new board; the dock's auto-save then wrote the new
board into the old layout's row, by name. The signature it leaves:

  * NOW: two of one member's own (scope 'user') layout rows hold the same arrangement (the same widget-id set);
  * HISTORY (``artifact_versions``, armed since 2026-10-02): a ``save`` version of one layout whose arrangement is
    another of the member's layouts' arrangement, and is not the version before it (the row JUMPED to it).

Two rows can share an arrangement on purpose (a member's duplicate, a layout re-saved from another): a finding is a
row to LOOK AT, not a verdict. Restoring one is the Layout Dock's History (or a pod-side
``charts_layout_service.restore_content``), never this tool.

READ ONLY. Both databases are opened ``mode=ro``; nothing is written, created or migrated. The output names a member
by a hash of their id (sha256, 12 hex) and a layout by its row id, and lists widget IDS only: no layout name, no
widget settings, no tickers, no other content.

Run it where the stores live (the web pod), as the owner:

    python tools/layout_crosswrite_scan.py                         # /data/charts_layouts.db + /data/workspace_docs.db
    python tools/layout_crosswrite_scan.py --since 2026-11-17 --json
    python tools/layout_crosswrite_scan.py --layouts-db X.db --versions-db Y.db

Exit 0 after a scan (findings or not), 2 when a store cannot be opened.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sqlite3
import sys
from datetime import datetime, timezone
from typing import Optional

DEFAULT_LAYOUTS_DB = os.environ.get("CHARTS_LAYOUTS_DB_PATH", "/data/charts_layouts.db")
DEFAULT_VERSIONS_DB = os.environ.get("WORKSPACE_DOCS_DB_PATH", "/data/workspace_docs.db")


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
    ids = []
    for w in widgets:
        if isinstance(w, dict) and w.get("id") is not None:
            ids.append(str(w["id"]))
    return tuple(sorted(ids))


def _open_ro(path: str) -> sqlite3.Connection:
    if not os.path.exists(path):
        raise FileNotFoundError(path)
    uri = "file:" + path.replace("\\", "/") + "?mode=ro"
    conn = sqlite3.connect(uri, uri=True, timeout=10.0)
    conn.row_factory = sqlite3.Row
    return conn


def _since_epoch(since: Optional[str]) -> Optional[int]:
    if not since:
        return None
    if since.isdigit():
        return int(since)
    return int(datetime.fromisoformat(since).replace(tzinfo=timezone.utc).timestamp())


def scan_rows(layouts_db: str) -> list:
    """Findings NOW: each member's own rows grouped by arrangement; a group of two or more is a finding."""
    conn = _open_ro(layouts_db)
    try:
        rows = conn.execute(
            "SELECT id, user_id, layout_json, updated_at, created_at FROM charts_layouts WHERE scope = 'user' "
            "ORDER BY user_id, id"
        ).fetchall()
    finally:
        conn.close()
    groups: dict = {}
    for r in rows:
        ids = widget_ids(r["layout_json"])
        if not ids:
            continue
        groups.setdefault((r["user_id"], ids), []).append(r)
    out = []
    for (uid, ids), members in groups.items():
        if len(members) < 2:
            continue
        out.append({
            "kind": "rows-share-an-arrangement",
            "member": member_hash(uid),
            "layout_ids": [m["id"] for m in members],
            "updated_at": [m["updated_at"] or m["created_at"] for m in members],
            "widget_ids": list(ids),
        })
    return out


def scan_history(layouts_db: str, versions_db: str, since: Optional[int] = None) -> list:
    """Findings in HISTORY: a 'save' version of a layout that jumped to an arrangement ANOTHER of the member's layouts
    held EARLIER (its row, or a recorded version of it, older than this save)."""
    conn = _open_ro(layouts_db)
    try:
        rows = conn.execute("SELECT id, user_id, layout_json, updated_at, created_at FROM charts_layouts "
                            "WHERE scope = 'user'").fetchall()
    finally:
        conn.close()
    vconn = _open_ro(versions_db)
    try:
        has_table = vconn.execute(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'artifact_versions'").fetchone()
        versions = vconn.execute(
            "SELECT user_id, artifact_id, version, source, payload_json, created_at FROM artifact_versions "
            "WHERE kind = 'layout' ORDER BY user_id, artifact_id, version"
        ).fetchall() if has_table else []
    finally:
        vconn.close()
    # when each layout FIRST held each arrangement: its row (as of its last write), and each recorded version
    first_held: dict = {}

    def held(key, ids, t):
        if not ids:
            return
        d = first_held.setdefault(key, {})
        if ids not in d or t < d[ids]:
            d[ids] = t

    for r in rows:
        held((str(r["user_id"]), str(r["id"])), widget_ids(r["layout_json"]), r["updated_at"] or r["created_at"] or 0)
    payload_ids = []
    for v in versions:
        try:
            payload = json.loads(v["payload_json"])
        except (TypeError, ValueError):
            payload = {}
        ids = widget_ids(payload.get("layout_json")) if isinstance(payload, dict) else ()
        payload_ids.append(ids)
        held((str(v["user_id"]), str(v["artifact_id"])), ids, v["created_at"] or 0)
    out = []
    prev_key, prev_ids = None, ()
    for v, ids in zip(versions, payload_ids):
        key = (str(v["user_id"]), str(v["artifact_id"]))
        before = prev_ids if key == prev_key else ()
        prev_key, prev_ids = key, ids
        if v["source"] != "save" or not ids or ids == before:
            continue
        if since is not None and (v["created_at"] or 0) < since:
            continue
        at = v["created_at"] or 0
        others = sorted(int(a) if a.isdigit() else a for (u, a), seen in first_held.items()
                        if u == key[0] and a != key[1] and ids in seen and seen[ids] < at)
        if not others:
            continue
        out.append({
            "kind": "save-jumped-to-another-layout",
            "member": member_hash(v["user_id"]),
            "layout_id": int(v["artifact_id"]) if str(v["artifact_id"]).isdigit() else v["artifact_id"],
            "version": v["version"],
            "created_at": v["created_at"],
            "matches_layout_ids": others,
            "widget_ids": list(ids),
        })
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--layouts-db", default=DEFAULT_LAYOUTS_DB)
    ap.add_argument("--versions-db", default=DEFAULT_VERSIONS_DB)
    ap.add_argument("--since", default=None, help="history from this ISO date or epoch second")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args(argv)
    try:
        now = scan_rows(a.layouts_db)
        hist = scan_history(a.layouts_db, a.versions_db, _since_epoch(a.since))
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
