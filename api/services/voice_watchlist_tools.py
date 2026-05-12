"""
Voice watchlist tools — single-step writes for flag/tag/list/alert actions.

These are intentionally NOT two-phase. Flagging a stock or tagging it is
low-risk and trivially reversible by voice ("unflag NVDA"). Requiring
confirmation for these would make the assistant feel slow and clumsy.

Heavy writes (open/close position, edit a journal entry) keep the
preview/confirm flow in voice_write_tools.py.
"""

import logging

from api.services import (
    watchlist_service,
    ticker_tag_service,
    watchlist_alert_service,
)

_log = logging.getLogger(__name__)

# UI tag colors — must match app/src/constants/tagColors.js
ALLOWED_TAG_COLORS = {"green", "blue", "orange", "red", "purple", "gold", "teal"}


def _norm_sym(sym: str) -> str:
    return (sym or "").strip().upper()


def _norm_color(color: str) -> str:
    c = (color or "").strip().lower()
    # Common voice misrecognitions
    aliases = {"gold star": "gold", "yellow": "gold", "amber": "orange",
               "navy": "blue", "crimson": "red", "violet": "purple"}
    return aliases.get(c, c)


# ── Flag / unflag ──────────────────────────────────────────────────────────

def flag_ticker(*, symbol: str, user_id: str) -> dict:
    sym = _norm_sym(symbol)
    if not sym:
        return {"ok": False, "narration": "I need a ticker symbol to flag."}
    wl = watchlist_service.get_or_create_flagged_list(user_id)
    wl_id = wl["id"]
    existing_syms = {item["sym"] for item in (wl.get("items") or [])}
    if sym in existing_syms:
        return {"ok": True, "narration": f"{sym} is already flagged.", "symbol": sym}
    watchlist_service.add_item(user_id, wl_id, sym, "")
    return {"ok": True, "narration": f"Flagged {sym}.", "symbol": sym}


def unflag_ticker(*, symbol: str, user_id: str) -> dict:
    sym = _norm_sym(symbol)
    if not sym:
        return {"ok": False, "narration": "I need a ticker to unflag."}
    wl = watchlist_service.get_or_create_flagged_list(user_id)
    wl_id = wl["id"]
    for item in (wl.get("items") or []):
        if item["sym"] == sym:
            watchlist_service.remove_item(user_id, wl_id, item["id"])
            return {"ok": True, "narration": f"Unflagged {sym}.", "symbol": sym}
    return {"ok": False, "narration": f"{sym} is not in your flagged list."}


# ── Tag / untag ────────────────────────────────────────────────────────────

def tag_ticker(*, symbol: str, color: str, user_id: str) -> dict:
    sym = _norm_sym(symbol)
    col = _norm_color(color)
    if not sym:
        return {"ok": False, "narration": "I need a ticker to tag."}
    if col not in ALLOWED_TAG_COLORS:
        return {
            "ok": False,
            "narration": (
                f"I don't have a {color or 'that'} tag color. "
                "Choose from green, blue, orange, red, purple, gold, or teal."
            ),
        }
    ticker_tag_service.set_tag(user_id, sym, col)
    return {"ok": True, "narration": f"Tagged {sym} {col}.", "symbol": sym, "color": col}


def untag_ticker(*, symbol: str, user_id: str) -> dict:
    sym = _norm_sym(symbol)
    if not sym:
        return {"ok": False, "narration": "I need a ticker to untag."}
    removed = ticker_tag_service.remove_tag(user_id, sym)
    if removed:
        return {"ok": True, "narration": f"Removed tag from {sym}.", "symbol": sym}
    return {"ok": False, "narration": f"{sym} was not tagged."}


def list_my_tags(*, user_id: str) -> dict:
    tags = ticker_tag_service.get_user_tags(user_id) or {}
    if not tags:
        return {"ok": True, "narration": "You have no tagged tickers.", "tags": {}, "count": 0}
    by_color: dict[str, list[str]] = {}
    for sym, col in tags.items():
        by_color.setdefault(col, []).append(sym)
    parts = []
    for col, syms in sorted(by_color.items()):
        if len(syms) <= 4:
            parts.append(f"{col}: {', '.join(sorted(syms))}")
        else:
            parts.append(f"{col}: {len(syms)} tickers")
    narration = "Your tags — " + "; ".join(parts) + "."
    return {"ok": True, "narration": narration, "tags": tags, "count": len(tags)}


# ── Watchlist add / remove / list ──────────────────────────────────────────

def _find_watchlist_by_name(user_id: str, name: str) -> dict | None:
    """Case-insensitive fuzzy match on the user's watchlists."""
    target = (name or "").strip().lower()
    if not target:
        return None
    lists = watchlist_service.list_user_watchlists(user_id) or []
    # Exact match first
    for wl in lists:
        if (wl.get("name") or "").strip().lower() == target:
            return wl
    # Substring match
    for wl in lists:
        if target in (wl.get("name") or "").strip().lower():
            return wl
    return None


