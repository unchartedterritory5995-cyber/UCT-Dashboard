"""
Agentic flow orchestrations for the voice assistant.

Each flow is a single function that chains multiple existing services
and assembles a coherent narration. Triggered via voice tools — see
voice_tool_impls.py for the registrations.

Design principles:
- Each flow returns {narration: str, sections: list[str]}.
- Narration is what the model speaks. Capped at ~800 chars.
- If any sub-service fails, that section gets a one-line fallback;
  the whole flow does NOT fail.
- Flows are fast (~200ms each) since they call already-cached data.
"""

import logging
from datetime import datetime

_log = logging.getLogger(__name__)

MAX_NARRATION_CHARS = 800


# ── Indirection helpers (monkeypatchable in tests) ──────────────────────────

def _get_breadth() -> dict:
    try:
        from api.services.engine import get_breadth
        return get_breadth() or {}
    except Exception:
        return {}


def _get_themes() -> dict:
    try:
        from api.services.engine import get_themes
        return get_themes() or {}
    except Exception:
        return {}


def _get_earnings() -> dict:
    try:
        from api.services.engine import get_earnings
        return get_earnings() or {}
    except Exception:
        return {}


def _get_snapshot(sym: str) -> dict:
    try:
        from api.services.massive import get_ticker_snapshot
        return get_ticker_snapshot(sym) or {}
    except Exception:
        return {}


def _get_movers() -> dict:
    try:
        from api.services.massive import get_movers
        return get_movers() or {}
    except Exception:
        return {}


def _parse_pct(value) -> float:
    if value is None:
        return 0.0
    if isinstance(value, (int, float)):
        return float(value)
    s = str(value).strip().replace("%", "").replace("+", "")
    try:
        return float(s)
    except ValueError:
        return 0.0


def _truncate(text: str, max_chars: int = MAX_NARRATION_CHARS) -> str:
    if len(text) <= max_chars:
        return text
    cut = text[:max_chars]
    if "." in cut[-100:]:
        return cut[:cut.rfind(".") + 1]
    return cut


# ── Flows ──────────────────────────────────────────────────────────────────

def morning_briefing(*, user_id: str) -> dict:
    """Today's market posture + leaders + earnings + open positions snapshot."""
    sections = []

    breadth = _get_breadth()
    if breadth:
        adv = int(breadth.get("advancing") or 0)
        dec = int(breadth.get("declining") or 0)
        phase = breadth.get("market_phase") or "no clear regime"
        score = breadth.get("breadth_score") or breadth.get("uct_exposure_rating")
        score_str = f", UCT exposure rating {score}" if score is not None else ""
        sections.append(
            f"Market posture: {phase}. Advancers {adv}, decliners {dec}{score_str}."
        )

    themes = _get_themes()
    leaders = (themes.get("leaders") or [])[:3]
    if leaders:
        lead_str = ", ".join(
            f"{t.get('name')} up {abs(round(_parse_pct(t.get('pct')), 1))} percent"
            for t in leaders
        )
        sections.append(f"Leading themes: {lead_str}.")

    earnings = _get_earnings()
    bmo = earnings.get("bmo") or []
    amc = earnings.get("amc") or []
    syms_today = [str(e.get("sym", "")).upper() for e in bmo[:3] if e.get("sym")]
    if syms_today:
        sections.append(f"Reporting today before the bell: {', '.join(syms_today)}.")
    elif amc:
        amc_syms = [str(e.get("sym", "")).upper() for e in amc[:3] if e.get("sym")]
        if amc_syms:
            sections.append(f"After the close today: {', '.join(amc_syms)}.")

    if not sections:
        narration = "Markets are quiet right now — no fresh data is available. Try again in a few minutes."
    else:
        narration = " ".join(sections)

    return {"narration": _truncate(narration), "sections": sections}


def closing_briefing(*, user_id: str) -> dict:
    """End-of-day recap: movers, breadth, what's on deck tomorrow."""
    sections = []

    movers = _get_movers()
    rip = (movers.get("ripping") or [])[:3]
    drill = (movers.get("drilling") or [])[:3]
    if rip:
        names = ", ".join(f"{m.get('sym')} up {abs(round(_parse_pct(m.get('pct')), 1))} percent" for m in rip)
        sections.append(f"Top performers today: {names}.")
    if drill:
        names = ", ".join(f"{m.get('sym')} down {abs(round(_parse_pct(m.get('pct')), 1))} percent" for m in drill)
        sections.append(f"Weakest names: {names}.")

    breadth = _get_breadth()
    if breadth:
        adv = int(breadth.get("advancing") or 0)
        dec = int(breadth.get("declining") or 0)
        sections.append(f"Breadth closed at {adv} advancers versus {dec} decliners.")

    earnings = _get_earnings()
    bmo_tomorrow = earnings.get("bmo_tomorrow") or earnings.get("bmo") or []
    syms = [str(e.get("sym", "")).upper() for e in bmo_tomorrow[:3] if e.get("sym")]
    if syms:
        sections.append(f"On deck for tomorrow morning: {', '.join(syms)}.")

    if not sections:
        narration = "End of day, but no closing data available yet — try again after the bell."
    else:
        narration = " ".join(sections)

    return {"narration": _truncate(narration), "sections": sections}


