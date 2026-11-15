"""Study -- the picture card for a computed question (VISUALS_PLAN.md step 3, 2026-11-15).

WHY
---
The owner, 2026-11-14: "Would prefer all of them to have some sort of visual representation or example or card or
lesson to enhance the experience and the lesson and teaching." A setup question shows its real chart; a computed
question (where is 3R, how many shares, how far did it fall) shows a small card drawn from the question's own `calc`:

  ladder      prices on a ruler: an entry and its stop with the R level asked for, a buy point and the most we pay,
              a high and its trailing stop, an option's strike and its breakeven
  move        a price going from one number to another (a percent change, a fall from a peak, how far above a line)
  recover     a loss and the gain back to even
  size        the position-size chain: the account, the risk, the entry and stop, the shares
  range       a bar's high, low and close (where in its range it closed)
  quote       a bid and an ask (the spread)
  share       a slice of a whole (the most we own: 1% of the average day's volume)
  expectancy  the wins and the losses of a record, in R

THE RULES THIS FILE KEEPS
-------------------------
1. The card carries the question's INPUTS only, never the result: the bank puts it in `prompt_json.visual`, which a
   member receives before answering. The answer fills in after scoring from the reveal's `facts.calc.result`.
2. Every number on the card is stated in the question's own words (the question, the story, the fill sentence; never
   the choices, which hold the answer). A card whose number the words do not state is not drawn: no card beats a card
   that teaches a number the member was never given.
3. A shape is drawn only when its roles are certain: `a + 3 * (a - b)` is an entry and a stop because one R is a - b,
   and the words must name the level ("3R"). An expression whose shape this file does not know gets no card (its
   working line still shows after the answer, drawn by the app from `facts.calc`).
"""
from __future__ import annotations

import math
import re
from typing import Any, Optional

#: a number as the words write it: "$1,234.50", "2.5", "40%", "2 million", "1.2M"
_NUM = re.compile(r"(?<![\w.])\$?(\d[\d,]*(?:\.\d+)?|\.\d+)\s*(million|billion|thousand|mln|bn|[mkb](?![a-z]))?", re.I)
_SCALE = {"million": 1e6, "mln": 1e6, "m": 1e6, "billion": 1e9, "bn": 1e9, "b": 1e9, "thousand": 1e3, "k": 1e3}
_WORD_NUM = {"zero": 0, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9,
             "ten": 10, "twenty": 20, "half": 0.5}


def stated_text(q: dict) -> str:
    """What a member reads before answering, without the choices (they hold the answer)."""
    return " ".join(str(q.get(k) or "") for k in ("q", "story", "sentence")).strip()


def numbers_stated(text: str) -> list[float]:
    out: list[float] = []
    for m in _NUM.finditer(text or ""):
        raw = m.group(1).replace(",", "")
        try:
            v = float(raw)
        except ValueError:
            continue
        out.append(v)
        if m.group(2):
            out.append(v * _SCALE[m.group(2).lower()])
    for w, v in _WORD_NUM.items():
        if re.search(rf"\b{w}\b", text or "", re.I):
            out.append(float(v))
    return out


def _is_stated(v: Any, nums: list[float]) -> bool:
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(float(v)):
        return False
    v = float(v)
    return any(abs(v - n) <= 1e-9 * max(1.0, abs(v)) for n in nums)


def _all_stated(values: list, text: str) -> bool:
    nums = numbers_stated(text)
    return all(_is_stated(v, nums) for v in values)


def _f(x: Any) -> Optional[float]:
    if isinstance(x, bool) or not isinstance(x, (int, float)):
        return None
    x = float(x)
    return x if math.isfinite(x) else None


# ── the cards ────────────────────────────────────────────────────────────────────────────────────────────────────────

def _lvl(key: str, label: str, price: float) -> dict:
    return {"key": key, "label": label, "price": price}


def _ladder(levels: list[dict], find: dict, side: str = "long", r: Optional[dict] = None) -> dict:
    out = {"kind": "ladder", "side": side, "levels": levels, "find": find}
    if r:
        out["r"] = r                                   # entry and stop: the app draws the R steps after the answer
    return out


def _r_label(n: float) -> str:
    return f"{n:g}R"