def add_to_watchlist(*, symbol: str, list_name: str, user_id: str) -> dict:
    sym = _norm_sym(symbol)
    if not sym:
        return {"ok": False, "narration": "I need a ticker to add."}
    if not (list_name or "").strip():
        return {"ok": False, "narration": "Which watchlist should I add it to?"}

    wl = _find_watchlist_by_name(user_id, list_name)
    if not wl:
        return {
            "ok": False,
            "narration": f"I couldn't find a watchlist called {list_name!r}. "
                         "Say 'list my watchlists' to hear the names.",
        }
    existing = {item["sym"] for item in (wl.get("items") or [])}
    if sym in existing:
        return {"ok": True, "narration": f"{sym} is already in {wl['name']}.",
                "symbol": sym, "list": wl["name"]}
    watchlist_service.add_item(user_id, wl["id"], sym, "")
    return {"ok": True, "narration": f"Added {sym} to {wl['name']}.",
            "symbol": sym, "list": wl["name"]}


def remove_from_watchlist(*, symbol: str, list_name: str, user_id: str) -> dict:
    sym = _norm_sym(symbol)
    if not sym:
        return {"ok": False, "narration": "I need a ticker to remove."}
    wl = _find_watchlist_by_name(user_id, list_name)
    if not wl:
        return {"ok": False, "narration": f"I couldn't find {list_name!r}."}
    for item in (wl.get("items") or []):
        if item["sym"] == sym:
            watchlist_service.remove_item(user_id, wl["id"], item["id"])
            return {"ok": True, "narration": f"Removed {sym} from {wl['name']}.",
                    "symbol": sym, "list": wl["name"]}
    return {"ok": False, "narration": f"{sym} wasn't in {wl['name']}."}


def list_my_watchlists(*, user_id: str) -> dict:
    lists = watchlist_service.list_user_watchlists(user_id) or []
    if not lists:
        return {"ok": True, "narration": "You don't have any watchlists yet.",
                "lists": [], "count": 0}
    summary = [
        {"name": wl.get("name"), "count": len(wl.get("items") or [])}
        for wl in lists
    ]
    if len(summary) <= 5:
        parts = [f"{s['name']} ({s['count']})" for s in summary]
        narration = "Your watchlists — " + ", ".join(parts) + "."
    else:
        narration = f"You have {len(summary)} watchlists."
    return {"ok": True, "narration": narration, "lists": summary, "count": len(summary)}


# ── Price alerts ───────────────────────────────────────────────────────────

def set_price_alert(*, symbol: str, target_price: float, direction: str,
                    user_id: str) -> dict:
    sym = _norm_sym(symbol)
    if not sym:
        return {"ok": False, "narration": "I need a ticker for the alert."}
    try:
        price = float(target_price)
    except (TypeError, ValueError):
        return {"ok": False, "narration": "That price didn't parse as a number."}
    if price <= 0 or price > 1_000_000:
        return {"ok": False, "narration": f"{price} is out of range."}
    d = (direction or "").strip().lower()
    if d in ("up", "over", "above", "higher", "high"):
        d = "above"
    elif d in ("down", "under", "below", "lower", "low"):
        d = "below"
    else:
        return {"ok": False, "narration": "Should that alert fire above or below the price?"}
    watchlist_alert_service.create_alert(user_id, sym, price, d)
    return {
        "ok": True,
        "narration": f"Alert set on {sym} {d} {price}.",
        "symbol": sym, "target_price": price, "direction": d,
    }


def list_my_alerts(*, user_id: str) -> dict:
    alerts = watchlist_alert_service.list_user_alerts(user_id, active_only=True) or []
    if not alerts:
        return {"ok": True, "narration": "You have no active price alerts.",
                "alerts": [], "count": 0}
    parts = [f"{a['sym']} {a['direction']} {a['target_price']}" for a in alerts[:6]]
    narration = f"You have {len(alerts)} active alerts — " + ", ".join(parts)
    if len(alerts) > 6:
        narration += f", plus {len(alerts) - 6} more"
    narration += "."
    return {"ok": True, "narration": narration,
            "alerts": [{"sym": a["sym"], "target_price": a["target_price"],
                        "direction": a["direction"]} for a in alerts],
            "count": len(alerts)}


def cancel_alert(*, symbol: str, user_id: str) -> dict:
    """Cancel the most recent active alert for a symbol."""
    sym = _norm_sym(symbol)
    if not sym:
        return {"ok": False, "narration": "Cancel which symbol's alert?"}
    alerts = watchlist_alert_service.list_user_alerts(user_id, active_only=True) or []
    matches = [a for a in alerts if a["sym"] == sym]
    if not matches:
        return {"ok": False, "narration": f"No active alerts on {sym}."}
    # Newest first (list_user_alerts orders by created_at DESC)
    target = matches[0]
    deleted = watchlist_alert_service.delete_alert(user_id, target["id"])
    if deleted:
        return {"ok": True, "narration": f"Cancelled {sym} alert at {target['target_price']}.",
                "symbol": sym}
    return {"ok": False, "narration": f"Couldn't cancel that alert."}
