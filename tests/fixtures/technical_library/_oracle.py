"""Independent numerical oracle for the Technical library's Tier 1 (2026-10-01).

WHAT THIS IS
    A reference implementation of every Tier 1 study, written in NumPy from each
    study's PUBLISHED definition and the UCT conventions recorded in
    `docs/decisions/2026-10-01-technical-library-tier1.md` — NOT a port of the
    JavaScript. Where TA-Lib implements the SAME convention, its value is used as a
    SECOND reference and the two references are asserted to agree here before
    anything is written. The JS rail (`app/src/components/chart/
    technicalStudies.oracle.test.js`) then compares `technicalStudies.js` to the
    written values bar by bar: the same first valid bar, the same gaps, and values
    within 1e-9 (relative to magnitude).

HOW TO REGENERATE (only if a convention changes deliberately)
    python -m venv .venv && .venv/Scripts/python -m pip install numpy TA-Lib tzdata
    .venv/Scripts/python tests/fixtures/technical_library/_oracle.py
    Output: tests/fixtures/technical_library/oracle.json (NaN -> null).

THE FIXTURE
    600 deterministic daily bars (seeded RNG) with three deliberate edge segments:
      * bars 300-329  a FLAT run (o = h = l = c, volume > 0) — zero ranges and zero
                      changes, where every zero-denominator rule is exercised;
      * bars 360-364  ZERO volume — volume-weighted rules;
      * bar  420      a GAP up of ~8% — true range vs. high-low.
    Plus the existing 579-bar 5-minute session fixture for VWAP σ bands.
"""
import json
import math
import os
from datetime import date, timedelta, datetime
from zoneinfo import ZoneInfo

import numpy as np
import talib

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
NAN = float('nan')


# ─── fixture ─────────────────────────────────────────────────────────────────

def make_bars(n=600, seed=20261001):
    rng = np.random.default_rng(seed)
    bars = []
    px = 100.0
    d = date(2023, 1, 2)
    for i in range(n):
        while d.weekday() >= 5:
            d += timedelta(days=1)
        if 300 <= i < 330:
            o = h = l = c = round(px, 4)
            v = 1_000_000.0
        else:
            if i == 420:
                px *= 1.08
            o = px
            c = max(1.0, o * (1 + rng.normal(0.0004, 0.018)))
            h = max(o, c) * (1 + abs(rng.normal(0, 0.006)))
            l = min(o, c) * (1 - abs(rng.normal(0, 0.006)))
            v = float(int(1_000_000 * (1 + abs(rng.normal(0, 0.5)))))
            if 360 <= i < 365:
                v = 0.0
            o, h, l, c = (round(x, 4) for x in (o, h, l, c))
        bars.append({'t': d.isoformat(), 'o': o, 'h': h, 'l': l, 'c': c, 'v': v})
        px = c
        d += timedelta(days=1)
    return bars


BARS = make_bars()
O = np.array([b['o'] for b in BARS])
H = np.array([b['h'] for b in BARS])
L = np.array([b['l'] for b in BARS])
C = np.array([b['c'] for b in BARS])
V = np.array([b['v'] for b in BARS])
N = len(BARS)


# ─── reference primitives (written from the definitions) ─────────────────────

def nan(n=N):
    return np.full(n, np.nan)


def sma(x, p):
    out = nan(len(x))
    for i in range(p - 1, len(x)):
        w = x[i - p + 1:i + 1]
        if np.all(np.isfinite(w)):
            out[i] = w.sum() / p
    return out


def ema(x, p):
    """α = 2/(p+1), seeded with the SMA of the first p finite values of a run."""
    out = nan(len(x))
    k = 2.0 / (p + 1)
    prev = None
    run = []
    for i, v in enumerate(x):
        if not math.isfinite(v):
            prev = None
            run = []
            continue
        if prev is None:
            run.append(v)
            if len(run) == p:
                prev = sum(run) / p
                out[i] = prev
            continue
        prev = v * k + prev * (1 - k)
        out[i] = prev
    return out


