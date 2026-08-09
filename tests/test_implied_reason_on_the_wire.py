"""The refusal reason reaches the member, and says the RIGHT thing.

`248da42d` taught the pipeline to refuse rather than fabricate, but the reason
stopped at the two internal callers. Both member-facing routers emitted a bare
`expected_move: null` — one null standing for six distinct facts (two refusals,
three provider outages, a 15s timeout, a deliberately-skipped past report, and
"not arrived yet"). Labelling that null would have stated a WRONG reason in
four cases of six.

These are the rails on the fix. The vocabulary is never retyped here: every
test that needs the set of reasons reads it off `implied_move` itself.
"""
from __future__ import annotations

import ast
import pathlib
import time
from datetime import timedelta
from unittest import mock

import pytest
from fastapi.testclient import TestClient

from api.main import app
from api.routers import calendar as cal_mod
from api.services import implied_move as _im

ROOT = pathlib.Path(__file__).resolve().parents[1]
client = TestClient(app)


def _all_reasons() -> frozenset[str]:
    """THE vocabulary, read off the module that owns it. Never a typed list —
    a test that restated it would be a second authority over the one value it
    exists to police, and would go green the day the two drifted apart."""
    return _im.REFUSAL_REASONS | _im.UNAVAILABLE_REASONS


# ── The serializer ────────────────────────────────────────────────────────────

def test_every_reason_the_module_knows_serializes_to_a_named_kind_and_cause():
    reasons = _all_reasons()
    # Abort-on-zero: an empty vocabulary would make this loop pass vacuously.
    assert len(reasons) >= 6, reasons
    for reason in sorted(reasons):
        wire = _im.wire_outcome({"ok": False, "kind": "ignored-by-the-serializer",
                                 "reason": reason, "evidence": {"spot": 1.0}})
        assert wire["reason"] == reason
        # `kind` is re-derived from `outcome_kind`, never copied out of the
        # out-dict — that is what makes an unrecognised reason safe.
        assert wire["kind"] == _im.outcome_kind(reason)
        assert wire["kind"] in _im.KINDS


def test_the_refused_and_unavailable_halves_stay_separable_on_the_wire():
    for reason in sorted(_im.REFUSAL_REASONS):
        assert _im.wire_outcome({"ok": False, "reason": reason})["kind"] == _im.KIND_REFUSED
    for reason in sorted(_im.UNAVAILABLE_REASONS):
        assert _im.wire_outcome({"ok": False, "reason": reason})["kind"] == _im.KIND_UNAVAILABLE
    # Non-empty and disjoint — otherwise both loops above could be vacuous.
    assert _im.REFUSAL_REASONS and _im.UNAVAILABLE_REASONS
    assert not (_im.REFUSAL_REASONS & _im.UNAVAILABLE_REASONS)


def test_a_seventh_reason_renders_as_unavailable_and_never_as_a_refusal():
    """The whole point of keying the UI on `kind`: a reason added on the server
    tomorrow reaches every surface correctly TODAY, and can never claim to be a
    refusal it cannot name."""
    novel = "a_reason_no_release_has_ever_shipped"
    assert novel not in _all_reasons()
    wire = _im.wire_outcome({"ok": False, "reason": novel})
    assert wire == {"kind": _im.KIND_UNAVAILABLE, "reason": novel}


def test_a_not_ok_outcome_can_never_serialize_a_blank_reason():
    """A blank reason renders as nothing, which is the bare null all over
    again. An outcome that failed without naming itself degrades to a named
    fallback instead."""
    for empty in ({"ok": False}, {"ok": False, "reason": None}, {"ok": False, "reason": ""}):
        wire = _im.wire_outcome(empty)
        assert wire["reason"], wire
        assert wire["kind"] == _im.KIND_UNAVAILABLE


def test_nothing_attempted_serializes_to_null_not_to_an_invented_reason():
    """'We never asked' is a different fact from 'we asked and got nothing'.
    Collapsing them is how one null came to mean six things."""
    assert _im.wire_outcome(None) is None
    assert _im.wire_outcome({}) is None


def test_a_priced_move_says_ok_and_names_no_cause():
    assert _im.wire_outcome({"ok": True}) == {"kind": _im.KIND_OK, "reason": None}


