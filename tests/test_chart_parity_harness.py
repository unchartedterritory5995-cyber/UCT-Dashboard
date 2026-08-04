"""The parity harness's own gate — `capture()` must PROVE the chart settled.

─── WHY THIS FILE EXISTS ────────────────────────────────────────────────────

`tools/chart_parity.py` is the only pixel gate in this repo, and until
2026-08-02 its readiness signal was not one: the page flipped
``window.__chartReady`` from a fixed 3,500 ms ``setTimeout`` and ``capture()``
screenshotted ONCE. That is a clock, not a statement about the canvas — so every
number the gate has ever printed, including all of the zeros, was measured
against a stopwatch. The cost was measured: an A/B pair doing asymmetric
main-thread work came back 24 changed px on one scanline of the dashed
last-price line, on 3 runs in 5.

`capture()` now screenshots repeatedly until two CONSECUTIVE captures decode to
identical pixels, and raises `ChartNotSettledError` if that never happens.
**A gate on the gate is not ceremony here** — the whole branch's evidence rests
on this function, and the failure mode it protects against (accept whatever
frame you got) is exactly the shape of the code it replaced.

The page is faked because what is under test is the LOOP, not Playwright.
"""
from __future__ import annotations

import importlib.util
import json
import sys
from io import BytesIO
from pathlib import Path

import pytest
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]


