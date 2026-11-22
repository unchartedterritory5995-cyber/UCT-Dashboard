"""FCTX, the pure half: how one stock trades against six style factors, from stored daily closes. No
I/O, no clock, no store: lists in, dicts out. `api/services/factor_exposure.py` reads the closes and
holds the answers.

THE FACTORS are daily return spreads of funds (a positive spread is a day the first fund did better):

  market            SPY                                    (alternative IVV)
  size              IWM minus the market fund               (alternative VTWO): positive = small caps
  growth vs value   IWF minus IWD                           (alternative VUG minus VTV, the pair
                                                             together, never one index family's
                                                             growth against another's value):
                                                             positive = growth
  momentum          MTUM minus the market fund              (alternative SPMO)
  quality           QUAL minus the market fund              (alternative SPHQ)
  low volatility    USMV minus the market fund              (alternative SPLV)

"The market fund" is SPY, or IVV where IVV stood in for it. An alternative is used only when the first
fund is not held with enough history (`fund_check`); a factor neither is held for is left out of the
model and the answer says so.

THE REGRESSION (ordinary least squares, one per window):

  r_stock(t) = a + b1 market(t) + b2 size(t) + b3 growth(t) + b4 momentum(t) + b5 quality(t)
               + b6 lowvol(t) + e(t)

  returns      simple daily returns c(t) / c(t-1) - 1 on the sessions the stock AND every fund in the
               model traded: STAT's alignment (`fundamentals_pit.beta.aligned_returns`) over the
               sessions all of them hold, so a return spans two consecutive common sessions and a day
               missing on any side never fabricates a zero return. Price returns: split-adjusted, not
               dividend-adjusted.
  window       the newest `WINDOW` (252, `beta.WINDOW`) such returns, at least `MIN_OBS` (200,
               `beta.MIN_OBS`); "a year earlier" is the 252 returns before those (at least 200), so
               the two windows never share a day.
  solved       a QR factorisation of the design matrix (a column of ones, then the factors); a matrix
               whose columns are (nearly) dependent is `singular`, never a guess.
  t            each coefficient over its standard error sqrt(s2 x diag((X'X)^-1)), s2 = RSS / (n - k - 1).
  R-squared    1 - RSS / TSS: the share of the stock's daily variance the factors explain; 1 - R-squared
               is its own (idiosyncratic) share. Adjusted R-squared: 1 - (1 - R2) (n - 1) / (n - k - 1).
  volatility   the sample standard deviation (n - 1) of the stock's returns, of the fitted part and of
               the residuals, each x sqrt(252) (`realized_vol.TRADING_DAYS`).
  constant     the intercept a: percent a day, and x 252 a year, with its t.
  correlation  each factor's simple (Pearson) correlation with the stock over the same returns.
  beta alone   the stock's beta to the market factor by itself (cov / var), for comparison with the
               multi-factor market loading, which holds the style spreads fixed.
  VIF          each factor's variance inflation factor: the diagonal of the inverse of the factors'
               correlation matrix, equal to 1 / (1 - R2) of that factor regressed on the others. The
               spreads share the market and each other, so this is real: above `VIF_UNSTABLE` (5) the
               loadings are unstable (a small change in the data can move them a lot).
  change       now minus a year earlier, with t = change / sqrt(se_now^2 + se_then^2) (the windows do
               not overlap).
  market vs 1  the market loading's own t against 1: (b1 - 1) / se.

THE PLAIN LINE is derived mechanically, ONLY from loadings whose |t| is above `T_BAR` (2): a style
adjective for each style loading that clears it (`STYLE_WORDS`), and for the market loading (when it
clears against 0) more, less or about the S&P 500's sensitivity by its t against 1. A loading under the
bar never enters the line; the line names those as too uncertain to read. These numbers describe how
the stock traded over the window; they are not a forecast.
"""
from __future__ import annotations

import math
from datetime import date
from typing import Optional

import numpy as np

from api.services.fundamentals_pit import beta as BETA
from api.services.realized_vol import TRADING_DAYS
from api.services.stock_stats_calc import MAX_GAP_DAYS, pct