def wma(x, p):
    out = nan(len(x))
    w = np.arange(1, p + 1, dtype=float)
    for i in range(p - 1, len(x)):
        seg = x[i - p + 1:i + 1]
        if np.all(np.isfinite(seg)):
            out[i] = (seg * w).sum() / w.sum()
    return out


def rma(x, p):
    out = nan(len(x))
    prev = None
    run = []
    for i, v in enumerate(x):
        if not math.isfinite(v):
            prev = None
            run = []
            continue
        if prev is None:
            run.append(v)
            if len(run) == p:
                prev = sum(run) / p
                out[i] = prev
            continue
        prev = (prev * (p - 1) + v) / p
        out[i] = prev
    return out


def linreg_end(x, p):
    out = nan(len(x))
    xs = np.arange(p, dtype=float)
    for i in range(p - 1, len(x)):
        seg = x[i - p + 1:i + 1]
        if np.all(np.isfinite(seg)):
            if p == 1:
                out[i] = seg[0]
                continue
            b, a = np.polyfit(xs, seg, 1)
            out[i] = a + b * (p - 1)
    return out


def rolling(x, p, fn):
    out = nan(len(x))
    for i in range(p - 1, len(x)):
        seg = x[i - p + 1:i + 1]
        if np.all(np.isfinite(seg)):
            out[i] = fn(seg)
    return out


def true_range():
    tr = nan()
    for i in range(1, N):
        tr[i] = max(H[i] - L[i], abs(H[i] - C[i - 1]), abs(L[i] - C[i - 1]))
    return tr


TR = true_range()


def atr(p):
    """Wilder ATR: seed = mean of TR[1..p], first value at index p."""
    return rma(TR, p)


def rsi(x, p):
    out = nan(len(x))
    ag = al = None
    gains, losses = [], []
    for i in range(1, len(x)):
        d = x[i] - x[i - 1]
        if not math.isfinite(d):
            continue
        g, l_ = max(d, 0.0), max(-d, 0.0)
        if ag is None:
            gains.append(g)
            losses.append(l_)
            if len(gains) < p:
                continue
            ag, al = sum(gains) / p, sum(losses) / p
        else:
            ag = (ag * (p - 1) + g) / p
            al = (al * (p - 1) + l_) / p
        out[i] = 100.0 if al == 0 else (0.0 if ag == 0 else 100 - 100 / (1 + ag / al))
    return out


def safe_div(a, b, k=1.0):
    out = nan(len(a))
    for i in range(len(a)):
        if math.isfinite(a[i]) and math.isfinite(b[i]) and b[i] != 0:
            out[i] = k * a[i] / b[i]
    return out


def bands_bb(p, m):
    mid = sma(C, p)
    sd = rolling(C, p, lambda s: math.sqrt(((s - s.mean()) ** 2).sum() / p))
    return mid + m * sd, mid, mid - m * sd


# ─── the studies, by UCT semantics ───────────────────────────────────────────

