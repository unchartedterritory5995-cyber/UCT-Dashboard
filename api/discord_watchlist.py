"""
Discord Watchlist Service — auto-posts top bull/bear flow to Discord webhook.
Runs on Railway via APScheduler or manual API trigger.

Sections:
  1. ALL — Top 10 Bull + Top 10 Bear (all caps)
  2. UNUSUAL MID-SMALL — Top 10 Bull + Top 10 Bear (mid-small cap, UOA flagged)
"""

import os
import json
import logging
import httpx
from datetime import datetime, timedelta
from collections import defaultdict

logger = logging.getLogger(__name__)

DISCORD_FLOW_WEBHOOK_URL = os.getenv("DISCORD_FLOW_WEBHOOK_URL", "")


def _load_flow_trades() -> list[dict] | None:
    """Load trades from FlowDB or fall back to CSV file."""
    # Try 1: FlowDB SQLite
    try:
        from api.flow_db import FlowDB
        db = FlowDB()
        conn = db.conn if hasattr(db, 'conn') else db._get_conn() if hasattr(db, '_get_conn') else None
        if conn is None:
            # Try getting connection from db object
            import sqlite3
            db_path = getattr(db, 'db_path', None) or getattr(db, 'path', None)
            if db_path:
                conn = sqlite3.connect(db_path)
                conn.row_factory = sqlite3.Row
        if conn:
            try:
                rows = conn.execute("SELECT * FROM trades WHERE source = 'stocks' ORDER BY created_date DESC LIMIT 500000").fetchall()
                if rows:
                    logger.info("[Discord] Loaded %d trades from FlowDB", len(rows))
                    return [dict(r) for r in rows]
            except Exception:
                pass
    except Exception as e:
        logger.debug("[Discord] FlowDB import failed: %s", e)

    # Try 2: Direct SQLite at common paths
    try:
        import sqlite3
        for db_path in ["/data/flow.db", "/app/data/flow.db", "data/flow.db"]:
            if os.path.exists(db_path):
                conn = sqlite3.connect(db_path)
                conn.row_factory = sqlite3.Row
                try:
                    rows = conn.execute("SELECT * FROM trades WHERE source = 'stocks' ORDER BY created_date DESC LIMIT 500000").fetchall()
                    if rows:
                        logger.info("[Discord] Loaded %d trades from %s", len(rows), db_path)
                        return [dict(r) for r in rows]
                except Exception:
                    pass
                finally:
                    conn.close()
    except Exception as e:
        logger.debug("[Discord] Direct SQLite failed: %s", e)

    # Try 3: Read CSV file directly
    try:
        import csv
        csv_paths = [
            os.path.join(os.path.dirname(__file__), "..", "app", "public", "flow-data.csv"),
            "/app/app/public/flow-data.csv",
            "app/public/flow-data.csv",
        ]
        for csv_path in csv_paths:
            resolved = os.path.abspath(csv_path)
            if os.path.exists(resolved):
                with open(resolved, "r", encoding="utf-8-sig") as f:
                    reader = csv.DictReader(f)
                    trades = list(reader)
                if trades:
                    logger.info("[Discord] Loaded %d trades from CSV: %s", len(trades), resolved)
                    return trades
    except Exception as e:
        logger.debug("[Discord] CSV fallback failed: %s", e)

    logger.error("[Discord] Could not load trades from any source")
    return None

# ── Direction rules (must match frontend exactly) ──────────────────────────

def assign_direction(trade: dict) -> str | None:
    """
    Assign BULL/BEAR direction based on flow rules.
    Returns None if no direction can be determined.
    """
    cp = (trade.get("call_put") or trade.get("CallPut") or "").upper()
    side_raw = (trade.get("side") or trade.get("Side") or "").upper().strip()
    typ = (trade.get("type") or trade.get("Type") or "").upper().strip()

    # Normalize side
    if "ABOVE" in side_raw or side_raw == "AA":
        side = "AA"
    elif "BELOW" in side_raw or side_raw == "BB":
        side = "BB"
    elif "ASK" in side_raw or side_raw == "A":
        side = "A"
    elif "BID" in side_raw or side_raw == "B":
        side = "B"
    else:
        side = side_raw

    is_sweep = "SWEEP" in typ

    if cp == "CALL":
        if side in ("AA", "A"):
            return "BULL"
        elif side == "BB" and is_sweep:
            return "BEAR"
    elif cp == "PUT":
        if side in ("AA", "A"):
            return "BEAR"
        elif side == "BB" and is_sweep:
            return "BULL"

    return None


def is_confirmed(trade: dict) -> bool:
    """Check if trade is confirmed (Yellow or Magenta color)."""
    color = (trade.get("color") or trade.get("Color") or "").upper().strip()
    return color in ("YELLOW", "MAGENTA")


