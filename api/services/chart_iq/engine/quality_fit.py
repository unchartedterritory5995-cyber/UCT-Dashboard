# Chart IQ engine (vendored from the UCT lab by chart_iq/site_port/build_vendor.py; regenerate, do not hand-edit).
import json, math, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
LAB = os.path.dirname(os.path.dirname(HERE))
from . import quality as Q
BASECARDS = ('Base', 'Flat-top breakout', 'Launch pad')

def raw(b, s, e, top, low):
    n = len(b)
    k = n - 1
    c = [x['c'] for x in b]
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
    return {'depth': min(depth, 0.6), 'depth_adr': min(depth / max(adr, 0.005), 20) / 20, 'tight': min(tight, 0.3), 'tight_rel': min(tight / max(depth, 0.01), 2), 'dry': min(dry, 3), 'under': max(-0.2, min(under, 0.4)), 'prior': min(prior, 2), 'len': min(e - s + 1, 120) / 120, 'over50': 1 if c[k] > s50 else 0, 'adr': min(adr, 0.15)}
