"""SLICE 2 -- the conversational door's DETERMINISTIC PRE-FLIGHT.

Some requests are unsupported in conversational authoring however a model
phrases them: reading ANOTHER SYMBOL, or ANOTHER TIMEFRAME than the chart's own.
When a member asks for one explicitly, this answers before any model call --
zero calls, zero cost -- in the same capability language the post-call gates use
("draws on the chart's own bars only").

⛔ CONSERVATIVE BY DESIGN. This is not a language parser. It intercepts only:
  * another symbol: an explicit UPPERCASE ticker (never product/indicator
    vocabulary, never the chart's own symbol) after a comparison cue
    ("compare", "vs", "relative to"...) or a direct use cue ("use SPY",
    "RSI of QQQ"). Without the chart's symbol, only a comparison naming two
    distinct tickers counts -- a lone ticker might be the chart's own.
  * another timeframe: an explicit timeframe phrase ("5 minute", "weekly")
    with timeframe context ("... timeframe", "weekly RSI", "use the hourly"),
    only when the chart's timeframe is known and differs, and NEVER in a
    question ("Does this work on a 5 minute chart?" -- an indicator runs on
    whatever chart it is added to; only the model can answer that honestly).
Anything else goes to the model. A false refusal is worse than one model call.

⭐ P3 (2026-10-06):
  * A QUESTION is never intercepted -- another symbol included ("What does RSI
    on SPY look like?"). ``shape()`` is the ONE deterministic detector (rules
    file ``questionShape``): an authoring clause anywhere ("add", "can you make",
    "I want") wins; otherwise a trailing '?' or an interrogative / advisory
    opener in any clause ("tell me which...", "so, should I...") is a question.
    The server's ``/converse`` uses the same detector to route advisory turns
    past the planner's Title-Case refusal, and ``other_symbol()`` (question or
    not) backs its no-substitution backstop.
  * Possessive / adjacent other-symbol AUTHORING ("SPY's RSI", "SPY RSI above
    50", "use QQQ's close") is caught when the chart symbol is known.
  * ``notTickerPhrases`` ("CAN SLIM") are blanked before any ticker is read.

The rules are DATA shared with the browser
(``app/src/components/chart/builder/authoring/preflightRules.json``) and pinned
by one case table both languages assert (``preflightCases.json``). The browser's
copy is a latency shortcut; this one is authoritative.
"""
from __future__ import annotations

import functools
import json
import re
from pathlib import Path
from typing import Any, Dict, List, Mapping, Optional, Tuple

ROOT = Path(__file__).resolve().parents[2]
AUTHORING = ROOT / "app" / "src" / "components" / "chart" / "builder" / "authoring"
RULES_PATH = AUTHORING / "preflightRules.json"
CLOSED_TABLE_PATH = ROOT / "app" / "src" / "components" / "chart" / "engine" / "ast" / "closedTable.json"

GATE_SYMBOL = "unsupported:other-symbol"
GATE_TIMEFRAME = "unsupported:other-timeframe"
#: ⭐ PHASE 5 -- an other-symbol spelling that also names an index / commodity.
GATE_SYMBOL_AMBIGUOUS = "unsupported:symbol-ambiguous"
CROSS_CONTEXT_PATH = AUTHORING / "crossContext.json"

#: ⭐ PHASE 5 -- the whole-instance calculation ladder, in minutes (D/W/M as
#: trading-day multiples are ranked above every intraday code).
_RANK = {"D": 10_000, "W": 50_000, "M": 210_000}


@functools.lru_cache(maxsize=1)
def cross_context() -> Dict[str, Any]:
    return json.loads(CROSS_CONTEXT_PATH.read_text(encoding="utf-8"))


def store_ticker(ticker: Any) -> str:
    """``BRK.B`` -> ``BRK-B`` (``otherSymbols.js::storeTickerOf``); else upper."""
    t = str(ticker or "").strip().lstrip("$").upper()
    m = re.fullmatch(r"([A-Z]{1,5})\.([A-Z])", t)
    return f"{m.group(1)}-{m.group(2)}" if m else t


def _rank(code: str) -> int:
    return _RANK[code] if code in _RANK else int(code[:-1])


def _ladder() -> List[str]:
    """The calculation codes in this module's spelling ('D'/'W'/'M'/'<n>m')."""
    return [c if c in _RANK else f"{c}m" for c in cross_context()["calculationTimeframes"]]


@functools.lru_cache(maxsize=1)
def rules() -> Dict[str, Any]:
    return json.loads(RULES_PATH.read_text(encoding="utf-8"))


@functools.lru_cache(maxsize=1)
def _not_tickers() -> frozenset:
    words = {w.upper() for w in rules()["notTickers"]}
    try:
        table = json.loads(CLOSED_TABLE_PATH.read_text(encoding="utf-8"))
        for section in ("functions", "series"):
            for name in (table.get(section) or {}):
                words.add(str(name).upper())
    except (OSError, ValueError):
        pass
    return frozenset(words)


