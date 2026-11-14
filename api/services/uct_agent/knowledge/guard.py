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
    # Compare panel view (Tools → Compare Symbols): the compare domain (compare.openView as a bare name; its verb "open" is
    # already withheld); stricter only
    r"|\b(watchlist|layout|alert|chart|compare|chartSetup|chartGrid|screener|indicator|indicatorAlert|indicatorStyle|indicatorCopy"
    # #1082 Custom-Period Sort: the periodSort domain (periodSort.run / periodSort.dock as bare names); stricter only
    # #1106 right-click parity: the chartMenu domain (chartMenu.askAi / chartMenu.resetWatermark as bare names); stricter only
    # chartFeatures (Company Info panel + Earnings Strip): chartFeatures.companyPanel / earningsStrip as bare names; stricter only
    r"|drawing|widget|board|settings|definition|pane|volume|app|guide|stock|news|breadth|playbook|research|multiChart|periodSort|chartMenu"
    # chartShare (the chart's Share popover): chartShare.export as a bare name (its verb "export" is already withheld); stricter only
    r"|chartFeatures|chartShare)"
    r"\.(add|remove|delete|create|clear|rename|open|set|run|save|apply|show|hide|update|move|resize|toggle|swap|duplicate"
    # #1030 ratchet: master actions added by #1077/#1073/#1027 (chartSetup.stepBars/autoScale/compareGroup,
    # watchlist.arrangeColumns/exportList): their verbs join the withheld set (stricter only)
    # #1074 Layout Dock: layout.pinToBar / layout.unpinFromBar as bare names (layout.moveOnBar is "move"); stricter only
    # #1110 drawing extras: drawing.favoriteTool / drawing.positionCalculator as bare names (saveDefaults is "save"); stricter only
    # #1104 chart zoom: chartSetup.zoom as a bare name; stricter only
    # #1106 right-click parity: verbs ask (askAi) and reset (resetWatermark; also withholds the older chart.resetDefaults /
    # chartSetup.resetView bare names — stricter, and GUARD_KNOWN_UNWITHHELD may only shrink)
    # chartFeatures: verbs company (companyPanel) and earnings (earningsStrip; also withholds the older stock.earnings bare
    # name, which leaves GUARD_KNOWN_UNWITHHELD — stricter, and that set may only shrink)
    r"|reorder|list|explain|setup|record|web|quote|cell|step|auto|compare|arrange|export|pin|unpin|dock|favorite|position|zoom|ask|reset"
    r"|company|earnings)[A-Za-z]*\b"
    r"|\bnew\s+instructions?\b|\bsystem\s*prompt\b|\bjailbreak\b"
    r"|<\s*/?\s*(system|assistant|user|tool|instructions?)\b|\[\s*(system|inst)\s*\]|<\|[a-z_]+\|>"
    # Charts family (2026-11-12): the UCT Intelligence chart indicator (uctIntelligence.set as a bare name), on its own line; stricter only
    # (never the site's own domain: "uctintelligence.com" is prose)
    r"|\buctIntelligence\.(?!(?:com|net|org|io|co|ai|app|dev|us)\b)[a-z][A-Za-z]*\b"
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
