"""AAII Sentiment Survey — read on the SERVER, and stored breadth rows corrected to the right week.

⭐ WHY (2026-10-10). AAII redesigned www.aaii.com/sentimentsurvey and the `dataChart5`
global the PC collector reads disappeared, so from 2026-10-01 the collector kept stamping
each new Thursday's `aaii_survey_date` onto the 2026-09-23 survey's numbers (32.7 / 19.2 /
48.1). Two weekly releases were lost and the UCTAAII chart sat flat. The owner also asked
to stop relying on the PC at all.

THE SOURCE. AAII's public results table (`/sentimentsurvey/sent_results`) — one row per
survey, newest first: "Reported Date" (the Wednesday the survey CLOSED; the row carries no
year) plus Bullish / Neutral / Bearish. Plain HTTP with a browser User-Agent answers it
(measured 2026-10-10); no headless browser is needed.

THE DATING RULE — the collector's own: a survey that closed Wednesday W is released
Thursday W+1, and every session from that Thursday until the next release carries it,
with `aaii_survey_date` = that Thursday.

`fill()` compares each recent stored row with the survey in effect for its date and
patches the five keys (bulls, neutral, bears, spread, survey date) when they differ. It
writes only on a sane parse — at least `MIN_ROWS` rows, each three components in (0, 100)
summing to 100 +/- 1.5 — so a changed page shape writes nothing.
"""
from __future__ import annotations

import logging
import re
from datetime import date, timedelta
from typing import Callable, Optional

_log = logging.getLogger("breadth_aaii")

URL = "https://www.aaii.com/sentimentsurvey/sent_results"
HEADERS = {
    "User-Agent": ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                   "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"),
    "Accept": "text/html,application/xhtml+xml",
    "Accept-Language": "en-US,en;q=0.9",
}
MIN_ROWS = 4
KEYS = ("aaii_bulls", "aaii_neutral", "aaii_bears", "aaii_spread", "aaii_survey_date")

_MONTHS = {m: i for i, m in enumerate(
    ("jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"), 1)}
_ROW = re.compile(
    r"<td[^>]*>\s*([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2})\s*</td>\s*"
    r"<td[^>]*>\s*([\d.]+)\s*%\s*</td>\s*"
    r"<td[^>]*>\s*([\d.]+)\s*%\s*</td>\s*"
    r"<td[^>]*>\s*([\d.]+)\s*%\s*</td>", re.S)


def parse(html: str, today: Optional[date] = None) -> list[dict]:
    """`[{reported, bulls, neutral, bears}]` newest first. The table has no year: the
    newest row is the latest such date not after `today`, and each older row steps back
    a year whenever its month runs ahead of the row after it."""
    today = today or date.today()
    out = []
    year = None
    prev_month = None
    for mon, day, b, n, br in _ROW.findall(html or ""):
        m = _MONTHS.get(mon.lower()[:3])
        if not m:
            continue
        if year is None:
            year = today.year if (m, int(day)) <= (today.month, today.day) else today.year - 1
        elif prev_month is not None and m > prev_month:
            year -= 1
        prev_month = m
        try:
            reported = date(year, m, int(day))
            vals = (float(b), float(n), float(br))
        except ValueError:
            continue
        out.append({"reported": reported.isoformat(), "bulls": vals[0],
                    "neutral": vals[1], "bears": vals[2]})
    return out


def sane(rows: list) -> bool:
    if len(rows) < MIN_ROWS:
        return False
    for r in rows:
        vals = (r["bulls"], r["neutral"], r["bears"])
        if not all(0 < v < 100 for v in vals) or abs(sum(vals) - 100) > 1.5:
            return False
    dates = [r["reported"] for r in rows]
    return dates == sorted(dates, reverse=True) and len(set(dates)) == len(dates)


def fetch(get: Optional[Callable] = None) -> list:
    """The parsed table, or [] (unreachable, blocked, or an unrecognised shape)."""
    try:
        if get is None:
            import requests
            get = requests.get
        r = get(URL, headers=HEADERS, timeout=20)
        if getattr(r, "status_code", 0) != 200:
            return []
        rows = parse(r.text)
    except Exception as e:                        # noqa: BLE001
        _log.warning("[aaii] fetch failed: %s", e)
        return []
    return rows if sane(rows) else []


def release_date(reported_iso: str) -> str:
    """Wednesday close -> Thursday release (the survey date the rows carry)."""
    return (date.fromisoformat(reported_iso) + timedelta(days=1)).isoformat()


def survey_for(session_iso: str, rows: list) -> Optional[dict]:
    """The five stored keys for a session: the newest survey RELEASED on or before it."""
    for r in rows:                                # newest first
        rel = release_date(r["reported"])
        if rel <= session_iso:
            return {"aaii_bulls": round(r["bulls"], 1), "aaii_neutral": round(r["neutral"], 1),
                    "aaii_bears": round(r["bears"], 1),
                    "aaii_spread": round(r["bulls"] - r["bears"], 1),
                    "aaii_survey_date": rel}
    return None


def _differs(stored: dict, want: dict) -> bool:
    for k, v in want.items():
        s = stored.get(k)
        if k == "aaii_survey_date":
            if str(s or "")[:10] != v:
                return True
            continue
        try:
            if s is None or abs(float(s) - v) > 0.05:
                return True
        except (TypeError, ValueError):
            return True
    return False


def fill(sessions: int = 30, rows: Optional[list] = None) -> dict:
    """Patch every recent stored session whose AAII keys are not the survey in effect.
    The table only reaches back so far: a session older than its oldest row is left."""
    from api.services import breadth_monitor as bm
    rows = fetch() if rows is None else rows
    if not rows:
        return {"ok": False, "reason": "AAII table unavailable or unrecognised"}
    oldest_release = release_date(rows[-1]["reported"])
    stored_rows = bm.get_history(sessions) or []
    fixed, failed, current = [], [], 0
    for r in sorted(stored_rows, key=lambda x: x.get("date") or ""):
        d = r.get("date")
        if not d or d < oldest_release:
            continue
        want = survey_for(d, rows)
        if want is None:
            continue
        if not _differs(r, want):
            current += 1
            continue
        (fixed if bm.patch_fields(d, want) else failed).append(d)
    out = {"ok": not failed, "latest_survey": rows[0], "checked": current + len(fixed) + len(failed),
           "current": current, "fixed": fixed, "failed": failed}
    _log.info("[aaii] %s", out)
    return out
