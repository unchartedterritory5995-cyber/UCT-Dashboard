"""
Discord Watchlist Service — posts curated watchlist to Discord webhook.

Manual-only: user clicks "Push to Discord" on the Watchlist tab.
Receives bull/bear items directly from the frontend (already scored/curated).
Formats into tiered embeds with colored sidebars:
  1. Summary embed (gold sidebar) — net, bull/bear totals, date
  2. Bull embed (green sidebar) — curated bull picks with row separators
  3. Bear embed (red sidebar) — curated bear picks with row separators
"""

import os
import json
import logging
import httpx
from datetime import datetime
from zoneinfo import ZoneInfo

logger = logging.getLogger(__name__)

DISCORD_FLOW_WEBHOOK_URL = os.getenv("DISCORD_FLOW_WEBHOOK_URL", "")
ET = ZoneInfo("America/New_York")

# ── Discord embed color constants ──────────────────────────────────────────
GREEN = 0x57F287
RED = 0xED4245
GOLD = 0xC9A84C

# ── Row separator for code blocks ──────────────────────────────────────────
# ANSI codes
_GREEN_A = "\u001b[1;32m"
_RED_A = "\u001b[1;31m"
_YELLOW_A = "\u001b[1;33m"
_WHITE_A = "\u001b[1;37m"
_DIM = "\u001b[2;37m"
_RESET = "\u001b[0m"

# Dim dotted separator — compact for mobile (~32 chars)
SEP_RAW = "╌" * 32


def _build_table(items: list[dict], limit: int = 10, side: str = "bull") -> str:
    """Build a compact monospace table with dim separators and colored premium."""
    prem_color = _GREEN_A if side == "bull" else _RED_A
    sep_line = f"{_DIM}{SEP_RAW}{_RESET}"

    lines = []
    for i, item in enumerate(items[:limit], 1):
        sym = (item.get("sym") or "???").ljust(4)

        strike_val = item.get("strike")
        if strike_val and str(strike_val).strip():
            cp = (item.get("cp") or "?")[0].upper()
            try:
                strike = _fmt_strike(float(strike_val))
            except (ValueError, TypeError):
                strike = ""
            exp = _fmt_exp(item.get("exp") or "")
            prem = _fmt(float(item.get("prem") or 0))
            contract = f"{exp.ljust(4)} {strike.ljust(6)}{cp} {prem_color}{prem.rjust(5)}{_RESET}"
        else:
            contract = "—"

        score = float(item.get("score") or item.get("autoScore") or 0)
        grade = _conviction_grade(score)
        grade_color = _YELLOW_A if grade in ("A+", "A") else _WHITE_A
        grade_str = f"{grade_color}{grade.ljust(2)}{_RESET}"

        # Entry date — try multiple fields
        entry_date = ""
        for field in ("firstDate", "date", "entryDate"):
            raw = item.get(field) or ""
            if raw:
                entry_date = _fmt_exp(raw)
                if entry_date and entry_date != "?":
                    break
                entry_date = ""
        # Fallback: if age field exists (e.g. "3d"), show it
        if not entry_date:
            age = item.get("age") or ""
            if age:
                entry_date = age
        date_str = f" {entry_date}" if entry_date else ""

        row = f"{sym}{contract} {grade_str}{date_str}"
        lines.append(row)

        if i < min(len(items), limit):
            lines.append(sep_line)

    return "\n".join(lines) if lines else "(empty)"

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


# ── Conviction grade ──────────────────────────────────────────────────────

def _conviction_grade(score: float) -> str:
    """Map autoScore (0-10) to letter grade."""
    if score >= 8.5:
        return "A+"
    if score >= 7:
        return "A"
    if score >= 5.5:
        return "B+"
    if score >= 4:
        return "B"
    return "C"


# ── Message builder (tiered embeds) ────────────────────────────────────────

