"""CARD 16's p95 gate must be UNTAKEABLE under invalid conditions.

⚰️⚰️ THE RUN THIS FILE EXISTS BECAUSE OF. 2026-09-26: `tools/bars_warmth_audit.py`
was run against production and returned tf=D p95 **271 ms** and tf=5 **82 ms**. Then
`/api/health` was checked and answered **502** — a deploy mid-swap, so clause 2's
*"a pod >= 300 s old"* could not be established — and it was a **Saturday**, so the
RTH tier alarm was inapplicable and a cold weekend cache is unrepresentative. Real
numbers, invalid conditions. 271 ms would have been recorded as a FAIL on the daily
timeframe, and the only thing that prevented it was checking the pod AFTERWARDS.

⭐ SO THE PROPERTY UNDER TEST IS NOT "the arithmetic is right" — that is
`tests/test_bars_warmth_audit_buckets.py`'s job, and the instrument is unmodified.
It is that the runner **refuses first** and that each refusal can FIRE.

⛔ AND THE CONTROL THAT MATTERS IS HERE TOO: a fully valid fixture must PASS. A
runner that refuses everything reads as safe and measures nothing — which is the
same failure one level up (`lesson_a_fixture_that_cannot_distinguish_is_not_a_rail`).

⛔ NO NETWORK. The health read, the clock, the session predicate and the sampler are
all injected, so the whole runner is exercisable with no production access at all.
"""
from __future__ import annotations

import datetime as _dt
import importlib.util
import inspect
import os
import pathlib

import pytest

_ROOT = pathlib.Path(__file__).resolve().parent.parent
_GATE = _ROOT / "tools" / "bars_warmth_gate.py"


def _load(name: str, path: pathlib.Path):
    """Import a `tools/` script by path — it is not a package module."""
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture()
def gate():
    return _load("bars_warmth_gate", _GATE)


@pytest.fixture()
def ET():
    from zoneinfo import ZoneInfo
    return ZoneInfo("America/New_York")


@pytest.fixture()
def session_fn():
    """THE PRODUCT'S OWN RTH predicate, imported directly.

    ⛔ NOT via `gate.resolve_session_fn()`, which would re-run the shared-data-root
    census and overwrite THIS pytest process's pins with a second sandbox mid-session.
    The repo-root conftest has already pinned them; this reads the authority without
    moving them. `pin_shared_data_root` gets its own hermetic test below.
    """
    from api.services.screener import scan_evaluator
    return scan_evaluator._live_session_state


# Instants the whole file is written against. Each one is a real date.
def _rth(ET):        return _dt.datetime(2026, 9, 23, 12, 0, tzinfo=ET)   # Wed noon
def _weekend(ET):    return _dt.datetime(2026, 9, 26, 12, 0, tzinfo=ET)   # Saturday
def _holiday(ET):    return _dt.datetime(2026, 9, 7, 14, 30, tzinfo=ET)   # Labor Day
def _half_open(ET):  return _dt.datetime(2026, 11, 27, 12, 0, tzinfo=ET)  # 13:00 close
def _half_shut(ET):  return _dt.datetime(2026, 11, 27, 14, 0, tzinfo=ET)


_WARM = [("mem", 40.0)] * 19 + [("sqlite", 90.0)]         # p95 = 90 ms
_SLOW = [("mem", 400.0)] * 20                              # p95 = 400 ms, OVER
_ALL_WAITED = [("fetch", 900.0)] * 20                      # NOT COMPUTABLE
_STALE = [("stale-swr", 40.0)] * 20                        # instant but STALE


def _healthy():
    return {"status": 200, "uptime_seconds": 1800.0, "error": None}


def _run(gate, tmp_path, *, health, now, session_fn, samples=None, sample_fn=None):
    """Drive `main()` end to end with every seam injected. Returns (exit_code, text)."""
    calls = []

    def _sample(base, tf, n, bars):
        calls.append(tf)
        return (samples or {}).get(tf, _WARM)

    code = gate.main(
        ["--tf", "D,5", "--n", "3"],
        health_fn=lambda base: health,
        clock_fn=lambda: now,
        session_fn=session_fn,
        sample_fn=sample_fn or _sample,
        evidence_root=str(tmp_path),
    )
    written = sorted(tmp_path.rglob("results.md"))
    assert len(written) == 1, f"expected exactly one artifact, got {written}"
    return code, written[0].read_text(encoding="utf-8"), calls


