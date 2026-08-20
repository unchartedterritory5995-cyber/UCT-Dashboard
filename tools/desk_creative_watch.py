"""Desk creative watch — did today's session(s) publish with a creative title?

Deterministic daily check (Task Scheduler, weekdays early afternoon CT) for the
DESK_CREATIVE_TITLES/THUMBS rollout: reads today's done jobs from the pod's
diagnostics endpoint, verifies each published title carries a creative hook
(" | ") and today's "— {date}" suffix, and posts a short report + the live
thumbnail into the admin Discord so the owner eyeballs every cover.

Quiet rules: no jobs today -> exits silently (the 18:00 ET safety net owns
"session missing"); Discord/report failures never raise. Reads PUSH_SECRET and
DISCORD_WEBHOOK_URL from `railway variables` (the dashboard checkout is linked).
"""
from __future__ import annotations

import json
import subprocess
import sys
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import requests

_ET = ZoneInfo("America/New_York")
_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
       "Chrome/126 Safari/537.36")
_RAILWAY_DIR = r"C:\Users\Patrick\uct-dashboard"
_STATUS_URL = "https://uctintelligence.com/api/desk/sessions-status"
_OEMBED = "https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v={vid}&format=json"
_THUMB = "https://i.ytimg.com/vi/{vid}/maxresdefault.jpg"


def _railway_vars() -> dict:
    out = subprocess.run(["railway", "variables", "--service", "web", "--json"],
                         cwd=_RAILWAY_DIR, capture_output=True, text=True,
                         timeout=60, shell=True)
    return json.loads(out.stdout or "{}")


def _today_et_date_text(now=None) -> str:
    dt = (now or datetime.now(_ET))
    return f"{dt.strftime('%B')} {dt.day}, {dt.year}"


def _job_is_today(job: dict, now=None) -> bool:
    raw = str(job.get("start_time") or "").replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(raw)
    except ValueError:
        return False
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(_ET).date() == (now or datetime.now(_ET)).date()


def check_title(title: str, date_text: str) -> tuple[str, str]:
    """(verdict, note) for one published YouTube title."""
    if not title.endswith(f"— {date_text}"):
        return "WARN", "title does not end with today's date suffix"
    if " | " not in title:
        return "WARN", "classic fallback shipped (creative title desk did not fire — check pod logs)"
    if len(title) > 100:
        return "WARN", "title exceeds the 100-char YouTube cap"
    return "OK", "creative title live"


def main() -> int:
    now = datetime.now(_ET)
    date_text = _today_et_date_text(now)
    env = _railway_vars()
    secret = env.get("PUSH_SECRET", "")
    webhook = env.get("DISCORD_WEBHOOK_URL", "")
    r = requests.get(_STATUS_URL, timeout=30,
                     headers={"User-Agent": _UA, "Authorization": f"Bearer {secret}"})
    r.raise_for_status()
    jobs = (r.json() or {}).get("jobs") or []
    todays = [j for j in jobs if j.get("status") == "done"
              and (j.get("youtube_id") or "").strip() and _job_is_today(j, now)]
    if not todays:
        print("no done jobs today — nothing to check")
        return 0
    for job in todays:
        vid = job["youtube_id"].strip()
        try:
            o = requests.get(_OEMBED.format(vid=vid), timeout=20,
                             headers={"User-Agent": _UA})
            title = (o.json().get("title") or "") if o.ok else ""
        except Exception:
            title = ""
        if not title:
            verdict, note = "WARN", "oEmbed unavailable (video private or still processing)"
        else:
            verdict, note = check_title(title, date_text)
        line = f"{'✅' if verdict == 'OK' else '⚠️'} {note}\n**{title or vid}**"
        print(f"[{verdict}] {vid}: {title!r} — {note}")
        if webhook:
            try:
                requests.post(webhook, timeout=20, json={"embeds": [{
                    "title": "🎬 Desk creative watch",
                    "description": line,
                    "image": {"url": _THUMB.format(vid=vid)},
                    "color": 0xC9A84C if verdict == "OK" else 0xE0A800,
                }]})
            except Exception as e:
                print(f"discord post failed (non-fatal): {e}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
