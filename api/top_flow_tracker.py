"""
top_flow_tracker.py — Persistent Top Flow performance tracker.

Saves Top Flow picks when new CSV data loads, tracks daily price snapshots,
and auto-archives expired contracts.

Storage: /data/top_flow_picks.json
{
  "active": [
    {
      "id": "AAPL|C|200.0|6/20",
      "sym": "AAPL", "cp": "C", "strike": 200.0, "exp": "6/20",
      "entry": 5.50, "grade": "A+", "dir": "BULL",
      "dateSaved": "2026-03-15", "hits": 4, "prem": 1500000,
      "history": [ {"date":"3/15/2026","price":5.50,"oi":1200,"spot":198.0} ]
    }
  ],
  "archived": [...]
}
"""

import json
import logging
import os
from datetime import date, datetime
from zoneinfo import ZoneInfo

logger = logging.getLogger(__name__)

PICKS_FILE = "/data/top_flow_picks.json"
ET = ZoneInfo("America/New_York")

_data: dict = {"active": [], "archived": []}


# ─── Persistence ──────────────────────────────────────────────────────────────

def _load() -> None:
    global _data
    if not os.path.exists(PICKS_FILE):
        _data = {"active": [], "archived": []}
        return
    try:
        with open(PICKS_FILE, encoding="utf-8") as f:
            _data = json.load(f)
        _data.setdefault("active", [])
        _data.setdefault("archived", [])
        logger.info("[top-flow] Loaded %d active, %d archived picks.", len(_data["active"]), len(_data["archived"]))
    except Exception as e:
        logger.error("[top-flow] Failed to load picks file: %s", e)
        _data = {"active": [], "archived": []}


def _save() -> None:
    try:
        os.makedirs(os.path.dirname(PICKS_FILE), exist_ok=True)
        tmp = PICKS_FILE + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(_data, f, separators=(",", ":"))
        os.replace(tmp, PICKS_FILE)
    except Exception as e:
        logger.error("[top-flow] Failed to save picks file: %s", e)


def init():
    """Call at startup to load from disk."""
    _load()


# ─── Key Helper ───────────────────────────────────────────────────────────────

def _pick_key(sym: str, cp: str, strike, exp: str) -> str:
    return f"{sym.upper()}|{cp.upper()}|{float(strike)}|{exp}"


# ─── Save Picks (auto-called when CSV loads) ─────────────────────────────────

def save_picks(picks: list[dict]) -> dict:
    """
    Merge new Top Flow picks into active tracking.
    New picks are added; existing picks get grade/hits updated.
    Returns summary.
    """
    today = date.today().isoformat()
    added = 0
    updated = 0

    existing_ids = {p["id"] for p in _data["active"]}
    archived_ids = {p["id"] for p in _data["archived"]}

    for p in picks:
        pid = _pick_key(p.get("sym", ""), p.get("cp", ""), p.get("strike", 0), p.get("exp", ""))
        if not pid or pid.count("|") < 3:
            continue

        # Skip if already archived (expired)
        if pid in archived_ids:
            continue

        if pid in existing_ids:
            # Update metadata
            existing = next(a for a in _data["active"] if a["id"] == pid)
            existing["grade"] = p.get("grade", existing.get("grade", ""))
            existing["hits"] = p.get("hits", existing.get("hits", 0))
            existing["prem"] = p.get("prem", existing.get("prem", 0))
            existing["dir"] = p.get("dir", existing.get("dir", ""))
            updated += 1
        else:
            _data["active"].append({
                "id": pid,
                "sym": p.get("sym", ""),
                "cp": p.get("cp", ""),
                "strike": float(p.get("strike", 0)),
                "exp": p.get("exp", ""),
                "entry": float(p.get("entry", 0)),
                "grade": p.get("grade", ""),
                "dir": p.get("dir", ""),
                "dateSaved": today,
                "hits": p.get("hits", 0),
                "prem": p.get("prem", 0),
                "history": [],
            })
            added += 1

    if added or updated:
        _save()
    logger.info("[top-flow] save_picks: %d added, %d updated, %d total active.", added, updated, len(_data["active"]))
    return {"added": added, "updated": updated, "total": len(_data["active"])}


# ─── Get Data ─────────────────────────────────────────────────────────────────

def get_all() -> dict:
    """Return active + archived picks."""
    return {
        "active": list(_data.get("active", [])),
        "archived": list(_data.get("archived", [])),
    }


# ─── Daily Snapshot (called by daily_tracker at 4:30 PM ET) ──────────────────

async def snapshot_prices() -> dict:
    """
    Fetch live Schwab quotes for all active Top Flow picks and append today's snapshot.
    Also runs archive_expired afterward.
    """
    active = _data.get("active", [])
    if not active:
        return {"status": "skipped", "reason": "no active picks"}

    # Schwab integration removed — option quote fetching disabled
    return {"status": "skipped", "reason": "Schwab integration removed"}

    saved = 0
    for pick, q in zip(active, quotes):
        if not q or q.get("error") or q.get("expired"):
            continue
        entry = {
            "date": today_str,
            "price": q.get("mark") or q.get("last") or 0,
            "oi": q.get("openInterest", 0),
            "spot": q.get("underlyingPrice", 0),
        }
        history = pick.setdefault("history", [])
        existing_idx = next((i for i, h in enumerate(history) if h.get("date") == today_str), None)
        if existing_idx is not None:
            history[existing_idx] = entry
        else:
            history.append(entry)
        saved += 1

    _save()
    # Archive expired after snapshotting
    archive_expired()
    logger.info("[top-flow] Snapshot: %d/%d priced.", saved, len(active))
    return {"status": "ok", "saved": saved, "total": len(active)}


# ─── Archive Expired ──────────────────────────────────────────────────────────

def archive_expired() -> int:
    """Move expired picks to archived list. Returns number archived."""
    today = date.today()
    still_active = []
    archived_count = 0

    for pick in _data.get("active", []):
        exp_str = pick.get("exp", "")
        parts = exp_str.split("/")
        try:
            m, d = int(parts[0]), int(parts[1])
            y = int(parts[2]) + 2000 if len(parts) >= 3 and int(parts[2]) < 100 else (
                int(parts[2]) if len(parts) >= 3 else today.year
            )
            exp_date = date(y, m, d)
        except (ValueError, IndexError):
            still_active.append(pick)
            continue

        if exp_date < today:
            # Compute final P&L
            entry_price = pick.get("entry", 0)
            final_price = pick["history"][-1]["price"] if pick.get("history") else 0
            pick["finalPrice"] = final_price
            pick["archivedDate"] = today.isoformat()
            pick["finalPnl"] = round(((final_price - entry_price) / entry_price * 100), 1) if entry_price > 0 and final_price > 0 else 0
            _data["archived"].append(pick)
            archived_count += 1
        else:
            still_active.append(pick)

    if archived_count:
        _data["active"] = still_active
        _save()
        logger.info("[top-flow] Archived %d expired picks.", archived_count)

    return archived_count
