"""
notable_flow.py — Notable Flow Discord Service.

Posts Flow Pulse summary (Tier 1) and Hot Ticker alerts (Tier 2) to a
dedicated Discord channel after admin CSV uploads.

Architecture mirrors discord_watchlist.py: frontend computes and curates
the payload (Top Flow ranking, ticker net, top contracts) and POSTs to
/api/notable-flow/post. Backend formats embeds, applies 24h per-ticker
dedupe, and ships to Discord.

This avoids the Python/JS scoring drift problem the watchlist bot hit —
what users see on the Top Flow tab is exactly what ships to Discord.

Persistent state lives in /data/notable_alerts.db (separate from flow.db
to keep concerns isolated):
  - dedupe(ticker, last_fired_at)  — 24h per-ticker cooldown
  - settings(key, value)            — enabled toggle, future thresholds

Env vars (Railway dashboard tunable):
  DISCORD_NOTABLE_WEBHOOK_URL — required, the Discord webhook
  NOTABLE_DEDUPE_HOURS        — default 24, per-ticker cooldown window
  NOTABLE_FLOW_DB_PATH        — default /data/notable_alerts.db
"""

from __future__ import annotations

import os
import sqlite3
import logging
import asyncio
import httpx
from contextlib import contextmanager
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

logger = logging.getLogger(__name__)

# ── Config ────────────────────────────────────────────────────────────────
DISCORD_NOTABLE_WEBHOOK_URL = os.getenv("DISCORD_NOTABLE_WEBHOOK_URL", "")
DEDUPE_HOURS = float(os.getenv("NOTABLE_DEDUPE_HOURS", "24"))
DB_PATH = os.environ.get("NOTABLE_FLOW_DB_PATH", "/data/notable_alerts.db")
ET = ZoneInfo("America/New_York")

# Discord embed color constants (match discord_watchlist.py for visual continuity)
GREEN = 0x57F287
RED = 0xED4245
GOLD = 0xC9A84C
PURPLE = 0x9B59B6

# Discord limits a single message to 10 embeds — chunk if we exceed
DISCORD_MAX_EMBEDS = 10
# Between-message delay (avoid Discord rate limit on the webhook)
DISCORD_POST_DELAY = 0.6


# ── DB layer ───────────────────────────────────────────────────────────────

def init_db():
    """Create tables if missing. Idempotent — safe to call on every request."""
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=30)
    try:
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("""
            CREATE TABLE IF NOT EXISTS dedupe (
                ticker TEXT PRIMARY KEY,
                last_fired_at TEXT NOT NULL
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )
        """)
        # Seed default — alerts enabled out of the box
        conn.execute(
            "INSERT OR IGNORE INTO settings (key, value) VALUES ('enabled', '1')"
        )
        conn.commit()
    finally:
        conn.close()


@contextmanager
def _conn():
    init_db()
    c = sqlite3.connect(DB_PATH, timeout=30)
    c.execute("PRAGMA journal_mode=WAL")
    c.execute("PRAGMA synchronous=NORMAL")
    try:
        yield c
        c.commit()
    finally:
        c.close()


# ── Settings ──────────────────────────────────────────────────────────────

def get_setting(key: str, default: str = "") -> str:
    with _conn() as c:
        row = c.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
        return row[0] if row else default


def set_setting(key: str, value: str) -> None:
    with _conn() as c:
        c.execute(
            "INSERT INTO settings (key, value) VALUES (?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (key, value),
        )


def is_enabled() -> bool:
    return get_setting("enabled", "1") == "1"


# ── Dedupe ────────────────────────────────────────────────────────────────

def is_deduped(ticker: str) -> bool:
    """Return True if this ticker fired within DEDUPE_HOURS — should skip."""
    with _conn() as c:
        row = c.execute(
            "SELECT last_fired_at FROM dedupe WHERE ticker=?", (ticker,)
        ).fetchone()
    if not row:
        return False
    try:
        last = datetime.fromisoformat(row[0])
        return (datetime.now(ET) - last) < timedelta(hours=DEDUPE_HOURS)
    except (ValueError, TypeError):
        return False


def mark_fired(ticker: str) -> None:
    """Record this ticker as fired now. Atomic upsert."""
    now = datetime.now(ET).isoformat()
    with _conn() as c:
        c.execute(
            "INSERT INTO dedupe (ticker, last_fired_at) VALUES (?, ?) "
            "ON CONFLICT(ticker) DO UPDATE SET last_fired_at=excluded.last_fired_at",
            (ticker, now),
        )


