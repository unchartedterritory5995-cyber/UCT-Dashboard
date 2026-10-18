"""UCT Trendline Break detector - pattern_id `uct_trendline_break`. INTERNAL (admin-only).

A trendline break is the session that closes up through a FALLING trendline
drawn across prior swing highs: the session is green, closes above the prior
session's high, crosses the line on this bar (the prior close was at or under
it), is the first close above the line in ten sessions, and is not more than
1.5 ATR past it.

This is a NEW detector; it changes no other detector. It is a port of the
offline lab's team-setup recognition rule `trendline_break_v3`, which is the
round-2 rule `trendline_break_v2` (team_rules_r2.feats/decide_trendline_break_v2)
FROZEN at its tuned grid point {first 10, ext 1.5, trend None}
(out_recall_v2/tune_trendline_break_v2.json). Only the blind MEASUREMENT
changed in round 5: the judge was shown the exact line the rule tested and asked
whether the marked bar breaks THAT line. Two fresh blind packets of 25 fires each
read 16 yes / 1 no and 17 yes / 4 no: pooled precision of decided 86.8% (Wilson
95% CI 73-94). Recall is weak (DEV 11.9%, lift 1.45; TEST 32.4%, lift 4.13) and
the dense fire rate is high (~8% of ticker-days): this confirms recognition of
"a break of this line", not that the line is the one a trader would pick or that
the break pays. The remaining misses are line quality: near-flat lines, very
short spans, and lines already closed through inside their own span. None of
those is gated here (a v4 lever, not part of the confirmed rule).

THE LINE: a FROZEN copy of the lab drawer, NOT the display drawer
------------------------------------------------------------------
The rule tests the learned drawer's TOP-1 falling line through swing highs,
drawn AS OF THE PRIOR SESSION (bars[:i], so the line exists before the bar that
breaks it). The lab computed it with the lab's own learned drawer module,
`lab/auto_draw/drawer.py` (sha256 acac95f499b376c6...161197f) and its fitted
weights `lab/auto_draw/out/drawer_model.json` (sha256 8754c5b0cb7c0f31...c6aa114),
the `trendline` block. Neither file is hash-pinned by the round-5 prereg (the
rule files are); both were last written before the prereg and before any
round-2 or round-5 sample was drawn.

The display drawer `api/services/auto_draw.py` was ported from that same lab
file (commit 4551d9b1fa, blob bfd7f030c9; the same blob at e0a84abf03), and its
trendline path (as_arrays / atr / strengths / t_candidates / score_rows / nms_t
and the trendline model) is equivalent to the lab's. It has since been changed
for DISPLAY by the team-drawing rounds (round 2 b8ce8e8a35, round 3 20de0e6e24,
round 4 in progress): trendline dedupe, the cut-through filter, stale-break
removal. Those rounds filter what the chart DRAWS (`drawn_set`), so the chart's
drawn lines are already not the rule's top-1 line, and any later change to the
display drawer, its constants or its weights would silently change what this
confirmed rule fires on if the rule read it.

So this module does NOT import `api.services.auto_draw`. The functions and
weights the rule needs are vendored below as private `_dr_*` / `_DR_*` names,
each a verbatim copy of the lab drawer.py function (only the names are
prefixed); the parity test proves source identity against the lab file and
model when the lab is present, and a rail proves a mutated display drawer
cannot move this detector. Do not "sync" these with auto_draw.py: changing them
is changing the confirmed rule, which needs a new pre-registered blind check.

The rule at session i (uses bars[:i+1] only). ATR = 14-session simple average
true range (the shared series); the line is computed from bars[:i] by the
frozen drawer:
  * i >= 65, ATR > 0, the 50 SMA exists               (the lab's shared warm-up)
  * candidates: the drawer's trendline candidates at bar i-1 (pairs of swing
    pivots in its 120-bar lookback) through HIGHS with the second anchor LOWER
    than the first (falling); none -> no answer
  * the top-1 candidate by the learned score after the drawer's near-duplicate
    suppression (0.5 ATR, the drawer's own ATR at i-1)
  * L(k) = p1 + slope * (k - j1); cross0 = close[i] > L(i) and close[i-1] <= L(i-1)
  * green = close[i] > open[i]; gt_ph = close[i] > high[i-1]
  * ago = sessions since the last close above L after the first anchor (None if none)
  * pos = (close[i] - L(i)) / ATR
  * fire `break` when cross0 and green and gt_ph, pos <= 1.5, and not
    (ago is not None and ago <= 10)
Frozen grid point: first 10, ext 1.5, trend None.

Levels: the break session's close is the entry; the stop is the session's low;
the pivot is the line's value on the break session. Neither was tested as a risk
anchor in the lab: they are drawn levels. Geometry is the shared UCT idiom: a
`candle_mark` whose two anchors (with `anchor_roles`) are the line's value and
the session's low on the marked session, a display-only stop line in
`geometry.secondary`, and the tested line itself (both anchor highs on real bar
times, plus its value on the break session) in `extras.trendline`. The chart's
secondary renderer draws horizontal levels only, so the sloped line is carried
as data, not drawn as a secondary.

Wrapper (shared with the other UCT trader-setup detectors, not part of the lab
rule): the liquidity floor, the newest of the last `MAX_TRIGGER_AGE` sessions
that qualifies, and a prior-session trigger is reported only while no later
session has traded through its stop. A session that is not green or does not
close above the prior high is refused before the drawer runs; that is the
rule's own conjunction, evaluated first for cost, and cannot change an answer.

History: the line at i reads bars from i-180 (the 120-bar lookback plus up to
60 bars of left pivot strength); ATR and the 50 SMA are windowed. So any slice
of at least `EXACT_WINDOW` bars answers its newest session, and the two prior
trigger sessions, exactly as the lab does on the full history. The scan's base
depth (200) exceeds that, so nothing is declared to the scan.
"""
from __future__ import annotations