def pre_trade_check(*, symbol: str, user_id: str) -> dict:
    """Assemble a quick briefing for one ticker before pulling the trigger."""
    sym = (symbol or "").upper().strip()
    if not sym:
        return {"narration": "I need a ticker to check.", "sections": []}

    sections = []
    snap = _get_snapshot(sym)
    if snap:
        last = float(snap.get("close") or 0)
        chg = float(snap.get("change_pct") or 0)
        direction = "up" if chg > 0 else "down" if chg < 0 else "flat"
        sections.append(
            f"{sym} is trading at {last:.2f}, {direction} {abs(round(chg, 1))} percent."
        )

    breadth = _get_breadth()
    if breadth:
        phase = breadth.get("market_phase") or "uncertain"
        sections.append(f"Broader market is {phase}.")

    themes = _get_themes()
    leaders = (themes.get("leaders") or [])[:2]
    if leaders:
        lead_str = ", ".join(t.get("name") for t in leaders if t.get("name"))
        sections.append(f"Strongest themes right now: {lead_str}.")

    if not sections:
        narration = f"I couldn't pull live data for {sym}. Try again in a moment."
    else:
        sections.append("Sanity-check your entry against your risk plan before sizing in.")
        narration = " ".join(sections)

    return {"narration": _truncate(narration), "sections": sections}


def post_trade_review(*, symbol: str, user_id: str) -> dict:
    """Recap the most recent trade for a symbol."""
    sym = (symbol or "").upper().strip()
    if not sym:
        return {"narration": "I need a ticker to look up.", "sections": []}

    try:
        from api.services.journal_service import list_entries
        result = list_entries(user_id, filters={"sym": sym}, limit=20) or {}
        entries = result.get("trades") or []
    except Exception:
        entries = []

    if not entries:
        return {
            "narration": f"I don't see any recent trades on {sym} in your journal.",
            "sections": [],
        }

    entries_sorted = sorted(entries, key=lambda e: e.get("entry_date") or "", reverse=True)
    last = entries_sorted[0]
    entry = last.get("entry_price")
    exitp = last.get("exit_price")
    pnl_pct = last.get("pnl_pct")
    status = last.get("status") or "open"
    setup = last.get("setup") or ""

    sections = [f"Your most recent {sym} trade — setup {setup or 'unspecified'}, status {status}."]
    if entry:
        sections.append(f"Entry at {entry}.")
    if exitp:
        sections.append(f"Exited at {exitp}.")
    if pnl_pct is not None:
        sections.append(f"Result was {round(float(pnl_pct), 1)} percent.")

    narration = " ".join(sections)
    return {"narration": _truncate(narration), "sections": sections}


def plan_my_day(*, user_id: str) -> dict:
    """Sequenced briefing: what's likely to matter today."""
    sections = []

    earnings = _get_earnings()
    bmo = earnings.get("bmo") or []
    if bmo:
        syms = [str(e.get("sym", "")).upper() for e in bmo[:5] if e.get("sym")]
        if syms:
            sections.append(f"Earnings before the bell: {', '.join(syms)}.")

    breadth = _get_breadth()
    if breadth:
        score = breadth.get("breadth_score") or breadth.get("uct_exposure_rating")
        if score is not None:
            sections.append(f"UCT exposure rating opens at {score}.")
        phase = breadth.get("market_phase")
        if phase:
            sections.append(f"Regime is {phase}.")

    themes = _get_themes()
    leaders = (themes.get("leaders") or [])[:2]
    if leaders:
        lead_str = ", ".join(t.get("name") for t in leaders if t.get("name"))
        sections.append(f"Watch {lead_str} for continuation.")

    if not sections:
        narration = "Not much fresh data to work with this morning — try again after the open."
    else:
        sections.append("Tighten your risk and trade what's working.")
        narration = " ".join(sections)

    return {"narration": _truncate(narration), "sections": sections}