def _named(fn: str, a: dict, text: str) -> Optional[dict]:
    """A card for a named calc (courses_lib.CALCS), or None."""
    if fn in ("pct_change", "yoy_growth"):
        s, e = (_f(a.get("start")), _f(a.get("end"))) if fn == "pct_change" else (_f(a.get("prior")), _f(a.get("current")))
        if s is None or e is None or s <= 0 or e < 0:
            return None
        # a percent change is often a distance ("how far above the 9 EMA"), where "start" would mislabel the line: the
        # card names no roles for it, only the base the percent is of
        labels = ("", "") if fn == "pct_change" else ("A year ago", "Now")
        return {"kind": "move", "from": {"label": labels[0], "value": s}, "to": {"label": labels[1], "value": e},
                "find": {"label": "The change", "as": "pct"}}
    if fn == "drawdown_pct":
        p, t = _f(a.get("peak")), _f(a.get("trough"))
        if p is None or t is None or p <= 0:
            return None
        return {"kind": "move", "from": {"label": "Peak", "value": p}, "to": {"label": "Low", "value": t},
                "find": {"label": "The fall", "as": "pct"}}
    if fn == "gain_to_recover":
        loss = _f(a.get("loss_pct"))
        if loss is None or not 0 < loss < 100:
            return None
        return {"kind": "recover", "loss_pct": loss, "find": {"label": "The gain back to even", "as": "pct"}}
    if fn == "r_multiple":
        e, s, x = _f(a.get("entry")), _f(a.get("stop")), _f(a.get("exit"))
        if None in (e, s, x) or e == s:
            return None
        side = "short" if a.get("side") == "short" else "long"
        return _ladder([_lvl("stop", "Stop", s), _lvl("entry", "Entry", e), _lvl("exit", "Exit", x)],
                       {"label": "R on the trade", "as": "r"}, side, {"entry": e, "stop": s})
    if fn == "shares_from_risk":
        acct, pct, e, s = (_f(a.get(k)) for k in ("account", "risk_pct", "entry", "stop"))
        if None in (acct, pct, e, s) or e == s:
            return None
        return {"kind": "size", "rows": [
            {"key": "account", "label": "Account", "value": acct, "fmt": "$"},
            {"key": "risk_pct", "label": "Risk", "value": pct, "fmt": "%"},
            {"key": "entry", "label": "Entry", "value": e, "fmt": "$"},
            {"key": "stop", "label": "Stop", "value": s, "fmt": "$"}],
            "find": {"label": "Shares", "as": "shares"}}
    if fn == "risk_dollars":
        sh, e, s = (_f(a.get(k)) for k in ("shares", "entry", "stop"))
        if None in (sh, e, s) or e == s:
            return None
        return {"kind": "size", "rows": [
            {"key": "shares", "label": "Shares", "value": sh, "fmt": "sh"},
            {"key": "entry", "label": "Entry", "value": e, "fmt": "$"},
            {"key": "stop", "label": "Stop", "value": s, "fmt": "$"}],
            "find": {"label": "Dollars at risk", "as": "dollars"}}
    if fn in ("spread", "spread_pct"):
        b, k = _f(a.get("bid")), _f(a.get("ask"))
        if b is None or k is None or k < b:
            return None
        return {"kind": "quote", "bid": b, "ask": k,
                "find": {"label": "The spread" if fn == "spread" else "The spread, % of the midpoint",
                         "as": "dollars" if fn == "spread" else "pct"}}
    if fn in ("option_breakeven", "intrinsic", "extrinsic", "option_payoff"):
        kind = a.get("kind")
        k = _f(a.get("strike"))
        if kind not in ("call", "put") or k is None:
            return None
        out = {"kind": "payoff", "option": kind, "side": "short" if a.get("side") == "short" else "long", "strike": k}
        for key in ("premium", "underlying"):
            if a.get(key) is not None:
                v = _f(a.get(key))
                if v is None:
                    return None
                out[key] = v
        find = {"option_breakeven": {"label": "Breakeven", "as": "price"},
                "intrinsic": {"label": "Intrinsic value", "as": "per_share"},
                "extrinsic": {"label": "Time value", "as": "per_share"},
                "option_payoff": {"label": "Profit or loss at expiry", "as": "dollars"}}[fn]
        if fn == "option_payoff":
            c, m = _f(a.get("contracts", 1)), _f(a.get("multiplier", 100))
            if c is None or m is None:
                return None
            out["contracts"], out["multiplier"] = c, m
        out["find"] = find
        return out
    if fn == "vertical_payoff":
        kind = a.get("kind")
        lk, sk, d, u = (_f(a.get(k)) for k in ("long_strike", "short_strike", "net_debit", "underlying"))
        if kind not in ("call", "put") or None in (lk, sk, d, u):
            return None
        return {"kind": "payoff", "option": kind, "side": "long", "legs": [{"strike": lk, "side": "long"}, {"strike": sk, "side": "short"}],
                "net_debit": d, "underlying": u, "contracts": _f(a.get("contracts", 1)) or 1.0,
                "multiplier": _f(a.get("multiplier", 100)) or 100.0,
                "find": {"label": "Profit or loss at expiry", "as": "dollars"}}
    if fn == "expectancy_r":
        w, aw, al = (_f(a.get(k)) for k in ("win_rate_pct", "avg_win_r", "avg_loss_r"))
        if None in (w, aw, al) or not 0 < w < 100:
            return None
        return {"kind": "expectancy", "win_pct": w, "avg_win_r": aw, "avg_loss_r": al,
                "find": {"label": "R per trade", "as": "r"}}
    if fn == "short_pnl":
        e, x, sh = (_f(a.get(k)) for k in ("entry", "exit", "shares"))
        if None in (e, x, sh):
            return None
        return _ladder([_lvl("entry", "Short at", e), _lvl("exit", "Covered at", x)],
                       {"label": "Profit or loss", "as": "dollars"}, "short")
    if fn == "avg_price":
        fills = a.get("fills") or []
        lv = []
        for i, f in enumerate(fills):
            if not (isinstance(f, (list, tuple)) and len(f) == 2):
                return None
            sh, px = _f(f[0]), _f(f[1])
            if sh is None or px is None:
                return None
            lv.append({"key": f"fill{i + 1}", "label": f"{sh:,.0f} shares", "price": px, "shares": sh})
        if len(lv) < 2:
            return None
        return _ladder(lv, {"label": "Average price", "as": "price"})
    return None