import math
from typing import List, Optional

import numpy as np

from api.services.pattern_engine.detectors.registry import register
from api.services.pattern_engine.detectors.uct import uct_setups_common as U
from api.services.pattern_engine.primitives.liquidity import liquidity_floor


_PATTERN_ID = "uct_trendline_break"
_PATTERN_NAME = "UCT Trendline Break"

# Lab constants: the frozen v2 grid point (out_recall_v2/tune_trendline_break_v2.json,
# re-used unchanged as trendline_break_v3). Do not tune here; the parity test
# pins them to the lab.
TLB_FIRST = 10              # frozen: no close above the line in the 10 sessions before
TLB_EXT = 1.5               # frozen: the close at most 1.5 ATR past the line
TLB_TREND = None            # frozen: no close-above-50-SMA gate

_WARMUP = 65                # the lab's shared warm-up (team_rules._base: i >= 65)

# How the lab rule CALLS the frozen drawer (team_rules_r2.feats_trendline_break_v2):
# the drawer's defaults, passed explicitly so each can be mutation-checked.
TL_LOOKBACK = 120           # t_candidates(lookback=120)
TL_MIN_STRENGTH = 1         # t_candidates(min_strength=1)
TL_MAX_PIVOTS = 40          # t_candidates(max_pivots=40)
TL_NMS_SEP = 0.5            # nms_t(sep=0.5)
TL_TOPK = 1                 # the TOP learned line only

#: Bars a slice needs for its newest session, and the two prior trigger
#: sessions, to answer exactly as the full history does: i - 1 - (lookback - 1)
#: - 60 (max left strength) >= 0 at i = newest - 2.
EXACT_WINDOW = TL_LOOKBACK + 60 + U.MAX_TRIGGER_AGE

_MIN_BARS = _WARMUP + 1     # the rule itself answers from here


# ============================================================================
# FROZEN DRAWER - verbatim copies of the lab's lab/auto_draw/drawer.py
# (sha256 acac95f4...161197f), names prefixed `_dr_` / `_DR_`. See the module
# docstring. The parity test compares these sources to the lab file.
# ============================================================================
_DR_TOUCH_ATR = 0.25        # a bar "touches" a level/line when its high (or low) is within this many ATR
_DR_MAX_STRENGTH = 60
_DR_TL_MIN_SPAN = 3
_DR_TL_MAX_SPAN = 120

