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

DISCORD_FLOW_WEBHOOK_URL = (
    # Primary: matches liveflow_worker.py's lookup so both push paths share
    # the same channel. Env var renamed 2026-06-17 from DISCORD_FLOW_WEBHOOK_URL
    # to DISCORD_LIVE_FLOW_WEBHOOK_URL to align with worker code expectations.
    os.getenv("DISCORD_LIVE_FLOW_WEBHOOK_URL")
    # Legacy name — kept for safety if the rename ever gets reverted in Railway.
    or os.getenv("DISCORD_FLOW_WEBHOOK_URL")
    # Last-resort generic webhook (same fallback liveflow_worker.py uses).
    or os.getenv("DISCORD_WEBHOOK_URL", "")
).strip()
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

# Dim dotted separator
SEP_FULL = "╌" * 25
SEP_COMPACT = "╌" * 16
COL_W = 19  # visible chars per column in 2-col mode


def _fmt_row(item, side="bull"):
    """Format a single row for 2-column layout (19 visible chars)."""
    prem_color = _GREEN_A if side == "bull" else _RED_A
    sym = (item.get("sym") or "???").ljust(5)
    strike_val = item.get("strike")
    if strike_val and str(strike_val).strip():
        cp = (item.get("cp") or "?")[0].upper()
        try:
            sv = float(strike_val)
            sn = str(int(sv)) if sv == int(sv) else f"{sv:g}"
        except (ValueError, TypeError):
            sn = ""
        exp = _fmt_exp(item.get("exp") or "")
        prem = _fmt_short(float(item.get("prem") or 0))
        return f"{sym}{exp.ljust(5)}{(sn + cp).ljust(5)}{prem_color}{prem.rjust(4)}{_RESET}"
    return f"{sym}—"


def _build_two_col(items, side="bull"):
    """Build a 2-column table: items 1-10 left, 11-20 right, in a single code block."""
    left = items[:10]
    right = items[10:20]
    sep = f"{_DIM}{'╌' * COL_W}│{'╌' * COL_W}{_RESET}"
    empty = " " * COL_W

    lines = []
    max_rows = max(len(left), len(right))
    for i in range(max_rows):
        l = _fmt_row(left[i], side) if i < len(left) else empty
        r = _fmt_row(right[i], side) if i < len(right) else ""
        lines.append(f"{l}│{r}" if r else l)
        if i < max_rows - 1:
            lines.append(sep)

    return "\n".join(lines)


def _resolve_date_str(item: dict) -> str:
    """Resolve the date label for a watchlist row.

    Falls through: firstDate → date → entryDate → age → today's ET date.
    The today's-date fallback exists so entries added before the
    firstDate field was being captured still render uniformly with
    newer entries (otherwise they'd show no date at all).
    """
    for field in ("firstDate", "date", "entryDate"):
        raw = item.get(field) or ""
        if raw:
            fmt = _fmt_exp(raw)
            if fmt and fmt != "?":
                return fmt
    age = item.get("age") or ""
    if age:
        return age
    today = datetime.now(ET)
    return f"{today.month}/{today.day}"


def _build_table_compact(items, side="bull"):
    """Build a table for inline fields — full format: ticker + exp + strike/cp + prem + date."""
    prem_color = _GREEN_A if side == "bull" else _RED_A
    sep_line = f"{_DIM}{'╌' * 22}{_RESET}"

    lines = []
    for i, item in enumerate(items[:10], 1):
        sym = (item.get("sym") or "???").ljust(6)
        strike_val = item.get("strike")
        if strike_val and str(strike_val).strip():
            cp = (item.get("cp") or "?")[0].upper()
            try:
                sv = float(strike_val)
                sn = str(int(sv)) if sv == int(sv) else f"{sv:g}"
            except (ValueError, TypeError):
                sn = ""
            exp = _fmt_exp(item.get("exp") or "")
            prem = _fmt_short(float(item.get("prem") or 0))
            row = f"{sym}{exp.ljust(5)}{(sn + cp).ljust(6)}{prem_color}{prem.rjust(5)}{_RESET}"
        else:
            row = f"{sym}—"

        # NOTE: no entry-date on the 2-column rows. The date pushed each row past
        # the narrow inline-field width and wrapped it onto a 2nd line on DESKTOP
        # (mobile is full-width so it stayed one line). Dropping it keeps every
        # contract a single aligned line on both. The date range still shows on
        # the summary embed. Single-column ≤10 rows (_build_table) keep the date.
        lines.append(row)
        if i < min(len(items), 10):
            lines.append(sep_line)

    return "\n".join(lines) if lines else "(empty)"


