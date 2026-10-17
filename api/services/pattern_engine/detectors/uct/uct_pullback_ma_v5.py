"""UCT MA Pullback v5 detector - pattern_id `uct_pullback_ma_v5`. INTERNAL (admin-only).

A moving-average pullback: a stock in a power trend (rising 21 EMA above a
rising 50 SMA, above a non-declining 200 SMA) pulls back at least 1 ATR from its
10-session high and tags a key moving average (the 21 EMA, 50 SMA or 200 SMA)
today or yesterday, and the marked close holds within 1 ATR above it.

This is a NEW detector beside `pullback_to_10ema` / `pullback_to_21ema` /
`pullback_to_50sma` / `pullback_to_200sma`; it does not change any of them. It is
a port of the offline lab rule `pullback_ma_v5` (detector recall v2,
2026-10-16/17), the fourth refinement of `pullback_ma_v2`. Every threshold was
chosen on the DEV half of the traders' scored calls by a selection rule written
down before the grid ran, and frozen before the TEST half ran. On the TEST half:
recall 20.1% (production's four pullback detectors: 19.4%) at a dense random
ticker-day fire rate of 5.36% (production 10.04%), lift 3.74 vs 1.94, with
almost disjoint hits (5 shared of 123). A blind review of 25 fires on fresh
random days judged 19 yes / 1 no / 5 ambiguous; decoys 8 no / 1 ambiguous / 1 yes.

The rule at session i (uses bars[:i+1] only). ATR = 14-session simple average
true range; MAs are e8 / e21 (EMA), s50 / s200 (SMA).
  v2 base
    * i >= 61, s50 10 sessions ago exists
    * e21[i] > s50[i] > s50[i-10]                       (power trend, t18314 / t11287)
    * max(high, last 11 sessions) - close >= 1.0 ATR     (a pullback, t0004)
    * the lowest low of the last 3 sessions is within [MA - 1.0 ATR, MA + 0.25 ATR]
      of today's value of some MA with close >= that MA
  v3 guards (frozen: s200 tol 0.10, brk 1.0 -> replaced by v5's 0.50, dist 2.0,
             20-session s50 rise OFF)
    * close > s200[i] and s200[i] - s200[i-20] >= -0.10 ATR
    * per-bar tags: bar j in {i, i-1, i-2} whose own low sits in
      [MA_j - 1.0 ATR_j, MA_j + 0.25 ATR_j] (first such j, newest first), only for
      MAs with close >= MA[i]
    * G2 break: for the 21 EMA / 50 SMA whose PRIOR close was above them, the
      marked close is at most 0.50 ATR under them
    * some tag with tag-bar close-under-MA depth <= 0.50 ATR and close distance
      above the MA <= 2.0 ATR
  v4 guards (frozen: e21_n 10, near 1.00)
    * e21[i] > e21[i-10]                                 (a RISING 21 EMA)
    * universe: the ticker is not in PB4_EXCLUDE (commodity / volatility /
      leveraged or inverse ETFs; a fixed hand list, bars carry no asset type)
  v5
    * 8-EMA-only tags NEVER count: a fire needs a 21 EMA, 50 SMA or 200 SMA tag on
      the marked session or the one before (bars ago <= 1), depth <= 0.50 ATR,
      marked close within 1.00 ATR above it.
  The variant is the closest qualifying tag (`tag_e21` / `tag_s50` / `tag_s200`).

Levels: entry = the close; pivot = the tagged MA's value on the marked session;
stop = the tag bar's low. Geometry is the shared UCT idiom: a `candle_mark`
whose two anchors (with `anchor_roles`) are the tagged MA on the marked session
and the tag bar's low, plus display-only `geometry.secondary` horizontal lines
for the tagged MA and the stop, drawn from the 10-session high the pullback
started from.

Wrapper (shared with the other UCT trader-setup detectors, not part of the lab
rule): the liquidity floor, the newest of the last `MAX_TRIGGER_AGE` sessions
that qualifies, and a prior-session trigger is reported only while no later
session has traded through its stop. The parity test pins the rule itself
against the lab code, bar for bar.

SURFACED VARIANTS (wrapper only; `evaluate` is unchanged and still returns
tag_s50 / tag_s200): the detector fires ONLY for `SURFACED_VARIANTS`
(`tag_e21`). Lab REPORT_RECALL_V2 (v5 second blind packet / pullback_ma v6 /
v5 edge, 2026-10-17): blind precision 97.7% for 21-EMA tags (43 yes / 1 no)
but 46% for 50/200-SMA tags (200 SMA: 0 yes of 7). The same report found no
measured forward-return edge, and the tag-bar-low stop is hit at the same rate
as a random stop at that ATR distance, so it is a drawn level, not a tested
risk anchor.

REACHABILITY (read before relying on this detector):
  * The rule needs the 200 SMA on the marked session AND 20 sessions earlier,
    i.e. at least `_MIN_BARS` (220) daily bars. It declares `MIN_BARS` (222,
    so the two prior trigger sessions are evaluable too) at registration; the
    daily scan in api/main.py fetches the deepest declaration and hands this
    detector its own 222-bar slice, while every other detector, and the
    context, still receive exactly the 200 bars they always did.
  * The universe exclusion needs the ticker. This detector registers with
    `wants_sym=True`, so `detect_all(..., sym=X)` (the daily scan passes it;
    pattern vision runs only FOCUSED_SETUPS) hands it, and only it, a context carrying `sym`. A
    context without it gets the lab's sym=None behaviour (no exclusion).
"""
from __future__ import annotations

