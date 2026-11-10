"""The coach guard (W3-2): a deterministic evaluation of every coach reply, applied SERVER-SIDE before the reply
is stored or sent. Mirrored in the browser by app/src/agent/coach/guard.js (same regexes, same codes); both read
the same adversarial cases, app/src/agent/__fixtures__/coachGuardCases.json.

Four checks, in this order (codes):
  unsupported   an unsupported conclusion: guaranteed, will go up/down, can't lose, sure thing, buy now / sell now,
                a price target, "always works", risk-free ... (a NEGATED guarantee -- "no guarantee" -- is a hedge,
                not a claim, and is removed before the scan)
  order         order language: buy/sell/short ... now, N shares, place an order, enter/exit now, you should buy
  figure        a figure in the reply that is in none of the inputs (the concept text, the chart observation, the
                journal stats the browser computed, the member's own message): every number is traceable or the
                reply is replaced
  uncertainty   a reply about OUTCOMES (will, likely, odds, follow-through, breakout, target ...) with no hedge
                sentence (may / might / could / often / not guaranteed / depends / historically / can fail ...)

`enforce` replaces a violating reply with FIXED (never edits it: an edited sentence could still carry the claim in
other words) and reports the codes; the caller logs the codes only (value-free, ADR-005 style). Every coach reply
ends with the educational footer.

MUTATION NOTE (how the suite proves itself): tests/test_uct_agent_coach_guard.py runs the fixture both ways -- every
`violations` case must trip exactly its codes and every `clean` case none. Deleting any one regex below makes at
least one violating case pass (the fixture names which phrase each regex is for), and loosening the hedge list makes
a clean case fail; the vitest mirror runs the identical fixture, so the two implementations cannot drift apart.
"""
from __future__ import annotations

import re
import unicodedata
from typing import Iterable

FOOTER = "Educational, not advice."
FIXED = ("I can explain the concept and what to check on your chart, but I can't make that claim. "
         + FOOTER)
CODES = ("unsupported", "order", "figure", "uncertainty")

# a negated guarantee is a hedge: removed before the unsupported scan
_NEGATED = re.compile(r"\b(?:no|not|never|isn't|isnt|aren't|arent|without|cannot be|can't be|cant be|nothing is|"
                      r"there is no|there's no|there are no|doesn't|does not|don't|do not)\s+(?:a\s+|any\s+)?guarantee[sd]?\b", re.I)

# W3 review: every check runs on NORMALISED text -- NFKC, curly quotes to straight, zero-width characters dropped, and
# a small set of Cyrillic / Greek look-alikes mapped to Latin (a "guaranteed" spelled with Cyrillic e is "guaranteed")
_CONFUSABLES = str.maketrans({
    "‘": "'", "’": "'", "ʼ": "'", "´": "'", "`": "'", "“": '"', "”": '"',
    "а": "a", "е": "e", "о": "o", "р": "p", "с": "c", "у": "y", "х": "x",
    "і": "i", "ј": "j", "ѕ": "s", "ԁ": "d", "һ": "h", "ӏ": "l", "к": "k",
    "А": "A", "В": "B", "Е": "E", "К": "K", "М": "M", "Н": "H", "О": "O",
    "Р": "P", "С": "C", "Т": "T", "Х": "X", "І": "I",
    "ο": "o", "α": "a", "ε": "e", "ι": "i", "ν": "v", "ρ": "p", "τ": "t", "κ": "k",
    "Ο": "O", "Α": "A", "Ε": "E", "Ι": "I", "Κ": "K", "Ρ": "P", "Τ": "T",
    "​": None, "‌": None, "‍": None, "⁠": None, "﻿": None, "­": None,
})


# review: Arabic-Indic / extended Arabic-Indic digits read as ASCII digits (the browser mirror's \d is ASCII-only)
_DIGITS = str.maketrans({**{chr(0x0660 + i): str(i) for i in range(10)}, **{chr(0x06F0 + i): str(i) for i in range(10)}})
# a (non-breaking) hyphen INSIDE a word is dropped ("guaran‑teed" is "guaranteed")
_INWORD_HYPHEN = re.compile(r"([A-Za-z])[‐‑]([A-Za-z])")


def normalize(text: str) -> str:
    """The text every check reads: NFKD with accents stripped, then NFKC (NBSP -> space), the confusables above,
    ASCII digits, and in-word hyphens dropped."""
    t = unicodedata.normalize("NFKD", str(text or ""))
    t = "".join(ch for ch in t if not unicodedata.combining(ch))
    t = unicodedata.normalize("NFKC", t).translate(_CONFUSABLES).translate(_DIGITS)
    t = _INWORD_HYPHEN.sub(r"\1\2", t)
    # W3 guard-recall: letter-spaced words ("b u y  n o w") are joined -- three or more single letters in a row
    return _LETTER_SPACED.sub(lambda m: m.group(0).replace(" ", ""), t)


_LETTER_SPACED = re.compile(r"\b[A-Za-z](?: [A-Za-z]){2,}\b", re.A)


# the mandated footer is NOT a hedge: it is removed before the uncertainty check (W3 review C2)
_FOOTER_RX = re.compile(r"educational,?\s*not\s+(?:financial\s+|investment\s+)?advice\.?", re.I)

_MOVE = (r"(?:go|move|head|trade|rally|rip|run|climb|rise|fall|drop|tank|crash|break ?out|bounce|recover|double|"
         r"triple|soar|plunge|squeeze|explode|moon|continue|hold|keep going|take off|hit|reach)")
