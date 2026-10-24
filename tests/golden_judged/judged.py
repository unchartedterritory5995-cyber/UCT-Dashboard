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
"""
from __future__ import annotations

import math

from tests.golden_judged import member_path as MP

TOL_ATR = 0.25
TOL_PCT = 0.01
SPAN_BARS_MIN = 3
SPAN_FRAC = 0.10
ONE_BASE_ATR = 1.0

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
}
#: the setup drawings ride their own `setup_draws` key
SETUP_FAMILIES = ("remount", "u_and_r", "donchian_breakout")


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
    if fam == "cup":
        d = ex["draw_pivot"]
        return float(d["price"]), (int(d["start_t"]), int(d["end_t"]))
    if fam == "inside_day":
        d = ex["draw_inside_day"]
        return float(d["trigger"]), (int(d["start_t"]), int(d["end_t"]))
    if fam in SETUP_FAMILIES:
        return float(ex["draw_setup"]["level"]), (int(row["start_t"]), int(row["end_t"]))
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
        except Exception:  # noqa: BLE001 -- a row whose lines cannot be read is reported, not skipped
            out.append(f"extra drawing {r.get('pattern_id')}: its lines cannot be read")
            continue
        overlaps = span is None or (int(span[0]) <= s1 and int(span[1]) >= s0)
        close = [p for p in lines if abs(float(p) - key) <= ONE_BASE_ATR * atr]
        if overlaps and close:
            out.append(f"extra member drawing on the same base: {r.get('pattern_id')} line {close[0]:.4f} "
                       f"within {ONE_BASE_ATR} ATR of the judged {key:.4f}")


def failures(case, payload, bars) -> list:
    fam = case["family"]
    atr = MP.atr14(bars)
    out: list = []
    if fam == "sr":
        _check_sr(case, payload, atr, out)
        return out
    pid = PATTERN_IDS[fam]
    rows = _rows_of(payload, pid)
    if fam == "textbook":
        rows = [r for r in rows if isinstance(_ex(r).get("metrics_textbook"), dict)]
    if not rows:
        drawn = sorted({r.get("pattern_id") for r in _drawn_rows(payload)})
        out.append(f"(1) no {pid} drawing on the member chart (drawn instead: {drawn or 'nothing'})")
        return out
    # the judged drawing is the row closest to the judged key price
    want_key = _unscale(case, case["expect"][{"base": "pivot", "textbook": "buy_point", "double_bottom": "pivot",
                                              "shelf": "price", "cup": "pivot_price",
                                              "inside_day": "trigger", "remount": "level", "u_and_r": "level",
                                              "donchian_breakout": "level"}[fam]])
    if fam == "textbook":
        mine = min(rows, key=lambda r: abs(float(_ex(r)["metrics_textbook"].get("buy_point") or 1e18) - want_key))
    else:
        mine = min(rows, key=lambda r: abs(_key_and_span(fam, r, bars)[0] - want_key))
    _check_geometry(fam, case, mine, bars, atr, out)
    _check_other_on_base(fam, case, payload, bars, atr, mine, out)
    return out