from typing import List, Optional

from api.services.pattern_engine.detectors.registry import register
from api.services.pattern_engine.detectors.uct import uct_setups_common as U
from api.services.pattern_engine.primitives.liquidity import liquidity_floor


_PATTERN_ID = "uct_pullback_ma_v5"
_PATTERN_NAME = "UCT MA Pullback v5"

# Lab constants (recall_v2.py + out_recall_v2/tune_v3/v4/v5.json, frozen before
# the test half ran). Do not tune here; the parity test pins them to the lab.
PB_MAS = ("e8", "e21", "s50", "s200")
PB_LOOK = 3                    # tag within the last 3 sessions
PB_TAG_ABOVE_ATR = 0.25        # [P] low within 0.25 ATR above the MA ...
PB_TAG_BELOW_ATR = 1.0         # [P] ... or undercut it by <= 1 ATR (t4922)
PB_PULLED_ATR = 1.0            # [P] 10-session high minus close >= 1 ATR (t0004)
PB_S50_SLOPE_BARS = 10         # [T] rising 50 SMA (t18314, t11287)
PB3_S200_SLOPE_BARS = 20       # 200 SMA slope window
PB3_S200_TOL_ATR = 0.1         # v3 frozen: s200 not declining by more than 0.10 ATR
PB3_DIST_ATR = 2.0             # v3 frozen: close within 2.0 ATR of the tagged MA
PB3_BREAK_MAS = ("e21", "s50")
PB4_E21_N = 10                 # v4 frozen: e21[i] > e21[i-10]
PB4_NEAR_ATR = 1.0             # v4 frozen: close within 1.00 ATR of a 21/50/200 tag
PB4_MAX_AGO = 1                # [T] tag today or yesterday
PB5_G2_ATR = 0.5               # v5 frozen: G2 depth (replaces v3's brk 1.0)
PB5_G2_MODE = "break"          # v5 frozen: v3's break definition (prior close above)