UNSUPPORTED = [
    ("guarantee", re.compile(r"\bguarantee[sd]?\b", re.I)),
    ("will-move", re.compile(r"(?:\bwill|[a-z]'ll)\s+(?:definitely\s+|certainly\s+|surely\s+|almost certainly\s+|probably\s+)?" + _MOVE + r"\b", re.I)),
    # review B2: a promised result, a certainty stated as a negation, hype-predictive verbs
    ("will-profit", re.compile(r"(?:\bwill|[a-z]'ll)\s+(?:definitely\s+|certainly\s+|surely\s+|probably\s+)?(?:make (?:you )?(?:money|a profit|profits|gains?|bank)|"
                               r"profit|win|earn|pay off|be profitable|be a winner|be a big winner)\b", re.I)),
    ("no-chance", re.compile(r"\b(?:zero|no|nil|little|almost no|essentially no|practically no)\s+(?:chance|way|risk|possibility)\s+"
                             r"(?:that\s+)?(?:this|it|that|the stock|the setup|the trade)\s+(?:\w+\s+)?(?:fails?|loses?|drops?|goes down|go down|"
                             r"breaks? down|doesn't work|won't work|reverses?)\b", re.I)),
    ("hype", re.compile(r"\b(?:poised|primed|set|ready|due|destined|about)\s+to\s+(?:soar|explode|rip|rocket|moon|skyrocket|surge|"
                        r"rally|break ?out|take off|run|pop|fly|squeeze)\b|\bto the moon\b|\bcan't[- ]miss\b", re.I)),
    ("going-to", re.compile(r"\b(?:is|are|it's|its|this is|that's)\s+(?:going to|gonna)\s+" + _MOVE + r"\b", re.I)),
    ("cant-lose", re.compile(r"\bcan(?:'t|not|t)\s+(?:lose|fail|miss|go wrong|go down|go lower)\b", re.I)),
    ("wont-lose", re.compile(r"\b(?:won't|wont|will not)\s+(?:lose|fail|miss|go wrong|go down|go lower|drop|fall|break down)\b", re.I)),
    ("confident", re.compile(r"\b(?:i'm|i am|im|we're|we are|i feel)\s+(?:very\s+|pretty\s+|quite\s+|fairly\s+|really\s+|highly\s+|so\s+)?"
                             r"(?:confident|certain|convinced)\b", re.I)),
    ("headed-to", re.compile(r"\b(?:heads?|headed|heading|going|goes|gets?|run(?:s|ning)?|climb(?:s|ing)?|rall(?:y|ies|ying)|"
                             r"ride (?:it|this|them|that))\s+(?:up\s+|back\s+|higher\s+|lower\s+|all the way\s+)?(?:to|toward|towards|for)\s+\$?\d", re.I)),
    ("ride-it", re.compile(r"\bride (?:it|this|them|that)\s+(?:up|higher|to|all the way)\b", re.I)),
    ("odds-favor", re.compile(r"\b(?:odds|chances|probabilit(?:y|ies))\s+(?:strongly\s+|heavily\s+|clearly\s+|really\s+)?"
                              r"(?:favou?r|are (?:good|high|great|strong|in (?:your|our|the bulls'?|the bears'?) favou?r))\b", re.I)),
    ("sure-thing", re.compile(r"\b(?:sure (?:thing|bet|win|winner|shot)|for sure|dead cert|no[- ]brainer|slam dunk|lock)\b", re.I)),
    ("certain", re.compile(r"\b(?:is|are|it's|its|this is|that's)\s+(?:a\s+)?(?:certain|definite|definitely|certainly|sure)\s+(?:to|thing|bet|win|winner)\b", re.I)),
    ("buy-sell-now", re.compile(r"\b(?:buy|sell|short)\s+(?:it\s+|this\s+|them\s+|here\s+)?(?:now|today|immediately|right now|asap)\b", re.I)),
    ("price-target", re.compile(r"\b(?:price target|target price|my target|a target of|targets? (?:is|are|at)?\s*\$?\d|"
                                r"should (?:hit|reach|get to|be at|trade at)\s+\$?\d|(?:upside|downside) to \$?\d)", re.I)),
    ("always-works", re.compile(r"\b(?:always works?|never fails?|works every time|never loses?|always wins?|can only go (?:up|down|higher|lower)|"
                                r"has to (?:go|rally|bounce|drop|rise|fall)|bound to (?:go|rally|bounce|drop|rise|fall)|"
                                r"100 ?% (?:certain|sure|win|success|safe)|risk[- ]free|no (?:risk|downside|doubt)|zero risk|"
                                r"definitely (?:will|going)|without (?:a )?doubt|cannot fail|can't fail)\b", re.I)),
]

ORDER = [
    ("trade-now", re.compile(r"\b(?:buy(?:ing)?|sell(?:ing)?|short(?:ing)?|cover(?:ing)?|go long|go short|get long|get short|enter|exit|"
                             r"load(?:ing)? up|size up|double down|trim(?:ming)?|take profits?|scale (?:in|out)|"
                             r"grab(?:bing)? (?:a |some )?(?:position|shares|stake)|open(?:ing)? a position|"
                             r"add to (?:your |the )?position)\b[^.!?\n]{0,40}?\b(?:now|today|here|immediately|right now|at the open|"
                             r"at open|before the close|into the close|tomorrow|premarket|pre-market)\b", re.I)),
    ("shares", re.compile(r"\b(?:buy|sell|short|purchase|pick up|grab|dump|unload)\s+(?:\d[\d,]*\s+|some\s+|more\s+|a few\s+)?shares\b", re.I)),
    ("place-order", re.compile(r"\b(?:place|put in|enter|submit|set|execute)\s+(?:an?\s+|the\s+|your\s+)?(?:buy|sell|limit|market|stop|stop-loss|bracket)?\s*(?:order|trade)\b", re.I)),
    ("you-should", re.compile(r"\b(?:you should|you need to|you must|you have to|i would|i'd|i'd say|go ahead and|my advice is to|time to|"
                              r"consider|i'd be|i would be|i'm|i am)\s+"
                              r"(?:(?:buy|sell|short)(?:ing)?|cover|go long|go short|get in|get out|take the trade|take this trade|add|enter|exit|bail|dump)\b", re.I)),
    # review B2: advice by recommendation, "you might want to", opening / building a position, "worth trading"
    ("recommend", re.compile(r"\b(?:recommend|suggest|advise|urge)\s+(?:that you\s+|you\s+)?(?:(?:buy|sell|short)(?:ing)?|picking up|adding|"
                             r"taking (?:a|the) (?:trade|position)|entering|getting (?:in|long|short)|going (?:long|short)|accumulat\w+|"
                             r"initiat\w+|opening a|starting a|a (?:starter|full|small|long|short) position|a position)\b", re.I)),
    ("want-to", re.compile(r"\byou (?:might|may|could|should|would|will) (?:want|wish|like) to\s+(?:buy|sell|short|accumulate|add|enter|exit|"
                           r"initiate|start|open|pick up|grab|load|trim|get (?:in|long|short)|go (?:long|short))\b", re.I)),
    ("position", re.compile(r"\b(?:initiat\w*|open(?:ing)?|start(?:ing)?|establish\w*|build(?:ing)?|take|taking)\s+(?:a |an |your )?"
                            r"(?:new |starter |small |full |initial )?(?:long |short )position\b", re.I)),
    ("worth-trading", re.compile(r"\b(?:worth|good (?:time|spot|place|entry|idea)|great (?:time|spot|entry)|ideal (?:time|spot|entry))\s+"
                                 r"(?:(?:trading|buying|selling|shorting|owning)\b|to (?:buy|sell|short|trade|initiate|enter|get in|start|own)\b)", re.I)),
    ("load-up", re.compile(r"\bload(?:ing)? up\b|\btrim(?:ming)?\s+(?:half|some|a third|a quarter|\d)", re.I)),
    ("take-trade", re.compile(r"\b(?:take|make) (?:the|this|that) trade\b|\bpull the trigger\b|\bget in (?:now|here|today)\b|\bget out (?:now|here|today)\b", re.I)),
]

# ── pre-activation (held-out eval, 2026-11-03): advice / promise / hype BY CLASS, not by phrase ─────────────────────
# A trade verb or object near an advisory stance, a timing phrase, a confident prediction, a certainty, or a hype noun.
# Measured against app/src/agent/__fixtures__/coachGuardHeldout.json (never tuned on it; sibling phrasings live in
# coachGuardCases.json). The browser mirror (coach/guard.js CLASS_PATTERNS) carries the IDENTICAL pattern strings
# (tests/test_uct_agent_coach_guard.py checks them).
_TRADE = (r"(?:buy(?:ing|er|ers|s)?|sell(?:ing|er|s)?|short(?:ing)?|add(?:ing)? (?:to|some|more|exposure)|adding|accumulat\w*|"
          r"trim(?:ming)?|lighten(?:ing)?(?: up)?|take (?:profits?|gains|some off)|taking (?:profits?|gains)|"
          r"get(?:ting)? (?:in|out|long|short|positioned)|positioned|own(?:ing)? (?:some|it|this|them|shares)|own some|"
          r"exit(?:ing)?|enter(?:ing)?|load(?:ing)? (?:up|the boat)|pick(?:ing)? (?:some |it |them |a few )?up|grab(?:bing)?|"
          r"scoop(?:ing)?|dump(?:ing)?|ditch(?:ing)?|cut(?:ting)? (?:it|this|the|your|losses|loser)|bail(?:ing)?(?: out)?|jump(?:ing)? in|"
          r"pile (?:in|into)|go(?:ing)? (?:long|short|all in)|exposure|(?:a |an )?(?:small |starter |full |initial )?position|be in this|"
          r"(?:this|the|that) entry)")
