"""F5 -- a recursive series seeded at the window, off the listing.

The Python twin of the ``F5`` section of
``app/src/components/chart/engine/ast/interpret.js`` (``seedWarmupMask`` /
``seedBoundOf``). Read that header for the ruling and every rule; this is the
same decision, node for node, held equal by
``tests/fixtures/ast/seed_warmup_parity.json`` (written by
``seedWarmup.test.js``, read by ``tests/test_ast_seed_warmup_parity.py``).

TradingView runs ``ta.ema`` / ``ta.rma`` / ``ta.rsi`` / ``ta.atr`` / the MACD line /
the DMI legs from the symbol's first bar. A series that starts later seeds them
at ITS first bar, so the early values are a different number that converges.
Off the listing (``opts["barIndexAbsolute"] is True`` -- a Pine document -- and
``opts["historyFromListing"] is not True``) each such bar is WITHHELD, decided
from a per-bar bound on ``|ours - TradingView's|`` derived from the series' own
decay and the range of the data loaded.

It lives in its OWN module, like ``ast_bar_index_shift``, to keep a 600-line pass
out of the evaluator's file. It holds no ``try`` either: a node it cannot evaluate
refuses exactly as the evaluator would.
"""
from __future__ import annotations

import math
from collections import deque
from typing import Any, Callable, Dict, List, Mapping, Optional

#: Relative tolerance a withheld-or-drawn decision is made against -- the vendor
#: harness's ``REL_TOL`` (``interpret.js::SEED_WARMUP_REL``).
SEED_WARMUP_REL = 1e-9
#: Absolute floor -- the harness's floor where the symbol's tick is unknown.
SEED_WARMUP_ABS = 1e-12
#: A bound this small next to the values it qualifies is rounding, not a seed.
SEED_NOISE_REL = 1e-12
#: The name a seed withholding is disclosed under.
SEED_WARMUP_CODE = "seed:window"
#: The calls whose value carries a seed from the first bar.
SEEDED_CALLS = ("ema", "rma", "rsi", "macd", "atrPine", "atr", "adx", "plusDI", "minusDI")
_SEEDED = frozenset(SEEDED_CALLS)

INF = math.inf
NAN = math.nan
_WINDOW_MAX = {"sma": 1, "wma": 1, "median": 1, "highest": 1, "lowest": 1, "stdev": 1,
               "dev": 2, "percentileLinearInterpolation": 1}
_LIPSCHITZ_ONE = frozenset(("sin", "cos", "abs"))
_NESTED = ("tf", "tf_live", "sym", "ltf")


def _ai():
    # imported lazily: ``ast_interpret`` imports this module
    from api.services import ast_interpret  # noqa: PLC0415
    return ast_interpret


def _isnan(x: float) -> bool:
    return x != x


def seed_from_window_of(opts: Optional[Mapping[str, Any]]) -> bool:
    """``interpret.js::seedFromWindowOf`` -- a Pine document (``barIndexAbsolute``)
    on a series not stated to start at the listing, not under a probe."""
    o = opts or {}
    probe = o.get("prefixProbe")
    probing = isinstance(probe, (int, float)) and not isinstance(probe, bool)
    # not the object lane (``barIndexUse == "position"``) -- see the JS twin
    return (o.get("barIndexAbsolute") is True and o.get("historyFromListing") is not True
            and not probing and o.get("barIndexUse") != "position")


def _negligible(b: float, a: float, c: float = 0.0) -> bool:
    if b == 0:
        return True
    if _isnan(a) or _isnan(c):
        return False
    return b <= SEED_NOISE_REL * max(abs(a), abs(c))


def _reaches(tree: Any, memo: Dict[int, bool]) -> bool:
    """Does any node of ``tree`` carry a seed (``SEEDED_CALLS``)? Memoised per node."""
    def visit(n: Any) -> bool:
        if not isinstance(n, dict):
            return False
        k = id(n)
        if k in memo:
            return memo[k]
        memo[k] = False
        r = n.get("type") == "call" and n.get("name") in _SEEDED
        args = n.get("args")
        if isinstance(args, list):
            for a in args:
                if visit(a):
                    r = True
        memo[k] = r
        return r
    return visit(tree)


