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
        "question": re.compile(r["questionLead"], re.I),
    }


def _norm_sym(sym: Any) -> Optional[str]:
    if not isinstance(sym, str) or not sym.strip():
        return None
    return sym.strip().lstrip("$").upper()


def norm_tf(tf: Any) -> Optional[str]:
    """A chart timeframe code -> 'D' | 'W' | 'M' | '<minutes>m'. None when unknown."""
    if not isinstance(tf, str):
        return None
    t = tf.strip()
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
    return None


def _wanted_timeframe(message: str) -> Optional[str]:
    res = _res()
    if res["question"].search(message):
        return None
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

    other = _other_symbol(message, chart_sym)
    if other:
        return {"gate": GATE_SYMBOL, "detail": other,
                "reason": copy[GATE_SYMBOL].format(symbol=other)}

    if chart_tf:
        wanted = _wanted_timeframe(message)
        if wanted and wanted != chart_tf:
            return {"gate": GATE_TIMEFRAME, "detail": wanted,
                    "reason": copy[GATE_TIMEFRAME].format(wanted=tf_words(wanted),
                                                          chart=tf_words(chart_tf))}
    return None
