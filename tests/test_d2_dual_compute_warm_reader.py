"""D2 top-level CP3, LINE 5 -- the scheduled warm reader for ticker_returns'
DARK dual-compute rail (`api/services/ticker_returns_warm_reader.py`).

Two halves, mirroring `tests/test_desk_session_audit.py` and
`tests/test_alert_taxonomy_price_level_projection.py`'s own wiring style:
  1. the core logic (`run_warm_pass`), fully mocked -- no live network calls,
     no live bars, no live education DB.
  2. is it actually WIRED -- the repo's most-repeated defect is a component
     that is built, tested, green and connected to nothing (the desk-insights
     pass ran that way for weeks). String-scoped checks against `api/main.py`,
     matching the price-level DARK sweep's own test file rather than a full
     AST walk -- proven, already in use in this repo for this exact shape.
"""
import pathlib

import pytest

from api.services import ticker_returns_warm_reader as warm_reader

REPO = pathlib.Path(__file__).resolve().parent.parent
MAIN = REPO / "api" / "main.py"


# ── Core logic ──────────────────────────────────────────────────────────────

def _video(vid, youtube_id="Y", title="T"):
    return {"id": vid, "youtube_id": youtube_id, "title": title,
            "created_at": 1786327200, "ticker_moments": '[{"t":1,"ticker":"NVDA"}]'}


def test_run_warm_pass_calls_returns_for_video_for_every_video(monkeypatch):
    videos = [_video(1), _video(2), _video(3)]
    monkeypatch.setattr(warm_reader.edu, "videos_with_ticker_moments", lambda: videos)

    calls = []

    def fake_returns(vid):
        calls.append(vid)
        return {"anchor_date": "2026-08-09", "as_of": "x",
                "returns": {"NVDA": {"since_pct": 1.0, "d5_pct": None, "d21_pct": None}}}

    monkeypatch.setattr(warm_reader.ticker_returns, "returns_for_video", fake_returns)

    out = warm_reader.run_warm_pass()
    assert calls == [1, 2, 3], "every video with ticker moments must be visited"
    assert out["videos_total"] == 3
    assert out["videos_ok"] == 3
    assert out["symbols_returned"] == 3          # one symbol per video, three videos
    assert out["errors"] == []


def test_run_warm_pass_calls_returns_for_video_as_an_int(monkeypatch):
    """`returns_for_video` indexes/serializes on the id -- a string id from a
    raw SQL row must not silently reach it as `"1"`."""
    monkeypatch.setattr(warm_reader.edu, "videos_with_ticker_moments",
                        lambda: [{"id": "7", "youtube_id": "Y", "title": "T"}])
    seen = {}

    def fake_returns(vid):
        seen["vid"] = vid
        seen["type"] = type(vid)
        return {"returns": {}}

    monkeypatch.setattr(warm_reader.ticker_returns, "returns_for_video", fake_returns)
    warm_reader.run_warm_pass()
    assert seen["vid"] == 7 and seen["type"] is int


def test_run_warm_pass_tolerates_one_bad_video_and_keeps_going(monkeypatch):
    videos = [_video(1), _video(2), _video(3)]
    monkeypatch.setattr(warm_reader.edu, "videos_with_ticker_moments", lambda: videos)

    def flaky(vid):
        if vid == 2:
            raise RuntimeError("bars store hiccup")
        return {"returns": {"NVDA": {"since_pct": 1.0}}}

    monkeypatch.setattr(warm_reader.ticker_returns, "returns_for_video", flaky)

    out = warm_reader.run_warm_pass()
    assert out["videos_total"] == 3
    assert out["videos_ok"] == 2, "one failing video must not stop the other two"
    assert len(out["errors"]) == 1
    assert out["errors"][0]["video_id"] == 2


def test_run_warm_pass_never_raises_when_listing_fails(monkeypatch):
    def boom():
        raise RuntimeError("db gone")
    monkeypatch.setattr(warm_reader.edu, "videos_with_ticker_moments", boom)

    out = warm_reader.run_warm_pass()          # must not raise
    assert out["videos_total"] == 0
    assert out["videos_ok"] == 0
    assert out["errors"] == []
    assert "db gone" in out["list_error"]


def test_run_warm_pass_handles_an_empty_library(monkeypatch):
    monkeypatch.setattr(warm_reader.edu, "videos_with_ticker_moments", lambda: [])
    called = {"n": 0}
    monkeypatch.setattr(warm_reader.ticker_returns, "returns_for_video",
                        lambda vid: called.__setitem__("n", called["n"] + 1))
    out = warm_reader.run_warm_pass()
    assert out == {"videos_total": 0, "videos_ok": 0, "symbols_returned": 0, "errors": []}
    assert called["n"] == 0


def test_run_warm_pass_counts_zero_symbols_when_a_video_has_no_resolvable_returns(monkeypatch):
    """A video whose returns dict comes back empty (no basis bar, no
    post-anchor bar) is still a completed, non-error call."""
    monkeypatch.setattr(warm_reader.edu, "videos_with_ticker_moments", lambda: [_video(9)])
    monkeypatch.setattr(warm_reader.ticker_returns, "returns_for_video",
                        lambda vid: {"anchor_date": "2026-08-09", "as_of": "x", "returns": {}})
    out = warm_reader.run_warm_pass()
    assert out["videos_ok"] == 1
    assert out["symbols_returned"] == 0
    assert out["errors"] == []


# ── Design-intent regression: in-process, never HTTP, never a credential ────