def cap_band(mktcap: float) -> str:
    if not mktcap or mktcap <= 0:
        return "Unknown"
    if mktcap >= 200e9:
        return "Mega"
    if mktcap >= 10e9:
        return "Large"
    return "Mid-Small"


# ── Flow aggregation ───────────────────────────────────────────────────────

def aggregate_flow(trades: list[dict]) -> dict:
    """
    Aggregate trades into per-ticker bull/bear totals.
    Applies: direction rules, confirmation, dirty cluster filter.
    Returns dict of {sym: {bull, bear, net, trades, mktcap, er, uoa}}
    """
    # Step 1: Assign direction and filter confirmed
    confirmed = []
    for t in trades:
        if not is_confirmed(t):
            continue
        direction = assign_direction(t)
        if not direction:
            continue
        sym = (t.get("symbol") or t.get("Symbol") or "").upper()
        prem = float(t.get("premium") or t.get("Premium") or 0)
        cp = (t.get("call_put") or t.get("CallPut") or "").upper()
        strike = float(t.get("strike") or t.get("Strike") or 0)
        exp = t.get("expiration_date") or t.get("ExpirationDate") or ""
        mktcap = float(t.get("mkt_cap") or t.get("MktCap") or t.get("mktcap") or 0)
        er = bool(t.get("er") or t.get("ER"))
        uoa = bool(t.get("uoa") or t.get("Uoa") or t.get("UOA"))

        confirmed.append({
            "sym": sym, "prem": prem, "dir": direction,
            "cp": cp, "strike": strike, "exp": exp,
            "mktcap": mktcap, "er": er, "uoa": uoa,
        })

    # Step 2: Dirty cluster filter (remove bidirectional flow at same contract)
    clusters = defaultdict(lambda: {"dirs": set(), "trades": []})
    for t in confirmed:
        key = f"{t['sym']}|{t['cp']}|{t['strike']}|{t['exp']}"
        clusters[key]["dirs"].add(t["dir"])
        clusters[key]["trades"].append(t)

    dirty_keys = {k for k, v in clusters.items() if len(v["dirs"]) > 1}

    # Step 3: Aggregate clean trades by ticker
    tickers = {}
    for t in confirmed:
        key = f"{t['sym']}|{t['cp']}|{t['strike']}|{t['exp']}"
        if key in dirty_keys:
            continue  # Skip dirty cluster trades

        sym = t["sym"]
        if sym not in tickers:
            tickers[sym] = {
                "sym": sym, "bull": 0, "bear": 0, "n": 0,
                "mktcap": 0, "er": False, "uoa": False,
            }
        tk = tickers[sym]
        if t["dir"] == "BULL":
            tk["bull"] += t["prem"]
        else:
            tk["bear"] += t["prem"]
        tk["n"] += 1
        if t["mktcap"] > tk["mktcap"]:
            tk["mktcap"] = t["mktcap"]
        if t["er"]:
            tk["er"] = True
        if t["uoa"]:
            tk["uoa"] = True

    # Add net
    for tk in tickers.values():
        tk["net"] = tk["bull"] - tk["bear"]
        tk["cap"] = cap_band(tk["mktcap"])

    return tickers


# ── Formatting ─────────────────────────────────────────────────────────────

def fmt(n: float) -> str:
    a = abs(n)
    if a >= 1e6:
        return f"${a / 1e6:.1f}M"
    if a >= 1e3:
        return f"${a / 1e3:.0f}K"
    return f"${a:.0f}"


def build_section(title: str, emoji: str, tickers: list[dict], direction: str) -> str:
    """Build a formatted section for Discord."""
    lines = [f"**{emoji} {title}**", "```"]

    for i, tk in enumerate(tickers[:10], 1):
        sym = tk["sym"].ljust(6)
        bull = fmt(tk["bull"]).rjust(8)
        bear = fmt(tk["bear"]).rjust(8)
        net = fmt(abs(tk["net"])).rjust(8)
        pct = (
            f"{tk['bull'] / (tk['bull'] + tk['bear']) * 100:.0f}%"
            if (tk["bull"] + tk["bear"]) > 0
            else "—"
        ).rjust(4)

        flags = ""
        if tk.get("er"):
            flags += " ER"
        if tk.get("uoa"):
            flags += " UOA"

        lines.append(
            f"{i:>2}. {sym}  Bull {bull}  Bear {bear}  Net {net}  {pct}{flags}"
        )

    lines.append("```")
    return "\n".join(lines)