def ma_types(src, p, vol):
    half, root = max(1, p // 2), max(1, round(math.sqrt(p)))
    raw = 2 * wma(src, half) - wma(src, p)
    vw = nan(len(src))
    for i in range(p - 1, len(src)):
        sv = vol[i - p + 1:i + 1].sum()
        if sv != 0:
            vw[i] = (src[i - p + 1:i + 1] * vol[i - p + 1:i + 1]).sum() / sv
    e1 = ema(src, p)
    e2 = ema(e1, p)
    e3 = ema(e2, p)
    return {
        'sma': sma(src, p), 'ema': ema(src, p), 'wma': wma(src, p), 'vwma': vw,
        'hma': wma(raw, root), 'smma': rma(src, p),
        'dema': 2 * e1 - e2, 'tema': 3 * e1 - 3 * e2 + e3, 'lsma': linreg_end(src, p),
    }


def supertrend(p=10, m=3.0):
    """TradingView's published `ta.supertrend` algorithm, with UCT's Wilder ATR."""
    a = atr(p)
    up, dn, direction = nan(), nan(), nan()
    fu = fl = None
    d_ = 0
    prev_line = None
    for i in range(N):
        if not math.isfinite(a[i]):
            continue
        mid = (H[i] + L[i]) / 2
        bu, bl = mid + m * a[i], mid - m * a[i]
        pc = C[i - 1] if i > 0 else NAN
        nfl = bl if (fl is None or bl > fl or pc < fl) else fl
        nfu = bu if (fu is None or bu < fu or pc > fu) else fu
        if d_ == 0:
            d_ = -1
        elif prev_line == fu:
            d_ = 1 if C[i] > nfu else -1
        else:
            d_ = -1 if C[i] < nfl else 1
        fl, fu = nfl, nfu
        line = fl if d_ == 1 else fu
        prev_line = line
        direction[i] = d_
        if d_ == 1:
            up[i] = line
        else:
            dn[i] = line
    return up, dn


def aroon(p=14):
    up, dn = nan(), nan()
    for i in range(p, N):
        hw, lw = H[i - p:i + 1], L[i - p:i + 1]
        hi = max(range(p + 1), key=lambda j: (hw[j], j))   # most recent on a tie
        lo = max(range(p + 1), key=lambda j: (-lw[j], j))
        up[i] = 100 * (p - (p - hi)) / p
        dn[i] = 100 * (p - (p - lo)) / p
    return up, dn


def vortex(p=14):
    vp, vm = nan(), nan()
    for i in range(1, N):
        vp[i], vm[i] = abs(H[i] - L[i - 1]), abs(L[i] - H[i - 1])
    s = lambda x: rolling(x, p, np.sum)
    return safe_div(s(vp), s(TR)), safe_div(s(vm), s(TR))


def chop(p=14):
    out = nan()
    st = rolling(TR, p, np.sum)
    hh, ll = rolling(H, p, np.max), rolling(L, p, np.min)
    for i in range(N):
        rng_ = hh[i] - ll[i]
        if math.isfinite(st[i]) and math.isfinite(rng_) and rng_ > 0 and st[i] > 0:
            out[i] = 100 * math.log10(st[i] / rng_) / math.log10(p)
    return out


def stoch_rsi(src, rp=14, sp=14, k=3, d=3):
    r = rsi(src, rp)
    raw = nan(len(src))
    for i in range(sp - 1, len(src)):
        w = r[i - sp + 1:i + 1]
        if np.all(np.isfinite(w)):
            rg = w.max() - w.min()
            raw[i] = 50.0 if rg == 0 else 100 * (r[i] - w.min()) / rg
    kk = sma(raw, k)
    return kk, sma(kk, d)


def ppo(src, f=12, s=26, g=9):
    fe, se = ema(src, f), ema(src, s)
    line = safe_div(fe - se, se, 100.0)
    sig = ema(line, g)
    return line, sig, line - sig


def roc(src, p=12):
    out = nan(len(src))
    for i in range(p, len(src)):
        if src[i - p] != 0:
            out[i] = 100 * (src[i] - src[i - p]) / src[i - p]
    return out


def mom(src, p=10):
    out = nan(len(src))
    out[p:] = src[p:] - src[:-p]
    return out


def tsi(src, lo=25, sh=13, g=13):
    d = nan(len(src))
    d[1:] = np.diff(src)
    num, den = ema(ema(d, lo), sh), ema(ema(np.abs(d), lo), sh)
    line = safe_div(num, den, 100.0)
    return line, ema(line, g)


def cmo(src, p=14):
    out = nan(len(src))
    d = np.diff(src)
    for i in range(p, len(src)):
        w = d[i - p:i]
        su, sd = w[w > 0].sum(), -w[w < 0].sum()
        if su + sd != 0:
            out[i] = 100 * (su - sd) / (su + sd)
    return out


def trix(src, p=15, g=9):
    e3 = ema(ema(ema(src, p), p), p)
    line = nan(len(src))
    for i in range(1, len(src)):
        if math.isfinite(e3[i]) and math.isfinite(e3[i - 1]) and e3[i - 1] != 0:
            line[i] = 100 * (e3[i] - e3[i - 1]) / e3[i - 1]
    return line, ema(line, g)


def awesome(f=5, s=34):
    m = (H + L) / 2
    return sma(m, f) - sma(m, s)


def ultimate(a=7, b=14, c=28):
    bp, tr = nan(), nan()
    for i in range(1, N):
        lo, hi = min(L[i], C[i - 1]), max(H[i], C[i - 1])
        bp[i], tr[i] = C[i] - lo, hi - lo
    avg = lambda p: safe_div(rolling(bp, p, np.sum), rolling(tr, p, np.sum))
    return (4 * avg(a) + 2 * avg(b) + avg(c)) * 100 / 7


def bop(p=14):
    raw = np.where(H - L == 0, 0.0, (C - O) / np.where(H - L == 0, 1, H - L))
    return sma(raw, p)


def keltner(p=20, m=2.0, ap=10):
    mid = ema(C, p)
    a = atr(ap)
    up, lo = mid + m * a, mid - m * a
    return up, np.where(np.isfinite(up), mid, np.nan), lo


def percent_b_and_width(p=20, m=2.0):
    up, mid, lo = bands_bb(p, m)
    w = up - lo
    pb = safe_div(C - lo, w)
    bw = safe_div(w, mid, 100.0)
    return pb, bw


def adr(p=20):
    r = np.where(L > 0, H / np.where(L > 0, L, 1), np.nan)
    s = sma(r, p)
    return 100 * (s - 1)


def hv(p=20, per_year=252):
    lr = nan()
    for i in range(1, N):
        if C[i] > 0 and C[i - 1] > 0:
            lr[i] = math.log(C[i] / C[i - 1])
    sd = rolling(lr, p, lambda s: s.std(ddof=1))
    return sd * math.sqrt(per_year) * 100


def squeeze(p=20, bm=2.0, km=1.5):
    basis = sma(C, p)
    sd = rolling(C, p, lambda s: s.std(ddof=0))
    a = atr(p)
    on = nan()
    for i in range(N):
        if math.isfinite(basis[i]) and math.isfinite(sd[i]) and math.isfinite(a[i]):
            on[i] = 1.0 if (basis[i] + bm * sd[i] < basis[i] + km * a[i]
                            and basis[i] - bm * sd[i] > basis[i] - km * a[i]) else 0.0
    hh, ll = rolling(H, p, np.max), rolling(L, p, np.min)
    delta = C - ((hh + ll) / 2 + basis) / 2
    return linreg_end(delta, p), on


def mfv():
    rng_ = H - L
    return np.where(rng_ == 0, 0.0, ((C - L) - (H - C)) / np.where(rng_ == 0, 1, rng_) * V)


def rvol(p=50):
    avg = sma(V, p)
    out = nan()
    for i in range(1, N):
        if math.isfinite(avg[i - 1]) and avg[i - 1] > 0:
            out[i] = V[i] / avg[i - 1]
    return out


def ad_line():
    return np.cumsum(mfv())


def cmf(p=20):
    return safe_div(rolling(mfv(), p, np.sum), rolling(V, p, np.sum))


def chaikin_osc(f=3, s=10):
    ad = ad_line()
    return ema(ad, f) - ema(ad, s)


def efi(p=13):
    raw = nan()
    raw[1:] = np.diff(C) * V[1:]
    return ema(raw, p)


def pvt():
    out = np.zeros(N)
    for i in range(1, N):
        out[i] = out[i - 1] + ((C[i] - C[i - 1]) / C[i - 1] * V[i] if C[i - 1] != 0 else 0.0)
    return out


def ud_ratio(p=50):
    up, dn = nan(), nan()
    for i in range(1, N):
        up[i] = V[i] if C[i] > C[i - 1] else 0.0
        dn[i] = V[i] if C[i] < C[i - 1] else 0.0
    su, sd = rolling(up, p, np.sum), rolling(dn, p, np.sum)
    out = nan()
    for i in range(N):
        if math.isfinite(su[i]) and math.isfinite(sd[i]) and sd[i] > 0:
            out[i] = su[i] / sd[i]
    return out


def pct_from_ma(p=50):
    m = sma(C, p)
    return safe_div(C, m, 100.0) - 100.0


def fifty_two_week():
    ts = [datetime.fromisoformat(b['t']).date() for b in BARS]
    fh, fl = nan(), nan()
    for i in range(N):
        if (ts[i] - ts[0]).days < 364:
            continue
        idx = [j for j in range(i + 1) if (ts[i] - ts[j]).days < 364]
        hh, ll = H[idx].max(), L[idx].min()
        fh[i], fl[i] = 100 * (C[i] / hh - 1), 100 * (C[i] / ll - 1)
    return fh, fl


def vwap_bands():
    path = os.path.join(ROOT, 'app', 'src', 'pages', 'parityBars', 'intraday5m.json')
    with open(path, encoding='utf-8') as f:
        bars = json.load(f)['bars']
    et = ZoneInfo('America/New_York')
    vw, sd = [], []
    day = None
    pv = pv2 = vol = 0.0
    for b in bars:
        k = datetime.fromtimestamp(b['t'], tz=et).date()
        if k != day:
            pv = pv2 = vol = 0.0
            day = k
        tp = (b['h'] + b['l'] + b['c']) / 3
        pv += tp * b['v']
        pv2 += tp * tp * b['v']
        vol += b['v']
        if vol > 0:
            m = pv / vol
            vw.append(m)
            sd.append(math.sqrt(max(pv2 / vol - m * m, 0.0)))
        else:
            vw.append(NAN)
            sd.append(NAN)
    return np.array(vw), np.array(sd)


# ─── TA-Lib, where the convention is the same ────────────────────────────────

def agree(name, ours, theirs, start=0, rel=1e-9):
    a, b = np.asarray(ours)[start:], np.asarray(theirs)[start:]
    both = np.isfinite(a) & np.isfinite(b)
    assert both.sum() > 20, f'{name}: nothing to compare'
    scale = np.maximum(1.0, np.abs(b[both]))
    err = np.max(np.abs(a[both] - b[both]) / scale)
    assert err < rel, f'{name}: oracle and TA-Lib disagree by {err:.3e}'
    return float(err)


CROSS = {}


def cross_checks():
    """The second reference. Each line asserts the NumPy oracle equals TA-Lib on
    the bars where both are defined and the conventions coincide."""
    t = talib
    CROSS['sma'] = agree('sma', sma(C, 20), t.SMA(C, 20))
    CROSS['ema'] = agree('ema', ema(C, 20), t.EMA(C, 20))
    CROSS['wma'] = agree('wma', wma(C, 20), t.WMA(C, 20))
    CROSS['dema'] = agree('dema', ma_types(C, 20, V)['dema'], t.DEMA(C, 20))
    CROSS['tema'] = agree('tema', ma_types(C, 20, V)['tema'], t.TEMA(C, 20))
    CROSS['lsma'] = agree('lsma', linreg_end(C, 20), t.LINEARREG(C, 20))
    CROSS['atr'] = agree('atr', atr(14), t.ATR(H, L, C, 14))
    CROSS['atrPercent'] = agree('natr', safe_div(atr(14), C, 100.0), t.NATR(H, L, C, 14))
    CROSS['rsi'] = agree('rsi', rsi(C, 14), t.RSI(C, 14), start=340)   # TA-Lib RSI on the flat run differs
    CROSS['roc'] = agree('roc', roc(C, 12), t.ROC(C, 12))
    CROSS['mom'] = agree('mom', mom(C, 10), t.MOM(C, 10))
    CROSS['trix'] = agree('trix', trix(C, 15)[0], t.TRIX(C, 15))
    ppo_line = ppo(C)[0]
    CROSS['ppo'] = agree('ppo', ppo_line, t.PPO(C, 12, 26, matype=1))
    up, mid, lo = bands_bb(20, 2.0)
    tu, tm, tl = t.BBANDS(C, 20, 2.0, 2.0, matype=0)
    CROSS['bbUpper'] = agree('bb upper', up, tu)
    CROSS['stdev'] = agree('stdev', rolling(C, 20, lambda s: s.std(ddof=0)), t.STDDEV(C, 20, 1.0))
    au, ad = aroon(14)
    tdn, tup = t.AROON(H, L, 14)
    CROSS['aroonUp'] = agree('aroon up', au, tup, start=340)
    CROSS['aroonDown'] = agree('aroon down', ad, tdn, start=340)
    CROSS['ultimate'] = agree('ultosc', ultimate(), t.ULTOSC(H, L, C, 7, 14, 28))
    CROSS['bopRaw'] = agree('bop raw', sma(np.where(H - L == 0, 0.0, (C - O) / np.where(H - L == 0, 1, H - L)), 1),
                            t.BOP(O, H, L, C), start=340)
    CROSS['ad'] = agree('ad', ad_line(), t.AD(H, L, C, V))
    # TA-Lib's ADOSC seeds its EMAs on the FIRST value (UCT seeds on the SMA), so
    # the two converge rather than coincide: compared after 200 bars of decay.
    CROSS['chaikinOscillator'] = agree('adosc', chaikin_osc(), t.ADOSC(H, L, C, V, 3, 10), start=200, rel=1e-6)


def col(x):
    return [None if not math.isfinite(float(v)) else float(v) for v in x]


def main():
    cross_checks()
    st_up, st_dn = supertrend()
    ar_up, ar_dn = aroon()
    vi_p, vi_m = vortex()
    srk, srd = stoch_rsi(C)
    pp, ps, ph = ppo(C)
    ts_, tsg = tsi(C)
    tx, txg = trix(C)
    kcu, kcm, kcl = keltner()
    pb, bw = percent_b_and_width()
    sq_m, sq_on = squeeze()
    fh, fl = fifty_two_week()
    vw, vsd = vwap_bands()
    env_mid = sma(C, 20)
    out = {
        'note': 'Generated by _oracle.py. Do not edit by hand; see its docstring.',
        'bars': BARS,
        'crossChecks': CROSS,
        'expected': {
            'ma': {k: col(v) for k, v in ma_types(C, 21, V).items()},
            'superTrend': {'up': col(st_up), 'down': col(st_dn)},
            'aroon': {'up': col(ar_up), 'down': col(ar_dn)},
            'vortex': {'plus': col(vi_p), 'minus': col(vi_m)},
            'choppiness': col(chop()),
            'stochRsi': {'k': col(srk), 'd': col(srd)},
            'ppo': {'line': col(pp), 'signal': col(ps), 'histogram': col(ph)},
            'roc': col(roc(C)),
            'momentum': col(mom(C)),
            'tsi': {'line': col(ts_), 'signal': col(tsg)},
            'cmo': col(cmo(C)),
            'trix': {'line': col(tx), 'signal': col(txg)},
            'awesome': col(awesome()),
            'ultimate': col(ultimate()),
            'balanceOfPower': col(bop()),
            'bullBearPower': {'bull': col(H - ema(C, 13)), 'bear': col(L - ema(C, 13))},
            'keltner': {'upper': col(kcu), 'middle': col(kcm), 'lower': col(kcl)},
            'envelope': {'upper': col(env_mid * 1.025), 'middle': col(env_mid), 'lower': col(env_mid * 0.975)},
            'percentB': col(pb),
            'bandwidth': col(bw),
            'atrPercent': col(safe_div(atr(14), C, 100.0)),
            'adrPercent': col(adr()),
            'standardDeviation': col(rolling(C, 20, lambda s: s.std(ddof=0))),
            'historicalVolatility': col(hv()),
            'squeeze': {'histogram': col(sq_m), 'on': col(sq_on)},
            'relativeVolume': col(rvol()),
            'accumulationDistribution': col(ad_line()),
            'chaikinMoneyFlow': col(cmf()),
            'chaikinOscillator': col(chaikin_osc()),
            'forceIndex': col(efi()),
            'priceVolumeTrend': col(pvt()),
            'upDownVolumeRatio': col(ud_ratio()),
            'percentFromMa': col(pct_from_ma()),
            'fiftyTwoWeek': {'fromHigh': col(fh), 'fromLow': col(fl)},
            'vwapBands': {'vwap': col(vw), 'sd': col(vsd)},
        },
    }
    with open(os.path.join(HERE, 'oracle.json'), 'w', encoding='utf-8') as f:
        json.dump(out, f, separators=(',', ':'))
    print('cross-checks (max relative error vs TA-Lib):')
    for k, v in CROSS.items():
        print(f'  {k:20s} {v:.2e}')


if __name__ == '__main__':
    main()