def build_messages(
    bull: list[dict],
    bear: list[dict],
    label: str = "",
    unusual_bull: list[dict] | None = None,
    unusual_bear: list[dict] | None = None,
    overall_bull: float = 0,
    overall_bear: float = 0,
    ticker_count: int = 0,
    limit: int = 10,
    date_range: str = "",
) -> list[dict]:
    """
    Build Discord embed messages as tiered embeds:
      Embed 1: Gold summary (net, bull/bear, date)
      Embed 2: Green bull watchlist with row separators
      Embed 3: Red bear watchlist with row separators
    """
    # Sort by score descending
    bull_sorted = sorted(
        bull,
        key=lambda x: float(x.get("score") or x.get("autoScore") or 0),
        reverse=True,
    )
    bear_sorted = sorted(
        bear,
        key=lambda x: float(x.get("score") or x.get("autoScore") or 0),
        reverse=True,
    )

    # Summary stats
    if overall_bull > 0 or overall_bear > 0:
        total_bull = overall_bull
        total_bear = overall_bear
        tk_count = ticker_count or len(set(i.get("sym") for i in bull + bear))
    else:
        total_bull = sum(float(i.get("prem") or 0) for i in bull)
        total_bear = sum(float(i.get("prem") or 0) for i in bear)
        tk_count = len(set(i.get("sym") for i in bull + bear))

    total = total_bull + total_bear
    bull_pct = round(total_bull / total * 100) if total > 0 else 50
    net = total_bull - total_bear

    now = datetime.now(ET)
    date_str = date_range if date_range else now.strftime("%B %d, %Y")
    time_str = now.strftime("%I:%M %p ET")

    messages = []

    if bull_sorted or bear_sorted:
        embeds = []

        # Embed 1: Summary header (gold sidebar) with colored field values
        net_emoji = "🟢" if net > 0 else "🔴"
        net_color = _GREEN_A if net > 0 else _RED_A
        title_label = label or "WATCHLIST"
        embeds.append({
            "color": GOLD,
            "author": {"name": "UCT Options Flow"},
            "title": f"{net_emoji} {title_label} — {date_str}",
            "description": (
                f"```ansi\n{_GREEN_A if bull_pct>=50 else _RED_A}{bull_pct}% {'bullish' if bull_pct>=50 else 'bearish'}{_RESET}\n```"
            ),
            "fields": [
                {"name": f"{net_emoji} Net", "value": f"```ansi\n{net_color}{_fmt(net)}{_RESET}\n```", "inline": True},
                {"name": "🟢 Bull", "value": f"```ansi\n{_GREEN_A}{_fmt(total_bull)}{_RESET}\n```", "inline": True},
                {"name": "🔴 Bear", "value": f"```ansi\n{_RED_A}{_fmt(total_bear)}{_RESET}\n```", "inline": True},
            ],
        })

        # Embed 2: Bull watchlist (green sidebar)
        if bull_sorted:
            bull_table = _build_table(bull_sorted, limit, side="bull")
            embeds.append({
                "color": GREEN,
                "title": f"🟢 BULL WATCHLIST",
                "description": f"```ansi\n{bull_table}\n```",
            })

        # Embed 3: Bear watchlist (red sidebar)
        if bear_sorted:
            bear_table = _build_table(bear_sorted, limit, side="bear")
            embeds.append({
                "color": RED,
                "title": f"🔴 BEAR WATCHLIST",
                "description": f"```ansi\n{bear_table}\n```",
            })

        # Footer on last embed
        embeds[-1]["footer"] = {"text": f"UCT Intelligence · {time_str}"}

        messages.append({"embeds": embeds})

    # Unusual flow (if present) — separate message
    ub = unusual_bull or []
    ubear = unusual_bear or []
    if ub or ubear:
        ub_sorted = sorted(
            ub,
            key=lambda x: float(x.get("score") or x.get("autoScore") or 0),
            reverse=True,
        )
        ubear_sorted = sorted(
            ubear,
            key=lambda x: float(x.get("score") or x.get("autoScore") or 0),
            reverse=True,
        )

        unusual_embeds = []

        if ub_sorted:
            unusual_embeds.append({
                "color": GOLD,
                "title": "⚡ UNUSUAL FLOW — BULL",
                "description": f"```ansi\n{_build_table(ub_sorted, limit, side='bull')}\n```",
            })

        if ubear_sorted:
            unusual_embeds.append({
                "color": 0x9B59B6,  # Purple
                "title": "⚡ UNUSUAL FLOW — BEAR",
                "description": f"```ansi\n{_build_table(ubear_sorted, limit, side='bear')}\n```",
            })

        if unusual_embeds:
            unusual_embeds[-1]["footer"] = {"text": f"UCT Intelligence · {time_str}"}
            messages.append({"embeds": unusual_embeds})

    return messages


# ── Send to Discord ────────────────────────────────────────────────────────