def _smoother_seed_bound(vs: List[float], bs: Optional[List[float]], n: int, alpha: float,
                         length: int) -> List[float]:
    """``interpret.js::smootherSeedBound``."""
    lo, hi, max_b = INF, -INF, 0.0
    for i in range(length):
        v = vs[i]
        if not math.isfinite(v):
            continue
        lo = min(lo, v)
        hi = max(hi, v)
        if bs is not None and math.isfinite(bs[i]) and bs[i] > max_b:
            max_b = bs[i]
    out = [0.0] * length
    if lo > hi:
        return out
    r = hi - lo
    cap = r + 2 * max_b

    def in_bound(i: int) -> float:
        b = bs[i] if bs is not None else 0.0
        return b if (not _isnan(b) and b < cap) else cap

    e = NAN
    seen = 0
    sum_b = 0.0
    for i in range(length):
        if not math.isfinite(vs[i]):
            if not _isnan(e) and bs is not None and bs[i] == INF:
                e = min(cap, (1 - alpha) * e + alpha * cap)
                out[i] = INF
            continue
        bi = in_bound(i)
        if _isnan(e):
            sum_b += bi
            seen += 1
            if seen < n:
                continue
            e = min(cap, r + 2 * max_b + sum_b / n)
        else:
            e = min(cap, (1 - alpha) * e + alpha * bi)
        out[i] = e
    return out


def _window_max(b: Optional[List[float]], span: int, length: int) -> Optional[List[float]]:
    if b is None:
        return None
    out = [0.0] * length

    def at(j: int) -> float:
        return INF if _isnan(b[j]) else b[j]
    q: deque = deque()
    for i in range(length):
        v = at(i)
        while q and at(q[-1]) <= v:
            q.pop()
        q.append(i)
        while q[0] <= i - span:
            q.popleft()
        out[i] = at(q[0])
    return out


def _window_sum(b: Optional[List[float]], span: int, length: int) -> Optional[List[float]]:
    if b is None:
        return None
    out = [0.0] * length
    s = 0.0
    inf = 0
    for i in range(length):
        if b[i] == INF:
            inf += 1
        else:
            s += b[i]
        if i - span >= 0:
            if b[i - span] == INF:
                inf -= 1
            else:
                s -= b[i - span]
        out[i] = INF if inf else s
    return out


def _window_any(flags: List[int], span: int, length: int) -> List[int]:
    out = [0] * length
    last = -INF
    for i in range(length):
        if flags[i]:
            last = i
        if i - last < span:
            out[i] = 1
    return out


def _quotient_bound(a: float, ea: float, b: float, eb: float) -> float:
    if not abs(b) > eb:
        return INF
    q = a / b
    m = 0.0
    for x in (a - ea, a + ea):
        for y in (b - eb, b + eb):
            m = max(m, abs(x / y - q))
    return m


def _monotone_bound(f: Callable[[float], float], v: float, b: float) -> float:
    y = f(v)
    lo = f(v - b)
    hi = f(v + b)
    if not math.isfinite(lo) or not math.isfinite(hi):
        return INF
    return max(abs(lo - y), abs(hi - y))


def _reads_any_binding(x: Any, binds: str) -> bool:
    stack = [x]
    seen = set()
    while stack:
        n = stack.pop()
        if not isinstance(n, dict) or id(n) in seen:
            continue
        seen.add(id(n))
        if n.get("type") == "series" and n.get("name") == binds:
            return True
        args = n.get("args")
        if isinstance(args, list):
            stack.extend(args)
    return False