def get_dedupe_state() -> list[dict]:
    """All current dedupe entries (most recent first). For admin visibility."""
    with _conn() as c:
        rows = c.execute(
            "SELECT ticker, last_fired_at FROM dedupe ORDER BY last_fired_at DESC"
        ).fetchall()
    return [{"ticker": r[0], "last_fired_at": r[1]} for r in rows]


def clear_dedupe(ticker: str | None = None) -> int:
    """Clear dedupe state. Pass ticker to clear one, None to clear all.
    Returns number of rows removed."""
    with _conn() as c:
        if ticker:
            cur = c.execute("DELETE FROM dedupe WHERE ticker=?", (ticker,))
        else:
            cur = c.execute("DELETE FROM dedupe")
        return cur.rowcount


# ── Formatting helpers ─────────────────────────────────────────────────────

def _fmt(n: float) -> str:
    """$1.5M / $250K / $1.2B style. Carries sign."""
    a = abs(n)
    sign = "-" if n < 0 else ""
    if a >= 1e9:
        return f"{sign}${a / 1e9:.1f}B"
    if a >= 10e6:
        return f"{sign}${a / 1e6:.0f}M"
    if a >= 1e6:
        return f"{sign}${a / 1e6:.1f}M"
    if a >= 1e3:
        return f"{sign}${a / 1e3:.0f}K"
    return f"{sign}${a:.0f}"


def _fmt_exp(exp: str) -> str:
    """6/20/2026 → 6/20 ; 06-20-2026 → 6/20"""
    if not exp:
        return "?"
    parts = str(exp).replace("-", "/").split("/")
    if len(parts) >= 2:
        try:
            return f"{int(parts[0])}/{int(parts[1])}"
        except ValueError:
            pass
    return str(exp)[:5]


def _fmt_strike(strike) -> str:
    try:
        s = float(strike)
        return f"${int(s)}" if s == int(s) else f"${s:g}"
    except (ValueError, TypeError):
        return f"${strike}"


def _safe(d: dict, *keys, default=None):
    """Pull first non-empty value from candidate keys. Handles the CP/cp,
    K/strike, E/exp dual-naming convention used across the codebase."""
    for k in keys:
        v = d.get(k) if d else None
        if v is not None and v != "":
            return v
    return default


# ── Tier 1: Flow Pulse summary embed ───────────────────────────────────────

def build_flow_pulse_embed(payload: dict) -> dict:
    """One summary embed per upload.

    Expected payload:
      {
        "totalBull": 164500000, "totalBear": 84300000,
        "tickerCount": 462,
        "leadTicker": {"sym": "NVDA", "net": 24300000},
        "standouts": [
          {"sym": "TSLA", "net": 12000000, "grade": "A+"},
          ...
        ],
        "dateLabel": "May 30, 2026",
      }
    """
    total_bull = float(payload.get("totalBull") or 0)
    total_bear = float(payload.get("totalBear") or 0)
    net = total_bull - total_bear
    total = total_bull + total_bear
    bull_pct = round(total_bull / total * 100) if total > 0 else 50

    bar_w = 12
    if total > 0:
        bull_blocks = max(1, min(bar_w - 1, round(bar_w * bull_pct / 100)))
    else:
        bull_blocks = bar_w // 2
    bear_blocks = bar_w - bull_blocks
    bar = "🟢" * bull_blocks + "🔴" * bear_blocks

    net_emoji = "🟢" if net >= 0 else "🔴"
    net_sign = "+" if net >= 0 else ""

    date_label = payload.get("dateLabel") or datetime.now(ET).strftime("%B %d, %Y")

    lines = [
        f"**{net_sign}{_fmt(net)} NET**",
        bar,
        f"🟢 {_fmt(total_bull)}  •  🔴 {_fmt(total_bear)}",
    ]

    lead = payload.get("leadTicker") or {}
    if lead.get("sym"):
        ln = float(lead.get("net") or 0)
        ls = "+" if ln >= 0 else ""
        lines.append(f"\nLed by **{lead['sym']}** ({ls}{_fmt(ln)})")

    standouts = payload.get("standouts") or []
    if standouts:
        s_lines = []
        for s in standouts[:5]:
            sn = float(s.get("net") or 0)
            ss = "+" if sn >= 0 else ""
            grade = s.get("grade", "")
            grade_tag = f" `{grade}`" if grade else ""
            s_lines.append(f"• **{s['sym']}**{grade_tag} {ss}{_fmt(sn)}")
        lines.append("\n**Standouts**\n" + "\n".join(s_lines))

    ticker_count = int(payload.get("tickerCount") or 0)
    now = datetime.now(ET)
    time_str = now.strftime("%I:%M %p ET")

    return {
        "color": GOLD,
        "author": {"name": "UCT Options Flow"},
        "title": f"{net_emoji} FLOW PULSE — {date_label}",
        "description": "\n".join(lines),
        "footer": {"text": f"{ticker_count} tickers · UCT Intelligence · {time_str}"},
    }


