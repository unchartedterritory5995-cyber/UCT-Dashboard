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
    "PEG": ("power earnings gap",), "EP": ("episodic pivot",), "VCP": ("volatility contraction pattern",),
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


#: agent-kn (2026-11-03): a form that is an alias of MORE THAN ONE template; setup.playbook refuses it as ambiguous, so
#: it never resolves to either one (setup_named -> None; setup_match -> the candidates)
AMBIGUOUS = {"high tight flag": ("HTF", "Tight Flag")}

# (name | None, form, regex), LONGEST form first; an ambiguous form carries name None
_FORMS = sorted([*((name, form, _rx(form)) for name in TEMPLATES for form in (name, *ALIASES.get(name, ()))),
                 *((None, form, _rx(form)) for form in AMBIGUOUS)],
                key=lambda t: -len(t[1]))


def setup_match(text: str) -> dict | None:
    """{name} | {ambiguous: [names], form} | None -- the LONGEST form wins."""
    t = str(text or "")
    for name, form, rx in _FORMS:
        if rx.search(t):
            return {"name": name} if name else {"ambiguous": list(AMBIGUOUS[form]), "form": form}
    return None


def setup_named(text: str) -> str | None:
    """The ONE canonical template the text names, else None (an ambiguous form names none)."""
    m = setup_match(text)
    return m.get("name") if m else None


# a sentence that DEFINES a named setup: "<setup> is a / are when / means the / refers to ...", "<setup>: ...", "<setup> = ..."
_DEF_TAIL = (r"(?:s|es)?\s*(?:\([^)]{0,40}\)\s*)?(?:(?:is|are|means|refers to|is defined as|is called|describes|consists of)\s+"
             r"(?:a|an|the|when|where|basically|simply|essentially|just|defined|characteri\w+|made of|any)\b|[:=]\s)")
# pre-activation (re-review r2): wider definition shapes -- "In a VCP, price ...", "VCPs form when ...", "The VCP
# pattern is a ...", "A VCP setup means ..."
_DEF_IN = r"\bin (?:a|an|the) "                                                          # "In a VCP, price ..."
_DEF_IN_TAIL = r"(?:s|es)?\s*,"
_DEF_WHEN_TAIL = (r"(?:s|es)?\s+(?:form|forms|occur|occurs|happen|happens|develop|develops|appear|appears|start|starts|"
                  r"begin|begins|show up|shows up|set up|sets up|trigger|triggers)\s+(?:when|after|as|if|where|once)\b")
_DEF_NOUN_TAIL = (r"(?:s|es)?\s+(?:pattern|setup|set-up|formation|template|signal|entry|structure)s?\s+"
                  r"(?:is|are|means|refers to|describes|consists of|happens when|occurs when|forms when|is defined as|is when)\b")


def _flags(form: str) -> int:
    return 0 if form in ("EP", "PEG") else re.I


_DEF_FORMS = [(name or " / ".join(AMBIGUOUS[form]),
               [re.compile(r"(?:^|[^A-Za-z0-9])" + _body(form) + tail, _flags(form))
                for tail in (_DEF_TAIL, _DEF_WHEN_TAIL, _DEF_NOUN_TAIL)]
               + [re.compile(_DEF_IN + _body(form) + _DEF_IN_TAIL, _flags(form))])
              for name, form, _rx_ in _FORMS]

# A definition is CITED only by a real setup.playbook citation that coach.explain produced in this conversation: the
# stored, text-free citation marker of an answer it taught from the template (coach/brain.js knowledgeMarker:
# `<uct_knowledge_ref/> ... Cited: setup template "VCP" ...`). Free text in the reply never counts -- "UCT's playbook",
# "approved playbook", a copied template header (#751 B-1 / re-review r2).
_MARKER_TEMPLATE = re.compile(r'setup template "([^"]{1,80})"')


def cited_templates(history: list | None) -> set[str]:
    """The canonical templates coach.explain taught FROM a setup.playbook template in the stored history (its markers)."""
    out: set[str] = set()
    for t in history or []:
        if not isinstance(t, dict) or t.get("role") != "outcome":
            continue
        data = t.get("data") if isinstance(t.get("data"), dict) else {}
        text = str(t.get("text") or "")
        if data.get("knowledge") is not True or not text.startswith("<uct_knowledge_ref/>"):
            continue
        for m in _MARKER_TEMPLATE.finditer(text):
            name = setup_named(m.group(1))
            if name:
                out.add(name)
    return out


def uncited_setup_definitions(reply: str, cited: set[str] | frozenset[str] = frozenset()) -> list[str]:
    """The canonical names a reply DEFINES that coach.explain has not cited from UCT's playbook (empty = fine)."""
    t = str(reply or "")
    out: list[str] = []
    for name, rxs in _DEF_FORMS:                     # longest form first; a matched span is blanked, so "high tight
        for rx in rxs:                               # flag is ..." is not ALSO read as "tight flag is ..."
            m = rx.search(t)
            while m:
                if name not in out and name not in cited:
                    out.append(name)
                t = t[:m.start()] + " " * (m.end() - m.start()) + t[m.end():]
                m = rx.search(t)
    return out


#: what replaces a model reply that defines a named setup without citing the playbook (figure-free, guard-clean)
DEFINITION_FIXED = ("UCT's definitions of its setups come from the approved playbook, so I won't write my own. "
                    "Ask me to teach that setup and I can use the playbook's template when it is available. Educational, not advice.")
