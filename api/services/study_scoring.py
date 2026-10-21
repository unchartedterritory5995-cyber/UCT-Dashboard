"""Deterministic, server-side scoring for Study drill items (spec §7.1
"Scoring", §13.3 C14/C17, §4.11). PURE FUNCTIONS: no database, no clock, no
model. Each takes the member's answer and the item's `answer_json` key (plus
whatever facts the key carries) and returns a `Verdict`.

Why pure: the ticker and the key never leave the server (§8.4), so scoring
must happen here; and the honesty rules (§8.1) say no model writes a market
fact, so the key is data and the scorer is arithmetic. A test can call every
function with literals.

The dispatcher `score(item_type, answer, key)` picks the rule by item type:

  recall · match · regime · family · call_scan · call_archive · grade ·
  spot · listen · scenario · autopsy  → exact / rubric-row match
  size                                 → within 1 share / $1 after rounding
  levels                               → each level within max(0.75×ATR14, 1%)
  next                                 → direction vs the recorded outcome
  tap                                  → the tap lands in the hit region
  plan                                 → rule checks (regime first, stop before
                                          size, risk ≤ 2%, R:R ≥ 2)
  walkthrough                          → UNSCORED: ok, score None (§13.9 #1)
"""
from __future__ import annotations

import math
from typing import Any, NamedTuple, Optional

RISK_CEILING_PCT = 2.0        # §4.11: 2% of the account is the hard ceiling
RR_FLOOR = 2.0                # plan rule: reward-to-risk at least 2
LEVEL_PCT_FLOOR = 0.01        # 1% of the key level
LEVEL_ATR_MULT = 0.75         # 0.75 × ATR14
SIZE_SHARE_TOL = 1.0
SIZE_DOLLAR_TOL = 1.0


class Verdict(NamedTuple):
    correct: bool
    score: Optional[float]   # 0..1; None when `unscored`
    detail: dict             # per-part results the reveal can show
    unscored: bool = False   # a walk-through: seen, never graded (§13.9 #1)


def score_walkthrough(answer: Any, key: Any) -> Verdict:
    """walkthrough (§13.9 #1, VOICE.md §4 "A walk-through"): 2-4 sentences the
    member taps through; there is nothing to grade. Always ok, score None,
    `unscored=True`. The detail records how many steps the member saw so the
    attempt row is a record of reading, not a mark."""
    a = answer if isinstance(answer, dict) else {}
    seen = a.get("seen")
    try:
        seen_i: Optional[int] = int(seen) if seen is not None else None
    except (TypeError, ValueError):
        seen_i = None
    return Verdict(True, None, {"seen": seen_i, "unscored": True}, True)


def _norm(v: Any) -> str:
    """Case- and whitespace-insensitive string form of a choice."""
    if v is None:
        return ""
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        # 42 and 42.0 are one value (a key stored as 42.0 vs a typed 42)
        if isinstance(v, float) and math.isfinite(v) and v.is_integer():
            return str(int(v))
        return repr(float(v)) if isinstance(v, float) else str(v)
    return " ".join(str(v).strip().casefold().split())


def _num(v: Any) -> Optional[float]:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


def _as_key(key: Any) -> dict:
    """A key may be a bare value ("YELLOW") or a dict ({"answer": "YELLOW"})."""
    if isinstance(key, dict):
        return key
    return {"answer": key}


#: The one-field answer shapes that carry a single chosen value. The member
#: drills post `{choice: <value>}` (app/src/pages/study/drills/types.js
#: `choiceAnswer`); older callers and the tests post `{answer: <value>}`.
#: ⚰️ Only `answer` was unwrapped until 2026-10-21, so EVERY multiple-choice
#: answer from the live app compared a dict's repr against the key and scored
#: wrong (seen live: "Matching Low" chosen, "Not quite. The answer: Matching Low").
_SINGLE_VALUE_KEYS = ("answer", "choice")


def _as_answer_value(answer: Any) -> Any:
    if isinstance(answer, dict) and len(answer) == 1:
        for k in _SINGLE_VALUE_KEYS:
            if k in answer:
                return answer[k]
    return answer


# ── Exact-match family ────────────────────────────────────────────────────────

