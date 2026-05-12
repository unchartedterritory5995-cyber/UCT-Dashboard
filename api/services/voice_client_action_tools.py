"""
Voice client-action tools — open_page and read_aloud.

These are unusual because the actual work happens on the client. The
server tool just returns a normalized "client_action" envelope that
useRealtimeSession picks up and dispatches locally before forwarding the
result to the model.

If the model receives `ok: true` it can narrate "opening journal" and
move on. The frontend handler completes the navigation independently.
"""

# App route names → URL paths. Voice-recognized synonyms map to the same
# canonical name. The frontend handler does the actual navigate.
PAGE_ALIASES: dict[str, str] = {
    "dashboard": "/dashboard", "home": "/dashboard", "main": "/dashboard",

    "morning wire": "/morning-wire", "morning-wire": "/morning-wire",
    "morning": "/morning-wire", "wire": "/morning-wire", "rundown": "/morning-wire",

    "uct20": "/uct20", "uct 20": "/uct20", "leadership": "/uct20",
    "uct twenty": "/uct20", "top picks": "/uct20",

    "breadth": "/breadth", "market breadth": "/breadth",
    "breadth monitor": "/breadth",

    "themes": "/theme-tracker", "theme tracker": "/theme-tracker",
    "theme": "/theme-tracker",

    "calendar": "/calendar", "events": "/calendar", "earnings calendar": "/calendar",

    "traders": "/traders",

    "screener": "/screener", "scanner": "/screener",

    "options": "/options-flow", "options flow": "/options-flow",
    "flow": "/options-flow",

    "post market": "/post-market", "post-market": "/post-market",
    "after hours": "/post-market",

    "model book": "/model-book", "modelbook": "/model-book",

    "journal": "/journal", "trade journal": "/journal", "my journal": "/journal",
    "journal 2": "/journal", "j2": "/journal",

    "watchlists": "/watchlists", "watchlist": "/watchlists",
    "my lists": "/watchlists", "lists": "/watchlists",

    "community": "/community",
    "support": "/support", "help": "/support",
    "settings": "/settings", "preferences": "/settings",

    "setup library": "/setup-library", "setups": "/setup-library",
}


# Read-aloud content keys → resolver hints for the frontend.
# The frontend hook chooses which TTS source to play based on these keys.
READ_ALOUD_TARGETS = {
    "morning wire", "morning-wire", "wire", "rundown", "morning rundown",
    "earnings transcript", "transcript", "transcripts",
    "uct20 picks", "uct 20 picks", "leadership picks", "top picks",
    "setup library", "setups", "setup",
    "daily note", "today's note", "my note",
    "weekly review", "weekly recap", "week recap",
    "morning briefing", "morning brief", "brief me",
    "closing briefing", "closing recap", "eod recap",
}


def _norm_route(name: str) -> tuple[str | None, str | None]:
    """Return (path, canonical_label) for a page name, or (None, None)."""
    k = (name or "").strip().lower()
    if not k:
        return None, None
    if k in PAGE_ALIASES:
        return PAGE_ALIASES[k], k
    for alias, path in PAGE_ALIASES.items():
        if k in alias or alias in k:
            return path, alias
    return None, None


def open_page(*, name: str) -> dict:
    """Navigate to a named page. Client-side action."""
    path, label = _norm_route(name)
    if not path:
        valid = sorted({v for v in PAGE_ALIASES.values()})
        return {
            "ok": False,
            "narration": (
                f"I don't have a page called {name!r}. "
                "Try Journal, Watchlists, Themes, Breadth, Calendar, Scanner, "
                "Morning Wire, UCT 20, or Settings."
            ),
            "available": valid,
        }
    return {
        "ok": True,
        "narration": f"Opening {label}.",
        "client_action": {"type": "navigate", "path": path, "label": label},
    }


def _norm_content_key(content: str) -> str:
    k = (content or "").strip().lower()
    if not k:
        return ""
    if k in READ_ALOUD_TARGETS:
        return k
    for target in READ_ALOUD_TARGETS:
        if k in target or target in k:
            return target
    return k


def read_aloud(*, content: str) -> dict:
    """Trigger TTS playback of a known content type. Client-side action."""
    k = _norm_content_key(content)
    if not k:
        return {
            "ok": False,
            "narration": (
                "Which? I can read the Morning Wire, an earnings transcript, "
                "the UCT 20 picks, today's daily note, or the morning briefing."
            ),
        }
    return {
        "ok": True,
        "narration": f"Reading {k}.",
        "client_action": {"type": "read_aloud", "content": k},
    }


# ── Chart actions (Batch 7c) — dispatched via global chartBus on the client ──

def open_ticker(*, symbol: str) -> dict:
    """Open the TickerPopup modal for a symbol from anywhere in the app."""
    sym = (symbol or "").strip().upper()
    if not sym:
        return {"ok": False, "narration": "Which ticker?"}
    return {
        "ok": True,
        "narration": f"Opening {sym}.",
        "client_action": {"type": "open_ticker", "symbol": sym},
    }


def change_chart_timeframe(*, timeframe: str) -> dict:
    """Flip the current chart's timeframe (5m / 30m / 1h / D / W / M)."""
    if not timeframe:
        return {"ok": False, "narration": "Switch to which timeframe?"}
    return {
        "ok": True,
        "narration": f"Switching to {timeframe}.",
        "client_action": {"type": "change_chart_timeframe", "timeframe": timeframe},
    }


_INDICATOR_ALIASES = {
    "v-wap": "vwap", "anchored vwap": "avwap", "anchored": "avwap",
    "fifty moving average": "ma50", "200 moving average": "ma200",
    "200 day": "ma200", "50 day": "ma50",
    "bollinger": "bb", "bollinger bands": "bb",
    "macd": "macd", "rsi": "rsi",
}


def add_chart_indicator(*, name: str) -> dict:
    """Add an overlay/indicator to the current chart."""
    raw = (name or "").strip().lower()
    if not raw:
        return {"ok": False, "narration": "Which indicator? VWAP, 50 MA, RSI, MACD…"}
    resolved = _INDICATOR_ALIASES.get(raw, raw.replace(" ", ""))
    return {
        "ok": True,
        "narration": f"Adding {resolved}.",
        "client_action": {"type": "add_chart_indicator", "indicator": resolved},
    }


def change_chart_type(*, chart_type: str) -> dict:
    """Switch chart type (candles / hollow / bars / line / area)."""
    raw = (chart_type or "").strip().lower()
    if not raw:
        return {"ok": False, "narration": "Which chart type? Candles, line, or area?"}
    return {
        "ok": True,
        "narration": f"Switching to {raw}.",
        "client_action": {"type": "change_chart_type", "chartType": raw},
    }
