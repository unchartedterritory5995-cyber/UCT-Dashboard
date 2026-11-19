"""
daily_tracker.py — Daily OI/price snapshot system for options flow dashboard.

Storage layout in /data/contract_history.json:
{
  "registered": [
    {"sym":"AAPL","cp":"C","K":200,"exp":"3/20","grade":"A+","dir":"BULL", ...},
    ...
  ],
  "snapshots": {
    "AAPL|C|200.0|3/20": [
      {"date":"3/14/2026","oi":5000,"price":2.50,"spot":198.0,"volume":1234,"src":"massive"},
      ...
    ],
    ...
  }
}

Registered contracts are replaced each time the dashboard loads new flow data.
Snapshots accumulate across days — one entry per trading day per contract.
The cron job runs at 4:30 PM ET Monday–Friday (after close).

Where a day's entry comes from: Massive, the licensed options feed (since
2026-11-17, when Schwab was retired from the product by the owner's instruction;
each entry written since carries `src: "massive"`). An entry with no `src` was
recorded from Schwab, or merged from the Polygon backfill below, and stays as
recorded. What `price` means differs slightly between the two (Schwab: its mark,
else its last trade; Massive: the bid/ask midpoint, else the last trade); see
`top_flow_tracker._massive_entry`, which builds the entry for both recorders.
"""

import asyncio
import json
import logging
import os
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

logger = logging.getLogger(__name__)

# `CONTRACT_HISTORY_FILE` is the override; its DEFAULT is the literal that
# has always been here, so production with nothing set is unchanged.
HISTORY_FILE = os.environ.get(
    "CONTRACT_HISTORY_FILE", "/data/contract_history.json")
ET = ZoneInfo("America/New_York")

# ─── In-memory state ──────────────────────────────────────────────────────────

_data: dict = {"registered": [], "snapshots": {}}
_scheduler_task: asyncio.Task | None = None


# ─── Persistence ──────────────────────────────────────────────────────────────

def _load() -> None:
    """Load history file into memory. Safe to call at startup."""
    global _data
    if not os.path.exists(HISTORY_FILE):
        logger.info("[tracker] No history file found at %s — starting fresh.", HISTORY_FILE)
        _data = {"registered": [], "snapshots": {}}
        return
    try:
        with open(HISTORY_FILE, encoding="utf-8") as f:
            _data = json.load(f)
        # Ensure both keys exist even on old files
        _data.setdefault("registered", [])
        _data.setdefault("snapshots", {})
        logger.info(
            "[tracker] Loaded history: %d registered, %d contracts with history.",
            len(_data["registered"]),
            len(_data["snapshots"]),
        )
    except Exception as e:
        logger.error("[tracker] Failed to load history file: %s — starting fresh.", e)
        _data = {"registered": [], "snapshots": {}}


def _save() -> None:
    """Write current state to disk."""
    try:
        os.makedirs(os.path.dirname(HISTORY_FILE), exist_ok=True)
        tmp = HISTORY_FILE + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(_data, f, separators=(",", ":"))
        os.replace(tmp, HISTORY_FILE)
    except Exception as e:
        logger.error("[tracker] Failed to save history file: %s", e)


# ─── Contract Key ──────────────────────────────────────────────────────────────

def _key(sym: str, cp: str, strike: float | int | str, exp: str) -> str:
    """Canonical key: 'AAPL|C|200.0|3/20'"""
    return f"{sym.upper()}|{cp.upper()}|{float(strike)}|{exp}"


# ─── Public API ───────────────────────────────────────────────────────────────

def register_contracts(conv_list: list[dict]) -> int:
    """
    Replace the registered contract list with CONV data from the dashboard.
    Each item in conv_list should have: sym, cp, K (strike), exp, grade, dir, hits, prem.
    Returns the number of contracts registered.
    """
    _data["registered"] = [
        {
            "sym": c.get("sym", ""),
            "cp": c.get("cp", ""),
            "K": float(c.get("K", 0)),
            "exp": c.get("exp", ""),
            "grade": c.get("grade", ""),
            "dir": c.get("dir", ""),
            "hits": c.get("hits", 0),
            "prem": c.get("prem", 0),
        }
        for c in conv_list
        if c.get("sym") and c.get("cp") and c.get("K") and c.get("exp")
    ]
    _save()
    logger.info("[tracker] Registered %d contracts for daily tracking.", len(_data["registered"]))
    return len(_data["registered"])