#: lab/auto_draw/out/drawer_model.json, the `trendline` block (sha256 8754c5b0...c6aa114).
_DR_TRENDLINE_MODEL = {
    'features': ['span_log', 'abs_slope', 'slope_with_side', 'touches_log', 'viol_inside_log',
                 'viol_after_log', 'broken_now', 'abs_dist_now', 'age_b_log', 'str_a_log', 'str_b_log',
                 'is_high', 'ext_ratio', 'a_is_ext'],
    'mean': [3.3577004945823616, 0.11085147652663715, -0.0023352406691285405, 1.862640048089465,
             1.4666831695214866, 1.5417179800550036, 0.3762193698949825, 4.304268689625828,
             3.2154816854117487, 1.3702295338018353, 1.3200121162706935, 0.5063943990665111,
             1.6507378411351876, 0.042979385453131076],
    'scale': [0.839764952109081, 0.12627981285399204, 0.1680154386763064, 0.7661034483173887,
              1.3806212278120946, 1.5941492687580114, 0.48443612128991276, 3.4500849100342545,
              1.120382372768788, 0.8426088492557242, 0.7782315530540463, 0.4999591099890402,
              1.6929937793866914, 0.20281064537941887],
    'coef': [-0.06285590301834232, -1.2037868270992496, 0.9467498656797377, 0.15178898178035893,
             -0.17422239184471003, -0.11024439384598166, 0.1025516061781535, -0.5267174497562425,
             -0.26887569316928167, 0.017062445537740785, 0.16574110136464487, 0.10012242719693512,
             -0.11075535787404063, 0.13165156563572347],
    'intercept': -4.378595894667559,
}


def _dr_as_arrays(bars, asof=None):
    if asof is not None:
        asof = int(str(asof).replace('-', '')[:8])
    rows = []
    for b in bars:
        if isinstance(b, dict):
            r = (b['t'], b['o'], b['h'], b['l'], b['c'], b.get('v') or 0)
        else:
            r = tuple(b[:6])
        if asof is not None and int(r[0]) > asof:
            continue
        if None in r[:5]:
            continue
        rows.append(r)
    a = np.array([[float(x) for x in r] for r in rows]) if rows else np.zeros((0, 6))
    return a


def _dr_atr(a, i, n=14):
    if i < n:
        return float(np.mean(a[:i + 1, 2] - a[:i + 1, 3])) if i >= 0 else None
    h, l, pc = a[i - n + 1:i + 1, 2], a[i - n + 1:i + 1, 3], a[i - n:i, 4]
    return float(np.mean(np.maximum(h, pc) - np.minimum(l, pc)))


def _dr_strengths(a, i, lo):
    """For bars j in [lo, i]: (left, right) strength of the high and of the low, counting only bars <= i.
    left = consecutive bars before j with a strictly lower high (higher low), capped; right likewise after j."""
    H, L = a[:, 2], a[:, 3]
    n = i - lo + 1
    out = np.zeros((n, 4), dtype=int)   # hl, hr, ll, lr
    for q, j in enumerate(range(lo, i + 1)):
        for side, arr, cmp in ((0, H, np.less), (2, L, np.greater)):
            left = 0
            k = j - 1
            while k >= 0 and left < _DR_MAX_STRENGTH and cmp(arr[k], arr[j]):
                left += 1
                k -= 1
            right = 0
            k = j + 1
            while k <= i and right < _DR_MAX_STRENGTH and cmp(arr[k], arr[j]):
                right += 1
                k += 1
            out[q, side] = left
            out[q, side + 1] = right
    return out