# ──────────────────────────────────────────────────────────────────────────────
# 1. EVERY REFUSAL, AND EACH ONE FIRES ON ITS OWN
# ──────────────────────────────────────────────────────────────────────────────

def test_a_502_REFUSES_and_nothing_is_measured(gate, tmp_path, ET, session_fn):
    """⛔ The exact condition of the 2026-09-26 run. A 502 is a REFUSAL, not a retry
    loop: the pod that would eventually answer is not the pod the run started on."""
    code, text, calls = _run(gate, tmp_path,
                             health={"status": 502, "uptime_seconds": None,
                                     "error": "HTTPError: 502"},
                             now=_rth(ET), session_fn=session_fn)
    assert code == gate.EXIT_INCONCLUSIVE
    assert calls == [], "a refusal must measure NOTHING — the sampler was called"
    assert "502" in text and "retry loop" in text
    assert "REFUSED" in text


def test_a_non_200_that_is_not_502_still_refuses(gate):
    """A control on the shape of the guard: it is `!= 200`, not `== 502`."""
    for status in (500, 503, 403, 301, 401):
        assert gate.pod_settled_refusal({"status": status}) is not None, status


def test_an_uptime_of_120_REFUSES_and_names_both_numbers(gate, tmp_path, ET,
                                                         session_fn):
    code, text, calls = _run(gate, tmp_path,
                             health={"status": 200, "uptime_seconds": 120.0},
                             now=_rth(ET), session_fn=session_fn)
    assert code == gate.EXIT_INCONCLUSIVE
    assert calls == []
    assert "120 s old" in text, "the refusal must name the age it SAW"
    assert "300 s" in text, "...and the floor it was measured against"


def test_the_uptime_floor_has_an_EDGE(gate):
    """⛔ MUTATION TARGET. Drop `POD_FLOOR_S` to 0 (or flip `<` to `<=`) and this
    goes red — a floor that admits everything is not a floor."""
    assert gate.POD_FLOOR_S == 300.0, (
        "clause 2 says 'a pod >= 300 s old'; changing this changes the gate")
    assert gate.pod_settled_refusal({"status": 200, "uptime_seconds": 300.0}) is None
    assert gate.pod_settled_refusal({"status": 200, "uptime_seconds": 299.9}) is not None
    assert gate.pod_settled_refusal({"status": 200, "uptime_seconds": 0.0}) is not None


def test_an_UNREADABLE_health_read_is_never_laundered_into_a_pod_age(gate):
    """⛔ `None` is not 'cold' and not 'settled'. An unreadable health endpoint is its
    own problem, and turning it into an age is how a run judges a pod it never saw."""
    r = gate.pod_settled_refusal({"status": None, "uptime_seconds": None,
                                  "error": "URLError: timed out"})
    assert r is not None and "laundered" in r
    # 200 with a non-numeric age is the same class, and `True` is an int in Python.
    assert gate.pod_settled_refusal({"status": 200, "uptime_seconds": None}) is not None
    assert gate.pod_settled_refusal({"status": 200, "uptime_seconds": "1800"}) is not None
    assert gate.pod_settled_refusal({"status": 200, "uptime_seconds": True}) is not None


def test_a_WEEKEND_clock_REFUSES(gate, tmp_path, ET, session_fn):
    """⛔ The other half of the 2026-09-26 run: it was a Saturday."""
    code, text, calls = _run(gate, tmp_path, health=_healthy(),
                             now=_weekend(ET), session_fn=session_fn)
    assert code == gate.EXIT_INCONCLUSIVE
    assert calls == []
    assert "Saturday" in text
    assert "not inside regular trading hours" in text


def test_a_HOLIDAY_mid_afternoon_REFUSES(gate, tmp_path, ET, session_fn):
    """⛔ THE CASE A WEEKDAY-ONLY CLOCK PASSES. 2026-09-07 is Labor Day — a Monday,
    14:30, squarely inside 09:30-16:00. Every other 'is the market open' function in
    `api/**` that hard-codes those hours without the calendar would say OPEN."""
    code, text, calls = _run(gate, tmp_path, health=_healthy(),
                             now=_holiday(ET), session_fn=session_fn)
    assert code == gate.EXIT_INCONCLUSIVE
    assert calls == []
    assert "Monday 2026-09-07" in text
    assert "not inside regular trading hours" in text


