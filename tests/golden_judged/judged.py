"""What a judged fixture asserts about the member chart, family by family.

For every fixture case (a chart a blind judge scored 3 on a RELEASED drawing round):

  (1) the drawing is still produced on the member chart;
  (2) its key geometry -- pivot / buy point, box top and bottom, line prices, spans -- is within tolerance of
      what the judges saw: a price within min(TOL_ATR x ATR14, TOL_PCT x price) (the stricter), a span edge within
      max(SPAN_BARS_MIN, SPAN_FRAC x span) sessions;
  (3) no OTHER member drawing (a different pattern id) sits on the same base: a drawn row whose span overlaps
      the judged drawing's span and that puts a line within ONE_BASE_ATR x ATR14 of the judged key price
      (the member path's own "one breakout line per base" lens, auto_structures.ONE_LINE_PER_BASE_ATR).

`failures(case, payload, bars)` returns a list of human-readable strings; empty means the case passes.
`retired_failures` is its inverse for a case a newer passed blind round retired: the drawing must be ABSENT.
"""
from __future__ import annotations

import math

from tests.golden_judged import member_path as MP

TOL_ATR = 0.25
TOL_PCT = 0.01
SPAN_BARS_MIN = 3
SPAN_FRAC = 0.10
ONE_BASE_ATR = 1.0
#: textbook round 2: the drawn base line sits this far under the printed buy point (textbook_numbers.BUY_POINT_TICK)
LINE_TICK = 0.10

#: family -> the member pattern id it draws (None: a layer, not a row).
PATTERN_IDS = {
    "base": "bc:base",
    "textbook": "bc:base",
    "double_bottom": "draw:double-bottom",
    "shelf": "draw:shelf-pivot",
    "cup": "bc:cup-with-handle",
    "inside_day": "draw:inside-day",
    "sr": None,
    "remount": "draw:remount",
    "u_and_r": "draw:u_and_r",
    "donchian_breakout": "draw:donchian_breakout",
    "flat_top": "uct_flat_top_breakout",
}
#: the setup drawings ride their own `setup_draws` key (the single-level ones: one horizontal line at `level`)
SETUP_FAMILIES = ("remount", "u_and_r", "donchian_breakout")
#: The SETUP-LINE families (the round-2 / round-3 setup drawings and the rectangle box), also on `setup_draws`:
#: family -> the member row id. Their judged drawing is a whole geometry (one or two lines, a neckline, a box, a
#: moving-average curve), so the setup lens (setup_line_failures) compares every judged ANCHOR, not one key price.
SETUP_LINE_FAMILIES = {
    "rsi_bullish_divergence": "draw:rsi-bullish-divergence", "wyckoff_upthrust": "draw:wyckoff-upthrust",
    "channel": "draw:channel", "pennant": "draw:pennant", "darvas_box": "draw:darvas-box",
    "falling_wedge": "draw:falling-wedge", "double_top": "draw:double-top", "golden_cross": "draw:golden-cross",
    "death_cross": "draw:death-cross",
    "outside_bar": "draw:outside-bar", "descending_triangle": "draw:descending-triangle",
    "inverse_head_shoulders": "draw:inverse-head-shoulders", "bear_flag": "draw:bear-flag",
    "bollinger_squeeze": "draw:bollinger-squeeze", "major_trendlines": "draw:major-trendline",
    "rectangle": "draw:rectangle",
}
PATTERN_IDS.update(SETUP_LINE_FAMILIES)


def _finite(v):
    try:
        return v is not None and math.isfinite(float(v))
    except (TypeError, ValueError):
        return False


def _ex(row):
    return ((row or {}).get("geometry") or {}).get("extras") or {}


def _price_tol(price, atr, case):
    t = case.get("tolerance") or {}
    return min(float(t.get("atr", TOL_ATR)) * atr, float(t.get("pct", TOL_PCT)) * abs(float(price)))