#: returns in a window (the declared Beta methodology's year)
WINDOW = BETA.WINDOW
#: the fewest returns a window is fitted on
MIN_OBS = BETA.MIN_OBS
#: a loading enters the plain line only when |t| is above this
T_BAR = 2.0
#: above this the largest variance inflation factor says the loadings are unstable
VIF_UNSTABLE = 5.0
#: closes a fund needs (one window at the minimum) to be used at all
FUND_MIN_CLOSES = MIN_OBS + 1
#: closes a fund needs for both windows
FUND_FULL_CLOSES = 2 * WINDOW + 1
INDEX_NAME = "S&P 500"
#: a design matrix whose smallest pivot is under this share of its largest is singular
_SINGULAR = 1e-10
#: a fit whose residual sum of squares is under this share of the total is exact (the stock is a fund
#: of the model, or built from them): no t can be worked out
_EXACT = 1e-12

#: the factors, in the order the answer lists them. `options` are tried in turn; every fund of an
#: option must be usable. `less_market`: the spread is the fund minus the market fund in use.
FACTORS = (
    {"key": "market", "name": "Market", "options": (("SPY",), ("IVV",)), "less_market": False,
     "positive": "moves with the market", "negative": "moves against the market"},
    {"key": "size", "name": "Size", "options": (("IWM",), ("VTWO",)), "less_market": True,
     "positive": "small caps", "negative": "large caps"},
    {"key": "growth", "name": "Growth vs value", "options": (("IWF", "IWD"), ("VUG", "VTV")), "less_market": False,
     "positive": "growth", "negative": "value"},
    {"key": "momentum", "name": "Momentum", "options": (("MTUM",), ("SPMO",)), "less_market": True,
     "positive": "recent winners", "negative": "recent losers"},
    {"key": "quality", "name": "Quality", "options": (("QUAL",), ("SPHQ",)), "less_market": True,
     "positive": "high quality", "negative": "low quality"},
    {"key": "lowvol", "name": "Low volatility", "options": (("USMV",), ("SPLV",)), "less_market": True,
     "positive": "low volatility", "negative": "high volatility"},
)
FACTOR_KEYS = tuple(f["key"] for f in FACTORS)
BY_KEY = {f["key"]: f for f in FACTORS}

#: (positive, negative) adjective of each style loading that clears the bar
STYLE_WORDS = {
    "momentum": ("high-momentum", "low-momentum"),
    "quality": ("high-quality", "lower-quality"),
    "lowvol": ("low-volatility", "high-volatility"),
    "size": ("small-cap", "large-cap"),
    "growth": ("growth", "value"),
}
#: the adjectives that come first (joined with commas), then the two that sit next to "stock"
_LEAD = ("momentum", "quality", "lowvol")
_NOUN = ("size", "growth")
#: the market clause, by the market loading's side
_WITH = {
    "more": f"with more market sensitivity than the {INDEX_NAME}",
    "less": f"with less market sensitivity than the {INDEX_NAME}",
    "same": f"with about the {INDEX_NAME}'s market sensitivity",
}


def clears(t: Optional[float]) -> bool:
    """Whether a t-statistic is above the bar: |t| > `T_BAR`, strictly (2.0 itself does not clear);
    a missing or non-finite t never does."""
    return t is not None and math.isfinite(t) and abs(t) > T_BAR


def _r(x, nd: int) -> Optional[float]:
    """A finite number rounded, or None."""
    if x is None:
        return None
    x = float(x)
    return round(x, nd) if math.isfinite(x) else None


# ── the funds ──────────────────────────────────────────────────────────────────────────────────

def fund_check(closes: list, key: str, read_state: str = "ok") -> dict:
    """Whether a fund's settled closes (ascending, up to session `key`) can carry a factor:
    `ok` (at least `FUND_MIN_CLOSES`, the newest within `MAX_GAP_DAYS` calendar days of `key`),
    `short`, `stale`, `not_held` or `unavailable` (the read failed: `read_state`)."""
    if read_state != "ok":
        return {"state": "not_held" if read_state == "not_held" else "unavailable", "closes": 0}
    n = len(closes)
    if not n:
        return {"state": "not_held", "closes": 0}
    first, last = closes[0][0], closes[-1][0]
    out = {"closes": n, "first": first, "last": last, "full": n >= FUND_FULL_CLOSES}
    if (date.fromisoformat(key) - date.fromisoformat(last)).days > MAX_GAP_DAYS:
        return {**out, "state": "stale"}
    if n < FUND_MIN_CLOSES:
        return {**out, "state": "short", "needed": FUND_MIN_CLOSES}
    return {**out, "state": "ok"}