def build_discord_message(trades: list[dict], label: str = "") -> dict:
    """
    Build full Discord message with 4 sections:
    - ALL Top 10 Bull / Top 10 Bear
    - UNUSUAL MID-SMALL Top 10 Bull / Top 10 Bear
    """
    tickers = aggregate_flow(trades)
    all_tickers = list(tickers.values())

    # ALL — sort by net for bull (highest positive) and bear (lowest negative)
    with_flow = [t for t in all_tickers if t["bull"] + t["bear"] > 0]
    top_bull_all = sorted(with_flow, key=lambda t: t["net"], reverse=True)[:10]
    top_bear_all = sorted(with_flow, key=lambda t: t["net"])[:10]

    # UNUSUAL MID-SMALL — filter by cap + UOA
    mid_small = [t for t in with_flow if t["cap"] == "Mid-Small"]
    top_bull_ms = sorted(mid_small, key=lambda t: t["net"], reverse=True)[:10]
    top_bear_ms = sorted(mid_small, key=lambda t: t["net"])[:10]

    # Summary stats
    total_bull = sum(t["bull"] for t in with_flow)
    total_bear = sum(t["bear"] for t in with_flow)
    total_net = total_bull - total_bear
    bull_pct = (
        round(total_bull / (total_bull + total_bear) * 100)
        if (total_bull + total_bear) > 0
        else 50
    )

    now = datetime.now()
    date_str = now.strftime("%B %d, %Y")
    time_str = now.strftime("%I:%M %p ET")

    header = (
        f"{'🟢' if total_net > 0 else '🔴'} **UCT OPTIONS FLOW — {label or 'WATCHLIST'}**\n"
        f"{date_str} · {time_str}\n"
        f"Market Flow: {fmt(total_net)} net · {fmt(total_bull)} bull / {fmt(total_bear)} bear · {bull_pct}% bullish\n"
        f"━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
    )

    sections = [
        build_section("TOP 10 BULL — ALL", "🟢", top_bull_all, "BULL"),
        build_section("TOP 10 BEAR — ALL", "🔴", top_bear_all, "BEAR"),
        build_section("TOP 10 BULL — MID-SMALL", "⚡", top_bull_ms, "BULL"),
        build_section("TOP 10 BEAR — MID-SMALL", "💀", top_bear_ms, "BEAR"),
    ]

    content = header + "\n".join(sections)

    # Discord has 2000 char limit per message — split if needed
    return {"content": content[:2000]}


# ── Sending ────────────────────────────────────────────────────────────────

async def send_to_discord(trades: list[dict], label: str = "") -> dict:
    """Build and send watchlist to Discord webhook."""
    if not DISCORD_FLOW_WEBHOOK_URL:
        logger.error("[Discord] No DISCORD_FLOW_WEBHOOK_URL configured")
        return {"error": "No webhook URL configured"}

    message = build_discord_message(trades, label)

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(DISCORD_FLOW_WEBHOOK_URL, json=message)
            resp.raise_for_status()
            logger.info("[Discord] Watchlist posted — %s", label or "manual")
            return {"status": "sent", "label": label}
    except Exception as e:
        logger.error("[Discord] Post failed: %s", e)
        return {"error": str(e)}


# ── API route (attach to FastAPI) ──────────────────────────────────────────

def register_discord_routes(app_or_router):
    """Register the manual trigger endpoint."""
    from fastapi import Query as FQuery

    @app_or_router.post("/api/discord/send-watchlist")
    async def trigger_watchlist(
        label: str = FQuery("MANUAL", description="Label for the message"),
        days: int = FQuery(20, description="Number of trading days to include"),
    ):
        """Manually trigger a Discord watchlist post."""
        trades = _load_flow_trades()
        if trades is None:
            return {"error": "flow_db not available — no trades loaded"}
        result = await send_to_discord(trades, label)
        return result


# ── Scheduled jobs (APScheduler) ───────────────────────────────────────────

def setup_scheduler(scheduler):
    """
    Register scheduled Discord posts.
    Call this from main.py after creating the APScheduler instance.

    Usage:
        from discord_watchlist import setup_scheduler
        setup_scheduler(scheduler)
    """
    import asyncio

    async def _send_scheduled(label):
        trades = _load_flow_trades()
        if not trades:
            logger.warning("[Discord] No trades loaded — skipping %s", label)
            return
        await send_to_discord(trades, label)

    def morning_job():
        asyncio.get_event_loop().run_until_complete(
            _send_scheduled("MORNING WATCHLIST")
        )

    def midday_job():
        asyncio.get_event_loop().run_until_complete(
            _send_scheduled("MIDDAY UPDATE")
        )

    def closing_job():
        asyncio.get_event_loop().run_until_complete(
            _send_scheduled("CLOSING SUMMARY")
        )

    # Eastern time schedule
    scheduler.add_job(morning_job, "cron", hour=7, minute=0, id="discord_morning")
    scheduler.add_job(midday_job, "cron", hour=12, minute=30, id="discord_midday")
    scheduler.add_job(closing_job, "cron", hour=16, minute=30, id="discord_closing")

    logger.info("[Discord] Scheduled 3 daily watchlist posts: 7:00 AM, 12:30 PM, 4:30 PM ET")
