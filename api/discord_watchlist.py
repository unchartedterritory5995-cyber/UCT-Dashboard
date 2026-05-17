"""
Discord Watchlist Service — auto-posts top bull/bear flow to Discord webhook.
Runs on Railway via APScheduler or manual API trigger.

v2: Reads from SAVED watchlist (watchlist_tracker) so Discord output exactly
    matches the frontend Watchlist tab. Falls back to raw trade aggregation
    only if no saved watchlist exists.

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


# ══════════════════════════════════════════════════════════════════════════════
# FORMATTING (shared by both paths)
# ══════════════════════════════════════════════════════════════════════════════

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
        try:
            m = str(int(parts[0]))
            d = str(int(parts[1]))
            return f"{m}/{d}"
        except ValueError:
            pass
    return exp[:5]


def _fmt_strike(strike: float) -> str:
    """Format strike: 135.0 -> '$135', 27.5 -> '$27.5'."""
    if strike == int(strike):
        return f"${int(strike)}"
    return f"${strike:g}"


# ══════════════════════════════════════════════════════════════════════════════
# SAVED WATCHLIST PATH (preferred — single source of truth)
# ══════════════════════════════════════════════════════════════════════════════

def _load_saved_watchlist() -> dict | None:
    """Load the latest saved watchlist from watchlist_tracker."""
    try:
        from api import watchlist_tracker
        wl = watchlist_tracker.get_latest_watchlist()
        if wl and (wl.get("bull") or wl.get("bear")):
            logger.info(
                "[Discord] Loaded saved watchlist for %s: %d bull, %d bear",
                wl.get("date", "?"), len(wl.get("bull", [])), len(wl.get("bear", []))
            )
            return wl
    except Exception as e:
        logger.debug("[Discord] watchlist_tracker import failed: %s", e)
    return None


def _saved_embed_table(items: list[dict]) -> str:
    """Build a monospace-aligned table from saved watchlist items."""
    lines = []
    for i, item in enumerate(items[:10], 1):
        sym = (item.get("sym") or "???").ljust(6)

        # Contract info
        strike_val = item.get("strike")
        if strike_val and str(strike_val).strip():
            cp = (item.get("cp") or "?")[0].upper()
            try:
                strike = _fmt_strike(float(strike_val)).ljust(8)
            except (ValueError, TypeError):
                strike = "".ljust(8)
            exp = _fmt_exp(item.get("exp") or "").ljust(6)
            prem = fmt(float(item.get("prem") or 0)).rjust(7)
            contract = f"{cp} {strike}{exp}{prem}"
        else:
            contract = "—"

        # Flags
        flags = ""
        if item.get("er"):
            flags += " ER"
        notes = str(item.get("notes") or "")
        if item.get("uoa") or "UOA" in notes.upper():
            flags += " UOA"

        # Score badge
        score = float(item.get("score") or item.get("autoScore") or 0)
        score_str = f" [{score:.0f}]" if score else ""

        rank = f"{i:>2}."
        lines.append(f"{rank} {sym} {contract}{flags}{score_str}")

    return "\n".join(lines)


def build_discord_from_saved(wl: dict, label: str = "") -> list[dict]:
    """
    Build Discord messages from a saved watchlist.
    The items already have scores, caps, and contract details from the frontend.
    """
    bull = wl.get("bull", [])
    bear = wl.get("bear", [])
    wl_date = wl.get("date", datetime.now().strftime("%Y-%m-%d"))

    # Sort by score descending (should already be sorted, but ensure)
    bull_sorted = sorted(bull, key=lambda x: float(x.get("score") or x.get("autoScore") or 0), reverse=True)
    bear_sorted = sorted(bear, key=lambda x: float(x.get("score") or x.get("autoScore") or 0), reverse=True)

    # Split mid-small cap items
    def is_mid_small(item):
        cap = (item.get("cap") or "").lower().replace("-", "")
        return cap in ("midsmall", "mid", "small", "micro")

    bull_ms = [i for i in bull_sorted if is_mid_small(i)]
    bear_ms = [i for i in bear_sorted if is_mid_small(i)]

    # Totals from saved data
    total_bull_prem = sum(float(i.get("prem") or 0) for i in bull)
    total_bear_prem = sum(float(i.get("prem") or 0) for i in bear)
    total_prem = total_bull_prem + total_bear_prem
    bull_pct = round(total_bull_prem / total_prem * 100) if total_prem > 0 else 50
    total_net = total_bull_prem - total_bear_prem
    ticker_count = len(set(i.get("sym") for i in bull + bear))

    now = datetime.now()
    time_str = now.strftime("%I:%M %p ET")

    # Format date for display
    try:
        display_date = datetime.strptime(wl_date, "%Y-%m-%d").strftime("%B %d, %Y")
    except ValueError:
        display_date = wl_date

    # Discord embed colors (decimal)
    GREEN = 0x43B581
    RED = 0xF04747
    GOLD = 0xFAA61A
    PURPLE = 0x9B59B6

    # Message 1: ALL
    bull_table = _saved_embed_table(bull_sorted)
    bear_table = _saved_embed_table(bear_sorted)

    msg1 = {
        "embeds": [
            {
                "color": GREEN,
                "author": {"name": "UCT Options Flow"},
                "title": f"{'🟢' if total_net > 0 else '🔴'} {label or 'WATCHLIST'} — {display_date}",
                "description": (
                    f"**Net: {fmt(total_net)}** · {fmt(total_bull_prem)} bull / {fmt(total_bear_prem)} bear · **{bull_pct}%** bullish\n"
                    f"━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n"
                    f"**▲ BULL WATCHLIST**\n"
                    f"```\n{bull_table}\n```"
                ),
                "footer": {"text": f"UCT Intelligence · {time_str} · {ticker_count} tickers"},
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

    # Message 2: MID-SMALL (only if we have data)
    if bull_ms or bear_ms:
        bull_ms_table = _saved_embed_table(bull_ms)
        bear_ms_table = _saved_embed_table(bear_ms)

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

    return [msg1]


# ══════════════════════════════════════════════════════════════════════════════
# FALLBACK PATH — raw trade aggregation (used only if no saved watchlist)
# ══════════════════════════════════════════════════════════════════════════════

def _load_flow_trades() -> list[dict] | None:
    """Load trades from FlowDB or fall back to CSV file."""
    # Try 1: FlowDB SQLite
    try:
        from api.flow_db import FlowDB
        db = FlowDB()
        conn = db.conn if hasattr(db, 'conn') else db._get_conn() if hasattr(db, '_get_conn') else None
        if conn is None:
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
    cp = (trade.get("call_put") or trade.get("CallPut") or "").upper()
    side_raw = (trade.get("side") or trade.get("Side") or "").upper().strip()
    typ = (trade.get("type") or trade.get("Type") or "").upper().strip()

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


def aggregate_flow(trades: list[dict]) -> dict:
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

    clusters = defaultdict(lambda: {"dirs": set(), "trades": []})
    for t in confirmed:
        key = f"{t['sym']}|{t['cp']}|{t['strike']}|{t['exp']}"
        clusters[key]["dirs"].add(t["dir"])
        clusters[key]["trades"].append(t)

    dirty_keys = {k for k, v in clusters.items() if len(v["dirs"]) > 1}

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

    for tk in tickers.values():
        tk["net"] = tk["bull"] - tk["bear"]
        tk["cap"] = cap_band(tk["mktcap"])

    return tickers


def score_ticker(tk: dict) -> float:
    import math
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

    bull_pct = tk["bull"] / total
    conviction = abs(bull_pct - 0.5) * 2

    hit_score = min(hits / 10, 2.5)
    voi_score = min(voi / 10, 2.5) if voi > 1 else 0
    prem_score = min(math.log10(max(total, 1)) - 3, 2.0)
    side_score = 1.5 if conviction > 0.7 else 0.5
    uoa_bonus = 1.0 if tk.get("uoa") else 0

    return hit_score + prem_score + voi_score + side_score + uoa_bonus + (conviction * 2)


def build_embed_table(tickers: list[dict], direction: str) -> str:
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
    Build Discord messages from raw trades.
    FALLBACK only — prefer build_discord_from_saved().
    """
    tickers = aggregate_flow(trades)
    all_tickers = list(tickers.values())

    with_flow = [t for t in all_tickers if t["bull"] + t["bear"] > 0]
    bull_candidates = [t for t in with_flow if t["net"] > 0]
    top_bull_all = sorted(bull_candidates, key=lambda t: score_ticker(t), reverse=True)[:10]
    bear_candidates = [t for t in with_flow if t["net"] < 0]
    top_bear_all = sorted(bear_candidates, key=lambda t: score_ticker(t), reverse=True)[:10]

    mid_small = [t for t in with_flow if t["cap"] == "Mid-Small"]
    top_bull_ms = sorted([t for t in mid_small if t["net"] > 0], key=lambda t: score_ticker(t), reverse=True)[:10]
    top_bear_ms = sorted([t for t in mid_small if t["net"] < 0], key=lambda t: score_ticker(t), reverse=True)[:10]

    total_bull = sum(t["bull"] for t in with_flow)
    total_bear = sum(t["bear"] for t in with_flow)
    total_net = total_bull - total_bear
    bull_pct = round(total_bull / (total_bull + total_bear) * 100) if (total_bull + total_bear) > 0 else 50

    now = datetime.now()
    date_str = now.strftime("%B %d, %Y")
    time_str = now.strftime("%I:%M %p ET")
    ticker_count = len(with_flow)

    GREEN = 0x43B581
    RED = 0xF04747
    GOLD = 0xFAA61A
    PURPLE = 0x9B59B6

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