CLASS_PATTERNS = [
    # order: an advisory stance (first person / "you should" / "it might be smart") with a trade verb close by
    ("order", "advisory-stance", r"\b(?:i'?d|i would|i'm|i am|i will|i'll|personally|if i were you|in your (?:shoes|position)|"
                                 r"my (?:move|play|pick|call|advice|suggestion|recommendation)|you (?:should|ought to|need to|must)(?: really)?|"
                                 r"you'd (?:want|be wise|be smart|do well)|it (?:might|would|could|may) be (?:smart|wise|worth it|a good idea|prudent)|"
                                 r"(?:might|could|would|it) make[s]? sense|go ahead and|time to|don't miss|you'd be (?:crazy|foolish|silly|mad) not to|"
                                 r"many traders would|now'?s (?:a |the )?(?:good|great|perfect|ideal) (?:time|moment|spot))\b[^.!?\n]{0,40}?\b" + _TRADE + r"\b"),
    # order: a trade phrase followed by an endorsement ("adding exposure here could make sense", "buying here is the move")
    ("order", "endorsed-trade", r"\b" + _TRADE + r"\b[^.!?\n]{0,30}?\b(?:(?:could|might|would|may|should|does|do|will) )?"
                                r"(?:makes? sense|be (?:smart|wise|the move|the play|a good idea)|is (?:smart|wise|the move|the play|a good idea))\b"),
    # order: a sentence that STARTS with a trade imperative
    ("order", "imperative", r"(?:^|[.!?]\s+|\n)(?:buy|sell|short|grab|scoop|ditch|dump|bail|load|cut|add|trim|pile|go long|go short|"
                            r"get long|get short|get in|get out|back up the truck|take profits)\b(?!-)"
                            r"(?!\s+(?:orders?|points?|signals?|side|stops?|zones?|ratings?|programs?|pressure|volume|interest)\b)"),
    # order: a trade verb with a timing / price-zone phrase ("on the dip", "at these levels", "before the open")
    ("order", "trade-timing", r"\b" + _TRADE + r"\b[^.!?\n]{0,30}?\b(?:at (?:this|these|current) (?:level|levels|price|prices)|"
                              r"on (?:any |the )?(?:dip|dips|pullback|weakness)|while it'?s (?:cheap|low|down)|"
                              r"before (?:the open|the move|it runs|everyone|earnings)|this week|right away)\b"),
    # unsupported: a confident prediction (no may / might / could)
    ("unsupported", "prediction", r"(?:\b(?:should|will|is going to|are going to|gonna|is set to|is about to|is ready to|is due to|"
                                  r"is headed|are headed|is heading|are heading|heads?|headed|heading)|[a-z]'ll)\s+(?:\w+\s+){0,2}?"
                                  r"(?:outperform\w*|much higher|much lower|a lot higher|way higher|new highs|explode|take off|soar|skyrocket|"
                                  r"keep (?:going|climbing|running|rising|working))\b|(?:\bwill|[a-z]'ll) be (?:much |a lot |way )?(?:higher|lower)\b|"
                                  r"\bthe (?:bottom|top) is in\b"),
    # unsupported: a certainty claim
    ("unsupported", "certainty", r"\bnothing (?:can|will|is going to) stop\b|\brest assured\b|\bthere(?:'s| is) no (?:question|doubt)\b|"
                                 r"\bwon't regret\b|\bno[- ]lose\b|\bcan(?:'t|not)[- ]lose\b|\bhigh[- ]probability (?:winner|trade|setup|win)\b|"
                                 r"\bodds (?:look|are|seem) (?:excellent|great|very good|overwhelming)\b"),
    # unsupported: hype nouns
    ("unsupported", "hype-noun", r"\b(?:screaming buy|easy money|free money|rocket ?ship|printing money|money printer|"
                                 r"stock of the (?:year|decade|century)|monster in the making|load the boat|back up the truck|"
                                 r"to the moon|moonshot|home run|sure winner|lay-?up trade|can't[- ]miss)\b"),
]
for _code, _name, _pat in CLASS_PATTERNS:
    (ORDER if _code == "order" else UNSUPPORTED).append((_name, re.compile(_pat, re.I)))

# ── W3 guard-recall (2026-11-04): advice and critical-risk detection BY STRUCTURE, not by phrase ────────────────────
# Developed against app/src/agent/__fixtures__/coachGuardDev.json ONLY (the #761 independent held-out set is measured
# once, after this was frozen). Structural pieces, each a pattern below plus a little clause logic:
#   - a CLAUSE-INITIAL trade imperative ("Buy NVDA.", "Hold, don't sell.", "If it holds 50, buy more."), where a
#     clause after a comma / "then" / "but" only counts when the sentence's head is itself an instruction, a condition,
#     a short interjection, or speaks to / as a person ("Promoters inflate a price, then sell" is a description)
#   - second person + an advisory modal + a trade action ("you might want to trim"); a first-person stance + a trade
#     action ("I'd hold"); an endorsed action ("trimming now would be wise"); a recommendation noun ("this is a buy");
#     the member's own ticket ("your stop belongs under 88"); a rhetorical push ("what are you waiting for?");
#     order-ticket numbers ("entry 55, stop 52")
#   - CRITICAL: a critical-risk topic (margin / leverage / all-in / borrowing / retirement money / tax / insider /
#     pump / chasing losses) in a sentence that also directs or encourages; plus a few critical claims
#   - NEGATION and MENTION: a refusal clause ("I can't tell you whether to sell") is removed before the advice scan; a
#     warning clause ("guaranteed-return pitches are a red flag") and a negated guarantee before the claim scan; a short
#     QUOTED mention ("'buy the dip' is a phrase") is removed unless the sentence speaks to / as a person
#   - a reply mostly in a non-Latin script cannot be checked by these English rules and fails closed
# The browser mirror (coach/guard.js RECALL_PATTERNS) carries the IDENTICAL pattern strings (generated by
# scripts/agent/sync_coach_guard_js.py; tests/test_uct_agent_coach_guard.py compares them), compiled ASCII-only
# (re.A) so \b and \w mean the same thing in both engines.
_TA = (r"(?:buy(?:ing)?|by|bye|sell(?:ing)?|sel|short(?:ing)?|hold(?:ing)?(?!\s+(?:yourself|to your))|hodl(?:ing)?|"
       r"add(?:ing)?(?!\s+(?:a |an )?(?:note|notes|tag|comment|context|label)\b)|trim(?:ming)?|exit(?:ing)?|"
       r"enter(?:ing)?(?!\s+(?:your|the|a) (?:trades? in|notes?|journal|data))|"
       r"own(?:ing)? (?:it|this|that|them|some|shares|more|the stock|a (?:piece|stake|position))|"
       r"take (?:profits?|gains|some|half|the (?:trade|loss|money))|taking (?:profits?|gains|some|half)|cut(?:ting)?|"
       r"clos(?:e|ing) (?:it|this|the|your|out|half)|dump(?:ing)?|ditch(?:ing)?|bail(?:ing)?|load(?:ing)? up|grab(?:bing)?|"
       r"lighten(?:ing)?|(?:reduc|increas)(?:e|ing) (?:your |the )?(?:position|size|exposure|shares|stake)|"
       r"averag(?:e|ing) (?:down|up|in)|doubl(?:e|ing) down|scal(?:e|ing) (?:in|out)|siz(?:e|ing) (?:up|down|in)|lock(?:ing)? in|"
       r"book(?:ing)? (?:profits?|gains|it)|go(?:ing)? (?:long|short|all[- ]?in|big|to cash)|get(?:ting)? (?:in|out|long|short)|"
       r"be (?:out|long|short|in (?:this|it|here|now|the (?:trade|position|stock)))|stay(?:ing)? (?:in|out|long|short|put)|"
       r"sit(?:ting)? tight|accumulat(?:e|ing)|re-?enter(?:ing)?|cover(?:ing)? (?:at|now|here|it|your|the short|half|\$?\d)|"
       r"wait(?:ing)? (?:for|and|then|it out|until)|lever(?:ing)?|us(?:e|ing) (?:margin|leverage)|"
       r"put(?:ting)? (?:it|everything|your|\d)|bet(?:ting)?|pil(?:e|ing) in|jump(?:ing)? in|ap(?:e|ing) in|let (?:it|them) (?:ride|run)|"
       r"start(?:ing)? (?:a|your) (?:position|starter)|be a (?:buyer|seller|holder)|stick(?:ing)? with (?:it|the|your)|"
       r"hang(?:ing)? on to|ride (?:it|this) out|cash(?:ing)? out)")