PB4_EXCLUDE = frozenset((
    # commodity futures / physical metals
    'USO BNO UNG UCO SCO USL DBO GLD IAU GLDM SGOL SLV SIVR PPLT PALL CPER DBA DBC PDBC GSG DBB CORN WEAT SOYB CANE '
    'UGA UNL BOIL KOLD AGQ ZSL UGL GLL USLV DSLV '
    # volatility
    'UVXY SVXY VXX VIXY UVIX SVIX '
    # leveraged / inverse index, sector and single-stock
    'TQQQ SQQQ QLD QID SOXL SOXS SPXL SPXS UPRO SPXU SSO SDS SH PSQ TNA TZA LABU LABD FAS FAZ TECL TECS NUGT DUST '
    'JNUG JDST NVDL NVDU NVDD NVDX TSLL TSLQ TSLR TSLS TSLT CONL MSTU MSTX MSTZ ERX ERY GUSH DRIP FNGU FNGD BITX BITU '
    'SBIT ETHU ETHT YINN YANG DPST NAIL CURE UDOW SDOW TMF TMV TBT UBT BULZ WEBL WEBS HIBL AMDL PLTU METU AMZU GGLL '
    'AAPU MSFU SMCX DFEN UTSL PILL DUSL MIDU BRZU EDC EDZ RETL WANT URAA').split())

#: The variants the detector reports (wrapper filter, not part of the lab rule):
#: 50/200-SMA tags were 46% precise blind, 21-EMA tags 97.7%.
SURFACED_VARIANTS = frozenset({"tag_e21"})

_MIN_IDX = 199 + PB3_S200_SLOPE_BARS   # s200 exists at i - 20 (the lab returns None before)
_MIN_BARS = _MIN_IDX + 1
#: History declared to the scan (registry `min_bars`): enough for the newest
#: session AND the two prior sessions the wrapper may report (MAX_TRIGGER_AGE).
MIN_BARS = _MIN_BARS + U.MAX_TRIGGER_AGE - 1

_MA_LABEL = {"e8": "the 8-day EMA", "e21": "the 21-day EMA", "s50": "the 50-day SMA",
             "s200": "the 200-day SMA"}


def _norm_sym(sym) -> Optional[str]:
    return sym.strip().upper() if isinstance(sym, str) and sym.strip() else None


def evaluate(bars: list, S: dict, i: int, sym: Optional[str] = None) -> Optional[dict]:
    """The lab rule at session i. Returns a candidate dict or None.

    Mirrors `pullback_ma_v5(b, i, sym)` with the frozen thresholds exactly:
    same gates, same order, same tag set. Reads bars[:i+1] only (S is causal)."""
    if i < 0 or i >= len(bars):
        return None
    # ---- v2 base
    a = S["atr"][i]
    if not a or i < 61 or S["s50"][i - PB_S50_SLOPE_BARS] is None:
        return None
    c = bars[i]["c"]
    if not (S["e21"][i] > S["s50"][i] > S["s50"][i - PB_S50_SLOPE_BARS]):
        return None
    hi_idx = max(range(i - 10, i + 1), key=lambda k: (bars[k]["h"], k))
    hi10 = bars[hi_idx]["h"]
    if hi10 - c < PB_PULLED_ATR * a:
        return None
    lo = min(x["l"] for x in bars[i - PB_LOOK + 1:i + 1])
    if not [m for m in PB_MAS if S[m][i] is not None
            and S[m][i] - PB_TAG_BELOW_ATR * a <= lo <= S[m][i] + PB_TAG_ABOVE_ATR * a and c >= S[m][i]]:
        return None
    pull_atr = round((hi10 - c) / a, 2)
    # ---- v3 / v4 / v5 features
    s2 = S["s200"][i]
    s2o = S["s200"][i - PB3_S200_SLOPE_BARS] if i >= PB3_S200_SLOPE_BARS else None
    above_s200 = s2 is not None and c > s2
    s200_slope_atr = (s2 - s2o) / a if (s2 is not None and s2o is not None) else None
    tags = []   # (ma, bars ago, tag-bar close-under-MA depth in ATR, marked close above MA[i] in ATR, j)
    for m in PB_MAS:
        if S[m][i] is None or c < S[m][i]:
            continue
        for j in range(i, i - PB_LOOK, -1):
            M, aj = S[m][j], S["atr"][j] or a
            if M is not None and M - PB_TAG_BELOW_ATR * aj <= bars[j]["l"] <= M + PB_TAG_ABOVE_ATR * aj:
                tags.append((m, i - j, (M - bars[j]["c"]) / aj, (c - S[m][i]) / a, j))
                break
    brk = 0.0
    for m in PB3_BREAK_MAS:
        if S[m][i - 1] is not None and bars[i - 1]["c"] > S[m][i - 1]:
            brk = max(brk, (S[m][i] - c) / a)
    e21_up = i >= PB4_E21_N and S["e21"][i] > S["e21"][i - PB4_E21_N]
    below_atr = max([0.0] + [(S[m][i] - c) / a for m in PB3_BREAK_MAS if S[m][i] is not None])
    # ---- v5 decide
    if _norm_sym(sym) in PB4_EXCLUDE:
        return None
    if not e21_up:
        return None
    g2 = PB5_G2_ATR
    # v3_decide with brk = g2 (20-session s50 rise is off in the frozen v3)
    if not above_s200 or s200_slope_atr is None or s200_slope_atr < -PB3_S200_TOL_ATR:
        return None
    if brk > g2:
        return None
    if not [t for t in tags if t[2] <= g2 and t[3] <= PB3_DIST_ATR]:
        return None
    if PB5_G2_MODE == "any" and below_atr > g2:
        return None
    ok = [t for t in tags if t[0] != "e8" and t[2] <= g2 and t[3] <= PB3_DIST_ATR
          and t[1] <= PB4_MAX_AGO and t[3] <= PB4_NEAR_ATR]
    if not ok:
        return None
    t = min(ok, key=lambda t: t[3])
    m, ago, _depth, dist, j = t
    v50 = S["v50"][i]
    return {
        "idx": i, "variant": "tag_" + m, "ma": m,
        "tagged": [x[0] for x in ok], "pull_atr": pull_atr, "dist_atr": round(dist, 2),
        "tag_bar_ago": ago, "s200_slope_atr": round(s200_slope_atr, 2),
        "below_e21_s50_atr": round(below_atr, 2),
        "tag_idx": j, "ma_value": S[m][i], "ma_value_tag_bar": S[m][j],
        "high_idx": hi_idx, "high10": hi10, "close": c,
        "rvol50": round(S["v"][i] / v50, 2) if v50 else None,
        "trigger": c, "stop": bars[j]["l"],
    }