def _load_chart_parity():
    """Import `tools/chart_parity.py` as a module (it is a script, not a package)."""
    spec = importlib.util.spec_from_file_location(
        "chart_parity_under_test", ROOT / "tools" / "chart_parity.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = mod
    spec.loader.exec_module(mod)
    return mod


cp = pytest.importorskip(
    "playwright.sync_api", reason="chart_parity imports playwright at module scope",
) and _load_chart_parity()


# ─── a page that hands out a scripted sequence of frames ─────────────────────

def png(color, *, dot=None):
    """A 40x20 PNG. `dot` paints ONE pixel a different colour — the shape of the
    real artefact this gate exists for (a single scanline of a dashed line)."""
    img = Image.new("RGB", (40, 20), color)
    if dot is not None:
        img.putpixel(dot[0], dot[1])
    buf = BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


class FakeLocator:
    def __init__(self, frames):
        self.frames = list(frames)
        self.taken = 0

    def wait_for(self, **_kw):
        pass

    def screenshot(self, path=None):
        i = min(self.taken, len(self.frames) - 1)
        self.taken += 1
        return self.frames[i]


class FakePage:
    def __init__(self, frames, ready=None):
        self.loc = FakeLocator(frames)
        self.ready = ready or {"ms": 3500, "reason": "stable", "frames": 4}
        self.goto_url = None
        self.waited_ms = []

    def goto(self, url, **_kw):
        self.goto_url = url

    def wait_for_function(self, *_a, **_kw):
        pass

    def evaluate(self, expr):
        if "__chartReadyMs" in expr:
            return dict(self.ready)
        return True

    def locator(self, _sel):
        return self.loc

    def wait_for_timeout(self, ms):
        self.waited_ms.append(ms)


def test_two_identical_captures_are_accepted_and_written(tmp_path):
    out = tmp_path / "a.png"
    page = FakePage([png("#123456"), png("#123456")])
    info = cp.capture(page, "http://x/r/chart", out, settle_ms=1)
    assert info["shots"] == 2, "a single screenshot is never proof of anything"
    assert info["settled"] is True
    assert out.read_bytes() == png("#123456")
    # The page's own account of its settle rides along, so a report can show
    # whether the in-page detector or the ceiling got there first.
    assert info["ready_reason"] == "stable"
    assert info["ready_ms"] == 3500


def test_a_chart_that_settles_LATE_is_waited_for(tmp_path):
    out = tmp_path / "a.png"
    frames = [png("#111111"), png("#222222"), png("#333333"), png("#333333")]
    page = FakePage(frames)
    info = cp.capture(page, "http://x", out, settle_ms=1)
    assert info["shots"] == 4
    assert out.read_bytes() == png("#333333"), "wrote a frame that was not the settled one"


def test_a_chart_that_NEVER_settles_is_a_loud_error_not_a_silent_frame(tmp_path):
    # THE REGRESSION THIS FILE IS FOR. The old behaviour was "take one shot and
    # use it"; a re-introduction of that reads exactly like this test's input
    # and must not produce an output file or a return value.
    out = tmp_path / "a.png"
    frames = [png(f"#{i:02x}0000") for i in range(1, 30)]
    page = FakePage(frames)
    with pytest.raises(cp.ChartNotSettledError) as e:
        cp.capture(page, "http://x/r/chart?case=flaky", out, stable_tries=5, settle_ms=1)
    assert not out.exists(), "accepted an unsettled frame onto disk"
    assert "r/chart?case=flaky" in str(e.value), "the error must name the capture that failed"
    assert page.loc.taken == 5, "the retry is bounded"


def test_stability_is_measured_on_PIXELS_and_a_single_pixel_counts(tmp_path):
    # The artefact that started all of this was 24 px on ONE row. A stability
    # check that compares sizes, or hashes with a stride, or rounds — would call
    # these two frames equal and hand back a mid-flight capture.
    out = tmp_path / "a.png"
    a = png("#0e0f0d")
    b = png("#0e0f0d", dot=((17, 9), (14, 15, 14)))
    # (There used to be an `assert len(a) == len(b) or True` here, meaning "size
    # is NOT the observable; pixels are". It was decorative commentary written as
    # an assertion that can never fail — in the one file whose entire subject is
    # checks that cannot fail. It is a comment now, which is what it always was.)
    page = FakePage([a, b, b])
    info = cp.capture(page, "http://x", out, settle_ms=1)
    assert info["shots"] == 3, "a one-pixel change was treated as settled"
    assert out.read_bytes() == b


def test_capture_waits_between_shots(tmp_path):
    page = FakePage([png("#111111"), png("#222222"), png("#222222")])
    cp.capture(page, "http://x", tmp_path / "a.png", settle_ms=250)
    assert page.waited_ms[:2] == [250, 250], "re-screenshotting without a delay proves nothing"


# ─── the bound the report is required to quote ───────────────────────────────

def test_flake_bound_is_the_95pct_upper_confidence_bound():
    # 5 consecutive zeros bound the per-run flake rate at ~45%, not at 0. This
    # number exists so a report cannot round "it passed" up to "it does not
    # flake" — the exact error the 5-run claim on this branch made.
    assert cp.flake_bound(1) == pytest.approx(0.95)
    assert cp.flake_bound(5) == pytest.approx(0.4507, abs=1e-4)
    assert cp.flake_bound(29) == pytest.approx(0.0981, abs=1e-4)
    assert cp.flake_bound(40) == pytest.approx(0.0721, abs=1e-4)
    # monotone: more runs can only ever tighten it
    seq = [cp.flake_bound(n) for n in range(1, 60)]
    assert all(a > b for a, b in zip(seq, seq[1:]))


# ─── the raise → EXIT CODE conversion, which is the gate's whole verdict ─────
#
# `capture()`'s raise is gated three times above. Until now the conversion of
# that raise into a non-zero exit was gated NOWHERE — and a review mutation of
# the single word that does it (`entry["pass"] = False` → `True`, in the error
# branch of the collapse) SURVIVED a 78-test pytest selection whose control
# passed. With that one word changed, a case whose every run raised
# `ChartNotSettledError` reports `🔴 ERROR` in `report.md` and **exit 0** to the
# thing that actually reads the verdict.
#
# On this branch the exit code IS the evidence: `parity_final.sh` echoes
# `EXIT=$?` after every run and every report quotes it. By the branch's own
# standard — a check is real only if something FAILS on it, and exit codes ARE a
# check — the last link needs a gate. These are it, at both altitudes: the
# reduction on its own, and `main()` end to end with the browser faked out.


def _errored_entry(n=3, tolerance=0):
    return {
        "name": "never_settles",
        "tolerance": tolerance,
        "runs": [{"run": i + 1,
                  "error": "ChartNotSettledError: #chart-export never settled",
                  "size_mismatch": False, "changed": None}
                 for i in range(n)],
    }


def test_a_case_whose_runs_ERRORED_collapses_to_pass_False():
    entry = cp.collapse_case(_errored_entry())
    assert entry["pass"] is False, (
        "an unsettled capture collapsed to a PASS — the loudest failure this "
        "harness can produce would exit 0"
    )
    assert "ChartNotSettledError" in entry["error"]
    assert entry["clean_runs"] == 0
    assert entry["flake_bound_95"] is None


def test_ONE_errored_run_among_clean_ones_still_fails_the_case():
    # Not "use the runs that worked". An error means a capture was never proven
    # settled, so the runs that DID produce a number were measured under
    # conditions this tool cannot vouch for.
    entry = {
        "name": "mostly_fine", "tolerance": 0,
        "runs": [
            {"run": 1, "changed": 0, "total": 100, "pct": 0.0, "size_mismatch": False,
             "a_size": [40, 20], "b_size": [40, 20], "diff_png": None},
            {"run": 2, "error": "ChartNotSettledError: boom", "size_mismatch": False, "changed": None},
        ],
    }
    cp.collapse_case(entry)
    assert entry["pass"] is False
    assert entry["flake_bound_95"] is None, "a bound cannot be quoted over an errored run"


def test_a_size_mismatch_is_a_failure_never_something_to_resize_past():
    entry = {
        "name": "reframed", "tolerance": 0,
        "runs": [{"run": 1, "size_mismatch": True, "a_size": [1200, 620],
                  "b_size": [1200, 640], "changed": None}],
    }
    cp.collapse_case(entry)
    assert entry["pass"] is False
    assert entry["changed"] is None


def test_the_verdict_is_the_WORST_run_not_the_best():
    runs = [{"run": i + 1, "changed": c, "total": 1000, "pct": c / 10, "size_mismatch": False,
             "a_size": [40, 20], "b_size": [40, 20], "diff_png": None}
            for i, c in enumerate([0, 0, 24, 0])]
    entry = cp.collapse_case({"name": "flaky", "tolerance": 0, "runs": runs})
    assert entry["changed"] == 24, "a gate that reports its best number hides its flake"
    assert entry["pass"] is False
    assert entry["changed_values"] == [0, 0, 24, 0]


# ─── `main()` end to end, with Chromium faked out ────────────────────────────
#
# The unit above gates the reduction. It cannot see `main()`'s two one-liners —
# calling the reduction at all, and `return 1 if report["failures"] else 0` —
# and those are the last links between "a chart never settled" and "the process
# said so". Playwright is replaced wholesale; nothing here launches a browser.

class _FakeCtx:
    def new_page(self):
        return object()

    def close(self):
        pass


class _FakeBrowser:
    def new_context(self, **_kw):
        return _FakeCtx()

    def close(self):
        pass


class _FakePlaywright:
    def __init__(self):
        self.chromium = self

    def launch(self, **_kw):
        return _FakeBrowser()

    def __enter__(self):
        return self

    def __exit__(self, *_a):
        return False


def _drive_main(monkeypatch, tmp_path, capture_impl, cases=("macd_only",), verify=None,
                extra_argv=()):
    monkeypatch.setattr(cp, "sync_playwright", lambda: _FakePlaywright())
    monkeypatch.setattr(cp, "capture", capture_impl)
    # The identities below say `kind: "dist"`, so `main` runs the served-vs-disk
    # check — which is the POINT (see `test_main_REFUSES_a_base_that_cannot_be…`)
    # and would otherwise fail these two on a base that is not a real server.
    # Stubbed HERE and nowhere else; the check has its own gates below, and one of
    # them drives `main` with the real function to prove it is still called.
    monkeypatch.setattr(cp, "verify_served_matches_disk", verify or (
        lambda base, ident, dist=None, **_kw: {"verified": True, "root": "/fake",
                                               "pid": 0, "index_sha256": "x",
                                               "files_checked": 1}))
    monkeypatch.setattr(cp, "read_build_identity", lambda base: {
        "url": base, "kind": "dist",
        "assets": ["index-aaaaaaaa.js"] if base.endswith("1") else ["index-bbbbbbbb.js"],
        "probes": {}, "engine_source": "unknown (bundled build)",
        "id": "aaaaaaaaaaaa" if base.endswith("1") else "bbbbbbbbbbbb",
    })
    monkeypatch.setattr(sys, "argv", [
        "chart_parity.py",
        "--base-a", "http://127.0.0.1:1",
        "--base-b", "http://127.0.0.1:2",
        "--cases", *cases,
        "--out", str(tmp_path / "out"),
        *extra_argv,
    ])
    return cp.main()


def test_main_EXITS_1_when_a_capture_never_settles(monkeypatch, tmp_path):
    def never_settles(page, url, out_png, *_a, **_kw):
        raise cp.ChartNotSettledError(f"#chart-export never settled: {url}")

    rc = _drive_main(monkeypatch, tmp_path, never_settles)

    assert rc == 1, (
        "a case whose every capture raised ChartNotSettledError exited 0 — the "
        "gate's verdict channel said PASS while its report said ERROR"
    )
    report = json.loads((tmp_path / "out" / "report.json").read_text(encoding="utf-8"))
    assert report["failures"] == 1
    assert report["results"][0]["pass"] is False
    assert "ChartNotSettledError" in report["results"][0]["error"]
    # …and the report a human reads agrees with the code a script reads.
    assert "🔴 ERROR" in (tmp_path / "out" / "report.md").read_text(encoding="utf-8")
    # …and no bound is stored for a report that failed. This is `main()`'s own
    # assignment, not `write_report`'s branch — the two are gated separately
    # because the JSON field is what a consumer reads without the prose.
    assert report["flake_bound_95"] is None


def test_main_EXITS_0_when_every_capture_is_identical(monkeypatch, tmp_path):
    # THE CONTROL FOR THE TEST ABOVE, in the file rather than in a shell history:
    # if `main()` returned 1 unconditionally, the ChartNotSettledError case would
    # pass for the wrong reason and prove nothing.
    frame = png("#0e0f0d")

    def settles(page, url, out_png, *_a, **_kw):
        Path(out_png).parent.mkdir(parents=True, exist_ok=True)
        Path(out_png).write_bytes(frame)
        return {"shots": 2, "settled": True, "ready_ms": 3500, "ready_reason": "stable"}

    rc = _drive_main(monkeypatch, tmp_path, settles)
    assert rc == 0
    report = json.loads((tmp_path / "out" / "report.json").read_text(encoding="utf-8"))
    assert report["failures"] == 0
    assert report["results"][0]["pass"] is True
    assert report["results"][0]["changed"] == 0
    # The other direction of the assignment above: a clean report DOES store one,
    # so "None on failure" cannot be satisfied by never storing anything.
    assert report["flake_bound_95"] == pytest.approx(0.95)   # one run bounds nothing


# ─── the flake bound is quoted only where it applies ─────────────────────────
#
# `flake_bound_95` used to be computed from `--repeat` alone, with no reference
# to whether those runs were clean. `tools/chart_parity_out/final/off40/report.json`
# therefore carried `"flake_bound_95": 0.072158` in a report with
# `"failures": 2`, and `off40/report.md:6` printed "40 consecutive clean runs put
# a 95% upper bound of 7.2%" verbatim above two `🔴 FAIL` rows. The prose was
# conditional enough for a careful reader to recover; a consumer reading the JSON
# field was simply given a number the report does not support.

def _report_with(results, *, repeat, failures, tmp_path):
    ident = {"url": "u", "kind": "dist", "assets": [], "probes": {},
             "engine_source": "unknown (bundled build)", "id": "abc123abc123"}
    return {
        "base_a": "a", "base_b": "b", "build_a": ident, "build_b": ident,
        "same_build": False, "same_build_declared": False, "self_check": False,
        "perturb_b": None, "perturb_b_instances": None, "instances_side": "b",
        "global_tolerance": 0, "tolerance_reason": "", "repeat": repeat,
        "flake_bound_95": round(cp.flake_bound(repeat), 6) if failures == 0 else None,
        "results": results, "failures": failures,
    }


def _clean_case(name, n, value=0):
    runs = [{"run": i + 1, "changed": value, "total": 1000, "pct": 0.0, "size_mismatch": False,
             "a_size": [40, 20], "b_size": [40, 20], "diff_png": None,
             "shots_a": 2, "shots_b": 2} for i in range(n)]
    return cp.collapse_case({"name": name, "tolerance": 0, "runs": runs})


def test_a_report_containing_a_FAILURE_quotes_no_flake_bound(tmp_path):
    failing = _clean_case("bb_only", 40, value=1799)
    assert failing["pass"] is False, "the fixture is not a failure — vacuous"
    out = tmp_path / "out"
    out.mkdir()
    cp.write_report(_report_with([failing], repeat=40, failures=1, tmp_path=tmp_path), out)
    md = (out / "report.md").read_text(encoding="utf-8")
    assert "consecutive clean runs put a 95% upper bound" not in md, (
        "printed a clean-run bound above a 🔴 FAIL row — the exact sentence "
        "off40/report.md:6 carried over two failing cases"
    )
    assert "No report-level flake bound is quoted" in md
    assert failing["flake_bound_95"] is None, "a failing case carried a per-case bound"
    assert failing["clean_runs"] == 0


def test_a_report_with_no_failures_DOES_quote_the_bound(tmp_path):
    # The other direction, so the test above cannot pass by the sentence never
    # being emitted at all.
    ok = _clean_case("rsi_only", 40)
    assert ok["pass"] is True
    assert ok["clean_runs"] == 40
    assert ok["flake_bound_95"] == pytest.approx(0.0721, abs=1e-4)
    out = tmp_path / "out"
    out.mkdir()
    cp.write_report(_report_with([ok], repeat=40, failures=0, tmp_path=tmp_path), out)
    md = (out / "report.md").read_text(encoding="utf-8")
    assert "40 consecutive clean runs put a 95% upper bound of **7.2%**" in md


# ─── `?priceline=0` — the two halves the page-side pin does not cover ────────
#
# `ChartRender`'s half is pinned by `ChartRender.instances.test.jsx`. The two
# HARNESS halves were not, and both survived `pytest tests/ -k "parity"`:
#
#   * deleting `if case.get("priceLine") is False: params["priceline"] = 0`
#     from `case_url` — the harness stops emitting the param;
#   * deleting `"priceLine": false` from `engine_rsi_toggle_off` — the case
#     stops asking for it.
#
# Removing either one silently restores a ~15%-per-run coin flip to this repo's
# only pixel gate, with no test and no visible symptom until someone runs
# `--repeat`. What it suppresses is a BISTABLE rasterisation of the dashed
# last-price line the candle series draws (one row, ~24 columns, alternating the
# candle down-colour and the background at a ~2% blend) — renderer noise, not a
# tolerance, and it is emitted to BOTH sides so it can never tell A from B.

def _case_named(name):
    cases = json.loads((ROOT / "tools" / "chart_parity_cases.json").read_text(encoding="utf-8"))
    for c in cases["cases"]:
        if c["name"] == name:
            return c
    raise AssertionError(f"case {name} is gone from chart_parity_cases.json")


def test_the_case_that_needs_priceline_0_still_DECLARES_it():
    case = _case_named("engine_rsi_toggle_off")
    assert case.get("priceLine") is False, (
        "engine_rsi_toggle_off stopped declaring `priceLine: false`. That case "
        "reproduced 24 changed px on one row in 3 runs of 5 — including with "
        "`--instances-side none`, legacy vs legacy, no engine at all — and the "
        "declaration is the whole fix."
    )
    # …and the reason travels with it, so the next reader does not have to find
    # this test to learn why.
    assert case.get("_priceLineReason"), "the declaration lost its written reason"


def test_a_priceLine_false_case_emits_priceline_0_ON_BOTH_SIDES():
    case = dict(_case_named("engine_rsi_toggle_off"))
    case["_settings"] = {}
    case.setdefault("fixedbars", "ramp200")
    a = cp.case_url("http://a", case, "", side="a", instances_mode="b")
    b = cp.case_url("http://b", case, "", side="b", instances_mode="b")
    assert "priceline=0" in a, "side A did not get ?priceline=0"
    assert "priceline=0" in b, "side B did not get ?priceline=0"


def test_a_case_that_does_NOT_declare_it_gets_no_priceline_param():
    # The control: if `case_url` emitted `priceline=0` unconditionally the test
    # above would pass while the param had stopped meaning anything.
    case = dict(_case_named("rsi_only"))
    case["_settings"] = {}
    case.setdefault("fixedbars", "ramp200")
    assert case.get("priceLine") is None
    assert "priceline" not in cp.case_url("http://a", case, "", side="a")


# ─── two bar fixtures, and the gate that keeps a case on the right one ───────
#
# `ramp200` is 200 DAILY bars; `intraday5m` is 579 five-minute extended-hours
# bars. `VWAP_TFS = {1,5,15,30,60}` in `StockChart.jsx` gates VWAP to intraday
# timeframes, so a VWAP case left on the daily fixture renders an EMPTY chart on
# BOTH sides and reports 0 changed pixels forever. That is not a hypothetical
# footgun — it is what every VWAP case in this file would have done before this
# fixture existed (B3 carry #4), and NOTHING in the harness could have told that
# 0 from a pass.
#
# The selection mechanism is `defaults` + a per-case override, which `case_url`
# already reads. What was missing is anything that FAILS when a case picks wrong,
# so these are the gate:
#
#   * a `fixedbars` naming a file that is not on disk. `ChartRender` sanitises
#     the name and dynamic-imports it; a miss is caught and degrades to "no
#     bars", i.e. a blank chart and a permanent 0 — never an error.
#   * a case that enables a VWAP-gated indicator on a non-intraday `tf`.
#   * the daily cases quietly moving off `ramp200`, which would expire every
#     daily number on this branch at once.

VWAP_TFS = {"1", "5", "15", "30", "60"}
_FIXTURES = ROOT / "app" / "src" / "pages" / "parityBars"


def _all_cases():
    doc = json.loads((ROOT / "tools" / "chart_parity_cases.json").read_text(encoding="utf-8"))
    return doc["defaults"], doc["cases"]


def fixture_problems(defaults, cases):
    """Every way a case can be pointed at the WRONG bar series, as a list.

    A pure function over the case list rather than a loop full of asserts, and
    that is deliberate. `test_a_VWAP_case_is_never_left_on_the_DAILY_fixture`
    has NO SUBJECT TODAY — `vwap_only` is still a settings-less placeholder, so
    a loop-with-asserts version of it iterates zero times and passes because it
    checked nothing. It would go on passing right up until the moment B3 Task 8
    filled the case in wrong, which is the one moment it exists for.

    Splitting the rule out means the rule itself can be handed a deliberately
    broken case list and required to REJECT it — see
    `test_the_fixture_rules_actually_REJECT_a_wrong_case`. That is the same
    "prove it can fail" step `--perturb-b` is for the pixels.
    """
    out = []
    for raw in cases:
        case = {**defaults, **raw}
        name = case["name"]
        fx = case["fixedbars"]
        path = _FIXTURES / f"{fx}.json"
        if not path.exists():
            # ChartRender sanitises `?fixedbars=` and then DYNAMICALLY IMPORTS it;
            # a name that resolves to nothing degrades to a chart-load failure
            # card, and two sides both missing it show the SAME card and diff to 0.
            out.append(f"{name}: fixedbars={fx!r} is not in app/src/pages/parityBars/")
            continue
        doc = json.loads(path.read_text(encoding="utf-8"))
        if case.get("tf") != doc["tf"]:
            # Silent when mismatched: the bars land through `barsOverride`
            # regardless, so the chart draws 5-minute candles while every
            # timeframe-dependent branch (VWAP's gate, the intraday session
            # filter, bucket sizes) reads 'D'.
            out.append(f"{name}: tf={case.get('tf')!r} but fixture {fx} is tf={doc['tf']!r}")
        vwap = ((case.get("settings") or {}).get("indicators") or {}).get("vwap") or {}
        if vwap.get("enabled"):
            if case.get("tf") not in VWAP_TFS:
                out.append(
                    f"{name}: enables VWAP on tf={case.get('tf')!r}, but VWAP_TFS gates it to "
                    f"{sorted(VWAP_TFS)} — the chart renders NO VWAP on either side and the "
                    f"case reports 0 changed pixels forever"
                )
            if fx == "ramp200":
                out.append(
                    f"{name}: enables VWAP on the DAILY fixture, whose `t` is 'YYYY-MM-DD'. "
                    f"computeVWAP does new Date(t*1000) — a string yields NaN"
                )
    return out


def test_no_case_is_pointed_at_the_wrong_bar_series():
    defaults, cases = _all_cases()
    assert fixture_problems(defaults, cases) == []


def test_the_fixture_rules_actually_REJECT_a_wrong_case():
    """The control. Without this, `fixture_problems` returning `[]`
    unconditionally would pass the test above with nothing checked — and the
    VWAP rule in particular has no real subject until Task 8 fills `vwap_only`
    in, so it is exactly the shape of check that rots into decoration."""
    defaults, _ = _all_cases()
    vwap_on = {"indicators": {"vwap": {"enabled": True, "color": "#26C6DA"}}}

    # 1. a fixture file that does not exist
    assert fixture_problems(defaults, [{"name": "x", "fixedbars": "no_such_fixture"}])

    # 2. THE ONE THIS FILE EXISTS FOR: VWAP left on the daily fixture. Both
    #    problems fire — the timeframe gate and the date-string `t`.
    daily_vwap = fixture_problems(defaults, [{"name": "vwap_on_daily", "settings": vwap_on}])
    assert len(daily_vwap) == 2, daily_vwap
    assert any("VWAP_TFS" in p for p in daily_vwap)
    assert any("NaN" in p for p in daily_vwap)

    # 3. tf and fixture disagreeing
    assert fixture_problems(defaults, [{"name": "y", "tf": "5", "fixedbars": "ramp200"}])

    # 4. …and the positive control: the SAME VWAP settings on the intraday
    #    fixture are fine, so the rule is not just "reject everything".
    assert fixture_problems(defaults, [{
        "name": "vwap_on_intraday", "tf": "5", "fixedbars": "intraday5m",
        "bars": 579, "settings": vwap_on,
    }]) == []


def test_the_intraday_smoke_case_exists_and_is_the_whole_fixture():
    """`intraday_bars_only` is the only thing that can catch a blank intraday
    render, and it only catches it if it frames the WHOLE fixture — a `bars`
    override shorter than the series would hide a fixture that is empty
    everywhere except its tail."""
    case = _case_named("intraday_bars_only")
    assert case["fixedbars"] == "intraday5m"
    assert case["tf"] == "5"
    doc = json.loads(
        (ROOT / "app" / "src" / "pages" / "parityBars" / "intraday5m.json").read_text(encoding="utf-8"))
    assert case["bars"] == len(doc["bars"]), (
        f"the smoke case frames {case['bars']} of {len(doc['bars'])} bars"
    )
    assert case["settings"] == {}, "the smoke case must draw NO indicator — it is the fixture's own control"


def test_the_DAILY_cases_are_still_on_ramp200():
    """The control for all of the above. Every number on this branch that is not
    the intraday smoke case was measured against 200 daily bars, and a defaults
    change or a stray override would expire the lot without a single test
    turning red."""
    defaults, cases = _all_cases()
    assert defaults["fixedbars"] == "ramp200" and defaults["tf"] == "D"
    daily = [{**defaults, **c} for c in cases if {**defaults, **c}["fixedbars"] == "ramp200"]
    assert len(daily) >= 11, f"only {len(daily)} cases left on the daily fixture"
    for case in daily:
        assert case["tf"] == "D"
        assert case.get("bars") == 200


def test_case_url_sends_the_INTRADAY_case_to_the_intraday_fixture():
    """The mechanism itself, end to end: `defaults` merge → `case_url` → URL.

    `?tf=` and `?fixedbars=` are what pick the timeframe and the bar series, and
    a case that overrides them has to reach the page with both changed. Asserted
    against the REAL case list, so it also fails if the case is deleted.
    """
    cases = cp.load_cases(ROOT / "tools" / "chart_parity_cases.json", ["intraday_bars_only"], False)
    assert len(cases) == 1
    url = cp.case_url("http://a", cases[0], "", side="a")
    assert "tf=5" in url, url
    assert "fixedbars=intraday5m" in url, url
    assert "bars=579" in url, url


def test_case_url_leaves_a_DAILY_case_on_the_daily_fixture():
    """The control for the test above. Without it, `case_url` hard-coding tf=5
    and fixedbars=intraday5m would pass it while every daily case silently moved
    to the wrong series."""
    cases = cp.load_cases(ROOT / "tools" / "chart_parity_cases.json", ["rsi_only"], False)
    url = cp.case_url("http://a", cases[0], "", side="a")
    assert "tf=D" in url, url
    assert "fixedbars=ramp200" in url, url
    assert "intraday5m" not in url, url


# ══════════════════════════════════════════════════════════════════════════════
# ─── THE STALE-SERVER HAZARD (B3 Task 11, prerequisite 1) ────────────────────
#
# `tools/spa_server.py` set `socketserver.TCPServer.allow_reuse_address = True`
# with NO bind check. On Windows that does not mean "reuse a TIME_WAIT socket",
# it means a second process may bind a port a first process is actively
# listening on: the second one prints its success banner, exits no error, and
# **every request keeps being answered by the first**. The operator then holds a
# terminal claiming to serve build B while the gate measures build A twice — 0
# changed px, exit 0, and a number about a tree nobody is holding.
#
# `chart_parity.py` enforced that A and B report DIFFERENT build identities,
# which catches that exact shape. It could not catch two DIFFERENT stale servers:
# both answer with self-consistent identities and every machine check passes.
# Task 10 closed it by hand, diffing the served chunk and its sha256 against the
# dist on disk before any case ran. A hand check is not a gate.
#
# Both halves are gated here, and both halves have a CONTROL: a check that only
# ever refuses is indistinguishable from a check that always refuses.

import hashlib as _hashlib
import os as _os
import socket as _socket
import threading as _threading
import urllib.request as _urlreq


def _load_spa_server():
    spec = importlib.util.spec_from_file_location(
        "spa_server_under_test", ROOT / "tools" / "spa_server.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = mod
    spec.loader.exec_module(mod)
    return mod


spa = _load_spa_server()


def _dist(tmp_path, name, marker):
    """A minimal built `dist`: an index.html advertising one hashed asset."""
    root = tmp_path / name
    (root / "assets").mkdir(parents=True)
    (root / "assets" / ("index-%s.js" % marker)).write_text("// %s\n" % marker, encoding="utf-8")
    (root / "index.html").write_text(
        '<!doctype html><html><head><script type="module" '
        'src="/assets/index-%s.js"></script></head><body></body></html>' % marker,
        encoding="utf-8")
    return root


def _serve(root):
    """Start a real spa_server on a free port; returns (base_url, stop())."""
    import functools
    handler = functools.partial(spa.SPAHandler, directory=str(root))
    httpd = spa.ExclusiveTCPServer(("127.0.0.1", 0), handler)
    port = httpd.server_address[1]
    t = _threading.Thread(target=httpd.serve_forever, daemon=True)
    t.start()

    def stop():
        httpd.shutdown()
        httpd.server_close()
        t.join(timeout=5)

    return "http://127.0.0.1:%d" % port, stop


# ─── half one: the server refuses to share a port ────────────────────────────

def test_spa_server_REFUSES_to_start_on_a_port_that_is_already_listening(tmp_path):
    """⭐ THE BUG, DRIVEN.

    ⚠️ THE PRE-FIX BEHAVIOUR IS A HANG, NOT A FAILURE, which is why `main` is
    driven on a THREAD with a join timeout rather than called directly. The old
    code bound the held port, printed `serving …`, and went into `serve_forever`
    — so a direct call here would block this test forever instead of failing it,
    and "the suite never finished" is not a verdict. A live thread IS the
    assertion: it means the port was taken."""
    root = _dist(tmp_path, "A", "aaaaaaaa")
    holder = _socket.socket(_socket.AF_INET, _socket.SOCK_STREAM)
    holder.bind(("127.0.0.1", 0))
    holder.listen(1)
    port = holder.getsockname()[1]
    outcome = {}

    def run():
        try:
            spa.main([str(root), str(port)])
            outcome["returned"] = True
        except SystemExit as e:            # noqa: PERF203 — the expected path
            outcome["exit"] = str(e)
        except BaseException as e:         # noqa: BLE001
            outcome["error"] = f"{type(e).__name__}: {e}"

    try:
        th = _threading.Thread(target=run, daemon=True)
        th.start()
        th.join(timeout=15)
        assert not th.is_alive(), (
            "spa_server BOUND a port another socket was already listening on and started "
            "serving — that is the whole hazard: the operator's terminal names this build "
            "while every request is answered by the other one")
        assert "exit" in outcome, outcome
        assert "REFUSING TO START" in outcome["exit"], outcome["exit"]
        # ⭐ AND IT MUST BE THE *PROBE* THAT REFUSED, not the bind falling over.
        # There are two independent mechanisms here (the pre-bind connect probe
        # and `allow_reuse_address = False` + SO_EXCLUSIVEADDRUSE) and either one
        # alone produces a SystemExit — so an assertion on "it refused" is killed
        # by neither mutation. Naming the probe's own wording pins the mechanism
        # this case is about; the structural test below pins the other.
        assert "already listening on" in outcome["exit"], outcome["exit"]
        assert str(port) in outcome["exit"]
    finally:
        holder.close()


def test_the_bind_check_is_NOT_just_always_refusing(tmp_path):
    """THE CONTROL. A check that refuses every port would pass the test above
    while making the harness unusable — and `port_is_taken` returning True
    unconditionally is a one-character mutation."""
    s = _socket.socket(_socket.AF_INET, _socket.SOCK_STREAM)
    s.bind(("127.0.0.1", 0))
    free_port = s.getsockname()[1]
    s.close()                                   # …and now nothing holds it
    assert spa.port_is_taken("127.0.0.1", free_port) is False
    base, stop = _serve(_dist(tmp_path, "B", "bbbbbbbb"))
    try:
        # …and the positive half against a server that really is up, so "False"
        # cannot be satisfied by the probe never connecting to anything.
        assert spa.port_is_taken("127.0.0.1", int(base.rsplit(":", 1)[1])) is True
    finally:
        stop()


def test_the_server_does_NOT_set_allow_reuse_address():
    """The structural half. The pre-bind probe is a race — two servers started in
    the same instant both see a free port — so exclusivity has to be enforced by
    the socket as well, and that is one attribute a future edit can flip back."""
    assert spa.ExclusiveTCPServer.allow_reuse_address is False
    # …and it must not have been set globally on the base class either, which is
    # exactly what the old line did (reaching every other TCPServer in the process).
    import socketserver as _ss
    assert _ss.TCPServer.allow_reuse_address is False


# ─── half two: what is SERVED equals what is on DISK ─────────────────────────

def test_the_server_and_its_verifier_name_ONE_string():
    """A second copy of `/__parity_root` in the harness would silently degrade
    every base to 'cannot name its root' the day either side was renamed."""
    assert cp.PARITY_ROOT_PATH == spa.PARITY_ROOT_PATH


def test_a_real_server_reports_the_root_it_is_serving_and_still_falls_back(tmp_path):
    root = _dist(tmp_path, "A", "aaaaaaaa")
    base, stop = _serve(root)
    try:
        with _urlreq.urlopen(base + cp.PARITY_ROOT_PATH, timeout=10) as r:
            payload = json.loads(r.read().decode("utf-8"))
        assert Path(payload["root"]).resolve() == root.resolve()
        assert payload["index_sha256"] == _hashlib.sha256(
            (root / "index.html").read_bytes()).hexdigest()
        # …and the SPA fallback, which is the file's entire reason to exist, is
        # not broken by the new route.
        with _urlreq.urlopen(base + "/r/chart?x=1", timeout=10) as r:
            assert b"<!doctype html>" in r.read().lower()
    finally:
        stop()


def _fake_get_from(root, root_payload=None, override=None):
    """An HTTP double answering from `root`, so a mismatch can be injected."""
    def get(url):
        path = "/" + url.split("//", 1)[1].split("/", 1)[1] if "//" in url else url
        if path == cp.PARITY_ROOT_PATH:
            body = json.dumps(root_payload if root_payload is not None
                              else {"root": str(root), "pid": 1, "index_sha256": None})
            return 200, body.encode("utf-8")
        if override and path in override:
            return 200, override[path]
        disk = root / path.lstrip("/").replace("/", _os.sep)
        if disk.is_file():
            return 200, disk.read_bytes()
        return 404, b""
    return get


def _ident(assets):
    return {"url": "http://127.0.0.1:9", "kind": "dist", "assets": assets,
            "probes": {}, "engine_source": "unknown (bundled build)", "id": "deadbeefcafe"}


def test_a_FAITHFUL_server_verifies_and_reports_what_it_checked(tmp_path):
    """THE CONTROL FOR EVERY REFUSAL BELOW, and it asserts a NONZERO file count:
    a verifier whose loop never ran would 'pass' every one of them."""
    root = _dist(tmp_path, "A", "aaaaaaaa")
    out = cp.verify_served_matches_disk(
        "http://127.0.0.1:9", _ident(["index-aaaaaaaa.js"]), root,
        get=_fake_get_from(root))
    assert out["verified"] is True
    assert out["files_checked"] == 2, "index.html + one hashed asset"
    assert Path(out["root"]).resolve() == root.resolve()


def test_a_server_SERVING_ANOTHER_DIST_is_refused_by_name(tmp_path):
    """THE HAZARD ITSELF: A holds the port, the operator starts B on it, B's
    banner prints, and the port keeps answering with A."""
    a = _dist(tmp_path, "A", "aaaaaaaa")
    b = _dist(tmp_path, "B", "bbbbbbbb")
    with pytest.raises(cp.ServedContentError) as ei:
        cp.verify_served_matches_disk(
            "http://127.0.0.1:9", _ident(["index-aaaaaaaa.js"]), b,   # …but it serves A
            get=_fake_get_from(a))
    assert "is serving" in str(ei.value)


def test_a_BYTE_DIFFERENCE_between_wire_and_disk_is_refused(tmp_path):
    """The case the identity check provably cannot reach: the root MATCHES and
    the served bytes still do not. Two different stale servers land here."""
    root = _dist(tmp_path, "A", "aaaaaaaa")
    stale = _fake_get_from(root, override={"/assets/index-aaaaaaaa.js": b"// somebody else\n"})
    with pytest.raises(cp.ServedContentError) as ei:
        cp.verify_served_matches_disk(
            "http://127.0.0.1:9", _ident(["index-aaaaaaaa.js"]), root, get=stale)
    assert "does not match the file on disk" in str(ei.value)


def test_an_ASSET_MISSING_from_the_named_dist_is_refused(tmp_path):
    root = _dist(tmp_path, "A", "aaaaaaaa")
    (root / "assets" / "index-aaaaaaaa.js").unlink()
    with pytest.raises(cp.ServedContentError) as ei:
        cp.verify_served_matches_disk(
            "http://127.0.0.1:9", _ident(["index-aaaaaaaa.js"]), root,
            get=_fake_get_from(root, override={"/assets/index-aaaaaaaa.js": b"// ghost\n"}))
    assert "does not exist under" in str(ei.value)


def test_a_server_that_cannot_NAME_its_root_is_refused(tmp_path):
    """An spa_server started BEFORE this change answers `/__parity_root` through
    its own SPA fallback — a 200 carrying index.html. That is precisely the state
    a stale listener from an earlier run is in, so "a 200 that is not JSON" has to
    be ABSENT rather than present-and-odd."""
    root = _dist(tmp_path, "A", "aaaaaaaa")

    def old_server(url):
        return 200, (root / "index.html").read_bytes()

    assert cp.read_served_root("http://127.0.0.1:9", get=old_server) is None
    with pytest.raises(cp.ServedContentError) as ei:
        cp.verify_served_matches_disk(
            "http://127.0.0.1:9", _ident(["index-aaaaaaaa.js"]), None, get=old_server)
    assert "cannot say WHICH DIRECTORY" in str(ei.value)


def test_a_DEV_server_is_not_asked_for_a_dist_it_does_not_have():
    """The narrowing that keeps the check honest rather than merely strict: a
    `vite dev` base has no bundle on disk, and its identity is already derived
    from the CONTENT of real source files (`BUILD_PROBE_PATHS`)."""
    def must_not_fetch(_url):
        raise AssertionError("a dev base was asked for a bundle")

    ident = {"url": "http://127.0.0.1:5173", "kind": "dev", "assets": [],
             "probes": {}, "engine_source": "present", "id": "0123456789ab"}
    out = cp.verify_served_matches_disk("http://127.0.0.1:5173", ident, None, get=must_not_fetch)
    assert out["verified"] is False


@pytest.mark.parametrize("bad_side", ["1", "2"])
def test_main_REFUSES_a_base_that_cannot_be_verified(monkeypatch, tmp_path, bad_side):
    """⭐ THE WIRING. Every test above interrogates the function directly; this is
    the only one that proves `main` still CALLS it. Without it the whole check
    could be deleted from `main` and this file would stay green.

    ⚠️ BOTH SIDES, PARAMETRISED, and that is not symmetry for its own sake: a
    mutation that removed only side A's call SURVIVED the single-sided version
    of this test, because side B still raised and the assertion could not tell
    the two apart. The stale listener is at least as likely to be holding the
    baseline's port as the candidate's."""
    def refuse(base, ident, dist=None, **_kw):
        if base.endswith(bad_side):
            raise cp.ServedContentError("stale listener")
        return {"verified": True, "root": "/fake", "pid": 0,
                "index_sha256": "x", "files_checked": 2}

    frame = png("#0e0f0d")

    def settles(page, url, out_png, *_a, **_kw):
        Path(out_png).parent.mkdir(parents=True, exist_ok=True)
        Path(out_png).write_bytes(frame)
        return {"shots": 2, "settled": True, "ready_ms": 1, "ready_reason": "stable"}

    with pytest.raises(SystemExit) as ei:
        _drive_main(monkeypatch, tmp_path, settles, verify=refuse)
    assert "SERVED-VS-DISK CHECK FAILED" in str(ei.value)


def test_the_verified_root_reaches_the_REPORT():
    """A check nobody can read after the fact is half a check. Task 10's numbers
    are trustworthy only because a human wrote the sha down by hand; this puts it
    in the artefact."""
    ident = _ident(["index-aaaaaaaa.js"])
    ident["served"] = {"verified": True, "root": "/tmp/parity-B", "pid": 42,
                       "index_sha256": "abc123", "files_checked": 2}
    line = cp.identity_line("B (candidate)", ident)
    assert "served == disk" in line
    assert "parity-B" in line


# ══════════════════════════════════════════════════════════════════════════════
# ─── B5: THE GATE LEARNS TO MEASURE AN *INTENDED* CHANGE ─────────────────────
#
# Every gate on this branch has been `changed <= tolerance` with `tolerance == 0`.
# B5's cutover turns the indicator bands into real LWC panes, so it changes the
# picture BY CONSTRUCTION and that sentence stops being available. A `--tolerance`
# cannot replace it: a budget passes anything under the budget, so it also hides
# the next change of the same size, and it cannot say WHERE the change landed.
#
# Three mechanisms replace it, and each one is gated here in both directions:
#
#   * `expect` — an EXACT per-case number that must hold on EVERY run. Not the
#     worst run: variance is itself a failure, because a number that moves is a
#     number nobody can sign off. A regression SMALLER than the declared number
#     fails too, which is the thing a tolerance cannot do.
#   * `regions` — named rectangles with their own expectations, counted from the
#     SAME mask the headline number came from, plus a `rest` bucket that is
#     COMPUTED BY MASK SUBTRACTION and that a case may not declare. A pixel
#     nobody named lands in `rest`, and `rest` always expects 0.
#   * the PANE MANIFEST — pane count, per-pane pixel height, per-series pane
#     index and priceScaleId, read off the page and diffed as JSON. A change that
#     moves pixels but not the manifest, or the manifest but not pixels, is a
#     regression by definition: one of the two is lying.


def _img(tmp_path, name, size=(10, 10), dots=()):
    img = Image.new("RGB", size, (0, 0, 0))
    for xy in dots:
        img.putpixel(xy, (255, 255, 255))
    p = tmp_path / name
    img.save(p)
    return p


# ─── regions: the same mask, split ───────────────────────────────────────────

def test_region_counts_split_the_same_mask_the_headline_number_came_from(tmp_path):
    # Two 10x10 images differing in exactly one 2x2 block at (1,1).
    pa = _img(tmp_path, "a.png")
    pb = _img(tmp_path, "b.png", dots=[(x, y) for x in (1, 2) for y in (1, 2)])
    out = cp.diff(pa, pb, regions=[{"name": "corner", "box": [0, 0, 5, 5]}])
    assert out["changed"] == 4
    # The region count is derived from the SAME mask, so it CANNOT disagree.
    assert out["regions"] == {"corner": 4, "rest": 0}


def test_rest_is_computed_and_cannot_be_declared_away(tmp_path):
    pa = _img(tmp_path, "a.png")
    pb = _img(tmp_path, "b.png", dots=[(8, 8)])      # OUTSIDE the declared region
    out = cp.diff(pa, pb, regions=[{"name": "corner", "box": [0, 0, 5, 5]}])
    assert out["regions"]["corner"] == 0
    assert out["regions"]["rest"] == 1, (
        "a changed pixel nobody named vanished — `rest` is the bucket that catches "
        "the cutover moving something into a rectangle no case declared")


def test_declaring_a_region_named_rest_is_refused():
    with pytest.raises(SystemExit) as ei:
        cp.validate_regions([{"name": "rest", "box": [0, 0, 1, 1]}])
    assert "rest" in str(ei.value)


def test_overlapping_regions_do_not_double_count_into_rest(tmp_path):
    pa = _img(tmp_path, "a.png")
    pb = _img(tmp_path, "b.png", dots=[(2, 2)])
    out = cp.diff(pa, pb, regions=[
        {"name": "left", "box": [0, 0, 5, 10]},
        {"name": "upper", "box": [0, 0, 10, 5]},      # overlaps `left`
    ])
    # `rest` is a MASK subtraction, not `changed - sum(regions)`; the naive
    # arithmetic gives 1 - (1 + 1) = -1 here, and `outside = mask` gives 1.
    assert out["regions"] == {"left": 1, "upper": 1, "rest": 0}


def test_a_zero_area_region_is_refused():
    # A region that can only ever report 0 reads exactly like a region that is
    # holding the line. It is not one.
    for box in ([4, 4, 4, 9], [4, 4, 9, 4], [9, 9, 4, 4]):
        with pytest.raises(SystemExit) as ei:
            cp.validate_regions([{"name": "flat", "box": box}])
        assert "zero area" in str(ei.value)


def test_a_region_that_falls_off_the_canvas_is_refused(tmp_path):
    # The same failure with a different cause: a box past the edge counts the
    # padding Pillow invents as "unchanged", so it under-reports forever. The
    # image size is only known inside `diff`, which is where this one lives.
    pa = _img(tmp_path, "a.png")
    pb = _img(tmp_path, "b.png", dots=[(2, 2)])
    with pytest.raises(SystemExit) as ei:
        cp.diff(pa, pb, regions=[{"name": "past_the_edge", "box": [0, 0, 40, 40]}])
    assert "outside the 10x10 canvas" in str(ei.value)


def test_two_regions_may_not_share_a_name():
    with pytest.raises(SystemExit):
        cp.validate_regions([{"name": "dup", "box": [0, 0, 2, 2]},
                             {"name": "dup", "box": [2, 2, 4, 4]}])


def test_a_diff_with_no_regions_declared_still_reports_the_key(tmp_path):
    # THE CONTROL for every region test above: `regions` is opt-in, and 44 stored
    # baselines were measured without it. A case that declares none must still be
    # measured exactly as before, and the key must exist so a consumer of
    # report.json never has to guess whether the run predates this.
    pa = _img(tmp_path, "a.png")
    pb = _img(tmp_path, "b.png", dots=[(2, 2)])
    out = cp.diff(pa, pb)
    assert out["changed"] == 1
    assert out["regions"] is None


# ─── `expect`: an equality, on every run ─────────────────────────────────────

def test_expect_is_an_EQUALITY_and_a_smaller_diff_fails_too():
    entry = {"name": "x", "tolerance": 0, "expect": 88, "runs": [
        {"changed": 88, "size_mismatch": False}, {"changed": 87, "size_mismatch": False}]}
    # 87 < 88. A tolerance of 88 would PASS this. It is a regression: the change
    # that was signed off is not the change that happened.
    assert cp.collapse_case(entry)["pass"] is False


def test_expect_demands_zero_variance_across_every_run():
    entry = {"name": "x", "tolerance": 0, "expect": 88, "runs": [
        {"changed": 88, "size_mismatch": False}, {"changed": 88, "size_mismatch": False}]}
    assert cp.collapse_case(entry)["pass"] is True
    entry["runs"][1]["changed"] = 89
    assert cp.collapse_case(entry)["pass"] is False, "variance upward"
    # ⚠️ AND DOWNWARD, WHICH IS THE HALF A WORST-RUN CHECK CANNOT SEE AT ALL.
    # Written with 89 alone this case was NOT lethal to
    # `entry["pass"] = not run_failures(entry, worst)` — the deviating run WAS
    # the worst one, so the mutation caught it by accident and the test named
    # "zero variance across every run" was gating something weaker than its name.
    # 87 is invisible to any check that looks only at the maximum.
    entry["runs"][1]["changed"] = 87
    assert cp.collapse_case(entry)["pass"] is False, (
        "a run BELOW the declared number passed — the verdict is reading the worst "
        "run, not every run, and `expect` is only an equality on one of them")


def test_a_run_that_misses_its_expect_leaves_the_case_with_NO_flake_bound():
    # `clean_runs` and the verdict must count against the SAME rule. When they
    # did not, `flake_bound_95` was computed from runs the verdict had rejected —
    # the exact defect `off40/report.json` shipped at report level.
    entry = cp.collapse_case({"name": "x", "tolerance": 0, "expect": 88, "runs": [
        {"run": 1, "changed": 88, "size_mismatch": False},
        {"run": 2, "changed": 89, "size_mismatch": False}]})
    assert entry["pass"] is False
    assert entry["clean_runs"] == 1
    assert entry["flake_bound_95"] is None


def test_a_case_at_its_expect_on_every_run_DOES_carry_a_bound():
    # The other direction, so the test above cannot pass by a bound never being
    # emitted. A declared non-zero number held over n runs is exactly the claim
    # `1 - 0.05^(1/n)` bounds.
    entry = cp.collapse_case({"name": "x", "tolerance": 0, "expect": 88, "runs": [
        {"run": i + 1, "changed": 88, "size_mismatch": False} for i in range(20)]})
    assert entry["pass"] is True
    assert entry["clean_runs"] == 20
    assert entry["flake_bound_95"] == pytest.approx(0.1391, abs=1e-4)


def test_a_region_expectation_fails_the_case_even_when_the_total_matches():
    # THE POINT: the same total can be the WRONG picture. 88 px that moved from
    # the oscillator strip into the price pane is a regression with a green total.
    entry = {"name": "x", "tolerance": 0, "expect": 88,
             "expect_regions": {"price_plot": 0, "osc_strip": 88},
             "runs": [{"run": 1, "changed": 88, "size_mismatch": False,
                       "regions": {"price_plot": 88, "osc_strip": 0, "rest": 0}}]}
    assert cp.collapse_case(entry)["pass"] is False
    assert any("price_plot" in m for m in entry["expectation_failures"])


def test_an_unnamed_pixel_in_REST_fails_a_case_whose_named_regions_are_perfect():
    entry = {"name": "x", "tolerance": 0, "expect": 89,
             "expect_regions": {"osc_strip": 88},
             "runs": [{"run": 1, "changed": 89, "size_mismatch": False,
                       "regions": {"osc_strip": 88, "rest": 1}}]}
    # `rest` is never declared and always expects 0 — that is what makes it the
    # bucket a cutover cannot hide a pixel in.
    assert cp.collapse_case(entry)["pass"] is False
    assert any("rest" in m for m in entry["expectation_failures"])


def test_a_case_with_regions_all_where_it_said_they_would_be_PASSES():
    """THE CONTROL for both tests above: a region gate that refused everything
    would satisfy them while making the whole mechanism unusable."""
    entry = {"name": "x", "tolerance": 0, "expect": 88,
             "expect_regions": {"price_plot": 0, "osc_strip": 88},
             "runs": [{"run": 1, "changed": 88, "size_mismatch": False,
                       "regions": {"price_plot": 0, "osc_strip": 88, "rest": 0}}]}
    assert cp.collapse_case(entry)["pass"] is True


def test_a_case_that_declares_NOTHING_still_collapses_on_its_tolerance():
    """⭐ THE BACKWARDS-COMPATIBILITY RAIL. B5's whole design rests on zero
    surviving twelve of thirteen tasks, which means every case that does NOT
    declare an `expect` has to keep reading the number it reads today. Asserted
    against the REAL case list, entry-for-entry, through the same construction
    `main()` uses."""
    doc = json.loads((ROOT / "tools" / "chart_parity_cases.json").read_text(encoding="utf-8"))
    defaults = doc["defaults"]
    checked = 0
    for raw in doc["cases"]:
        case = {**defaults, **raw}
        entry = cp.case_entry(case, tolerance=0, expect=None)
        if entry["expect"] is not None or entry["expect_regions"]:
            continue                       # a case that HAS declared one (B5 T11+)
        checked += 1
        for values, want in (([0, 0, 0], True), ([0, 1, 0], False), ([9], False)):
            entry["runs"] = [{"run": i + 1, "changed": v, "size_mismatch": False}
                             for i, v in enumerate(values)]
            got = cp.collapse_case(dict(entry, runs=entry["runs"]))
            assert got["pass"] is want, f"{case['name']} {values}"
            assert got["changed"] == max(values), "the headline is still the WORST run"
    assert checked >= 24, f"only {checked} undeclared cases — the rail lost its subject"


# ─── the pane manifest ───────────────────────────────────────────────────────

def test_manifest_diff_is_empty_when_both_sides_report_the_same_layout():
    m = {"chartHeight": 594, "separatorPx": 1,
         "panes": [{"index": 0, "height": 594, "series": []}]}
    assert cp.manifest_diff(m, json.loads(json.dumps(m))) == []


def test_manifest_diff_names_the_pane_that_moved():
    a = {"chartHeight": 594, "separatorPx": 1,
         "panes": [{"index": 0, "height": 594, "series": []}]}
    b = {"chartHeight": 594, "separatorPx": 1,
         "panes": [{"index": 0, "height": 505, "series": []},
                   {"index": 1, "height": 88, "series": []}]}
    d = cp.manifest_diff(a, b)
    assert d != []
    assert any("panes" in line and "1" in line for line in d)
    assert any("594" in line and "505" in line for line in d), d


def test_manifest_diff_sees_a_series_that_changed_PANE_or_SCALE():
    a = {"panes": [{"index": 0, "height": 594,
                    "series": [{"id": "rsi:line", "paneIndex": 0, "priceScaleId": "rsi"}]}]}
    b = {"panes": [{"index": 0, "height": 594,
                    "series": [{"id": "rsi:line", "paneIndex": 1, "priceScaleId": "right"}]}]}
    d = cp.manifest_diff(a, b)
    assert any("paneIndex" in line for line in d), d
    assert any("priceScaleId" in line for line in d), d


def test_a_case_with_regions_but_no_manifest_still_reports_and_does_not_crash():
    # ChartRender only publishes __paneManifest under `?fixedbars=`, and a page
    # that does not is a MISSING manifest, not an error: raising here would abort
    # a 20-run measurement halfway, at run 13 of 20, with nothing written down.
    class _FakePageWithNoGlobal:
        def evaluate(self, _expr):
            return None                      # `window.__paneManifest ?? null`

    class _FakePageThatThrew:
        def evaluate(self, _expr):
            raise RuntimeError("Execution context was destroyed")

    assert cp.read_manifest(_FakePageWithNoGlobal()) is None
    assert cp.read_manifest(_FakePageThatThrew()) is None


def test_read_manifest_returns_the_PUBLISHED_object():
    """The control: a `read_manifest` that returned None unconditionally would
    satisfy the test above and silently disarm every manifest assertion."""
    m = {"chartHeight": 594, "panes": [{"index": 0, "height": 594, "series": []}]}

    class _FakePageWithOne:
        def evaluate(self, _expr):
            return m

    assert cp.read_manifest(_FakePageWithOne()) == m


def test_the_MANIFEST_moving_while_no_pixel_moves_is_a_failure():
    # One of the two is lying. A pane layout that differs and paints identically
    # did not happen; a manifest that is being written from the wrong place did.
    entry = {"name": "x", "tolerance": 0, "runs": [{
        "run": 1, "changed": 0, "size_mismatch": False,
        "manifest_a": {"panes": [{"index": 0, "height": 594}]},
        "manifest_b": {"panes": [{"index": 0, "height": 505}]},
    }]}
    assert cp.collapse_case(entry)["pass"] is False
    assert any("manifest" in m for m in entry["expectation_failures"])


def test_PIXELS_moving_while_the_manifest_says_nothing_did_is_a_failure():
    # The other direction, and it is DECLARED — a colour change legitimately
    # moves pixels with identical geometry, so only a case that says "this is a
    # geometry change" gets to demand the manifest moved with them.
    entry = {"name": "x", "tolerance": 0, "expect": 88, "expect_manifest_change": True,
             "runs": [{"run": 1, "changed": 88, "size_mismatch": False,
                       "manifest_a": {"panes": [{"index": 0, "height": 594}]},
                       "manifest_b": {"panes": [{"index": 0, "height": 594}]}}]}
    assert cp.collapse_case(entry)["pass"] is False
    assert any("identical" in m for m in entry["expectation_failures"])


def test_a_case_that_declares_a_geometry_change_fails_when_NO_manifest_was_published():
    # Otherwise the sharpest assertion in B5 goes quietly vacuous the moment the
    # page stops publishing — a missing manifest would read as "no contradiction".
    entry = {"name": "x", "tolerance": 0, "expect": 88, "expect_manifest_change": True,
             "runs": [{"run": 1, "changed": 88, "size_mismatch": False,
                       "manifest_a": None, "manifest_b": None}]}
    assert cp.collapse_case(entry)["pass"] is False
    assert any("no pane manifest" in m for m in entry["expectation_failures"])


def test_a_declared_geometry_change_that_BOTH_moved_passes():
    """THE CONTROL for the three above."""
    entry = {"name": "x", "tolerance": 0, "expect": 88, "expect_manifest_change": True,
             "runs": [{"run": 1, "changed": 88, "size_mismatch": False,
                       "manifest_a": {"panes": [{"index": 0, "height": 594}]},
                       "manifest_b": {"panes": [{"index": 0, "height": 505}]}}]}
    assert cp.collapse_case(entry)["pass"] is True


def test_a_case_with_no_manifest_ANYWHERE_is_unaffected():
    """⭐ THE OTHER HALF OF THE BACKWARDS-COMPATIBILITY RAIL. Nothing publishes
    `window.__paneManifest` yet, so every case in the file reads None on both
    sides today. That must stay a 🟢 pass, or this task turns 44 green cases red
    on the day it lands."""
    entry = cp.collapse_case({"name": "x", "tolerance": 0, "runs": [
        {"run": 1, "changed": 0, "size_mismatch": False,
         "manifest_a": None, "manifest_b": None}]})
    assert entry["pass"] is True
    assert entry["manifest_diff"] == []


# ─── GEOMETRY vs PROVENANCE (the B5 Task 5 ruling, landed at Task 6) ─────────
#
# 🔴 THE MEASUREMENT THAT FORCED THIS. Task 5's main parity run exited 1 with
# `changed: 0` on four cases, and the ENTIRE diff was
# `panes[0].series[1].key: None -> 'legacy:stoch::k'` — the pool key, i.e. WHICH
# MODULE created the series. Pane count, per-pane height, series type,
# `priceScaleId`, pane index and insertion order were byte-identical. That is
# what a Flip-B migration IS, so every remaining migration trips the
# "manifest moved, pixels didn't" rule by construction.
#
# The rule is a statement about GEOMETRY. So the diff is split, and the halves
# are gated differently: geometry keeps the unconditional cross-check; the pool
# `key` is PROVENANCE and a case declares it. ⛔ `key` is NOT dropped — it is the
# only field that can catch a series built by the wrong module, and it earned
# that keep by catching one (`engine_bb_rsi_vs_legacy`'s two sides built the same
# series in a different ORDER at 0 changed pixels).

_GEO_A = {"chartHeight": 594, "separatorPx": 1, "panes": [
    {"index": 0, "height": 594, "series": [
        {"type": "Candlestick", "scaleId": "right", "key": None},
        {"type": "Line", "scaleId": "right", "key": None}]}]}


def _with(manifest, **series1):
    out = json.loads(json.dumps(manifest))
    out["panes"][0]["series"][1].update(series1)
    return out


def test_the_manifest_diff_SPLITS_geometry_from_provenance():
    b = _with(_GEO_A, key="legacy:sar::sar")
    b["panes"][0]["height"] = 505
    parts = cp.manifest_diff_parts(_GEO_A, b)
    assert parts["geometry"] == ["panes[0].height: 594 -> 505"]
    assert parts["provenance"] == [
        "panes[0].series[1].key: None -> 'legacy:sar::sar'"]
    assert parts["provenance_pairs"] == [(None, "legacy:sar::sar")]
    # The flat view a reader gets is still every line, geometry first.
    assert cp.manifest_diff(_GEO_A, b) == parts["geometry"] + parts["provenance"]


def test_a_series_that_appears_on_ONE_SIDE_ONLY_is_GEOMETRY_not_provenance():
    """The classification is by LEAF NAME, and a whole series object's leaf is the
    `series` list that holds it — otherwise a case could declare its way past an
    engine that created a series legacy never drew."""
    b = json.loads(json.dumps(_GEO_A))
    b["panes"][0]["series"].append({"type": "Line", "scaleId": "right", "key": "x::y"})
    parts = cp.manifest_diff_parts(_GEO_A, b)
    assert parts["provenance"] == []
    assert len(parts["geometry"]) == 1 and "series[2]" in parts["geometry"][0]


def test_a_MISSING_manifest_on_one_side_is_GEOMETRY():
    """A side that published no manifest published no geometry. Filing it as
    provenance would let `expectProvenance` license a page that stopped
    publishing."""
    parts = cp.manifest_diff_parts(None, _GEO_A)
    assert parts["geometry"] == ["manifest missing on A"]
    assert parts["provenance"] == []


def test_a_DECLARED_provenance_flip_at_zero_pixels_PASSES():
    """⭐ THE RULING. This is exactly what a Flip-B migration produces: the same
    picture, a different owner. Before the split this case exited 1."""
    entry = {"name": "x", "tolerance": 0,
             "expect_provenance": [[None, "legacy:sar::sar"]],
             "runs": [{"run": 1, "changed": 0, "size_mismatch": False,
                       "manifest_a": _GEO_A,
                       "manifest_b": _with(_GEO_A, key="legacy:sar::sar")}]}
    assert cp.collapse_case(entry)["pass"] is True
    assert entry["manifest_geometry_diff"] == []
    assert entry["manifest_provenance_diff"] == [
        "panes[0].series[1].key: None -> 'legacy:sar::sar'"]


def test_an_UNDECLARED_provenance_change_STILL_FAILS():
    """⛔ THE HALF THE SPLIT MUST NOT GIVE AWAY. A case that declares nothing gets
    no licence: a series created by a module nobody named is a failure, at 0
    changed pixels, on every case."""
    entry = {"name": "x", "tolerance": 0,
             "runs": [{"run": 1, "changed": 0, "size_mismatch": False,
                       "manifest_a": _GEO_A,
                       "manifest_b": _with(_GEO_A, key="legacy:sar::sar")}]}
    assert cp.collapse_case(entry)["pass"] is False
    assert any("UNDECLARED" in m for m in entry["expectation_failures"])


def test_a_provenance_flip_to_the_WRONG_MODULE_fails_a_case_that_declared_the_right_one():
    """The declaration says which keys flip AND TO WHAT. Matching on "some key
    changed" would pass a series the engine built under another definition's
    identity, which is the whole reason `key` was not simply dropped."""
    entry = {"name": "x", "tolerance": 0,
             "expect_provenance": [[None, "legacy:sar::sar"]],
             "runs": [{"run": 1, "changed": 0, "size_mismatch": False,
                       "manifest_a": _GEO_A,
                       "manifest_b": _with(_GEO_A, key="legacy:ichimoku::tenkan")}]}
    assert cp.collapse_case(entry)["pass"] is False
    assert any("legacy:ichimoku::tenkan" in m for m in entry["expectation_failures"])


def test_declaring_ONE_flip_does_not_license_TWO():
    """A MULTISET, not a set. A second series acquiring the same key is a
    double-draw, and it is invisible in the pixels when the two overlap."""
    b = json.loads(json.dumps(_GEO_A))
    b["panes"][0]["series"][0]["key"] = "legacy:sar::sar"
    b["panes"][0]["series"][1]["key"] = "legacy:sar::sar"
    entry = {"name": "x", "tolerance": 0,
             "expect_provenance": [[None, "legacy:sar::sar"]],
             "runs": [{"run": 1, "changed": 0, "size_mismatch": False,
                       "manifest_a": _GEO_A, "manifest_b": b}]}
    assert cp.collapse_case(entry)["pass"] is False
    assert any("legacy:sar::sar" in m for m in entry["expectation_failures"])
    # The control that it really is the COUNT that failed it: one occurrence of
    # the very same pair, same declaration, passes.
    ok = dict(entry, runs=[{**entry["runs"][0],
                            "manifest_b": _with(_GEO_A, key="legacy:sar::sar")}])
    assert cp.collapse_case(ok)["pass"] is True


def test_a_GEOMETRY_change_at_zero_pixels_STILL_FAILS_a_case_that_declared_its_provenance():
    """⛔ THE SPLIT MUST NOT DISARM THE UNCONDITIONAL RULE. `expectProvenance` is
    a licence for ONE field. A pane that moved 89 px while the picture did not is
    still one of the two witnesses lying, declaration or no declaration."""
    b = _with(_GEO_A, key="legacy:sar::sar")
    b["panes"][0]["height"] = 505
    entry = {"name": "x", "tolerance": 0,
             "expect_provenance": [[None, "legacy:sar::sar"]],
             "runs": [{"run": 1, "changed": 0, "size_mismatch": False,
                       "manifest_a": _GEO_A, "manifest_b": b}]}
    assert cp.collapse_case(entry)["pass"] is False
    assert any("594" in m and "505" in m for m in entry["expectation_failures"])


def test_a_pane_HEIGHT_change_CANNOT_BE_DECLARED_AWAY_as_provenance():
    """⛔ THE SPLIT'S OTHER EDGE, and the one a mutation found. Widening
    `PROVENANCE_LEAVES` by one geometry field is invisible to every test above —
    an UNDECLARED height change still fails, just with a provenance message. What
    separates the two is a case that DECLARES the height flip: geometry cannot be
    licensed, provenance can, so this passes only while `height` is geometry."""
    b = json.loads(json.dumps(_GEO_A))
    b["panes"][0]["height"] = 505
    entry = {"name": "x", "tolerance": 0,
             "expect_provenance": [[594, 505]],
             "runs": [{"run": 1, "changed": 0, "size_mismatch": False,
                       "manifest_a": _GEO_A, "manifest_b": b}]}
    assert cp.collapse_case(entry)["pass"] is False
    assert entry["manifest_geometry_diff"] == ["panes[0].height: 594 -> 505"]
    assert entry["manifest_provenance_diff"] == []


def test_a_reordered_series_list_is_GEOMETRY_because_order_IS_z_order():
    """The `engine_bb_rsi_vs_legacy` shape — two sides that built the same series
    in a different ORDER, at 0 changed pixels because none of them overlap. The
    type/scaleId comparison at each POSITION is what sees it, and it must stay on
    the geometry side of the split or a migration case declares straight past it."""
    a = {"panes": [{"index": 0, "height": 594, "series": [
        {"type": "Line", "scaleId": "rsi", "key": "legacy:rsi::rsi"},
        {"type": "Line", "scaleId": "right", "key": "legacy:bb::upper"}]}]}
    b = {"panes": [{"index": 0, "height": 594, "series": [
        {"type": "Line", "scaleId": "right", "key": "legacy:bb::upper"},
        {"type": "Line", "scaleId": "rsi", "key": "legacy:rsi::rsi"}]}]}
    parts = cp.manifest_diff_parts(a, b)
    assert any("scaleId" in line for line in parts["geometry"]), parts
    entry = cp.collapse_case({
        "name": "x", "tolerance": 0,
        # Even fully declared, the ORDER change is geometry and fails.
        "expect_provenance": [["legacy:rsi::rsi", "legacy:bb::upper"],
                              ["legacy:bb::upper", "legacy:rsi::rsi"]],
        "runs": [{"run": 1, "changed": 0, "size_mismatch": False,
                  "manifest_a": a, "manifest_b": b}]})
    assert entry["pass"] is False


def test_a_declared_flip_that_did_NOT_happen_is_RECORDED_not_failed():
    """⚠️ DELIBERATE, AND THE REASON IS A REAL RUN. The same case file is measured
    two-build (A = before the migration, B = after → the keys flip) AND
    `--same-build` (B vs B → nothing flips, and that run is the determinism
    proof). Gating "declared ⇒ must happen" turns every same-build run red on the
    cases that matter most. It is recorded so a rotted declaration is visible."""
    entry = cp.collapse_case({
        "name": "x", "tolerance": 0,
        "expect_provenance": [[None, "legacy:sar::sar"]],
        "runs": [{"run": 1, "changed": 0, "size_mismatch": False,
                  "manifest_a": _GEO_A, "manifest_b": json.loads(json.dumps(_GEO_A))}]})
    assert entry["pass"] is True
    assert entry["provenance_unmet"] == [[None, "legacy:sar::sar"]]


def test_expectProvenance_refuses_a_malformed_declaration():
    with pytest.raises(SystemExit) as ei:
        cp.validate_provenance(["legacy:sar::sar"], "sar_only")
    assert "two-element" in str(ei.value)
    with pytest.raises(SystemExit):
        cp.validate_provenance({"a": "b"}, "sar_only")


def test_expectProvenance_refuses_a_pair_that_can_never_occur():
    """A key changing to itself emits no diff line, so it would sit in the case
    file forever looking like a gate and matching nothing."""
    with pytest.raises(SystemExit) as ei:
        cp.validate_provenance([["legacy:sar::sar", "legacy:sar::sar"]], "sar_only")
    assert "itself" in str(ei.value)


def test_case_entry_CARRIES_expectProvenance_out_of_the_case_file():
    """The wiring rail, in the shape `test_main_carries_the_case_file_REGIONS…`
    exists for: drop the one line in `case_entry` and every provenance
    declaration in the file goes quietly inert while the suite stays green."""
    entry = cp.case_entry({"name": "sar_only",
                           "expectProvenance": [[None, "legacy:sar::sar"]]},
                          tolerance=0, expect=None)
    assert entry["expect_provenance"] == [[None, "legacy:sar::sar"]]
    assert cp.case_entry({"name": "bb_only"}, tolerance=0,
                         expect=None)["expect_provenance"] is None


def test_every_expectProvenance_in_the_REAL_case_file_validates():
    """Run through the SAME construction `main()` uses, so a declaration the
    validator would refuse cannot sit in the file until a Chromium run finds it.

    ⏳ THE FLOOR IS THE CURRENT STATE AND IS MEANT TO GO RED. It read `== []` when
    the split landed, because nothing had been migrated since it did — and B5
    Task 6 (`sar` + `ichimoku`) failed that line on its first run and raised it
    here, deliberately. **Every case that turns a newly-flipped indicator on flips
    a pool key**, so the next migration fails it too.

    ⛔ AND THE `from` SIDE IS ASSERTED TO BE `null`, WHICH IS THE WHOLE CLAIM. A
    Flip-B migration moves a series from the LEGACY lane (no binder binding, so
    `key` reads `null`) to the engine's. A declared pair whose `from` is another
    module's key is not a migration — it is a series changing hands between two
    engine definitions, and it must be argued for here rather than joining the
    list."""
    doc = json.loads((ROOT / "tools" / "chart_parity_cases.json").read_text(encoding="utf-8"))
    declared = {}
    for raw in doc["cases"]:
        entry = cp.case_entry({**doc["defaults"], **raw}, tolerance=0, expect=None)
        if entry["expect_provenance"]:
            declared[raw["name"]] = entry["expect_provenance"]
            for pair in entry["expect_provenance"]:
                assert len(pair) == 2 and pair[0] != pair[1]
                assert pair[0] is None, (
                    f"{raw['name']} declares {pair!r}: a migration's `from` is the "
                    "LEGACY lane, which has no binding and therefore no key")
                assert pair[1].startswith("legacy:"), pair
    assert sorted(declared) == sorted([
        "engine_ichimoku_vs_legacy", "engine_price_overlay_zorder",
        "engine_sar_vs_legacy", "ichimoku_only", "sar_only",
    ]), f"the set of provenance-declaring cases moved: {sorted(declared)}"
    # ⭐ AND THE COUNTS ARE THE MIGRATION'S OWN SHAPE, not a total. `sar` is ONE
    # plot; `ichimoku` is FIVE; the z-order case turns both on and therefore
    # declares six. A case that declared the wrong NUMBER of flips would be
    # licensing a series it did not migrate.
    assert [len(v) for _, v in sorted(declared.items())] == [5, 6, 1, 5, 1], (
        {k: len(v) for k, v in sorted(declared.items())})


# ─── the CLI, and the refusal that keeps the two mechanisms apart ────────────

def test_expect_and_a_tolerance_BUDGET_cannot_both_be_declared(monkeypatch, tmp_path):
    monkeypatch.setattr(sys, "argv", [
        "chart_parity.py", "--base-a", "http://127.0.0.1:1", "--same-build",
        "--cases", "rsi_only", "--expect", "88",
        "--tolerance", "5", "--tolerance-reason", "because",
        "--out", str(tmp_path / "out")])
    with pytest.raises(SystemExit) as ei:
        cp.main()
    # One is a declared, measured, signed-off number; the other is an escape. A
    # run carrying both has a verdict nobody can state.
    assert "--expect" in str(ei.value) and "--tolerance" in str(ei.value)


def test_main_EXITS_1_when_the_measured_diff_is_not_the_EXPECTED_number(monkeypatch, tmp_path):
    frame = png("#0e0f0d")

    def settles(page, url, out_png, *_a, **_kw):
        Path(out_png).parent.mkdir(parents=True, exist_ok=True)
        Path(out_png).write_bytes(frame)
        return {"shots": 2, "settled": True, "ready_ms": 1, "ready_reason": "stable"}

    rc = _drive_main(monkeypatch, tmp_path, settles, extra_argv=["--expect", "88"])
    assert rc == 1, "0 changed pixels satisfied `--expect 88`"
    report = json.loads((tmp_path / "out" / "report.json").read_text(encoding="utf-8"))
    assert report["results"][0]["expect"] == 88
    assert report["results"][0]["changed"] == 0
    assert "expected EXACTLY 88" in " ".join(report["results"][0]["expectation_failures"])


def test_main_EXITS_0_when_the_measured_diff_IS_the_expected_number(monkeypatch, tmp_path):
    """The control for the test above AND the proof that `--expect` reaches the
    entry at all: if it were dropped on the floor both would still exit 1 for
    unrelated reasons."""
    frame = png("#0e0f0d")

    def settles(page, url, out_png, *_a, **_kw):
        Path(out_png).parent.mkdir(parents=True, exist_ok=True)
        Path(out_png).write_bytes(frame)
        return {"shots": 2, "settled": True, "ready_ms": 1, "ready_reason": "stable"}

    assert _drive_main(monkeypatch, tmp_path, settles, extra_argv=["--expect", "0"]) == 0


def test_main_carries_the_case_file_REGIONS_and_the_PAGE_MANIFEST_into_report_json(
        monkeypatch, tmp_path):
    """⭐ THE WIRING, AND IT IS THE HALF THAT ROTS SILENTLY. Every unit above
    interrogates `diff`, `collapse_case` and `read_manifest` directly; none of
    them can see `main()` failing to HAND them anything. Drop
    `regions=entry.get("regions")` from the `diff` call, or
    `run["manifest_%s"] = cap.get("manifest")` from the capture loop, and every
    region and every manifest assertion in B5 goes quietly vacuous while this
    file stays green.

    Driven on `rsi_only`, which is the case that carries a real region block, at
    the real 1200x620 export size — a 40x20 stub would be refused by the
    off-canvas rule, which is itself the point of that rule."""
    frame = BytesIO()
    Image.new("RGB", (1200, 620), (14, 15, 13)).save(frame, format="PNG")
    frame = frame.getvalue()
    manifest = {"chartHeight": 620, "separatorPx": 1,
                "panes": [{"index": 0, "height": 460, "series": []}]}

    def settles(page, url, out_png, *_a, **_kw):
        Path(out_png).parent.mkdir(parents=True, exist_ok=True)
        Path(out_png).write_bytes(frame)
        return {"shots": 2, "settled": True, "ready_ms": 1, "ready_reason": "stable",
                "manifest": manifest}

    rc = _drive_main(monkeypatch, tmp_path, settles, cases=("rsi_only",))
    assert rc == 0
    run = json.loads((tmp_path / "out" / "report.json").read_text(
        encoding="utf-8"))["results"][0]["runs"][0]
    assert run["regions"] == {"price_top": 0, "rsi_band": 0,
                              "volume_and_axis": 0, "rest": 0}, (
        "the case file's rectangles never reached `diff` — the region gate is inert")
    assert run["manifest_a"] == manifest and run["manifest_b"] == manifest, (
        "the page's manifest never reached the run — the geometry gate is inert")
    assert run["manifest_diff"] == []


def test_a_case_file_region_reaches_the_ENTRY_and_the_report(monkeypatch, tmp_path):
    """The wiring between `regions` in the case file and `diff(regions=…)`. Both
    halves: the entry carries the rectangles, and the run carries the counts."""
    case = {"name": "x", "regions": [
        {"name": "price_plot", "box": [0, 0, 40, 10], "expect": 0},
        {"name": "osc_strip", "box": [0, 10, 40, 20]},
    ]}
    entry = cp.case_entry(case, tolerance=0, expect=None)
    assert entry["regions"] == case["regions"]
    assert entry["expect_regions"] == {"price_plot": 0}, (
        "only a region that DECLARES an expectation becomes one — a region "
        "without `expect` is measured and reported, not gated")