@functools.lru_cache(maxsize=1)
def _res() -> Dict[str, "re.Pattern[str]"]:
    r = rules()
    return {
        "compare": re.compile(r["compareCue"], re.I),
        "use": re.compile(r["useCue"]),          # case-SENSITIVE: the ticker is as typed
        "ticker": re.compile(r["tickerToken"]),
        "tf_num": re.compile(r["tfNumeric"], re.I),
        "tf_word": re.compile(r["tfWord"], re.I),
        "after": re.compile(r["tfContextAfter"], re.I),
        "before": re.compile(r["tfContextBefore"], re.I),
        "possessive": re.compile(r["possessiveTicker"]),   # case-SENSITIVE
        "adjacent": re.compile(r["adjacentTicker"]),       # case-SENSITIVE
        # ⭐ P3: "CAN SLIM" is a method, not ticker CAN (space or hyphen between words)
        "phrases": re.compile(
            r"\b(?:" + "|".join(r"[\s-]+".join(re.escape(w) for w in re.split(r"[\s-]+", p))
                                for p in r["notTickerPhrases"]) + r")\b", re.I),
    }


@functools.lru_cache(maxsize=1)
def _q() -> Dict[str, "re.Pattern[str]"]:
    q = rules()["questionShape"]
    return {k: re.compile(q[k], re.I) for k in (
        "clauseSplit", "discourse", "trailingQuestion", "interrogativeLead",
        "advisoryLead", "compareLead", "requestLead", "wantLead")}


@functools.lru_cache(maxsize=1)
def _adjacent_nouns() -> frozenset:
    words = {w.lower() for w in rules()["adjacentNouns"]}
    try:
        table = json.loads(CLOSED_TABLE_PATH.read_text(encoding="utf-8"))
        for section in ("functions", "series"):
            for name in (table.get(section) or {}):
                words.add(str(name).lower())
    except (OSError, ValueError):
        pass
    return frozenset(words)


def _clauses(message: str) -> List[str]:
    q = _q()
    out = []
    for part in q["clauseSplit"].split(message):
        if part and part.strip():
            out.append(q["discourse"].sub("", part.strip(), count=1).strip())
    return [c for c in out if c]


def shape(message: Any) -> str:
    """⭐ P3 -- what the member's words ARE, deterministically:
    ``'authoring'`` (an edit request anywhere: "add", "can you make", "I want"),
    ``'question'`` (a trailing '?' or an interrogative / advisory opener in some
    clause: "what", "should", "tell me", "explain"), ``'compare'`` ("compare X
    and Y" with no edit verb -- advisory, but still a REQUEST for the pre-flight),
    or ``'other'``. An authoring clause wins over everything: "Add the McGinley
    Dynamic. What do you think?" is authoring."""
    if not isinstance(message, str) or not message.strip():
        return "other"
    q = _q()
    clauses = _clauses(message)
    for c in clauses:
        if q["advisoryLead"].match(c):
            continue
        if q["requestLead"].match(c) or q["wantLead"].match(c):
            return "authoring"
    if q["trailingQuestion"].search(message.strip()):
        return "question"
    if any(q["interrogativeLead"].match(c) or q["advisoryLead"].match(c) for c in clauses):
        return "question"
    if any(q["compareLead"].match(c) for c in clauses):
        return "compare"
    return "other"


def is_question(message: Any) -> bool:
    """A question (never intercepted by the pre-flight)."""
    return shape(message) == "question"


def is_advisory(message: Any) -> bool:
    """A question OR a bare "compare ..." -- the server routes these to the model
    even when they name things UCT cannot build (the model may DISCUSS them)."""
    return shape(message) in ("question", "compare")


def _norm_sym(sym: Any) -> Optional[str]:
    if not isinstance(sym, str) or not sym.strip():
        return None
    return sym.strip().lstrip("$").upper()


def norm_tf(tf: Any) -> Optional[str]:
    """A chart timeframe code -> 'D' | 'W' | 'M' | '<minutes>m'. None when unknown."""
    if not isinstance(tf, str):
        return None
    t = tf.strip()
    # ⭐ PHASE 5 -- the app's own intraday codes are BARE minutes ('5', '60'): found in
    # the sandbox flow, where a 5-minute chart read as "timeframe unknown" and a request
    # for 1-minute bars reached the model instead of being refused.
    if re.fullmatch(r"\d+", t):
        return f"{int(t)}m"
    m = re.fullmatch(r"(\d+)\s*m", t)
    if m:
        return f"{int(m.group(1))}m"
    m = re.fullmatch(r"(\d+)\s*[hH]", t)
    if m:
        return f"{int(m.group(1)) * 60}m"
    if re.fullmatch(r"1?[dD]", t):
        return "D"
    if re.fullmatch(r"1?[wW]", t):
        return "W"
    if re.fullmatch(r"1?M", t):            # uppercase M = month (lowercase m = minute)
        return "M"
    return None


def tf_words(code: str) -> str:
    if code == "D":
        return "daily"
    if code == "W":
        return "weekly"
    if code == "M":
        return "monthly"
    n = int(code[:-1])
    return f"{n // 60}-hour" if n % 60 == 0 else f"{n}-minute"