def _idx(bars, t):
    """Index of the bar dated t (or of the last bar before it)."""
    best = None
    for i, b in enumerate(bars):
        if int(b["t"]) <= int(t):
            best = i
    return best


def _drawn_rows(payload):
    from api.services import auto_structures as AS
    rows = (list(payload.get("detections") or []) + list(payload.get("structures") or [])
            + list(payload.get("setup_draws") or []))
    drawn = getattr(AS, "_drawn_incumbent", None) or (lambda r: not _ex(r).get("stale"))
    return [r for r in rows if drawn(r)]


def _rows_of(payload, pid):
    return [r for r in _drawn_rows(payload) if r.get("pattern_id") == pid]


def _near(name, got, want, tol, out):
    if not _finite(got):
        out.append(f"{name}: no value (want {want:.4f})")
    elif abs(float(got) - float(want)) > tol:
        out.append(f"{name}: {float(got):.4f} vs judged {float(want):.4f} (|d| {abs(float(got) - float(want)):.4f} "
                   f"> tol {tol:.4f})")


def _span_near(name, bars, got_t, want_t, span_len, out):
    gi, wi = _idx(bars, got_t), _idx(bars, want_t)
    if gi is None or wi is None:
        out.append(f"{name}: date outside the window (got {got_t}, want {want_t})")
        return
    tol = max(SPAN_BARS_MIN, int(math.ceil(SPAN_FRAC * max(1, span_len))))
    if abs(gi - wi) > tol:
        out.append(f"{name}: bar {gi} vs judged bar {wi} (|d| {abs(gi - wi)} > {tol} sessions)")


def _expect_t(case, key):
    """A judged date (stored as a day offset) as the synthetic YYYYMMDD the fixture's bars carry."""
    return MP.ymd(case, case["expect"][key])


def _unscale(case, v):
    return float(v) / float(case["bars"]["scale"])


def _key_and_span(fam, row, bars):
    """(key price, (start_t, end_t)) the judged drawing draws, read off a member row."""
    ex = _ex(row)
    if fam in ("base", "textbook"):
        d = ex["draw_base"]
        return float(d["pivot"]), (int(d["start_t"]), int(d["end_t"]))
    if fam == "double_bottom":
        d = ex["draw_shape"]
        return float(d["pivot"]), (int(d["start_t"]), int(d["end_t"]))
    if fam == "shelf":
        d = ex["draw_shelf"]
        return float(d["price"]), (int(d["start_t"]), int(d["end_t"]))
    if fam == "flat_top":
        d = ex["draw_flat_top"]
        return float(d["price"]), (int(d["start_t"]), int(d["end_t"]))
    if fam == "cup":
        d = ex["draw_pivot"]
        return float(d["price"]), (int(d["start_t"]), int(d["end_t"]))
    if fam == "inside_day":
        d = ex["draw_inside_day"]
        return float(d["trigger"]), (int(d["start_t"]), int(d["end_t"]))
    if fam in SETUP_FAMILIES:
        return float(ex["draw_setup"]["level"]), (int(row["start_t"]), int(row["end_t"]))
    if fam in SETUP_LINE_FAMILIES:
        # the first anchor: the rectangle's top edge (its breakout line), a line's left end otherwise
        an = (row.get("geometry") or {}).get("anchors") or []
        return float(an[0]["price"]), (int(row["start_t"]), int(row["end_t"]))
    raise KeyError(fam)


