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
      "history": [ {"date":"3/15/2026","price":5.50,"oi":1200,"spot":198.0,
                    "volume":null,"src":"massive"} ]
    }
  ],
  "archived": [...]
}

Where the daily prices come from: Massive, the licensed options feed, and nothing
else (owner, 2026-11-17: "Move Flow Record to Massive", then the same day "Move
it, fix the status and remove schwab from everything"). Each history entry
written since says so in `src` ("massive"). An entry with `src: "schwab"`, or
with no `src` at all, was recorded from Schwab before that and stays as
recorded: past entries are never rewritten. A pick Massive has no price for gets
no entry that day.
"""

import asyncio
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

# ─── Snapshot pacing ──────────────────────────────────────────────────────────
# The daily price recording reads Massive only (see the module docstring). The
# switch that used to choose the source, TOP_FLOW_SNAPSHOT_SOURCE, was retired on
# 2026-11-17 with the Schwab backup it selected; a value left on Railway is inert
# (docs/feature_flags.json, `retired`).
#
# Vendor pacing. The cap, the chunk and the pause are the ones this sweep has
# always had. Within a chunk Massive makes one small single-contract call per
# pick, at most massive_oi_snapshots.MAX_CONCURRENCY (8) at once.
SNAPSHOT_CAP = 200              # newest open picks priced per run
SNAPSHOT_CHUNK = 50             # picks per vendor batch
SNAPSHOT_CHUNK_PAUSE_S = 2      # pause between batches
# One Massive chunk is at most 50 calls of <= 12 s, 8 at a time: ~84 s worst case.
# The sweep is single-flight, so a vendor call that never returned would otherwise
# block every later sweep. A timed-out chunk is counted as failed.
MASSIVE_CHUNK_TIMEOUT_S = 120

# One sweep at a time, whoever starts it (the 4:30 PM scheduler or the manual
# route). Per process: the web pod is one process.
_snapshot_running = False


def snapshot_in_flight() -> bool:
    return _snapshot_running


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


# ─── Expiry dates ─────────────────────────────────────────────────────────────

def _saved_date(pick: dict):
    """The pick's `dateSaved` as a date ('YYYY-MM-DD' or 'M/D/YYYY'), or None."""
    raw = str(pick.get("dateSaved") or "").strip()
    if not raw:
        return None
    return _parse_iso_date(raw[:10]) if "-" in raw else _parse_mdy_date(raw)


def resolve_expiry(exp_str, saved=None, today=None):
    """A stored expiry ('M/D/YYYY', 'M/D/YY' or the year-less 'M/D') as a date.

    A year-less expiry carries no year, so one has to be chosen. A contract
    cannot expire before it was flagged, so it is the first M/D on or after the
    day the pick was saved: "1/15" saved 2026-11-17 is 2027-01-15.
    ⚰️ Until 2026-11-17 archive_expired() and the snapshot's own expiry test read
    a year-less expiry as THIS calendar year, so that January contract was
    archived as expired the day it was saved, and a December contract still
    active in January would have been kept another year.

    With no usable save date the old reading (this calendar year) is kept: there
    is nothing better to anchor on. None when the string is not a date.
    """
    parts = str(exp_str or "").strip().split("/")
    if len(parts) < 2:
        return None
    try:
        m, d = int(parts[0]), int(parts[1])
        if len(parts) >= 3:
            y = int(parts[2])
            return date(y + 2000 if y < 100 else y, m, d)
        if saved is None:
            return date((today or date.today()).year, m, d)
    except (ValueError, TypeError):
        return None
    for y in range(saved.year, saved.year + 9):     # 9 years spans any gap to a Feb 29
        try:
            candidate = date(y, m, d)
        except ValueError:
            continue
        if candidate >= saved:
            return candidate
    return None


def _pick_expiry(pick: dict, today=None):
    return resolve_expiry(pick.get("exp", ""), _saved_date(pick), today)


# ─── Daily Snapshot (called by daily_tracker at 4:30 PM ET) ──────────────────

def _et_date_str() -> str:
    now = datetime.now(ET)
    return f"{now.month}/{now.day}/{now.year}"      # 'M/D/YYYY', no leading zeros


def _positive(v):
    """v as a float when it is a real positive number, else None."""
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if f > 0 else None


def _massive_entry(fields, today_str: str):
    """One history entry from a Massive single-contract snapshot, or None when it
    carries no usable price (nothing is then written for the pick).

    THE ONE DIFFERENCE IN WHAT `price` MEANS between these entries and the ones
    recorded from Schwab before 2026-11-17:
      Schwab  = `mark or last`: Schwab's own mark, else its last trade.
      Massive = the bid/ask midpoint, else the last trade.
    Both are the option contract's price per share at the time of the run.
    `oi`, `spot` and `volume` (the session's contract volume) mean the same
    from either. A field Massive did not send is null, never 0: a 0 `volume`
    would read as "nothing traded" and a 0 `oi` as "no open interest". Every
    reader treats null as "no reading".
    """
    if not isinstance(fields, dict):
        return None
    price = _positive(fields.get("mid")) or _positive(fields.get("last"))
    if price is None:
        return None
    price = round(price, 4)
    oi = fields.get("oi")
    return {
        "date": today_str,
        "price": price,
        "oi": oi if isinstance(oi, int) and not isinstance(oi, bool) and oi >= 0 else None,
        "spot": _positive(fields.get("underlying")),
        "volume": _whole(fields.get("volume")),
        "src": "massive",
    }


def _whole(v):
    """v as a non-negative int, else None (a missing volume is null, never 0)."""
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return int(f) if f >= 0 else None


async def _massive_entries(chunk: list, expiries: list, today_str: str) -> dict:
    """{index in chunk: history entry} for the picks Massive priced; {} when the
    read failed. See `_massive_chunk`."""
    return (await _massive_chunk(chunk, expiries, today_str))[0]


async def _massive_chunk(chunk: list, expiries: list, today_str: str) -> tuple:
    """({index in chunk: history entry}, ok) for one batch of contracts. `ok` is
    False when Massive has no key, raises, or times out: nothing is written for
    that batch and the caller counts it as failed. A contract Massive simply has
    no price for is absent from the dict with `ok` True.
    Uses the helper's own batching (one single-contract snapshot per contract,
    bounded by its MAX_CONCURRENCY). Never raises. Shared with
    api/daily_tracker.py (the contract-history recorder)."""
    try:
        from api import massive_oi_snapshots as massive
        from api.massive_oi_snapshots import _fetch_fields_all_async, _contract_key
        if not massive.MASSIVE_API_KEY:
            logger.warning("[top-flow] Massive key not set; nothing can be priced.")
            return {}, False
        keys = {}       # index -> the helper's contract key
        batch = []
        for i, (pick, exp) in enumerate(zip(chunk, expiries)):
            sym = str(pick.get("sym") or "").upper().strip()
            cp = str(pick.get("cp") or "").upper().strip()[:1]
            strike = _positive(pick.get("strike"))
            if not sym or cp not in ("C", "P") or strike is None or exp is None:
                continue
            exp_mdy = f"{exp.month}/{exp.day}/{exp.year}"    # the 'M/D/YYYY' the helper wants
            keys[i] = _contract_key(sym, cp, strike, exp_mdy)
            batch.append((sym, cp, strike, exp_mdy))
        if not batch:
            return {}, True
        fmap = await asyncio.wait_for(_fetch_fields_all_async(batch), timeout=MASSIVE_CHUNK_TIMEOUT_S)
        out = {}
        for i, key in keys.items():
            entry = _massive_entry((fmap or {}).get(key), today_str)
            if entry is not None:
                out[i] = entry
        return out, True
    except Exception as e:  # noqa: BLE001 - a Massive failure writes nothing; it never raises
        logger.warning("[top-flow] Massive chunk failed (%s); nothing written for it.", type(e).__name__)
        return {}, False


def _write_entry(pick: dict, entry: dict) -> None:
    """Record today's entry: overwrite the same day's entry, else append."""
    history = pick.setdefault("history", [])
    idx = next((i for i, h in enumerate(history) if h.get("date") == entry["date"]), None)
    if idx is not None:
        history[idx] = entry
    else:
        history.append(entry)


async def snapshot_prices() -> dict:
    """
    Record today's price + OI for the open picks, from Massive.
    Called by daily_tracker at 4:30 PM ET, or manually via /api/top-flow/snapshot.
    One sweep at a time; a second call while one runs returns at once.
    Never raises: a failure is returned as {"status": "error"}.
    """
    global _snapshot_running
    if _snapshot_running:
        return {"status": "skipped", "reason": "a snapshot is already running"}
    _snapshot_running = True
    try:
        return await _snapshot_prices()
    except Exception as e:  # noqa: BLE001 - never raise into the scheduler loop
        logger.error("[top-flow] Snapshot failed: %s", type(e).__name__)
        return {"status": "error", "reason": type(e).__name__}
    finally:
        _snapshot_running = False


async def _snapshot_prices() -> dict:
    active = _data.get("active", [])
    if not active:
        return {"status": "skipped", "reason": "no active picks"}

    # Auto-archive expired picks first
    archived = archive_expired()
    if archived:
        active = _data.get("active", [])
        logger.info("[top-flow] Auto-archived %d expired picks before snapshot.", archived)

    today = date.today()
    today_str = _et_date_str()

    # Filter to non-expired only, cap at SNAPSHOT_CAP most recent by dateSaved.
    # A pick whose expiry cannot be read is kept (as before) and simply not priced.
    live_picks = []
    for p in active:
        exp = _pick_expiry(p, today)
        if exp is None or exp >= today:
            live_picks.append((p, exp))
    live_picks.sort(key=lambda t: str(t[0].get("dateSaved") or ""), reverse=True)
    live_picks = live_picks[:SNAPSHOT_CAP]
    logger.info("[top-flow] Snapshot (massive): %d live (capped %d) of %d total active picks.",
                len(live_picks), SNAPSHOT_CAP, len(active))

    if not live_picks:
        return {"status": "skipped", "reason": "all picks expired"}

    from api import massive_oi_snapshots as massive
    if not massive.MASSIVE_API_KEY:
        # No source can price anything: say so, and leave every history as it is.
        return {"status": "error", "reason": "MASSIVE_API_KEY not set"}

    saved = 0
    skipped = 0
    errors = 0

    try:
        for ci in range(0, len(live_picks), SNAPSHOT_CHUNK):
            pairs = live_picks[ci:ci + SNAPSHOT_CHUNK]
            chunk = [p for p, _ in pairs]
            expiries = [e for _, e in pairs]

            priced, ok = await _massive_chunk(chunk, expiries, today_str)
            for i, entry in priced.items():
                # Overwrites today's entry if it exists (idempotent)
                _write_entry(chunk[i], entry)
                saved += 1
            if ok:
                skipped += len(chunk) - len(priced)   # Massive has no price: nothing is written
            else:
                errors += len(chunk)                  # the read failed: nothing is written

            # Small delay between chunks to stay under rate limits
            if ci + SNAPSHOT_CHUNK < len(live_picks):
                await asyncio.sleep(SNAPSHOT_CHUNK_PAUSE_S)
    finally:
        # whatever was priced is kept, even if a later chunk fails
        if saved:
            _save()

    result = {
        "status": "ok",
        "date": today_str,
        "source": "massive",
        "saved": saved,
        "by_source": {"massive": saved},
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
        # A year-less expiry ("1/15") takes its year from the pick's save date,
        # never from today's: see resolve_expiry.
        exp_date = _pick_expiry(pick, today)
        if exp_date is None:
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