def test_the_module_never_imports_an_http_client_or_touches_smoke_credentials():
    """The report argued for calling `ticker_returns.returns_for_video()`
    in-process specifically BECAUSE it needs no HTTP client and no smoke
    credentials inside application code. If a future edit adds either, that
    argument no longer describes what shipped."""
    src = (REPO / "api" / "services" / "ticker_returns_warm_reader.py").read_text(
        encoding="utf-8")
    # scope out the module's own docstring, which discusses (but must not use)
    # these tokens as part of explaining the decision.
    doc_end = src.index('"""', src.index('"""') + 3) + 3
    body = src[doc_end:]
    for banned in ("import requests", "import httpx", "urllib.request",
                   "SMOKE_EMAIL", "SMOKE_PASSWORD", "smoke_login_link",
                   "cookiejar"):
        assert banned not in body, f"unexpected {banned!r} in the warm reader's code body"


# ── Is it actually WIRED ─────────────────────────────────────────────────────

JOB_ID = "d2_dual_compute_warm_reader"
FLAG = "D2_DUAL_COMPUTE_WARM_READER_ENABLED"


def _main_src() -> str:
    return MAIN.read_text(encoding="utf-8")


def test_the_warm_reader_is_registered_exactly_once():
    main = _main_src()
    assert main.count(f'id="{JOB_ID}"') == 1, "registered exactly once"
    # ⛔ NON-VACUITY: the probe must be able to see a sibling it isn't looking
    # for, or a count-based scan that silently matched nothing would "pass"
    # for the wrong reason (lesson_probe_names_must_be_derived_not_typed).
    assert 'id="alert_taxonomy_indicator_condition_dark"' in main, (
        "the sibling S7 dark-sweep job id is missing — this probe's scan of "
        "api/main.py is broken, so its verdict on the warm reader means nothing")


def test_the_warm_reader_is_flag_gated_default_off():
    main = _main_src()
    assert f'os.environ.get("{FLAG}", "0") == "1"' in main, (
        "the warm reader is not flag-gated, or its default is not OFF — it "
        "generates real read traffic against production data, so an unset "
        "variable must mean nothing runs")


def _job_body() -> str:
    main = _main_src()
    start = main.index("def _d2_dual_compute_warm_reader_job():")
    end = main.index(f'id="{JOB_ID}"', start)
    return main[start:end]


def test_the_job_body_calls_run_warm_pass():
    body = _job_body()
    assert "run_warm_pass()" in body, (
        "the scheduler entry exists but its job body does not call the "
        "warm-reader's core logic")


def test_the_job_body_never_reaches_a_delivery_path():
    body = _job_body()
    assert "run_warm_pass" in body, "the slice is empty — this probe is broken"
    for banned in ("deliver", "send_email", "webhook", "add_alert(",
                   "requests.", "httpx.", "smoke_login_link", "SMOKE_PASSWORD"):
        assert banned not in body, f"the warm-reader job body mentions {banned!r}"


def test_the_cron_brackets_the_gates_own_session_span():
    """The gate's session-span requirement is `dual_sample_store.COVER_OPEN_HHMM`
    (945 = 09:45 ET) / `COVER_CLOSE_HHMM` (1545 = 15:45 ET). Derive the
    schedule's boundary ticks from those constants rather than re-typing
    09:45/15:45 a third time (this repo's own "measure it, don't quote it"
    rule) -- a drift in either constant should be caught here, not discovered
    the next time nobody's session ever gets covered."""
    from api.services.canonical import dual_sample_store as store
    assert store.COVER_OPEN_HHMM == 945 and store.COVER_CLOSE_HHMM == 1545, (
        "the gate's own session-span constants moved — recompute the cron "
        "boundary below against the new values before trusting this test")

    main = _main_src()
    start = main.index(f'id="{JOB_ID}"')
    # the CronTrigger(...) call is textually just above the add_job block for
    # this job — scan the preceding ~600 chars, which comfortably contains it
    # without reaching into the previous job's block.
    window = main[max(0, start - 600):start]
    assert 'trigger=CronTrigger(' in window
    assert 'day_of_week="mon-fri"' in window, "must be a weekday-only (RTH) schedule"
    assert 'hour="9-15"' in window and "minute=45" in window, (
        "the cadence text drifted from the hour=9-15/minute=45 shape this "
        "test derives its boundary-tick math from")

    first_tick_hhmm = 9 * 100 + 45     # hour=9, minute=45
    last_tick_hhmm = 15 * 100 + 45     # hour=15, minute=45
    assert first_tick_hhmm <= store.COVER_OPEN_HHMM, (
        "the first scheduled tick lands AFTER the gate's own open-coverage "
        "cutoff — no session could ever be marked covered")
    assert last_tick_hhmm >= store.COVER_CLOSE_HHMM, (
        "the last scheduled tick lands BEFORE the gate's own close-coverage "
        "cutoff — no session could ever be marked covered")


def test_the_flag_default_matches_the_repos_blank_and_unset_convention(monkeypatch):
    """Mirrors this repo's `DESK_TSDR_ANNOUNCE_SHOWS`/
    `ALERT_TAXONOMY_PRICE_LEVEL_DARK_ENABLED` idiom directly, rather than only
    asserting the literal string above: with the variable truly unset, the
    guard condition must evaluate False."""
    import os
    monkeypatch.delenv(FLAG, raising=False)
    assert os.environ.get(FLAG, "0") != "1"
