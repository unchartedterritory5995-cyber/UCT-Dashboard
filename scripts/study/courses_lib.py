"""Study courses: load, validate and build the unit files under docs/study/courses/<track>/<unit>.json.

The contract is docs/study/courses/README.md (owner rulings 2026-11-08: every course, every fact verified against
reliable sources). This module enforces the MECHANICAL half of it:

  * the file's shape, the formats the app plays, the rung spread, the format mix;
  * the support rule: a key needs one Tier 1 fact, or two Tier 2 facts from two different publishers;
  * quotes 40 words at most, every source with an https URL and an access date;
  * every computed answer recomputed from its `calc` (CALCS below), never trusted as typed;
  * the importer's own voice + number-grounding checks (api/services/study_import.check_item) on the built item,
    plus the contract's extra voice rules (choice length, no untaught house words, no "the loop");
  * the checker's verdict: only `verify.<key>.status == "pass"` questions are built into the bank.

The JUDGMENT half (is the fact true, is the key right, would a good trader say it) is the cold checker's and then the
owner's. Nothing here can make a wrong fact right; it can only refuse a malformed one.
"""
from __future__ import annotations

import hashlib
import json
import math
import pathlib
import random
import re
from typing import Any, Callable, Iterable, Optional

from scripts.study._common import REPO, dedash, item_id
from scripts.study.calc_visuals import visual_for as calc_visual_for
from api.services import study_import

COURSES_DIR = REPO / "docs" / "study" / "courses"
FORMATS = ("mcq", "tf", "fill", "numeric", "scenario")
TRACK_SLUGS = {"F1": "basics", "F5": "fund", "F6": "options", "F7": "history", "F8": "psych", "F9": "risk",
               "F10": "orders", "F10b": "short", "F11": "styles", "F12": "process", "V": "vocab",
               # the UCT Method's Setup track (docs/study/UNITS-method.md), one unit per criteria card; pilot SET.07
               "SET": "setup"}
MAX_QUOTE_WORDS = 40
MAX_Q_CHARS = 140
MAX_CHOICE_CHARS = 40
MAX_LESSON_LINE_WORDS = 22
#: The firm's shorthand, never in a Foundations question (README §5). "the loop" is a model's invention (2026-10-17).
HOUSE_WORDS = re.compile(r"\b(the dial|the band|heat|the tape|the loop|regime)\b", re.I)
BANNED_CHOICES = re.compile(r"\b(all of the above|none of the above|both a and b)\b", re.I)
#: OWNER_PRINCIPLES rule 11: "quit calling us THE FIRM". Checked in every member-facing field of every track.
OUR_NAME = re.compile(r"\bthe firm('s)?\b", re.I)
#: phrases the owner has banned from member text (2026-11-14: "don't use the word stock talk, that's the name of a
#: dude that I hate on Twitter").
BANNED_PHRASES = re.compile(r"\bstock ?talk\b", re.I)
VERIFY_STATUSES = ("pass", "fix", "cut")
#: D-021 (the owner, 2026-11-12): one pair everywhere, the 9 and 20 EMA with the 50 and 200 SMA, and the Study charts
#: draw exactly those lines, so our own trail or EMA named as the 10-day / 21-day sends a member looking for a line that
#: is not on the chart. Allowed: an originator's own method named in the sentence or the question (Kell's 10/20), a
#: measured research value ("as measured"), and the rulebook's stretch line C29 (10% over the 10-day average), which
#: is not a trail and waits on D-017.
OUR_OLD_LINES = re.compile(r"\btrail\w*\b[^.]{0,60}\b(?:10|21)[- ]day\b|\b(?:10|21)[- ]day\b[^.]{0,40}\b(?:trail\w*|fast movers?|steadier)\b"
                           r"|\b(?:10|21)[- ]?(?:day )?EMAs?\b|\b10- and 21-day\b", re.I)
ORIGINATOR = re.compile(r"Kell|Qullamaggie|Kullam[aä]gi|Minervini|O'Neil|IBD|Weinstein|Zanger|Raschke|TraderLion|Bonde|"
                        r"Duncan|Haber|Elder|MarketSmith|StockCharts|Investopedia|Schwab|Fidelity|scanners?\b|Bracco|"
                        r"\btheir\b|his own|measured", re.I)
MEASURED = re.compile(r"\b\d+\.\d+\b|\b\d{4}-\d{2}-\d{2}\b")


def old_lines_problems(texts, context: str = "") -> list[str]:
    """D-021: sentences in member text naming our own trail / EMA as the 10-day or 21-day (see OUR_OLD_LINES)."""
    if ORIGINATOR.search(context or ""):
        return []
    out = []
    for t in texts:
        for s in re.split(r"(?<=[.!?])\s+", str(t or "")):
            # a measured research value (a price, a date) names the line it was measured on
            if MEASURED.search(s):
                continue
            if OUR_OLD_LINES.search(s) and not ORIGINATOR.search(s):
                out.append(f"names our line as the 10-day / 21-day (we use the 9 and 20 EMA, D-021): {s[:80]!r}")
    return out

# ── the overbuild fields (docs/study/OVERBUILD_PLAN.md): all optional, all additive ──────────────────────────────
#: A question that carries `simple` is an UPGRADED question: a mcq / scenario then has exactly four choices.
SIMPLE_MAX_WORDS = 25
SIMPLE_MIN_WORDS = 4
SIMPLE_MAX_SENTENCES = 2
SIMPLE_MAX_AVG_WORD = 5.3       # letters per word; plain trading prose sits near 4.3, jargon-heavy near 6
SIMPLE_MAX_WORD = 13            # no single word longer than this (a defined term can be asked as a vocabulary question)
TIERS = ("core", "extended", "expert")
DECISION_ID = re.compile(r"^D-\d{3}$")
DEEPER_KEYS = ("example", "counter", "trap")
DEEPER_MAX_CHARS = 600
_NUMBER_TOKEN = re.compile(r"\d[\d,]*(?:\.\d+)?")


# ── the order a member sees the choices in ────────────────────────────────────────────────────────────────────────
#: Writers put the right answer first (the README's example does), so the bank must not keep that order: on 2026-11-10
#: 87% to 100% of the course questions had it in slot A. Each choice question is shuffled at build time with a seed
#: from its own unit and key, so the order is the same on every rebuild and never moves when a question is added.
#: A question whose choices have a meaningful order opts out with `"order": "fixed"`; choices that are all numbers
#: always read lowest to highest.
_NUMBER = re.compile(r"^\s*[-+−]?\$?\s*\d[\d,]*(\.\d+)?\s*(%|r|x|R|X|shares?|days?|bars?|cents?)?\s*$")


def _as_number(text: str) -> Optional[float]:
    t = str(text).replace("−", "-").replace(",", "").replace("$", "").strip()
    m = re.match(r"^[-+]?\d+(\.\d+)?", t)
    return float(m.group(0)) if m and _NUMBER.match(str(text)) else None


def _seed(*parts: object) -> int:
    return int(hashlib.sha1("#".join(str(x) for x in parts).encode("utf-8")).hexdigest()[:12], 16)


def _numeric_run(choices: list[str]) -> bool:
    """True when every choice is one kind of number (so it reads best lowest to highest)."""
    marks = {re.sub(r"[-+\d.,\s−]", "", c).lower() for c in choices}
    return all(_as_number(c) is not None for c in choices) and len(marks) == 1