def test_a_HALF_DAY_is_RTH_before_its_close_and_NOT_after(gate, ET, session_fn):
    """⛔ 2026-11-27 closes at 13:00 ET. Both directions, because a clock that gets
    one right and the other wrong is the shape that shipped in the product until
    2026-09-10 (a live sweep firing for three hours after the last bar settled)."""
    assert gate.rth_refusal(_half_open(ET), session_fn=session_fn) is None, (
        "12:00 on a 13:00-close half-day IS regular trading hours")
    after = gate.rth_refusal(_half_shut(ET), session_fn=session_fn)
    assert after is not None, "14:00 on a 13:00-close half-day is NOT"
    assert "Friday 2026-11-27 14:00" in after


def test_an_UNDRIVABLE_clock_is_INCONCLUSIVE_never_a_hand_rolled_fallback(gate, ET):
    """⛔ A missing authority must not become a weekday + 09:30-16:00 guess. That
    guess reads a half-day as a full session, so a silent fallback would reintroduce
    the bug the authority was fixed for."""
    r = gate.rth_refusal(
        _rth(ET),
        resolve_fn=lambda: (_ for _ in ()).throw(ImportError("no api package here")))
    assert r is not None
    assert "never a silent fallback" in r
    assert gate.SESSION_AUTHORITY in r, "the refusal must NAME the missing authority"


def test_a_NOT_COMPUTABLE_p95_is_reported_and_is_neither_a_PASS_nor_a_FAIL(
        gate, tmp_path, ET, session_fn):
    """⛔⛔ THE DISTINCTION THE INSTRUMENT WAS FIXED FOR. When every sampled read
    waited, the no-wait population is empty and there is no p95 — which is not a
    slow product and not a fast one."""
    code, text, calls = _run(gate, tmp_path, health=_healthy(), now=_rth(ET),
                             session_fn=session_fn,
                             samples={"D": _ALL_WAITED, "5": _WARM})
    assert calls == ["D", "5"], "preconditions held, so both timeframes are sampled"
    assert code == gate.EXIT_INCONCLUSIVE, (
        "NOT COMPUTABLE must be exit 2 — never 1 (a measured failure) and never 0")
    assert "NOT COMPUTABLE" in text
    assert "neither a PASS nor a FAIL" in text
    # ...and the waited-read latency must not be presentable as the p95.
    assert "Do NOT read the waited-read latency below as a p95" in text


# ──────────────────────────────────────────────────────────────────────────────
# 2. THE CONTROL THAT MATTERS — a valid run must PASS
# ──────────────────────────────────────────────────────────────────────────────

def test_CONTROL_a_fully_valid_fixture_PASSES(gate, tmp_path, ET, session_fn):
    """⛔⛔ WITHOUT THIS THE WHOLE FILE IS VACUOUS. A runner that refuses every
    condition satisfies every refusal test above and can never take the gate."""
    code, text, calls = _run(gate, tmp_path, health=_healthy(), now=_rth(ET),
                             session_fn=session_fn)
    assert code == gate.EXIT_WITHIN, f"a valid, warm run must exit 0, got {code}"
    assert calls == ["D", "5"], "both timeframes must actually be measured"
    assert "WITHIN THE BAR" in text
    assert "INCOMPLETE" not in text, "the claim must have been overwritten"


def test_CONTROL_a_valid_run_records_its_own_validity_evidence(gate, tmp_path, ET,
                                                               session_fn):
    """A recorded result has to carry the conditions it was taken under, or the next
    reader has to take them on trust — which is what went wrong on 2026-09-26."""
    _code, text, _calls = _run(gate, tmp_path, health=_healthy(), now=_rth(ET),
                               session_fn=session_fn)
    assert "1800" in text, "the pod's uptime_seconds must appear in the artifact"
    assert "2026-09-23 12:00:00" in text, "the ET timestamp must appear"
    assert "Wednesday" in text
    assert gate.SESSION_AUTHORITY in text, (
        "the artifact must name which market-hours authority it used")


def test_an_OVER_the_bar_run_is_exit_1_and_says_it_is_a_product_reading(
        gate, tmp_path, ET, session_fn):
    code, text, _calls = _run(gate, tmp_path, health=_healthy(), now=_rth(ET),
                              session_fn=session_fn,
                              samples={"D": _SLOW, "5": _WARM})
    assert code == gate.EXIT_OVER
    assert "OVER THE BAR" in text
    assert "400 ms > 250 ms" in text
    assert "IS a product reading" in text


