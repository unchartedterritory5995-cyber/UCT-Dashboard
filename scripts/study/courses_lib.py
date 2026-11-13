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
VERIFY_STATUSES = ("pass", "fix", "cut")


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
        for field in ("q", "story", "why", "lesson_line"):
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
    ans = q.get("answer")
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
        if fmt == "scenario" and not (q.get("story") or "").strip():
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
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(chart.get("asof") or "")):
            out.append("chart.asof must be YYYY-MM-DD (the last visible day)")
        if not 20 <= int(chart.get("window", 120)) <= 400 or not 0 <= int(chart.get("forward", 20)) <= 250:
            out.append("chart.window must be 20-400 bars and chart.forward 0-250")
        if str(chart.get("sym") or "").upper() in (q.get("q") or "").upper().split():
            out.append("the question names the chart's ticker (a member must not see it before answering)")
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
    out.extend(support_problems(q, facts, sources))
    return out


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
    texts = [("why", r.get("why") or ""), ("lesson_line", r.get("lesson_line") or "")]
    texts += [(f"wrong[{k}]", v) for k, v in (r.get("wrong") or {}).items()]
    if it.get("type") == "walkthrough":
        texts += [(f"step{i + 1}", s) for i, s in enumerate((it.get("prompt_json") or {}).get("steps") or [])]
    for field, text in texts:
        for tok in study_import.ungrounded_numbers(text, allowed):
            out.append(f"{field}: number {tok} is not in a cited quote, the calc or the question")
    return out


# ── building ──────────────────────────────────────────────────────────────────────────────────────────────────────

def _source_cite(src: dict, fact: dict) -> dict:
    return {"name": f"{src.get('publisher')}: {src.get('title')}", "url": src.get("url"),
            "quote": fact.get("quote"), "accessed": src.get("accessed"), "tier": src.get("tier")}


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
        cites = [_source_cite(sources.get(facts[f]["source"], {}), facts[f]) for f in w.get("facts") or [] if f in facts]
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
        answer_json: dict[str, Any] = {"answer": dedash(answer) if isinstance(answer, str) else answer}
        reveal_facts: dict[str, Any] = {}
        given = given_text(q)
        if given:
            # the numbers the question itself states (a story's prices, a quote card): the reveal may restate them
            reveal_facts["given"] = given
        if q.get("calc"):
            val = calc_value(q["calc"])
            reveal_facts["calc"] = {"fn": q["calc"]["fn"], "args": q["calc"].get("args") or {}, "result": val}
            if fmt == "numeric":
                answer_json = {"answer": val, "accept": numeric_accept(val)}
        cited = [f for f in q.get("facts") or [] if f in facts]
        cites = [_source_cite(sources.get(facts[f]["source"], {}), facts[f]) for f in cited]
        why, line = dedash(q.get("why") or ""), dedash(q.get("lesson_line") or "")
        reveal = {
            "unit": unit, "why": why, "lesson_line": line, "facts": reveal_facts,
            "depth": {"summary": " ".join(dedash(facts[f]["claim"]) for f in cited), "sources": cites},
        }
        if q.get("wrong"):
            reveal["wrong"] = {dedash(k): dedash(v) for k, v in q["wrong"].items()}
        chart = q.get("chart") or None
        if chart:
            # a real chart under the question (History Detective, a dated example): the importer resolves the bars from
            # bars.db by this spec (get_bars_before, split-adjusted); the ticker never reaches a member before scoring
            prompt["chart"] = {"window_bars": int(chart.get("window", 120)), "tf": "D"}
        it = {
            "id": item_id(ref_base, f"q:{key}"), "version": 1, "type": "scenario" if fmt == "scenario" else "recall",
            "skill_id": q.get("skill"), "module": track, "difficulty": _difficulty(int(q.get("rung") or 1)),
            "prompt_json": prompt, "answer_json": answer_json, "reveal_json": reveal,
            "source_kind": "course", "source_ref": f"{ref_base}#{key}",
            "lesson_text": (why + " " + line).strip(), "lesson_origin": "session", "review_status": "draft",
            "_key": key,
        }
        if chart:
            it.update(sym=str(chart["sym"]).upper(), asof=chart["asof"], adjustment_basis="split-adjusted",
                      bars={"sym": str(chart["sym"]).upper(), "tf": "D", "asof": chart["asof"],
                            "window": int(chart.get("window", 120)), "forward": int(chart.get("forward", 20))})
        items.append(it)
    return items


def strip_private(items: Iterable[dict]) -> list[dict]:
    """The bank file form: drop the build-only keys."""
    return [{k: v for k, v in it.items() if not k.startswith("_")} for it in items]