def get_registered() -> list[dict]:
    """Return current registered contract list."""
    return list(_data.get("registered", []))


def get_history(sym: str, cp: str, strike: float | str, exp: str) -> list[dict]:
    """Return all snapshots for a single contract, oldest first."""
    k = _key(sym, cp, strike, exp)
    return list(_data.get("snapshots", {}).get(k, []))


def get_all_history() -> dict:
    """Return the full snapshots dict keyed by contract key."""
    return dict(_data.get("snapshots", {}))


# ─── Snapshot Logic ───────────────────────────────────────────────────────────

# How many registered contracts are priced per run: the first 200, in the order
# the dashboard registered them. The Schwab read this replaces made one chain
# call per SYMBOL; Massive makes one small call per CONTRACT (at most 8 at once),
# so the list is capped, with the same cap the Flow Record sweep uses. A contract
# past the cap gets no entry that day.
SNAPSHOT_CAP = 200


def _expiry_date(exp_str):
    """A registered expiry ('M/D', 'M/D/YY' or 'M/D/YYYY') as a date, or None.
    A year-less expiry is this year, or next year when that date has already
    passed: the rule this recorder has always used."""
    from datetime import date
    parts = str(exp_str or "").split("/")
    if len(parts) < 2:
        return None
    try:
        m, d = int(parts[0]), int(parts[1])
        if len(parts) >= 3:
            y = int(parts[2])
            if y < 100:
                y += 2000
            return date(y, m, d)
        y = datetime.now().year
        if date(y, m, d) < date.today():
            y += 1
        return date(y, m, d)
    except (ValueError, TypeError):
        return None


async def store_daily_snapshot() -> dict:
    """
    Record today's quote for the registered contracts, from Massive, and append
    it to each contract's history.
    One entry per contract per date — idempotent (re-running today just overwrites today's row).
    A contract Massive has no price for gets no entry: its history is left as it is.
    Never raises: a failure is returned as {"status": "error"}.
    Returns a summary dict.
    """
    try:
        return await _store_daily_snapshot()
    except Exception as e:  # noqa: BLE001 - never raise into the scheduler loop
        logger.error("[tracker] Snapshot failed: %s", type(e).__name__)
        return {"status": "error", "reason": type(e).__name__}


async def _store_daily_snapshot() -> dict:
    contracts = _data.get("registered", [])
    if not contracts:
        logger.info("[tracker] snapshot-now: no registered contracts, skipping.")
        return {"status": "skipped", "reason": "no registered contracts"}

    from api import massive_oi_snapshots as massive
    from api import top_flow_tracker as tft
    if not massive.MASSIVE_API_KEY:
        return {"status": "error", "reason": "MASSIVE_API_KEY not set"}

    today_str = tft._et_date_str()  # e.g. "3/14/2026"
    todo = contracts[:SNAPSHOT_CAP]
    logger.info("[tracker] Fetching quotes for %d contracts via Massive…", len(todo))

    saved = 0
    failed = 0
    snapshots = _data.setdefault("snapshots", {})

    try:
        for ci in range(0, len(todo), tft.SNAPSHOT_CHUNK):
            chunk = todo[ci:ci + tft.SNAPSHOT_CHUNK]
            # the shape top_flow_tracker's Massive read takes: sym / cp / strike + an expiry date
            asked = [{"sym": c.get("sym"), "cp": c.get("cp"), "strike": c.get("K")} for c in chunk]
            expiries = [_expiry_date(c.get("exp")) for c in chunk]
            priced, ok = await tft._massive_chunk(asked, expiries, today_str)
            if not ok:
                failed += len(chunk)
            for i, e in priced.items():
                c = chunk[i]
                k = _key(c["sym"], c["cp"], c["K"], c["exp"])
                history = snapshots.setdefault(k, [])
                # The stored keys are the ones this file has always written, plus `src`.
                # A field Massive did not send is null, never 0.
                entry = {
                    "date": today_str,
                    "oi": e.get("oi"),
                    "price": e.get("price"),
                    "spot": e.get("spot"),
                    "volume": e.get("volume"),
                    "src": "massive",
                }
                # Overwrite today's entry if it already exists (idempotent)
                existing = next((j for j, h in enumerate(history) if h.get("date") == today_str), None)
                if existing is not None:
                    history[existing] = entry
                else:
                    history.append(entry)
                saved += 1
            if ci + tft.SNAPSHOT_CHUNK < len(todo):
                await asyncio.sleep(tft.SNAPSHOT_CHUNK_PAUSE_S)
    finally:
        # whatever was priced is kept, even if a later chunk fails
        if saved:
            _save()

    result = {
        "status": "ok",
        "source": "Massive",
        "date": today_str,
        "saved": saved,
        "skipped": len(contracts) - saved,
        "failed": failed,
        "total": len(contracts),
    }
    logger.info("[tracker] Snapshot complete: %s", result)
    return result


