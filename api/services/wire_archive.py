"""TERM-089 (item 15 ACC-10) -- the pod-side archive of Morning Wire issues.

WHY THIS EXISTS
---------------
`/api/push` overwrites `/data/wire_data.json` every morning, so the pod only ever
held TODAY's wire. The dated history lives on the owner's PC
(`morning-wire/data/snapshots/wire_<date>.json`, written by `lab/snapshot.py`),
which the pod cannot open. Rather than invent a new transport, the archive is
written by the push itself: the payload members were served IS the record.

WHAT IS STORED -- A PROJECTION, NAMED
-------------------------------------
Each entry is `{"date", "rundown_html", "archived_at"}` -- exactly what the
Morning Wire renderer consumes (`get_rundown` serves `rundown_html` + `date`).
The rest of the payload (leadership, themes, earnings, breadth ...) is NOT kept
here: it is large, it is not what a replay renders, and "what the data looked
like" as-of a date is TERM-019's job. The PC snapshots stay the full-fidelity
archive. Nothing here is ever deleted (a rundown is tens of KB a day).

WHAT IS NEVER DONE
------------------
* A read for a date the archive does not hold returns None -- never a neighbour,
  never today's. A replay that fills a gap forges what the firm said.
* The date is the only input and must be a real `YYYY-MM-DD`; it is parsed
  before any path is built, so nothing outside the archive directory (the
  owner's internal review notes sit beside the snapshots on the PC) is readable.
* An entry whose own `date` disagrees with its filename is not served.
"""
from __future__ import annotations

import json
import logging
import os
import re
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

logger = logging.getLogger(__name__)

_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_NAME_RE = re.compile(r"^wire_(\d{4}-\d{2}-\d{2})\.json$")


def archive_dir() -> Path:
    """Resolved per call so a test (and the conftest census pin) reaches it."""
    return Path(os.environ.get("WIRE_ARCHIVE_DIR", "/data/wire_archive"))


def parse_date(value) -> str:
    """The canonical `YYYY-MM-DD`, or ValueError. A real calendar date only."""
    if not isinstance(value, str) or not _DATE_RE.match(value):
        raise ValueError(f"not a YYYY-MM-DD date: {value!r}")
    return date.fromisoformat(value).isoformat()


def path_for(ymd) -> Path:
    """The one file a date may name. Refuses anything that is not a date."""
    return archive_dir() / f"wire_{parse_date(ymd)}.json"


def record(payload: dict, *, overwrite: bool = True) -> bool:
    """Archive one wire's renderable projection. Returns True when written.

    `overwrite=False` is the backfill door: it never replaces an entry a push
    recorded. A payload with no usable date or no rundown is skipped, never
    guessed at."""
    if not isinstance(payload, dict):
        return False
    try:
        ymd = parse_date(payload.get("date"))
    except ValueError:
        return False
    html = payload.get("rundown_html")
    if not isinstance(html, str) or not html:
        return False
    dest = path_for(ymd)
    if not overwrite and dest.exists():
        return False
    dest.parent.mkdir(parents=True, exist_ok=True)
    entry = {
        "date": ymd,
        "rundown_html": html,
        "archived_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }
    tmp = dest.with_name(dest.name + ".tmp")
    tmp.write_text(json.dumps(entry), encoding="utf-8")
    os.replace(tmp, dest)
    return True


def read(ymd) -> dict | None:
    """The archived entry for exactly `ymd`, or None. Never another day's."""
    try:
        path = path_for(ymd)
    except ValueError:
        return None
    try:
        entry = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if not isinstance(entry, dict) or entry.get("date") != parse_date(ymd):
        return None
    if not isinstance(entry.get("rundown_html"), str):
        return None
    return entry


def held_dates() -> list[str]:
    """Every date with an archive file, oldest first. Names that are not a
    `wire_<real date>.json` are ignored."""
    d = archive_dir()
    if not d.is_dir():
        return []
    out = []
    for p in d.iterdir():
        m = _NAME_RE.match(p.name)
        if not m or not p.is_file():
            continue
        try:
            out.append(parse_date(m.group(1)))
        except ValueError:
            continue
    return sorted(set(out))


def index() -> dict:
    """Newest-first dates plus the coverage the archive can honestly claim.

    The denominator is WEEKDAYS in [first, last] -- holiday-naive, and it says
    so -- so a gap is named rather than read as "no issue that day"."""
    held = held_dates()
    if not held:
        return {"dates": [], "coverage": {
            "held": 0, "first": None, "last": None, "weekdays_in_range": 0,
            "missing_weekdays": [], "denominator": "weekdays"}}
    first, last = date.fromisoformat(held[0]), date.fromisoformat(held[-1])
    held_set = set(held)
    weekdays, missing = 0, []
    d = first
    while d <= last:
        if d.weekday() < 5:
            weekdays += 1
            if d.isoformat() not in held_set:
                missing.append(d.isoformat())
        d += timedelta(days=1)
    return {"dates": list(reversed(held)), "coverage": {
        "held": len(held), "first": held[0], "last": held[-1],
        "weekdays_in_range": weekdays, "missing_weekdays": missing,
        "denominator": "weekdays"}}