def _build_table(items: list[dict], limit: int = 10, side: str = "bull", compact: bool = False, show_date: bool = True) -> str:
    """
    Build a monospace table for Discord code blocks.
    compact=True: for inline fields (~18 char width) — ticker + strike/cp + prem only.
    compact=False: full row — ticker + exp + strike/cp + prem + date.
    show_date=False: drop the trailing entry-date (used for the dense same-day
      single-column layout, where the date lives on the header instead of each row).
    """
    prem_color = _GREEN_A if side == "bull" else _RED_A
    sep_raw = SEP_COMPACT if compact else SEP_FULL
    sep_line = f"{_DIM}{sep_raw}{_RESET}"

    lines = []
    for i, item in enumerate(items[:limit], 1):
        strike_val = item.get("strike")
        prem_raw = float(item.get("prem") or 0)

        if compact:
            sym = (item.get("sym") or "???").ljust(5)
            if strike_val and str(strike_val).strip():
                cp = (item.get("cp") or "?")[0].upper()
                try:
                    sv = float(strike_val)
                    sn = str(int(sv)) if sv == int(sv) else f"{sv:g}"
                except (ValueError, TypeError):
                    sn = ""
                prem = _fmt_short(prem_raw)
                row = f"{sym}{(sn + cp).ljust(6)}{prem_color}{prem.rjust(5)}{_RESET}"
            else:
                row = f"{sym}—"
        else:
            sym = (item.get("sym") or "???").ljust(6)
            if strike_val and str(strike_val).strip():
                cp = (item.get("cp") or "?")[0].upper()
                try:
                    sv = float(strike_val)
                    sn = str(int(sv)) if sv == int(sv) else f"{sv:g}"
                except (ValueError, TypeError):
                    sn = ""
                exp = _fmt_exp(item.get("exp") or "")
                prem = _fmt(prem_raw)
                contract = f"{exp.ljust(5)} {(sn + cp).ljust(6)} {prem_color}{prem.rjust(6)}{_RESET}"
            else:
                contract = "—"

            # Entry date (today's-date fallback ensures uniform rendering).
            # Shown only when show_date — the multi-day (weekly) view uses it to
            # mark which day each contract's flow hit; the same-day view drops it.
            date_str = _resolve_date_str(item) if show_date else ""

            row = f"{sym}{contract} {date_str}" if date_str else f"{sym}{contract}"

        lines.append(row)

        if i < min(len(items), limit):
            lines.append(sep_line)

    return "\n".join(lines) if lines else "(empty)"


def _build_day_grouped(items: list[dict], side: str = "bull") -> str:
    """Multi-day (weekly) layout: group contracts under a per-day header instead
    of repeating the date on every row.

    Each row drops back to the compact ~22-char width (fits one line on iPhone —
    the flat per-row-date layout is ~30 chars and wraps on phones). The date moves
    up to a dim ``── M/D ──`` header. Days are ordered newest-first; the incoming
    score order is preserved within each day.
    """
    prem_color = _GREEN_A if side == "bull" else _RED_A

    groups: dict[str, list[dict]] = {}
    for it in items[:40]:
        d = _resolve_date_str(it)
        groups.setdefault(d, []).append(it)

    def _daykey(d: str):
        try:
            m, day = d.split("/")
            return (int(m), int(day))
        except (ValueError, AttributeError):
            return (0, 0)

    lines: list[str] = []
    for d in sorted(groups, key=_daykey, reverse=True):
        lines.append(f"{_DIM}── {d} ──{_RESET}")
        for it in groups[d]:
            sym = (it.get("sym") or "???").ljust(6)
            strike_val = it.get("strike")
            if strike_val and str(strike_val).strip():
                cp = (it.get("cp") or "?")[0].upper()
                try:
                    sv = float(strike_val)
                    sn = str(int(sv)) if sv == int(sv) else f"{sv:g}"
                except (ValueError, TypeError):
                    sn = ""
                exp = _fmt_exp(it.get("exp") or "")
                prem = _fmt_short(float(it.get("prem") or 0))
                lines.append(f"{sym}{exp.ljust(5)}{(sn + cp).ljust(6)}{prem_color}{prem.rjust(5)}{_RESET}")
            else:
                lines.append(f"{sym}—")

    return "\n".join(lines) if lines else "(empty)"


def _fmt(n: float) -> str:
    a = abs(n)
    if a >= 1e6:
        if a >= 10e6:
            return f"${a / 1e6:.0f}M"
        return f"${a / 1e6:.1f}M"
    if a >= 1e3:
        return f"${a / 1e3:.0f}K"
    return f"${a:.0f}"