_NOUNISH = r"(?!-|\s+(?:orders?|points?|signals?|side|stops?|zones?|ratings?|programs?|pressure|volume|walls?|climax\w*)\b)"
_IMP = (r"(?:buy" + _NOUNISH + r"|buyy|by(?= (?:the dip|some|more|it|this|now|calls|puts|shares|\d))|bye(?= (?:some|more|it|this|now|the dip|\d))|"
        r"sell" + _NOUNISH + r"|selll|sel(?= (?:it|half|now|this|some|all|everything))|long(?= \$[A-Za-z]| (?:here|now|this|it)\b)|"
        r"snap up|get rid of|throw on|pare (?:back|down)|bank (?:some )?(?:gains|profits)|ring the register|take a stab|"
        r"dip your toes? in|nibble|stick with (?:it|the (?:trade|position)|your (?:shares|position))|hang on to|ride (?:it|this) out|"
        r"sit on your hands|cash out(?!\s+(?:of\s+)?(?:a |an |the )?(?:retirement|401|ira|pension))|"
        r"use a (?:half|quarter|third|full|small|starter) (?:position|size)|go with a (?:quarter|half|third|full|small) (?:size|position)|"
        r"trade it with|risk no more than|be a (?:buyer|seller|holder)|get (?:some )?exposure|bump (?:your|the) stop|"
        r"short(?!-|\s+(?:sell\w*|interest|squeez\w*|term|window|swings?|side|positions?|answer|version|story|list|of)\b)|"
        r"hold(?=\s*(?:[,.!]|$|[^\x00-\x7f])|\s+(?:on|it|this|that|them|your|through|thru|until|till|here|for now|tight|steady|off|"
        r"don't|the (?:stock|position|shares|line|calls|puts))\b|\s+and (?:wait|let)\b)|hodl|btfd|yolo|ape in|"
        r"add(?!-|\s+up\b|\s+(?:a |an )?(?:note|notes|tag|comment|context|label)\b)|trim(?!-)|"
        r"cut (?:it|this|that|them|the (?:position|loser|trade)|your (?:losses|loser|position)|losses|bait)|"
        r"exit(?=\s+(?:the|your|it|this|that|now|here|half|at|on|if|before|all|everything|some|when|into|and|position)\b|\s*[.!,]|\s*$)|"
        r"enter(?=\s+(?:now|here|the trade|a (?:position|trade|starter)|on|at|long|short|it|this|above|below)\b|\s*[.!,]|\s*$)|"
        r"close (?:the (?:trade|position)|your|out|it|this|that|half)|dump|ditch|bail|fade|chase(?!\s+bank)|grab|snag|scoop|"
        r"stack (?:shares|more|it)|jump in|pile in|load (?:up|the boat|more)|accumulate|average (?:down|up|in)|double down|"
        r"scale (?:in|out)|size (?:up|down|this|it|in)|lighten|halve|(?:reduce|increase|cut) your (?:position|size|exposure|shares|stake)|"
        r"rotate (?:out|into|to)|swap|hedge(?!\s+funds?\b)|roll (?:your|the|it|them)|write (?:covered )?(?:calls|puts)|"
        r"exercise (?:your|the|them|it|early|options|calls|puts)|re-?enter|re-?buy|buy ?back|"
        r"cover(?=\s+(?:at|now|here|it|your|the short|half|\$?\d))|unload|liquidate|allocate (?:\$?\d[\d.,k%]*|more|less|half|a|some|your|it)|"
        r"risk (?:\$\d[\d.,k]*|\d[\d.,]*%? (?:on|for|in) (?:this|that|it|the (?:trade|position))|it\b|half)|"
        r"take (?:profits?|gains|the (?:loss|trade|money|profit)|your (?:stop|loss|profits?)|some (?:off|profits?|gains)|half|"
        r"a (?:position|starter|stake|small position|partial)|partials?|the other side)|lock in|book (?:profits?|gains|it)|"
        r"bank (?:profits?|gains|it)|let (?:it|them|your (?:winners?|position|profits?|calls)|the (?:rest|winner|position|trade|calls)) (?:ride|run|work)|"
        r"go (?:long|short|all[- ]?in|big|bigger|heavy|to cash|in\b|\d+x)|"
        r"get (?:in(?=\s*(?:[.!,]|$)|\s+(?:now|here|today|before|on|at|early|while|with|this|it)\b)|out(?! of the habit)|long|short|positioned)|"
        r"stay (?:long|short|in\b|invested|the course|with it|put|out of)|sit tight|stop (?:it )?out|move to cash|raise cash|send it|"
        r"full port|pull the trigger|smash the buy|hit the bid|lift the offer|(?:bid|limit) (?:at |@ ?)?\$?\d[\d.,]*|back up the truck|"
        r"set an? (?:limit|buy|sell)(?: order)? (?:at|@)|"
        r"put (?:your stop|a stop|it all|everything|it in|\d[\d.,%]*|your (?:money|savings|account|cash|stop)|money in|on a (?:position|trade))|"
        r"(?:set|place|move|raise|lower|trail|tighten|keep) (?:your|the|a) stop(?:-loss)?(?= (?:at|to|under|below|above|just|up|down|@|\$?\d|on|tight|breakeven))|"
        r"keep (?:holding|buying|adding|selling|your (?:shares|position|calls|puts)|the (?:puts|calls|position|shares)|"
        r"it(?=\s*(?:[.!,]|$)|\s+(?:through|until|till|thru|over|into|for now)\b))|"
        r"consider (?:buying|selling|trimming|adding|exiting|taking (?:profits?|some|half)|placing (?:your|a) stop|lightening|"
        r"reducing|shorting|holding|closing|cutting|averaging|scaling|entering)|"
        r"start (?:a (?:position|starter|small position)|your position|buying|selling|adding|accumulating|"
        r"with a (?:quarter|half|third|starter|small|full) position)|wait (?:for|until|till|on)\b|"
        r"(?:don't|dont|do not|never) (?:sell|buy|panic[- ]?sell|exit|add|short|cut|hold|trim|chase|average down|bail|touch it|get out)|"
        r"copy my trade|follow me in|long \d[\d.,]*|short \d[\d.,]*|paper[- ]?hand|bag it|let it ride)")