def _dr_t_candidates(a, i, lookback=120, min_strength=1, max_pivots=40):
    """Candidate trendlines: pairs of same-side swing pivots (highs with highs, lows with lows) inside the
    window, span TL_MIN_SPAN..TL_MAX_SPAN bars, line through the two extremes, extended to bar i."""
    if i < 20:
        return []
    lo = max(1, i - lookback + 1)
    at = _dr_atr(a, i)
    if not at or at <= 0:
        return []
    S = _dr_strengths(a, i, lo)
    c = a[i, 4]
    out = []
    for is_high in (1, 0):
        col = 2 if is_high else 3
        piv = []
        for q, j in enumerate(range(lo, i + 1)):
            le, ri = (S[q][0], S[q][1]) if is_high else (S[q][2], S[q][3])
            if j == i:
                ri = 0
            if min(le, ri) >= min_strength or (j == i and le >= 3):
                piv.append((j, min(le, max(ri, 1) if j == i else ri), le, ri))
        if len(piv) > max_pivots:          # keep the strongest
            piv = sorted(piv, key=lambda z: -z[1])[:max_pivots]
            piv.sort()
        ext_j = lo + int(np.argmax(a[lo:i + 1, 2])) if is_high else lo + int(np.argmin(a[lo:i + 1, 3]))
        for u in range(len(piv)):
            for w in range(u + 1, len(piv)):
                ja, jb = piv[u][0], piv[w][0]
                span = jb - ja
                if span < _DR_TL_MIN_SPAN or span > _DR_TL_MAX_SPAN:
                    continue
                pa, pb = a[ja, col], a[jb, col]
                slope = (pb - pa) / span
                xs = np.arange(ja, i + 1)
                line = pa + slope * (xs - ja)
                seg = a[ja:i + 1]
                ext = seg[:, col]
                touch = np.abs(ext - line) <= _DR_TOUCH_ATR * at
                touch[0] = False
                touch[span] = False
                cl = seg[:, 4]
                if is_high:
                    viol = cl > line + 0.1 * at
                else:
                    viol = cl < line - 0.1 * at
                vin = int(viol[1:span].sum())
                vaft = int(viol[span + 1:].sum())
                lnow = line[-1]
                broken = float(viol[-1])
                out.append({'ja': ja, 'jb': jb, 'pa': pa, 'pb': pb, 'is_high': is_high, 'p_now': lnow, 'f': {
                    'span_log': math.log1p(span),
                    'abs_slope': min(abs(slope) / at, 2.0),
                    'slope_with_side': max(-2.0, min(2.0, (-slope if is_high else slope) / at)),
                    'touches_log': math.log1p(int(touch.sum())),
                    'viol_inside_log': math.log1p(vin),
                    'viol_after_log': math.log1p(vaft),
                    'broken_now': broken,
                    'abs_dist_now': min(abs(lnow - c) / at, 10.0),
                    'age_b_log': math.log1p(i - jb),
                    'str_a_log': math.log1p(piv[u][1]),
                    'str_b_log': math.log1p(piv[w][1]),
                    'is_high': is_high,
                    'ext_ratio': min((i - jb) / span, 5.0),
                    'a_is_ext': float(ja == ext_j),
                }})
    return out


def _dr_score_rows(rows, m):
    """logistic score from a {features, mean, scale, coef, intercept} block."""
    if not rows:
        return np.zeros(0)
    X = np.array([[r['f'][k] for k in m['features']] for r in rows], dtype=float)
    Z = (X - np.array(m['mean'])) / np.array(m['scale'])
    z = Z @ np.array(m['coef']) + m['intercept']
    return 1.0 / (1.0 + np.exp(-z))


def _dr_nms_t(cands, scores, at, k, sep=0.5):
    order = np.argsort(-scores)
    kept = []
    for q in order:
        x = cands[q]
        dup = False
        for r in kept:
            y = cands[r]
            if x['is_high'] != y['is_high']:
                continue
            ya = y['pa'] + (y['pb'] - y['pa']) / (y['jb'] - y['ja']) * (x['ja'] - y['ja'])
            if abs(ya - x['pa']) <= sep * at and abs(y['p_now'] - x['p_now']) <= sep * at:
                dup = True
                break
        if not dup:
            kept.append(q)
        if len(kept) >= k:
            break
    return kept


# ============================================================================
# the rule (team_rules_r2.feats/decide_trendline_break_v2)
# ============================================================================
def _top_line(bars: list, i: int):
    """The frozen drawer's top-1 falling line through highs, as of bar i-1
    (the lab's exact call sequence). Returns (candidate, score) or None."""
    A = _dr_as_arrays(bars[:i])                    # bars through i-1 only: the line exists before the as-of bar
    cands = [x for x in _dr_t_candidates(A, i - 1, TL_LOOKBACK, TL_MIN_STRENGTH, TL_MAX_PIVOTS)
             if x['is_high'] and x['pb'] < x['pa']]
    if not cands:
        return None
    sc = _dr_score_rows(cands, _DR_TRENDLINE_MODEL)
    keep = _dr_nms_t(cands, sc, _dr_atr(A, i - 1), TL_TOPK, TL_NMS_SEP)
    if not keep:
        return None
    return cands[keep[0]], sc[keep[0]]


