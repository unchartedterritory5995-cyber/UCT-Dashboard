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