def lab_facts(c: dict) -> dict:
    """The candidate in the lab's own result shape (for the parity test)."""
    return {"variant": c["variant"],
            "facts": {"tagged": c["tagged"], "pull_atr": c["pull_atr"], "dist_atr": c["dist_atr"],
                      "tag_bar_ago": c["tag_bar_ago"], "s200_slope_atr": c["s200_slope_atr"],
                      "below_e21_s50_atr": c["below_e21_s50_atr"]}}


def _geometry_score(c: dict) -> float:
    g = 70.0
    g += min(10.0, 5.0 * (len(c["tagged"]) - 1))
    g += 5.0 if c["dist_atr"] <= 0.5 else 0.0
    g += 5.0 if c["below_e21_s50_atr"] == 0.0 else 0.0
    return round(min(100.0, g), 2)


def detect_uct_pullback_ma_v5(bars: List[dict], context: dict) -> List[dict]:
    if len(bars) < _MIN_BARS or not liquidity_floor(bars).passes:
        return []
    context = context or {}
    sym = context.get("sym")
    S = U.series(bars)
    n = len(bars)
    for off in range(U.MAX_TRIGGER_AGE):
        cand = evaluate(bars, S, n - 1 - off, sym)
        if cand is None or cand["variant"] not in SURFACED_VARIANTS:
            continue
        if U.stopped_out_since(bars, cand["idx"], cand["stop"]):
            continue
        geom = _geometry_score(cand)
        vol = U.volume_score(cand["rvol50"])
        ctx = U.context_score(context, "bullish")
        if U.confidence(geom, vol, ctx) < U.CONFIDENCE_FLOOR:
            continue
        return [_build(bars, cand, context, geom, vol, ctx)]
    return []