# ──────────────────────────────────────────────────────────────────────────────
# 3. THE THREE CODES ARE THREE ANSWERS
# ──────────────────────────────────────────────────────────────────────────────

def test_the_three_exit_codes_are_distinct(gate):
    """⛔ MUTATION TARGET. Make any two equal and this goes red first."""
    assert (gate.EXIT_WITHIN, gate.EXIT_OVER, gate.EXIT_INCONCLUSIVE) == (0, 1, 2)
    assert len({gate.EXIT_WITHIN, gate.EXIT_OVER, gate.EXIT_INCONCLUSIVE}) == 3


def test_verdict_separates_INCONCLUSIVE_from_OVER(gate):
    """⛔⛔ MUTATION TARGET — collapse 2 into 1 in `verdict()`'s uncomputable branch
    and this goes red. 'We could not compute it' and 'the product is over the bar'
    are different facts to whoever reads the result, and conflating them makes an
    unmeasured night look like a regression."""
    assert gate.verdict([("D", 271.0), ("5", 82.0)])[0] == gate.EXIT_OVER
    assert gate.verdict([("D", None), ("5", 82.0)])[0] == gate.EXIT_INCONCLUSIVE
    assert gate.verdict([("D", 100.0), ("5", 82.0)])[0] == gate.EXIT_WITHIN
    assert gate.verdict([])[0] == gate.EXIT_INCONCLUSIVE
    # And they must not merely differ — the INCONCLUSIVE one must SAY so.
    assert "INCONCLUSIVE" in gate.verdict([("D", None)])[1]
    assert "OVER THE BAR" in gate.verdict([("D", 271.0)])[1]


def test_the_bar_is_250ms_and_has_an_edge(gate):
    assert gate.P95_BAR_MS == 250.0, "CARD 16's ratified bar"
    assert gate.verdict([("D", 250.0)])[0] == gate.EXIT_WITHIN
    assert gate.verdict([("D", 250.1)])[0] == gate.EXIT_OVER


# ──────────────────────────────────────────────────────────────────────────────
# 4. THE TIER MIX IS REPORTED BESIDE, NEVER AS PASS/FAIL
# ──────────────────────────────────────────────────────────────────────────────

def test_the_tier_mix_is_STRUCTURALLY_unable_to_reach_the_verdict(gate):
    """⭐ Clause 2 says the tier mix is reported beside the p95 and never as
    pass/fail. That is enforced by `verdict()`'s SIGNATURE — the mix is not in its
    argument list — rather than by a comment somebody can stop keeping."""
    params = list(inspect.signature(gate.verdict).parameters)
    assert params == ["p95_by_tf"], (
        "verdict() grew an argument. If it can see the tier mix, the mix can decide "
        "a pass — which clause 2 forbids in those words.")


def test_an_all_stale_served_sample_still_PASSES_on_latency(gate, tmp_path, ET,
                                                            session_fn):
    """⛔ Deliberate and load-bearing. `stale-swr` is served INSTANTLY, so it belongs
    in the latency population; that a pass can be bought with stale data is exactly
    why the mix is printed beside the number for a human to read."""
    code, text, _calls = _run(gate, tmp_path, health=_healthy(), now=_rth(ET),
                              session_fn=session_fn,
                              samples={"D": _STALE, "5": _STALE})
    assert code == gate.EXIT_WITHIN
    assert "stale-served | 20/20" in text.replace("**", "") or "20/20" in text
    assert "never a pass/fail input" in text


def test_the_tier_mix_is_actually_PRINTED_beside_the_numbers(gate, tmp_path, ET,
                                                             session_fn):
    """A non-vacuity control on the paragraph above: 'not a pass/fail input' is only
    acceptable because the mix is visible."""
    _code, text, _calls = _run(gate, tmp_path, health=_healthy(), now=_rth(ET),
                               session_fn=session_fn)
    assert "Tier mix" in text
    assert "warm" in text and "stale-served" in text and "waited" in text
    assert "'mem': 19" in text or '"mem": 19' in text, (
        "the raw layer counts must be in the artifact, not just a summary")


