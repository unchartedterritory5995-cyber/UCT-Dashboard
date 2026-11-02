# Chart IQ engine (vendored from the UCT lab by chart_iq/site_port/build_vendor.py; regenerate, do not hand-edit).
import json, math, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
LAB = os.path.dirname(os.path.dirname(HERE))

def quality(b, s, e, top, low):
    n = len(b)
    c = [x['c'] for x in b]
    k = n - 1
    if e - s < 5 or top <= 0 or low <= 0 or (k < 60):
        return (0, {})
    depth = 1 - low / top
    adr = sum((b[j]['h'] / b[j]['l'] - 1 for j in range(k - 19, k + 1))) / 20
    last = c[k - 9:k + 1]
    tight = (max(last) - min(last)) / top
    v50 = sum((x['v'] for x in b[k - 59:k - 9])) / 50 or 1
    dry = sum((x['v'] for x in b[k - 9:k + 1])) / 10 / v50
    under = 1 - c[k] / top
    pre = b[max(0, s - 60):s + 1]
    prior = top / min((x['l'] for x in pre)) - 1 if pre else 0
    s50 = sum(c[k - 49:k + 1]) / 50
    s50o = sum(c[k - 59:k - 9]) / 50
    p = {'tight': max(0, 1 - tight / max(0.02, 0.6 * depth)), 'dryup': max(0, min(1, (1.2 - dry) / 0.6)), 'pivot': 1.0 if -0.01 <= under <= 0.06 else max(0, 1 - abs(under - 0.03) / 0.12), 'depth': max(0, min(1, 1 - (depth / max(0.01, adr) - 3) / 7)), 'prior': max(0, min(1, prior / 0.5)), 'support': 1.0 if c[k] > s50 > s50o else 0.0}
    W = {'tight': 25, 'dryup': 15, 'pivot': 25, 'depth': 15, 'prior': 10, 'support': 10}
    return (round(sum((W[x] * p[x] for x in W)), 1), {x: round(p[x], 2) for x in p})
_FIT = None

def fitted(b, s, e, top, low):
    global _FIT
    if _FIT is None:
        _FIT = json.load(open(os.path.join(HERE, 'quality_fit.json'), encoding='utf-8'))
    from . import quality_fit as QF
    q, parts = quality(b, s, e, top, low)
    if not parts:
        return (0, {})
    f = QF.raw(b, s, e, top, low)
    f.update({'p_' + k: v for k, v in parts.items()})
    z = _FIT['intercept'] + sum((_FIT['w'].get(k, 0) * v for k, v in f.items()))
    return (round(100 / (1 + math.exp(-z))), parts)
