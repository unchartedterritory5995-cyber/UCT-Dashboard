"""The indicator SUPPORT LOOP, Phase B: the daily digest and the machine views.

Spec: ``docs/pine/support-loop/PHASE-B.md``. Phase A (``indicator_support``) stores
the gap counts and the opt-in reports; this module READS them, once a day, into a
ranked digest that drops the gaps the current build already fixes, and serves the
two narrow views the local triage tool needs. It writes nothing of Phase A's
except a report's status, through Phase A's own ``admin_set_status``.

## What the digest holds, and what it never holds

* the top open gaps by distinct members (``gap_ranking``), each with the door's
  current answer for that name (``doorNameCoverage.json``) and whether it is
  ``fixed_on_master``; fixed gaps move to their own list, so they drop off;
* the open reports (``new`` and ``triaged``): id, status, dates, symbol,
  timeframe, allowlisted gap names, size, ``same_script_reports``, and only
  WHETHER a note or link exists.

⛔ NO MEMBER CONTENT AND NO MEMBER ID: no source, no note text, no link, no
``reporter``. That is what lets the digest go to the admin Discord channel and to
a bearer-authenticated local tool without either one ever seeing a member.

## "Fixed on master" (``fixed_on_master``)

``app/src/components/chart/supportLoop/doorNameCoverage.json`` is the Pine door's
answer for every allowlisted built-in, generated through the translator and
pinned to the build by ``doorNameCoverage.test.js`` (it reds when stale). The
rule, mirrored by ``doorNameCoverage.js::fixedOnMaster`` and railed on both sides:

* ``name-unknown`` gap: fixed when the door now KNOWS the name
  (``reachable`` or ``call-unmapped``);
* ``call-unmapped`` gap: fixed ONLY through a ``fixes`` entry (``fixedGaps.json``)
  whose minimal repro translates in this build;
* anything else, including ``_unlisted``, an unknown name, ``unprobed`` or an
  unreadable manifest: OPEN. Every uncertainty resolves to open.

## Once a day, and light

``daily_digest`` builds at most once per ET day AND manifest hash (a deploy that
changes the door rebuilds it, so a fix drops off the same day it ships) and keeps
the JSON in ``indicator_support_digests`` (60 days). A build is two indexed
SELECTs over small tables plus one JSON file read: it is not a heavy job.
``run_daily_digest`` (scheduler, 08:20 ET) builds it and posts ONE summary to the
admin Discord channel through ``discord_notify._send_webhook`` (the admin sink),
claimed with a conditional UPDATE so two processes cannot both post. It posts only
when there is something to act on. ``PINE_SUPPORT_DIGEST_POST=off`` silences the
post; the digest is still built and served.
"""
from __future__ import annotations

import datetime as _dt
import hashlib
import json
import logging
import os
from pathlib import Path
from typing import Any, Optional
from zoneinfo import ZoneInfo

from api.services import indicator_support as svc

log = logging.getLogger(__name__)

DOOR_MANIFEST_PATH = svc.ALLOWLIST_PATH.parent / "doorNameCoverage.json"
POST_OFF_ENV = "PINE_SUPPORT_DIGEST_POST"     # "off" silences the Discord post
DIGEST_WINDOW_DAYS = 30
DIGEST_TOP = 25
DIGEST_RETAIN_DAYS = 60
OPEN_REPORT_STATUSES = ("new", "triaged")
KNOWN_NAME_STATUSES = frozenset({"reachable", "call-unmapped"})
_ET = ZoneInfo("America/New_York")

_SCHEMA = """
CREATE TABLE IF NOT EXISTS indicator_support_digests (
    day           TEXT PRIMARY KEY,
    manifest_sha  TEXT NOT NULL,
    built_at      TEXT NOT NULL,
    body          TEXT NOT NULL,
    posted_at     TEXT
);
"""


# ─── the door manifest ──────────────────────────────────────────────────────

_manifest_cache: dict[str, Any] = {"key": None, "value": None, "sha": None}


def load_door_manifest(path: Optional[Path] = None) -> tuple[Optional[dict], str]:
    """(manifest, sha12). ``(None, "unreadable")`` when the file is missing or bad,
    and then NOTHING is fixed. Cached on (path, mtime, size)."""
    p = Path(path or DOOR_MANIFEST_PATH)
    try:
        st = p.stat()
        key = (str(p), st.st_mtime_ns, st.st_size)
        if _manifest_cache["key"] == key:
            return _manifest_cache["value"], _manifest_cache["sha"]
        raw = p.read_bytes()
        value = json.loads(raw.decode("utf-8"))
        if not isinstance(value, dict) or not isinstance(value.get("names"), dict):
            raise ValueError("doorNameCoverage.json has no `names` map")
        sha = hashlib.sha256(raw.replace(b"\r\n", b"\n")).hexdigest()[:12]
        _manifest_cache.update(key=key, value=value, sha=sha)
        return value, sha
    except Exception:  # noqa: BLE001
        log.warning("[support-loop] door manifest unreadable; every gap reads open")
        return None, "unreadable"