def _features(bars: list, S: dict, i: int):
    """(facts, line) or None. `facts` is the lab's feats_trendline_break_v2
    dict (t1 / t2 are this series' bar times); `line` carries the anchor
    indices and the line's value on bar i, for the wrapper only."""
    if i < 2 or i >= len(bars):
        return None
    a = S["atr"][i]
    if i < _WARMUP or a is None or a <= 0 or S["s50"][i] is None:
        return None
    top = _top_line(bars, i)
    if top is None:
        return None
    x, score = top
    ja, jb = int(x['ja']), int(x['jb'])
    sl = (x['pb'] - x['pa']) / (jb - ja)

    def L(k):
        return x['pa'] + sl * (k - ja)

    c0, c1 = bars[i]["c"], bars[i - 1]["c"]
    ago = None                                      # sessions since the last close above the line (after its anchor)
    for k in range(i - 1, ja, -1):
        if bars[k]["c"] > L(k):
            ago = i - k
            break
    f = {'score': round(float(score), 4), 'pos': (c0 - L(i)) / a, 'cross0': bool(c0 > L(i) and c1 <= L(i - 1)),
         'green': c0 > bars[i]["o"], 'gt_ph': c0 > bars[i - 1]["h"], 'ago': ago, 'since_anchor': i - ja,
         'span': jb - ja, 'slope_atr': sl / a, 'c_gt_s50': c0 > S['s50'][i],
         't1': bars[ja]["t"], 't2': bars[jb]["t"], 'p1': float(x['pa']), 'p2': float(x['pb'])}
    return f, {"ja": ja, "jb": jb, "line_now": float(L(i))}


def features(bars: list, S: dict, i: int) -> Optional[dict]:
    """The lab's feats_trendline_break_v2 at session i: None when the core
    precondition fails or there is no falling line, else the facts dict (the
    lab's keys; t1 / t2 are this series' bar times)."""
    r = _features(bars, S, i)
    return None if r is None else r[0]


def decide(f: dict) -> Optional[str]:
    """The lab's decide_trendline_break_v2 at the frozen grid point."""
    if not (f['cross0'] and f['green'] and f['gt_ph']):      # green close above the prior high, crossing on the bar
        return None
    if f['pos'] > TLB_EXT:
        return None
    if TLB_TREND == 'c>s50' and not f['c_gt_s50']:
        return None
    if f['ago'] is not None and (TLB_FIRST == 'anchor' or f['ago'] <= TLB_FIRST):
        return None                                 # not the FIRST close above the line in the window
    return 'break'


def evaluate(bars: list, S: dict, i: int) -> Optional[dict]:
    """The lab rule at session i. Returns a candidate dict or None."""
    if i < _WARMUP or i >= len(bars):
        return None
    b, p = bars[i], bars[i - 1]
    # The rule's own conjunction (green, close above the prior high), checked
    # before the drawer runs: decide() refuses any session failing it.
    if not (b["c"] > b["o"] and b["c"] > p["h"]):
        return None
    r = _features(bars, S, i)
    if r is None:
        return None
    f, line = r
    v = decide(f)
    if v is None:
        return None
    v50 = S["v50"][i]
    return {
        "idx": i, "variant": v, "facts": f, "ja": line["ja"], "jb": line["jb"],
        "line_now": line["line_now"], "close": b["c"], "low": b["l"],
        "prior_close": p["c"], "prior_high": p["h"],
        "pos_atr": round(f["pos"], 2),
        "rvol50": round(S["v"][i] / v50, 2) if v50 else None,
        "trigger": b["c"], "stop": b["l"],
    }


def lab_facts(c: dict) -> dict:
    """The candidate in the lab's own result shape (team_rules.rule)."""
    return {"variant": c["variant"], "facts": c["facts"]}


def _geometry_score(c: dict) -> float:
    f = c["facts"]
    g = 70.0
    g += 5.0 if f["span"] >= 10 else 0.0
    g += 5.0 if f["slope_atr"] <= -0.03 else 0.0
    g += 5.0 if f["ago"] is None else 0.0
    return round(min(100.0, g), 2)