def legs_of(chosen: dict) -> Optional[list]:
    """`[(key, long fund, short fund or None)]` in FACTORS order for the factors with funds chosen
    (`chosen`: factor key -> the option used). None when the market has no fund."""
    market = chosen.get("market")
    if not market:
        return None
    out = []
    for f in FACTORS:
        opt = chosen.get(f["key"])
        if not opt:
            continue
        if f["key"] == "market":
            out.append(("market", opt[0], None))
        elif len(opt) == 2:
            out.append((f["key"], opt[0], opt[1]))
        else:
            out.append((f["key"], opt[0], market[0] if f["less_market"] else None))
    return out


def align(stock: list, series: dict, legs: list) -> tuple[list, np.ndarray, np.ndarray, list]:
    """`(dates, y, F, keys)`: the stock's daily returns `y` and the factor returns `F` (one column per
    leg) on the sessions the stock and every fund of the model hold, through `beta.aligned_returns`
    over those common sessions (a return spans two consecutive common sessions)."""
    syms = sorted({s for _k, a, b in legs for s in (a, b) if s})
    common = {d for d, _c in stock}
    for s in syms:
        common &= {d for d, _c in series[s]}
    st = [(d, c) for d, c in stock if d in common]
    base: Optional[list] = None
    by_fund: dict = {}
    for s in syms:
        al = BETA.aligned_returns(st, [(d, c) for d, c in series[s] if d in common])
        by_fund[s] = {d: rb for d, _rs, rb in al}
        if base is None:
            base = [(d, rs) for d, rs, _rb in al]
    rows = [(d, rs) for d, rs in base or () if all(d in by_fund[s] for s in syms)]
    dates = [d for d, _rs in rows]
    y = np.array([rs for _d, rs in rows], dtype=float)
    cols = []
    for _k, a, b in legs:
        ra = by_fund[a]
        cols.append([ra[d] - by_fund[b][d] if b else ra[d] for d in dates])
    f = np.array(cols, dtype=float).T if cols else np.zeros((len(dates), 0))
    return dates, y, f.reshape(len(dates), len(legs)), [k for k, _a, _b in legs]


# ── one window ─────────────────────────────────────────────────────────────────────────────────