def choice_orders(doc: dict) -> dict[str, list[str]]:
    """The choices of every choice question in a unit, in the order a member sees them (keyed by question key).

    * `"order": "fixed"` on a question keeps it as written; choices that are all one kind of number read lowest to highest.
    * Every other question gets its right answer dealt to a slot: the questions with the same number of choices
      take the slots 0..k-1 in shuffled blocks, in file order, so a unit's right answers sit evenly in A, B, C and D
      and a streak is never longer than a block. The file order counts questions the checker cut too, so cutting
      one never moves another. The wrong choices fall in a shuffle seeded by the question.
    """
    unit = doc.get("unit")
    dealt: dict[int, int] = {}
    out: dict[str, list[str]] = {}
    for q in doc.get("questions") or []:
        if q.get("format") not in ("mcq", "scenario"):
            continue
        key, choices, answer = str(q.get("key")), [str(c) for c in q.get("choices") or []], q.get("answer")
        if len(choices) < 2:
            out[key] = choices
        elif q.get("order") == "fixed":
            out[key] = choices
        elif _numeric_run(choices):
            out[key] = [c for _, c in sorted(((_as_number(c), c) for c in choices), key=lambda t: t[0])]
        elif answer not in choices:
            rest = list(choices)
            random.Random(_seed(unit, key)).shuffle(rest)
            out[key] = rest
        else:
            k = len(choices)
            n = dealt.get(k, 0)
            dealt[k] = n + 1
            block = list(range(k))
            random.Random(_seed(unit, "slots", k, n // k)).shuffle(block)
            slot = block[n % k]
            rest = [c for c in choices if c != answer]
            random.Random(_seed(unit, key)).shuffle(rest)
            rest.insert(slot, answer)
            out[key] = rest
    return out


# ── computed answers ──────────────────────────────────────────────────────────────────────────────────────────────
# Each calc takes keyword args and returns ONE number. A numeric key is compared to the calc at the precision the
# question states (`calc.round`, default 2 decimals). Add a calc with a test in tests/test_study_courses.py.

def _spread(bid: float, ask: float) -> float:
    return ask - bid


def _spread_pct(bid: float, ask: float) -> float:
    """The spread as a percent of the midpoint (the usual convention)."""
    return (ask - bid) / ((ask + bid) / 2) * 100


def _pct_change(start: float, end: float) -> float:
    return (end - start) / start * 100


def _gain_to_recover(loss_pct: float) -> float:
    """The percent gain needed to get back to even after a `loss_pct` percent loss."""
    return (1 / (1 - loss_pct / 100) - 1) * 100


def _shares_from_risk(account: float, risk_pct: float, entry: float, stop: float) -> float:
    """Whole shares so that (entry - stop) x shares <= account x risk_pct%. Rounded DOWN."""
    per_share = abs(entry - stop)
    return math.floor(account * risk_pct / 100 / per_share)


def _risk_dollars(shares: float, entry: float, stop: float) -> float:
    return shares * abs(entry - stop)


def _risk_pct_of_account(shares: float, entry: float, stop: float, account: float) -> float:
    return shares * abs(entry - stop) / account * 100


def _position_pct(shares: float, price: float, account: float) -> float:
    return shares * price / account * 100


def _r_multiple(entry: float, stop: float, exit: float, side: str = "long") -> float:
    risk = abs(entry - stop)
    gain = (exit - entry) if side == "long" else (entry - exit)
    return gain / risk


def _expectancy_r(win_rate_pct: float, avg_win_r: float, avg_loss_r: float) -> float:
    """Average R per trade: p x win - (1 - p) x loss, with avg_loss_r given as a positive number."""
    p = win_rate_pct / 100
    return p * avg_win_r - (1 - p) * avg_loss_r


def _market_cap(price: float, shares_outstanding: float) -> float:
    return price * shares_outstanding


def _pe(price: float, eps: float) -> float:
    return price / eps


def _yoy_growth(prior: float, current: float) -> float:
    return (current - prior) / abs(prior) * 100


def _leveraged_path(daily_pcts: list, leverage: float = 1.0, start: float = 100.0) -> float:
    """Value after compounding each day's index move times `leverage` (ignores fees and financing)."""
    v = start
    for d in daily_pcts:
        v *= 1 + leverage * d / 100
    return v


def _option_payoff(kind: str, strike: float, premium: float, underlying: float, side: str = "long",
                   contracts: float = 1, multiplier: float = 100) -> float:
    """Profit or loss in dollars at expiry for a single-leg option."""
    intrinsic = max(0.0, underlying - strike) if kind == "call" else max(0.0, strike - underlying)
    per_share = intrinsic - premium if side == "long" else premium - intrinsic
    return per_share * contracts * multiplier


def _option_breakeven(kind: str, strike: float, premium: float) -> float:
    return strike + premium if kind == "call" else strike - premium


def _vertical_payoff(kind: str, long_strike: float, short_strike: float, net_debit: float, underlying: float,
                     contracts: float = 1, multiplier: float = 100) -> float:
    """Profit or loss at expiry of a vertical spread bought for `net_debit` (negative = a credit received)."""
    def intrinsic(k):
        return max(0.0, underlying - k) if kind == "call" else max(0.0, k - underlying)
    return (intrinsic(long_strike) - intrinsic(short_strike) - net_debit) * contracts * multiplier


def _intrinsic(kind: str, strike: float, underlying: float) -> float:
    return max(0.0, underlying - strike) if kind == "call" else max(0.0, strike - underlying)


def _extrinsic(kind: str, strike: float, underlying: float, premium: float) -> float:
    return premium - _intrinsic(kind, strike, underlying)


def _margin_equity_pct(market_value: float, loan: float) -> float:
    return (market_value - loan) / market_value * 100


def _drawdown_pct(peak: float, trough: float) -> float:
    return (peak - trough) / peak * 100


def _avg_price(fills: list) -> float:
    """Average fill price over [[shares, price], ...]."""
    sh = sum(f[0] for f in fills)
    return sum(f[0] * f[1] for f in fills) / sh


def _dollar_volume(shares: float, price: float) -> float:
    return shares * price


def _short_pnl(entry: float, exit: float, shares: float) -> float:
    return (entry - exit) * shares


def _arith(expr: str, **values: float) -> float:
    """A plain arithmetic expression over named values ("a * b / c"). Only + - * / ( ) and names; no calls."""
    if not re.fullmatch(r"[\sA-Za-z_0-9.+\-*/()]+", expr) or re.search(r"__|[A-Za-z_]\w*\s*\(", expr):
        raise ValueError(f"arith: expression not allowed: {expr!r}")
    return float(eval(expr, {"__builtins__": {}}, dict(values)))  # noqa: S307 (names + arithmetic only, checked)


CALCS: dict[str, Callable[..., float]] = {
    "spread": _spread, "spread_pct": _spread_pct, "pct_change": _pct_change, "gain_to_recover": _gain_to_recover,
    "shares_from_risk": _shares_from_risk, "risk_dollars": _risk_dollars, "risk_pct_of_account": _risk_pct_of_account,
    "position_pct": _position_pct, "r_multiple": _r_multiple, "expectancy_r": _expectancy_r,
    "market_cap": _market_cap, "pe": _pe, "yoy_growth": _yoy_growth, "leveraged_path": _leveraged_path,
    "option_payoff": _option_payoff, "option_breakeven": _option_breakeven, "vertical_payoff": _vertical_payoff,
    "intrinsic": _intrinsic, "extrinsic": _extrinsic, "margin_equity_pct": _margin_equity_pct,
    "drawdown_pct": _drawdown_pct, "avg_price": _avg_price, "dollar_volume": _dollar_volume,
    "short_pnl": _short_pnl, "arith": _arith,
}


def run_calc(calc: dict) -> float:
    fn = CALCS.get((calc or {}).get("fn") or "")
    if fn is None:
        raise ValueError(f"unknown calc {calc.get('fn')!r} (add it to CALCS with a test)")
    return float(fn(**(calc.get("args") or {})))


def calc_value(calc: dict) -> float:
    """The calc's result at the question's stated precision (`round`, default 2)."""
    return round(run_calc(calc), int(calc.get("round", 2)))


def calc_steps(calc: dict) -> dict:
    """The in-between numbers of a calc, so an explanation can show its work (his note: "show the steps", "explain how
    it is calculated"; REVIEW_LEARNINGS rules 3 and 29). They ride in reveal facts.calc.steps, which the grounding
    check reads, so "$500 at risk / 2.22 a share = 225.2, round down to 225" grounds. Before 2026-11-17 those numbers
    were rejected as ungrounded and the checkers had to describe the steps without them. Only plain arithmetic of the
    calc's own args, rounded to 2 decimals."""
    a = (calc or {}).get("args") or {}
    fn = (calc or {}).get("fn")
    r2 = lambda x: round(float(x), 2)  # noqa: E731
    try:
        if fn == "shares_from_risk":
            dollars = a["account"] * a["risk_pct"] / 100
            per = abs(a["entry"] - a["stop"])
            return {"risk_dollars": r2(dollars), "risk_per_share": r2(per), "raw_shares": r2(dollars / per),
                    "stop_pct": r2(per / a["entry"] * 100)}
        if fn in ("risk_dollars", "risk_pct_of_account"):
            per = abs(a["entry"] - a["stop"])
            out = {"risk_per_share": r2(per), "risk_dollars": r2(per * a["shares"])}
            return out
        if fn == "position_pct":
            return {"position_dollars": r2(a["shares"] * a["price"])}
        if fn == "r_multiple":
            per = abs(a["entry"] - a["stop"])
            gain = (a["exit"] - a["entry"]) if a.get("side", "long") == "long" else (a["entry"] - a["exit"])
            return {"risk_per_share": r2(per), "gain_per_share": r2(gain)}
        if fn == "pct_change":
            return {"change": r2(a["end"] - a["start"])}
        if fn == "spread_pct":
            return {"spread": r2(a["ask"] - a["bid"]), "midpoint": r2((a["ask"] + a["bid"]) / 2)}
        if fn == "dollar_volume":
            return {}
        # the options and account calcs (the F6 checker could not show "112.40 minus 105 is 7.40", 2026-11-17)
        if fn in ("intrinsic", "extrinsic", "option_payoff"):
            k, u = a["strike"], a["underlying"]
            intr = max(0.0, u - k) if a["kind"] == "call" else max(0.0, k - u)
            out = {"distance": r2(abs(u - k)), "intrinsic": r2(intr)}
            if fn == "option_payoff":
                per = intr - a["premium"] if a.get("side", "long") == "long" else a["premium"] - intr
                out["per_share"] = r2(per)
            return out
        if fn == "vertical_payoff":
            u = a["underlying"]
            iv = (lambda k: max(0.0, u - k) if a["kind"] == "call" else max(0.0, k - u))
            return {"long_leg": r2(iv(a["long_strike"])), "short_leg": r2(iv(a["short_strike"])),
                    "per_share": r2(iv(a["long_strike"]) - iv(a["short_strike"]) - a["net_debit"]),
                    "width": r2(abs(a["long_strike"] - a["short_strike"]))}
        if fn == "margin_equity_pct":
            return {"equity": r2(a["market_value"] - a["loan"])}
        if fn == "drawdown_pct":
            return {"drop": r2(a["peak"] - a["trough"])}
        if fn == "short_pnl":
            return {"per_share": r2(a["entry"] - a["exit"])}
        if fn == "avg_price":
            fills = a.get("fills") or []
            return {"shares": r2(sum(f[0] for f in fills)), "cost": r2(sum(f[0] * f[1] for f in fills))}
        if fn == "gain_to_recover":
            return {"left": r2(100 - a["loss_pct"])}
        if fn == "arith":
            # every part of the expression, worked out ("(25.10 - 24.71) * 3" gives 0.39 and 1.17), so a plain
            # arithmetic question can show its steps too (the SET.22 checker could not: "0.39 and 1.17" were rejected)
            import ast
            expr = str(a.get("expr") or "")
            values = {k: v for k, v in a.items() if k != "expr" and isinstance(v, (int, float))}
            tree = ast.parse(expr, mode="eval")
            out, n = {}, 0
            for node in ast.walk(tree):
                if isinstance(node, ast.BinOp):
                    n += 1
                    out[f"step{n}"] = r2(_arith(ast.unparse(node), **values))
            return out
    except (KeyError, TypeError, ZeroDivisionError):
        return {}
    return {}


def _num_text(x: float) -> str:
    return str(int(x)) if float(x).is_integer() else repr(float(x))


def numeric_accept(x: float) -> list[str]:
    """The typed forms of ONE value the scorer must accept: 12, 12.0, 12.00; 2.5, 2.50; 0.05 only as 0.05.
    A form is listed only when it is the SAME value (2026-11-09: rounding 0.05 to one decimal listed "0.1" and
    would have scored a wrong answer right). The scorer also compares typed numbers by value (study_scoring)."""
    out = {_num_text(x)}
    for d in (1, 2, 3):
        form = f"{x:.{d}f}"
        if abs(float(form) - float(x)) < 1e-12:
            out.add(form)
    if float(x).is_integer():
        out.add(str(int(x)))
    return sorted(out)


# ── loading ───────────────────────────────────────────────────────────────────────────────────────────────────────

def unit_files(root: pathlib.Path = COURSES_DIR) -> list[pathlib.Path]:
    return sorted(p for p in root.glob("*/*.json") if p.is_file())


def load_unit(path: pathlib.Path) -> dict:
    return json.loads(pathlib.Path(path).read_text(encoding="utf-8"))


def _words(text: str) -> int:
    return len(re.findall(r"\S+", text or ""))


def _sentences(text: str) -> list[str]:
    return [s for s in re.split(r"(?<=[.!?])\s+", (text or "").strip()) if s]


# ── validation ────────────────────────────────────────────────────────────────────────────────────────────────────

def support_problems(q: dict, facts: dict, sources: dict) -> list[str]:
    """The support rule (README §3): one Tier 1 fact, or two Tier 2 facts from two different publishers.
    A computed key also counts as supported when its inputs are stated in the question (the calc IS the support),
    but it still needs a fact that teaches the method."""
    cited = [facts[f] for f in q.get("facts") or [] if f in facts]
    if not cited:
        return ["cites no fact"]
    tiers = [(sources.get(f.get("source")) or {}).get("tier") for f in cited]
    if 1 in tiers:
        return []
    t2_publishers = {(sources.get(f.get("source")) or {}).get("publisher") for f in cited
                     if (sources.get(f.get("source")) or {}).get("tier") == 2}
    if len(t2_publishers) >= 2:
        return []
    if q.get("calc") and any(t in (1, 2) for t in tiers):
        return []
    if q.get("house") and 3 in tiers:
        return []
    return ["support rule: needs one Tier 1 fact or two Tier 2 facts from two different publishers"]


def _numbers_in(text: str) -> set[str]:
    return {m.rstrip(".").replace(",", "") for m in _NUMBER_TOKEN.findall(str(text or ""))}


def simple_problems(q: dict) -> list[str]:
    """The checks on the plain one-line answer (`simple`). None when the question has none. It must be short, plain,
    and must not state anything the rest of the question does not already say: its numbers come from the question, the
    choices, the explanation or the notes on the wrong answers, never from nowhere."""
    if "simple" not in q:
        return []
    s = q.get("simple")
    if not isinstance(s, str) or not s.strip():
        return ["simple is empty"]
    out: list[str] = []
    n = _words(s)
    if n > SIMPLE_MAX_WORDS:
        out.append(f"simple is {n} words (max {SIMPLE_MAX_WORDS})")
    if n < SIMPLE_MIN_WORDS:
        out.append(f"simple is {n} words (min {SIMPLE_MIN_WORDS})")
    if len(_sentences(s)) > SIMPLE_MAX_SENTENCES:
        out.append(f"simple is more than {SIMPLE_MAX_SENTENCES} sentences")
    words = re.findall(r"[A-Za-z']+", s)
    if words:
        avg = sum(len(w) for w in words) / len(words)
        if avg > SIMPLE_MAX_AVG_WORD:
            out.append(f"simple averages {avg:.1f} letters a word (max {SIMPLE_MAX_AVG_WORD}): use plainer words")
        long_words = [w for w in words if len(w) > SIMPLE_MAX_WORD]
        if long_words:
            out.append(f"simple has long words {long_words}: say it plainer")
    if re.search(r"[;()/]", s):
        out.append("simple has a semicolon, bracket or slash: one plain sentence, no asides")
    if s.strip().lower() == (q.get("why") or "").strip().lower():
        out.append("simple repeats why word for word")
    if OUR_NAME.search(s):
        out.append("simple: never 'the firm' (say UCT or we)")
    allowed = _numbers_in(" ".join([q.get("q") or "", q.get("story") or "", q.get("sentence") or "", q.get("why") or "",
                                    str(q.get("answer") or ""), " ".join(map(str, q.get("choices") or [])),
                                    " ".join(str(v) for v in (q.get("wrong") or {}).values())]))
    stray = sorted(_numbers_in(s) - allowed)
    if stray:
        out.append(f"simple states numbers that are nowhere else in the question: {stray}")
    return out


def depth_problems(q: dict, unit: dict) -> list[str]:
    """tier / batch / risk / depends_on / deeper: the owner-only and depth fields. Optional; checked when present."""
    out: list[str] = []
    if "tier" in q and q["tier"] not in TIERS:
        out.append(f"tier must be one of {TIERS}")
    if "batch" in q and not (isinstance(q["batch"], str) and q["batch"].strip()):
        out.append("batch must be a non-empty string")
    if "risk" in q:
        r = q["risk"]
        if not (isinstance(r, dict) and isinstance(r.get("score"), int) and 0 <= r["score"] <= 10
                and isinstance(r.get("reasons", []), list)):
            out.append("risk must be {score: 0-10, reasons: [..]}")
    if "depends_on" in q:
        d = q["depends_on"]
        if not (isinstance(d, list) and d and all(isinstance(x, str) and DECISION_ID.match(x) for x in d)):
            out.append("depends_on must be a non-empty list of decision ids like D-029")
    if "deeper" in q:
        dp = q["deeper"]
        if not isinstance(dp, dict) or not dp or set(dp) - set(DEEPER_KEYS):
            out.append(f"deeper must be an object with keys from {DEEPER_KEYS}")
        else:
            for k, v in dp.items():
                if not (isinstance(v, str) and v.strip()) or len(v) > DEEPER_MAX_CHARS:
                    out.append(f"deeper.{k} must be text of at most {DEEPER_MAX_CHARS} characters")
                elif OUR_NAME.search(v):
                    out.append(f"deeper.{k}: never 'the firm' (say UCT or we)")
    if "simple" in q and q.get("format") in ("mcq", "scenario") and len(q.get("choices") or []) != 4:
        out.append("an upgraded mcq / scenario (one with `simple`) needs exactly 4 choices")
    return out


def question_problems(q: dict, *, unit: dict, facts: dict, sources: dict, skills: set) -> list[str]:
    out: list[str] = []
    fmt = q.get("format")
    if fmt not in FORMATS:
        return [f"format must be one of {FORMATS}"]
    if q.get("skill") not in skills:
        out.append(f"skill {q.get('skill')!r} is not one of the unit's skills")
    rung = q.get("rung")
    if not isinstance(rung, int) or not 1 <= rung <= 9:
        out.append("rung must be an integer 1-9")
    text = q.get("q") or ""
    if not text:
        out.append("no question text")
    if len(text) > MAX_Q_CHARS:
        out.append(f"question is {len(text)} characters (max {MAX_Q_CHARS})")
    if unit.get("track") != "V" and not unit.get("allow_house_words"):
        for field in ("q", "story", "why", "lesson_line", "simple"):
            m = HOUSE_WORDS.search(q.get(field) or "")
            if m:
                out.append(f"{field}: untaught house word {m.group(0)!r}")
        for c in q.get("choices") or []:
            m = HOUSE_WORDS.search(str(c))
            if m:
                out.append(f"choice {c!r}: untaught house word {m.group(0)!r}")
    for field in ("q", "story", "why", "lesson_line", "sentence"):
        if OUR_NAME.search(q.get(field) or ""):
            out.append(f"{field}: never 'the firm' (say UCT or we)")
    for c in list(q.get("choices") or []) + list((q.get("wrong") or {}).values()):
        if OUR_NAME.search(str(c)):
            out.append(f"{str(c)[:30]!r}: never 'the firm' (say UCT or we)")
    texts = [q.get(f) for f in ("q", "story", "why", "lesson_line", "sentence", "simple")] + list(q.get("choices") or []) \
        + list((q.get("wrong") or {}).values()) + list((q.get("deeper") or {}).values())
    for t in texts:
        m = BANNED_PHRASES.search(str(t or ""))
        if m:
            out.append(f"banned phrase {m.group(0)!r} (owner, 2026-11-14)")
    ans = q.get("answer")
    # build_items puts the story on the screen only for a scenario; on any other format a member never sees it
    # (2026-11-14: two live questions asked about a bar their hidden story described)
    story = (q.get("story") or "").strip()
    if fmt != "scenario" and story:
        out.append("a story only reaches the member on a scenario (make it a scenario, or fold it into the question)")
    # a number split across the story and the question (2026-11-14: "bought at 73." then "16 with the stop at 72.24"):
    # the story ends on a whole number and a full stop, and the question opens on digits
    if re.search(r"(?<![\d.,])\d+\.$", story) and re.match(r"\d+[ ,%]", (q.get("q") or "").strip()):
        out.append("a number is cut between the story and the question (keep the whole number in one place)")
    if fmt in ("mcq", "scenario"):
        ch = q.get("choices") or []
        if not 3 <= len(ch) <= 4:
            out.append("mcq / scenario needs 3 or 4 choices")
        if len(set(map(str, ch))) != len(ch):
            out.append("duplicate choices")
        if ans not in ch:
            out.append("answer is not one of the choices")
        for c in ch:
            if len(str(c)) > MAX_CHOICE_CHARS:
                out.append(f"choice {c!r} is {len(str(c))} characters (max {MAX_CHOICE_CHARS})")
            if BANNED_CHOICES.search(str(c)):
                out.append(f"choice {c!r}: no 'all/none of the above'")
        missing = [c for c in ch if c != ans and not (q.get("wrong") or {}).get(c)]
        if missing:
            out.append(f"`wrong` must explain every wrong choice (missing {missing})")
        if fmt == "scenario" and not story:
            out.append("scenario needs a story")
    elif fmt == "tf":
        if ans not in ("True", "False"):
            out.append('tf answer must be "True" or "False"')
    elif fmt == "fill":
        sent, bank = q.get("sentence") or "", q.get("bank") or []
        if sent.count("___") != 1:
            out.append("fill sentence needs exactly one ___")
        if not 4 <= len(bank) <= 6:
            out.append("fill bank needs 4 to 6 words")
        if ans not in bank:
            out.append("fill answer is not in the bank")
    elif fmt == "numeric":
        calc = q.get("calc")
        if not calc:
            out.append("numeric needs a calc")
    if q.get("calc"):
        try:
            want = calc_value(q["calc"])
            got = float(ans) if fmt == "numeric" else None
            if fmt == "numeric" and (got is None or abs(got - want) > 1e-9):
                out.append(f"answer {ans!r} != calc {want!r}")
            elif fmt != "numeric":
                # a choice question keyed on arithmetic: the key must contain the calc's number
                if _num_text(want) not in str(ans).replace(",", "") and f"{want:.2f}" not in str(ans).replace(",", ""):
                    out.append(f"answer {ans!r} does not show the calc's result {want!r}")
        except Exception as e:  # noqa: BLE001
            out.append(f"calc failed: {e}")
    chart = q.get("chart")
    if chart is not None:
        if not re.fullmatch(r"[A-Z][A-Z0-9.^-]{0,9}", str(chart.get("sym") or "")):
            out.append("chart.sym must be an upper-case ticker")
        tf = str(chart.get("tf") or "D")
        if tf == "D":
            if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(chart.get("asof") or "")):
                out.append("chart.asof must be YYYY-MM-DD (the last visible day)")
        elif tf in INTRADAY_TFS:
            # an intraday chart's asof is the START of its last visible bar, New York time, on the regular session's grid
            p = intraday_asof_problem(str(chart.get("asof") or ""), tf)
            if p:
                out.append(p)
        else:
            out.append(f"chart.tf must be D or one of {', '.join(INTRADAY_TFS)} (minutes)")
        if str(chart.get("sym") or "").upper() in INDEX_SERIES and tf != "D":
            out.append("an index chart is daily (chart.tf D)")
        if not 20 <= int(chart.get("window", 120)) <= 400 or not 0 <= int(chart.get("forward", 20)) <= 250:
            out.append("chart.window must be 20-400 bars and chart.forward 0-250")
        sym = str(chart.get("sym") or "")
        before = " ".join([str(q.get("q") or ""), str(q.get("story") or "")] + [str(c) for c in q.get("choices") or []])
        if sym.upper() in (q.get("q") or "").upper().split() or (sym and re.search(rf"(?<![A-Za-z]){re.escape(sym)}(?![A-Za-z])", before)):
            out.append("the question names the chart's ticker (a member must not see it before answering)")
        # the trade drawn after the answer (entry, stop, 3R, 5R, the marks as the replay lands): from the research, on a
        # chart whose last visible day is the buy day, and the same two numbers the question's own words give
        tr = chart.get("trade")
        if tr is not None:
            try:
                e, s = float(tr["entry"]), float(tr["stop"])
            except (KeyError, TypeError, ValueError):
                out.append("chart.trade needs a numeric entry and stop")
            else:
                short = tr.get("direction") == "bearish"
                if (s <= e) if short else (s >= e):
                    out.append("chart.trade: the stop must sit below the entry (above it for a short)")
                said = " ".join(str(q.get(f) or "") for f in ("story", "q", "why")).replace(",", "")
                for v in (e, s):
                    if f"{v:.2f}" not in said and _num_text(v) not in said:
                        out.append(f"chart.trade {v} is not in the question's words (the drawn trade must match them)")
    if not (q.get("why") or "").strip():
        out.append("no why")
    ll = q.get("lesson_line") or ""
    if not ll.strip():
        out.append("no lesson_line")
    elif _words(ll) > MAX_LESSON_LINE_WORDS:
        out.append(f"lesson_line is {_words(ll)} words (max {MAX_LESSON_LINE_WORDS})")
    for f in q.get("facts") or []:
        if f not in facts:
            out.append(f"cites unknown fact {f!r}")
    out.extend(simple_problems(q))
    out.extend(depth_problems(q, unit))
    out.extend(support_problems(q, facts, sources))
    return out


#: history loaded ahead of a course chart's visible window, so the 50 and 200-day averages are drawn from its first
#: visible candle (the drill opens on `visible_bars`; 2026-11-14)
WARMUP_BARS = 200

# ── intraday course charts (2026-11-15: the opening-range, 30-minute pivot, Go Signal, red-to-green and opening-drive
# lessons). A chart may name `tf` 5 / 15 / 30 / 60 (minutes) with `asof` "YYYY-MM-DD HH:MM", the START of its last
# visible bar in New York time on the regular session's grid (09:30 + a whole number of bars). The bank passes the
# server that bar's exact unix time (`asof_key`) and an end for the replay (`forward_to_key`), so the import resolves it
# from the pod's own bars when they are there; scripts/study/fill_course_charts.py fetches the rest from the provider
# ON THE POD, checks each chart (check_course_charts.check_bars) and stores only the ones that pass. Regular hours only.
INTRADAY_TFS = ("5", "15", "30", "60")
#: hidden bars ahead of an intraday window, as WARMUP_BARS for a daily one: the member's own averages (the 9 and 21 EMA,
#: the 50 and the 200) are formed from the first candle. It was 60 until 2026-11-16: the screen check found the 200's
#: legend with no value on every intraday chart, because 60 bars cannot form a 200-bar average.
INTRADAY_WARMUP = 200
_NY = None

# ── index history charts (2026-11-16, the owner's "Visual for all lessons really"): a history question that quotes an
# index level ("the S&P 500 fell from 1,565 to 677") is drawn on that INDEX, not on a fund whose prices would not match
# the words. The symbol is the chart's own name for the series; the value is Yahoo's, the source the app's index charts
# already use (api/index_bars.py). The import never reads bars.db for these (`source: "index"`: an "SPX" row there, if
# any, is not this series); scripts/study/fill_course_charts.py fetches each on the pod, runs check_course_charts and
# stores only the charts that pass. Daily only. IXIC, not COMP, for the Nasdaq Composite: COMP is a listed stock.
INDEX_SERIES = {"SPX": "^GSPC", "IXIC": "^IXIC", "NDX": "^NDX", "DJI": "^DJI", "RUT": "^RUT"}
#: the indexes whose volume in that history is their own. Yahoo's Russell 2000 volume is the S&P 500's on 92.5% of days
#: and its Nasdaq 100 volume the Composite's on 80% (measured 2026-11-16), so those two charts carry no volume at all
#: rather than another index's.
INDEX_OWN_VOLUME = frozenset({"SPX", "IXIC", "DJI"})
#: the item's adjustment_basis for an index chart: index levels, never split-adjusted prices. The server's forward
#: top-up and the replay's intraday fill read it and leave these charts to their stored bars.
INDEX_BASIS = "index level"


def _ny():
    global _NY
    if _NY is None:
        from zoneinfo import ZoneInfo
        _NY = ZoneInfo("America/New_York")
    return _NY


def intraday_asof_problem(asof: str, tf: str) -> Optional[str]:
    m = re.fullmatch(r"(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})", asof)
    if not m:
        return "an intraday chart.asof must be 'YYYY-MM-DD HH:MM' (New York time, the start of the last visible bar)"
    hh, mm = int(m[4]), int(m[5])
    since_open = (hh * 60 + mm) - (9 * 60 + 30)
    if not 0 <= since_open < 390:
        return "an intraday chart.asof must fall in the regular session (09:30 to 15:59 New York)"
    if since_open % int(tf):
        return f"an intraday chart.asof must start a {tf}-minute bar (09:30 plus whole bars)"
    return None


def intraday_key(asof: str) -> int:
    """'YYYY-MM-DD HH:MM' New York time -> the bar's unix time (the bars store each bar's start, in seconds)."""
    import datetime as _dt
    d = _dt.datetime.strptime(asof, "%Y-%m-%d %H:%M").replace(tzinfo=_ny())
    return int(d.timestamp())


def unit_problems(doc: dict, *, path: Optional[pathlib.Path] = None) -> list[str]:
    """Every mechanical problem in one unit file (empty = clean). Built items are checked too (voice + grounding)."""
    out: list[str] = []
    for k in ("unit", "track", "title", "teaches", "skills", "sources", "facts", "questions", "as_of"):
        if not doc.get(k):
            out.append(f"missing {k}")
    if out:
        return out
    if path is not None:
        if path.parent.name != doc["track"] or path.stem != doc["unit"]:
            out.append(f"file must live at {doc['track']}/{doc['unit']}.json")
    slug = TRACK_SLUGS.get(doc["track"])
    skills = set()
    for s in doc["skills"]:
        sid = s.get("id") or ""
        skills.add(sid)
        if slug and not (sid.startswith(slug + ".") and re.fullmatch(r"[a-z0-9_.]+", sid)):
            out.append(f"skill id {sid!r} must start with {slug}. and be lower case")
    sources = {}
    for s in doc["sources"]:
        sid = s.get("id")
        if sid in sources:
            out.append(f"duplicate source id {sid}")
        sources[sid] = s
        if s.get("tier") not in (1, 2, 3):
            out.append(f"source {sid}: tier must be 1, 2 or 3")
        if not str(s.get("url") or "").startswith("https://") and s.get("tier") != 3:
            out.append(f"source {sid}: url must be https")
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(s.get("accessed") or "")):
            out.append(f"source {sid}: accessed must be YYYY-MM-DD")
        for k in ("publisher", "title"):
            if not s.get(k):
                out.append(f"source {sid}: missing {k}")
    facts = {}
    for f in doc["facts"]:
        fid = f.get("id")
        if fid in facts:
            out.append(f"duplicate fact id {fid}")
        facts[fid] = f
        if f.get("source") not in sources:
            out.append(f"fact {fid}: unknown source {f.get('source')!r}")
        if not (f.get("quote") or "").strip() or not (f.get("claim") or "").strip():
            out.append(f"fact {fid}: needs a quote and a claim")
        if _words(f.get("quote") or "") > MAX_QUOTE_WORDS:
            out.append(f"fact {fid}: quote is {_words(f['quote'])} words (max {MAX_QUOTE_WORDS})")
    keys = set()
    fmts: dict[str, int] = {}
    levels = {1: 0, 2: 0, 3: 0}
    for q in doc["questions"]:
        key = q.get("key")
        if not key or key in keys:
            out.append(f"question key {key!r} missing or duplicate")
        keys.add(key)
        for p in question_problems(q, unit=doc, facts=facts, sources=sources, skills=skills):
            out.append(f"{key}: {p}")
        # a hand-written picture card is held to the built card's contract (calc_visuals.written_problems)
        from scripts.study.calc_visuals import written_problems
        for p in written_problems(q):
            out.append(f"{key}: {p}")
        if ((doc.get("verify") or {}).get(key) or {}).get("status") == "pass":   # what reaches a member
            said = [q.get(f) for f in ("q", "story", "why", "lesson_line", "sentence", "simple")] + list(q.get("choices") or []) \
                + list((q.get("wrong") or {}).values()) + list((q.get("deeper") or {}).values())
            for p in old_lines_problems(said, " ".join(str(q.get(f) or "") for f in ("q", "story"))):
                out.append(f"{key}: {p}")
        fmts[q.get("format")] = fmts.get(q.get("format"), 0) + 1
        r = q.get("rung") if isinstance(q.get("rung"), int) else 0
        if 1 <= r <= 9:
            levels[(r - 1) // 3 + 1] += 1
    n = len(doc["questions"])
    if n >= 8:
        if fmts.get("scenario", 0) < math.ceil(0.2 * n):
            out.append(f"mix: {fmts.get('scenario', 0)} scenario questions, need at least {math.ceil(0.2 * n)}")
        if fmts.get("tf", 0) < math.ceil(0.15 * n):
            out.append(f"mix: {fmts.get('tf', 0)} true/false questions, need at least {math.ceil(0.15 * n)}")
        for lv, c in levels.items():
            if c < max(1, n // 5):
                out.append(f"rungs: only {c} questions at level {lv} (Learn/Practise/Prove need about a third each)")
    for w in doc.get("walkthroughs") or []:
        steps = w.get("steps") or []
        if not 2 <= len(steps) <= 4:
            out.append(f"walkthrough {w.get('key')}: needs 2 to 4 steps")
        for f in w.get("facts") or []:
            if f not in facts:
                out.append(f"walkthrough {w.get('key')}: unknown fact {f!r}")
        out.extend(f"walkthrough {w.get('key')}: {p}" for p in old_lines_problems(steps, str(w.get("title") or "")))
    verify = doc.get("verify") or {}
    for key, v in verify.items():
        if key not in keys and not str(key).startswith("w"):
            out.append(f"verify: unknown question {key!r}")
        if (v or {}).get("status") not in VERIFY_STATUSES:
            out.append(f"verify.{key}: status must be one of {VERIFY_STATUSES}")
    # the built items must pass the importer's own checks (voice + number grounding)
    for it in build_items(doc, only_passed=False):
        chk = study_import.check_item(it)
        for flag in chk["flags"]:
            if flag.startswith("near-duplicate"):
                continue
            out.append(f"{it['_key']}: importer: {flag}")
        out.extend(f"{it['_key']}: {p}" for p in strict_grounding(it))
    return out


def given_text(q: dict) -> str:
    """The text the question itself states (question, story, choices, fill sentence): its numbers are givens."""
    parts = [q.get("q") or "", q.get("story") or "", q.get("sentence") or ""]
    parts += [str(c) for c in q.get("choices") or []]
    return " ".join(p for p in parts if p).strip()


def strict_grounding(it: dict) -> list[str]:
    """The importer grounds prose against the whole reveal, which here also holds the `wrong` explanations. This
    stricter pass grounds why / lesson_line / every `wrong` note against the cited quotes, the calc and the givens
    ONLY, so a number can never ground itself from another prose field."""
    r = it.get("reveal_json") or {}
    corpus = {"answer": it.get("answer_json"), "facts": r.get("facts"),
              "quotes": [c.get("quote") for c in (r.get("depth") or {}).get("sources") or []]}
    allowed = study_import.allowed_numbers(corpus)
    out = []
    texts = [("why", r.get("why") or ""), ("lesson_line", r.get("lesson_line") or ""), ("simple", r.get("simple") or "")]
    texts += [(f"deeper.{k}", v) for k, v in (r.get("deeper") or {}).items()]
    texts += [(f"wrong[{k}]", v) for k, v in (r.get("wrong") or {}).items()]
    if it.get("type") == "walkthrough":
        texts += [(f"step{i + 1}", s) for i, s in enumerate((it.get("prompt_json") or {}).get("steps") or [])]
    for field, text in texts:
        for tok in study_import.ungrounded_numbers(text, allowed):
            out.append(f"{field}: number {tok} is not in a cited quote, the calc or the question")
    return out


# ── building ──────────────────────────────────────────────────────────────────────────────────────────────────────

_OWNER_ASIDE = re.compile(r"\s*\([^()]*(?:owner|docs/|\.json|\.md)[^()]*\)", re.I)


def member_source_name(src: dict) -> str:
    """The name a member reads under "Sources" on a reveal. Our own working files (the setup criteria cards, the
    research dossiers, the rulebook, the verdict log) are cited by what they ARE to a member, never by a repo path or
    "criteria card" (REVIEW_LEARNINGS rule 27: no working words in member text; the 2026-11-17 localhost review showed
    "UCT setup criteria card: ... (docs/study/setups/criteria/01-flat-base.json ...)" as a dead link, three times)."""
    url, pub, title = str(src.get("url") or ""), str(src.get("publisher") or ""), str(src.get("title") or "")
    if url.startswith("repo:"):
        path = url[5:].split("#")[0]
        if path.endswith("sizing_rule.md") or "owner_verdicts" in path or "RULINGS" in path or "DECISIONS" in path:
            return "Our trading rules"
        if "/setups/criteria/" in path:
            setup = re.split(r"\s+criteria card", title, flags=re.I)[0].strip() or "setup"
            return f"Our {setup} playbook"
        if "/setups/research/" in path:
            setup = re.split(r"\s+dossier", title, flags=re.I)[0].strip() or "setup"
            return f"Our {setup} research, on real charts"
        if "GLOSSARY" in path:
            return "Our setup glossary"
        if path.startswith("app/"):
            return _OWNER_ASIDE.sub("", title).split(":")[0].strip() or "The UCT app"
        if "TRADE_PLANS" in path:
            return "Our trade plans"
        return "Our trading rules"          # the house rule files (OWNER_PRINCIPLES, REVIEW_LEARNINGS, the skill map)
    pub = _OWNER_ASIDE.sub("", pub).strip()
    # a title's trailing note about the owner ("...: the post the owner named for B26") is ours, not the source's
    title = ":".join(p for i, p in enumerate(title.split(":")) if i == 0 or "owner" not in p.lower())
    title = _OWNER_ASIDE.sub("", title).strip()
    if "substack" in (pub + url).lower():   # on our Substack he writes as TSDR
        title = re.sub(r"\bthe owner's\b", "TSDR's", title, flags=re.I)
        title = re.sub(r"\bthe owner\b", "TSDR", title, flags=re.I)
    return f"{pub}: {title}" if pub and title else (pub or title)


def _source_cite(src: dict, fact: dict) -> dict:
    url = src.get("url")
    return {"name": member_source_name(src), "url": None if str(url or "").startswith("repo:") else url,
            "quote": fact.get("quote"), "accessed": src.get("accessed"), "tier": src.get("tier")}


def _merge_cites(cites: list[dict]) -> list[dict]:
    """One line per source on the reveal: facts cited from the same source merge, their quotes kept together (the
    grounding check reads every quote, so none is dropped)."""
    out: list[dict] = []
    seen: dict[tuple, dict] = {}
    for c in cites:
        key = (c.get("name"), c.get("url"))
        if key in seen:
            prev = seen[key]
            if c.get("quote") and c.get("quote") not in str(prev.get("quote") or ""):
                prev["quote"] = f"{prev['quote']} … {c['quote']}" if prev.get("quote") else c["quote"]
            continue
        seen[key] = dict(c)
        out.append(seen[key])
    return out


def _difficulty(rung: int) -> int:
    return 1 if rung <= 3 else 2 if rung <= 6 else 3


def build_items(doc: dict, *, only_passed: bool = True) -> list[dict]:
    """Bank items for one unit. `only_passed`: only questions the checker passed (the bank); False builds every
    question (so validation can run the importer's checks before the checker has looked)."""
    unit, track = doc["unit"], doc["track"]
    facts = {f["id"]: f for f in doc.get("facts") or []}
    sources = {s["id"]: s for s in doc.get("sources") or []}
    verify = doc.get("verify") or {}
    ref_base = f"docs/study/courses/{track}/{unit}.json"
    items: list[dict] = []
    first_skill = (doc.get("skills") or [{}])[0].get("id")
    orders = choice_orders(doc)
    for n, w in enumerate(doc.get("walkthroughs") or [], start=1):
        if only_passed and (verify.get(w.get("key")) or {}).get("status") != "pass":
            continue
        cites = _merge_cites([_source_cite(sources.get(facts[f]["source"], {}), facts[f]) for f in w.get("facts") or [] if f in facts])
        steps = [dedash(s) for s in w.get("steps") or []]
        it = {
            "id": item_id(ref_base, f"walk:{w.get('key')}"), "version": 1, "type": "walkthrough",
            "skill_id": first_skill, "module": track, "difficulty": 1,
            "prompt_json": {"q": dedash(w.get("title") or doc["title"]), "steps": steps, "order": n,
                            "part": n, "parts": len(doc.get("walkthroughs") or []), "subject": f"{unit}#{w.get('key')}"},
            "answer_json": {"unscored": True},
            "reveal_json": {"unit": unit, "depth": {"sources": cites}},
            "source_kind": "course", "source_ref": f"{ref_base}#{w.get('key')}",
            "lesson_text": steps[-1] if steps else None, "lesson_origin": "session", "review_status": "draft",
            "_key": w.get("key"),
        }
        items.append(it)
    for q in doc.get("questions") or []:
        key = q.get("key")
        if only_passed and (verify.get(key) or {}).get("status") != "pass":
            continue
        fmt = q.get("format")
        # a vocabulary question names its word in `term`: it becomes the prompt's subject (stripped from what a member
        # receives) so Word Match can pair the word with its meaning (study_store.game_pool); the id never depends on it
        prompt: dict[str, Any] = {"q": dedash(q.get("q")), "subject": dedash(q["term"]) if q.get("term") else f"{unit}#{key}"}
        answer: Any = q.get("answer")
        if fmt in ("mcq", "scenario"):
            prompt["kind"] = "mcq"
            prompt["choices"] = [dedash(str(c)) for c in orders.get(str(key)) or q.get("choices") or []]
            if fmt == "scenario":
                prompt["story"] = dedash(q.get("story"))
        elif fmt == "tf":
            prompt["kind"] = "tf"
            prompt["choices"] = ["True", "False"]
        elif fmt == "fill":
            prompt["kind"] = "fill"
            prompt["sentence"] = dedash(q.get("sentence"))
            prompt["bank"] = [dedash(str(b)) for b in q.get("bank") or []]
        elif fmt == "numeric":
            prompt["kind"] = "fill_numeric"
            for k in ("prefix", "suffix", "label"):
                if q.get(k):
                    prompt[k] = q[k]
        # a computed question's picture card (a price ladder, a move, the size chain...): its inputs only, each one stated
        # in the question's own words; the answer fills in after scoring from the reveal's facts.calc (calc_visuals.py)
        visual = calc_visual_for(q)
        if visual:
            prompt["visual"] = visual
        answer_json: dict[str, Any] = {"answer": dedash(answer) if isinstance(answer, str) else answer}
        reveal_facts: dict[str, Any] = {}
        given = given_text(q)
        if given:
            # the numbers the question itself states (a story's prices, a quote card): the reveal may restate them
            reveal_facts["given"] = given
        if q.get("calc"):
            val = calc_value(q["calc"])
            reveal_facts["calc"] = {"fn": q["calc"]["fn"], "args": q["calc"].get("args") or {}, "result": val}
            steps = calc_steps(q["calc"])
            if steps:
                reveal_facts["calc"]["steps"] = steps      # the in-between numbers an explanation may show (calc_steps)
            if fmt == "numeric":
                answer_json = {"answer": val, "accept": numeric_accept(val)}
        cited = [f for f in q.get("facts") or [] if f in facts]
        cites = _merge_cites([_source_cite(sources.get(facts[f]["source"], {}), facts[f]) for f in cited])
        why, line = dedash(q.get("why") or ""), dedash(q.get("lesson_line") or "")
        reveal = {
            "unit": unit, "why": why, "lesson_line": line, "facts": reveal_facts,
            "depth": {"summary": " ".join(dedash(facts[f]["claim"]) for f in cited), "sources": cites},
        }
        if q.get("wrong"):
            reveal["wrong"] = {dedash(k): dedash(v) for k, v in q["wrong"].items()}
        if q.get("simple"):
            reveal["simple"] = dedash(q["simple"])            # the one plain line the reveal leads with
        if q.get("deeper"):
            reveal["deeper"] = {k: dedash(v) for k, v in q["deeper"].items()}
        if q.get("tier"):
            reveal["tier"] = q["tier"]                         # core | extended | expert (owner-only fields stay out)
        chart = q.get("chart") or None
        if chart:
            # a real chart under the question (History Detective, a dated example): the importer resolves the bars from
            # bars.db by this spec (get_bars_before, split-adjusted); the ticker never reaches a member before scoring
            # forward_bars: how many days the replay after the answer plays (the reveal carries the first 20; the drill
            # fetches the rest, up to what the server holds): a count, nothing about the answer
            # WARMUP_BARS of history ride ahead of the window, hidden: the 50 and 200-day averages the words name are
            # drawn from the first visible candle (2026-11-14 screen check: a 120-bar chart drew no 200-day at all, and the
            # 50-day only from bar 50). visible_bars is what the drill opens on; the extra bars are only the averages' history.
            win = int(chart.get("window", 120))
            ctf = str(chart.get("tf") or "D")
            warm = WARMUP_BARS if ctf == "D" else INTRADAY_WARMUP
            # hide_ticker: a course chart is a real dated example, so its ticker (NVDA 2023, AMD 2018) would give the
            # outcome away before the answer; the server leaves it out of the set and the reveal names it (2026-11-14)
            prompt["chart"] = {"window_bars": win + warm, "visible_bars": win, "tf": ctf, "forward_bars": int(chart.get("forward", 20)),
                               "hide_ticker": True}
            tr = chart.get("trade")
            if tr:
                # after the answer only (the reveal): the drill player draws it as Hard mode does (entry, stop, 3R and 5R
                # as marks on the ruler, BOUGHT / 3R / 5R / STOPPED as the replay lands); bought during the buy day
                e, s = float(tr["entry"]), float(tr["stop"])
                sign = -1.0 if tr.get("direction") == "bearish" else 1.0
                risk = abs(e - s)
                # the notes the answer card prints under the entry and the stop (2026-11-14: it printed "undefined"); both
                # are what check_course_charts verifies for every drawn trade (the entry traded that day, the stop sits
                # beyond the day's extreme). `source` lets the card name this example, not a setup's detector rules.
                # an intraday chart's fill may come at its bar's close, after that bar's high, so its review counts from
                # the next bar on (enters_intraday False) and names bars, not sessions (`unit`; the 2026-11-15 screen
                # check: "ADVANCE ... on the buy day" quoted the fill bar's own earlier high, "hit after 1 session")
                reveal["trade"] = {"entry": e, "stop": s, "t1": round(e + sign * 3 * risk, 2), "t2": round(e + sign * 5 * risk, 2),
                                   "direction": "bearish" if sign < 0 else "bullish", "enters_intraday": ctf == "D", "trim_r": [3, 5],
                                   "source": "course", **({} if ctf == "D" else {"unit": "bar"}),
                                   "entry_note": "the fill on the chart's last day" if ctf == "D" else "the fill on the chart's last bar",
                                   "stop_note": (("over that day's high" if sign < 0 else "under that day's low") if ctf == "D"
                                                 else ("over that bar's high" if sign < 0 else "under that bar's low"))}
        it = {
            "id": item_id(ref_base, f"q:{key}"), "version": 1, "type": "scenario" if fmt == "scenario" else "recall",
            "skill_id": q.get("skill"), "module": track, "difficulty": _difficulty(int(q.get("rung") or 1)),
            "prompt_json": prompt, "answer_json": answer_json, "reveal_json": reveal,
            "source_kind": "course", "source_ref": f"{ref_base}#{key}",
            "lesson_text": (why + " " + line).strip(), "lesson_origin": "session", "review_status": "draft",
            "_key": key,
        }
        if chart and str(chart.get("tf") or "D") != "D":
            # an intraday chart: the server resolves it by exact unix times (the bar's start; the replay's end a week on,
            # of which it keeps the first `forward` regular-session bars); fill_course_charts.py fetches what the pod
            # does not hold. The item's asof is the day.
            ctf, key0 = str(chart["tf"]), intraday_key(chart["asof"])
            it.update(sym=str(chart["sym"]).upper(), asof=chart["asof"][:10], adjustment_basis="split-adjusted",
                      bars={"sym": str(chart["sym"]).upper(), "tf": ctf, "asof": chart["asof"][:10], "asof_key": key0,
                            "forward_to_key": key0 + 7 * 86400, "rth": True,
                            "window": int(chart.get("window", 120)) + INTRADAY_WARMUP, "forward": int(chart.get("forward", 20))})
        elif chart:
            csym = str(chart["sym"]).upper()
            index = csym in INDEX_SERIES
            it.update(sym=csym, asof=chart["asof"], adjustment_basis=INDEX_BASIS if index else "split-adjusted",
                      bars={"sym": csym, "tf": "D", "asof": chart["asof"],
                            "window": int(chart.get("window", 120)) + WARMUP_BARS, "forward": int(chart.get("forward", 20)),
                            **({"source": "index"} if index else {})})
        items.append(it)
    return items


def strip_private(items: Iterable[dict]) -> list[dict]:
    """The bank file form: drop the build-only keys."""
    return [{k: v for k, v in it.items() if not k.startswith("_")} for it in items]