_DISCOURSE = (r"(?:just|so|ok|okay|now|then|honestly|seriously|definitely|def|defo|maybe|perhaps|probably|prob|please|pls|simply|"
              r"imo|tbh|ngl|really|i think|i'd say|i say|personally|go ahead and|go ahead|well|yeah|yes|for now|first|instead|also|"
              r"still|always|bottom line|either way|right now|today|tomorrow|my (?:advice|suggestion|call|move|play) is(?: to)?|i'd|id)")
_CLAUSE_HEAD = r"^[^A-Za-z0-9]*(?:" + _DISCOURSE + r"[^A-Za-z0-9]+)*"
_END = r"(?![A-Za-z0-9])"
_YOU_ME = r"(?:for (?:you|your (?:situation|account|portfolio|case)))"
RECALL_PATTERNS = {
    # ---- negation and mention: what is removed before a scan
    "refusal": (r"\b(?:(?:i|i'm|i am|we|we're)\s+(?:really\s+|simply\s+|just\s+)?(?:can't|cannot|can not|won't|will not|wont|"
                r"not able to|unable to|don't|do not|never|not going to|not in a position to)|no one can|nobody can|"
                r"can't|cannot)\s+(?:[a-z']+\s+){0,2}?(?:tell|say|advise|recommend|suggest|give|"
                r"make (?:that|the|this|a) call|predict|help with|offer|provide)\b|\bwhether\b|\byou asked\b|\byour question\b|"
                r"\bnot (?:a |an )?(?:personal )?(?:(?:buy|sell|hold|trade)(?: or (?:buy|sell|hold))?\s+)?(?:recommendation|advice|signal|call)\b|"
                r"\btake this as\b"),
    "clause_split": r"([.!?;:\n]|[—–]|,\s*(?:but|and|so|though|however)\b|\bbut\b)",
    "warning": (r"\b(?:red flags?|warning signs?|hallmark|fraud\w*|scam\w*|scheme|be (?:skeptical|wary|careful|suspicious)|beware|"
                r"illegal|manipulation|pitches|(?:someone|anyone|people|promoters|scammers|they|pitch|ads?|influencers?|gurus?)\s+"
                r"(?:who\s+)?(?:promis\w*|claim\w*|pitch\w*|tell you|say))\b"),
    "neg_claim": r"\b(?:no|not|nothing|nobody|no one|never|cannot|can't|isn't|aren't|doesn't|don't|won't|without)\b[^.!?\n;,]{0,40}?\bguarantee\w*",
    "quoted": r"(^|[\s(\[])(['\"])((?:[A-Za-z]'[A-Za-z]|[^'\"\n]){1,60}?)\2(?=[\s.,;:!?)\]]|$)",
    "speaks_to_person": r"\b(?:you|your|u|my|i'?d|i would|i'm|i am)\b",
    "conditional_sub": (r"\b(?:if|when|whenever|unless|whether|in case|even if|should (?=a |an |the |it |this |that ))"
                        r"[^,.;!?\n]{0,60}"),
    # ---- clause-initial instruction
    "imp_split": r"(,|:|\s-\s|[—–]|\band then\b|\bthen\b|\bbut\b|\bso\b)",
    "imperative": _CLAUSE_HEAD + _IMP + r"(?![A-Za-z0-9-])",
    "crit_imperative": _CLAUSE_HEAD + (r"(?:use|take|put|pull|cash out|borrow|go|bet|throw|max|crank|lever|liquidate|raid|move|"
                                       r"run|mortgage|structure|spam|"
                                       r"(?:don't|dont|do not|never|avoid) (?:report|declare|pay|tell|file|disclose|mention)\w*|"
                                       r"refinance|skip|hide|keep|underreport|front[- ]?run|trade|act|spread|hype|"
                                       r"post|coordinate|get|gamble|chase|revenge[- ]trade|margin up|concentrate|dump|pump|sell|buy|load|"
                                       r"double|tap|dip into|drain|empty|withdraw|let's|lets|everyone|we|risk|sink|push|ape|full|win|"
                                       r"grab|stake)") + r"(?![A-Za-z0-9-])",
    "conditional_start": (r"^[^A-Za-z0-9]*(?:if|when|whenever|once|as long as|unless|should|in case|after|before|until|till|while|"
                          r"now that|since|because|given)\b"),
    "head_person": r"\b(?:you|your|u|i|i'd|i'm|we|let's)\b",
    # a short head that is a third-person subject + verb ("Traders buy, then sell") is a description, not an interjection
    "head_third_person": (r"^[^A-Za-z0-9]*(?:the|a|an|this|that|these|those|it|they|he|she|some|many|most|few|traders?|"
                          r"investors?|people|buyers?|sellers?|price|prices|stocks?|shares?|institutions|funds)\b"),
    "question": r"[^.!?\n]+\?",
    "open_question": r"^[^A-Za-z0-9]*(?:is|are|should|would|could|do|does|can|when|how|what|which|who|where)(?!n't)\b(?![^?]*\bstill\b)",
    # ---- advice by structure
    "second_person": (r"\b(?:you|u|ya|y'all|yall)(?:'d|'ll|'re|\s+(?:would|will|are|really|probably|prob|definitely|def|just|"
                      r"honestly|seriously|also|still))*\s+(?:should|shud|shuld|shoud|shld|could|might|may|gotta|got to|need to|needa|"
                      r"have to|ought to|must|want to|wanna|better|be better off|better off|be smart to|do well to|be wise to|want|"
                      r"going to want to)\s+"
                      r"(?:(?:probably|prob|really|definitely|def|defo|just|seriously|honestly|also|still|consider|think about|be|not|"
                      r"look to|start|go ahead and|try to|to|well to|want to|wish to|like to|as well)\s+)*" + _TA + _END
                      + r"|\b(?:suggest|recommend|advise|urge)\s+(?:that\s+)?(?:you|u)\s+" + _TA + _END
                      + r"|\b(?:might|may) as well " + _TA + _END),
    # "the move here is to sell", "your play is to trim", "it's not too late to buy", "puts are the play"
    "the_move": (r"\b(?:the|your|my|best|smartest|smart|right|next)\s+(?:(?:best|smartest|smart|right|next|only)\s+)?"
                 r"(?:move|play|call|step|bet|option)\s+(?:here\s+|now\s+)?(?:is|should be|would be|'s)\s+(?:to\s+)?" + _TA + _END
                 + r"|\b(?:not too late|still time|never too late|time is now) to " + _TA + _END
                 + r"|\b(?:calls|puts|shares|options|spreads|it|this|that)\s+(?:are|is)\s+the\s+(?:play|move|trade|way to go)\b"),
    "first_person": (r"\b(?:i'?d|i would|i wouldn't|i would not|i'll|i will|i'm|im|i am|if i were you|if it were (?:me|my money)|"
                     r"in your shoes|personally|my (?:move|play|pick|call|advice|suggestion|recommendation|vote)|i think you|"
                     r"i say|imo|i lean)\b[^.!?\n]{0,40}?\b" + _TA + _END
                     + r"|\bi like (?:it|this|that|them)(?: here)? (?:as an entry|for a (?:trade|swing|position)|here)\b"),
    "evaluative": (r"\b(?:(?:good|great|decent|perfect|ideal|nice|solid|smart|wise|prudent|reasonable|best|better|safer?|fine|"
                   r"optimal|not a bad)\s+|right\s+(?=(?:time|moment|spot|place|move|call)\b))"
                   r"(?:(?:time|spot|place|idea|move|play|bet|entry|level|point|choice|call|moment|area|zone)\s+)?"
                   r"(?:to|for)\s+" + _TA + _END + r"|\b(?:worth|worthwhile)\s+" + _TA + _END),
    "endorsed_action": (r"\b(?:buying|selling|shorting|holding|adding|trimming|exiting|taking (?:profits?|some|gains|half)|waiting|"
                        r"cutting|lightening|averaging|scaling|loading|aping|getting (?:in|out)|staying|closing|"
                        r"a (?:partial )?(?:exit|trim|sale)|a (?:small |starter |partial |full )?position|this entry|"
                        r"going (?:long|short|all[- ]?in))\b[^.!?\n]{0,40}?\b(?:(?:is|seems|looks|would be|'d be|could be|might be|"
                        r"wouldn't be|feels|sounds)\s+(?:like\s+)?(?:(?:probably|definitely|honestly|really|the|your)\s+)*"
                        r"(?:reasonable|wise|smart|prudent|sensible|move|play|way to go|right call|smart play|"
                        r"(?:best|better|safer|smarter) (?:bet|move|play|option|choice|call)|a good (?:idea|call|move|play)|fine|right|"
                        r"correct|crazy)|makes? sense)\b"),
    "recommendation": (r"\b(?:this|it|that|this one|this stock|here)\s*(?:'s|is|looks like|seems like|looks|feels like|is still|is now)\s+"
                       r"(?:a\s+)?(?:strong\s+|clear\s+|solid\s+|great\s+|good\s+|easy\s+)?(?:buy|sell|hold|short)(?![A-Za-z0-9-])"
                       r"(?!\s+(?:rating|order|stop|side|signal|recommendation|or|and|call|limit|zone|point|setup)\b)|"
                       r"^[^A-Za-z0-9]*(?:looks|seems) like a (?:buy|sell|good entry|great entry)\b|\bstrong (?:buy|sell)\b(?!\s+(?:rating|signal|order))|"
                       r"\b(?:buy|sell) rating from (?:me|us)\b|\bbuyable\b|"
                       r"\b(?:looks like|seems like|this is|that's|it's|here's) a (?:good|great|nice|solid|decent|perfect|ideal) (?:entry|spot|place|level)\b|"
                       r"\b(?:good|great|nice|solid|decent) entry (?:here|now|for you)\b"),
    "your_ticket": (r"\byour (?:entry|stop(?:-loss)?|stop loss|target|exit|position(?: size)?|size|buy point|sell point)\s+"
                    r"(?:should|belongs|goes|needs|must|has to|ought|could go|would be|is (?:at|under|below|above|around|about|\$?\d)|"
                    r"at|@|=|:)" + _END + r"|\b(?:that's|this is|here's|there's|that is) your (?:entry|exit|buy point|sell point|signal|"
                    r"stop|chance|spot|cue)\b|\b(?:that's|this is|here's|there's) (?:where|when) (?:you|to|i'd) " + _TA + _END + r"|\b(?:right|correct|best|ideal|proper) (?:size|entry|stop|exit|position(?: size)?) for you\b"),
    "for_you": (r"\b" + _YOU_ME + r"\b[^.!?\n]{0,50}?\b(?:" + _TA + r"|position|shares|size)" + _END
                + r"|\b(?:" + _TA + r"|position|shares)\b[^.!?\n]{0,50}?\b" + _YOU_ME + r"\b"),
    "no_harm": (r"\b(?:wouldn't|won't|doesn't|does not|would not|can't) hurt to " + _TA + _END
                + r"|\b(?:no|little) (?:need|reason|rush|point) to " + _TA + r"\b[^.!?\n]{0,20}?\b(?:yet|now|here|today|it|this)\b"
                + r"|\bbetter (?:get|sell|buy|hold|take|add|trim|exit|cut|load|grab)\b"),
    "rhetorical": (r"\bwhy (?:wouldn't|would not|wouldnt|not|aren't|don't|dont) you (?:still )?" + _TA + _END
                   + r"|\bwhy are you still " + _TA + _END + r"|\bwhy not " + _TA + _END
                   + r"|\bwhy hold (?:a|this|that|it|on to)\b|\bwhat are you waiting for\b|\bwho (?:wouldn't|would not) " + _TA + _END
                   + r"|\bshouldn't you (?:be )?" + _TA + _END + r"|\b(?:isn't|is) it (?:obvious|clear|time)\b[^.!?\n]{0,30}\b" + _TA + _END
                   + r"|\bdon't you think it'?s time\b|\bwouldn't (?:now|this|it|today|here) be a (?:good|great|perfect) (?:time|spot|place)\b"
                   + r"|\bwhat'?s stopping you\b"),
    "ticket": (r"\b(?:entry|stop|stop[- ]loss|sl|tp|take[- ]profit|buy zone|sell zone|buy point|cover)\s*(?:at|@|:|=|is|of|around|near|zone|under|below|above)?\s*\$?\d"
               r"|\b\d[\d,.]*k?\s*(?:shares|contracts)\b(?=[^.!?\n]{0,25}\b(?:at|stop|entry|now|here|today)\b|[^.!?\n]{0,25}@)"
               r"|(?:^|[.!?\n]\s*)(?:long|short)\s+\d|\d\s*@\s*\$?\d"),
    "foreign": (r"\b(?:compra|compre|compren|comprar|vende|venda|vendan|vender|manten|mantenga|mantenha|deberias|debes|deveria|"
                r"segure|kauf|kaufe|kaufen|verkauf|verkaufe|verkaufen|halte|solltest|achete|achetez|acheter|vends|vendez|vendre|"
                r"garde (?:tes|vos|la|le|les)|gardez|devrais|devriez|compri|vendi|tieni|dovresti|koop|kopen|verkoop|verkopen|kupuj|"
                r"kup|sprzedaj|sprzedawaj|beli|jual|mua|ban ngay|kharido|becho|sat(?:in|ın) al|simdi al|sat simdi)\b"),
    # ---- critical risk
    "crit_topic": (r"\b(?:margin|leverag\w*|lever(?:ed)? up|\d+ ?x|all[- ]?in|everything|every (?:penny|dollar|cent)|"
                   r"(?:whole|entire|full|life) (?:account|portfolio|savings|net worth|stack|buying power|bankroll)|full[- ]?port|the farm|"
                   r"all (?:of )?your (?:money|cash|savings|buying power|capital|equity)|lever(?:ed|ing)?|college fund|tuition|"
                   r"(?:kids?|children)'?s? (?:money|fund|savings)|paycheck|salary|wages|debt|"
                   r"(?:spouse|wife|husband|partner|friend|relative)'?s? (?:account|name)|someone else'?s (?:account|name)|"
                   r"followers|audience|subscribers|the chat|discord|telegram|reddit|twitter|forums?|"
                   r"win (?:it )?(?:all )?back|"
                   r"100 ?% of|it all|loans?|borrow\w*|credit cards?|heloc|mortgage|refinanc\w*|cash advance|payday|401 ?\(?k\)?|ira|"
                   r"roth|pension|retirement|emergency fund|rent|bills|grocer\w*|last (?:savings|\$?\d|dollar|paycheck)|savings|tax\w*|irs|"
                   r"declare|offshore|insider|inside info\w*|non-?public|tip|leak\w*|front[- ]?run\w*|"
                   r"before (?:it'?s|it is|the news is) public|before it gets out|(?:saw|heard) (?:it )?early|"
                   r"ahead of the (?:announcement|press release|news|report|earnings)|told (?:you|me)|"
                   r"(?:friend|cousin|buddy|brother|sister|contact|guy|someone) (?:at|in|from|who works at)|pump\w*|dump on|"
                   r"coordinat\w*|everyone|together|rumou?r|hype it|push it up|win (?:it )?back|get it (?:all )?back|make it back|"
                   r"losses|revenge|nothing (?:left )?to lose|desperate|gambl\w*|your (?:car|house|home))(?![A-Za-z0-9])"),
    "crit_stance": (r"\b(?:you|u|ya)(?:'d|'ll|'re)?\s+(?:[a-z]+\s+)?(?:should|could|might|may|gotta|need to|have to|ought to|must|"
                    r"want to|better)\b|\b(?:i'?d|i would|if i were you|personally|in your shoes|my advice)\b|"
                    r"\b(?:it'?s|it is|that'?s|totally|perfectly)\s+(?:okay|ok|fine|alright|smart|wise|reasonable|safe)\s+to\b|"
                    r"\bwould (?:let you|boost|juice|maximi[sz]e|amplify|grow|multiply)\b|\bmakes? sense (?:here|now|for you|for this|today)\b|"
                    r"\bis the (?:move|play|way)\b|\blet'?s (?:all |just )?(?:buy|sell|pump|dump|push|load|get|go|ape|pile|coordinate|hype)\b|"
                    r"\bwe (?:pump|buy|dump|all|sell|push|load)\b|\beveryone (?:buy|sell|load|pile|get)\b|\ball[- ]?in (?:on|into|here|now)\b|"
                    r"^[^A-Za-z0-9]*all[- ]?in[^A-Za-z0-9]*$"),
    "crit_claim": (r"\b(?:double your money|make you rich|make your money back|(?:you'?ll|you will) (?:make|get|win) it (?:all )?back|"
                   r"nothing (?:really )?matters|nothing left to lose|only way out|nobody checks|no one checks|"
                   r"(?:irs|they|nobody) (?:won't|will not|wont|will never) (?:notice|know|find out|check)|"
                   r"guaranteed (?:winner|\d+ ?%|returns?|profits?|money|gains?)|100 ?% win rate|always pays|zero[- ]?risk|"
                   r"we pump|pump it|(?:then|and) (?:we )?dump|squeeze the shorts|easy \d+ ?x|definitely profit|underreport\w*|"
                   r"don't (?:report|declare)|off (?:your|the) (?:tax|books)|stay under (?:the )?reporting|"
                   r"structur\w* (?:the |your )?(?:deposits|withdrawals|transfers))(?![A-Za-z0-9])"),
}
_R = {k: re.compile(v, re.I | re.A) for k, v in RECALL_PATTERNS.items()}
_ADVICE_RULES = ("second_person", "the_move", "first_person", "evaluative", "endorsed_action", "recommendation", "your_ticket",
                 "for_you", "no_harm", "rhetorical", "ticket", "foreign")