# ── Tier 2: Hot Ticker embed ───────────────────────────────────────────────

# Map trigger codes to display labels. NEW = first appearance in data window;
# BIG_A = directional + premium concentration; OUTSIZED = cap-relative.
_TRIGGER_LABELS = {
    "NEW": "🆕 NEW",
    "BIG_A": "💎 BIG + A",
    "OUTSIZED": "📊 OUTSIZED",
    "MANUAL": "🚨 MANUAL",
}

# Pattern badge labels (match frontend Top Flow tags)
_PATTERN_LABELS = {
    "IV_SURGE": "IV↑",
    "SIDE_FLIP": "FLIP",
    "HEAVY": "HEAVY",
    "PRICE_SURGE": "PX↑",
    "PX_SURGE": "PX↑",
}


def build_hot_ticker_embed(item: dict) -> dict:
    """One embed per notable ticker.

    Expected payload (per ticker):
      {
        "sym": "NVDA",
        "dir": "BULL" | "BEAR",
        "topContract": {
          "cp": "C", "K": 950, "exp": "6/20/2026",
          "prem": 12500000, "hits": 14, "grade": "A+", "side": "AA"
        },
        "tickerBull": 28000000, "tickerBear": 3700000,
        "trigger": "NEW" | "BIG_A" | "OUTSIZED" | "MANUAL",
        "patterns": [{"type": "IV_SURGE"}, ...],
        "er": false,
        "sector": "Technology",
        "mktcap": 1.9e12,
      }
    """
    direction = (item.get("dir") or "BULL").upper()
    color = GREEN if direction == "BULL" else RED
    dir_emoji = "🟢" if direction == "BULL" else "🔴"

    sym = item.get("sym") or "???"
    trigger = item.get("trigger") or "HOT"
    trig_label = _TRIGGER_LABELS.get(trigger, "🔥 HOT")

    title = f"{dir_emoji} {sym} — {trig_label}"

    top = item.get("topContract") or {}
    cp = (_safe(top, "cp", "CP", default="?") or "?")[:1].upper()
    K = _safe(top, "K", "strike", default=0)
    exp = _safe(top, "exp", "E", default="")
    prem = float(_safe(top, "prem", "P", default=0) or 0)
    hits = int(_safe(top, "hits", "H", default=0) or 0)
    grade = _safe(top, "grade", "G", default="") or ""
    side = _safe(top, "side", "Si", default="") or ""

    contract_parts = [f"**{_fmt_strike(K)}{cp}** {_fmt_exp(exp)}", _fmt(prem), f"{hits}x"]
    if grade:
        contract_parts.append(f"grade `{grade}`")
    if side:
        contract_parts.append(side)
    contract_line = " · ".join(contract_parts)

    tk_bull = float(item.get("tickerBull") or 0)
    tk_bear = float(item.get("tickerBear") or 0)
    net = tk_bull - tk_bear
    net_sign = "+" if net >= 0 else ""

    total = tk_bull + tk_bear
    bull_pct = round(tk_bull / total * 100) if total > 0 else 50
    bar_w = 10
    if total > 0:
        bull_blocks = max(1, min(bar_w - 1, round(bar_w * bull_pct / 100)))
    else:
        bull_blocks = bar_w // 2
    bear_blocks = bar_w - bull_blocks
    bar = "🟢" * bull_blocks + "🔴" * bear_blocks

    lines = [
        contract_line,
        "",
        f"**{net_sign}{_fmt(net)} NET** {bar}",
        f"🟢 {_fmt(tk_bull)}  •  🔴 {_fmt(tk_bear)}",
    ]

    # Pattern badges
    patterns = item.get("patterns") or []
    p_labels = []
    for p in patterns:
        if isinstance(p, dict):
            pt = (p.get("type") or "").upper()
        else:
            pt = str(p).upper()
        lbl = _PATTERN_LABELS.get(pt)
        if lbl:
            p_labels.append(f"`{lbl}`")
    if p_labels:
        lines.append(f"\nPatterns: {' '.join(p_labels)}")

    if item.get("er"):
        lines.append("\n⚠️ Earnings on deck")

    sector = item.get("sector") or ""
    if sector:
        lines.append(f"\n_{sector}_")

    return {
        "color": color,
        "title": title,
        "description": "\n".join(lines),
    }