def _build(bars, c, context, geom, vol, ctx) -> dict:
    i, j, h0 = c["idx"], c["tag_idx"], c["high_idx"]
    ma_txt = _MA_LABEL[c["ma"]]
    ma, low = float(c["ma_value"]), float(c["stop"])
    levels = U.make_levels(c["trigger"], c["stop"], "bullish",
                           entry_condition=f"hold above {ma_txt} ({ma:.2f})",
                           stop_basis="below_tag_bar_low")
    levels["pivot"] = round(ma, 2)
    anchors = [{"t": int(bars[i]["t"]), "price": ma},
               {"t": int(bars[j]["t"]), "price": low}]
    secondary = [U.hline(bars, h0, i, ma, "tagged_ma", f"{ma_txt[4:].capitalize()} {ma:.2f}"),
                 U.hline(bars, h0, i, low, "stop", f"Tag-bar low {low:.2f}")]
    extras = {
        "variant": c["variant"], "fired_variants": [c["variant"]], "label_variants": [],
        "tagged_ma": c["ma"], "tagged": c["tagged"], "tagged_ma_value": round(ma, 2),
        "tag_bar_ago": c["tag_bar_ago"], "tag_t": int(bars[j]["t"]),
        "pull_atr": c["pull_atr"], "dist_atr": c["dist_atr"],
        "s200_slope_atr": c["s200_slope_atr"], "below_e21_s50_atr": c["below_e21_s50_atr"],
        "high10": round(c["high10"], 2), "rvol50": c["rvol50"],
        "lab_rule": "recall_v2.pullback_ma_v5",
    }
    return U.build_detection(
        pattern_id=_PATTERN_ID, pattern_name=_PATTERN_NAME, direction="bullish",
        bars=bars, trig_idx=i, start_idx=min(h0, j), anchors=anchors,
        anchor_roles=["tagged_ma", "tag_bar_low"], extras=extras,
        levels=levels, context=context, narrative=_narrative(c, levels, context, ma_txt),
        geom=geom, vol=vol, ctx=ctx, secondary=secondary)


def _narrative(c, levels, context, ma_txt) -> dict:
    when = "on this session" if c["tag_bar_ago"] == 0 else "on the prior session"
    others = [m for m in c["tagged"] if m != c["ma"]]
    also = (" It also tagged " + ", ".join(_MA_LABEL[m] for m in others) + "." if others else "")
    headline = (
        f"UCT MA Pullback - pulled back {c['pull_atr']:.1f} ATR into {ma_txt} (${c['ma_value']:.2f}) "
        f"and held it; entry ${levels['entry']:.2f}, stop ${levels['stop']:.2f} under the tag-bar low."
    )
    what_it_is = (
        f"Price came off its 10-session high of ${c['high10']:.2f} by {c['pull_atr']:.1f} ATR and tagged "
        f"{ma_txt} {when}; the close of ${c['close']:.2f} sits {c['dist_atr']:.2f} ATR above it. The 21-day "
        f"EMA is rising and above a rising 50-day SMA, and price is above a 200-day SMA that is not "
        f"declining, so this is a pullback inside a power trend.{also} {U.PROVENANCE_NOTE}"
    )
    why_it_matters = (
        f"In a strong trend the rising 21 EMA and 50 SMA are where dip buyers step in; a pullback that "
        f"reaches one and closes holding it gives a defined risk under the tag bar. The setup forms in "
        f"{U.context_phrase(context)}. This detector is experimental and admin-only: a blind review of "
        f"its fires on random days judged most of them real, on a small sample."
    )
    what_to_watch_for = (
        f"A break of the prior session's high as the pullback resolves, with {ma_txt} continuing to rise "
        f"under price. Targets are in R from the tag-bar low: ${levels['target_primary']:.2f} (2R) and "
        f"${levels['target_secondary']:.2f} (3R)."
    )
    failure_signal = (
        f"A trade below the tag-bar low at ${levels['stop']:.2f} means the moving average did not hold. "
        f"A close back under {ma_txt} (${levels['pivot']:.2f}) is the early warning."
    )
    return {"headline": headline, "what_it_is": what_it_is, "why_it_matters": why_it_matters,
            "what_to_watch_for": what_to_watch_for, "failure_signal": failure_signal}


register(_PATTERN_ID, detect_uct_pullback_ma_v5, min_bars=MIN_BARS, wants_sym=True)