_WORD = re.compile(r"[A-Za-z0-9']+", re.A)
_SENTENCE = re.compile(r"[^.!?\n]+")


def _strip_quotes(t: str) -> str:
    """A short quoted span is a MENTION ("'buy the dip' is a phrase") and is removed -- unless the rest of its sentence
    speaks to or as a person ("my call: 'buy now'")."""
    def one(m: re.Match) -> str:
        s = m.group(0)
        bare = _R["quoted"].sub(lambda q: q.group(1) + " ", s)
        return s if _R["speaks_to_person"].search(bare) else bare
    return _SENTENCE.sub(one, t)


def _blank_clauses(t: str, rx: re.Pattern) -> str:
    parts = _R["clause_split"].split(t)
    return "".join(" " if (i % 2 == 0 and rx.search(p)) else p for i, p in enumerate(parts))


def _prepared(text: str) -> tuple[str, str]:
    """(advice text, claim text): normalised, quoted mentions removed, refusal clauses removed; the claim text also
    loses warning clauses and negated guarantees."""
    t = _blank_clauses(_strip_quotes(normalize(text)), _R["refusal"])
    claims = _R["neg_claim"].sub(" ", _blank_clauses(t, _R["warning"]))
    return t, claims


def _instructs(sentence: str, rx: re.Pattern) -> bool:
    """A clause of the sentence STARTS with an instruction matched by rx. A later clause counts only when the
    sentence's head is an instruction, a condition, a short interjection or speaks to / as a person, or the clause
    follows 'so' or a colon ("..., so buy before the report", "bottom line: sell")."""
    parts = _R["imp_split"].split(sentence)
    clauses, delims = parts[0::2], [""] + parts[1::2]
    head = clauses[0]
    head_ok = bool(_R["imperative"].search(head) or _R["crit_imperative"].search(head) or _R["conditional_start"].search(head)
                   or (len(_WORD.findall(head)) <= 3 and not _R["head_third_person"].search(head))
                   or _R["head_person"].search(head))
    for i, c in enumerate(clauses):
        if (i == 0 or head_ok or delims[i].strip().lower() in ("so", ":")) and rx.search(c):
            return True
    return False