# arithmetic shapes whose roles are certain (spaces removed; names are \w+ captured)
_W = r"([A-Za-z_]\w*)"
_N = r"(\d+(?:\.\d+)?)"
_SHAPES = [
    # an R level: entry + n x (entry - stop) (long), entry - n x (stop - entry) (short)
    ("r_target_long", re.compile(rf"^{_W}\+{_N}\*\(\1-{_W}\)$")),
    ("r_target_short", re.compile(rf"^{_W}-{_N}\*\({_W}-\1\)$")),
    # a reward in R: (target - entry) / (entry - stop)
    ("r_reward", re.compile(rf"^\({_W}-{_W}\)/\(\2-{_W}\)$")),
    # a loss in R: (entry - price) / (entry - stop)
    ("r_loss", re.compile(rf"^\({_W}-{_W}\)/\(\1-{_W}\)$")),
    # where a bar closed in its range: (close - low) / (high - low) [x 100]
    ("range", re.compile(rf"^\({_W}-{_W}\)/\({_W}-\2\)(\*100)?$")),
    # how far one price is from another, as a percent of the first: (a - b) / a x 100, or of the second: / b
    ("pct_of_first", re.compile(rf"^\({_W}-{_W}\)/\1\*100$")),
    ("pct_of_second", re.compile(rf"^\({_W}-{_W}\)/\2\*100$")),
    # the most we pay: a price times 1.04 (the no-chase rule), or a level x (1 + cap / 100)
    ("chase_cap", re.compile(rf"^{_W}\*(1\.\d+)$")),
    ("chase_cap_pct", re.compile(rf"^{_W}\*\(1\+{_W}/100\)$")),
    # one percent of the average day's volume (the house ownership ceiling)
    ("share_mult", re.compile(rf"^{_W}\*(0\.\d+)$")),
    ("share_div", re.compile(rf"^{_W}/100$")),
    ("share_pct", re.compile(rf"^{_W}\*{_W}/100$")),
    # a trailing stop under the high
    ("trail", re.compile(rf"^{_W}-{_W}$")),
    # shares from a dollar risk and a per-share risk
    ("shares_div", re.compile(rf"^{_W}/{_W}$")),
]

_VOLUME_WORDS = re.compile(r"\b(a day|daily|average volume|averages?|shares a day|volume)\b", re.I)
_ACCOUNT_WORDS = re.compile(r"\baccount\b", re.I)
_CAP_WORDS = re.compile(r"\b(most|highest|cap|limit|no-chase|chase|at most|skip)\b", re.I)


_NAME_WORDS = {"consensus": "Consensus", "estimate": "Estimate", "actual": "Actual", "entry": "Entry", "stop": "Stop",
               "fill": "Fill", "low": "Low", "high": "High", "top": "Top", "later": "Later", "first": "First",
               "second": "Second", "start": "Start", "end": "End", "peak": "Peak", "price": "Price", "close": "Close",
               "open": "Open", "today": "Today", "q4": "Q4", "q1": "Q1", "trigger": "Trigger", "pivot": "Pivot"}