def fit(dates: list, y: np.ndarray, f: np.ndarray, keys: list, jumps: tuple = ()) -> tuple[dict, Optional[dict]]:
    """`(block, raw)` for one window: the answer's block, and the unrounded coefficients and standard
    errors (`{key: (b, se)}`, None when there are none) the change between windows is worked from."""
    n = len(y)
    span = {"returns": n, "from": dates[0] if n else None, "to": dates[-1] if n else None}
    if n < MIN_OBS:
        return {"state": "short", "needed": MIN_OBS, "held": n, "unit": "returns"}, None
    k = len(keys)
    x = np.column_stack((np.ones(n), f))
    q, rr = np.linalg.qr(x)
    piv = np.abs(np.diag(rr))
    if not np.all(np.isfinite(rr)) or piv.min() <= piv.max() * _SINGULAR:
        return {"state": "singular", **span}, None
    rinv = np.linalg.solve(rr, np.eye(k + 1))
    coef = rinv @ (q.T @ y)
    fitted = x @ coef
    resid = y - fitted
    rss = float(resid @ resid)
    yc = y - y.mean()
    tss = float(yc @ yc)
    dof = n - k - 1
    exact = tss <= 0.0 or rss <= tss * _EXACT
    diag = np.einsum("ij,ij->i", rinv, rinv)
    se = np.sqrt(diag * (rss / dof)) if not exact else np.full(k + 1, np.nan)
    with np.errstate(divide="ignore", invalid="ignore"):
        t = coef / se

    corr = []
    for j in range(k):
        col = f[:, j]
        sd_c = float(col.std())
        corr.append(float(np.corrcoef(y, col)[0, 1]) if sd_c > 0 and float(y.std()) > 0 else None)
    if k == 1:
        vif = [1.0]
    else:
        cm = np.corrcoef(f, rowvar=False)
        try:
            vif = [float(v) for v in np.diag(np.linalg.inv(cm))]
        except np.linalg.LinAlgError:
            return {"state": "singular", **span}, None

    rows = []
    for j, key in enumerate(keys):
        b, s, tj = float(coef[j + 1]), float(se[j + 1]), float(t[j + 1])
        row = {"key": key, "loading": _r(b, 3), "se": _r(s, 3), "t": _r(tj, 2),
               "clears": clears(tj),
               "correlation": _r(corr[j], 3), "vif": _r(vif[j], 2)}
        if key == "market":
            t1 = (b - 1.0) / s if math.isfinite(s) and s > 0 else float("nan")
            row["t_vs_one"] = _r(t1, 2)
            row["side"] = market_side(b, tj, t1)
        rows.append(row)

    mkt = keys.index("market") if "market" in keys else None
    beta_alone = None
    if mkt is not None:
        m = f[:, mkt]
        var_m = float(m.var(ddof=1))
        beta_alone = _r(float(np.cov(y, m, ddof=1)[0, 1]) / var_m, 3) if var_m > 0 else None
    r2v = 1.0 - rss / tss if tss > 0 else None
    adj = 1.0 - (1.0 - r2v) * (n - 1) / dof if r2v is not None and dof > 0 else None
    ann = math.sqrt(TRADING_DAYS)
    top = max(range(k), key=lambda j: (vif[j], -j))
    a, sa, ta = float(coef[0]), float(se[0]), float(t[0])
    block = {
        "state": "ok", **span, "full": n >= WINDOW, "exact": exact,
        "loadings": rows,
        "constant": {"daily_pct": pct(a, 3), "yearly_pct": pct(a * TRADING_DAYS, 1), "t": _r(ta, 2),
                     "clears": clears(ta)},
        "r2": _r(r2v, 3), "adj_r2": _r(adj, 3),
        "explained_pct": pct(r2v, 1) if r2v is not None else None,
        "own_pct": pct(1.0 - r2v, 1) if r2v is not None else None,
        "volatility": {"total_pct": pct(float(y.std(ddof=1)) * ann, 1),
                       "factors_pct": pct(float(fitted.std(ddof=1)) * ann, 1),
                       "own_pct": pct(float(resid.std(ddof=1)) * ann, 1)},
        "market_beta_alone": beta_alone,
        "max_vif": {"key": keys[top], "value": _r(vif[top], 2)},
        "unstable": bool(vif[top] > VIF_UNSTABLE),
        "check": [j for j in jumps if span["from"] <= j <= span["to"]],
    }
    raw = None if exact else {key: (float(coef[j + 1]), float(se[j + 1])) for j, key in enumerate(keys)}
    return block, raw


def market_side(b: float, t: float, t_vs_one: float) -> Optional[str]:
    """`more` | `less` | `same` | `against`, or None when the market loading does not clear the bar."""
    if not clears(t):
        return None
    if b < 0:
        return "against"
    if clears(t_vs_one):
        return "more" if t_vs_one > 0 else "less"
    return "same"


def changes(now_raw: Optional[dict], then_raw: Optional[dict]) -> Optional[list]:
    """Each loading now minus a year earlier, with its t over the two standard errors; None unless
    both windows were fitted."""
    if not now_raw or not then_raw:
        return None
    out = []
    for key in FACTOR_KEYS:
        if key not in now_raw or key not in then_raw:
            continue
        (b1, s1), (b0, s0) = now_raw[key], then_raw[key]
        d = b1 - b0
        den = math.sqrt(s1 * s1 + s0 * s0)
        t = d / den if den > 0 else float("nan")
        out.append({"key": key, "change": _r(d, 3), "t": _r(t, 2), "clears": clears(t)})
    return out