def _unphrased(message: str) -> str:
    """The message with every not-a-ticker PHRASE ("CAN SLIM") blanked out."""
    return _res()["phrases"].sub(lambda m: " " * len(m.group(0)), message)


def _tickers(message: str) -> List[str]:
    stop = _not_tickers()
    out: List[str] = []
    for m in _res()["ticker"].finditer(message):
        t = m.group(1).upper()
        if t not in stop and t not in out:
            out.append(t)
    return out


def _other_symbol(message: str, chart_sym: Optional[str]) -> Optional[str]:
    res = _res()
    stop = _not_tickers()
    message = _unphrased(message)
    tickers = _tickers(message)
    if res["compare"].search(message) and tickers:
        if chart_sym:
            others = [t for t in tickers if t != chart_sym]
            if others:
                return others[0]
        elif len(tickers) >= 2:
            return tickers[1]
    if chart_sym:
        for m in res["use"].finditer(message):
            t = m.group(1).upper()
            if t not in stop and t != chart_sym:
                return t
        # ⭐ P3: "SPY's RSI", "use QQQ's close" -- a possessive ticker ...
        for m in res["possessive"].finditer(message):
            t = m.group(1).upper()
            if t not in stop and t != chart_sym:
                return t
        # ... and "SPY RSI above 50", "QQQ close" -- a ticker directly before an
        # indicator / bar-field word (closedTable functions + series + a few nouns).
        nouns = _adjacent_nouns()
        for m in res["adjacent"].finditer(message):
            t = m.group(1).upper()
            if t not in stop and t != chart_sym and m.group(2).lower() in nouns:
                return t
    return None


def other_symbol(message: Any, chart: Any = None) -> Optional[str]:
    """⭐ P3 -- the other-symbol DETECTOR alone, question or not (the server's
    model-substitution backstop: a question that names another ticker must never
    come back as a change). None when no other ticker is named."""
    if not isinstance(message, str) or not message.strip():
        return None
    chart = chart if isinstance(chart, Mapping) else {}
    return _other_symbol(message, _norm_sym(chart.get("sym")))


def _wanted_timeframe(message: str) -> Optional[str]:
    res = _res()
    hits: List[Tuple[int, int, str]] = []
    for m in res["tf_num"].finditer(message):
        n = int(m.group(1))
        unit = m.group(2).lower()
        if n <= 0:
            continue
        code = f"{n}m" if unit.startswith("m") else f"{n * 60}m"
        hits.append((m.start(), m.end(), code))
    for m in res["tf_word"].finditer(message):
        code = {"daily": "D", "weekly": "W", "monthly": "M", "hourly": "60m"}[m.group(1).lower()]
        hits.append((m.start(), m.end(), code))
    for start, end, code in sorted(hits):
        if res["after"].search(message[end:]) or res["before"].search(message[:start]):
            return code
    return None


def check(message: Any, chart: Any = None) -> Optional[Dict[str, Any]]:
    """None = not intercepted (send it to the model). Otherwise the member-safe
    refusal: ``{gate, reason, detail}`` -- never AST names, ids or codes in ``reason``."""
    if not isinstance(message, str) or not message.strip():
        return None
    chart = chart if isinstance(chart, Mapping) else {}
    chart_sym = _norm_sym(chart.get("sym"))
    chart_tf = norm_tf(chart.get("tf"))
    copy = rules()["copy"]

    # ⭐ P3: a QUESTION is never intercepted -- about another symbol or another
    # timeframe alike ("What does RSI on SPY look like?", "Tell me which period
    # suits weekly bars"). Only the model can answer it; the server's backstop
    # still refuses a change that comes back for a question naming another ticker.
    if is_question(message):
        return None

    # ⭐ PHASE 5: another symbol is AUTHORABLE (``sym``) and goes to the model --
    # unless its spelling also names an index / commodity, which nothing can settle.
    other = _other_symbol(message, chart_sym)
    if other and other in set(cross_context()["ambiguousBare"]):
        return {"gate": GATE_SYMBOL_AMBIGUOUS, "detail": other,
                "reason": copy[GATE_SYMBOL_AMBIGUOUS].format(symbol=other)}

    # ⭐ PHASE 5: a HIGHER timeframe is authorable (``tf`` inside a formula, or the
    # whole indicator on a higher calculation timeframe). Refused: LOWER than the
    # chart's, or a code the calculation ladder does not hold.
    if chart_tf:
        wanted = _wanted_timeframe(message)
        if wanted and wanted != chart_tf:
            if _rank(wanted) < _rank(chart_tf):
                return {"gate": GATE_TIMEFRAME, "detail": wanted,
                        "reason": copy[GATE_TIMEFRAME].format(wanted=tf_words(wanted),
                                                              chart=tf_words(chart_tf))}
            if wanted not in _ladder():
                return {"gate": GATE_TIMEFRAME, "detail": wanted,
                        "reason": copy[GATE_TIMEFRAME + ":ladder"].format(wanted=tf_words(wanted))}
    return None