def _name_label(name: str) -> str:
    """A role named by the expression itself ("consensus"), or "" for a bare letter."""
    return _NAME_WORDS.get(name.lower(), "")


def _line_label(text: str) -> str:
    """What a chase cap is measured from, as the words name it."""
    for pat, label in ((r"\b9 EMA\b", "9 EMA"), (r"\b20 EMA\b", "20 EMA"), (r"\b50[- ]day\b", "50-day"),
                       (r"\bpivot\b", "Pivot"), (r"\bbreakout level\b", "Breakout level"),
                       (r"\bbuy point\b", "Buy point"), (r"\btrigger\b", "Trigger")):
        if re.search(pat, text, re.I):
            return label
    return ""


def _arith(a: dict, text: str) -> Optional[dict]:
    expr = re.sub(r"\s+", "", str(a.get("expr") or ""))
    vals = {k: _f(v) for k, v in a.items() if k != "expr"}
    if not expr or any(v is None for v in vals.values()):
        return None
    return _arith_shapes(expr, vals, text) or _arith_named(expr, vals, text)


# shapes whose roles the expression's own NAMES fix (2026-11-15, the second pass): a part of a whole, a volume multiple,
# a midpoint, a level a stated percent under a peak, the dollars between two named prices
_PART_WHOLE = {
    ("wins", "trades"): ("Winners", "Trades", "count"), ("above", "total"): ("Above the line", "All of them", "count"),
    ("order", "adv"): ("Your order", "Average day", "shares"), ("order", "daily"): ("Your order", "A day's volume", "shares"),
    ("short_shares", "float_shares"): ("Sold short", "The float", "shares"), ("loss", "account"): ("The loss", "Account", "$"),
    ("risk", "account"): ("The risk", "Account", "$"), ("same", "breaks"): ("That mistake", "All breaks", "count"),
    ("op_income", "revenue"): ("Operating income", "Revenue", "$"), ("operating_income", "revenue"): ("Operating income", "Revenue", "$"),
    ("gross_profit", "revenue"): ("Gross profit", "Revenue", "$"),
}
_VOL_MULT = {("today", "avg"): "Today", ("day_volume", "avg_volume"): "That day"}
_UNDER_LEVEL = {"peak": "Peak", "high": "High", "support": "Support", "start": "Start", "price": "Price"}
_COST_PAIRS = {
    ("stop", "fill"): ("Stop", "Fill", "Slippage"), ("avg_fill", "expected"): ("Average fill", "Expected", "Slippage"),
    ("cover", "entry"): ("Covered at", "Short at", "The loss"), ("cover", "short_price"): ("Covered at", "Short at", "The loss"),
    ("fill", "entry"): ("Stop fill", "Short at", "The loss"), ("entry", "fill"): ("Entry", "Stop fill", "The loss"),
    ("price", "stop"): ("Price", "Stop", "Open risk"),
}


