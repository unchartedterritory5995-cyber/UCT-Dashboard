"""Journal 2.0 — deterministic AI-suggested mistake/emotion tags (P6-4).

Given a CLOSED trade + a couple of pre-computed signals, suggest the
mistake/emotion tags the trader most likely should apply. **DETERMINISTIC
heuristics only** — no LLM in v1. The two v1 signals:

  - **no-stop** → mistake ``no_stop``: the trade had no real stop logged
    (``originalStop == entryPrice`` OR ``rMultiple`` is ``None`` — the §14.5
    "entry == stop ⇒ R null" edge, and the broker-import placeholder where
    ``stop_price == entry_price``).
  - **revenge** (caller computes the flag via ``revenge_detect.detect``) →
    mistake ``revenge`` + emotion ``revenge-driven``: a same-symbol re-entry
    shortly after a loss on that name.

Every suggestion is filtered against the account taxonomy (only tags the
account actually offers are suggested) and against the trade's already-applied
tags (never re-suggest something already on the trade). A clean trade → empty
lists.

Pure + deterministic + side-effect-free: no DB, no clock, no mutation of
inputs. The endpoint (``journal_two`` router) supplies the revenge flag and the
resolved taxonomy.
"""
from __future__ import annotations

from typing import Any


# Python-side default vocab — mirrors the FE STANDARD_MISTAKES /
# STANDARD_EMOTIONS in PortfolioSettingsModal.jsx (and RapidTagFlow.jsx). Used
# as the taxonomy fallback when an account's list is empty. Keep in sync.
STANDARD_MISTAKES = [
    "overtrading", "FOMO", "chasing", "early_exit", "late_entry",
    "no_stop", "oversized", "countertrend", "revenge", "ignored_thesis",
    "added_to_loser", "cut_winner", "broke_loss_rule", "broke_size_rule",
    "broke_checklist", "boredom", "hesitation",
]
STANDARD_EMOTIONS = [
    "confident", "anxious", "greedy", "fearful", "calm", "frustrated",
    "euphoric", "bored", "disciplined", "impulsive", "patient", "rushed",
    "focused", "distracted", "revenge-driven",
]

_NO_STOP_REASON = "No stop was logged on this trade."


def _has_no_stop(trade: dict[str, Any]) -> bool:
    """True when the trade had no real stop logged. Defensive on missing keys.

    Two equivalent tells (see §14.5): a null ``rMultiple`` (risk-per-share was
    zero → R undefined), or ``originalStop`` equal to ``entryPrice`` (blank stop
    defaulted to entry; broker placeholder stop). Either → suggest ``no_stop``.
    """
    if "rMultiple" in trade and trade.get("rMultiple") is None:
        return True
    stop = trade.get("originalStop")
    entry = trade.get("entryPrice")
    if stop is None or entry is None:
        return False
    try:
        return abs(float(stop) - float(entry)) < 1e-9
    except (TypeError, ValueError):
        return False


def suggest_for_trade(
    trade: dict[str, Any] | None,
    revenge_flag: bool,
    available_mistakes: list[str] | None,
    available_emotions: list[str] | None,
) -> dict[str, Any]:
    """Suggest mistake/emotion tags for one closed trade.

    Returns ``{mistakes: [str], emotions: [str], reasons: {tag: reason}}``.
    Each suggested tag is (a) in the account taxonomy and (b) NOT already
    applied to the trade. A clean trade → empty lists + empty reasons.
    """
    trade = trade or {}
    reasons: dict[str, str] = {}
    mistakes: list[str] = []
    emotions: list[str] = []

    avail_m = set(available_mistakes or [])
    avail_e = set(available_emotions or [])
    applied_m = set(trade.get("mistakeTags") or [])
    applied_e = set(trade.get("emotionTags") or [])
    symbol = trade.get("symbol") or "this name"

    def add_mistake(tag: str, reason: str) -> None:
        if tag in avail_m and tag not in applied_m and tag not in mistakes:
            mistakes.append(tag)
            reasons[tag] = reason

    def add_emotion(tag: str, reason: str) -> None:
        if tag in avail_e and tag not in applied_e and tag not in emotions:
            emotions.append(tag)
            reasons[tag] = reason

    # ── no-stop heuristic ────────────────────────────────────────────────────
    if _has_no_stop(trade):
        add_mistake("no_stop", _NO_STOP_REASON)

    # ── revenge heuristic (caller supplies the flag) ─────────────────────────
    if revenge_flag:
        revenge_reason = f"Re-entered {symbol} shortly after a loss on it."
        add_mistake("revenge", revenge_reason)
        add_emotion("revenge-driven", revenge_reason)

    return {"mistakes": mistakes, "emotions": emotions, "reasons": reasons}