def test_internal_evidence_is_not_serialized_to_the_member():
    wire = _im.wire_outcome({"ok": False, "reason": _im.REFUSED_NO_ATM_STRIKE,
                             "evidence": {"strike": 0.5, "spot": 0.35, "moneyness": 0.43}})
    assert set(wire) == {"kind", "reason"}


# ── The calendar router ───────────────────────────────────────────────────────

def _current_week_day() -> str:
    """A NON-PAST day inside the router's compute window (weekend-aware)."""
    return max(cal_mod._today_et(), cal_mod._week_dates()[0]).isoformat()


def _reading(reason=None, *, move=None, sleep=0.0):
    """A stand-in for `implied_move.get_expected_move` that fills the SAME
    out-dict the real one does — the whole contract under test."""
    def _fn(sym, report_date=None, *, outcome=None):
        if sleep:
            time.sleep(sleep)
        if outcome is not None:
            outcome.clear()
            outcome.update({"ok": True} if reason is None else
                           {"ok": False, "kind": _im.outcome_kind(reason),
                            "reason": reason, "evidence": {"spot": 0.35}})
        return dict(move) if move else None
    return _fn


def _enrich(ds, read_fn, *, cutover="1", monkeypatch=None, day=None):
    """Drive the REAL `_build_enrichment_for_date` for one symbol."""
    cal = {"days": {ds: day or {"bmo": [{"sym": "TSTX"}], "amc": [], "tbd": []}}}
    if monkeypatch is not None:
        monkeypatch.setenv("IMPLIED_ENRICHMENT_CUTOVER", cutover)
    with mock.patch("api.routers.calendar.cache.get",
                    side_effect=lambda k: cal if k == "calendar_weekly" else None), \
         mock.patch("api.routers.calendar.cache.set"), \
         mock.patch("api.services.implied_move.get_expected_move", side_effect=read_fn), \
         mock.patch("api.services.earnings_estimates.get_earnings_intel", return_value=None):
        r = client.get(f"/api/calendar/enrichment?date={ds}")
    assert r.status_code == 200
    return r.json()


@pytest.mark.parametrize("reason", sorted(_im.REFUSAL_REASONS))
def test_a_refused_move_reaches_the_calendar_payload_with_its_reason(reason, monkeypatch):
    body = _enrich(_current_week_day(), _reading(reason), monkeypatch=monkeypatch)
    row = body["TSTX"]
    assert row["expected_move"] is None
    assert row["expected_move_outcome"] == {"kind": _im.KIND_REFUSED, "reason": reason}


@pytest.mark.parametrize("reason", sorted(_im.UNAVAILABLE_REASONS))
def test_a_provider_outage_reaches_the_calendar_payload_as_unavailable(reason, monkeypatch):
    body = _enrich(_current_week_day(), _reading(reason), monkeypatch=monkeypatch)
    assert body["TSTX"]["expected_move_outcome"] == {
        "kind": _im.KIND_UNAVAILABLE, "reason": reason}


def test_a_priced_calendar_move_carries_kind_ok_beside_its_number(monkeypatch):
    body = _enrich(_current_week_day(),
                   _reading(move={"pct": 6.234567891, "dollar": 12.3456789}),
                   monkeypatch=monkeypatch)
    row = body["TSTX"]
    assert row["expected_move"]["pct"] == 6.2          # rounding is unchanged
    assert row["expected_move_outcome"] == {"kind": _im.KIND_OK, "reason": None}


def test_a_past_report_carries_no_outcome_because_nothing_was_attempted(monkeypatch):
    """`is_past` skips the chain read entirely, so there is no absence to
    explain. A null outcome here is the honest answer and keeps the surfaces'
    existing em dash — inventing 'unavailable' would be a wrong reason."""
    past = cal_mod._today_et() - timedelta(days=3)
    while past.weekday() >= 5:
        past -= timedelta(days=1)
    day = {"bmo": [{"sym": "TSTX", "eps_act": 1.0}], "amc": [], "tbd": []}
    monkeypatch.setenv("IMPLIED_ENRICHMENT_CUTOVER", "1")
    calls = {"n": 0}

    def _never(*a, **k):
        calls["n"] += 1
        return None

    with mock.patch.object(cal_mod, "_days_for_date", return_value=day), \
         mock.patch("api.routers.calendar.cache.get", return_value=None), \
         mock.patch("api.routers.calendar.cache.set"), \
         mock.patch("api.services.implied_move.get_expected_move", side_effect=_never), \
         mock.patch("api.services.earnings_estimates.get_earnings_intel", return_value=None):
        r = client.get(f"/api/calendar/enrichment?date={past.isoformat()}")
    assert r.status_code == 200
    assert calls["n"] == 0
    row = r.json()["TSTX"]
    assert row["expected_move"] is None
    assert row["expected_move_outcome"] is None