class _Env:
    """The evaluation context the bound pass reads values through
    (``interpret.js::seedEnv``). Node values come from ONE evaluation of the
    tree with a value sink; a node it did not record is evaluated on its own."""

    def __init__(self, tree: Any, bars: List[dict], inputs, budget, scalars, opts) -> None:
        ai = _ai()
        self.bars = bars
        self.length = len(bars)
        self.inputs, self.budget, self.scalars = inputs, budget, scalars
        self.opts = dict(opts or {})
        self.eval_opts = dict(self.opts, seedWarmupSink=None, chartClockSink=None, seedValueSink=None)
        self.values: Dict[int, Any] = {}
        sink: Dict[int, Any] = {}
        self.root = ai._to_column(
            ai._interpret_column(tree, bars, inputs, budget, scalars, dict(self.eval_opts, seedValueSink=sink)),
            self.length)
        self.values.update(sink)
        self.values[id(tree)] = self.root
        self.reach: Dict[int, bool] = {}
        self.memo: Dict[int, Optional[List[float]]] = {}

    def value_of(self, node: Any) -> List[float]:
        ai = _ai()
        k = id(node)
        if k not in self.values:
            self.values[k] = ai._interpret_column(node, self.bars, self.inputs, self.budget,
                                                  self.scalars, self.eval_opts)
        return ai._to_column(self.values[k], self.length)

    def nested(self, n: dict):
        """``seedEnv.nested`` -- the child's env on ITS bars, and the alignment."""
        ai = _ai()
        kind = n.get("type")
        child = n["args"][0]
        if kind in ("tf", "tf_live"):
            code = str(n.get("value"))
            iso = [ai._iso_day(b.get("t")) for b in self.bars]
            keys = [(ai._tf_bucket(d, code) if d else None) for d in iso]
            at: Dict[Any, int] = {}
            for k in keys:
                if k is not None and k not in at:
                    at[k] = len(at)
            from api.services import bars_fetch  # noqa: PLC0415
            resample = (bars_fetch._resample_weekly_iso if code == "W"
                        else ai._resample_quarterly_iso if code == "3M"
                        else bars_fetch._resample_monthly_iso)
            htf = resample([dict(b, t=d) for b, d in zip(self.bars, iso) if d])
            sub = _Env(child, htf, self.inputs, self.budget, self.scalars, dict(self.opts, tf=code, heldSeedNested=True))
            live = kind == "tf_live"

            def align(i: int) -> Optional[int]:
                k = keys[i]
                if k is None:
                    return None
                b = at[k]
                return b if live else (b - 1 if b > 0 else None)
            return sub, align
        if kind == "sym":
            ticker = str(n.get("value")).strip().upper()
            series = ((self.opts.get("symbols") or {}).get(ticker))
            if not series:
                return None
            sub = _Env(child, series, self.inputs, self.budget, self.scalars, dict(self.opts, heldSeedNested=True))
            by_t: Dict[Any, int] = {}
            for j, b in enumerate(series):
                key = b.get("t") if isinstance(b, dict) else None
                if key is not None and not isinstance(key, bool) and key not in by_t:
                    by_t[key] = j

            def align_sym(i: int) -> Optional[int]:
                b = self.bars[i]
                key = b.get("t") if isinstance(b, dict) else None
                return by_t.get(key) if key is not None and not isinstance(key, bool) else None
            return sub, align_sym
        # ``ltf``: this lane is never supplied (``ast_interpret``'s arm answers NaN)
        return None


