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


def _drive_main(monkeypatch, tmp_path, capture_impl, cases=("macd_only",)):
    monkeypatch.setattr(cp, "sync_playwright", lambda: _FakePlaywright())
    monkeypatch.setattr(cp, "capture", capture_impl)
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