def _arith_named(expr: str, vals: dict, text: str) -> Optional[dict]:
    m = re.fullmatch(rf"{_W}/{_W}\*100", expr)
    if m and (m[1].lower(), m[2].lower()) in _PART_WHOLE:
        p, w = vals[m[1]], vals[m[2]]
        pl, wl, fmt = _PART_WHOLE[(m[1].lower(), m[2].lower())]
        if not 0 <= p <= w or w <= 0:
            return None
        # numbers the words scale ("a 12 million share float", "$57,006 million") print plain: "12 shares" or "$57,006"
        # would misstate them
        if (fmt == "shares" and w < 1000) or (fmt == "$" and re.search(r"\b(million|billion)\b", text, re.I)):
            fmt = "count"
        # the card's title is "The share", so the slot names what is asked: the part as a percent of the whole
        return {"kind": "share", "whole": {"label": wl, "value": w, "fmt": fmt}, "part": {"label": pl, "value": p, "fmt": fmt},
                "find": {"label": "As a percent", "as": "pct"}}
    m = re.fullmatch(rf"{_W}/{_W}", expr)
    if m:
        x, y = m[1], m[2]
        named = _VOL_MULT.get((x.lower(), y.lower()))
        bare = len(x) == 1 and len(y) == 1
        words = (re.search(r"\baverage", text, re.I) and re.search(r"\b(volume|shares)\b", text, re.I)
                 and re.search(r"\b(times|multiple)\b", text, re.I))
        if (named or (bare and words)) and vals[y] > 0:
            # the base is the denominator: the average day; the other column is the day (or stretch) measured against it
            return {"kind": "move", "from": {"label": "Average", "value": vals[y]}, "to": {"label": named or "", "value": vals[x]},
                    "find": {"label": "Times average", "as": "times"}}
        return None
    m = re.fullmatch(rf"\({_W}\+{_W}\)/2", expr)
    if m:
        x, y = m[1], m[2]
        if (x.lower(), y.lower()) in (("low", "high"), ("high", "low"), ("open", "close"), ("close", "open")):
            levels = [_lvl(x.lower(), _NAME_WORDS[x.lower()], vals[x]), _lvl(y.lower(), _NAME_WORDS[y.lower()], vals[y])]
        elif re.search(r"\bmidpoint\b", text, re.I) and vals[x] != vals[y]:
            hi, lo = max(vals[x], vals[y]), min(vals[x], vals[y])
            levels = [_lvl("high", "High", hi), _lvl("low", "Low", lo)]
        else:
            return None
        return _ladder(levels, {"label": "Midpoint", "as": "price"})
    m = (re.fullmatch(rf"{_W}\*\(1-{_W}/100\)", expr) or re.fullmatch(rf"{_W}\*\(100-{_W}\)/100", expr))
    if m and m[1].lower() in _UNDER_LEVEL:
        pct = vals.get(m[2])
        if pct is None or not 0 < pct < 100 or not _all_stated([pct], text):
            return None
        return _ladder([_lvl("level", _UNDER_LEVEL[m[1].lower()], vals[m[1]])], {"label": f"{pct:g}% under", "as": "price"})
    m = re.fullmatch(rf"\({_W}-{_W}\)\*{_W}", expr)
    if m and m[3].lower() == "shares":
        x, y, sh = m[1], m[2], vals[m[3]]
        if (x.lower(), y.lower()) == ("ask", "bid"):
            if vals[x] < vals[y]:
                return None
            return {"kind": "quote", "bid": vals[y], "ask": vals[x], "shares": sh, "find": {"label": "The spread's cost", "as": "dollars"}}
        pair = _COST_PAIRS.get((x.lower(), y.lower()))
        if not pair or sh <= 0:
            return None
        xl, yl, find = pair
        out = _ladder([_lvl(x.lower(), xl, vals[x]), _lvl(y.lower(), yl, vals[y])], {"label": find, "as": "dollars"})
        out["shares"] = sh
        return out
    return None