# ══════════════════════════════════════════════════════════════════════════════
# SENDING
# ══════════════════════════════════════════════════════════════════════════════

async def send_to_discord(messages: list[dict], label: str = "") -> dict:
    """Send pre-built Discord message payloads to webhook."""
    if not DISCORD_FLOW_WEBHOOK_URL:
        logger.error("[Discord] No DISCORD_FLOW_WEBHOOK_URL configured")
        return {"error": "No webhook URL configured"}

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            for msg in messages:
                resp = await client.post(DISCORD_FLOW_WEBHOOK_URL, json=msg)
                resp.raise_for_status()
                import asyncio
                await asyncio.sleep(0.5)
            logger.info("[Discord] Watchlist posted (%d messages) — %s", len(messages), label or "manual")
            return {"status": "sent", "label": label, "messages": len(messages)}
    except Exception as e:
        logger.error("[Discord] Post failed: %s", e)
        return {"error": str(e)}


async def post_watchlist(label: str = "") -> dict:
    """
    Main entry point: try saved watchlist first, fall back to raw aggregation.
    Returns the send result dict.
    """
    # Preferred: read from saved watchlist (matches frontend exactly)
    saved = _load_saved_watchlist()
    if saved:
        messages = build_discord_from_saved(saved, label)
        result = await send_to_discord(messages, label)
        result["source"] = "saved_watchlist"
        result["date"] = saved.get("date")
        return result

    # Fallback: aggregate from raw trades (scoring may drift from frontend)
    logger.warning("[Discord] No saved watchlist found — falling back to raw trade aggregation")
    trades = _load_flow_trades()
    if trades is None:
        return {"error": "No saved watchlist and no raw trades available"}

    messages = build_discord_messages(trades, label)
    result = await send_to_discord(messages, label)
    result["source"] = "raw_aggregation"
    return result