def detect_uct_trendline_break(bars: List[dict], context: dict) -> List[dict]:
    if len(bars) < _MIN_BARS or not liquidity_floor(bars).passes:
        return []
    context = context or {}
    S = U.series(bars)
    n = len(bars)
    for off in range(U.MAX_TRIGGER_AGE):
        cand = evaluate(bars, S, n - 1 - off)
        if cand is None or U.stopped_out_since(bars, cand["idx"], cand["stop"]):
            continue
        geom = _geometry_score(cand)
        vol = U.volume_score(cand["rvol50"])
        ctx = U.context_score(context, "bullish")
        if U.confidence(geom, vol, ctx) < U.CONFIDENCE_FLOOR:
            continue
        return [_build(bars, cand, context, geom, vol, ctx)]
    return []


def _build(bars, c, context, geom, vol, ctx) -> dict:
    i, ja, jb = c["idx"], c["ja"], c["jb"]
    f = c["facts"]
    line, low = float(c["line_now"]), float(c["stop"])
    levels = U.make_levels(
        c["trigger"], low, "bullish",
        entry_condition=f"closed through the falling trendline ({line:.2f}) this session",
        stop_basis="below_marked_session_low")
    levels["pivot"] = round(line, 2)
    anchors = [{"t": int(bars[i]["t"]), "price": line},
               {"t": int(bars[i]["t"]), "price": low}]
    secondary = [U.hline(bars, jb, i, low, "stop", f"Session low {low:.2f}")]
    extras = {
        "variant": c["variant"], "fired_variants": [c["variant"]], "label_variants": [],
        "trendline": {
            "t1": int(bars[ja]["t"]), "p1": round(float(f["p1"]), 4),
            "t2": int(bars[jb]["t"]), "p2": round(float(f["p2"]), 4),
            "t_end": int(bars[i]["t"]), "p_end": round(line, 4),
            "drawn_asof_t": int(bars[i - 1]["t"]),
        },
        "line_score": f["score"], "span_bars": f["span"], "slope_atr": round(f["slope_atr"], 4),
        "pos_atr": c["pos_atr"], "last_close_above_line_bars_ago": f["ago"],
        "prior_close": round(float(c["prior_close"]), 2), "prior_high": round(float(c["prior_high"]), 2),
        "rvol50": c["rvol50"],
        "lab_rule": "team_rules_r2.trendline_break_v2 (frozen as trendline_break_v3)",
        "line_source": "frozen lab drawer (vendored), not api.services.auto_draw",
    }
    return U.build_detection(
        pattern_id=_PATTERN_ID, pattern_name=_PATTERN_NAME, direction="bullish",
        bars=bars, trig_idx=i, start_idx=ja, anchors=anchors,
        anchor_roles=["trendline", "session_low"], extras=extras,
        levels=levels, context=context, narrative=_narrative(c, levels, context),
        geom=geom, vol=vol, ctx=ctx, secondary=secondary)


def _narrative(c, levels, context) -> dict:
    f = c["facts"]
    line = c["line_now"]
    headline = (
        f"UCT Trendline Break - closed through a falling trendline (${line:.2f}) drawn across "
        f"{f['span']} sessions of lower highs. Entry ${levels['entry']:.2f}, stop ${levels['stop']:.2f}."
    )
    what_it_is = (
        f"The prior session closed at ${c['prior_close']:.2f}, at or under the line; this session "
        f"closed green at ${c['close']:.2f}, above the prior high (${c['prior_high']:.2f}) and "
        f"{c['pos_atr']:.1f} ATR past the line. The line runs through two swing highs and was drawn "
        f"from the bars before this session. {U.PROVENANCE_NOTE}"
    )
    why_it_matters = (
        f"Each rally into a falling line of lower highs was sold; a decisive close through it says "
        f"that supply has been absorbed. The setup forms in {U.context_phrase(context)}. This "
        f"detector is experimental and admin-only: two blind reviews of its fires, shown the exact "
        f"line, judged most of them real breaks, on small samples; near-flat or very short lines "
        f"were the usual miss."
    )
    what_to_watch_for = (
        f"Follow-through that holds above the line (${line:.2f}), ideally on expanding volume. "
        f"Targets are in R from the session low: ${levels['target_primary']:.2f} (2R) and "
        f"${levels['target_secondary']:.2f} (3R)."
    )
    failure_signal = (
        f"A close back under the line undoes the break; a trade below ${levels['stop']:.2f} is the stop."
    )
    return {"headline": headline, "what_it_is": what_it_is, "why_it_matters": why_it_matters,
            "what_to_watch_for": what_to_watch_for, "failure_signal": failure_signal}


register(_PATTERN_ID, detect_uct_trendline_break)
