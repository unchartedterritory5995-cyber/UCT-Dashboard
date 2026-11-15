"""Notebook usage report (follow-up A, 2026-11-13): which Notebook views, menu rows, doors, templates, blocks and
panel rows members use, read from the same store the admin return metrics read.

The Notebook's telemetry door (POST /api/j2/telemetry, api/routers/journal_two.py) stores each accepted event in
auth.db's `activity_log` as `action = "j2:<event>"`, its props cleaned on arrival to fixed ids, numbers and bools
(`_sanitize_notebook_props`); api/services/journal_two/notebook_return_metrics.py reads the same rows. This prints,
for a date range, how many times each event was sent, by how many members, and the count of every property value.

READ ONLY. The database is opened with SQLite's `mode=ro&immutable=1` (no -wal or -shm file is made), nothing is written, and only a key on the event's server
schema with a value that schema allows is printed (anything else is counted as "other"), so a row can never put a
title, a ticker or a tag on screen. A path that is not a file is refused. Never run it against production data on
the pod: copy nothing, run it on a backup you are allowed to read.

    python tools/notebook_usage_report.py --db path/to/auth.db
    python tools/notebook_usage_report.py --db path/to/auth.db --from 2026-11-01 --to 2026-11-13
    python tools/notebook_usage_report.py --db path/to/auth.db --all-notebook   # every Notebook event, not only usage
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

USAGE_EVENTS = (
    "view_used", "list_layout_used", "menu_row_used", "today_door_used", "template_started", "block_inserted",
    "panel_row_used", "notebook_route_opened",
)


def _schemas() -> dict:
    # Fix round 1 (M4): the schema's own small module, never the whole router.
    from api.services.journal_two.notebook_event_schemas import NOTEBOOK_PROP_SCHEMAS
    return NOTEBOOK_PROP_SCHEMAS


def _day(text: str) -> date:
    return datetime.strptime(text, "%Y-%m-%d").date()


def _label(spec, value) -> str | None:
    """The printable form of one stored value, or None when it is not one the schema allows."""
    if isinstance(spec, tuple):
        return value if isinstance(value, str) and value in spec else "other"
    if spec == "bool":
        return ("true" if value else "false") if isinstance(value, bool) else None
    return None   # numbers are summed elsewhere; never printed one by one


def collect(conn: sqlite3.Connection, events, start: date, end: date, schemas: dict) -> dict:
    """{event: {"count", "members", "props": {key: Counter}}} for rows in [start, end] (UTC days, inclusive)."""
    lo = f"{start.isoformat()} 00:00:00"
    hi = f"{(end + timedelta(days=1)).isoformat()} 00:00:00"
    out: dict = {}
    for event in events:
        schema = schemas.get(event, {})
        rows = conn.execute(
            "SELECT user_id, details FROM activity_log WHERE action = ? AND created_at >= ? AND created_at < ?",
            (f"j2:{event}", lo, hi),
        ).fetchall()
        props: dict[str, Counter] = defaultdict(Counter)
        members = set()
        for user_id, details in rows:
            members.add(user_id)
            try:
                data = json.loads(details or "{}")
            except (TypeError, ValueError):
                data = {}
            if not isinstance(data, dict):
                data = {}
            for key, spec in schema.items():
                if key not in data:
                    continue
                label = _label(spec, data[key])
                if label is not None:
                    props[key][label] += 1
        out[event] = {"count": len(rows), "members": len(members), "props": dict(props)}
    return out


def render(report: dict, start: date, end: date) -> str:
    lines = [f"Notebook usage, {start.isoformat()} to {end.isoformat()} (UTC days, inclusive)", ""]
    for event, r in report.items():
        lines.append(f"{event}: {r['count']} sent by {r['members']} member(s)")
        for key, counts in sorted(r["props"].items()):
            for value, n in sorted(counts.items(), key=lambda kv: (-kv[1], kv[0])):
                lines.append(f"  {key} = {value}: {n}")
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--db", required=True, help="path to an auth.db (read only)")
    ap.add_argument("--from", dest="start", help="first UTC day, YYYY-MM-DD (default: 30 days before --to)")
    ap.add_argument("--to", dest="end", help="last UTC day, YYYY-MM-DD (default: today)")
    ap.add_argument("--all-notebook", action="store_true", help="every Notebook event, not only the usage events")
    args = ap.parse_args(argv)

    path = Path(args.db)
    if not path.is_file():
        print(f"refused: {path} is not a file", file=sys.stderr)
        return 2
    try:
        end = _day(args.end) if args.end else datetime.now(timezone.utc).date()
        start = _day(args.start) if args.start else end - timedelta(days=30)
    except ValueError:
        print("refused: --from and --to are YYYY-MM-DD", file=sys.stderr)
        return 2
    if start > end:
        print("refused: --from is after --to", file=sys.stderr)
        return 2

    schemas = _schemas()
    events = tuple(schemas) if args.all_notebook else USAGE_EVENTS
    # Fix round 1 (M4): read only AND immutable, so SQLite creates no -wal / -shm files beside the database.
    conn = sqlite3.connect(f"{path.resolve().as_uri()}?mode=ro&immutable=1", uri=True)
    try:
        report = collect(conn, events, start, end, schemas)
    finally:
        conn.close()
    sys.stdout.write(render(report, start, end))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