def _non_latin(t: str) -> bool:
    letters = [ch for ch in t if ch.isalpha()]
    other = sum(1 for ch in letters if not ("a" <= ch.lower() <= "z"))
    return other >= 3 and other * 5 >= len(letters)


def _without_open_questions(t: str) -> str:
    """An open question ("Is it smart to use margin?", "When should you sell?") asks; it does not instruct. A negated or
    'still' question ("Shouldn't you be trimming?", "Why are you still holding?") is kept -- the rhetorical rule reads it."""
    return _R["question"].sub(lambda m: " " if _R["open_question"].search(m.group(0)) else m.group(0), t)


def advice(text: str) -> list[str]:
    """The structural advice rules a text trips (names), refusal clauses, quoted mentions and open questions removed first."""
    t0, _ = _prepared(text)
    t = _without_open_questions(t0)
    sentences = _SENTENCE.findall(t)
    names = []
    if any(_instructs(s, _R["imperative"]) for s in sentences):
        names.append("imperative")
    names += [n for n in _ADVICE_RULES if _R[n].search(t0 if n == "rhetorical" else t)]
    if _non_latin(normalize(text)):
        names.append("unverified-script")
    return names


def critical(text: str) -> list[str]:
    """Critical-risk rules: a critical topic in a sentence that directs or encourages, and critical claims."""
    t, claims = _prepared(text)
    names = []
    for s in _SENTENCE.findall(_without_open_questions(t)):
        if _R["crit_topic"].search(s) and (_R["crit_stance"].search(s) or _instructs(s, _R["crit_imperative"])
                                           or _instructs(s, _R["imperative"])):
            names.append("critical-directive")
            break
    if _R["crit_claim"].search(claims):
        names.append("critical-claim")
    return names


