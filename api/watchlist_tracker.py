"""
watchlist_tracker.py — Daily watchlist persistence.

Saves finalized daily watchlists, auto-prunes to 7 days.
Storage: /data/watchlists.json
{
  "2026-04-28": {
    "date": "2026-04-28",
    "bull": [ { "sym","score","tier","strike","exp","cp","grade","dir","hits","prem","side","notes","autoScore" } ],
    "bear": [ ... ]
  }
}
"""

import json
import logging
import os
from datetime import date, timedelta

logger = logging.getLogger(__name__)

WATCHLIST_FILE = "/data/watchlists.json"
MAX_DAYS = 7

_data: dict = {}


def _load() -> None:
    global _data
    if not os.path.exists(WATCHLIST_FILE):
        _data = {}
        return
    try:
        with open(WATCHLIST_FILE, encoding="utf-8") as f:
            _data = json.load(f)
        logger.info("[watchlist] Loaded %d days of watchlists.", len(_data))
    except Exception as e:
        logger.error("[watchlist] Failed to load: %s", e)
        _data = {}


def _save() -> None:
    try:
        os.makedirs(os.path.dirname(WATCHLIST_FILE), exist_ok=True)
        tmp = WATCHLIST_FILE + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(_data, f, separators=(",", ":"))
        os.replace(tmp, WATCHLIST_FILE)
    except Exception as e:
        logger.error("[watchlist] Failed to save: %s", e)


def _prune() -> None:
    """Keep only the most recent MAX_DAYS entries."""
    if len(_data) <= MAX_DAYS:
        return
    sorted_keys = sorted(_data.keys(), reverse=True)
    for k in sorted_keys[MAX_DAYS:]:
        del _data[k]


def init():
    _load()


def save_watchlist(day: str, bull: list, bear: list, removed: list | None = None) -> dict:
    _data[day] = {
        "date": day,
        "bull": bull,
        "bear": bear,
        "removed": removed or [],
    }
    _prune()
    _save()
    logger.info("[watchlist] Saved watchlist for %s: %d bull, %d bear.", day, len(bull), len(bear))
    return {"status": "ok", "date": day, "bull": len(bull), "bear": len(bear)}


def get_watchlist(day: str) -> dict:
    return _data.get(day, {"date": day, "bull": [], "bear": []})


def get_recent_dates() -> list:
    return sorted(_data.keys(), reverse=True)[:MAX_DAYS]


def get_latest_watchlist() -> dict | None:
    """Return the most recently saved watchlist, or None if empty."""
    if not _data:
        return None
    latest_date = sorted(_data.keys(), reverse=True)[0]
    return _data[latest_date]