def _arith_shapes(expr: str, vals: dict, text: str) -> Optional[dict]:
    for name, rx in _SHAPES:
        m = rx.match(expr)
        if not m:
            continue
        g = m.groups()
        if name in ("r_target_long", "r_target_short"):
            e, n, s = (g[0], float(g[1]), g[2])
            if e not in vals or s not in vals:
                return None
            ev, sv = vals[e], vals[s]
            if ev == sv or (name == "r_target_long" and sv >= ev) or (name == "r_target_short" and sv <= ev):
                return None
            lab = _r_label(n)
            if not re.search(rf"\b{re.escape(lab)}\b", text):     # the words name the level ("Where is 3R?")
                return None
            return _ladder([_lvl("stop", "Stop", sv), _lvl("entry", "Entry", ev)], {"label": lab, "as": "price"},
                           "long" if name == "r_target_long" else "short", {"entry": ev, "stop": sv})
        if name in ("r_reward", "r_loss"):
            if name == "r_reward":
                x, e, s = g
            else:
                e, x, s = g
            if not {x, e, s} <= set(vals) or len({x, e, s}) < 3:
                return None
            ev, sv, xv = vals[e], vals[s], vals[x]
            # an R count: the expression names its entry and stop, or the words speak of R, risk or the planned loss
            named = e.lower() == "entry" and s.lower() == "stop"
            if sv >= ev or not (named or re.search(r"\bR\b|\breward\b|\brisk\b|\bplanned loss\b", text)):
                return None
            third = {"target": "Target", "exit": "Exit", "sell": "Sell", "low": "Low"}.get(x.lower(), "Price")
            if name == "r_reward" and xv <= ev:
                return None
            if name == "r_loss" and xv >= ev:
                return None
            return _ladder([_lvl("stop", "Stop", sv), _lvl("entry", "Entry", ev), _lvl("price", third, xv)],
                           {"label": "R" if name == "r_reward" else "R lost", "as": "r" if name == "r_reward" else "r_loss"},
                           "long", {"entry": ev, "stop": sv})
        if name == "range":
            c, lo, h = g[0], g[1], g[2]
            if not {c, lo, h} <= set(vals):
                return None
            cv, lv, hv = vals[c], vals[lo], vals[h]
            if not lv < hv or not lv <= cv <= hv:
                return None
            # a bar's close ("closed at 31.40"), or any value inside a range (today's IV inside the year's 20 to 60)
            is_close = c.lower() in ("c", "close") and re.search(r"\bclos", text, re.I)
            return {"kind": "range", "high": hv, "low": lv, "close": cv, "value_label": "Close" if is_close else (_name_label(c) or "Now"),
                    "find": {"label": "Where it closed in its range" if is_close else "Where it sits in its range",
                             "as": "pct" if g[3] else "frac"}}
        if name in ("pct_of_first", "pct_of_second"):
            x, y = g[0], g[1]
            if x not in vals or y not in vals or x == y:
                return None
            xv, yv = vals[x], vals[y]
            if {x.lower(), y.lower()} == {"ask", "bid"} and name == "pct_of_first" and x.lower() == "ask":
                if vals[y] > vals[x]:
                    return None
                return {"kind": "quote", "bid": vals[y], "ask": vals[x], "find": {"label": "The spread, % of the ask", "as": "pct"}}
            (bn, base), (on, other) = ((x, xv), (y, yv)) if name == "pct_of_first" else ((y, yv), (x, xv))
            if base <= 0 or other <= 0:
                return None
            # the other price measured against the base; the card's number is the distance as a percent of the base.
            # Roles are named only when the expression names them ("consensus", "entry"); a and b stay unnamed
            return {"kind": "move", "from": {"label": _name_label(bn), "value": base},
                    "to": {"label": _name_label(on), "value": other}, "find": {"label": "The distance", "as": "pct"}}
        if name in ("chase_cap", "chase_cap_pct"):
            v = g[0]
            if v not in vals or not _CAP_WORDS.search(text):
                return None
            lab = _line_label(text)
            if not lab:
                return None
            pct = round((float(g[1]) - 1) * 100, 6) if name == "chase_cap" else vals.get(g[1])
            if pct is None or not 0 < pct <= 25 or not _all_stated([pct], text):
                return None
            # `tag`: the answer row's short name on the ruler, where the full label does not fit a phone
            return _ladder([_lvl("line", lab, vals[v])], {"label": f"The most we pay ({pct:g}% over)", "as": "price", "tag": "Most we pay"})
        if name in ("share_mult", "share_div", "share_pct"):
            if not _VOLUME_WORDS.search(text) or _ACCOUNT_WORDS.search(text):
                return None
            if name == "share_mult":
                v, pct = g[0], round(float(g[1]) * 100, 6)
            elif name == "share_div":
                v, pct = g[0], 1.0
            else:
                p, q = g
                if p not in vals or q not in vals:
                    return None
                v, pct = (p, vals[q]) if vals[q] <= 100 < vals[p] else (q, vals[p]) if vals[p] <= 100 < vals[q] else (None, None)
                if v is None:
                    return None
            if v not in vals or not 0 < pct <= 10 or vals[v] < 1000:
                return None
            if not re.search(rf"{pct:g}\s*%|{pct:g} percent|one percent", text, re.I):
                return None
            return {"kind": "share", "whole": {"label": "Average day's volume", "value": vals[v], "fmt": "shares"},
                    "pct": pct, "find": {"label": "The most we own", "as": "shares"}}
        if name == "trail":
            h, t = g
            if h.lower() == "entry" and t.lower() == "stop" and vals[t] < vals[h]:
                return _ladder([_lvl("stop", "Stop", vals[t]), _lvl("entry", "Entry", vals[h])],
                               {"label": "Risk per share", "as": "per_share"}, "long", {"entry": vals[h], "stop": vals[t]})
            if h.lower() != "high" or t.lower() != "trail":
                return None
            return _ladder([_lvl("high", "High", vals[h])], {"label": f"Trailing stop ({vals[t]:g} under)", "as": "price", "tag": "Stop"})
        if name == "shares_div":
            r, p = g
            if r.lower() != "risk" or p.lower() not in ("per_share", "stop_distance"):
                return None
            return {"kind": "size", "rows": [
                {"key": "risk", "label": "Dollars at risk", "value": vals[r], "fmt": "$"},
                {"key": "per_share", "label": "Risk per share", "value": vals[p], "fmt": "$"}],
                "find": {"label": "Shares", "as": "shares"}}
    # named sizing forms
    if expr in ("account*pct/100", "account*risk_pct/100") and {"account"} <= set(vals):
        pk = "pct" if "pct" in vals else "risk_pct"
        return {"kind": "size", "rows": [
            {"key": "account", "label": "Account", "value": vals["account"], "fmt": "$"},
            {"key": "risk_pct", "label": "Risk", "value": vals[pk], "fmt": "%"}],
            "find": {"label": "Dollars at risk", "as": "dollars"}}
    return None


