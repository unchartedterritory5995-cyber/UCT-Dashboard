"""UCT setup names for the coach (Wave 3 review B4, owner decision N5): the Trading Brain's 48 canonical template names
and their spelled-out forms, and a deterministic check on MODEL-written coach replies -- a definition-like sentence
about a named setup, in a reply that does not cite UCT's playbook, is a violation (the reply is replaced; the coach
never writes a competing setup definition).

The lists mirror app/src/agent/coach/brain.js (SETUP_TEMPLATES, SETUP_ALIASES); tests/test_uct_agent_coach_vocab.py
keeps the two identical. Stdlib only, no I/O.
"""
from __future__ import annotations

import re

TEMPLATES = ("20EMA Hold", "7-Week Short Rule", "Ascending Triangle", "BGU", "Base-on-Base", "Box Theory", "Cup with Handle",
             "Descending Triangle", "Double Bottom", "EMA Crossback", "EMA Crossover", "EP", "FTD", "Flat Base", "Gap-and-Go",
             "Go Signal", "Green Line Breakout", "HTF", "HVC", "Head & Shoulders", "Kicker Candle", "Late-Stage Climax", "Launchpad",
             "Low-Cheat", "Mean Reversion", "Measured Move", "Oops Reversal", "Open Bull Gap Support", "PEG", "Parabolic Short",
             "Pocket Pivot", "Power Play", "Rectangle", "Red to Green", "Remount", "Short Squeeze", "Stage 2 Breakout",
             "Stage 2 Momentum", "Stage 4 Breakdown", "Symmetrical Triangle", "Tight Flag", "U&R", "VCP", "Wedge Pop",
             "Wyckoff Accumulation", "Wyckoff Distribution", "Wyckoff LPSY", "Wyckoff SOS")

ALIASES = {
    "PEG": ("power earnings gap",), "EP": ("episodic pivot",), "HTF": ("high tight flag",), "VCP": ("volatility contraction pattern",),
    "U&R": ("undercut and rally", "undercut & rally"), "FTD": ("follow-through day", "follow through day"),
    "HVC": ("high volume close", "high-volume close"), "BGU": ("big gap up",), "Cup with Handle": ("cup and handle", "cup & handle"),
    "Head & Shoulders": ("head and shoulders",), "Wyckoff LPSY": ("last point of supply",), "Wyckoff SOS": ("sign of strength",),
    "20EMA Hold": ("20 ema hold", "20-day ema hold"), "Low-Cheat": ("low cheat entry",), "Red to Green": ("red-to-green move",),
}


def _body(form: str) -> str:
    """A form's pattern: hyphens and spaces interchangeable, everything else literal."""
    return "".join("[- ]" if ch in "- " else re.escape(ch) for ch in form)


def _rx(form: str) -> re.Pattern:
    flags = 0 if form in ("EP", "PEG") else re.I       # English-word clashes: only the capitalised form names the setup
    return re.compile(r"(?:^|[^A-Za-z0-9])" + _body(form) + r"(?:s|es)?(?![A-Za-z0-9])", flags)


_FORMS = sorted(((name, form, _rx(form)) for name in TEMPLATES for form in (name, *ALIASES.get(name, ()))),
                key=lambda t: -len(t[1]))


def setup_named(text: str) -> str | None:
    """The canonical template the text names (the LONGEST form wins), else None."""
    t = str(text or "")
    for name, _form, rx in _FORMS:
        if rx.search(t):
            return name
    return None


# a sentence that DEFINES a named setup: "<setup> is a / are when / means the / refers to ...", "<setup>: ...", "<setup> = ..."
_DEF_TAIL = (r"(?:s|es)?\s*(?:\([^)]{0,40}\)\s*)?(?:(?:is|are|means|refers to|is defined as|is called|describes|consists of)\s+"
             r"(?:a|an|the|when|where|basically|simply|essentially|just|defined|characteri\w+|made of|any)\b|[:=]\s)")
_DEF_FORMS = [(name, re.compile(r"(?:^|[^A-Za-z0-9])" + _body(form) + _DEF_TAIL, 0 if form in ("EP", "PEG") else re.I))
              for name, form, _rx_ in _FORMS]
# the reply cites UCT's playbook (what coach.explain itself writes when it teaches from a template or a passage)
_CITES = re.compile(r"UCT's setup template|approved playbook|From UCT's playbook|Setup Library|UCT's playbook", re.I)


def uncited_setup_definitions(reply: str) -> list[str]:
    """The canonical names a reply DEFINES without citing UCT's playbook (empty = fine). Deterministic."""
    t = str(reply or "")
    if _CITES.search(t):
        return []
    out: list[str] = []
    for name, rx in _DEF_FORMS:
        if rx.search(t) and name not in out:
            out.append(name)
    return out


#: what replaces a model reply that defines a named setup without citing the playbook (figure-free, guard-clean)
DEFINITION_FIXED = ("UCT's definitions of its setups come from the approved playbook, so I won't write my own. "
                    "Ask me to teach that setup and I can use the playbook's template when it is available. Educational, not advice.")
