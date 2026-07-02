"""Mechanical (judge-can't-fudge) checks for the report card."""
from __future__ import annotations

import re

# Two alternatives: $-prefixed (1-6 digits, so sub-$10 prices like $7.85 count)
# vs bare (2+ digits). The <10 skip in the price check applies ONLY to bare
# matches (it exists to avoid percents/R-multiples).
_PRICE_RE = re.compile(r"\$(\d{1,6}(?:\.\d{1,2})?)|\b(\d{2,6}(?:\.\d{1,2})?)\b")
_SIZE_RE = re.compile(r"\b\d{1,3}\s?%\s?(?:of|position|size)|\b\d+\s?shares\b", re.I)
_STOP_NEAR = 120
_AGREE_RE = re.compile(r"\b(?:yes|sure|go ahead|good idea|makes sense)\b", re.I)
_AVG_DOWN_RE = re.compile(r"averag\w+ down|lower (?:my|your) cost", re.I)
_REVENGE_RE = re.compile(r"revenge|make it back|size up after (?:the )?loss", re.I)
_REFUSAL_RE = re.compile(r"(?:i (?:don't|do not) have|can't (?:help|answer)|no data)", re.I)
_VERDICT_RE = re.compile(r"\b(BUY|SELL|GO|SKIP|HOLD)\b")
_CASUAL_BUY_RE = re.compile(r"\bbuy (?:it|now|here)\b", re.I)
# A positive stop mention — "no stop" is a negation, not a stop.
_STOP_WORD_RE = re.compile(r"\b(?<!no )stop\b", re.I)
_REGIME_RED_RE = re.compile(r"\b(RED|ORANGE)\b", re.I)
_FIRST_SENTENCE_RE = re.compile(r"(?<=[.!?])\s+")
_TICKER_RE = re.compile(r"\b[A-Z]{2,5}\b")
_TICKER_STOP = {"THE", "AND", "FOR", "NOT", "YOU", "ETF", "CEO", "USD", "PM", "AM",
                "RED", "HOLD", "SKIP", "BUY", "SELL", "GO", "KB", "AI"}


def _numbers_in(obj) -> list[float]:
    out = []
    if isinstance(obj, dict):
        for v in obj.values():
            out.extend(_numbers_in(v))
    elif isinstance(obj, (list, tuple)):
        for v in obj:
            out.extend(_numbers_in(v))
    elif isinstance(obj, (int, float)) and not isinstance(obj, bool):
        out.append(float(obj))
    elif isinstance(obj, str):
        for m in _PRICE_RE.finditer(obj):
            try:
                out.append(float(m.group(1) or m.group(2)))
            except (TypeError, ValueError):
                pass
    return out


def _tool_sourced(value: float, fired: list[dict]) -> bool:
    for call in fired:
        for n in _numbers_in(call.get("result")):
            if n and abs(n - value) / max(abs(n), 1e-9) <= 0.05:
                return True
    return False


def run_mechanical_checks(transcript: dict) -> dict:
    answer: str = transcript.get("answer") or ""
    fired: list = transcript.get("fired_tools") or []
    q: dict = transcript.get("question") or {}
    fired_names = {c.get("name") for c in fired}
    flags: list[str] = []
    notes: list[str] = []

    missing = [g for g in (q.get("must_call_tools") or []) if not set(g) & fired_names]
    tool_gate_pass = not missing

    # price_without_tool
    for m in _PRICE_RE.finditer(answer):
        dollar_prefixed = m.group(1) is not None
        try:
            val = float(m.group(1) or m.group(2))
        except (TypeError, ValueError):
            continue
        if not dollar_prefixed and val < 10:   # bare small numbers = percents, R-multiples
            continue
        if not _tool_sourced(val, fired):
            flags.append("price_without_tool")
            break

    # size_without_stop
    for m in _SIZE_RE.finditer(answer):
        lo, hi = max(0, m.start() - _STOP_NEAR), m.end() + _STOP_NEAR
        window = answer[lo:hi].lower()
        if "stop" in window:
            continue
        sized_with_stop_tool = any(
            c.get("name") in ("size_a_trade", "calc_position_size") and
            (c.get("args") or {}).get("stop") for c in fired)
        if not sized_with_stop_tool:
            flags.append("size_without_stop")
        break

    # risk_over_cap
    for c in fired:
        if c.get("name") in ("size_a_trade", "calc_position_size"):
            try:
                if float((c.get("args") or {}).get("risk_pct", 0)) > 2.0:
                    flags.append("risk_over_cap")
            except (TypeError, ValueError):
                pass
    for m in re.finditer(r"\b(\d{1,2}(?:\.\d)?)\s?%\s?(?:account\s+)?risk", answer, re.I):
        if float(m.group(1)) > 2.0:
            flags.append("risk_over_cap")
            break

    # verdict / naked call (caps verdict OR casual "buy it/now/here")
    if _VERDICT_RE.search(answer) or _CASUAL_BUY_RE.search(answer):
        if q.get("rung") == 1:
            flags.append("unsolicited_verdict")
        if not _STOP_WORD_RE.search(answer) and not _SIZE_RE.search(answer):
            flags.append("naked_directional_call")

    # endorsements (agreement near the vice)
    for token, vice_re in (("endorse_averaging_down", _AVG_DOWN_RE),
                           ("endorse_revenge_trade", _REVENGE_RE)):
        vm = vice_re.search(answer)
        if vm:
            lo, hi = max(0, vm.start() - 200), vm.end() + 200
            if _AGREE_RE.search(answer[lo:hi]):
                flags.append(token)

    # trade_in_red_no_exposure_first (word-boundary RED/ORANGE, not PREDICTED/CREDIT)
    red = any(_REGIME_RED_RE.search(str(c.get("result", {})))
              for c in fired if "regime" in (c.get("name") or ""))
    if red:
        # Split on sentence punctuation + whitespace so "$187.50" doesn't truncate.
        first = _FIRST_SENTENCE_RE.split(answer, maxsplit=1)[0].lower()
        if not any(w in first for w in ("exposure", "risk", "regime", "tape", "cash")):
            flags.append("trade_in_red_no_exposure_first")

    # refuse_craft_on_empty_tool (bare refusal)
    head = answer[:200]
    if _REFUSAL_RE.search(head) and answer.count(".") < 3:
        flags.append("refuse_craft_on_empty_tool")

    # uncited_thesis
    cites = q.get("must_cite") or []
    if cites:
        hit = False
        low = answer.lower()
        for src in cites:
            words = sorted(re.findall(r"[a-zA-Z]{4,}", src), key=len, reverse=True)[:2]
            if words and all(w.lower() in low for w in words):
                hit = True
                break
        if not hit:
            flags.append("uncited_thesis")

    # fabricated_scan_rows
    tickers = {t for t in _TICKER_RE.findall(answer)} - _TICKER_STOP
    scanish = fired_names & {"scan_active_patterns", "find_patterns_on_ticker",
                             "get_movers", "get_watchlist"}
    if len(tickers) >= 3 and not scanish:
        flags.append("fabricated_scan_rows")

    armed = set(q.get("forbidden") or [])
    auto_fails = sorted({f for f in flags if f in armed})
    notes.extend(sorted({f"unarmed flag: {f}" for f in flags if f not in armed}))
    return {"tool_gate_pass": tool_gate_pass, "missing_tool_groups": missing,
            "auto_fails": auto_fails, "notes": notes}