# ── the plain line ─────────────────────────────────────────────────────────────────────────────

def reading(sym: str, block: dict) -> Optional[dict]:
    """The one-line reading of a fitted window (see the module docstring), or None when the window
    was not fitted. `basis` lists the loadings the line is built from; `uncertain` those under the bar."""
    if not block or block.get("state") != "ok":
        return None
    rows = {r["key"]: r for r in block["loadings"]}
    if block.get("exact"):
        return {"text": (f"{sym} moves exactly with the factor funds (it is one of them, or built from them), "
                         "so no loading can be tested and no reading is given."),
                "basis": [], "uncertain": list(rows), "exact": True}
    basis, uncertain = [], []
    for key in FACTOR_KEYS:
        r = rows.get(key)
        if r is None:
            continue
        if r["clears"]:
            side = r.get("side") if key == "market" else ("positive" if (r["loading"] or 0) > 0 else "negative")
            basis.append({"key": key, "side": side, "loading": r["loading"], "t": r["t"]})
        else:
            uncertain.append(key)
    words = {b["key"]: STYLE_WORDS[b["key"]][0 if b["side"] == "positive" else 1] for b in basis if b["key"] in STYLE_WORDS}
    lead = [words[k] for k in _LEAD if k in words]
    noun = [words[k] for k in _NOUN if k in words]
    adj = ", ".join(lead) + (" " if lead and noun else "") + " ".join(noun)
    side = next((b["side"] for b in basis if b["key"] == "market"), None)
    if adj:
        art = "an" if adj[0] in "aeiou" else "a"
        if side == "against":
            text = f"{sym} trades like {art} {adj} stock that tends to move against the {INDEX_NAME}."
        elif side:
            text = f"{sym} trades like {art} {adj} stock {_WITH[side]}."
        else:
            text = f"{sym} trades like {art} {adj} stock; its market loading does not clear the bar."
    elif side == "against":
        text = f"{sym} shows no style tilt that clears the bar; it tends to move against the {INDEX_NAME}."
    elif side:
        text = f"{sym} shows no style tilt that clears the bar; it trades {_WITH[side]}."
    else:
        text = f"No loading clears the bar, so the factors cannot say how {sym} trades."
    return {"text": text, "basis": basis, "uncertain": uncertain, "exact": False}


# ── the whole answer's maths ───────────────────────────────────────────────────────────────────

def exposure(stock: list, series: dict, legs: list, sym: str, jumps: tuple = ()) -> dict:
    """The regression sections of one stock's answer: `now`, `then`, `change`, `reading` and
    `reading_then` (see the module docstring). `stock`: ascending settled `[(date, close)]`;
    `series`: fund -> ascending `[(date, close)]`; `legs`: `legs_of(...)`."""
    dates, y, f, keys = align(stock, series, legs)
    n = len(y)
    now_block, now_raw = fit(dates[-WINDOW:], y[-WINDOW:], f[-WINDOW:], keys, jumps)
    if n > WINDOW:
        lo = max(0, n - 2 * WINDOW)
        then_block, then_raw = fit(dates[lo:n - WINDOW], y[lo:n - WINDOW], f[lo:n - WINDOW], keys, jumps)
    else:
        then_block, then_raw = {"state": "short", "needed": MIN_OBS, "held": 0, "unit": "returns"}, None
    return {
        "common_returns": n, "common_from": dates[0] if n else None, "common_to": dates[-1] if n else None,
        "now": now_block, "then": then_block, "change": changes(now_raw, then_raw),
        "reading": reading(sym, now_block), "reading_then": reading(sym, then_block),
    }


def method() -> dict:
    """The rules of the answer, in numbers, for the panel's method note."""
    return {"window": WINDOW, "min": MIN_OBS, "t_bar": T_BAR, "vif_unstable": VIF_UNSTABLE,
            "fund_min_closes": FUND_MIN_CLOSES, "fund_full_closes": FUND_FULL_CLOSES, "index": INDEX_NAME,
            "annualise_days": TRADING_DAYS, "max_lag_days": MAX_GAP_DAYS}