def door_status(manifest: Optional[dict], name: str) -> str:
    if name == svc.UNLISTED:
        return "unlisted"
    row = ((manifest or {}).get("names") or {}).get(name)
    return row.get("status", "unknown") if isinstance(row, dict) else "unknown"


def fixed_on_master(manifest: Optional[dict], name: str, kind: str) -> bool:
    """⭐ THE RULE (module header). Mirrors ``doorNameCoverage.js::fixedOnMaster``."""
    if not manifest or not isinstance(name, str) or name == svc.UNLISTED:
        return False
    for f in manifest.get("fixes") or []:
        if (isinstance(f, dict) and f.get("name") == name and f.get("kind") == kind
                and f.get("status") == "fixed"):
            return True
    if kind != "name-unknown":
        return False
    return door_status(manifest, name) in KNOWN_NAME_STATUSES


# ─── report views without member content ────────────────────────────────────

def _report_summary(r: dict, manifest: Optional[dict]) -> dict:
    """A report with NO source, NO note text, NO link and NO reporter."""
    gaps = [g for g in (r.get("gaps") or []) if isinstance(g, dict)]
    return {
        "id": r.get("id"), "status": r.get("status"),
        "created_at": r.get("created_at"), "status_changed_at": r.get("status_changed_at"),
        "symbol": r.get("symbol"), "timeframe": r.get("timeframe"),
        "gaps": [{"name": g.get("name"), "kind": g.get("kind"),
                  "fixed_on_master": fixed_on_master(manifest, g.get("name"), g.get("kind"))}
                 for g in gaps],
        "has_note": bool(r.get("note")), "has_link": bool(r.get("tradingview_link")),
        "source_bytes": r.get("source_bytes"), "source_hash": r.get("source_hash"),
        "same_script_reports": r.get("same_script_reports", 1),
        "translator_version": r.get("translator_version"),
    }


def open_reports(manifest: Optional[dict] = None) -> list[dict]:
    if manifest is None:
        manifest, _ = load_door_manifest()
    out = []
    for st in OPEN_REPORT_STATUSES:
        out.extend(_report_summary(r, manifest) for r in svc.admin_list_reports(st, 1000))
    return out


def internal_report(report_id: str) -> Optional[dict]:
    """ONE report for the triage tool: its source and note (the reason it exists),
    still WITHOUT the reporter, who the tool has no need to know."""
    r = svc.admin_get_report(report_id)
    if not r:
        return None
    r = dict(r)
    r.pop("reporter", None)
    return r


# ─── the digest ─────────────────────────────────────────────────────────────

def _today_et(now: Optional[_dt.datetime] = None) -> str:
    t = now or _dt.datetime.now(_dt.timezone.utc)
    return t.astimezone(_ET).strftime("%Y-%m-%d")


def build_digest(*, days: int = DIGEST_WINDOW_DAYS, top: int = DIGEST_TOP,
                 now: Optional[_dt.datetime] = None,
                 manifest_path: Optional[Path] = None) -> dict:
    manifest, sha = load_door_manifest(manifest_path)
    ranking = svc.gap_ranking(days, 1000)
    open_gaps, fixed, unlisted = [], [], None
    for g in ranking:
        if g["name"] == svc.UNLISTED:
            unlisted = {k: g[k] for k in ("members", "hits", "first_day", "last_day")}
            continue
        row = {**g, "door_status": door_status(manifest, g["name"]),
               "fixed_on_master": fixed_on_master(manifest, g["name"], g["kind"])}
        (fixed if row["fixed_on_master"] else open_gaps).append(row)
    for i, g in enumerate(open_gaps, 1):
        g["rank"] = i
    reports = open_reports(manifest)
    t = now or _dt.datetime.now(_dt.timezone.utc)
    return {
        "day": _today_et(t),
        "built_at": t.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "window_days": max(1, min(int(days or DIGEST_WINDOW_DAYS), 365)),
        "door_manifest": {"sha": sha, "counts": (manifest or {}).get("counts") or {}},
        "translator_version": svc.translator_version(),
        "gaps": {
            "open": open_gaps[:max(1, int(top))],
            "open_total": len(open_gaps),
            "fixed_on_master": [{k: g[k] for k in ("name", "kind", "members", "hits", "door_status")}
                                for g in fixed],
            "unlisted": unlisted,
        },
        "reports": {
            "counts": {s: sum(1 for r in reports if r["status"] == s) for s in OPEN_REPORT_STATUSES},
            "open": reports,
        },
    }