def _given_values(card: dict) -> list:
    """Every number the card shows before the answer."""
    k = card["kind"]
    if k == "ladder":
        out = [lv["price"] for lv in card["levels"]] + [lv["shares"] for lv in card["levels"] if "shares" in lv]
        return out + ([card["shares"]] if "shares" in card else [])
    if k == "move":
        return [card["from"]["value"], card["to"]["value"]]
    if k == "recover":
        return [card["loss_pct"]]
    if k == "size":
        return [r["value"] for r in card["rows"]]
    if k == "range":
        return [card["high"], card["low"], card["close"]]
    if k == "quote":
        return [card["bid"], card["ask"]] + ([card["shares"]] if "shares" in card else [])
    if k == "share":
        return [card["whole"]["value"], card["part"]["value"] if "part" in card else card["pct"]]
    if k == "expectancy":
        return [card["win_pct"], card["avg_win_r"], card["avg_loss_r"]]
    if k == "payoff":
        out = [card.get("strike")] if card.get("strike") is not None else []
        out += [lg["strike"] for lg in card.get("legs") or []]
        out += [card[x] for x in ("premium", "underlying", "net_debit") if card.get(x) is not None]
        return out
    return []


# ── a card written by hand (2026-11-15, the second half of step 3) ──────────────────────────────────────────────────
# A question whose expression no shape above can read ("(a - b) / c", an ATR depth) may carry its own `visual`, written
# by a writer who read the question and checked by a cold checker. It is held to the SAME contract as a built card,
# enforced here (and by unit_problems, so gen_courses refuses a bad one): a known kind with its fields, the inputs only,
# every number on it (labels included) stated in the question's words, never the result.
KINDS = ("ladder", "move", "recover", "size", "range", "quote", "share", "expectancy", "payoff")
FIND_AS = ("price", "r", "r_loss", "per_share", "dollars", "pct", "frac", "shares", "times", "num")
_LABEL_MAX = 30


def _strings(obj) -> list[str]:
    if isinstance(obj, str):
        return [obj]
    if isinstance(obj, dict):
        return [s for k, v in obj.items() if k not in ("kind", "as", "side", "option", "fmt", "key") for s in _strings(v)]
    if isinstance(obj, list):
        return [s for v in obj for s in _strings(v)]
    return []