def test_the_one_tier_alarm_fires_only_on_intraday_during_RTH_over_the_line(gate):
    from collections import Counter
    assert gate.TIER_ALARM_SHARE == 0.10
    over = Counter({"mem": 17, "fetch": 3})          # 15%
    at_line = Counter({"mem": 18, "fetch": 2})       # 10% — at, not above
    assert gate.tier_alarm("5", over, True) is not None
    assert gate.tier_alarm("5", at_line, True) is None, "'above ~10%' excludes 10%"
    assert gate.tier_alarm("D", Counter({"mem": 1, "fetch": 19}), True) is None, (
        "the clause says INTRADAY; daily is outside the alarm by construction")
    assert gate.tier_alarm("5", over, False) is None, (
        "the clause says DURING RTH — outside it the share means nothing")
    assert gate.tier_alarm("5", Counter(), True) is None, "no sample, no alarm"
    assert "NOT a pass/fail input" in gate.tier_alarm("5", over, True)


def test_the_alarm_layers_are_the_two_the_clause_NAMES_and_are_inside_COLD(gate):
    """⛔ `lesson_a_guard_that_tests_the_adjacent_thing`, as two sentences: the alarm
    set must be a subset of the instrument's COLD set (they are waits), and it must
    NOT be the whole of it (the clause names `fetch`/`miss`, not `disk` or
    `inflight-wait`). Equality would be a different alarm wearing this one's name."""
    audit = gate.audit_module()
    assert gate.ALARM_LAYERS == {"fetch", "miss"}
    assert gate.ALARM_LAYERS < audit.COLD, (
        "the alarm layers must be a STRICT subset of the instrument's COLD set")


# ──────────────────────────────────────────────────────────────────────────────
# 5. THE ARTIFACT IS CLAIMED BEFORE THE RUN
# ──────────────────────────────────────────────────────────────────────────────

def test_the_artifact_is_claimed_BEFORE_the_measurement_starts(gate, tmp_path, ET,
                                                               session_fn):
    """⛔ A run that dies mid-flight must leave an explicit INCOMPLETE. The recorded
    incident: Phase 2 device run 2's Pixel 8 threw before the code that writes its
    result, the PREVIOUS run's file stayed on disk, and it read as a current pass."""
    def _explode(base, tf, n, bars):
        raise RuntimeError("the run died here, exactly as one really did")

    with pytest.raises(RuntimeError):
        gate.main(["--tf", "D,5", "--n", "3"],
                  health_fn=lambda base: _healthy(),
                  clock_fn=lambda: _rth(ET),
                  session_fn=session_fn,
                  sample_fn=_explode,
                  evidence_root=str(tmp_path))
    written = sorted(tmp_path.rglob("results.md"))
    assert len(written) == 1, "the artifact must exist even though the run died"
    text = written[0].read_text(encoding="utf-8")
    assert gate.CLAIM_STATUS in text
    assert "INCOMPLETE" in text
    assert "did not finish" in text
    assert "It is not a result" in text
    assert "250" in text, "the claim must NAME the intended run, not just say INCOMPLETE"


def test_the_placeholder_is_overwritten_only_by_a_real_result(gate, tmp_path, ET,
                                                             session_fn):
    _code, text, _calls = _run(gate, tmp_path, health=_healthy(), now=_rth(ET),
                               session_fn=session_fn)
    assert gate.CLAIM_STATUS not in text
    assert "INCOMPLETE" not in text


def test_a_refusal_is_recorded_as_a_refusal_not_left_as_INCOMPLETE(gate, tmp_path, ET,
                                                                  session_fn):
    """A refusal IS a result — it records that the gate was not takeable — so it must
    replace the claim rather than leaving a file that reads as a dead run."""
    _code, text, _calls = _run(gate, tmp_path,
                               health={"status": 502, "uptime_seconds": None},
                               now=_weekend(ET), session_fn=session_fn)
    assert gate.CLAIM_STATUS not in text
    assert "REFUSED" in text
    assert "Nothing was measured" in text
    # BOTH refusals are reported, not whichever was checked first.
    assert "502" in text and "Saturday" in text


