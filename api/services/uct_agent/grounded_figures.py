"""SG-3 v2 — a TALK reply that read no data states no market-OUTCOME figures (AUDIT live prod f591d31720, 2026-11-04).

The live defect: "how does SPY do after new 50-day highs" (no event-study kind served) was answered from the model's
memory with invented quantitative claims. Review #815 withdrew the first guard (a word list on the QUESTION: false
positives on coaching, education, UCT help and the member's own data). This one never reads the question. It looks only
at the REPLY, and only on a turn whose answer is not backed by anything UCT read:

* the turn planned no op, did no research, is not a coach turn and carries no member-data (coach) context;
* a sentence of the reply states a market-OUTCOME figure: a percentage (or a % range, bps) ATTACHED to an outcome —
  a proportion of setups / the time ("60% of breakouts fail"), an outcome measure ("an average return of 9%", "a 12%
  drawdown", "win rate of 55%"), or a ticker / index / setup moving by it ("SPY gained 2-3%", "breakouts rally 20%");
* and that figure does not appear in what UCT itself gave the model this turn (the request context and the replayed
  outcome rows) — a figure copied from UCT's own data is grounded.

Such sentences are removed and one honest sentence says why; a reply left empty becomes that sentence. A threshold or a
rule ("volume 40% above average", "cut losses at 7-8%", "within 5% of the pivot") is not an outcome and stays; tendency
words without a figure stay. Pure; no model call.
"""
from __future__ import annotations

import json
import re
from typing import Any, Iterable

_NUM = r"[+\-−]?\d+(?:\.\d+)?"
_FIG = rf"(?P<n>{_NUM})(?:\s?(?:-|–|to)\s?(?P<n2>{_NUM}))?\s?(?:%|percent\b|pct\b|bps\b|basis points\b)"
FIG = re.compile(_FIG, re.I)
_FIGU = _FIG.replace("?P<n>", "").replace("?P<n2>", "")          # (an unnamed copy for the combined patterns)
#: what a setup / an outcome is counted over ("60% of breakouts", "70% of the time")
_POOL = (r"(?:the )?(?:time|breakouts?|break-?outs?|gaps?|setups?|trades?|stocks?|names|cases|signals?|ipos?|bases?|"
         r"pullbacks?|earnings(?: reports| moves| gaps)?|instances|occasions|years|months|sessions|days|weeks|them)")
_PROPORTION = re.compile(rf"{_FIGU}\s+of\s+{_POOL}\b", re.I)
#: an outcome MEASURE next to the figure ("average annual return of 9%", "a 12% drawdown", "win rate of 55%")
_MEASURE = (r"(?:(?:average|median|typical|annual(?:ized)?|historical|expected|mean|forward|cumulative)\s+(?:\w+\s+)?"
            r"(?:returns?|gains?|loss(?:es)?|moves?|declines?|drops?|rall(?:y|ies)|pullbacks?|drawdowns?|performance)|"
            r"returns?|gains?|drawdowns?|pullbacks?|rall(?:y|ies)|corrections?|win rate|hit rate|success rate|failure rate|"
            r"fill rate|odds|probability|chance|averag(?:es|ed|ing))")
_MEASURE_NEAR = re.compile(rf"\b{_MEASURE}\b\W+(?:\w+\W+){{0,12}}?{_FIGU}|{_FIGU}\W+(?:\w+\W+){{0,2}}?{_MEASURE}\b", re.I)
#: a ticker / index / setup MOVING by the figure ("SPY gained 2-3%", "breakouts rally 20%", "NVDA moves 8% on earnings")
_SUBJECT = (r"(?:\$[A-Za-z]{1,5}\b|\b(?-i:[A-Z]{1,5})\b|\b(?:S&P(?: 500)?|Nasdaq|Dow|Russell(?: 2000)?|the market|the index|"
            r"indexes|indices|stocks?|shares|leaders|breakouts?|gaps?|pullbacks?|bases?|setups?|ipos?|small caps|large caps)\b)")
_MOVES = (r"(?:rose|rises?|rising|fell|falls?|falling|gain(?:s|ed|ing)?|lost|loses?|losing|return(?:s|ed)?|mov(?:es|ed|e|ing)|"
          r"drop(?:s|ped)?|rall(?:ied|ies|y)|jump(?:s|ed)?|climb(?:s|ed)?|declin(?:es|ed)|pull(?:s|ed)? back|averag(?:es|ed)|"
          r"outperform\w*|underperform\w*|is up|was up|is down|was down|tend(?:s|ed)? to (?:gain|rise|fall|drop|move|rally)|"
          r"correct(?:s|ed|ing)?|higher|lower|up|down)")
