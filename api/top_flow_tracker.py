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

# `TOP_FLOW_PICKS_FILE` is the override; its DEFAULT is the literal that has
# always been here, so production with nothing set is unchanged.
PICKS_FILE = os.environ.get(
    "TOP_FLOW_PICKS_FILE", "/data/top_flow_picks.json")
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
            existing["cap"] = p.get("cap", existing.get("cap", ""))
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
                "cap": p.get("cap", ""),
                "dateSaved": p.get("dateSaved", "") or today,
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
    Fetch live quotes (price + OI) for all active picks and append to history.
    Called by daily_tracker at 4:30 PM ET, or manually via /api/top-flow/snapshot.
    Batches in chunks of 50 to avoid overwhelming Schwab API.
    Skips already-expired contracts.
    """
    import asyncio as _aio

    active = _data.get("active", [])
    if not active:
        return {"status": "skipped", "reason": "no active picks"}

    # Auto-archive expired picks first
    archived = archive_expired()
    if archived:
        active = _data.get("active", [])
        logger.info("[top-flow] Auto-archived %d expired picks before snapshot.", archived)

    today = date.today()
    today_str = datetime.now(ET).strftime("%-m/%-d/%Y")

    try:
        from api.schwab_service import get_batch_option_quotes
    except Exception as e:
        logger.error("[top-flow] Cannot import schwab_service: %s", e)
        return {"status": "error", "reason": str(e)}

    def _exp_to_iso(exp_str: str) -> str:
        parts = exp_str.split("/")
        if len(parts) < 2:
            return ""
        m, d = int(parts[0]), int(parts[1])
        if len(parts) >= 3:
            y = int(parts[2])
            if y < 100:
                y += 2000
        else:
            y = datetime.now().year
            if date(y, m, d) < date.today():
                y += 1
        return f"{y}-{m:02d}-{d:02d}"

    def _is_expired(exp_str: str) -> bool:
        parts = exp_str.split("/")
        try:
            m, d = int(parts[0]), int(parts[1])
            y = int(parts[2]) + 2000 if len(parts) >= 3 and int(parts[2]) < 100 else (
                int(parts[2]) if len(parts) >= 3 else today.year
            )
            return date(y, m, d) < today
        except (ValueError, IndexError):
            return False

    # Filter to non-expired only, cap at 200 most recent by dateSaved
    live_picks = [p for p in active if not _is_expired(p.get("exp", ""))]
    live_picks.sort(key=lambda p: p.get("dateSaved", ""), reverse=True)
    live_picks = live_picks[:200]
    logger.info("[top-flow] Snapshot: %d live (capped 200) of %d total active picks.", len(live_picks), len(active))

    if not live_picks:
        return {"status": "skipped", "reason": "all picks expired"}

    saved = 0
    skipped = 0
    errors = 0
    CHUNK = 50

    for ci in range(0, len(live_picks), CHUNK):
        chunk = live_picks[ci:ci + CHUNK]
        batch = [
            {
                "symbol": p["sym"],
                "cp": p["cp"],
                "strike": p["strike"],
                "expDate": _exp_to_iso(p["exp"]),
            }
            for p in chunk
        ]

        try:
            quotes = await get_batch_option_quotes(batch)
        except Exception as e:
            logger.error("[top-flow] Schwab chunk %d failed: %s", ci // CHUNK, e)
            errors += len(chunk)
            continue

        for pick, q in zip(chunk, quotes):
            if not q or q.get("error") or q.get("expired"):
                skipped += 1
                continue

            price = q.get("mark") or q.get("last") or 0
            oi = q.get("openInterest") or q.get("open_interest") or 0
            spot = q.get("underlyingPrice") or q.get("spot") or 0
            volume = q.get("volume") or 0

            history = pick.setdefault("history", [])
            entry = {
                "date": today_str,
                "price": price,
                "oi": oi,
                "spot": spot,
                "volume": volume,
            }

            # Overwrite today's entry if exists (idempotent)
            existing_idx = next((i for i, h in enumerate(history) if h.get("date") == today_str), None)
            if existing_idx is not None:
                history[existing_idx] = entry
            else:
                history.append(entry)
            saved += 1

        # Small delay between chunks to stay under rate limits
        if ci + CHUNK < len(live_picks):
            await _aio.sleep(2)

    if saved:
        _save()

    result = {
        "status": "ok",
        "date": today_str,
        "saved": saved,
        "skipped": skipped,
        "errors": errors,
        "live": len(live_picks),
        "total": len(active),
    }
    logger.info("[top-flow] Snapshot complete: %s", result)
    return result


# ─── Migrate Entry Prices (one-shot bug fix) ────────────────────────────────
# Background: an earlier version of OptionsFlow.jsx's toTracker() stored
# entry = item.entrySpot (the underlying STOCK price) instead of the option
# contract's price. That made the Tracker show -97% P/L on every row because
# `now` reads the contract mark (~$12.50) while `entry` was the spot (~$590).
#
# This migration looks at every active pick whose `entry` value is suspiciously
# stock-like (above STOCK_PRICE_THRESHOLD by default) and replaces it with the
# contract's actual price near dateSaved, sourced in this order:
#   1. The pick's own history (closest snapshot to dateSaved, within window)
#   2. daily_tracker.get_history() — system-wide snapshot store
#   3. daily_tracker.backfill_contract() — Polygon-backed deeper backfill
#
# Old (wrong) entry value is preserved as `entrySpot` for audit so we can
# always reconstruct what was there and re-run if logic changes.

STOCK_PRICE_THRESHOLD = 50.0   # entries above this are "looks like stock price"
SNAPSHOT_MAX_DAYS_DIFF = 7     # accept snapshots within ±N days of dateSaved


def _parse_mdy_date(date_str: str):
    """Parse 'M/D/YYYY' → date object. None on failure."""
    try:
        parts = date_str.strip().split("/")
        if len(parts) < 3:
            return None
        m, d, y = int(parts[0]), int(parts[1]), int(parts[2])
        if y < 100:
            y += 2000
        return date(y, m, d)
    except (ValueError, IndexError):
        return None


def _parse_iso_date(iso: str):
    """Parse 'YYYY-MM-DD' → date object. None on failure."""
    try:
        return date.fromisoformat(iso)
    except (ValueError, TypeError):
        return None


def _find_closest_price(history: list, target_date: date, max_days_diff: int = SNAPSHOT_MAX_DAYS_DIFF):
    """Find the price in history closest to target_date, within max_days_diff.
    Returns (price, snapshot_date_str) or (None, None) if nothing close enough.
    History entries: {date: 'M/D/YYYY', price: float, ...}
    Prefers same-day or just-after-target_date over just-before (because the
    snapshot at end-of-day captures the trading day's actual close)."""
    if not history or target_date is None:
        return None, None
    best_price = None
    best_date_str = None
    best_diff = None
    for h in history:
        h_date = _parse_mdy_date(h.get("date", ""))
        if h_date is None:
            continue
        price = h.get("price", 0)
        try:
            price = float(price)
        except (TypeError, ValueError):
            continue
        if price <= 0:
            continue
        diff = abs((h_date - target_date).days)
        if diff > max_days_diff:
            continue
        # Tie-breaker: prefer same-day, then just-after (next snapshot captures
        # the entry-day mark), then just-before
        if best_diff is None or diff < best_diff:
            best_diff = diff
            best_price = price
            best_date_str = h.get("date")
    return best_price, best_date_str


async def _find_entry_price_for_pick(pick: dict, allow_backfill: bool = True) -> tuple:
    """Locate a contract-price candidate for a pick near its dateSaved.
    Returns (price, source, snapshot_date) — source is one of
    'pick_history', 'daily_tracker', 'backfill', or None.
    """
    target = _parse_iso_date(pick.get("dateSaved", ""))
    if target is None:
        return None, None, None

    # Source 1: the pick's own embedded history
    px, sdate = _find_closest_price(pick.get("history", []), target)
    if px is not None:
        return px, "pick_history", sdate

    sym = pick.get("sym")
    cp = pick.get("cp")
    strike = pick.get("strike")
    exp = pick.get("exp")
    if not (sym and cp and strike and exp):
        return None, None, None

    # Source 2: the system-wide daily_tracker store
    try:
        from api.daily_tracker import get_history as _dt_history
        dt_hist = _dt_history(sym, cp, strike, exp)
        px, sdate = _find_closest_price(dt_hist or [], target)
        if px is not None:
            return px, "daily_tracker", sdate
    except Exception as e:
        logger.warning("[top-flow migrate] daily_tracker.get_history failed for %s: %s", pick.get("id"), e)

    # Source 3: Polygon backfill (slowest, only if explicitly allowed)
    if allow_backfill:
        try:
            from api.daily_tracker import backfill_contract as _dt_backfill, get_history as _dt_history2
            # Backfill a generous window to be sure we cover dateSaved + buffer
            days_back = max(30, (date.today() - target).days + 14)
            await _dt_backfill(sym, cp, strike, exp, days_back)
            dt_hist = _dt_history2(sym, cp, strike, exp)
            px, sdate = _find_closest_price(dt_hist or [], target)
            if px is not None:
                return px, "backfill", sdate
        except Exception as e:
            logger.warning("[top-flow migrate] backfill_contract failed for %s: %s", pick.get("id"), e)

    return None, None, None


async def migrate_entries(
    dry_run: bool = True,
    max_picks: int | None = None,
    force: bool = False,
    allow_backfill: bool = True,
    threshold: float = STOCK_PRICE_THRESHOLD,
) -> dict:
    """
    One-shot migration: replace bogus stock-price `entry` values on active
    picks with the contract's actual price near dateSaved.

    Args:
        dry_run: if True (default), don't write anything — just report
        max_picks: limit how many picks to process this call (None = all)
        force: ignore the stock-price heuristic, try every pick
        allow_backfill: if True, fall back to Polygon backfill for picks
            without any local snapshot history near dateSaved
        threshold: entries above this are considered "looks like stock price"

    Returns a structured report including a sample of changes.
    """
    active = _data.get("active", [])
    if not active:
        return {"status": "ok", "examined": 0, "fixed": 0, "skipped": 0,
                "errors": 0, "dry_run": dry_run, "changes": []}

    examined = 0
    fixed = 0
    skipped_already_ok = 0
    skipped_no_data = 0
    errors = 0
    changes = []

    for pick in active:
        if max_picks is not None and examined >= max_picks:
            break
        examined += 1
        old_entry = pick.get("entry", 0)
        try:
            old_entry = float(old_entry)
        except (TypeError, ValueError):
            old_entry = 0

        # Skip if entry already looks like a contract price (unless force=True)
        if not force and old_entry < threshold:
            skipped_already_ok += 1
            continue

        try:
            new_price, source, snap_date = await _find_entry_price_for_pick(pick, allow_backfill=allow_backfill)
        except Exception as e:
            errors += 1
            logger.error("[top-flow migrate] lookup failed for %s: %s", pick.get("id"), e)
            continue

        if new_price is None or new_price <= 0:
            skipped_no_data += 1
            changes.append({
                "id": pick.get("id"),
                "action": "skip_no_data",
                "old_entry": old_entry,
            })
            continue

        # Sanity check: new contract price should be much smaller than the
        # stock-price entry. If they're similar, the heuristic may be wrong —
        # don't trash a possibly-correct entry.
        if not force and new_price > old_entry * 0.5:
            skipped_already_ok += 1
            changes.append({
                "id": pick.get("id"),
                "action": "skip_too_close",
                "old_entry": old_entry,
                "candidate": new_price,
                "source": source,
            })
            continue

        change_record = {
            "id": pick.get("id"),
            "action": "fix",
            "old_entry": old_entry,
            "new_entry": new_price,
            "source": source,
            "snapshot_date": snap_date,
            "dateSaved": pick.get("dateSaved"),
        }
        changes.append(change_record)

        if not dry_run:
            pick["entrySpot"] = old_entry      # preserve old value for audit
            pick["entry"] = new_price
            pick["_migrated"] = {
                "at": datetime.now(ET).strftime("%Y-%m-%d %H:%M:%S"),
                "source": source,
                "old_entry": old_entry,
            }
            fixed += 1

    if fixed and not dry_run:
        _save()

    return {
        "status": "ok",
        "dry_run": dry_run,
        "examined": examined,
        "fixed": fixed,
        "would_fix": sum(1 for c in changes if c["action"] == "fix") if dry_run else 0,
        "skipped_already_ok": skipped_already_ok,
        "skipped_no_data": skipped_no_data,
        "errors": errors,
        "active_total": len(active),
        "remaining": max(0, len(active) - examined),
        "changes": changes[:100],   # cap to keep response readable
    }


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
