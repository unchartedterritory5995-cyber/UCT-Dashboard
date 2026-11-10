"""Content guard for retrieved knowledge: retrieved text is DATA, never instructions.

`check(text)` -> (clean_text, flags). A passage whose text tries to address the model ("ignore your
instructions", role tags, tool-call syntax) is WITHHELD, not cleaned: a partly-scrubbed instruction is still
an instruction. Member handles and Discord mentions are scrubbed (the ledger notes typed member names can
appear inside verbatim posts). Control characters and markup are removed.
"""
from __future__ import annotations

import json
import logging
import re
from pathlib import Path

log = logging.getLogger(__name__)

# ── Agent action names (G1): DERIVED from the capability registry, never typed by hand ─────────────────
# A retrieved passage that names an Agent action ("watchlist.keepOnly the leaders") is instruction-like and is
# withheld. The families and verbs come from the registry itself, so a capability added tomorrow is covered
# with no edit here (tests/test_uct_agent_server_capability_mirrors.py holds the ratchet):
#   * app/src/agent/contract/manifest.golden.json  the exact manifest the Charts surface sends (vitest-pinned
#     to the registry by agentContracts.test.js), and
#   * the registry source app/src/agent/capabilities/*.js: its `name: 'x.y'` / `CAPABILITY = 'x.y'` literals
#     and KNOWLEDGE_CAPS keys, for surface-scoped and flag-gated families the Charts golden does not carry
#     (coach, journal, history, playbook, research, stock.quote...).
# The hand-typed enumeration this replaces missed 45 manifest names written bare (chart.goToDate, agent.undo...).
_ROOT = Path(__file__).resolve().parents[4]
_GOLDEN = _ROOT / "app" / "src" / "agent" / "contract" / "manifest.golden.json"
_REGISTRY = _ROOT / "app" / "src" / "agent" / "capabilities"
_NAME = r"[a-z][A-Za-z]*\.[a-z][A-Za-z]*"
_LITERAL = re.compile(r"""(?:\bname|\b[A-Z_]*CAPABILITY)\s*[:=]\s*['"](""" + _NAME + r""")['"]""")
_KEY = re.compile(r"""['"](""" + _NAME + r""")['"]\s*:""")


def _registry_action_names() -> tuple[frozenset[str], str]:
    names: set[str] = set()
    try:
        names |= {str(c.get("name")) for c in json.loads(_GOLDEN.read_text(encoding="utf-8"))["capabilities"]
                  if isinstance(c, dict) and re.fullmatch(_NAME, str(c.get("name", "")))}
    except (OSError, ValueError, KeyError, TypeError):
        log.warning("[uct-agent] knowledge guard: %s unreadable", _GOLDEN)
    try:
        for f in sorted(_REGISTRY.glob("*.js")):
            if f.name.endswith(".test.js"):
                continue
            src = f.read_text(encoding="utf-8")
            names |= set(_LITERAL.findall(src))
            for line in src.splitlines():
                if "KNOWLEDGE_CAPS =" in line:
                    names |= set(_KEY.findall(line))
    except OSError:
        log.warning("[uct-agent] knowledge guard: %s unreadable", _REGISTRY)
    return frozenset(names), ("registry" if names else "fallback")


def action_clause(names) -> str:
    """The regex clause matching a bare action name of any family in `names`: `family.verb`, where verb is one
    of the registry's single-word verbs (open, apply, replay, undo...; any suffix, the pre-G1 shape) or ANY
    camelCase identifier (goToDate, keepOnly, exportList: action-shaped, never an English word). Families match
    case-insensitively like the rest of the screen; the camelCase test is case-sensitive. With no names (the
    registry could not be read) it fails CLOSED on any dotted camelCase identifier, never open."""
    pairs = [str(n).split(".", 1) for n in names if "." in str(n)]
    fams = sorted({f for f, _ in pairs}, key=lambda f: (-len(f), f))
    words = sorted({v for _, v in pairs if v.islower()}, key=lambda v: (-len(v), v))
    camel = r"(?-i:[a-z]+[A-Z][A-Za-z]*)"
    if not fams:
        return r"\b[a-z][A-Za-z]+\." + camel + r"\b"
    verb = camel + ("|(?:" + "|".join(map(re.escape, words)) + r")[A-Za-z]*" if words else "")
    return r"\b(?:" + "|".join(map(re.escape, fams)) + r")\.(?:" + verb + r")\b"


_ACTION_NAMES, _ACTION_SOURCE = _registry_action_names()
_ACTION_FAMILIES = frozenset(n.split(".", 1)[0] for n in _ACTION_NAMES)


def action_families() -> frozenset[str]:
    return _ACTION_FAMILIES


def action_source() -> str:
    """'registry' when the names were derived from the registry, 'fallback' when it could not be read."""
    return _ACTION_SOURCE