def _conn():
    conn = svc._conn()
    conn.executescript(_SCHEMA)
    return conn


def daily_digest(*, now: Optional[_dt.datetime] = None, refresh: bool = False,
                 manifest_path: Optional[Path] = None) -> dict:
    """Today's digest, built at most once per ET day and manifest hash."""
    day = _today_et(now)
    _, sha = load_door_manifest(manifest_path)
    conn = _conn()
    try:
        row = conn.execute("SELECT manifest_sha, body FROM indicator_support_digests WHERE day = ?",
                           (day,)).fetchone()
        if row and row[0] == sha and not refresh:
            return json.loads(row[1])
        body = build_digest(now=now, manifest_path=manifest_path)
        conn.execute(
            "INSERT INTO indicator_support_digests (day, manifest_sha, built_at, body) VALUES (?, ?, ?, ?)"
            " ON CONFLICT(day) DO UPDATE SET manifest_sha = excluded.manifest_sha,"
            " built_at = excluded.built_at, body = excluded.body",
            (day, sha, body["built_at"], json.dumps(body, separators=(",", ":"))))
        cutoff = (_dt.date.fromisoformat(day) - _dt.timedelta(days=DIGEST_RETAIN_DAYS)).isoformat()
        conn.execute("DELETE FROM indicator_support_digests WHERE day < ?", (cutoff,))
        conn.commit()
        return body
    finally:
        conn.close()


# ─── the admin channel ──────────────────────────────────────────────────────

def post_enabled() -> bool:
    return (os.environ.get(POST_OFF_ENV) or "").strip().lower() != "off"


def digest_has_work(d: dict) -> bool:
    return bool(d["gaps"]["open_total"] or d["reports"]["open"] or d["gaps"]["fixed_on_master"])


def discord_embed(d: dict, *, lines: int = 10) -> dict:
    """The admin post. Names, counts and report ids only (see the header)."""
    out = []
    for g in d["gaps"]["open"][:lines]:
        out.append(f"{g['rank']}. `{g['name']}` ({g['kind']}): {g['members']} member"
                   f"{'' if g['members'] == 1 else 's'}, {g['hits']} hits")
    if d["gaps"]["open_total"] > lines:
        out.append(f"... and {d['gaps']['open_total'] - lines} more open gaps")
    fx = d["gaps"]["fixed_on_master"]
    if fx:
        out.append(f"Fixed on master, dropped off: {', '.join('`' + g['name'] + '`' for g in fx[:8])}"
                   + (f" and {len(fx) - 8} more" if len(fx) > 8 else ""))
    c = d["reports"]["counts"]
    out.append(f"Reports: {c.get('new', 0)} new, {c.get('triaged', 0)} triaged.")
    out.append("Triage: `python tools/support_loop/triage.py digest` (docs/pine/support-loop/PHASE-B.md)")
    return {"title": f"Pine support loop: {d['day']}",
            "description": "\n".join(out)[:3900], "color": 0xC9A227}


def _claim_post(day: str, now: Optional[_dt.datetime] = None) -> bool:
    """Atomically mark today's digest posted. False when someone already did."""
    stamp = (now or _dt.datetime.now(_dt.timezone.utc)).strftime("%Y-%m-%dT%H:%M:%SZ")
    conn = _conn()
    try:
        cur = conn.execute("UPDATE indicator_support_digests SET posted_at = ?"
                           " WHERE day = ? AND posted_at IS NULL", (stamp, day))
        conn.commit()
        return (cur.rowcount or 0) == 1
    finally:
        conn.close()


def run_daily_digest(now: Optional[_dt.datetime] = None) -> dict:
    """The scheduler job. Never raises."""
    try:
        d = daily_digest(now=now)
        if not post_enabled():
            return {"ok": True, "posted": False, "reason": "post-off"}
        if not digest_has_work(d):
            return {"ok": True, "posted": False, "reason": "nothing-to-act-on"}
        if not _claim_post(d["day"], now):
            return {"ok": True, "posted": False, "reason": "already-posted"}
        from api.services import discord_notify
        discord_notify._send_webhook(discord_embed(d))
        return {"ok": True, "posted": True}
    except Exception:  # noqa: BLE001
        log.exception("[support-loop] daily digest failed")
        return {"ok": False, "posted": False}