def _check_geometry(fam, case, row, bars, atr, out):
    ex, e = _ex(row), case["expect"]
    tol = lambda p: _price_tol(p, atr, case)  # noqa: E731
    if fam == "base":
        d = ex.get("draw_base") or {}
        for k in ("pivot", "low"):
            w = _unscale(case, e[k])
            _near(f"base {k}", d.get(k), w, tol(w), out)
        n = _idx(bars, _expect_t(case, "end_t")) - _idx(bars, _expect_t(case, "start_t"))
        _span_near("base start", bars, d.get("start_t", 0), _expect_t(case, "start_t"), n, out)
        _span_near("base end", bars, d.get("end_t", 0), _expect_t(case, "end_t"), n, out)
    elif fam == "textbook":
        m = ex.get("metrics_textbook") or {}
        w = _unscale(case, e["buy_point"])
        _near("textbook buy point", m.get("buy_point"), w, tol(w), out)
        if "line" in e:
            # round 2: the base's top line is drawn at buy point - $0.10, one price with the printed buy point
            wl = _unscale(case, e["line"])
            _near("textbook line", m.get("line"), wl, tol(wl), out)
            if _finite(m.get("line")) and _finite(m.get("buy_point")):
                want = round(float(m["buy_point"]) - LINE_TICK, 2)
                if abs(float(m["line"]) - want) > 1e-9:
                    out.append(f"textbook line {float(m['line']):.4f} is not buy point - {LINE_TICK:.2f} "
                               f"({want:.4f})")
    elif fam == "double_bottom":
        d = ex.get("draw_shape") or {}
        for k in ("pivot", "low"):
            w = _unscale(case, e[k])
            _near(f"double bottom {k}", d.get(k), w, tol(w), out)
        si, ei = _idx(bars, d.get("start_t", 0)), _idx(bars, d.get("end_t", 0))
        if si is None or ei is None:
            out.append("double bottom span: outside the window")
        else:
            got_len, want_len = ei - si + 1, int(e["len"])
            t = max(SPAN_BARS_MIN, int(math.ceil(SPAN_FRAC * want_len)))
            if abs(got_len - want_len) > t:
                out.append(f"double bottom length: {got_len} vs judged {want_len} bars (> {t})")
    elif fam == "shelf":
        d = ex.get("draw_shelf") or {}
        w = _unscale(case, e["price"])
        _near("shelf price", d.get("price"), w, tol(w), out)
        n = _idx(bars, _expect_t(case, "end_t")) - _idx(bars, _expect_t(case, "start_t"))
        _span_near("shelf start", bars, d.get("start_t", 0), _expect_t(case, "start_t"), n, out)
    elif fam == "flat_top":
        d = ex.get("draw_flat_top") or {}
        w = _unscale(case, e["price"])
        _near("flat top line", d.get("price"), w, tol(w), out)
        n = _idx(bars, _expect_t(case, "end_t")) - _idx(bars, _expect_t(case, "start_t"))
        _span_near("flat top start", bars, d.get("start_t", 0), _expect_t(case, "start_t"), n, out)
    elif fam == "cup":
        pv, hd = ex.get("draw_pivot") or {}, ex.get("draw_handle") or {}
        w = _unscale(case, e["pivot_price"])
        _near("cup pivot", pv.get("price"), w, tol(w), out)
        for k in ("top", "floor"):
            w = _unscale(case, e["handle_" + k])
            _near(f"cup handle {k}", hd.get(k), w, tol(w), out)
        n = _idx(bars, _expect_t(case, "pivot_end_t")) - _idx(bars, _expect_t(case, "pivot_start_t"))
        _span_near("cup rim start", bars, pv.get("start_t", 0), _expect_t(case, "pivot_start_t"), n, out)
        hn = _idx(bars, _expect_t(case, "pivot_end_t")) - _idx(bars, _expect_t(case, "handle_start_t"))
        _span_near("cup handle start", bars, hd.get("start_t", 0), _expect_t(case, "handle_start_t"), hn, out)
        want_ref = e.get("rim_ref_price")
        got_ref = (ex.get("draw_rim_ref") or {}).get("price")
        if want_ref is None and got_ref is not None:
            out.append("cup: a rim reference line the judges did not see")
        elif want_ref is not None:
            w = _unscale(case, want_ref)
            _near("cup rim reference", got_ref, w, tol(w), out)
    elif fam == "inside_day":
        d = ex.get("draw_inside_day") or {}
        for k in ("trigger", "stop"):
            w = _unscale(case, e[k])
            _near(f"inside day {k}", d.get(k), w, tol(w), out)
    elif fam in SETUP_FAMILIES:
        w = _unscale(case, e["level"])
        _near(f"{fam} level", (ex.get("draw_setup") or {}).get("level"), w, tol(w), out)