def _seed_bound_of(tree: Any, env: _Env) -> Optional[List[float]]:
    """``interpret.js::seedBoundOf`` -- ``|ours - TradingView's|`` per bar, or None
    where the tree carries no seed."""
    ai = _ai()
    length = env.length
    reach = env.reach
    memo = env.memo
    val = env.value_of
    accum_spec = ai.TABLE[ai.FUNCTIONS_SECTION]["accum"]["recurrence"]

    def bound(n: Any) -> Optional[List[float]]:
        if not isinstance(n, dict):
            return None
        if not _reaches(n, reach):
            return None
        k = id(n)
        if k in memo:
            return memo[k]
        # no ``except``: a node this pass cannot evaluate refuses exactly as the
        # evaluator would (the JS twin may hold no ``try`` -- ``budget.test.js``)
        b = bound_raw(n)
        v = val(n) if b is not None else None
        if b is not None and v is not None:
            for i in range(length):
                if _isnan(v[i]):
                    if b[i] != INF:
                        b[i] = 0.0
                elif _isnan(b[i]):
                    b[i] = INF
        memo[k] = b
        return b

    def generic(n: dict) -> Optional[List[float]]:
        args = n.get("args") if isinstance(n.get("args"), list) else []
        bs = [bound(a) for a in args]
        if all(b is None for b in bs):
            return None
        reach_bars = max(0, int(ai.max_lookback(n)))
        flags = [0] * length
        for a, b in zip(args, bs):
            if b is None:
                continue
            v = val(a)
            for i in range(length):
                if not _negligible(b[i], v[i]):
                    flags[i] = 1
        anyw = _window_any(flags, reach_bars + 1, length)
        return [INF if anyw[i] else 0.0 for i in range(length)]

    def decided(certain: Callable[[int], bool]) -> List[float]:
        return [0.0 if certain(i) else 1.0 for i in range(length)]

    def at(b: Optional[List[float]], i: int) -> float:
        return b[i] if b is not None else 0.0

    def compare_certain(va, ea, vb, eb, i) -> bool:
        a, b = va[i], vb[i]
        e = at(ea, i) + at(eb, i)
        if _isnan(a) or _isnan(b):
            return e != INF
        return _negligible(e, a, b) or abs(a - b) > e

    def truth_certain(v, e, i) -> bool:
        x = v[i]
        b = at(e, i)
        if _isnan(x):
            return b != INF
        return _negligible(b, x) or abs(x) > b

    def bound_raw(n: dict) -> Optional[List[float]]:
        args = n.get("args") if isinstance(n.get("args"), list) else []
        kind = n.get("type")
        if kind == "offset":
            k = ai._offset_bars(n)
            b = bound(args[0])
            if b is None:
                return None
            out = [0.0] * length
            for i in range(k, length):
                out[i] = b[i - k]
            return out
        if kind == "op":
            return op_bound(n, args)
        if kind == "call":
            return call_bound(n, args)
        if kind in _NESTED:
            return nested_bound(n)
        return generic(n)

    def op_bound(n: dict, args: list) -> Optional[List[float]]:
        name = n.get("name")
        if name == "?:":
            t, a, b = args
            bt, ba, bb = bound(t), bound(a), bound(b)
            if bt is None and ba is None and bb is None:
                return None
            vt, va, vb = val(t), val(a), val(b)
            out = [0.0] * length
            for i in range(length):
                x = vt[i]
                if _isnan(x):
                    if bt is not None and bt[i] == INF:
                        out[i] = INF
                    continue
                if truth_certain(vt, bt, i):
                    out[i] = at(ba, i) if x != 0 else at(bb, i)
                    continue
                p, q = va[i], vb[i]
                out[i] = INF if (_isnan(p) or _isnan(q)) else abs(p - q) + max(at(ba, i), at(bb, i))
            return out
        if name == "u-":
            return bound(args[0])
        if name == "!":
            b = bound(args[0])
            if b is None:
                return None
            v = val(args[0])
            return decided(lambda i: truth_certain(v, b, i))
        ba, bb = bound(args[0]), bound(args[1])
        if ba is None and bb is None:
            return None
        va, vb = val(args[0]), val(args[1])
        if name in ("+", "-"):
            return [at(ba, i) + at(bb, i) for i in range(length)]
        if name in ("*", "/"):
            out = [0.0] * length
            for i in range(length):
                ea, eb = at(ba, i), at(bb, i)
                if _isnan(va[i]) or _isnan(vb[i]):
                    out[i] = INF if (ea == INF or eb == INF) else 0.0
                    continue
                out[i] = (abs(va[i]) * eb + abs(vb[i]) * ea + ea * eb) if name == "*" \
                    else _quotient_bound(va[i], ea, vb[i], eb)
            return out
        if name in (">", "<", ">=", "<=", "==", "!="):
            return decided(lambda i: compare_certain(va, ba, vb, bb, i))
        if name in ("&&", "||"):
            want = 0 if name == "&&" else 1

            def c(i: int) -> bool:
                ca = truth_certain(va, ba, i)
                cb = truth_certain(vb, bb, i)
                if ca and cb:
                    return True
                if ca and not _isnan(va[i]) and (1 if va[i] != 0 else 0) == want:
                    return True
                if cb and not _isnan(vb[i]) and (1 if vb[i] != 0 else 0) == want:
                    return True
                return False
            return decided(c)
        return generic(n)

    def call_bound(n: dict, args: list) -> Optional[List[float]]:
        name = n.get("name")
        wl = ai._window_literal
        if name in ("ema", "rma"):
            ln = wl(n, 1)
            alpha = 2 / (ln + 1) if name == "ema" else 1 / ln
            return _smoother_seed_bound(val(args[0]), bound(args[0]), ln, alpha, length)
        if name == "rsi":
            return rsi_bound(val(args[0]), bound(args[0]), wl(n, 1))
        if name == "macd":
            fast, slow = wl(n, 1), wl(n, 2)
            s = val(args[0])
            b = bound(args[0])
            start = ai._finite_tail_start([s], length)
            tail = s[start:]
            bt = b[start:] if b is not None else None
            ef = _smoother_seed_bound(tail, bt, fast, 2 / (fast + 1), length - start)
            es = _smoother_seed_bound(tail, bt, slow, 2 / (slow + 1), length - start)
            out = [0.0] * length
            for i in range(start, length):
                out[i] = ef[i - start] + es[i - start]
            return out
        if name in ("atrPine", "atr"):
            h, l, c = (val(a) for a in args[:3])  # noqa: E741
            bh, bl, bc = (bound(a) for a in args[:3])
            ln = wl(n, 3)
            tr = ai._true_range_true(h, l, c) if name == "atrPine" else _house_true_range(h, l, c)
            bt = None
            if bh is not None or bl is not None or bc is not None:
                bt = [0.0] * length
                for i in range(length):
                    rng = at(bh, i) + at(bl, i)
                    prev = c[i - 1] if i > 0 else NAN
                    bt[i] = rng if _isnan(prev) else max(rng, at(bh, i) + at(bc, i - 1), at(bl, i) + at(bc, i - 1))
            if name == "atr":
                start = ai._finite_tail_start([h, l, c], length)
                sub = _smoother_seed_bound(tr[start:], bt[start:] if bt is not None else None, ln, 1 / ln,
                                           length - start)
                return [0.0] * start + sub
            return _smoother_seed_bound(tr, bt, ln, 1 / ln, length)
        if name in ("adx", "plusDI", "minusDI"):
            if any(bound(a) is not None for a in args[:3]):
                return generic(n)
            return dmi_bound([val(a) for a in args[:3]], wl(n, 3))[name]
        if name == "stoch":
            bs = [bound(a) for a in args[:3]]
            if all(b is None for b in bs):
                return None
            return stoch_bound([val(a) for a in args[:3]], bs, wl(n, 3))
        if name in _WINDOW_MAX:
            b = bound(args[0])
            if b is None:
                return None
            m = _window_max(b, wl(n, 1), length)
            k = _WINDOW_MAX[name]
            return m if k == 1 else [x * k for x in m]
        if name == "sum":
            return _window_sum(bound(args[0]), wl(n, 1), length)
        if name == "hma":
            b = bound(args[0])
            if b is None:
                return None
            ln = wl(n, 1)
            root = max(1, _js_round(math.sqrt(ln)))
            return [x * 3 for x in _window_max(b, ln + root - 1, length)]
        if name == "change":
            b = bound(args[0])
            if b is None:
                return None
            out = [0.0] * length
            for i in range(1, length):
                out[i] = b[i] + b[i - 1]
            return out
        if name in _LIPSCHITZ_ONE:
            return bound(args[0])
        if name in ("min", "max"):
            ba, bb = bound(args[0]), bound(args[1])
            if ba is None and bb is None:
                return None
            return [max(at(ba, i), at(bb, i)) for i in range(length)]
        if name == "nz":
            ba, bb = bound(args[0]), bound(args[1])
            if ba is None and bb is None:
                return None
            va = val(args[0])
            out = [0.0] * length
            for i in range(length):
                if _isnan(va[i]):
                    out[i] = INF if (ba is not None and ba[i] == INF) else at(bb, i)
                else:
                    out[i] = at(ba, i)
            return out
        if name == "na":
            return None
        if name in _MONOTONE:
            b = bound(args[0])
            if b is None:
                return None
            v = val(args[0])
            f = _MONOTONE[name]()
            out = [0.0] * length
            for i in range(length):
                if not _isnan(v[i]):
                    out[i] = 0.0 if b[i] == 0 else _monotone_bound(f, v[i], b[i])
            return out
        if name in _STEP:
            b = bound(args[0])
            if b is None:
                return None
            v = val(args[0])
            f = _STEP[name]()
            return decided(lambda i: _isnan(v[i]) or b[i] == 0 or _same(f(v[i] - b[i]), f(v[i] + b[i])))
        if name == "pow":
            ba, bb = bound(args[0]), bound(args[1])
            if ba is None and bb is None:
                return None
            if bb is not None:
                return generic(n)
            va, vb = val(args[0]), val(args[1])
            pw = ai._guarded_pow
            out = [0.0] * length
            for i in range(length):
                if _isnan(va[i]) or _isnan(vb[i]) or ba[i] == 0:
                    continue
                y = pw(va[i], vb[i])
                pts = [va[i] - ba[i], va[i] + ba[i]]
                if va[i] - ba[i] < 0 < va[i] + ba[i]:
                    pts.append(0.0)
                m = 0.0
                for x in pts:
                    z = pw(x, vb[i])
                    m = max(m, abs(z - y)) if math.isfinite(z) else INF
                out[i] = m
            return out
        if name in ("crossOver", "crossUnder"):
            ba, bb = bound(args[0]), bound(args[1])
            if ba is None and bb is None:
                return None
            va, vb = val(args[0]), val(args[1])
            return decided(lambda i: compare_certain(va, ba, vb, bb, i)
                           and (i == 0 or compare_certain(va, ba, vb, bb, i - 1)))
        if name == "cum":
            b = bound(args[0])
            if b is None:
                return None
            out = [0.0] * length
            s = 0.0
            for i in range(length):
                if not _isnan(b[i]):
                    s += b[i]
                out[i] = s
            return out
        if name == "accum":
            return accum_bound(n)
        return generic(n)

    def rsi_bound(s: List[float], b: Optional[List[float]], ln: int) -> Optional[List[float]]:
        out = [0.0] * length
        start = ai._finite_tail_start([s], length)
        if length - start < ln + 1:
            return out if b is not None else None
        gains = [NAN] * length
        losses = [NAN] * length
        bd = [0.0] * length
        for i in range(start + 1, length):
            d = s[i] - s[i - 1]
            if not math.isfinite(d):
                continue
            gains[i] = d if d > 0 else 0.0
            losses[i] = -d if d < 0 else 0.0
            bd[i] = (b[i] + b[i - 1]) if b is not None else 0.0
        eg = _smoother_seed_bound(gains, bd, ln, 1 / ln, length)
        el = _smoother_seed_bound(losses, bd, ln, 1 / ln, length)

        def rsi_of(g: float, lo: float) -> float:
            if lo <= 0:
                return 100.0
            if g <= 0:
                return 0.0
            return 100 - 100 / (1 + g / lo)
        g = lo_ = NAN
        seen = 0
        sg = sl = 0.0
        for i in range(start + 1, length):
            if not math.isfinite(gains[i]):
                continue
            if _isnan(g):
                sg += gains[i]
                sl += losses[i]
                seen += 1
                if seen < ln:
                    continue
                g, lo_ = sg / ln, sl / ln
            else:
                g = (g * (ln - 1) + gains[i]) / ln
                lo_ = (lo_ * (ln - 1) + losses[i]) / ln
            r = rsi_of(g, lo_)
            hi_r = rsi_of(g + eg[i], max(0.0, lo_ - el[i]))
            lo_r = rsi_of(max(0.0, g - eg[i]), lo_ + el[i])
            out[i] = max(abs(hi_r - r), abs(lo_r - r))
        return out

    def dmi_bound(cols: List[List[float]], ln: int) -> Dict[str, List[float]]:
        h, l, c = cols  # noqa: E741
        res = {"adx": [0.0] * length, "plusDI": [0.0] * length, "minusDI": [0.0] * length}
        start = ai._finite_tail_start([h, l, c], length)
        if length - start < 2 * ln:
            return res
        pdm = [NAN] * length
        mdm = [NAN] * length
        trs = [NAN] * length
        for i in range(start + 1, length):
            up = h[i] - h[i - 1]
            down = l[i - 1] - l[i]
            tr = max(h[i] - l[i], abs(h[i] - c[i - 1]), abs(l[i] - c[i - 1]))
            if not (math.isfinite(up) and math.isfinite(down) and math.isfinite(tr)):
                continue
            pdm[i] = up if (up > down and up > 0) else 0.0
            mdm[i] = down if (down > up and down > 0) else 0.0
            trs[i] = tr

        def rng(col: List[float]) -> float:
            fin = [x for x in col if math.isfinite(x)]
            return (max(fin) - min(fin)) if fin else 0.0
        rp, rm, rt = rng(pdm) * ln, rng(mdm) * ln, rng(trs) * ln
        decay = 1 - 1 / ln
        sp = sm = st = 0.0
        seen = 0
        ready = False
        ep = em = et = 0.0
        dx = [NAN] * length
        edx = [0.0] * length
        for i in range(start + 1, length):
            if not math.isfinite(trs[i]):
                continue
            if not ready:
                sp += pdm[i]
                sm += mdm[i]
                st += trs[i]
                seen += 1
                if seen < ln:
                    continue
                ready = True
                ep, em, et = rp, rm, rt
            else:
                sp = sp - sp / ln + pdm[i]
                sm = sm - sm / ln + mdm[i]
                st = st - st / ln + trs[i]
                ep *= decay
                em *= decay
                et *= decay
            pdi = 0.0 if st == 0 else 100 * sp / st
            mdi = 0.0 if st == 0 else 100 * sm / st
            pq = _quotient_bound(100 * sp, 100 * ep, st, et) if st - et > 0 else INF
            mq = _quotient_bound(100 * sm, 100 * em, st, et) if st - et > 0 else INF
            res["plusDI"][i] = pq
            res["minusDI"][i] = mq
            ssum = pdi + mdi
            dx[i] = 0.0 if ssum == 0 else 100 * abs(pdi - mdi) / ssum
            if pq == INF or mq == INF:
                edx[i] = INF
                continue
            p_lo, p_hi = max(0.0, pdi - pq), pdi + pq
            m_lo, m_hi = max(0.0, mdi - mq), mdi + mq
            if p_lo + m_lo <= 0:
                edx[i] = INF
                continue

            def f(p: float, m: float) -> float:
                return 100 * abs(p - m) / (p + m)
            top = max(f(p_hi, m_lo), f(p_lo, m_hi))
            bottom = 0.0 if (p_lo <= m_hi and m_lo <= p_hi) else min(f(p_lo, m_hi), f(p_hi, m_lo))
            edx[i] = max(abs(top - dx[i]), abs(dx[i] - bottom))
        res["adx"] = _smoother_seed_bound(dx, edx, ln, 1 / ln, length)
        return res

    def stoch_bound(cols: List[List[float]], bs: list, ln: int) -> List[float]:
        h, l, c = cols  # noqa: E741
        bh, bl, bc = bs
        start = ai._finite_tail_start([h, l, c], length)
        out = [0.0] * length
        mh = _window_max(bh if bh is not None else [0.0] * length, ln, length)
        ml = _window_max(bl if bl is not None else [0.0] * length, ln, length)
        for i in range(start + ln - 1, length):
            lo = min(l[i - ln + 1:i + 1])
            hi = max(h[i - ln + 1:i + 1])
            ec = at(bc, i)
            out[i] = _quotient_bound(100 * (c[i] - lo), 100 * (ec + ml[i]), hi - lo, mh[i] + ml[i])
        return out

    def accum_bound(n: dict) -> Optional[List[float]]:
        w = ai._window_literal(n, accum_spec["warmup"])
        binds = accum_spec["binds"]
        inputs: List[Any] = []
        extra = [0]

        def collect(x: Any, depth: int) -> None:
            # the DEEPEST nesting chain, never once per inlined copy (JS twin)
            if not isinstance(x, dict):
                return
            if not _reads_any_binding(x, binds):
                inputs.append(x)
                extra[0] = max(extra[0], depth)
                return
            d = depth
            if x is not n and x.get("type") == "call" and x.get("name") in ai.RECURRENCES:
                d = depth + ai._window_literal(x, accum_spec["warmup"])
            extra[0] = max(extra[0], d)
            args = x.get("args")
            if isinstance(args, list):
                for a in args:
                    collect(a, d)
        collect(n["args"][accum_spec["body"]], 0)
        collect(n["args"][accum_spec["seed"]], 0)
        flags = [0] * length
        anyf = False
        for x in inputs:
            b = bound(x)
            if b is None:
                continue
            v = val(x)
            for i in range(length):
                if not _negligible(b[i], v[i]):
                    flags[i] = 1
                    anyf = True
        if not anyf:
            return None
        wa = _window_any(flags, w + extra[0] + 1, length)
        return [INF if wa[i] else 0.0 for i in range(length)]

    def nested_bound(n: dict) -> Optional[List[float]]:
        got = env.nested(n)
        if got is None:
            return None
        sub, align = got
        cb = _seed_bound_of(n["args"][0], sub)
        if cb is None:
            return None
        out = [0.0] * length
        for i in range(length):
            j = align(i)
            out[i] = 0.0 if j is None or j < 0 else cb[j]
        return out

    return bound(tree)


