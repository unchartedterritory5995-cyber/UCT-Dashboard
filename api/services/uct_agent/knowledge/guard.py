"""Content guard for retrieved knowledge: retrieved text is DATA, never instructions.

`check(text)` -> (clean_text, flags). A passage whose text tries to address the model ("ignore your
instructions", role tags, tool-call syntax) is WITHHELD, not cleaned: a partly-scrubbed instruction is still
an instruction. Member handles and Discord mentions are scrubbed (the ledger notes typed member names can
appear inside verbatim posts). Control characters and markup are removed.
"""
from __future__ import annotations

import re

_INJECTION = re.compile(
    r"(ignore|disregard|forget|override)\s+(all\s+|any\s+|the\s+|your\s+|previous\s+|prior\s+|above\s+)*"
    r"(instructions?|rules?|prompts?|system|directions?)"
    r"|\byou\s+are\s+now\s+(a|an|the|my)?\s*(\w+\s+){0,2}(assistant|ai|bot|chatbot|model|agent|dan|jailbroken|unrestricted|unfiltered)\b"
    r"|\byou\s+are\s+now\s+in\s+(developer|god|admin|jailbreak)\s+mode\b"
    r"|\bdisregard\s+(everything|anything|all)\b.{0,40}\b(told|said|instructed|given)\b"
    r"|\b(pretend|act)\s+(to\s+be|as)\s+(a|an|the)?\s*(\w+\s+){0,2}(assistant|ai|model|bot|system|developer)\b"
    r"|\breveal\s+(your|the)\s+(system|hidden|secret|internal)\b"
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