def test_the_legacy_builder_path_leaves_its_null_bare(monkeypatch):
    """⛔ The legacy yfinance builder is NOT gated or changed by this work. It
    reports no reason of its own, so a clean None from it stays a bare null and
    the surfaces keep rendering exactly what they render today. Manufacturing a
    reason for it would be the invention this whole change refuses to make."""
    ds = _current_week_day()
    cal = {"days": {ds: {"bmo": [{"sym": "TSTX"}], "amc": [], "tbd": []}}}
    monkeypatch.setenv("IMPLIED_ENRICHMENT_CUTOVER", "0")
    with mock.patch("api.routers.calendar.cache.get",
                    side_effect=lambda k: cal if k == "calendar_weekly" else None), \
         mock.patch("api.routers.calendar.cache.set"), \
         mock.patch("api.services.earnings_enrichment.get_implied_move", return_value=None), \
         mock.patch("api.services.earnings_estimates.get_earnings_intel", return_value=None):
        r = client.get(f"/api/calendar/enrichment?date={ds}")
    assert r.status_code == 200
    row = r.json()["TSTX"]
    assert row["expected_move"] is None and row["expected_move_outcome"] is None


# ── 🔴 The timeout must never masquerade as a refusal ─────────────────────────

def _short_bounded(monkeypatch, timeout=0.15):
    """Keep the REAL `_bounded_em` under test; shorten only its clock."""
    real = cal_mod._bounded_em
    monkeypatch.setattr(cal_mod, "_bounded_em",
                        lambda fn, t=timeout, **kw: real(fn, t, **kw))


def test_a_timeout_is_reported_as_a_timeout_and_never_as_a_refusal(monkeypatch):
    """🔴 The highest-value rail in this change.

    The chain read is slow, and had it finished it WOULD have refused
    (`no_atm_strike`). The bounded call gives up first, so nothing was ever
    evaluated and nothing could have been refused. Telling a member "we could
    not price this" here would be a confident false statement about a number
    nobody computed — the exact defect class `248da42d` exists to remove.

    The outcome can only be right because it is filled INSIDE the callable: the
    holder stays empty when the callable never returns, and `_bounded_em`'s own
    fallback names the timeout.

    CONTROL: `test_..._the_same_read_without_the_delay_does_surface_the_refusal`
    runs the identical mock with the sleep removed and gets `no_atm_strike`, so
    this pair cannot both pass by the payload being empty either way.
    """
    _short_bounded(monkeypatch)
    body = _enrich(_current_week_day(),
                   _reading(_im.REFUSED_NO_ATM_STRIKE, sleep=1.0),
                   monkeypatch=monkeypatch)
    outcome = body["TSTX"]["expected_move_outcome"]
    assert outcome["reason"] == _im.UNAVAILABLE_TIMEOUT
    assert outcome["kind"] == _im.KIND_UNAVAILABLE
    assert outcome["kind"] != _im.KIND_REFUSED
    assert outcome["reason"] != _im.REFUSED_NO_ATM_STRIKE


def test_control_the_same_read_without_the_delay_does_surface_the_refusal(monkeypatch):
    _short_bounded(monkeypatch)
    body = _enrich(_current_week_day(),
                   _reading(_im.REFUSED_NO_ATM_STRIKE),
                   monkeypatch=monkeypatch)
    assert body["TSTX"]["expected_move_outcome"] == {
        "kind": _im.KIND_REFUSED, "reason": _im.REFUSED_NO_ATM_STRIKE}


def test_bounded_em_names_a_timeout_and_a_raise_differently():
    out: dict = {}
    assert cal_mod._bounded_em(lambda: time.sleep(1.0), 0.1, outcome=out) is None
    assert out["reason"] == _im.UNAVAILABLE_TIMEOUT

    def _boom():
        raise ValueError("bad json from the chain")

    out2: dict = {}
    assert cal_mod._bounded_em(_boom, 5.0, outcome=out2) is None
    assert out2["reason"] == _im.UNAVAILABLE_READ_ERROR
    assert out["reason"] != out2["reason"]


