# api/services/earnings_calendar_audit.py
"""Measure the earnings calendar against what actually happened, every week.

The week-ahead earnings card is built from projections and confirmations that
keep moving until the day itself. "It looked right" is not a measurement, so:

1. SNAPSHOT (Sunday 18:00 ET): freeze the upcoming week exactly as members and
   the Sunday Scans card see it, to `CALENDAR_SNAPSHOT_DIR/<monday>.json`.
2. AUDIT (Saturday 10:00 ET): rebuild that week now that it has happened and
   grade every snapshot row: right day + right session, wrong day, wrong
   session, unknown time, or not reported that week. Names that reported but
   were never on the card are counted as MISSED. The result is posted to the
   private System Alerts channel with every miss NAMED, and saved beside the
   snapshot as `<monday>.audit.json`.
3. SOURCE HEALTH (weekdays 18:30 ET): one line per resolver source from
   `earnings_session_resolver.load_health()`. A source that answered nothing
   all day is called out first.

Truth for the audit: the rebuilt past week (Finnhub's retentive range calendar
carries `hour` for reported names), with the company's own Item 2.02 8-K as the
tie-breaker when the rebuild has no session for a name. A grade the evidence
cannot support is reported as UNVERIFIED, never as right or wrong.

Kill switch: `CALENDAR_ACCURACY_AUDIT_ENABLED=0` stops all three jobs (unset =
on). Posts go to `DISCORD_ALERT_WEBHOOK`, read at call time; blank posts
nothing. Never raises into the scheduler.
"""
from __future__ import annotations

import json
import logging
import os
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

_logger = logging.getLogger(__name__)
_ET = ZoneInfo("America/New_York")
_SNAP_DIR = os.environ.get("CALENDAR_SNAPSHOT_DIR", "/data/calendar_snapshots")
_MAX_NAMES = 30
_INFERRED = {"edgar_history", "release_history", "yahoo_estimate"}


def is_enabled() -> bool:
    return os.environ.get("CALENDAR_ACCURACY_AUDIT_ENABLED", "1").strip().lower() not in (
        "0", "false", "no", "off")


def _today() -> date:
    return datetime.now(_ET).date()


def _next_monday(d: date) -> date:
    return d + timedelta(days=(7 - d.weekday()) % 7 or 7)


def _last_monday(d: date) -> date:
    return d - timedelta(days=d.weekday())


def _get_week(monday: date) -> dict:
    """The week payload, shape-checked by the ONE week-contract assertion; a
    malformed week raises (and the caller reports the failure) rather than
    reading as an empty week that grades 100%."""
    from api.routers.calendar import get_calendar
    from api.services.calendar_week_contract import week_days
    payload = get_calendar(week=monday.isoformat()) or {}
    days = week_days(payload, reader="api.services.earnings_calendar_audit._get_week")
    return {**payload, "days": days or {}}


def _post(text: str) -> bool:
    url = (os.environ.get("DISCORD_ALERT_WEBHOOK") or "").strip()
    if not url:
        return False
    try:
        import requests
        for chunk in _chunks(text, 1900):
            r = requests.post(url, json={"content": chunk, "allowed_mentions": {"parse": []}},
                              timeout=15)
            r.raise_for_status()
        return True
    except Exception as exc:          # noqa: BLE001
        _logger.warning("calendar audit: Discord post failed: %s", exc)
        return False


def _chunks(text: str, n: int):
    lines, cur = text.split("\n"), ""
    for ln in lines:
        if len(cur) + len(ln) + 1 > n and cur:
            yield cur
            cur = ""
        cur += ln + "\n"
    if cur.strip():
        yield cur


# ── rows ───────────────────────────────────────────────────────────────────

def rows_of(payload: dict) -> dict[str, dict]:
    """{sym: {day, bucket, date_est, session_note, reported}} — first placement wins."""
    out: dict[str, dict] = {}
    for ds in sorted((payload or {}).get("days") or {}):
        day = payload["days"][ds]
        if not isinstance(day, dict):
            continue
        for b in ("bmo", "amc", "tbd"):
            for e in day.get(b) or []:
                sym = e.get("sym")
                if sym and sym not in out:
                    out[sym] = {"day": ds, "bucket": b, "date_est": bool(e.get("date_est")),
                                "session_note": e.get("session_note") or "",
                                "src": e.get("session_src") or "",
                                "reported": e.get("eps_act") is not None or e.get("rev_act") is not None}
    return out


def _path(monday: date, suffix: str = "") -> str:
    return os.path.join(_SNAP_DIR, f"{monday.isoformat()}{suffix}.json")


def _write(path: str, obj) -> None:
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f)
    os.replace(tmp, path)


# ── 1. snapshot ────────────────────────────────────────────────────────────

def snapshot_upcoming_week(today: date | None = None) -> dict | None:
    if not is_enabled():
        return None
    try:
        monday = _next_monday(today or _today())
        p = _get_week(monday)
        snap = {"monday": monday.isoformat(), "taken_at": datetime.now(_ET).isoformat(timespec="seconds"),
                "source": p.get("source"), "as_of": p.get("as_of"),
                "quality": p.get("earnings_quality"), "rows": rows_of(p)}
        _write(_path(monday), snap)
        _logger.info("calendar audit: snapshot %s (%d rows)", monday, len(snap["rows"]))
        return snap
    except Exception as exc:          # noqa: BLE001
        _logger.warning("calendar audit: snapshot failed: %s", exc)
        return None


# ── 2. audit ───────────────────────────────────────────────────────────────