# ── Discord transport ─────────────────────────────────────────────────────

async def _send_messages(messages: list[dict]) -> tuple[bool, str | None]:
    """POST a list of Discord webhook messages with rate-limit-friendly spacing.
    Returns (ok, error_or_None)."""
    if not messages:
        return True, None
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            for i, msg in enumerate(messages):
                resp = await client.post(DISCORD_NOTABLE_WEBHOOK_URL, json=msg)
                resp.raise_for_status()
                if i < len(messages) - 1:
                    await asyncio.sleep(DISCORD_POST_DELAY)
        return True, None
    except httpx.HTTPStatusError as e:
        body_preview = ""
        try:
            body_preview = e.response.text[:200]
        except Exception:
            pass
        return False, f"HTTP {e.response.status_code}: {body_preview}"
    except Exception as e:
        return False, str(e)


def _chunk_embeds(embeds: list[dict]) -> list[dict]:
    """Pack embeds into messages of <=10 each (Discord limit)."""
    messages = []
    chunk = []
    for e in embeds:
        if len(chunk) >= DISCORD_MAX_EMBEDS:
            messages.append({"embeds": chunk})
            chunk = []
        chunk.append(e)
    if chunk:
        messages.append({"embeds": chunk})
    return messages


# ── Main entry: full post (Tier 1 + Tier 2) ──────────────────────────────

async def post_flow_pulse(
    pulse_payload: dict,
    hot_tickers: list[dict] | None = None,
) -> dict:
    """Send the Tier 1 Flow Pulse and any non-deduped Tier 2 hot ticker alerts.

    Tier 1 always fires when alerts are enabled (it's the post-upload summary).
    Tier 2 ticker embeds are filtered through the 24h dedupe before sending.
    """
    if not DISCORD_NOTABLE_WEBHOOK_URL:
        logger.error("[NotableFlow] No DISCORD_NOTABLE_WEBHOOK_URL configured")
        return {"ok": False, "error": "No webhook URL configured"}

    if not is_enabled():
        return {"ok": False, "error": "Notable Flow alerts disabled", "disabled": True}

    embeds: list[dict] = [build_flow_pulse_embed(pulse_payload or {})]

    fired: list[str] = []
    deduped: list[str] = []
    for tk in (hot_tickers or []):
        sym = tk.get("sym")
        if not sym:
            continue
        if is_deduped(sym):
            deduped.append(sym)
            continue
        embeds.append(build_hot_ticker_embed(tk))
        fired.append(sym)

    messages = _chunk_embeds(embeds)
    ok, err = await _send_messages(messages)
    if not ok:
        logger.error("[NotableFlow] Post failed: %s", err)
        return {"ok": False, "error": err, "fired": [], "deduped": deduped}

    # Only mark fired AFTER successful Discord delivery — otherwise a transient
    # webhook failure would silently dedupe the ticker for 24h.
    for sym in fired:
        mark_fired(sym)

    logger.info(
        "[NotableFlow] Posted — %d msgs, %d hot tickers fired (%s), %d deduped",
        len(messages), len(fired), ",".join(fired) or "-", len(deduped),
    )
    return {
        "ok": True,
        "messages_sent": len(messages),
        "fired": fired,
        "deduped": deduped,
    }


# ── Manual single-ticker post (🚨 button) ────────────────────────────────

async def post_single_ticker(item: dict, force: bool = True) -> dict:
    """Manual 🚨 button — push one ticker embed off-criteria.

    force=True (default) bypasses dedupe. Set force=False to honor the
    24h window even on manual presses."""
    if not DISCORD_NOTABLE_WEBHOOK_URL:
        return {"ok": False, "error": "No webhook URL configured"}

    sym = item.get("sym")
    if not sym:
        return {"ok": False, "error": "Missing 'sym' in payload"}

    if not force and is_deduped(sym):
        return {
            "ok": False,
            "deduped": True,
            "error": f"{sym} fired within last {DEDUPE_HOURS}h — pass force=true to override",
        }

    # Stamp the trigger as MANUAL so the embed badge reflects how it got there
    item = dict(item)
    item.setdefault("trigger", "MANUAL")

    embed = build_hot_ticker_embed(item)
    ok, err = await _send_messages([{"embeds": [embed]}])
    if not ok:
        logger.error("[NotableFlow] Manual post failed (%s): %s", sym, err)
        return {"ok": False, "error": err}

    mark_fired(sym)
    logger.info("[NotableFlow] Manual alert fired — %s", sym)
    return {"ok": True, "sym": sym}