def score_exact(answer: Any, key: Any) -> Verdict:
    """recall / regime / family / call / grade / spot / listen / scenario:
    the choice equals the key, compared case- and whitespace-insensitively.
    A key may list `accept` (aliases) — any of them is correct. A `call_*`
    key with a "watch" neutral band lists watch in `accept` when the fair-
    scoring rule (C17) says neither trigger nor stop printed."""
    k = _as_key(key)
    a = _as_answer_value(answer)
    accepted = [k.get("answer")] + list(k.get("accept") or [])
    got = _norm(a)
    ok = got != "" and any(got == _norm(x) for x in accepted if x is not None)
    return Verdict(ok, 1.0 if ok else 0.0, {"expected": k.get("answer"), "got": a})


def score_match(answer: Any, key: Any) -> Verdict:
    """match (vocabulary): five terms to five definitions. The answer is
    {term: definition_id}; the key is {"pairs": {term: definition_id}}. Score
    is the fraction of pairs right; correct only when all are right."""
    k = _as_key(key)
    pairs = k.get("pairs") or k.get("answer") or {}
    if not isinstance(pairs, dict) or not pairs:
        return Verdict(False, 0.0, {"error": "key has no pairs"})
    got = answer if isinstance(answer, dict) else {}
    hits = {t: _norm(got.get(t)) == _norm(d) for t, d in pairs.items()}
    n_ok = sum(1 for v in hits.values() if v)
    frac = n_ok / len(pairs)
    return Verdict(n_ok == len(pairs), round(frac, 4), {"pairs": hits})


def score_rubric(answer: Any, key: Any) -> Verdict:
    """autopsy / grade-with-rows: the member ticks rubric rows; the key lists
    the rows that apply (`rows`). Score = (hits − false ticks) / |rows|,
    floored at 0; correct when the sets are equal. Used when the item's key
    carries `rows`; otherwise `score_exact`."""
    k = _as_key(key)
    want = {_norm(r) for r in (k.get("rows") or [])}
    if not want:
        return score_exact(answer, key)
    got_list = answer.get("rows") if isinstance(answer, dict) else answer
    got = {_norm(r) for r in (got_list or [])} if isinstance(got_list, (list, tuple, set)) else set()
    hits = len(want & got)
    wrong = len(got - want)
    frac = max(0.0, (hits - wrong) / len(want))
    return Verdict(got == want, round(frac, 4), {"hits": hits, "missed": len(want - got), "extra": wrong})


# ── size ──────────────────────────────────────────────────────────────────────

def size_from_stop(account: float, risk_pct: float, entry: float, stop: float) -> dict:
    """§4.11 house formula. risk $ = account × risk% ; shares = floor(risk $ /
    (entry − stop)); position $ = shares × entry. Returns {"skip": True} when
    the honest stop does not fit the budget (shares < 1) — never tighten the
    stop. Raises ValueError on a stop at or above entry or risk over 2%."""
    if entry <= 0 or stop <= 0 or stop >= entry:
        raise ValueError("stop must be below entry")
    if risk_pct <= 0 or risk_pct > RISK_CEILING_PCT:
        raise ValueError(f"risk% must be in (0, {RISK_CEILING_PCT}]")
    risk_dollars = account * risk_pct / 100.0
    per_share = entry - stop
    shares = math.floor(risk_dollars / per_share)
    if shares < 1:
        return {"skip": True, "shares": 0, "dollars": 0.0, "risk_dollars": round(risk_dollars, 2)}
    return {"skip": False, "shares": shares, "dollars": round(shares * entry, 2),
            "risk_dollars": round(risk_dollars, 2)}