def test_the_artifact_path_follows_the_evidence_convention(gate):
    """`docs/terminal-research/10-roadmap/evidence/<date>-<slug>-<HHMM>Z/results.md`,
    the shape every sibling directory uses."""
    now = _dt.datetime(2026, 9, 27, 14, 5, tzinfo=_dt.timezone.utc)
    p = gate.evidence_path(now)
    assert p.name == "results.md"
    assert p.parent.name == "2026-09-27-card16-p95-gate-1405Z"
    assert p.parent.parent.name == "evidence"
    assert p.parent.parent.parent.name == "10-roadmap"
    assert (_ROOT / "docs" / "terminal-research" / "10-roadmap"
            / "evidence").is_dir(), "the convention directory must exist"


def test_the_artifact_is_written_LF_on_every_platform(gate, tmp_path):
    """⛔ Bytes, not text mode: text mode on Windows translates to CRLF and a repo
    file with the wrong endings turns a small edit into an unreviewable diff (R-2)."""
    p = tmp_path / "x" / "results.md"
    gate.write_lf(p, ["a", "b"])
    raw = p.read_bytes()
    assert raw == b"a\nb\n"
    assert raw.count(b"\r") == 0


# ──────────────────────────────────────────────────────────────────────────────
# 6. THE SEAMS ARE LATE-BOUND, AND THE PATCH ACTUALLY REACHES THEM
# ──────────────────────────────────────────────────────────────────────────────

_INJECTABLE = {
    "main": ("health_fn", "clock_fn", "session_fn", "sample_fn", "evidence_root"),
    "read_health": ("urlopen_fn",),
    "rth_refusal": ("session_fn", "resolve_fn"),
    "resolve_session_fn": ("pin_fn", "import_fn"),
    "pin_shared_data_root": ("census_fn", "mkdtemp_fn", "environ"),
    "sample_timeframe": ("audit", "client"),
    "timeframe_result": ("audit",),
    "audit_module": ("loader",),
}


def test_every_injectable_seam_defaults_to_None(gate):
    """⛔ A default argument is evaluated ONCE at import and captures the original
    object forever, so `monkeypatch.setattr(module, name, fake)` reaches nothing and
    the test silently exercises the real function. That defect cost this repo a real
    run (`scripts/gate_shards.py`, 2026-09-17) and it presented as FLAKINESS."""
    for fn_name, params in _INJECTABLE.items():
        sig = inspect.signature(getattr(gate, fn_name))
        for p in params:
            assert p in sig.parameters, f"{fn_name} lost its {p} seam"
            assert sig.parameters[p].default is None, (
                f"{fn_name}({p}=...) has a non-None default — it is bound at import "
                "and a module patch will reach nothing")


def test_a_module_patch_on_read_health_IS_CALLED(gate, monkeypatch, tmp_path, ET,
                                                 session_fn):
    """⛔ The signature check above passes if the body IGNORES the parameter. This
    proves the resolution actually happens — the non-vacuity control on it."""
    seen = []

    def _fake(base, urlopen_fn=None):
        seen.append(base)
        return {"status": 502, "uptime_seconds": None}

    monkeypatch.setattr(gate, "read_health", _fake)
    code = gate.main(["--tf", "D", "--n", "1", "--base", "http://patched.invalid"],
                     clock_fn=lambda: _rth(ET), session_fn=session_fn,
                     sample_fn=lambda *a: _WARM, evidence_root=str(tmp_path))
    assert seen == ["http://patched.invalid"], "the patched read_health was not called"
    assert code == gate.EXIT_INCONCLUSIVE


def test_a_module_patch_on_sample_timeframe_IS_CALLED(gate, monkeypatch, tmp_path, ET,
                                                      session_fn):
    seen = []

    def _fake(base, tf, n, bars, audit=None, client=None):
        seen.append((tf, n, bars))
        return _WARM

    monkeypatch.setattr(gate, "sample_timeframe", _fake)
    code = gate.main(["--tf", "D,5", "--n", "7"],
                     health_fn=lambda base: _healthy(),
                     clock_fn=lambda: _rth(ET), session_fn=session_fn,
                     evidence_root=str(tmp_path))
    assert [tf for tf, _n, _b in seen] == ["D", "5"]
    assert all(n == 7 for _tf, n, _b in seen)
    assert code == gate.EXIT_WITHIN