def _shape_problems(v: dict) -> list[str]:
    k = v.get("kind")
    fin = lambda x: isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(float(x))  # noqa: E731
    if k == "ladder":
        lv = v.get("levels")
        if not isinstance(lv, list) or not lv or not all(isinstance(x, dict) and fin(x.get("price")) and x.get("key") for x in lv):
            return ["ladder needs levels [{key, label, price}]"]
        r = v.get("r")
        if r is not None:
            prices = {float(x["price"]) for x in lv}
            if not (isinstance(r, dict) and fin(r.get("entry")) and fin(r.get("stop")) and r["entry"] != r["stop"]
                    and {float(r["entry"]), float(r["stop"])} <= prices):
                return ["ladder r needs an entry and a stop that are both levels on the ruler"]
        if v.get("side", "long") not in ("long", "short"):
            return ["ladder side is long or short"]
    elif k == "move":
        if not (isinstance(v.get("from"), dict) and isinstance(v.get("to"), dict) and fin(v["from"].get("value"))
                and fin(v["to"].get("value")) and v["from"]["value"] > 0 and v["to"]["value"] >= 0):
            return ["move needs from.value > 0 and to.value >= 0"]
    elif k == "recover":
        if not (fin(v.get("loss_pct")) and 0 < v["loss_pct"] < 100):
            return ["recover needs 0 < loss_pct < 100"]
    elif k == "size":
        rows = v.get("rows")
        if not isinstance(rows, list) or len(rows) < 2 or not all(isinstance(x, dict) and fin(x.get("value")) and x.get("label") for x in rows):
            return ["size needs 2+ rows [{key, label, value, fmt}]"]
        if any(x.get("fmt") not in (None, "$", "%", "sh", "shares", "count") for x in rows):
            return ["a size row's fmt is $, %, shares or count"]
    elif k == "range":
        if not (fin(v.get("high")) and fin(v.get("low")) and fin(v.get("close")) and v["low"] < v["high"]
                and v["low"] <= v["close"] <= v["high"]):
            return ["range needs low < high with the value between them"]
    elif k == "quote":
        if not (fin(v.get("bid")) and fin(v.get("ask")) and v["ask"] >= v["bid"]):
            return ["quote needs bid <= ask"]
    elif k == "share":
        w = v.get("whole")
        if not (isinstance(w, dict) and fin(w.get("value")) and w["value"] > 0):
            return ["share needs whole.value > 0"]
        p = v.get("part")
        if p is not None and not (isinstance(p, dict) and fin(p.get("value")) and 0 <= p["value"] <= w["value"]):
            return ["share part must lie between 0 and the whole"]
        if p is None and not (fin(v.get("pct")) and 0 < v["pct"] <= 100):
            return ["share needs a part or a pct"]
    elif k == "expectancy":
        if not (fin(v.get("win_pct")) and 0 < v["win_pct"] < 100 and fin(v.get("avg_win_r")) and fin(v.get("avg_loss_r"))):
            return ["expectancy needs win_pct, avg_win_r, avg_loss_r"]
    elif k == "payoff":
        if v.get("option") not in ("call", "put"):
            return ["payoff option is call or put"]
        if not fin(v.get("strike")) and not (isinstance(v.get("legs"), list) and len(v["legs"]) == 2
                                              and all(fin((x or {}).get("strike")) for x in v["legs"])):
            return ["payoff needs a strike or two legs"]
    return []


def written_problems(q: dict) -> list[str]:
    """The problems with a question's hand-written `visual` ([] when it has none, or a good one)."""
    v = q.get("visual")
    if v is None:
        return []
    if not isinstance(v, dict) or v.get("kind") not in KINDS:
        return [f"visual kind must be one of {', '.join(KINDS)}"]
    if q.get("chart"):
        return ["a chart question takes no visual (the chart is its picture)"]
    if not isinstance(q.get("calc"), dict):
        return ["a visual needs the question's calc (its answer fills in from it)"]
    out = _shape_problems(v)
    f = v.get("find")
    if not (isinstance(f, dict) and isinstance(f.get("label"), str) and f["label"].strip() and f.get("as") in FIND_AS):
        out.append(f"visual find needs a label and an `as` in {', '.join(FIND_AS)}")
    for s in _strings(v):
        if len(s) > _LABEL_MAX:
            out.append(f"visual label longer than {_LABEL_MAX} characters: {s!r}")
    if out:
        return out
    text = stated_text(q)
    nums = numbers_stated(text)
    vals = [abs(x) if v["kind"] == "payoff" else x for x in _given_values(v)]
    for s in _strings(v):                                   # a number inside a label is on the card too
        vals += [float(m.replace(",", "")) for m in re.findall(r"\d[\d,]*(?:\.\d+)?", s)]
    unstated = [x for x in vals if not _is_stated(x, nums)]
    if unstated:
        out.append(f"visual shows numbers the question's words do not state: {sorted(set(unstated))}")
    try:
        from scripts.study.courses_lib import calc_value
        result = calc_value(q["calc"])
    except Exception:  # noqa: BLE001 - the calc's own problems are reported by the validator
        result = None
    if result is not None and result in [float(x) for x in vals] and not _is_stated(result, nums):
        out.append(f"visual shows the answer ({result:g}) before it is given")
    return out


def visual_for(q: dict) -> Optional[dict]:
    """The card for a computed question, or None (no calc, a chart question, an unknown shape, or a number the words
    do not state). A good hand-written `visual` wins; a bad one draws nothing (and unit_problems names it)."""
    if q.get("visual") is not None:
        return dict(q["visual"]) if not written_problems(q) else None
    calc = q.get("calc")
    if not isinstance(calc, dict) or q.get("chart"):
        return None
    fn = calc.get("fn")
    a = calc.get("args") or {}
    if not isinstance(a, dict):
        return None
    text = stated_text(q)
    card = _arith(a, text) if fn == "arith" else _named(str(fn or ""), a, text)
    if not card:
        return None
    # a payoff's net debit may be negative (a credit); its size is what the words state
    vals = [abs(v) if card["kind"] == "payoff" else v for v in _given_values(card)]
    if not _all_stated(vals, text):
        return None
    return card