# ─── Scheduler ────────────────────────────────────────────────────────────────

async def _snapshot_loop() -> None:
    """Background task: fire store_daily_snapshot() every weekday at 4:30 PM ET."""
    logger.info("[tracker] Snapshot scheduler started.")
    while True:
        try:
            now = datetime.now(ET)
            # Target: next 4:30 PM ET on a weekday
            target = now.replace(hour=16, minute=30, second=0, microsecond=0)
            if now >= target or now.weekday() >= 5:
                # Already past 4:30 today, or it's the weekend — skip to next weekday
                from datetime import timedelta
                days_ahead = 1
                while True:
                    candidate = (now + timedelta(days=days_ahead)).replace(
                        hour=16, minute=30, second=0, microsecond=0
                    )
                    if candidate.weekday() < 5:  # Mon–Fri
                        target = candidate
                        break
                    days_ahead += 1

            wait_secs = (target - datetime.now(ET)).total_seconds()
            logger.info(
                "[tracker] Next snapshot at %s ET (%.0f seconds from now).",
                target.strftime("%Y-%m-%d %H:%M"),
                wait_secs,
            )
            await asyncio.sleep(max(wait_secs, 1))
            # Double-check it's still a weekday (handles DST edge cases)
            if datetime.now(ET).weekday() < 5:
                await store_daily_snapshot()
                # Also snapshot Top Flow tracker picks
                try:
                    from api.top_flow_tracker import snapshot_prices as _tf_snapshot
                    await _tf_snapshot()
                except Exception as e:
                    logger.error("[tracker] Top Flow snapshot error (non-fatal): %s", e)
        except asyncio.CancelledError:
            logger.info("[tracker] Snapshot scheduler stopped.")
            return
        except Exception as e:
            logger.error("[tracker] Scheduler error: %s — retrying in 60s.", e)
            await asyncio.sleep(60)


def start_snapshot_scheduler() -> None:
    """Call from lifespan startup. Loads history and starts the 4:30 PM cron."""
    global _scheduler_task
    _load()
    loop = asyncio.get_event_loop()
    _scheduler_task = loop.create_task(_snapshot_loop())
    logger.info("[tracker] Snapshot scheduler task created.")


def stop_snapshot_scheduler() -> None:
    """Call from lifespan shutdown."""
    global _scheduler_task
    if _scheduler_task and not _scheduler_task.done():
        _scheduler_task.cancel()
        logger.info("[tracker] Snapshot scheduler cancelled.")
    _scheduler_task = None


# ─── Polygon.io Backfill ──────────────────────────────────────────────────────

def _poly_ticker(sym: str, cp: str, strike: float, exp: str) -> str:
    """
    Build OCC-format Polygon options ticker.
    e.g. NVDA $200C exp 4/2/2026 → O:NVDA260402C00200000
    """
    parts = exp.split("/")
    m, d = int(parts[0]), int(parts[1])
    y = int(parts[2]) if len(parts) >= 3 else datetime.now().year
    if y >= 2000:
        y -= 2000
    strike_int = round(float(strike) * 1000)
    return (
        f"O:{sym.upper()}"
        f"{y:02d}{m:02d}{d:02d}"
        f"{cp.upper()}"
        f"{strike_int:08d}"
    )