def _filing_truth(sym: str, monday: date) -> tuple[str, str] | None:
    """(day, session) from the company's own Item 2.02 8-K inside the week."""
    from api.services import earnings_session_resolver as r
    co = r._company(sym) or {}
    friday = monday + timedelta(days=4)
    for fd, sess in co.get("filings") or []:
        try:
            d = date.fromisoformat(fd)
        except ValueError:
            continue
        if monday <= d <= friday + timedelta(days=1):
            # An after-close 8-K carries the report day; a next-day-dated
            # morning one carries the morning it was released.
            return d.isoformat(), sess
    return None


def grade(snap_rows: dict, truth_rows: dict, filing=None) -> dict:
    """Pure grading. `filing(sym)` -> (day, session) | None is the tie-breaker."""
    out = {"right": [], "wrong_day": [], "wrong_session": [], "unknown_time": [],
           "not_reported": [], "unverified": [], "missed": []}
    for sym, s in sorted(snap_rows.items()):
        t = truth_rows.get(sym)
        t_day = t["day"] if t else None
        # A session the rebuild INFERRED (history, estimate) is not evidence.
        t_sess = (t["bucket"] if t and t["bucket"] in ("bmo", "amc")
                  and t.get("src") not in _INFERRED else None)
        if t and not t.get("reported") and not t_sess:
            t_day = None                     # listed, but nothing shows it happened
        if (not t or not t_sess) and filing:
            f = filing(sym)
            if f:
                t_day, t_sess = f
        if not t_day:
            out["not_reported"].append(f"{sym} (shown {s['day'][5:]})")
            continue
        if t_day != s["day"]:
            out["wrong_day"].append(f"{sym} (shown {s['day'][5:]}, reported {t_day[5:]})")
            continue
        if s["bucket"] == "tbd" and not s.get("session_note"):
            out["unknown_time"].append(sym)
            continue
        if s.get("session_note"):          # during market: right day is the claim
            out["right"].append(sym)
            continue
        if not t_sess:
            out["unverified"].append(sym)
            continue
        if t_sess != s["bucket"]:
            out["wrong_session"].append(f"{sym} (shown {s['bucket'].upper()}, was {t_sess.upper()})")
            continue
        out["right"].append(sym)
    for sym, t in sorted(truth_rows.items()):
        if sym not in snap_rows and t.get("reported"):
            out["missed"].append(f"{sym} ({t['day'][5:]})")
    graded = sum(len(out[k]) for k in ("right", "wrong_day", "wrong_session", "unknown_time"))
    out["accuracy"] = round(len(out["right"]) / graded, 4) if graded else None
    return out


def audit_week(monday: date | None = None, *, post: bool = True) -> dict | None:
    if not is_enabled():
        return None
    try:
        monday = monday or _last_monday(_today())
        try:
            with open(_path(monday), encoding="utf-8") as f:
                snap = json.load(f)
        except (OSError, ValueError):
            if post:
                _post(f"Earnings calendar audit, week of {monday:%b %d}: NO SNAPSHOT on file, "
                      "so the week could not be graded. The Sunday snapshot job did not run or failed.")
            return None
        truth = rows_of(_get_week(monday))
        res = grade(snap.get("rows") or {}, truth, lambda s: _filing_truth(s, monday))
        res["monday"] = monday.isoformat()
        _write(_path(monday, ".audit"), res)
        if post:
            _post(format_report(res, snap))
        return res
    except Exception as exc:          # noqa: BLE001
        _logger.warning("calendar audit: audit failed: %s", exc)
        return None


def format_report(res: dict, snap: dict | None = None) -> str:
    acc = res.get("accuracy")
    head = (f"Earnings calendar audit, week of {res.get('monday')}: "
            + (f"{acc:.1%} right" if acc is not None else "nothing gradable")
            + f" ({len(res['right'])} right, {len(res['wrong_day'])} wrong day, "
              f"{len(res['wrong_session'])} wrong time, {len(res['unknown_time'])} unknown time).")
    lines = [head]
    for key, label in (("wrong_day", "Wrong day"), ("wrong_session", "Wrong time"),
                       ("unknown_time", "Unknown time"), ("missed", "Reported but not on the card"),
                       ("not_reported", "On the card, no report that week"),
                       ("unverified", "Could not verify the time")):
        names = res.get(key) or []
        if names:
            more = f" +{len(names) - _MAX_NAMES} more" if len(names) > _MAX_NAMES else ""
            lines.append(f"{label} ({len(names)}): " + ", ".join(names[:_MAX_NAMES]) + more)
    if snap and (snap.get("quality") or {}).get("degraded"):
        lines.append("Note: the snapshot itself was taken from a DEGRADED build: "
                     + "; ".join(snap["quality"].get("reasons") or []))
    return "\n".join(lines)


# ── 3. source health ───────────────────────────────────────────────────────

def health_report(day: str | None = None) -> str:
    from api.services import earnings_session_resolver as r
    day = day or _today().isoformat()
    h = r.load_health().get(day) or {}
    if not h:
        return f"Earnings sources {day}: no lookups today (nothing needed verifying, or the resolver did not run)."
    down = sorted(k for k, v in h.items() if v.get("ok", 0) == 0 and v.get("fail", 0) > 0)
    lines = [f"Earnings sources {day}: " + ("ALL OK" if not down and not any(
        v.get("fail") for v in h.values()) else ("DOWN: " + ", ".join(down) if down else "some failures"))]
    for k in sorted(h):
        v = h[k]
        lines.append(f"  {k}: {v.get('ok', 0)} ok, {v.get('fail', 0)} failed"
                     + (f" (last: {v.get('last_error')})" if v.get("fail") else ""))
    return "\n".join(lines)


def post_health(day: str | None = None) -> bool:
    if not is_enabled():
        return False
    try:
        return _post(health_report(day))
    except Exception as exc:          # noqa: BLE001
        _logger.warning("calendar audit: health post failed: %s", exc)
        return False