def score_size(answer: Any, key: Any) -> Verdict:
    """size: the answer carries `shares` and/or `dollars` (or `skip: true`).
    Each numeric part is right when |answer − key| ≤ 1 share / $1 AFTER
    rounding both to whole shares / whole dollars. Correct when every part the
    key carries is right. A key with `skip: true` is right only for a skip."""
    k = _as_key(key)
    a = answer if isinstance(answer, dict) else {}
    if k.get("skip"):
        ok = bool(a.get("skip"))
        return Verdict(ok, 1.0 if ok else 0.0, {"expected": "skip", "got": a})
    if a.get("skip"):
        return Verdict(False, 0.0, {"expected": {"shares": k.get("shares"), "dollars": k.get("dollars")},
                                    "got": "skip"})
    parts: dict = {}
    for name, tol in (("shares", SIZE_SHARE_TOL), ("dollars", SIZE_DOLLAR_TOL)):
        want = _num(k.get(name))
        if want is None:
            continue
        got = _num(a.get(name))
        parts[name] = got is not None and abs(round(got) - round(want)) <= tol
    if not parts:
        return Verdict(False, 0.0, {"error": "key has neither shares nor dollars"})
    n_ok = sum(1 for v in parts.values() if v)
    return Verdict(n_ok == len(parts), round(n_ok / len(parts), 4), {"parts": parts})


# ── levels ────────────────────────────────────────────────────────────────────

def level_tolerance(key_level: float, atr14: Optional[float]) -> float:
    """max(0.75 × ATR14, 1% of the key level). With no ATR, the 1% floor."""
    pct = abs(key_level) * LEVEL_PCT_FLOOR
    atr = _num(atr14)
    return max(LEVEL_ATR_MULT * atr, pct) if atr and atr > 0 else pct


def score_levels(answer: Any, key: Any) -> Verdict:
    """levels: entry / stop / target placed on the chart. The key carries the
    three prices and `atr14`. Each level is right when within
    `level_tolerance`; score = fraction right; correct when all are. The
    answer may be {entry, stop, target} or {points: [{price, role}]}."""
    k = _as_key(key)
    atr = k.get("atr14")
    a = answer if isinstance(answer, dict) else {}
    if "points" in a and isinstance(a["points"], list):
        a = {p.get("role"): p.get("price") for p in a["points"] if isinstance(p, dict)}
    parts: dict = {}
    for role in ("entry", "stop", "target"):
        want = _num(k.get(role))
        if want is None:
            continue
        got = _num(a.get(role))
        tol = level_tolerance(want, atr)
        parts[role] = {"ok": got is not None and abs(got - want) <= tol, "tolerance": round(tol, 4)}
    if not parts:
        return Verdict(False, 0.0, {"error": "key has no levels"})
    n_ok = sum(1 for v in parts.values() if v["ok"])
    return Verdict(n_ok == len(parts), round(n_ok / len(parts), 4), {"levels": parts})


# ── next ──────────────────────────────────────────────────────────────────────

_DIRECTIONS = {"up": "up", "higher": "up", "down": "down", "lower": "down",
               "flat": "flat", "sideways": "flat", "chop": "flat", "undecided": "flat"}


def score_next(answer: Any, key: Any) -> Verdict:
    """next: up / down / flat over ONE stated window (C14: 20 sessions). The
    key's `outcome` is the recorded direction; `expired` resolves to
    "undecided", which the member answers as flat. Exact, with synonyms."""
    k = _as_key(key)
    want = _DIRECTIONS.get(_norm(k.get("outcome") or k.get("answer")))
    got = _DIRECTIONS.get(_norm(_as_answer_value(answer)))
    ok = want is not None and got == want
    return Verdict(ok, 1.0 if ok else 0.0, {"expected": want, "got": got})


# ── tap ───────────────────────────────────────────────────────────────────────

def score_tap(answer: Any, key: Any) -> Verdict:
    """tap: the member taps one bar/price. The key is a hit region, either a
    box {bar_from, bar_to, price_lo, price_hi} or a point with tolerances
    {bar_index, bar_tol, price, price_tol_pct}. Price is optional on the key
    (a "tap the pivot bar" item needs only the bar). Binary."""
    k = _as_key(key)
    a = answer if isinstance(answer, dict) else {}
    bar = _num(a.get("bar_index"))
    price = _num(a.get("price"))
    if bar is None:
        return Verdict(False, 0.0, {"error": "no bar_index in answer"})
    if "bar_from" in k or "bar_to" in k:
        lo, hi = _num(k.get("bar_from")), _num(k.get("bar_to"))
        bar_ok = (lo is None or bar >= lo) and (hi is None or bar <= hi)
        plo, phi = _num(k.get("price_lo")), _num(k.get("price_hi"))
        if plo is None and phi is None:
            price_ok = True
        else:
            price_ok = price is not None and (plo is None or price >= plo) and (phi is None or price <= phi)
    else:
        centre = _num(k.get("bar_index"))
        tol = _num(k.get("bar_tol")) or 0.0
        bar_ok = centre is not None and abs(bar - centre) <= tol
        kp = _num(k.get("price"))
        if kp is None:
            price_ok = True
        else:
            ptol = kp * ((_num(k.get("price_tol_pct")) or 1.0) / 100.0)
            price_ok = price is not None and abs(price - kp) <= ptol
    ok = bool(bar_ok and price_ok)
    return Verdict(ok, 1.0 if ok else 0.0, {"bar_ok": bool(bar_ok), "price_ok": bool(price_ok)})


