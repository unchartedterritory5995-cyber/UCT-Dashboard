"""PARITY: the member "flat top" drawing (display.flat_top_drawing) against the lab v2 rule itself.

lab flattop_draw_v2/common_v2.drawing_v2 (with lab flattop_draw/common_ftd.drawing under it) is the
code whose drawings passed the two pre-registered blind packets (A 2.60 [2.30, 2.83], B 2.57
[2.30, 2.80]). This file imports that code by path, runs it beside the dashboard code on the SAME
real bars, and requires the same answer. The lab and C:/data/bars.db live outside this repo, so the
file SKIPS when either is absent (a lab that cannot import is "absent", never a pass).

  * lab path: env `UCT_LAB_FLATTOP_V2` ONLY (no default); the file skips when it is unset
  * bars: the lab's own loader (common_ftd.Bars, bars.db opened mode=ro), converted to dashboard
    bars by the lab's recall_v2.to_dict_bars.

Levels:
  JUDGED    every one of the 30 blind-judged cases (out/key_A.json, out/key_B.json): the lab draws it,
            and the dashboard draws the SAME line price, start, touch markers and variant, on the
            scan's own 202-bar slice AND on the full history, and reproduces the key's facts.
  SCAN      the same 30 cases through the real path (detector + display.annotate on the 202-bar
            slice): wherever the detector reports the as-of session, the stamp IS that drawing.
  WITHHELD  every session of real histories: lab None <=> dashboard "no_fire"; lab drawn-but-not-v2
            <=> dashboard None with the reason of the FIRST failed lab gate; lab v2 <=> the same
            drawing. Every withheld reason must occur, so no branch passes by never being reached.
  LOOKAHEAD the dashboard drawing at session i on bars[:i+1] equals it with 30 extra future bars
            appended after i (the drawing reads nothing after i).
"""
import importlib.util
import json
import logging
import os
import random
import sys

import pytest

from api.services.pattern_engine import display
from api.services.pattern_engine.detectors.uct import uct_flat_top_breakout as FT
from api.services.pattern_engine.primitives.context import build_context

_LAB_DIR = os.environ.get("UCT_LAB_FLATTOP_V2") or ""
_BARS_DB = "C:/data/bars.db"     # the lab loader's own hard-coded read-only path
#: The window the daily scan hands the detector (registry min_bars), and so annotate.
_SLICE = FT.MIN_BARS
_REAL_HIST = 40                  # histories swept session by session
_SESSIONS = 320                  # trailing sessions per history
_REASONS = ("unconfirmed", "few_touches", "single_spike", "extended")
#: Ticker-sessions where the LAB withholds on G3 alone (found by running the lab rule over random
#: histories, 2026-10-18). G3 is rare (one in twelve confirmed team charts), so a random sample can
#: miss it; each is re-confirmed against the lab at test time, never trusted as typed.
_LAB_EXTENDED = (("ACAD", 20120313), ("KTOS", 20260105), ("CHE", 20140218), ("CHE", 20151023),
                 ("WU", 20190604), ("GIL", 20201008), ("ODC", 20101126))


