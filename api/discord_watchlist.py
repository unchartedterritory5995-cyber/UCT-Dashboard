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
    Aggregate trades into per-ticker bull/bear totals with top contract.
    Applies: direction rules, confirmation, dirty cluster filter.
    Returns dict of {sym: {bull, bear, net, trades, mktcap, er, uoa, top_contract}}
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
        vol = int(float(t.get("volume") or t.get("Volume") or 0))
        oi = int(float(t.get("oi") or t.get("OI") or 0))
        mktcap = float(t.get("mkt_cap") or t.get("MktCap") or t.get("mktcap") or 0)
        er_raw = t.get("er") or t.get("ER") or ""
        er = er_raw is True or (isinstance(er_raw, str) and er_raw.strip().upper() in ("TRUE", "1", "YES", "Y"))
        uoa_raw = t.get("uoa") or t.get("Uoa") or t.get("UOA") or ""
        uoa = uoa_raw is True or (isinstance(uoa_raw, str) and uoa_raw.strip().upper() in ("TRUE", "1", "YES", "Y"))

        confirmed.append({
            "sym": sym, "prem": prem, "dir": direction,
            "cp": cp, "strike": strike, "exp": exp,
            "vol": vol, "oi": oi,
            "mktcap": mktcap, "er": er, "uoa": uoa,
        })

    # Step 2: Dirty cluster filter (remove bidirectional flow at same contract)
    clusters = defaultdict(lambda: {"dirs": set(), "trades": []})
    for t in confirmed:
        key = f"{t['sym']}|{t['cp']}|{t['strike']}|{t['exp']}"
        clusters[key]["dirs"].add(t["dir"])
        clusters[key]["trades"].append(t)

    dirty_keys = {k for k, v in clusters.items() if len(v["dirs"]) > 1}

    # Step 3: Aggregate clean trades by ticker + track contracts
    tickers = {}
    contracts = defaultdict(lambda: {"prem": 0, "hits": 0, "vol": 0, "oi": 0, "cp": "", "strike": 0, "exp": "", "dir": ""})
    
    for t in confirmed:
        key = f"{t['sym']}|{t['cp']}|{t['strike']}|{t['exp']}"
        if key in dirty_keys:
            continue

        sym = t["sym"]
        if sym not in tickers:
            tickers[sym] = {
                "sym": sym, "bull": 0, "bear": 0, "n": 0,
                "mktcap": 0, "er": False, "uoa": False,
                "top_contract": None,
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

        # Track contract-level aggregation
        ckey = f"{sym}|{t['cp']}|{t['strike']}|{t['exp']}"
        c = contracts[ckey]
        c["prem"] += t["prem"]
        c["hits"] += 1
        c["cp"] = t["cp"]
        c["strike"] = t["strike"]
        c["exp"] = t["exp"]
        c["dir"] = t["dir"]
        if t["vol"] > c["vol"]:
            c["vol"] = t["vol"]
        if t["oi"] > c["oi"]:
            c["oi"] = t["oi"]

    # Find top contract per ticker (by premium)
    for ckey, c in contracts.items():
        sym = ckey.split("|")[0]
        if sym in tickers:
            tk = tickers[sym]
            if tk["top_contract"] is None or c["prem"] > tk["top_contract"]["prem"]:
                voi = f"{c['vol']/c['oi']:.1f}x" if c["oi"] > 0 else ""
                tk["top_contract"] = {
                    "cp": c["cp"][0] if c["cp"] else "?",
                    "strike": c["strike"],
                    "exp": c["exp"],
                    "prem": c["prem"],
                    "hits": c["hits"],
                    "voi": voi,
                    "dir": c["dir"],
                }

    # Add net + cap
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


def _fmt_exp(exp: str) -> str:
    """Shorten expiration: '05/22/2026' -> '5/22', '5/22/26' -> '5/22'."""
    if not exp:
        return "?"
    parts = exp.replace("-", "/").split("/")
    if len(parts) >= 2:
        m = str(int(parts[0]))
        d = str(int(parts[1]))
        return f"{m}/{d}"
    return exp[:5]


def _fmt_strike(strike: float) -> str:
    """Format strike: 135.0 -> '$135', 27.5 -> '$27.5'."""
    if strike == int(strike):
        return f"${int(strike)}"
    return f"${strike:g}"


def score_ticker(tk: dict) -> float:
    """
    AutoScore-style ranking matching the Watchlist tab.
    Weighs conviction, hits, premium, V/OI, and flags.
    """
    total = tk["bull"] + tk["bear"]
    if total <= 0:
        return 0

    tc = tk.get("top_contract") or {}
    hits = tc.get("hits", 1)
    voi_str = tc.get("voi", "")
    try:
        voi = float(voi_str.replace("x", "")) if voi_str else 0
    except (ValueError, AttributeError):
        voi = 0

    # Conviction: how one-sided is the flow (0-1)
    bull_pct = tk["bull"] / total
    conviction = abs(bull_pct - 0.5) * 2  # 0 = split, 1 = 100% one side

    # Grade-like score from hits
    hit_score = min(hits / 10, 2.5)  # cap at 2.5

    # V/OI score (unusual activity)
    voi_score = min(voi / 10, 2.5) if voi > 1 else 0

    # Premium score (log scale so mega-cap doesn't dominate)
    import math
    prem_score = min(math.log10(max(total, 1)) - 3, 2.0)  # $1K=0, $10K=1, $100K=2

    # Side bonus (AA = strongest signal)
    side_score = 1.5 if conviction > 0.7 else 0.5

    # UOA bonus
    uoa_bonus = 1.0 if tk.get("uoa") else 0

    # Combined score
    score = hit_score + prem_score + voi_score + side_score + uoa_bonus + (conviction * 2)
    return score


def build_embed_table(tickers: list[dict], direction: str) -> str:
    """Build a monospace-aligned table for a Discord embed code block."""
    lines = []
    for i, tk in enumerate(tickers[:10], 1):
        sym = tk["sym"].ljust(6)
        tc = tk.get("top_contract")
        if tc:
            cp = tc["cp"]
            strike = _fmt_strike(tc["strike"]).ljust(8)
            exp = _fmt_exp(tc["exp"]).ljust(6)
            prem = fmt(tc["prem"]).rjust(7)
            contract = f"{cp} {strike}{exp}{prem}"
        else:
            contract = "—"

        flags = ""
        if tk.get("er"):
            flags += " ER"
        if tk.get("uoa"):
            flags += " UOA"

        rank = f"{i:>2}."
        lines.append(f"{rank} {sym} {contract}{flags}")

    return "\n".join(lines)


def build_discord_messages(trades: list[dict], label: str = "") -> list[dict]:
    """
    Build Discord messages using rich embeds.
    Returns list of message payloads with embeds array.
    """
    tickers = aggregate_flow(trades)
    all_tickers = list(tickers.values())

    with_flow = [t for t in all_tickers if t["bull"] + t["bear"] > 0]
    bull_candidates = [t for t in with_flow if t["net"] > 0]
    top_bull_all = sorted(bull_candidates, key=lambda t: score_ticker(t), reverse=True)[:10]
    bear_candidates = [t for t in with_flow if t["net"] < 0]
    top_bear_all = sorted(bear_candidates, key=lambda t: score_ticker(t), reverse=True)[:10]

    mid_small = [t for t in with_flow if t["cap"] == "Mid-Small"]
    bull_ms_candidates = [t for t in mid_small if t["net"] > 0]
    top_bull_ms = sorted(bull_ms_candidates, key=lambda t: score_ticker(t), reverse=True)[:10]
    bear_ms_candidates = [t for t in mid_small if t["net"] < 0]
    top_bear_ms = sorted(bear_ms_candidates, key=lambda t: score_ticker(t), reverse=True)[:10]

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
    ticker_count = len(with_flow)

    # Discord embed colors (decimal)
    GREEN = 0x43B581
    RED = 0xF04747
    GOLD = 0xFAA61A
    PURPLE = 0x9B59B6

    # Message 1: ALL (bull + bear embeds)
    bull_table = build_embed_table(top_bull_all, "BULL")
    bear_table = build_embed_table(top_bear_all, "BEAR")

    msg1 = {
        "embeds": [
            {
                "color": GREEN,
                "author": {"name": "UCT Options Flow"},
                "title": f"{'🟢' if total_net > 0 else '🔴'} {label or 'WATCHLIST'} — {date_str}",
                "description": (
                    f"**Net: {fmt(total_net)}** · {fmt(total_bull)} bull / {fmt(total_bear)} bear · **{bull_pct}%** bullish\n"
                    f"━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n"
                    f"**▲ BULL WATCHLIST**\n"
                    f"```\n{bull_table}\n```"
                ),
                "footer": {"text": f"UCT Intelligence · {time_str} · {ticker_count} tickers with flow"},
            },
            {
                "color": RED,
                "description": (
                    f"**▼ BEAR WATCHLIST**\n"
                    f"```\n{bear_table}\n```"
                ),
            },
        ]
    }

    # Message 2: MID-SMALL (bull + bear embeds)
    bull_ms_table = build_embed_table(top_bull_ms, "BULL")
    bear_ms_table = build_embed_table(top_bear_ms, "BEAR")

    msg2 = {
        "embeds": [
            {
                "color": GOLD,
                "title": "⚡ UNUSUAL FLOW — MID-SMALL CAP",
                "description": (
                    f"**▲ BULL — MID-SMALL**\n"
                    f"```\n{bull_ms_table}\n```"
                ),
            },
            {
                "color": PURPLE,
                "description": (
                    f"**▼ BEAR — MID-SMALL**\n"
                    f"```\n{bear_ms_table}\n```"
                ),
                "footer": {"text": f"UCT Intelligence · {time_str}"},
            },
        ]
    }

    return [msg1, msg2]


# ── Sending ────────────────────────────────────────────────────────────────

async def send_to_discord(trades: list[dict], label: str = "") -> dict:
    """Build and send watchlist to Discord webhook (2 messages)."""
    if not DISCORD_FLOW_WEBHOOK_URL:
        logger.error("[Discord] No DISCORD_FLOW_WEBHOOK_URL configured")
        return {"error": "No webhook URL configured"}

    messages = build_discord_messages(trades, label)

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            for msg in messages:
                resp = await client.post(DISCORD_FLOW_WEBHOOK_URL, json=msg)
                resp.raise_for_status()
                import asyncio
                await asyncio.sleep(0.5)  # avoid rate limit between messages
            logger.info("[Discord] Watchlist posted (%d messages) — %s", len(messages), label or "manual")
            return {"status": "sent", "label": label, "messages": len(messages)}
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