def _check_sr(case, payload, atr, out):
    sr = payload.get("levels_sr")
    e = case["expect"]
    if not isinstance(sr, dict):
        out.append("S/R layer: no levels_sr block on the member chart")
        return
    if sr.get("withheld"):
        out.append(f"S/R layer: withheld ({sr['withheld']}) where the judges saw levels")
        return
    zones = list(sr.get("zones") or [])
    for wz in e["zones"]:
        bot, top = _unscale(case, wz["bot"]), _unscale(case, wz["top"])
        tol = _price_tol((bot + top) / 2.0, atr, case)
        hit = [z for z in zones if str(z.get("role", "")).lower() == wz["role"]
               and abs(float(z["bot"]) - bot) <= tol and abs(float(z["top"]) - top) <= tol]
        if not hit:
            near = sorted(zones, key=lambda z: abs((float(z["bot"]) + float(z["top"])) / 2 - (bot + top) / 2))
            seen = (f"nearest {near[0].get('role')} {float(near[0]['bot']):.4f}-{float(near[0]['top']):.4f}"
                    if near else "no zones at all")
            out.append(f"S/R {wz['role']} zone {bot:.4f}-{top:.4f}: not on the chart ({seen})")
    got_sides = sorted(str(t.get("side")) for t in sr.get("trendlines") or [])
    want_sides = sorted(t["side"] for t in e["trendlines"])
    for s in set(want_sides):
        if got_sides.count(s) < want_sides.count(s):
            out.append(f"S/R: {want_sides.count(s)} {s} trendline(s) judged, {got_sides.count(s)} drawn")


def _check_other_on_base(fam, case, payload, bars, atr, mine, out):
    from api.services import auto_structures as AS
    pid = PATTERN_IDS[fam]
    if not hasattr(AS, "_row_lines"):
        out.append("(3) cannot be checked: auto_structures has no _row_lines")
        return
    key, (s0, s1) = _key_and_span(fam, mine, bars)
    for r in _drawn_rows(payload):
        if r.get("pattern_id") == pid or r is mine:
            continue
        try:
            lines, span = AS._row_lines(r)
            if r.get("pattern_id") == "bc:base":
                # the base's top line where the member's chart DRAWS it: metrics_textbook.line when the textbook
                # round carries one, else the body pivot (auto_structures._breakout_lines, the same reading the
                # one-line-per-base pass compares since a0ac0ba156). The body pivot is not drawn when the textbook
                # line is, so measuring it reported a line no member sees.
                lines = [p for p, _s, _e in AS._breakout_lines(r)] or lines
        except Exception:  # noqa: BLE001 -- a row whose lines cannot be read is reported, not skipped
            out.append(f"extra drawing {r.get('pattern_id')}: its lines cannot be read")
            continue
        overlaps = span is None or (int(span[0]) <= s1 and int(span[1]) >= s0)
        close = [p for p in lines if abs(float(p) - key) <= ONE_BASE_ATR * atr]
        if overlaps and close:
            out.append(f"extra member drawing on the same base: {r.get('pattern_id')} line {close[0]:.4f} "
                       f"within {ONE_BASE_ATR} ATR of the judged {key:.4f}")


def _want_key(fam, case):
    if fam in SETUP_LINE_FAMILIES:
        return _unscale(case, case["expect"]["dets"][0]["anchors"][0]["price"])
    return _unscale(case, case["expect"][{"base": "pivot", "textbook": "buy_point", "double_bottom": "pivot",
                                          "shelf": "price", "cup": "pivot_price",
                                          "inside_day": "trigger", "remount": "level", "u_and_r": "level",
                                          "donchian_breakout": "level", "flat_top": "price"}[fam]])