def test_resolve_session_fn_PINS_before_it_imports(gate):
    """⛔⛔ ORDER IS THE WHOLE PROPERTY. `/data` literals are captured at MODULE
    IMPORT, so a pin applied afterwards reaches nothing — and `/data` is a real
    directory on this box holding the owner's live files."""
    order = []

    def _pin():
        order.append("pin")

    def _import():
        order.append("import")
        return lambda now: None

    fn, authority = gate.resolve_session_fn(pin_fn=_pin, import_fn=_import)
    assert order == ["pin", "import"], f"pinned after importing: {order}"
    assert authority == gate.SESSION_AUTHORITY
    assert fn(_dt.datetime.now()) is None


def test_pin_shared_data_root_applies_the_WHOLE_census_to_a_sandbox(gate):
    """⛔ THE CENSUS, NEVER A HAND-PICKED VAR. Setting `DATA_DIR` alone was measured
    writing two live databases on 2026-09-12, because 71 of the 72 path vars do not
    resolve through it. Hermetic: its own dict, its own fake sandbox — this test does
    not touch `os.environ` and does not create a directory."""
    fake_env = {}
    census = lambda: ({}, {"AUTH_DB_PATH": "/data/auth.db",
                           "COT_DB_PATH": "/data/cot.db"}, [])
    sandbox = gate.pin_shared_data_root(census_fn=census,
                                        mkdtemp_fn=lambda: "/sandbox",
                                        environ=fake_env)
    assert sandbox == "/sandbox"
    assert fake_env == {"AUTH_DB_PATH": "/sandbox/auth.db",
                        "COT_DB_PATH": "/sandbox/cot.db"}
    assert not any(v.startswith("/data") for v in fake_env.values())
    # And the real census must be non-empty, or the pinning above is decorative.
    import conftest
    _lits, real_pins, _unpinnable = conftest.shared_data_root_census()
    assert len(real_pins) > 50, f"census returned only {len(real_pins)} pins"


# ──────────────────────────────────────────────────────────────────────────────
# 7. IT WRAPS THE INSTRUMENT RATHER THAN COPYING IT
# ──────────────────────────────────────────────────────────────────────────────

def test_the_runner_defines_no_second_copy_of_the_buckets_or_the_percentile(gate):
    """⛔ `tools/bars_warmth_audit.py` owns WARM / STALE_SERVED / COLD and `pct_of`.
    A copy here would be a second authority over one value, and the two would agree
    on the day it was written and silently disagree later."""
    for name in ("WARM", "STALE_SERVED", "COLD", "pct_of", "_serve_layer",
                 "_universe", "_stratified"):
        assert not hasattr(gate, name), (
            f"bars_warmth_gate defines its own `{name}` — it must import the "
            "instrument's, not restate it")


def test_the_p95_comes_from_the_instruments_own_percentile_helper(gate):
    """Continuity: a number this runner prints must compare with one already in the
    record, which only holds if the arithmetic is the instrument's."""
    audit = gate.audit_module()
    vals = [float(v) for v in range(10, 210, 10)]                # 10..200, n = 20
    r = gate.timeframe_result("D", [("mem", v) for v in vals])
    assert r["p95_ms"] == audit.pct_of(sorted(vals), 0.95)
    assert r["p50_ms"] == audit.pct_of(sorted(vals), 0.50)


def test_the_no_wait_population_is_warm_PLUS_stale_served(gate):
    """The population CARD 16's latency bar is computed over — everyone who did not
    wait. Folding `stale-swr` into COLD is what emptied the daily set and left the
    bar uncomputable while a cold p50/max was recorded as a p95 pass."""
    mixed = ([("mem", 10.0)] * 10 + [("stale-swr", 20.0)] * 10
             + [("fetch", 5000.0)] * 5)
    r = gate.timeframe_result("D", mixed)
    assert r["nowait_n"] == 20
    assert r["waited"] == 5
    assert r["warm"] == 10 and r["stale_served"] == 10
    assert r["p95_ms"] is not None and r["p95_ms"] < 100.0, (
        "a waited read must not enter the gate's population")


def test_the_instrument_is_NOT_modified_by_this_wrapper(gate):
    """A structural statement of the brief: `bars_warmth_audit.py` is the instrument
    and it is correct. This asserts the wrapper reads the same file the existing
    bucket rail reads, so the two cannot drift onto different copies."""
    audit_path = _ROOT / "tools" / "bars_warmth_audit.py"
    assert audit_path.is_file()
    mod = gate.audit_module()
    assert pathlib.Path(mod.__file__).resolve() == audit_path.resolve()