def _import(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture(scope="module")
def lab():
    if not _LAB_DIR:
        pytest.skip("UCT_LAB_FLATTOP_V2 unset")
    path = os.path.join(_LAB_DIR, "common_v2.py")
    if not os.path.isfile(path):
        pytest.skip(f"lab flattop_draw_v2 not present at {_LAB_DIR}")
    if not os.path.isfile(_BARS_DB):
        pytest.skip(f"{_BARS_DB} not present")
    saved_path, saved_bc = list(sys.path), sys.dont_write_bytecode
    saved_disable = logging.root.manager.disable
    before = set(sys.modules)
    try:
        V = _import("uct_lab_flattop_v2", path)
        R = sys.modules.get("recall_v2")
        if R is None or not hasattr(R, "to_dict_bars"):
            pytest.skip("lab recall_v2 did not load beside common_v2")
    except Exception as e:  # noqa: BLE001 -- a lab that cannot import is absent, never a pass
        pytest.skip(f"lab common_v2.py did not import: {e!r}")
    finally:
        sys.path[:] = saved_path
        sys.dont_write_bytecode = saved_bc
        logging.disable(saved_disable)
    # the lab's own modules stay referenced by V; drop them from sys.modules so no later import
    # (the lab ships its own `api` package on its path) can resolve to them
    lab_root = os.path.normcase(os.path.dirname(os.path.abspath(_LAB_DIR)))
    lab_mods = {}
    for m in set(sys.modules) - before:
        f = getattr(sys.modules[m], "__file__", None) or ""
        if f and os.path.normcase(os.path.abspath(f)).startswith(lab_root):
            lab_mods[m] = sys.modules[m]
    for m in lab_mods:
        if m != "uct_lab_flattop_v2":
            sys.modules.pop(m, None)
    F = V.F
    assert "mode=ro" in F.DB, "the lab loader must open bars.db read-only"
    bars = F.Bars()
    yield {"V": V, "F": F, "to_dict": lab_mods["recall_v2"].to_dict_bars, "bars": bars}
    bars.c.close()


def _lab_reason(d):
    """The dashboard's reason for a lab result: None (drawn), no_fire, or the first failed gate."""
    if d is None:
        return "no_fire"
    if d["v2"]:
        return None
    if not d["confirmed"]:
        return "unconfirmed"
    for g, why in (("g1", "few_touches"), ("g2", "single_spike"), ("g3", "extended")):
        if not d[g]:
            return why
    raise AssertionError(f"lab v2 False with every gate True: {d}")


def _lab_drawing(tb, db, d):
    """The lab drawing in the dashboard's shape (bar times are the dashboard bars' own)."""
    return {"price": float(d["robust"]), "start_t": db[d["k0"]]["t"], "end_t": db[d["i"]]["t"],
            "touches": [{"t": db[j]["t"], "price": float(tb[j][2])} for j in d["touches"]],
            "label": "flat top", "variant": d["variant"]}


def _cmp(lab, tb, i):
    """Mismatch strings for session i of tuple bars tb (full history up to i on the lab side; the
    scan's trailing slice on the dashboard side)."""
    d = lab["V"].drawing_v2(tb[:i + 1], i)
    db = lab["to_dict"](tb[:i + 1])
    lo = max(0, len(db) - _SLICE)
    got, why = display.flat_top_drawing(db[lo:], len(db) - 1 - lo)
    want = _lab_reason(d)
    errs = []
    if why != want:
        errs.append(f"i={i}: reason dashboard={why} lab={want}")
    elif want is None and got != _lab_drawing(tb, db, d):
        errs.append(f"i={i}: drawing dashboard={got} lab={_lab_drawing(tb, db, d)}")
    return errs, want


def _cases():
    out = []
    for pk in ("A", "B"):
        with open(os.path.join(_LAB_DIR, "out", f"key_{pk}.json"), encoding="utf-8") as f:
            for cid, c in sorted(json.load(f)["cases"].items()):
                out.append((f"{pk}:{cid}", c))
    return out


def test_every_judged_case_is_drawn_identically(lab):
    cases = _cases()
    assert len(cases) == 30
    errs = []
    for key, c in cases:
        tb = lab["bars"].upto(c["ticker"], c["ts"], 100000)
        i = len(tb) - 1
        assert tb[i][0] == c["ts"], key
        d = lab["V"].drawing_v2(tb, i)
        assert d is not None and d["v2"], f"{key}: the lab itself no longer draws the judged case"
        # the key's recorded facts (written when the packet was drawn) still come out of the lab
        assert (d["variant"], d["prior_groups"], d["band_groups"], d["approach"], d["groups"]) == (
            c["variant"], c["prior_groups"], c["band_groups"], c["approach"], c["groups"]), key
        assert round(d["ext_atr"], 3) == c["close_minus_line_atr"], key
        db = lab["to_dict"](tb)
        want = _lab_drawing(tb, db, d)
        for lo in (len(db) - _SLICE, 0):                 # the scan's slice, and the full history
            got, why = display.flat_top_drawing(db[lo:], i - lo)
            if why is not None or got != want:
                errs.append(f"{key} lo={lo}: dashboard={got, why} lab={want}")
        assert len(want["touches"]) >= 3 and want["touches"][-1]["t"] <= want["end_t"]
    print(f"\njudged parity: {len(cases)} cases x 2 windows, mismatches={len(errs)}")
    assert errs == [], errs


def test_the_scan_path_stamps_the_judged_drawing(lab):
    """Detector + display.annotate on the scan's 202-bar slice, as the daily scan runs them."""
    stamped = other = 0
    errs = []
    for key, c in _cases():
        tb = lab["bars"].upto(c["ticker"], c["ts"], 100000)
        db = lab["to_dict"](tb)[-_SLICE:]
        dets = FT.detect_uct_flat_top_breakout(db, build_context(db, sym=c["ticker"]))
        display.annotate(dets, db)
        want, _ = display.flat_top_drawing(db, len(db) - 1)
        for det in dets:
            ex = det["geometry"]["extras"]
            if ex.get("trigger_bars_ago") == 0:
                stamped += 1
                if ex.get("draw_flat_top") != want or ex.get("draw_round") != display.FLAT_TOP_DRAW_ROUND:
                    errs.append(key)
            else:
                other += 1
                if "draw_flat_top" in ex or "draw_round" in ex:
                    errs.append(f"{key}: an older trigger was stamped")
    print(f"\nscan path: {stamped} of 30 judged cases reported as of their session and stamped; "
          f"{other} reported an older trigger (withheld); errors={len(errs)}")
    assert stamped > 0 and errs == [], errs


def test_every_session_of_real_histories_draws_or_withholds_like_the_lab(lab):
    B = lab["bars"]
    tickers = sorted({c["ticker"] for _, c in _cases()})
    pool = sorted(t for (t,) in B.c.execute(
        "select distinct ticker from ohlcv where tf='D' and ts>=20260901"))
    random.Random(20261018).shuffle(pool)
    tickers += [t for t in pool if t not in tickers][:_REAL_HIST - len(tickers)]
    total, seen, errs = 0, {}, []
    for t in tickers:
        tb = B.upto(t, 20261015, 100000)
        if len(tb) < 300:
            continue
        for i in range(max(260, len(tb) - _SESSIONS), len(tb)):
            e, why = _cmp(lab, tb, i)
            total += 1
            seen[why] = seen.get(why, 0) + 1
            errs += [f"{t} {x}" for x in e]
    # the lab's own G3 withholdings, and the five sessions either side of each
    for t, ts in _LAB_EXTENDED:
        tb = B.upto(t, 20261015, 100000)
        k = next(j for j, x in enumerate(tb) if x[0] == ts)
        assert _lab_reason(lab["V"].drawing_v2(tb[:k + 1], k)) == "extended", (t, ts)
        for i in range(k - 5, min(len(tb), k + 6)):
            e, why = _cmp(lab, tb, i)
            total += 1
            seen[why] = seen.get(why, 0) + 1
            errs += [f"{t} {x}" for x in e]
    print(f"\nreal parity: {total} sessions over {len(tickers)} histories + {len(_LAB_EXTENDED)} lab "
          f"G3 windows, outcomes={seen}, mismatches={len(errs)}")
    assert seen.get(None, 0) > 0, "nothing drawn in the sample: the drawn branch was never compared"
    for r in _REASONS:
        assert seen.get(r, 0) > 0, f"no '{r}' session in the sample: that branch was never compared"
    assert errs == [], errs[:10]


def test_the_drawing_reads_nothing_after_its_session(lab):
    """No lookahead: the drawing at i on bars[:i+1] equals it on bars[:i+1] + 30 wild future bars."""
    rnd = random.Random(7)
    n = drawn = 0
    errs = []
    for key, c in _cases():
        db = lab["to_dict"](lab["bars"].upto(c["ticker"], c["ts"], 100000))[-_SLICE - 40:]
        for i in sorted(rnd.sample(range(_SLICE, len(db)), 8)) + [len(db) - 1]:
            p = db[i]
            fut = [{"t": p["t"] + 86400 * (j + 1), "o": p["c"] * 1.3, "h": p["c"] * 1.6,
                    "l": p["c"] * 0.5, "c": p["c"] * 1.5, "v": 1e9} for j in range(30)]
            a = display.flat_top_drawing(db[:i + 1], i)
            b = display.flat_top_drawing(db[:i + 1] + fut, i)
            n += 1
            drawn += a[0] is not None
            if a != b:
                errs.append(f"{key} i={i}")
    print(f"\nlookahead: {n} comparisons ({drawn} drawn), mismatches={len(errs)}")
    assert drawn >= 30 and errs == [], errs