# ── plan ──────────────────────────────────────────────────────────────────────

PLAN_RULES = ("regime_first", "stop_before_size", "risk_within_ceiling", "rr_at_least_floor")


def score_plan(answer: Any, key: Any) -> Verdict:
    """plan: the member writes a trade plan as ordered `steps` plus numbers.
    Four rule checks, each worth a quarter; correct when all four pass:
      regime_first        — steps[0] is "regime"
      stop_before_size    — "stop" appears before "size" in steps
      risk_within_ceiling — account risk ≤ 2% (from shares×(entry−stop)/account,
                            or the answer's `risk_pct`)
      rr_at_least_floor   — (target−entry)/(entry−stop) ≥ 2
    The key may carry `account`, `entry`, `stop`, `target` to fix the numbers;
    the answer's own values are used where the key is silent."""
    k = _as_key(key)
    a = answer if isinstance(answer, dict) else {}
    steps = [_norm(s) for s in (a.get("steps") or [])]
    checks: dict = {}
    checks["regime_first"] = bool(steps) and steps[0] == "regime"
    checks["stop_before_size"] = ("stop" in steps and "size" in steps
                                  and steps.index("stop") < steps.index("size"))
    account = _num(k.get("account", a.get("account")))
    entry = _num(k.get("entry", a.get("entry")))
    stop = _num(k.get("stop", a.get("stop")))
    target = _num(k.get("target", a.get("target")))
    shares = _num(a.get("shares"))
    risk_pct = _num(a.get("risk_pct"))
    if risk_pct is None and None not in (account, entry, stop, shares) and account > 0:
        risk_pct = shares * (entry - stop) / account * 100.0
    checks["risk_within_ceiling"] = risk_pct is not None and 0 < risk_pct <= RISK_CEILING_PCT
    if None not in (entry, stop, target) and entry > stop:
        rr = (target - entry) / (entry - stop)
    else:
        rr = _num(a.get("rr"))
    checks["rr_at_least_floor"] = rr is not None and rr >= RR_FLOOR
    n_ok = sum(1 for v in checks.values() if v)
    return Verdict(n_ok == len(PLAN_RULES), round(n_ok / len(PLAN_RULES), 4),
                   {"checks": checks, "risk_pct": None if risk_pct is None else round(risk_pct, 3),
                    "rr": None if rr is None else round(rr, 3)})


# ── dispatcher ────────────────────────────────────────────────────────────────

_EXACT_TYPES = {"recall", "regime", "family", "call_scan", "call_archive", "grade",
                "spot", "listen", "scenario"}


def score(item_type: str, answer: Any, key: Any) -> Verdict:
    """Route by item type. Unknown types fall back to exact match so a new
    type never scores everything wrong silently — but tests pin the roster."""
    t = (item_type or "").strip().lower()
    if t == "walkthrough":
        return score_walkthrough(answer, key)
    if t == "match":
        return score_match(answer, key)
    if t == "size":
        return score_size(answer, key)
    if t == "levels":
        return score_levels(answer, key)
    if t == "next":
        return score_next(answer, key)
    if t == "tap":
        return score_tap(answer, key)
    if t == "plan":
        return score_plan(answer, key)
    if t == "autopsy":
        return score_rubric(answer, key)
    if t in _EXACT_TYPES and isinstance(key, dict) and key.get("rows"):
        return score_rubric(answer, key)
    return score_exact(answer, key)