def test_bounded_em_never_writes_an_outcome_over_a_successful_call():
    """A callable that RAN owns the verdict — it came from the evaluation that
    withheld the number. The bounded wrapper must not guess over the top."""
    out: dict = {}
    assert cal_mod._bounded_em(lambda: {"pct": 3.0}, 5.0, outcome=out) == {"pct": 3.0}
    assert out == {}


def test_inhouse_move_hands_back_the_outcome_from_the_read_that_withheld_it():
    holder: dict = {}
    with mock.patch("api.services.implied_move.get_expected_move",
                    side_effect=_reading(_im.REFUSED_IMPLAUSIBLE_MOVE)):
        assert cal_mod._inhouse_move("TSTX", "2026-08-10", into=holder) is None
    assert holder["outcome"]["reason"] == _im.REFUSED_IMPLAUSIBLE_MOVE


# ── Telemetry: a bound firing is not an outage ────────────────────────────────

def test_an_all_refused_day_is_not_counted_as_an_enrichment_collapse(monkeypatch):
    ds = _current_week_day()
    _enrich(ds, _reading(_im.REFUSED_NO_ATM_STRIKE), monkeypatch=monkeypatch)
    stats = cal_mod._ENRICH_STATS[ds]
    assert stats["with_em"] == 0 and stats["em_refused"] == 1
    assert stats["em_collapsed"] is False


def test_an_all_outage_day_still_counts_as_an_enrichment_collapse(monkeypatch):
    ds = _current_week_day()
    _enrich(ds, _reading(_im.UNAVAILABLE_NO_CHAIN), monkeypatch=monkeypatch)
    stats = cal_mod._ENRICH_STATS[ds]
    assert stats["em_refused"] == 0 and stats["em_collapsed"] is True


# ── The research endpoint ─────────────────────────────────────────────────────

def _research_client():
    from api.routers import expected_move as em_router
    app.dependency_overrides[em_router.get_current_user] = lambda: {"id": "u1", "email": "t@t"}
    return TestClient(app), em_router


@pytest.mark.parametrize("reason", sorted(_all_reasons()))
def test_the_research_payload_carries_the_reason_beside_its_null(reason):
    c, em_router = _research_client()
    try:
        with mock.patch.object(em_router.implied_move, "get_expected_move",
                               side_effect=_reading(reason)), \
             mock.patch.object(em_router.implied_store, "get_implied_history", return_value=[]), \
             mock.patch.object(em_router.implied_store, "get_earliest_report_date", return_value=None), \
             mock.patch.object(em_router.setup_grade, "get_setup_grade", return_value=None):
            body = c.get("/api/research/expected-move/TSTX").json()
    finally:
        app.dependency_overrides.clear()
    assert body["live"] is None
    assert body["live_outcome"] == {"kind": _im.outcome_kind(reason), "reason": reason}


def test_a_raising_research_read_is_named_read_error_not_a_refusal():
    c, em_router = _research_client()
    try:
        with mock.patch.object(em_router.implied_move, "get_expected_move",
                               side_effect=ValueError("bad json")), \
             mock.patch.object(em_router.implied_store, "get_implied_history", return_value=[]), \
             mock.patch.object(em_router.implied_store, "get_earliest_report_date", return_value=None), \
             mock.patch.object(em_router.setup_grade, "get_setup_grade", return_value=None):
            body = c.get("/api/research/expected-move/TSTX").json()
    finally:
        app.dependency_overrides.clear()
    assert body["live"] is None
    assert body["live_outcome"] == {"kind": _im.KIND_UNAVAILABLE,
                                    "reason": _im.UNAVAILABLE_READ_ERROR}


def test_a_priced_research_read_says_ok():
    c, em_router = _research_client()
    try:
        with mock.patch.object(em_router.implied_move, "get_expected_move",
                               side_effect=_reading(move={"pct": 6.8})), \
             mock.patch.object(em_router.implied_store, "get_implied_history", return_value=[]), \
             mock.patch.object(em_router.implied_store, "get_earliest_report_date", return_value=None), \
             mock.patch.object(em_router.setup_grade, "get_setup_grade", return_value=None):
            body = c.get("/api/research/expected-move/TSTX").json()
    finally:
        app.dependency_overrides.clear()
    assert body["live"]["pct"] == 6.8
    assert body["live_outcome"] == {"kind": _im.KIND_OK, "reason": None}