async def backfill_contract(
    sym: str,
    cp: str,
    strike: float,
    exp: str,
    days_back: int = 60,
) -> dict:
    """
    Fetch daily volume + close price from Polygon.io for a single contract
    going back `days_back` calendar days. Merges into contract_history.json
    without overwriting existing OI data from the daily tracker.

    Polygon free tier: 15-min delayed, 5 calls/min, unlimited history.
    Set POLYGON_API_KEY env var (free at https://polygon.io).

    Returns summary dict.
    """
    import httpx
    from datetime import date, timedelta

    api_key = os.getenv("POLYGON_API_KEY", "")
    if not api_key:
        return {"status": "error", "reason": "POLYGON_API_KEY env var not set"}

    ticker = _poly_ticker(sym, cp, strike, exp)
    today = date.today()
    from_date = (today - timedelta(days=days_back)).strftime("%Y-%m-%d")
    to_date = today.strftime("%Y-%m-%d")

    url = f"https://api.polygon.io/v2/aggs/ticker/{ticker}/range/1/day/{from_date}/{to_date}"
    params = {"adjusted": "true", "sort": "asc", "limit": 120, "apiKey": api_key}

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(url, params=params)
        if resp.status_code == 404:
            return {"status": "error", "reason": f"Contract not found on Polygon: {ticker}"}
        if resp.status_code == 403:
            return {"status": "error", "reason": "Invalid Polygon API key"}
        if resp.status_code != 200:
            return {"status": "error", "reason": f"Polygon HTTP {resp.status_code}"}
        data = resp.json()
    except Exception as e:
        return {"status": "error", "reason": str(e)}

    results = data.get("results", [])
    if not results:
        return {"status": "ok", "merged": 0, "reason": "No Polygon data for this contract/date range"}

    k = _key(sym, cp, strike, exp)
    snapshots = _data.setdefault("snapshots", {})
    history = snapshots.setdefault(k, [])

    # Build lookup of existing entries by date so we can merge without clobbering OI
    existing_by_date = {h["date"]: h for h in history}

    merged = 0
    for bar in results:
        # Polygon timestamp is milliseconds UTC — convert to M/D/YYYY ET
        ts_ms = bar.get("t", 0)
        dt_utc = datetime.utcfromtimestamp(ts_ms / 1000)
        # Use ET date (subtract 4h for EDT, good enough for end-of-day bars)
        dt_et = dt_utc.replace(tzinfo=timezone.utc).astimezone(ET)

        # Skip weekends — no real options trading on Sat/Sun
        if dt_et.weekday() >= 5:
            continue

        date_str = f"{dt_et.month}/{dt_et.day}/{dt_et.year}"

        volume = int(bar.get("v", 0))
        close_price = float(bar.get("c", 0))

        if date_str in existing_by_date:
            # Merge: update volume and price only — preserve existing OI from tracker
            existing_by_date[date_str]["volume"] = volume
            if close_price > 0:
                existing_by_date[date_str]["price"] = close_price
        else:
            # New entry — OI unknown (0 means "not yet tracked", not "zero OI")
            existing_by_date[date_str] = {
                "date": date_str,
                "oi": 0,
                "price": close_price,
                "spot": 0,
                "volume": volume,
            }
        merged += 1

    # Rebuild history list sorted by date
    def _sort_key(h):
        parts = h["date"].split("/")
        return (int(parts[2]) if len(parts) >= 3 else 2026,
                int(parts[0]), int(parts[1]))

    snapshots[k] = sorted(existing_by_date.values(), key=_sort_key)
    _save()

    logger.info("[tracker] Polygon backfill for %s: %d days merged.", ticker, merged)
    return {"status": "ok", "ticker": ticker, "merged": merged, "from": from_date, "to": to_date}


async def backfill_all_registered(days_back: int = 60) -> dict:
    """Backfill Polygon history for all currently registered contracts."""
    contracts = _data.get("registered", [])
    if not contracts:
        return {"status": "skipped", "reason": "no registered contracts"}

    results = []
    for c in contracts:
        r = await backfill_contract(c["sym"], c["cp"], c["K"], c["exp"], days_back)
        results.append({**r, "sym": c["sym"], "exp": c["exp"]})
        # Polygon free tier: 5 req/min — add small delay between calls
        await asyncio.sleep(13)

    ok = sum(1 for r in results if r.get("status") == "ok")
    return {"status": "ok", "total": len(contracts), "succeeded": ok, "results": results}