# W3 guard-recall: only two narrowings of the original outcome list -- "expectancy" (a statistic) and "going to cash / going
# to explain" are not predictions; the original noun words (breakout, outcome ...) stay
OUTCOME = re.compile(r"\b(?:will|likely|unlikely|probab\w*|odds|chances?|expect(?!anc)\w*|outcomes?|follow[- ]?through|work(?:s|ed)? out|"
                     r"play(?:s|ed)? out|next (?:move|session|week|day|leg)|"
                     r"going to(?! cash\b| (?:tell|explain|show|say|walk|cover|look|talk|go over|answer|help|give)\b)|gonna|succeed\w*|"
                     r"fail\w*|targets?|upside|downside|forecast\w*|predict\w*|rally|rallies|bounce\w*|break ?outs?|breakdowns?|"
                     r"continu\w*|resolv\w*|should (?:hold|work|go|rally|bounce))\b", re.I)
HEDGE = re.compile(r"\b(?:may|might|could|often|sometimes|tends? to|tend|not guaranteed|no guarantee|no guarantees|isn't guaranteed|"
                   r"uncertain\w*|not certain|no certainty|no way to know|cannot know|can't know|nobody knows|unknown|"
                   r"doesn't always|does not always|not always|don't always|do not always|depends|historically|in the past|hypothesis|"
                   r"one input|not a forecast|not a prediction|not a promise|not predictions|can fail|could fail|might fail|"
                   r"may fail|can reverse|could reverse|can break|could break|can still|could still|may still|no pattern|cannot be known|"
                   r"can't be known|can work|either way|possibility|possible|possibly|perhaps|not a signal|not a rule|not rules|estimate\w*)\b", re.I)

# a figure: 20, 20.5, 1,000, $10, 15%, -3, 2R (the letter after is fine); a letter BEFORE a digit is not a figure ("v2")
_FIGURE = re.compile(r"(?<![A-Za-z0-9])[-+]?\$?(\d[\d,]*(?:\.\d+)?)%?")


def figures(text: str) -> set[str]:
    """Every number in the text, canonical ('1,000' -> '1000', '20.50' -> '20.5')."""
    out: set[str] = set()
    for m in _FIGURE.finditer(str(text or "")):
        raw = m.group(1).replace(",", "")
        try:
            v = float(raw)
        except ValueError:
            continue
        out.add(str(int(v)) if v.is_integer() else repr(v).rstrip("0").rstrip("."))
    return out


def _input_text(inputs: Iterable[str] | str | None) -> str:
    if inputs is None:
        return ""
    if isinstance(inputs, str):
        return inputs
    return "\n".join(str(x) for x in inputs if x)


# a NEGATED universal ("neither approach works every time", "no setup always works") is a hedge, not a claim
_NEGATED_UNIVERSAL = re.compile(r"\b(?:no|neither|not|nothing|none|never)\b[^.!?\n]{0,30}?\b(?:works? every time|always works?|always wins?)\b", re.I)


def unsupported(text: str) -> list[str]:
    t = _NEGATED_UNIVERSAL.sub(" ", _NEGATED.sub(" ", _prepared(text)[1]))
    return [name for name, rx in UNSUPPORTED if rx.search(t)]


# a DESCRIPTION of what other people do ("traders often buy on the pullback") is not advice: a trade-timing match whose
# sentence starts with a third-person subject is skipped (the advisory-stance rule still catches "many traders WOULD")
_DESCRIPTIVE = re.compile(r"^\s*(?:some|many|most|other|few|these|those)?\s*(?:traders|investors|people|buyers|sellers|"
                          r"institutions|funds|others|bulls|bears)\b", re.I)


def _described(rx: re.Pattern, t: str) -> bool:
    """Every match of rx sits in a sentence that describes other people."""
    hits = [m.start() for m in rx.finditer(t)]
    if not hits:
        return False
    for start in hits:
        sent_start = max(t.rfind(".", 0, start), t.rfind("!", 0, start), t.rfind("?", 0, start), t.rfind("\n", 0, start)) + 1
        if not _DESCRIPTIVE.search(t[sent_start:start + 1]):
            return False
    return True


def order_language(text: str) -> list[str]:
    t = _prepared(text)[0]
    return [name for name, rx in ORDER if rx.search(t) and not (name == "trade-timing" and _described(rx, t))]


def untraceable_figures(text: str, inputs: Iterable[str] | str | None) -> list[str]:
    allowed = figures(_input_text(inputs))
    return sorted(f for f in figures(text) if f not in allowed)


def about_outcomes(text: str) -> bool:
    """Outcome talk -- a condition ("if the trade fails, ...") is not a prediction and is removed first."""
    return bool(OUTCOME.search(_R["conditional_sub"].sub(" ", _strip_quotes(normalize(text)))))


def has_hedge(text: str) -> bool:
    """A real hedge -- the mandated footer is stripped first, so it can never stand in for one (W3 review C2)."""
    t = _FOOTER_RX.sub(" ", normalize(text))
    return bool(HEDGE.search(t) or _NEGATED_UNIVERSAL.search(t))     # "neither approach works every time" hedges too


def check(reply: str, inputs: Iterable[str] | str | None = None) -> list[str]:
    """The violation codes of a reply (empty = clean), in CODES order."""
    codes: list[str] = []
    crit = critical(reply)
    if unsupported(reply) or "critical-claim" in crit:
        codes.append("unsupported")
    if order_language(reply) or advice(reply) or "critical-directive" in crit:
        codes.append("order")
    if untraceable_figures(normalize(reply), inputs):
        codes.append("figure")
    if about_outcomes(reply) and not has_hedge(reply):
        codes.append("uncertainty")
    return codes


def ensure_footer(text: str) -> str:
    t = str(text or "").rstrip()
    if "educational" in t.lower():
        return t
    return (t + "\n\n" + FOOTER) if t else FOOTER


def enforce(reply: str, inputs: Iterable[str] | str | None = None) -> dict:
    """{text, violations}: the reply with the footer, or FIXED when it violates (never an edited reply)."""
    codes = check(reply, inputs)
    if codes:
        return {"text": FIXED, "violations": codes}
    return {"text": ensure_footer(reply), "violations": []}