# ── Derive, never restate ─────────────────────────────────────────────────────

# The functions that decide, carry or serialize an expected-move outcome. The
# scan is scoped to them rather than to the whole file because `calendar.py`
# legitimately carries an unrelated `{"status": "unavailable"}` on the earnings
# -audio endpoint — a file-wide match would have been the grep-style false
# positive this repo keeps re-learning about.
OUTCOME_CARRIERS = {
    "api/routers/calendar.py": ("_inhouse_move", "_bounded_em",
                                "_build_enrichment_for_date"),
    "api/routers/expected_move.py": ("expected_move",),
}


def test_no_member_facing_router_retypes_a_reason_or_a_kind():
    """A router that spelled a token out itself would be a second authority
    over one value — this repo's most repeated defect. AST, not grep: exact
    equality against `ast.Constant` values cannot be fooled by prose (a comment
    or docstring MENTIONING a reason is not a Constant equal to it), and the
    scope is resolved by walking for the FunctionDef, never by line number."""
    vocab = _all_reasons() | (_im.KINDS - {_im.KIND_OK})
    assert len(vocab) >= 8, vocab
    for rel, fns in OUTCOME_CARRIERS.items():
        tree = ast.parse((ROOT / rel).read_text(encoding="utf-8"))
        found = {n.name: n for n in ast.walk(tree)
                 if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))}
        missing = [f for f in fns if f not in found]
        assert not missing, f"{rel}: {missing} — this rail is scanning nothing"
        for fn in fns:
            typed = sorted({n.value for n in ast.walk(found[fn])
                            if isinstance(n, ast.Constant)
                            and isinstance(n.value, str) and n.value in vocab})
            assert typed == [], f"{rel}::{fn} retypes {typed}"


MERGE_JS = ROOT / "app/src/pages/calendar/useCalendarData.js"


def _merge_enrichment_body() -> str:
    """The body of `mergeEnrichment` — the frontend's enrichment ALLOW-LIST.
    Sliced by locating the declaration, never by line number."""
    src = MERGE_JS.read_text(encoding="utf-8")
    start = src.index("export function mergeEnrichment")
    end = src.index("export function", start + 1)
    body = src[start:end]
    assert len(body) > 200, "sliced nothing — this rail would pass vacuously"
    return body


def test_every_key_the_calendar_emits_is_named_in_the_frontend_allow_list(monkeypatch):
    """The wire is a CONTRACT BETWEEN two components, and each side's own tests
    stay green when it is cut: the router keeps emitting the field, the surface
    keeps rendering whatever it is handed, and `mergeEnrichment` quietly drops
    it in between. Nobody sees a failure; the member sees nothing.

    So the key set is DERIVED from a real router response — never retyped — and
    every one of them must be named in the allow-list. A new enrichment field
    that forgets that hop fails HERE.
    """
    body = _enrich(_current_week_day(), _reading(_im.REFUSED_NO_ATM_STRIKE),
                   monkeypatch=monkeypatch)
    emitted = sorted(body["TSTX"])
    assert "expected_move_outcome" in emitted, emitted   # abort-on-zero
    allow_list = _merge_enrichment_body()
    missing = [k for k in emitted if f"{k}:" not in allow_list]
    assert missing == [], f"dropped between the router and the surfaces: {missing}"


def test_the_frontend_owns_no_copy_of_the_reason_vocabulary():
    """The UI switches on `kind` and prints `reason`; it must never enumerate
    the reasons. A lookup table over them would go stale the day a seventh is
    added and render that seventh as nothing."""
    vocab = _all_reasons()
    assert len(vocab) >= 6, vocab
    surfaces = [p for p in (ROOT / "app/src").rglob("*.js*")
                if ".test." not in p.name]
    assert len(surfaces) > 100, len(surfaces)   # abort-on-zero on the scan itself
    offenders = {}
    for p in surfaces:
        text = p.read_text(encoding="utf-8", errors="ignore")
        hits = sorted(r for r in vocab if r in text)
        if hits:
            offenders[str(p.relative_to(ROOT))] = hits
    assert offenders == {}, offenders