#: Rules a passed blind round retired judged cases under: rule -> (what must still hold on the fixture's chart for
#: the retirement to explain the drawing's absence). A retired case whose rule no longer holds is red: the drawing is
#: then missing for some OTHER reason, which nobody judged.
def _trend_gate_holds(bars):
    from api.services.pattern_engine import base_draw as BD
    closes = [b["c"] for b in bars]
    return not BD.trend_ok(closes, len(closes) - 1)


#: The channel window a donchian line is drawn over: its 55-bar channel high is set inside it.
_DONCHIAN_WINDOW = 55


def _yield_window(case, bars):
    """(start_t, end_t) over which a yielding setup drawing meets the line it yields to: the donchian channel window
    (its 55-bar high is set inside it), or the judged rectangle box's own span."""
    if case["family"] == "rectangle":
        d = case["expect"]["dets"][0]
        return MP.ymd(case, d["start"]), MP.ymd(case, d["end"])
    return int(bars[max(0, len(bars) - 1 - _DONCHIAN_WINDOW)]["t"]), int(bars[-1]["t"])


def _base_line_holds(case, payload, bars):
    """one line per base (precedence round e; the rectangle ranks after the channel line): a member-drawn row ranked
    AHEAD of the family's setup drawing in the one-line-per-base order puts a breakout line (where the chart draws
    it) within ONE_BASE_ATR x ATR14 of the judged level (the rectangle: its top edge), over the yielding window
    (_yield_window). That drawing is why the setup drawing is not on the chart; without one, its absence is
    unexplained."""
    from api.services import auto_structures as AS
    order = list(AS.ONE_LINE_PER_BASE_PRIORITY)
    ahead = set(order[:order.index(PATTERN_IDS[case["family"]])])
    want, atr = _want_key(case["family"], case), MP.atr14(bars)
    w0, w1 = _yield_window(case, bars)
    for row in _drawn_rows(payload):
        if row.get("pattern_id") not in ahead:
            continue
        for p, s, e in AS._breakout_lines(row):
            if s <= w1 and w0 <= e and abs(float(p) - want) <= ONE_BASE_ATR * atr:
                return True
    return False


#: rule -> fn(case, payload, bars) -> True while the rule still explains the drawing's absence on this chart.
def _textbook_gate_holds(case, payload, bars):
    """recert B round 2: the strict textbook gate (pattern_engine.textbook_gate) withholds the judged inside day
    on this chart. Rebuilt from the judged trigger and stop on the as-of bar; the rule must still FAIL the chart,
    or the drawing is missing for some other reason nobody judged."""
    from api.services.pattern_engine import textbook_gate as TG
    if case["family"] != "inside_day":
        return _pivot_gate_holds(case, bars)
    e, k = case["expect"], float(case["bars"]["scale"])
    row = {"pattern_id": "draw:inside-day", "geometry": {"extras": {"draw_inside_day": {
        "trigger": float(e["trigger"]) / k, "stop": float(e["stop"]) / k, "end_t": bars[-1]["t"]}}}}
    return bool(TG.inside_day_fails(bars, row))


def _pivot_gate_holds(case, bars):
    """The interim pivot gate (shelf, double bottom): the member route, replayed on the same patched chart with the
    gate OFF, serves the family's row, and the gate fails that row. Without the row the absence is unexplained."""
    from api.routers import patterns as P
    from api.services import auto_structures as AS
    from api.services.pattern_engine import textbook_gate as TG
    sym = "CASE" + case["id"].replace("-", "").replace("_", "").upper()[-12:]
    old = AS.MEMBER_PIVOT_GATE_ROUND
    caches = [getattr(AS, n) for n in ("_CACHE", "_DRAWN_CACHE", "_SHELF_CACHE", "_SR_CACHE", "_SETUP_CACHE")
              if hasattr(AS, n)]
    try:
        AS.MEMBER_PIVOT_GATE_ROUND = None
        for c in caches:
            c.clear()
        out = P.get_detections(sym, _user={"id": 0, "role": "member", "plan": "pro"}, tf="D", types=None,
                               min_conf=50.0, confirmed_only=False, include_structures=True)
    finally:
        AS.MEMBER_PIVOT_GATE_ROUND = old
        for c in caches:
            c.clear()
    rows = _rows_of(out, PATTERN_IDS[case["family"]])
    if not rows:
        return False
    ts = [int(b["t"]) for b in bars]
    for row in rows:
        end = TG.end_of(row)
        if end is None or end not in ts or not TG.pivot_fails(bars[:ts.index(end) + 1], row):
            return False
    return True