async def send_to_discord(
    bull: list[dict],
    bear: list[dict],
    label: str = "",
    unusual_bull: list[dict] | None = None,
    unusual_bear: list[dict] | None = None,
    overall_bull: float = 0,
    overall_bear: float = 0,
    ticker_count: int = 0,
    limit: int = 10,
    date_range: str = "",
) -> dict:
    """Build messages from bull/bear + unusual items and send to Discord webhook."""
    if not DISCORD_FLOW_WEBHOOK_URL:
        logger.error("[Discord] No DISCORD_FLOW_WEBHOOK_URL configured")
        return {"ok": False, "error": "No webhook URL configured"}

    messages = build_messages(
        bull, bear, label, unusual_bull, unusual_bear,
        overall_bull, overall_bear, ticker_count, limit, date_range,
    )

    try:
        import asyncio
        async with httpx.AsyncClient(timeout=10.0) as client:
            for msg in messages:
                resp = await client.post(DISCORD_FLOW_WEBHOOK_URL, json=msg)
                resp.raise_for_status()
                await asyncio.sleep(0.5)

        logger.info(
            "[Discord] Watchlist posted — %d msgs, %d bull, %d bear — %s",
            len(messages), len(bull), len(bear), label or "manual",
        )
        return {
            "ok": True,
            "messages_sent": len(messages),
            "bull_count": len(bull),
            "bear_count": len(bear),
            "unusual_bull_count": len(unusual_bull or []),
            "unusual_bear_count": len(unusual_bear or []),
            "label": label,
        }
    except Exception as e:
        logger.error("[Discord] Post failed: %s", e)
        return {"ok": False, "error": str(e)}


# ── Send image to Discord ──────────────────────────────────────────────────

async def send_image_to_discord(
    image_bytes: bytes,
    filename: str = "watchlist.png",
    label: str = "WATCHLIST",
    date_range: str = "",
) -> dict:
    """Post a screenshot image to Discord webhook as a file attachment with embed."""
    if not DISCORD_FLOW_WEBHOOK_URL:
        return {"ok": False, "error": "No webhook URL configured"}

    now = datetime.now(ET)
    date_str = date_range if date_range else now.strftime("%B %d, %Y")
    time_str = now.strftime("%I:%M %p ET")

    embed = {
        "color": GOLD,
        "title": f"📸 {label} — {date_str}",
        "image": {"url": f"attachment://{filename}"},
        "footer": {"text": f"UCT Intelligence · {time_str}"},
    }

    payload_json = json.dumps({"embeds": [embed]})

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(
                DISCORD_FLOW_WEBHOOK_URL,
                data={"payload_json": payload_json},
                files={"file": (filename, image_bytes, "image/png")},
            )
            resp.raise_for_status()

        size_kb = len(image_bytes) / 1024
        logger.info(
            "[Discord] Screenshot posted — %s, %.0fKB — %s",
            label, size_kb, filename,
        )
        return {"ok": True, "size_kb": round(size_kb, 1), "label": label}

    except Exception as e:
        logger.error("[Discord] Image post failed: %s", e)
        return {"ok": False, "error": str(e)}


# ── API route (attach to FastAPI) ──────────────────────────────────────────

def register_discord_routes(app_or_router):
    """Register the push endpoint."""
    from fastapi import Body, UploadFile, File, Form

    @app_or_router.post("/api/discord/push")
    async def push_to_discord(
        payload: dict = Body(...),
    ):
        """
        Push curated watchlist to Discord.
        Body: {
          "bull": [...],
          "bear": [...],
          "unusualBull": [...],
          "unusualBear": [...],
          "overallBull": 231200000,
          "overallBear": 150300000,
          "tickerCount": 462,
          "label": "WATCHLIST",
          "limit": 10
        }
        """
        bull = payload.get("bull", [])
        bear = payload.get("bear", [])
        unusual_bull = payload.get("unusualBull", [])
        unusual_bear = payload.get("unusualBear", [])
        overall_bull = float(payload.get("overallBull", 0))
        overall_bear = float(payload.get("overallBear", 0))
        ticker_count = int(payload.get("tickerCount", 0))
        label = payload.get("label", "WATCHLIST")
        limit = int(payload.get("limit", 10))
        date_range = payload.get("dateRange", "")

        if not bull and not bear and not unusual_bull and not unusual_bear:
            return {"ok": False, "error": "No items to send"}

        return await send_to_discord(
            bull, bear, label, unusual_bull, unusual_bear,
            overall_bull, overall_bear, ticker_count, limit, date_range,
        )

    @app_or_router.post("/api/discord/push-image")
    async def push_image_to_discord(
        file: UploadFile = File(...),
        label: str = Form("WATCHLIST"),
        date_range: str = Form(""),
    ):
        """
        Push a screenshot image of the watchlist to Discord.
        Frontend sends: FormData { file: PNG blob, label, date_range }
        """
        if not DISCORD_FLOW_WEBHOOK_URL:
            return {"ok": False, "error": "No webhook URL configured"}

        try:
            image_bytes = await file.read()
            if len(image_bytes) < 100:
                return {"ok": False, "error": "Image too small / empty"}

            result = await send_image_to_discord(
                image_bytes=image_bytes,
                filename=file.filename or "watchlist.png",
                label=label,
                date_range=date_range,
            )
            return result
        except Exception as e:
            logger.error("[Discord] Image push error: %s", e)
            return {"ok": False, "error": str(e)}