def source_line() -> str:
    """The one boot line naming where the guard's action names came from (counts only, never content)."""
    return (f"[uct-agent] knowledge guard action source: {_ACTION_SOURCE} "
            f"({len(_ACTION_NAMES)} names, {len(_ACTION_FAMILIES)} families)")


_BOOT_LOGGED = {"done": False}


def log_action_source_once() -> str | None:
    """Log source_line() ONCE per process (server boot: api/routers/uct_agent.py at import). Returns the line it
    logged, or None when it already ran. A fallback source is a WARNING: the guard is failing closed."""
    if _BOOT_LOGGED["done"]:
        return None
    _BOOT_LOGGED["done"] = True
    line = source_line()
    (log.info if _ACTION_SOURCE == "registry" else log.warning)("%s", line)
    return line


_INJECTION = re.compile(
    r"(ignore|disregard|forget|override)\s+(all\s+|any\s+|the\s+|your\s+|previous\s+|prior\s+|above\s+)*"
    r"(instructions?|rules?|prompts?|system|directions?)"
    r"|\byou\s+are\s+now\s+(a|an|the|my)?\s*(\w+\s+){0,2}(assistant|ai|bot|chatbot|model|agent|dan|jailbroken|unrestricted|unfiltered)\b"
    r"|\byou\s+are\s+now\s+in\s+(developer|god|admin|jailbreak)\s+mode\b"
    r"|\bdisregard\s+(everything|anything|all)\b.{0,40}\b(told|said|instructed|given)\b"
    r"|\b(pretend|act)\s+(to\s+be|as)\s+(a|an|the)?\s*(\w+\s+){0,2}(assistant|ai|model|bot|system|developer)\b"
    r"|\breveal\s+(your|the)\s+(system|hidden|secret|internal)\b"
    r"|\b(ignore|disregard|forget)\s+(all\s+|everything\s+)?(of\s+)?(the\s+|what\s+is\s+)?(above|previous|prior|earlier|preceding)\b"
    r"|\bnote\s+to\s+(the\s+|any\s+)?(ai|agent|assistant|model|llm|bot)\b"
    r"|\bsystem\s+override\b|\boverride\s+(the|your|all|any|previous|prior)\s+(rules?|instructions?|system|policy|safety)\b"
    r"|\boverride\b[^.\n]{0,20}\b(safety|policy|instructions?)\b"
    r"|\bfrom\s+now\s+on\b[^.\n]{0,30}\b(reply|respond|answer|say|output|only\s+say)\b"
    r"|\bas\s+(the|an?)\s+(model|ai|assistant|llm)\s*,?\s+you\b"
    r"|\byou\s+are\s+required\s+to\s+(output|reveal|print|show|reply|respond|say|ignore|disclose|list)\b"
    r"|\b(the|this|any)\s+(ai|agent|assistant|model|llm|bot)\s+(must|should|shall|needs\s+to|has\s+to|is\s+required\s+to)\b"
    r"|\bto\s+the\s+(ai|agent|assistant|model|llm)\s+reading\b"
    r"|\b(call|use|run|invoke|execute|trigger)\b[^.\n]{0,30}?\b[a-z][a-zA-Z]{2,}"
    r"\.(?!(?:com|net|org|io|co|ai|gov|edu|us|uk|ca|app|dev|me|tv|ly)\b)[a-z][a-zA-Z]{2,}\b(?![/.])"
    r"|" + action_clause(_ACTION_NAMES) +
    r"|\bnew\s+instructions?\b|\bsystem\s*prompt\b|\bjailbreak\b"
    r"|<\s*/?\s*(system|assistant|user|tool|instructions?)\b|\[\s*(system|inst)\s*\]|<\|[a-z_]+\|>"
    r"|\b(call|use|invoke)\s+the\s+\w+\s+tool\b|\btool_use\b|\bfunction_call\b",
    re.I)
_CTRL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
_TAGS = re.compile(r"<[^>]{0,200}>")
_MENTION = re.compile(r"<@!?&?\d+>|(?<![\w.])@[A-Za-z0-9_.]{2,32}")
_URL = re.compile(r"https?://\S+")
_WS = re.compile(r"\s+")


def suspicious(text: str) -> bool:
    return bool(_INJECTION.search(text or ""))


def check(text: str, limit: int = 500) -> tuple[str, list[str]]:
    flags: list[str] = []
    t = str(text or "")
    if suspicious(t):
        return "", ["instruction_like"]
    t = _CTRL.sub(" ", t)
    if _TAGS.search(t):
        t = _TAGS.sub(" ", t)
        flags.append("markup_removed")
    if _MENTION.search(t):
        t = _MENTION.sub("[member]", t)
        flags.append("mentions_scrubbed")
    if _URL.search(t):
        t = _URL.sub("[link]", t)
        flags.append("links_removed")
    t = _WS.sub(" ", t).strip()
    if len(t) > limit:
        cut = t[:limit].rsplit(" ", 1)[0]
        t = cut + " …"
        flags.append("truncated")
    return t, flags