# ──────────────────────────────────────────────────────────────────────────────
# 8. THE RUNNER'S OWN SELF-CHECK CAN FAIL
# ──────────────────────────────────────────────────────────────────────────────

def test_the_self_check_passes_and_is_not_vacuous(gate, capsys):
    """Rule 14. It must PASS here — and it must actually assert things, so a
    self-check that silently stopped exercising the guards is visible."""
    assert gate.self_check() == 0
    printed = capsys.readouterr().out
    assert "self-check: PASS" in printed
    assert printed.count("  ok  ") >= 15, (
        f"the self-check ran only {printed.count('  ok  ')} cases")
    assert "FAIL" not in printed.replace("self-check: PASS", "")


def test_no_network_was_needed_for_any_of_this(gate, monkeypatch):
    """⛔ THE FILE'S OWN CONTRACT, ENFORCED. Every test above injects its seams; this
    proves the default network door is `urllib.request.urlopen` and that nothing in
    the pure layer touches it."""
    import urllib.request

    def _forbidden(*a, **k):
        raise AssertionError("a rail reached the network")

    monkeypatch.setattr(urllib.request, "urlopen", _forbidden)
    # Everything in the decision layer must still work with the door nailed shut.
    assert gate.pod_settled_refusal({"status": 200, "uptime_seconds": 900}) is None
    assert gate.verdict([("D", 10.0)])[0] == gate.EXIT_WITHIN
    assert gate.timeframe_result("D", _WARM)["p95_ms"] == 90.0
    # ...and the one function that DOES open the door reports the refusal, not a crash.
    h = gate.read_health("http://nowhere.invalid")
    assert h["status"] is None and h["error"]



# ── 2026-09-30: a p95 of two samples is their maximum ─────────────────────────

def test_the_minimum_no_wait_n_is_DERIVED_from_the_quantile(gate):
    """5% of n must be at least one sample, or the p95 is simply the max."""
    assert gate.MIN_NOWAIT_N == 20
    assert gate.MIN_NOWAIT_N * (1 - gate.P95_Q) >= 1 - 1e-9
    assert (gate.MIN_NOWAIT_N - 1) * (1 - gate.P95_Q) < 1


def test_the_2026_09_30_shape_is_INCONCLUSIVE_not_WITHIN(gate):
    """The real reading: 2 of 40 did not wait on D, 1 of 40 on 5 -- it exited 0."""
    d = gate.timeframe_result("D", [("stale-swr", 96.0)] * 2 + [("fetch", 900.0)] * 38)
    i = gate.timeframe_result("5", [("sqlite", 79.0)] + [("fetch", 900.0)] * 39)
    assert d["p95_ms"] is None and "only 2 of 40" in d["not_computable"]
    assert i["p95_ms"] is None
    code, _ = gate.verdict([("D", d["p95_ms"]), ("5", i["p95_ms"])])
    assert code == gate.EXIT_INCONCLUSIVE


def test_one_below_the_minimum_refuses_and_the_minimum_computes(gate):
    below = gate.timeframe_result("D", [("mem", 50.0)] * (gate.MIN_NOWAIT_N - 1))
    at = gate.timeframe_result("D", [("mem", 50.0)] * gate.MIN_NOWAIT_N)
    assert below["p95_ms"] is None and at["p95_ms"] == 50.0


def test_connection_setup_is_paid_OUTSIDE_the_timed_sample(gate, monkeypatch):
    """Measured 2026-09-30: an unwarmed first read took 1,120 ms wall for 73.5 ms of
    server time. The warm-up request must precede every timed read."""
    calls = []

    class Client:
        def get(self, url, **k):
            calls.append(("warm", url))

    audit = gate.audit_module()
    monkeypatch.setattr(audit, "_universe", lambda: ["AAA", "BBB"])
    monkeypatch.setattr(audit, "_serve_layer",
                        lambda base, sym, tf, bars, client: (calls.append(("timed", sym)) or ("mem", 1.0, 200, 1)))
    # the gate's own-client path, driven through a stub client factory
    import httpx
    monkeypatch.setattr(httpx, "Client", lambda **k: type("C", (), {"get": Client().get, "close": lambda self: None})())
    gate.sample_timeframe("https://x", "D", 2, 10, audit=audit)
    assert calls[0] == ("warm", "https://x/api/health")
    assert [c[0] for c in calls[1:]] == ["timed", "timed"]