def _js_round(x: float) -> int:
    """``Math.round`` (half toward +inf) -- what ``FN.hma`` uses for its root."""
    return int(math.floor(x + 0.5))


def _same(a: float, b: float) -> bool:
    return a == b or (_isnan(a) and _isnan(b))


def _house_true_range(h: List[float], l: List[float], c: List[float]) -> List[float]:  # noqa: E741
    """``interpret.js::houseTrueRange`` -- ``computeATR``'s true range, none on bar 0."""
    out = [NAN] * len(c)
    for i in range(1, len(c)):
        vals = (h[i] - l[i], abs(h[i] - c[i - 1]), abs(l[i] - c[i - 1]))
        out[i] = NAN if any(_isnan(x) for x in vals) else max(vals)
    return out


_MONOTONE: Dict[str, Callable[[], Callable[[float], float]]] = {
    "sqrt": lambda: _ai()._guarded_sqrt, "ln": lambda: _ai()._guarded_ln,
    "log10": lambda: _ai()._guarded_log10, "exp": lambda: _ai()._guarded_exp,
    "atan": lambda: _ai()._guarded_atan, "sinh": lambda: _ai()._guarded_sinh,
}
_STEP: Dict[str, Callable[[], Callable[[float], float]]] = {
    "sign": lambda: _ai()._guarded_sign, "round": lambda: _ai()._guarded_round,
    "floor": lambda: _ai()._guarded_floor, "ceil": lambda: _ai()._guarded_ceil,
}