_SUBJECT_MOVES = re.compile(rf"{_SUBJECT}[^.;!?]{{0,60}}?\b{_MOVES}\b[^.;!?]{{0,30}}?{_FIGU}", re.I)
#: uppercase words that are not tickers (indicators, macro series, units, pronouns)
_NOT_TICKER = frozenset({"I", "A", "RSI", "EMA", "SMA", "MA", "DMA", "MACD", "ATR", "ADR", "ADX", "EPS", "PE", "P", "E", "CPI",
                         "PPI", "GDP", "FOMC", "ET", "US", "USA", "VWAP", "OK", "AI", "UCT", "CEO", "IPO", "ETF", "ETFS", "OBV",
                         "NH", "NL", "AD", "YTD", "QOQ", "YOY", "ROE", "ROI", "PEG", "FCF", "R", "X"})

SENTENCE = re.compile(r"(?<=[.!?;])\s+|\n+")
NOTE = ("I left figures out of that: nothing in UCT was read for this answer, so I don't state market returns, odds or "
        "moves from general knowledge.")
EMPTY = ("I can't answer that with figures from UCT's data yet: nothing in UCT was read for it, so I won't state market "
         "returns, odds or moves from general knowledge.")


def _subject_ok(sentence: str) -> bool:
    """The subject-moves rule fires only for a real subject: an uppercase word that is not an indicator / unit."""
    for m in _SUBJECT_MOVES.finditer(sentence):
        word = re.match(r"\$?([A-Za-z&]+)", m.group(0))
        w = word.group(1) if word else ""
        if w.isupper() and w in _NOT_TICKER:
            continue
        return True
    return False


def outcome_figures(sentence: str) -> list[str]:
    """The market-outcome figures stated in ONE sentence (their number strings), or [] — a threshold or a rule is not."""
    if not FIG.search(sentence or ""):
        return []
    hits = []
    for rx in (_PROPORTION, _MEASURE_NEAR):
        hits += [m for m in rx.finditer(sentence)]
    if not hits and _subject_ok(sentence):
        hits += [m for m in _SUBJECT_MOVES.finditer(sentence)]
    out = []
    for m in hits:
        for f in FIG.finditer(m.group(0)):
            out += [x for x in (f.group("n"), f.group("n2")) if x]
    return out


def _norm(n: str) -> str:
    s = n.replace("−", "-").lstrip("+-")
    return s.rstrip("0").rstrip(".") if "." in s else s


def known_numbers(context: Any, history: Iterable[dict] | None) -> set[str]:
    """Every number UCT itself gave the model this turn: the request context and the replayed OUTCOME rows (UCT's own
    text; the model's earlier replies are never a source)."""
    texts = []
    try:
        texts.append(json.dumps(context, default=str))
    except (TypeError, ValueError):
        pass
    for t in history or []:
        if isinstance(t, dict) and t.get("role") == "outcome":
            texts.append(str(t.get("text") or ""))
    return {_norm(x) for x in re.findall(_NUM, " ".join(texts))}


def ungrounded(reply: str, known: set[str]) -> list[str]:
    """The sentences of `reply` stating an outcome figure UCT never gave, in order."""
    bad = []
    for s in SENTENCE.split(str(reply or "")):
        figs = outcome_figures(s)
        if figs and any(_norm(f) not in known for f in figs):
            bad.append(s)
    return bad


def guard(envelope: dict, *, context: Any, history: list | None, research_read: bool, coach_turn: bool,
          answer_only: bool) -> dict:
    """SG-3 v2 on the turn's final envelope: a talk answer that read nothing loses its ungrounded outcome figures."""
    if (not isinstance(envelope, dict) or envelope.get("disposition") != "answer" or envelope.get("ops")
            or research_read or coach_turn or answer_only):
        return envelope
    if isinstance(context, dict) and isinstance(context.get("coach"), list) and context["coach"]:
        return envelope                                    # the member's own data (journal / trades) is the coach's
    reply = str(envelope.get("reply") or "")
    bad = ungrounded(reply, known_numbers(context, history))
    if not bad:
        return envelope
    kept = [s for s in SENTENCE.split(reply) if s and s not in bad]
    text = (" ".join(kept).strip() + " " + NOTE).strip() if any(k.strip() for k in kept) else EMPTY
    return {**envelope, "reply": text}
