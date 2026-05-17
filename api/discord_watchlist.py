"""
Discord Watchlist Service — posts curated watchlist to Discord webhook.

Manual-only: user clicks "Push to Discord" on the Watchlist tab.
Receives bull/bear items directly from the frontend (already scored/curated).
Formats into 4-section embeds:
  1. ▲ BULL WATCHLIST (all caps)
  2. ▼ BEAR WATCHLIST (all caps)
  3. ▲ BULL — MID-SMALL (unusual flow)
  4. ▼ BEAR — MID-SMALL (unusual flow)
"""

import os
import logging
import httpx
from datetime import datetime

logger = logging.getLogger(__name__)

DISCORD_FLOW_WEBHOOK_URL = os.getenv("DISCORD_FLOW_WEBHOOK_URL", "")


# ── Formatting ─────────────────────────────────────────────────────────────

def _fmt(n: float) -> str:
    a = abs(n)
    if a >= 1e6:
        return f"${a / 1e6:.1f}M"
    if a >= 1e3:
        return f"${a / 1e3:.0f}K"
    return f"${a:.0f}"


def _fmt_exp(exp: str) -> str:
    if not exp:
        return "?"
    parts = exp.replace("-", "/").split("/")
    if len(parts) >= 2:
        try:
            return f"{int(parts[0])}/{int(parts[1])}"
        except ValueError:
            pass
    return exp[:5]


def _fmt_strike(strike: float) -> str:
    if strike == int(strike):
        return f"${int(strike)}"
    return f"${strike:g}"


# ── Embed table builder ───────────────────────────────────────────────────

def _build_table(items: list[dict], limit: int = 10) -> str:
    """Build a monospace-aligned table from watchlist items."""
    lines = []
    for i, item in enumerate(items[:limit], 1):
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
            prem = _fmt(float(item.get("prem") or 0)).rjust(7)
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

    return "\n".join(lines) if lines else "(empty)"


# ── Message builder ────────────────────────────────────────────────────────

def _is_mid_small(item: dict) -> bool:
    cap = (item.get("cap") or "").lower().replace("-", "")
    return cap in ("midsmall", "mid", "small", "micro")


def build_messages(bull: list[dict], bear: list[dict], label: str = "") -> list[dict]:
    """
    Build Discord embed messages from curated watchlist items.
    Returns 1-2 message payloads (message 2 only if mid-small items exist).
    """
    # Sort by score descending
    bull_sorted = sorted(bull, key=lambda x: float(x.get("score") or x.get("autoScore") or 0), reverse=True)
    bear_sorted = sorted(bear, key=lambda x: float(x.get("score") or x.get("autoScore") or 0), reverse=True)

    # Mid-small subsets
    bull_ms = [i for i in bull_sorted if _is_mid_small(i)]
    bear_ms = [i for i in bear_sorted if _is_mid_small(i)]

    # Summary stats
    total_bull = sum(float(i.get("prem") or 0) for i in bull)
    total_bear = sum(float(i.get("prem") or 0) for i in bear)
    total = total_bull + total_bear
    bull_pct = round(total_bull / total * 100) if total > 0 else 50
    net = total_bull - total_bear
    ticker_count = len(set(i.get("sym") for i in bull + bear))

    now = datetime.now()
    date_str = now.strftime("%B %d, %Y")
    time_str = now.strftime("%I:%M %p ET")

    GREEN = 0x43B581
    RED = 0xF04747
    GOLD = 0xFAA61A
    PURPLE = 0x9B59B6

    # Message 1: All-cap bull + bear
    msg1 = {
        "embeds": [
            {
                "color": GREEN,
                "author": {"name": "UCT Options Flow"},
                "title": f"{'🟢' if net > 0 else '🔴'} {label or 'WATCHLIST'} — {date_str}",
                "description": (
                    f"**Net: {_fmt(net)}** · {_fmt(total_bull)} bull / {_fmt(total_bear)} bear · **{bull_pct}%** bullish\n"
                    f"━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n"
                    f"**▲ BULL WATCHLIST**\n"
                    f"```\n{_build_table(bull_sorted)}\n```"
                ),
                "footer": {"text": f"UCT Intelligence · {time_str} · {ticker_count} tickers"},
            },
            {
                "color": RED,
                "description": (
                    f"**▼ BEAR WATCHLIST**\n"
                    f"```\n{_build_table(bear_sorted)}\n```"
                ),
            },
        ]
    }

    messages = [msg1]

    # Message 2: Mid-Small (only if data exists)
    if bull_ms or bear_ms:
        msg2 = {
            "embeds": [
                {
                    "color": GOLD,
                    "title": "⚡ UNUSUAL FLOW — MID-SMALL CAP",
                    "description": (
                        f"**▲ BULL — MID-SMALL**\n"
                        f"```\n{_build_table(bull_ms)}\n```"
                    ),
                },
                {
                    "color": PURPLE,
                    "description": (
                        f"**▼ BEAR — MID-SMALL**\n"
                        f"```\n{_build_table(bear_ms)}\n```"
                    ),
                    "footer": {"text": f"UCT Intelligence · {time_str}"},
                },
            ]
        }
        messages.append(msg2)

    return messages


# ── Send to Discord ────────────────────────────────────────────────────────

async def send_to_discord(bull: list[dict], bear: list[dict], label: str = "") -> dict:
    """Build messages from bull/bear items and send to Discord webhook."""
    if not DISCORD_FLOW_WEBHOOK_URL:
        logger.error("[Discord] No DISCORD_FLOW_WEBHOOK_URL configured")
        return {"ok": False, "error": "No webhook URL configured"}

    messages = build_messages(bull, bear, label)

    try:
        import asyncio
        async with httpx.AsyncClient(timeout=10.0) as client:
            for msg in messages:
                resp = await client.post(DISCORD_FLOW_WEBHOOK_URL, json=msg)
                resp.raise_for_status()
                await asyncio.sleep(0.5)

        logger.info(
            "[Discord] Watchlist posted — %d msgs, %d bull, %d bear — %s",
            len(messages), len(bull), len(bear), label or "manual"
        )
        return {
            "ok": True,
            "messages_sent": len(messages),
            "bull_count": len(bull),
            "bear_count": len(bear),
            "label": label,
        }
    except Exception as e:
        logger.error("[Discord] Post failed: %s", e)
        return {"ok": False, "error": str(e)}


# ── API route (attach to FastAPI) ──────────────────────────────────────────

def register_discord_routes(app_or_router):
    """Register the push endpoint."""
    from fastapi import Body

    @app_or_router.post("/api/discord/push")
    async def push_to_discord(
        payload: dict = Body(...),
    ):
        """
        Push curated watchlist to Discord.
        Body: { "bull": [...], "bear": [...], "label": "WATCHLIST" }
        """
        bull = payload.get("bull", [])
        bear = payload.get("bear", [])
        label = payload.get("label", "WATCHLIST")

        if not bull and not bear:
            return {"ok": False, "error": "No bull or bear items to send"}

        return await send_to_discord(bull, bear, label)