def seed_warmup_mask(tree: Any, bars: List[dict],
                     inputs: Optional[Mapping[str, Any]] = None,
                     budget: Optional[Mapping[str, Any]] = None,
                     scalars: Optional[Mapping[str, Any]] = None,
                     opts: Optional[Mapping[str, Any]] = None,
                     raw: Optional[List[float]] = None) -> Optional[List[int]]:
    """``interpret.js::seedWarmupMask`` -- the bars of a tree withheld for a seed
    this window does not hold (1 = withheld), or None when none is. ``raw`` is
    the tree's own column after the earlier withholdings, when the caller holds
    it. Names ``seed:window`` and fills ``opts["seedWarmupSink"]`` (a dict) with
    ``mask`` / ``bound`` / ``raw``."""
    if not seed_from_window_of(opts):
        return None
    n = len(bars) if isinstance(bars, list) else 0
    if not n:
        return None
    if not _reaches(tree, {}):
        return None
    env = _Env(tree, bars, inputs, budget, scalars, opts)
    computed = env.root
    value = list(raw) if raw is not None else computed
    bound = _seed_bound_of(tree, env)
    if bound is None:
        return None
    mask = [0] * n
    held = False
    for i in range(n):
        v = value[i]
        if _isnan(v):
            if bound[i] == INF and _isnan(computed[i]):
                mask[i] = 1
                held = True
            continue
        b = bound[i]
        if not (b < 0.5 * max(SEED_WARMUP_ABS, SEED_WARMUP_REL * max(0.0, abs(v) - b))):
            mask[i] = 1
            held = True
    if not held:
        return None
    _ai()._name_chart_clock(opts, [SEED_WARMUP_CODE])
    sink = (opts or {}).get("seedWarmupSink")
    if isinstance(sink, dict):
        sink["mask"] = mask
        sink["bound"] = bound
        sink["raw"] = value
    return mask