RETIRE_RULES = {"trend_gate": lambda case, payload, bars: _trend_gate_holds(bars),
                "one_line_per_base": _base_line_holds,
                "textbook_gate": _textbook_gate_holds}


def retired_failures(case, payload, bars) -> list:
    """A judged case a NEWER passed blind round retired (`case["retired"]`): the judged drawing must now be ABSENT
    from the member chart -- no drawn row of the family's pattern id puts its key price within ONE_BASE_ATR x ATR14
    of the judged one -- and the retiring rule must still hold on the chart."""
    fam, r = case["family"], case["retired"]
    atr = MP.atr14(bars)
    out: list = []
    rule = RETIRE_RULES.get(r.get("rule"))
    if rule is None:
        return [f"retired under an unknown rule {r.get('rule')!r}"]
    if not rule(case, payload, bars):
        out.append(f"retired by {r.get('rule')}, but that rule no longer applies on this chart")
    want_key = _want_key(fam, case)
    for row in _rows_of(payload, PATTERN_IDS[fam]):
        try:
            keys = [_key_and_span(fam, row, bars)[0]]
        except (KeyError, TypeError, ValueError):
            out.append(f"a {PATTERN_IDS[fam]} row whose key price cannot be read")
            continue
        if fam == "textbook" and _finite((_ex(row).get("metrics_textbook") or {}).get("buy_point")):
            keys.append(float(_ex(row)["metrics_textbook"]["buy_point"]))   # the printed buy point too
        for key in keys:
            if abs(key - want_key) <= ONE_BASE_ATR * atr:
                out.append(f"retired drawing is back on the member chart: {PATTERN_IDS[fam]} at {key:.4f} "
                           f"(judged {want_key:.4f}); {r.get('reason')}")
                break
    return out


def _setup_rows(payload, pid):
    """The DRAWN rows of `pid` on the member's `setup_draws` key (the only key a setup drawing is served on)."""
    from api.services import auto_structures as AS
    drawn = getattr(AS, "_drawn_incumbent", None) or (lambda r: not _ex(r).get("stale"))
    return [r for r in (payload.get("setup_draws") or []) if r.get("pattern_id") == pid and drawn(r)]


def _det_misses(case, det, row, bars, atr):
    """Why `row` is not the judged `det`: its shape, its anchor count, and every anchor in order -- the price within
    min(TOL_ATR x ATR14, TOL_PCT x price), the bar within max(SPAN_BARS_MIN, SPAN_FRAC x span) sessions."""
    g = row.get("geometry") or {}
    an = g.get("anchors") or []
    if g.get("shape") != det["shape"]:
        return [f"shape {g.get('shape')!r} vs judged {det['shape']!r}"]
    if len(an) != len(det["anchors"]):
        return [f"{len(an)} anchors vs judged {len(det['anchors'])}"]
    n = (_idx(bars, MP.ymd(case, det["end"])) or 0) - (_idx(bars, MP.ymd(case, det["start"])) or 0)
    out: list = []
    for k, (a, w) in enumerate(zip(an, det["anchors"])):
        wp = _unscale(case, w["price"])
        _near(f"anchor {k} price", a.get("price"), wp, _price_tol(wp, atr, case), out)
        _span_near(f"anchor {k} bar", bars, a.get("t", 0), MP.ymd(case, w["d"]), n, out)
    return out