# ══════════════════════════════════════════════════════════════════════════════
# API ROUTES
# ══════════════════════════════════════════════════════════════════════════════

def register_discord_routes(app_or_router):
    """Register the manual trigger endpoint."""
    from fastapi import Query as FQuery

    @app_or_router.post("/api/discord/send-watchlist")
    async def trigger_watchlist(
        label: str = FQuery("MANUAL", description="Label for the message"),
    ):
        """
        Manually trigger a Discord watchlist post.
        Reads from saved watchlist (preferred) or falls back to raw trades.
        """
        return await post_watchlist(label)

    @app_or_router.get("/api/discord/preview")
    async def preview_watchlist():
        """Preview what would be posted to Discord (without sending)."""
        saved = _load_saved_watchlist()
        if saved:
            messages = build_discord_from_saved(saved, "PREVIEW")
            return {
                "source": "saved_watchlist",
                "date": saved.get("date"),
                "bull_count": len(saved.get("bull", [])),
                "bear_count": len(saved.get("bear", [])),
                "messages": messages,
            }
        return {"source": None, "error": "No saved watchlist found"}


# ══════════════════════════════════════════════════════════════════════════════
# SCHEDULED JOBS (APScheduler)
# ══════════════════════════════════════════════════════════════════════════════

def setup_scheduler(scheduler):
    """
    Register scheduled Discord posts.
    Call this from main.py after creating the APScheduler instance.
    """
    import asyncio

    async def _send_scheduled(label):
        result = await post_watchlist(label)
        if "error" in result:
            logger.warning("[Discord] Scheduled post failed: %s", result["error"])
        else:
            logger.info("[Discord] Scheduled post sent — source: %s", result.get("source"))

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