def _fmt_short(n: float) -> str:
    """Ultra-compact premium format for inline fields — no decimals."""
    a = abs(n)
    if a >= 1e6:
        return f"${a / 1e6:.0f}M"
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


# ── Layout helpers ─────────────────────────────────────────────────────────

def _is_multi_day(items: list[dict]) -> bool:
    """True if the watchlist spans more than one entry-date (a weekly push).

    A same-day push (all contracts from today) renders the dense 2-column layout
    with no per-row date. A multi-day push shows the date, so we switch to a
    single full-width column where the date fits on one line.
    """
    seen = set()
    for it in items:
        d = _resolve_date_str(it)
        if d and d != "?":
            seen.add(d)
            if len(seen) > 1:
                return True
    return False


def _side_embed(items: list[dict], color: int, title: str, side: str, multi_day: bool) -> dict:
    """Build one bull/bear-style embed, layout chosen by span.

    multi_day → single full-width column WITH per-row date (fits on one line;
      marks which day each contract's flow hit).
    same-day  → dense 2-column (>10) or single column (≤10), no per-row date —
      the date lives on the header + summary instead.
    """
    if multi_day:
        return {
            "color": color,
            "title": title,
            "description": f"```ansi\n{_build_day_grouped(items, side)}\n```",
        }
    if len(items) > 10:
        return {
            "color": color,
            "title": title,
            "fields": [
                {"name": "​", "value": f"```ansi\n{_build_table_compact(items[:10], side)}\n```", "inline": True},
                {"name": "​", "value": f"```ansi\n{_build_table_compact(items[10:20], side)}\n```", "inline": True},
            ],
        }
    return {
        "color": color,
        "title": title,
        "description": f"```ansi\n{_build_table(items, 10, side, show_date=False)}\n```",
    }


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

    # Span decides the layout: a same-day push stays dense 2-column (no per-row
    # date); a multi-day (weekly) push shows the date per row in a single column.
    multi_day = _is_multi_day(
        bull_sorted + bear_sorted + (unusual_bull or []) + (unusual_bear or [])
    )

    messages = []

    if bull_sorted or bear_sorted:
        embeds = []

        # Embed 1: Summary header (gold sidebar) with colored field values
        net_emoji = "🟢" if net > 0 else "🔴"
        net_color = _GREEN_A if net > 0 else _RED_A
        title_label = label or "WATCHLIST"

        # Build bull/bear visual bar with emoji circles (softer than squares)
        bar_w = 12
        bull_blocks = max(1, round(bar_w * bull_pct / 100))
        bear_blocks = bar_w - bull_blocks
        bar = "🟢" * bull_blocks + "🔴" * bear_blocks
        net_sign = "+" if net > 0 else ""
        bear_pct = 100 - bull_pct
        lean = "Bullish" if net > 0 else ("Bearish" if net < 0 else "Neutral")
        lean_pct = bull_pct if net >= 0 else bear_pct

        embeds.append({
            "color": GOLD,
            "author": {"name": "UCT Options Flow"},
            "title": f"{net_emoji} {title_label} — {date_str}",
            "description": f"**{net_sign}{_fmt(net)} NET**  ·  {lean_pct}% {lean}\n{bar}",
            "fields": [
                {"name": "🟢 Bull", "value": _fmt(total_bull), "inline": True},
                {"name": "🔴 Bear", "value": _fmt(total_bear), "inline": True},
                {"name": "📋 Tickers", "value": str(tk_count), "inline": True},
            ],
        })

        # Embed 2: Bull watchlist (green sidebar)
        if bull_sorted:
            embeds.append(_side_embed(bull_sorted, GREEN, f"🟢 Bullish Flow — {date_str}", "bull", multi_day))

        # Embed 3: Bear watchlist (red sidebar)
        if bear_sorted:
            embeds.append(_side_embed(bear_sorted, RED, f"🔴 Bearish Flow — {date_str}", "bear", multi_day))

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
            unusual_embeds.append(_side_embed(ub_sorted, GOLD, f"⚡ Unusual Bull Flow — {date_str}", "bull", multi_day))

        if ubear_sorted:
            unusual_embeds.append(_side_embed(ubear_sorted, 0x9B59B6, f"⚡ Unusual Bear Flow — {date_str}", "bear", multi_day))

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
        logger.error("[Discord] No webhook URL configured "
                     "(set DISCORD_LIVE_FLOW_WEBHOOK_URL)")
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