def setup_line_failures(case, payload, bars) -> list:
    """The setup lens (round-2 / round-3 setup drawings, the rectangle): (1) the judged drawing is still a drawn row of
    the family's id on the member's `setup_draws`; (2) every judged det (one row each: the crosses draw two, the 50-day
    and the 200-day curve) is matched by its own row with the judged shape, anchor count and every anchor within
    tolerance; (3) for a drawing the one-line-per-base pass settles (the rectangle), no drawn row ranked ahead of it
    puts a breakout line within ONE_BASE_ATR x ATR14 of its top edge over an overlapping span. The other setup ids are
    outside ONE_LINE_PER_BASE_PRIORITY: the member path does not settle them against other drawings, so (3) is not
    asserted for them."""
    from api.services import auto_structures as AS
    pid = PATTERN_IDS[case["family"]]
    atr = MP.atr14(bars)
    rows = _setup_rows(payload, pid)
    if not rows:
        drawn = sorted({r.get("pattern_id") for r in payload.get("setup_draws") or []})
        return [f"(1) no {pid} drawing on the member's setup_draws (setup rows served: {drawn or 'none'}; "
                f"setup_draws key {'present' if 'setup_draws' in payload else 'ABSENT'})"]
    out: list = []
    free, mine = list(rows), []
    for j, det in enumerate(case["expect"]["dets"]):
        if not free:
            out.append(f"(2) judged det {j}: no row left to match it")
            continue
        miss, row = min(((_det_misses(case, det, r, bars, atr), r) for r in free), key=lambda x: len(x[0]))
        if miss:
            out.extend(f"(2) det {j}: {m}" for m in miss)
        else:
            free.remove(row)
            mine.append(row)
    if pid in AS.ONE_LINE_PER_BASE_PRIORITY and mine:
        order = list(AS.ONE_LINE_PER_BASE_PRIORITY)
        ahead = set(order[:order.index(pid)])
        for p0, s0, e0 in AS._breakout_lines(mine[0]):
            for r in _drawn_rows(payload):
                if r.get("pattern_id") not in ahead:
                    continue
                for p, s, e in AS._breakout_lines(r):
                    if s <= e0 and s0 <= e and abs(float(p) - p0) <= ONE_BASE_ATR * atr:
                        out.append(f"(3) extra member drawing on the same base: {r.get('pattern_id')} line {p:.4f} "
                                   f"within {ONE_BASE_ATR} ATR of the judged {p0:.4f}")
    return out


def failures(case, payload, bars) -> list:
    fam = case["family"]
    atr = MP.atr14(bars)
    out: list = []
    if fam == "sr":
        _check_sr(case, payload, atr, out)
        return out
    if fam in SETUP_LINE_FAMILIES:
        return setup_line_failures(case, payload, bars)
    pid = PATTERN_IDS[fam]
    # a setup drawing is served on the member's `setup_draws` key and nowhere else
    rows = _setup_rows(payload, pid) if fam in SETUP_FAMILIES else _rows_of(payload, pid)
    if fam == "textbook":
        rows = [r for r in rows if isinstance(_ex(r).get("metrics_textbook"), dict)]
    if not rows:
        drawn = sorted({r.get("pattern_id") for r in _drawn_rows(payload)})
        out.append(f"(1) no {pid} drawing on the member chart (drawn instead: {drawn or 'nothing'})")
        return out
    # the judged drawing is the row closest to the judged key price
    want_key = _want_key(fam, case)
    if fam == "textbook":
        mine = min(rows, key=lambda r: abs(float(_ex(r)["metrics_textbook"].get("buy_point") or 1e18) - want_key))
    else:
        mine = min(rows, key=lambda r: abs(_key_and_span(fam, r, bars)[0] - want_key))
    _check_geometry(fam, case, mine, bars, atr, out)
    _check_other_on_base(fam, case, payload, bars, atr, mine, out)
    return out
