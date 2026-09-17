"""LAYER 0 — the pre-push guard: the 502 rule with a reader.

⚰️ The rule ("ONE MASTER MERGE AT A TIME, REPO-WIDE") was already in `CLAUDE.md`
and was not followed: three pushes in eight minutes on 2026-09-13 served 502s.
These rails pin the decision function, because the decision is the whole tool.

⛔ Every assertion here drives `decide()` directly — no network, no CLI. The one
thing a guard must never do is pass because the thing it guards was unreachable,
so `UNREADABLE → REFUSE` is the first test in the file.
"""
import importlib.util
import pathlib

import pytest

_REPO = pathlib.Path(__file__).resolve().parents[1]
_TOOL = _REPO / "tools" / "pre_push_guard.py"


def _load():
    """⛔ CADENCE IS PINNED QUIET AT LOAD. Guard 3 is wired into `main()`, so every
    pre-existing `main()` test would otherwise shell out to Railway and be decided
    by whatever master happened to be doing — which is not what those tests measure.
    ⚠️ Pinned to an EMPTY ROW LIST, never to an OK verdict: patching the verdict
    would make guard 3 unfalsifiable through `main()`, and
    `test_a_busy_cadence_refuses_through_main` has to be able to fail."""
    spec = importlib.util.spec_from_file_location("prepush", str(_TOOL))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    m.recent_deployments = lambda: {"state": "READ", "rows": []}
    return m


G = _load()


def _dep(status="SUCCESS", commit="abc123def", msg="a commit"):
    return {"state": "READ", "status": status, "createdAt": None,
            "commit": commit, "message": msg}


#: ⚰️ There was an autouse fixture here doing the same job as `_load()`'s pin, and
#: it patched only the module-level `G` — so every test that builds its own module
#: with `_load()` still reached the live Railway CLI, and two of them failed on
#: whatever master was doing at that second. Two authorities over one value, which
#: is the defect this repo keeps re-committing. The pin lives in `_load()` alone.


# ────────────────────────────────── it fails CLOSED, never open

def test_an_unreadable_deployment_state_REFUSES():
    """⛔ THE LOAD-BEARING ONE. A guard that fails open reports 'fine' exactly
    when it has stopped working."""
    v, why = G.decide({"state": "UNREADABLE", "why": "the railway CLI is not on PATH"})
    assert v == G.REFUSE
    assert "fails open" in why and "railway CLI is not on PATH" in why


@pytest.mark.parametrize("status", ["BUILDING", "DEPLOYING", "FAILED", "CRASHED", "REMOVED", ""])
def test_any_unsettled_status_REFUSES(status):
    v, why = G.decide(_dep(status=status), now_age=10_000)
    assert v == G.REFUSE, f"{status!r} was allowed"
    assert "swap is in flight" in why or "UNKNOWN" in why


def test_a_success_younger_than_the_settle_window_REFUSES():
    """Railway reports SUCCESS at healthcheck while the old container is still
    draining (`drainingSeconds: 30`). A SUCCESS two seconds old is a coin flip."""
    v, why = G.decide(_dep(), now_age=5)
    assert v == G.REFUSE
    assert "only 5s old" in why and "draining" in why


def test_a_success_with_an_unreadable_age_REFUSES():
    v, why = G.decide(_dep(), now_age=None)
    assert v == G.REFUSE
    assert "age is unreadable" in why


# ──────────────────────────────────────────── and it does allow the good case

def test_a_settled_success_is_ALLOWED():
    """CONTROL. Without this, a guard that refuses everything passes every test
    above — and would be indistinguishable from a broken one."""
    v, why = G.decide(_dep(commit="9b1d6c537"), now_age=G.MIN_SETTLE_SECONDS + 1)
    assert v == G.OK, why
    assert "safe to push" in why and "9b1d6c537" in why


def test_the_boundary_is_inclusive_at_the_settle_window():
    assert G.decide(_dep(), now_age=G.MIN_SETTLE_SECONDS)[0] == G.OK
    assert G.decide(_dep(), now_age=G.MIN_SETTLE_SECONDS - 1)[0] == G.REFUSE


# ────────────────────────────── it does NOT require the push to be your own

def test_it_does_not_care_whose_commit_is_deployed():
    """⛔ DELIBERATE. `SUCCESS` on somebody else's commit still means the pod is
    settled, which is the property that matters. Requiring your own parent would
    refuse every legitimate push in a repo five workstreams share."""
    v, _ = G.decide(_dep(commit="deadbeef1", msg="another workstream's merge"),
                    now_age=10_000)
    assert v == G.OK


# ─────────────────────────────────────────────────── the bypass is a record

def _quiet_clock(m, monkeypatch, *, verdict=None, reason="clock: not a trading day"):
    """Pin the CLOCK guard out of the way so a QUEUE test measures the queue.

    ⛔ Without this the queue tests would import the whole api package and shell out
    to git — i.e. they would stop being tests of `decide()` and start being a slow,
    environment-dependent test of everything."""
    monkeypatch.setattr(m, "read_clock", lambda *a, **k: {"state": "READ", "session": "weekend",
                                                          "trading_day": False, "now_et": None})
    monkeypatch.setattr(m, "changed_paths", lambda *a, **k: ["docs/x.md"])
    # ⛔ `decide_clock` is GONE (owner ruling 2026-09-17). Nothing to pin out of the
    # way any more; read_clock is reporting-only. `verdict`/`reason` are accepted and
    # ignored so the call sites below did not all have to change in the same commit.


def test_the_bypass_is_an_env_var_and_it_is_logged(tmp_path, monkeypatch, capsys):
    m = _load()
    _quiet_clock(m, monkeypatch)
    monkeypatch.setattr(m, "BYPASS_LOG", tmp_path / "bypass.log")
    monkeypatch.setattr(m, "latest_deployment", lambda: _dep(status="BUILDING"))
    monkeypatch.setenv(m.BYPASS_ENV, "1")
    assert m.main() == 0
    out = capsys.readouterr().out
    assert "BYPASSED" in out and "what was overridden" in out
    logged = (tmp_path / "bypass.log").read_text(encoding="utf-8")
    assert "BUILDING" in logged, "the bypass did not record WHAT it overrode"


def test_without_the_bypass_the_same_state_exits_1(tmp_path, monkeypatch, capsys):
    """CONTROL for the bypass — proves it is the env var doing the work."""
    m = _load()
    _quiet_clock(m, monkeypatch)
    monkeypatch.setattr(m, "BYPASS_LOG", tmp_path / "bypass.log")
    monkeypatch.setattr(m, "latest_deployment", lambda: _dep(status="BUILDING"))
    monkeypatch.delenv(m.BYPASS_ENV, raising=False)
    assert m.main() == 1
    assert "REFUSING THE PUSH" in capsys.readouterr().out
    assert not (tmp_path / "bypass.log").exists(), "a refusal wrote a bypass record"


# ─────────────────────────────────────────────────── the CLI is resolved safely

def test_the_railway_binary_is_resolved_with_which_not_a_shell():
    """⛔ On Windows the CLI is a .cmd shim that subprocess cannot resolve on its
    own, and `shell=True` fixes the symptom by handing an interpolated string to
    a shell. `deploy_watch.py` emitted forty FileNotFoundErrors and exited 0."""
    import ast
    tree = ast.parse(_TOOL.read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        if isinstance(node, ast.Expr) and isinstance(node.value, ast.Constant)                 and isinstance(node.value.value, str):
            node.value.value = ""        # ⛔ CODE, NEVER PROSE — ast.unparse KEEPS
    code_only = ast.unparse(tree)        #    docstrings, so they are blanked first
    assert "shutil.which" in code_only, "the code-only view lost the real call"
    assert "shell=True" not in code_only, "shell=True is in CODE, not just the docstring"

# ── --audit: after-the-fact detection, added 2026-09-14 ───────────────────────
# Prevention was already complete — BUILDING/DEPLOYING/FAILED/CRASHED/REMOVED/""
# and UNREADABLE all REFUSE, each railed above — and something defeated it anyway.
# These cover the detector, which exists so the NEXT occurrence is visible.

def _row(commit, iso, status="SUCCESS"):
    return {"status": status, "createdAt": iso, "meta": {"commitHash": commit}}


def test_it_flags_two_distinct_commits_deployed_inside_the_window():
    """The real 2026-09-14 incident, to the second."""
    rows = [_row("9e2b93805", "2026-09-14T12:32:16.226Z"),
            _row("7705c2d3b", "2026-09-14T12:29:23.531Z")]
    hits = G.suspected_stacked_pushes(rows)
    assert len(hits) == 1
    assert hits[0]["newer"] == "9e2b93805" and hits[0]["older"] == "7705c2d3b"
    assert 172 < hits[0]["gap_seconds"] < 174


def test_railways_twin_row_for_ONE_push_is_not_a_stacked_push():
    """⛔ Railway emits a REMOVED twin milliseconds from its SUCCESS for the SAME
    commit. Counting that would make every single push the tightest stack in the
    list, and the detector would be loudest exactly when nothing happened."""
    rows = [_row("1d75954c7", "2026-09-14T13:27:22.520Z", "SUCCESS"),
            _row("1d75954c7", "2026-09-14T13:27:21.990Z", "REMOVED")]
    assert G.suspected_stacked_pushes(rows) == []


def test_a_properly_spaced_pair_is_not_flagged():
    rows = [_row("bbbbbbbbb", "2026-09-14T12:40:00.000Z"),
            _row("aaaaaaaaa", "2026-09-14T12:29:00.000Z")]
    assert G.suspected_stacked_pushes(rows) == []


def test_the_detector_can_actually_fire_and_actually_stay_quiet():
    """Non-vacuity in both directions: a window that catches nothing and a
    detector that catches everything are the same useless instrument."""
    rows = [_row("bbbbbbbbb", "2026-09-14T12:33:00.000Z"),
            _row("aaaaaaaaa", "2026-09-14T12:29:00.000Z")]
    assert G.suspected_stacked_pushes(rows, window=600), "must fire on a wide window"
    assert not G.suspected_stacked_pushes(rows, window=60), "must be quiet on a narrow one"


def test_unparseable_timestamps_are_skipped_rather_than_guessed():
    rows = [_row("bbbbbbbbb", "not-a-date"), _row("aaaaaaaaa", "2026-09-14T12:29:00.000Z")]
    assert G.suspected_stacked_pushes(rows) == []


# ═════════════════════════════════════════════════════════════════════════════
# THE CLOCK GUARD — owner ruling A2, 2026-09-14
#
# ⚰️ The integrator reasoned that a master push should wait for the 16:00 close,
# WROTE THAT DECISION DOWN, set a background timer to gate it — and pushed at
# 15:49 ET on a mental estimate of elapsed time that had drifted ~25 minutes.
# `web` and `chart-renderer` both restarted in the last eight minutes of RTH.
# A decision written down is not a decision enforced.
# ═════════════════════════════════════════════════════════════════════════════

import datetime as _dt                                                  # noqa: E402
from zoneinfo import ZoneInfo as _ZoneInfo                              # noqa: E402

_ET = _ZoneInfo("America/New_York")


def _clock(hour, minute, *, session="rth", trading=True, day=(2026, 9, 14), sec=0):
    """A pinned reading. `decide_clock` is pure, so the tests never need the real
    clock to be at any particular time — which is the only way to test a clock."""
    return {"state": "READ", "session": session, "trading_day": trading,
            "now_et": _dt.datetime(day[0], day[1], day[2], hour, minute, sec, tzinfo=_ET)}


# ─────────────────────────────── it FAILS CLOSED when it cannot tell the time

def test_the_trading_day_answer_comes_from_freshness_and_is_not_reimplemented(monkeypatch):
    """⛔ DELEGATION, PROVED. `read_clock` must ask
    `api/services/discord_render/freshness.py`; a second 'is the market open' is
    the defect this repo has paid for repeatedly. Swap the module out and the
    answer must change."""
    m = _load()

    class _Stub:
        WEEKEND, HOLIDAY = "weekend", "holiday"
        calls = []

        @staticmethod
        def session_state(now=None):
            _Stub.calls.append(now)
            return "holiday"

        @staticmethod
        def _et(now=None):
            return now or _dt.datetime(2026, 9, 14, 12, 0, tzinfo=_ET)

    monkeypatch.setattr(m, "_freshness", lambda: _Stub)
    c = m.read_clock()
    assert _Stub.calls, "read_clock never consulted the freshness module"
    assert c["session"] == "holiday" and c["trading_day"] is False


def test_the_real_freshness_module_is_importable_and_answers():
    """NON-VACUITY for the test above: the stub proves delegation, this proves the
    real door exists. A delegation test alone passes happily against a module that
    cannot be imported at all."""
    c = G.read_clock(_dt.datetime(2026, 9, 15, 12, 0, tzinfo=_ET))   # a Tuesday
    assert c["state"] == "READ", c
    assert c["trading_day"] is True and c["session"] == "rth"

    sat = G.read_clock(_dt.datetime(2026, 9, 19, 12, 0, tzinfo=_ET))  # a Saturday
    assert sat["trading_day"] is False and sat["session"] == "weekend"

    ny = G.read_clock(_dt.datetime(2026, 1, 1, 12, 0, tzinfo=_ET))    # New Year's Day
    assert ny["trading_day"] is False and ny["session"] == "holiday", \
        "the holiday list did not reach the guard"


def test_the_guard_carries_no_second_copy_of_the_market_calendar():
    """A cheap, blunt rail on the thing that actually goes wrong: somebody pastes
    the holiday integers in rather than importing them."""
    src = _TOOL.read_text(encoding="utf-8")
    assert "_NYSE_HOLIDAYS" not in src.replace("bars_fetch._NYSE_HOLIDAYS_YYYYMMDD", ""), \
        "a holiday table was copied into the guard"
    assert "20250101" not in src and "20261225" not in src


# ─────────────────────────────── the daytime exemption, derived from the runbook

_RUNBOOK = _REPO / "docs" / "runbooks" / "deploy-windows.md"


def _tier1_line() -> str:
    lines = _RUNBOOK.read_text(encoding="utf-8").splitlines()
    for i, ln in enumerate(lines):
        if ln.startswith("### Tier 1"):
            for nxt in lines[i + 1:]:
                if nxt.strip():
                    return nxt.strip()
    return ""


def test_the_cleared_list_still_matches_the_runbook_it_was_derived_from():
    """⛔⛔ THE LIST IS NOT INVENTED AND MUST NOT DRIFT. It is read off
    `docs/runbooks/deploy-windows.md`, which is the single authority on push
    timing. If the runbook's Tier 1 moves, this fails the same day rather than the
    guard silently clearing something the runbook no longer clears."""
    line = _tier1_line().lower()
    assert line, "the runbook's '### Tier 1' section could not be read — non-vacuity failed"
    assert "push any time" in _RUNBOOK.read_text(encoding="utf-8")
    for prefix in G.CLEARED_PREFIXES:
        assert prefix.rstrip("/") in line, \
            "%r is cleared by the guard but not by the runbook's Tier 1 line: %r" % (prefix, line)
    assert "markdown" in line, "the guard clears *.md; the runbook no longer does"
    # DISCRIMINATOR — the line must not clear everything, or the test above is vacuous.
    assert "api/" not in line, "the runbook's Tier 1 now clears api/ — read it before trusting this"


@pytest.mark.parametrize("path,cleared", [
    ("docs/runbooks/deploy-windows.md", True),
    ("docs/discord-render/LEDGER.md", True),
    ("tests/test_pre_push_guard.py", True),
    ("tools/deploy_blip_check.py", True),
    ("scripts/gate_shards.py", True),
    ("app/src/hub/registry.js", True),
    ("CLAUDE.md", True),                       # "Docs, markdown" — markdown anywhere
    ("api/main.py", False),
    ("api/services/discord_render/freshness.py", False),
    ("railway.json", False),
    ("requirements.txt", False),
    ("api/flow_worker_main.py", False),
])
def test_is_cleared_matches_the_runbook_tiers(path, cleared):
    assert G.is_cleared(path) is cleared, path


def test_changed_paths_returns_None_when_git_cannot_answer():
    assert G.changed_paths(base="definitely-not-a-ref-zzz", head="HEAD") is None


def test_changed_paths_actually_reads_the_repo():
    """NON-VACUITY: every assertion about "which paths" is worthless if the command
    silently returns nothing."""
    paths = G.changed_paths(base="HEAD~1", head="HEAD")
    assert paths, "git returned nothing for HEAD~1...HEAD — a failed invocation, not a clean diff"
    assert all(isinstance(p, str) and p for p in paths)


# ─────────────────────────────── the override is an act, not a reflex

def test_json_mode_reports_both_guards(monkeypatch, capsys):
    """R18: the clock is now OK at 15:49; the queue and cadence keys must still be
    reported, because JSON consumers read all three."""
    import json as _json
    m = _load()
    monkeypatch.setattr(m, "read_clock", lambda *a, **k: _clock(15, 49))
    monkeypatch.setattr(m, "changed_paths", lambda *a, **k: ["api/main.py", "docs/a.md"])
    monkeypatch.setattr(m, "latest_deployment", lambda: _dep(commit="9b1d6c537"))
    monkeypatch.setattr(m, "decide", lambda dep, **k: (m.OK, "web is SUCCESS, settled"))
    assert m.main(["--json"]) == 0
    payload = _json.loads(capsys.readouterr().out)
    assert payload["verdict"] == m.OK
    # ⛔ THE CLOCK NO LONGER CARRIES A VERDICT. It reports session/trading_day for
    # context and gates nothing (owner ruling 2026-09-17). Asserting the REMOVED marker
    # keeps this line load-bearing: if a clock verdict ever reappears in the payload,
    # this fails rather than silently passing on a key that came back.
    assert payload["clock"]["gate"].startswith("REMOVED"), payload["clock"]
    assert "verdict" not in payload["clock"], "a clock VERDICT is back in the JSON"
    assert payload["queue"]["verdict"] == m.OK
    assert "cadence" in payload, "the cadence rail vanished from the JSON"

# ═════════════════════════════════════════════════════════════════════════════
# GUARD 3 — THE CADENCE (D-06 Part 0)
# ═════════════════════════════════════════════════════════════════════════════
#
# ⚰️⚰️ THE FIXTURE IS REAL AND THE PREMISE IT CORRECTS WAS NOT. These twenty rows
# are `railway deployment list --service web --json`, read 2026-09-15T04:51Z,
# verbatim. D-05 refused the master merge citing "five REMOVED in 57 minutes —
# the signature of stacked pushes". The refusal was right; the reason was wrong.
# NINETEEN of these twenty rows are REMOVED, including `3879b7369`, superseded
# **1,990 s (33 min)** later. REMOVED is the end-state of every superseded deploy
# on this service, not a mark of one killed mid-build — so a rail keyed on REMOVED
# would fire every night and be muted inside a week.

_W = [                                      # (commit, createdAt, status) newest first
    ("52a178a34", "2026-09-15T04:49:15.302Z", "INITIALIZING"),
    ("1ceb3c5c2", "2026-09-15T04:28:50.169Z", "SUCCESS"),
    ("81fd6ede7", "2026-09-15T04:19:28.241Z", "REMOVED"),
    ("154c50f71", "2026-09-15T03:48:25.451Z", "REMOVED"),
    ("47e1516b5", "2026-09-15T03:44:37.138Z", "REMOVED"),
    ("5e88b38c4", "2026-09-15T03:25:11.068Z", "REMOVED"),
    ("07cd3319c", "2026-09-15T03:21:27.571Z", "REMOVED"),
    ("85e68247c", "2026-09-15T03:02:53.500Z", "REMOVED"),
    ("789a6bab5", "2026-09-15T02:51:20.917Z", "REMOVED"),
    ("baffee6cf", "2026-09-15T02:42:37.600Z", "REMOVED"),
    ("7ac0e0aee", "2026-09-15T02:36:43.173Z", "REMOVED"),
    ("6d246b758", "2026-09-15T02:22:47.210Z", "REMOVED"),
    ("d91ebaca2", "2026-09-15T01:59:32.637Z", "REMOVED"),
    ("9b29b46d8", "2026-09-15T01:48:52.091Z", "REMOVED"),
    ("3879b7369", "2026-09-15T00:59:03.512Z", "REMOVED"),
    ("e8f7c72a0", "2026-09-15T00:25:53.653Z", "REMOVED"),
    ("57e5131a3", "2026-09-15T00:22:27.351Z", "REMOVED"),
    ("8e6f892a7", "2026-09-14T23:54:23.002Z", "REMOVED"),
    ("5ea008844", "2026-09-14T23:32:58.108Z", "REMOVED"),
    ("a6cfa511d", "2026-09-14T23:26:07.866Z", "REMOVED"),
]

#: The five deploys the D-05 report named, each paired with the moment the push
#: that SUPERSEDED it landed. "Refuse at this point" means: a guard running just
#: before that superseding push must have said no.
_SUPERSESSIONS = [
    ("789a6bab5", "2026-09-15T03:02:53.500Z"),
    ("85e68247c", "2026-09-15T03:21:27.571Z"),
    ("07cd3319c", "2026-09-15T03:25:11.068Z"),
    ("5e88b38c4", "2026-09-15T03:44:37.138Z"),
    ("47e1516b5", "2026-09-15T03:48:25.451Z"),
]


def _rows(window, at=None):
    """Rows as they stood at `at` — nothing from the future leaks in.

    ⛔ AND EVERY STATUS IS FORCED TO SUCCESS. Replaying the recorded REMOVEDs would
    let `decide()` refuse on status alone and prove nothing about the cadence: the
    recorded statuses are the END state, not what a pusher saw at the time. Forcing
    SUCCESS is the HARD case — guard 2 says "safe to push" at every one of these
    moments, so only guard 3 can refuse."""
    cut = G._iso(at) if at else None
    out = []
    for c, t, _s in window:
        ts = G._iso(t)
        if cut is not None and ts >= cut:
            continue
        out.append({"commit": c, "createdAt": t, "status": "SUCCESS", "message": ""})
    return {"state": "READ", "rows": out}


@pytest.mark.parametrize("removed,at", _SUPERSESSIONS, ids=[c for c, _ in _SUPERSESSIONS])
def test_the_guard_refuses_at_every_point_a_deploy_was_superseded(removed, at):
    """The D-05 window replayed. Five points, five refusals — with guard 2 blind
    (every prior status forced SUCCESS), so each refusal is guard 3's alone."""
    v, why = G.decide_cadence(_rows(_W, at), now=G._iso(at))
    assert v == G.REFUSE, "would have ALLOWED the push that superseded %s: %s" % (removed, why)


def test_guard_2_really_is_blind_at_those_points():
    """⛔ NON-VACUITY FOR THE FIXTURE ITSELF. If `decide()` refused here anyway, the
    five tests above would pass with guard 3 deleted and would be measuring nothing."""
    for removed, at in _SUPERSESSIONS:
        rows = _rows(_W, at)["rows"]
        newest = rows[0]
        age = (G._iso(at) - G._iso(newest["createdAt"])).total_seconds()
        v, why = G.decide({"state": "READ", "status": "SUCCESS",
                           "createdAt": newest["createdAt"], "commit": newest["commit"],
                           "message": ""}, now_age=age)
        assert v == G.OK, "guard 2 already refuses at %s — the fixture proves nothing" % removed


def test_a_quiet_master_is_ALLOWED():
    """⛔ THE CONTROL. A guard that refuses everything is not a guard, and this is
    the case that makes the five refusals above mean something."""
    rows = {"state": "READ", "rows": [
        {"commit": "aaaaaaaaa", "createdAt": "2026-09-15T00:10:00Z", "status": "SUCCESS"},
        {"commit": "bbbbbbbbb", "createdAt": "2026-09-14T21:00:00Z", "status": "SUCCESS"},
    ]}
    v, why = G.decide_cadence(rows, now=G._iso("2026-09-15T04:00:00Z"))
    assert v == G.OK, why


# ── one case per clause, because two clauses that both fire prove neither ─────
# ⛔ `lesson_mutations_can_cancel_each_other`: on the real window BOTH clauses fire
# at most points, so zeroing one leaves the fixture green. Each clause therefore
# gets a case only IT can answer.

def test_ONLY_recency_can_refuse_here():
    """One deploy, 200 s ago. The burst clause cannot see a burst of one."""
    rows = {"state": "READ", "rows": [
        {"commit": "recent001", "createdAt": "2026-09-15T03:56:40Z", "status": "SUCCESS"}]}
    v, why = G.decide_cadence(rows, now=G._iso("2026-09-15T04:00:00Z"))
    assert v == G.REFUSE and "200s ago" in why, why


def test_ONLY_the_burst_clause_can_refuse_here():
    """Four deploys inside the hour, the newest 700 s old — past the recency window,
    which is the shape that stopped D-05 and that recency alone is blind to."""
    rows = {"state": "READ", "rows": [
        {"commit": "burst0001", "createdAt": "2026-09-15T03:48:20Z", "status": "SUCCESS"},
        {"commit": "burst0002", "createdAt": "2026-09-15T03:30:00Z", "status": "SUCCESS"},
        {"commit": "burst0003", "createdAt": "2026-09-15T03:12:00Z", "status": "SUCCESS"},
        {"commit": "burst0004", "createdAt": "2026-09-15T03:05:00Z", "status": "SUCCESS"},
    ]}
    now = G._iso("2026-09-15T04:00:00Z")
    assert G.decide_cadence(rows, now=now)[0] == G.REFUSE
    # and prove the recency clause is NOT what fired
    assert (now - G._iso("2026-09-15T03:48:20Z")).total_seconds() > G.RECENT_PUSH_WINDOW_SECONDS


def test_two_deploys_in_the_hour_is_under_the_burst_floor():
    """⛔ The boundary, from the quiet side: the floor is 3, so 2 must pass — or the
    clause is just 'any two deploys ever' wearing a threshold."""
    rows = {"state": "READ", "rows": [
        {"commit": "pair00001", "createdAt": "2026-09-15T03:40:00Z", "status": "SUCCESS"},
        {"commit": "pair00002", "createdAt": "2026-09-15T03:10:00Z", "status": "SUCCESS"},
    ]}
    assert G.decide_cadence(rows, now=G._iso("2026-09-15T04:00:00Z"))[0] == G.OK


# ── fails closed, three ways ──────────────────────────────────────────────────

def test_an_unreadable_list_REFUSES():
    v, why = G.decide_cadence({"state": "UNREADABLE", "why": "the railway CLI is not on PATH"})
    assert v == G.REFUSE and "fails open" in why


def test_rows_with_no_parseable_timestamp_REFUSE_rather_than_read_as_quiet():
    """⛔ An empty answer and a quiet master are the same shape from here."""
    rows = {"state": "READ", "rows": [
        {"commit": "nope00001", "createdAt": "not-a-time", "status": "SUCCESS"},
        {"commit": "nope00002", "createdAt": None, "status": "SUCCESS"}]}
    v, why = G.decide_cadence(rows, now=G._iso("2026-09-15T04:00:00Z"))
    assert v == G.REFUSE and "not one readable" in why


def test_railways_twin_row_for_one_push_is_not_counted_twice():
    """Railway emits a REMOVED twin milliseconds from its SUCCESS. Counting that as
    two deploys would put every ordinary pair of pushes over the burst floor."""
    rows = {"state": "READ", "rows": [
        {"commit": "twin00001", "createdAt": "2026-09-15T03:40:00.500Z", "status": "SUCCESS"},
        {"commit": "twin00001", "createdAt": "2026-09-15T03:40:00.100Z", "status": "REMOVED"},
        {"commit": "twin00002", "createdAt": "2026-09-15T03:10:00.500Z", "status": "SUCCESS"},
        {"commit": "twin00002", "createdAt": "2026-09-15T03:10:00.100Z", "status": "REMOVED"},
    ]}
    assert G.decide_cadence(rows, now=G._iso("2026-09-15T04:00:00Z"))[0] == G.OK


def test_a_busy_cadence_refuses_through_main(tmp_path, monkeypatch, capsys):
    """⛔ THE WIRE, not the decision. `suspected_stacked_pushes` has detected this
    shape since 2026-09-14 behind `--audit`, which exits 0 always. A verdict that
    never reaches `main()` gates nothing."""
    m = _load()
    monkeypatch.setattr(m, "BYPASS_LOG", tmp_path / "bypass.log")
    monkeypatch.setattr(m, "latest_deployment", lambda: _dep(commit="settled01"))
    monkeypatch.setattr(m, "decide", lambda dep, **kw: (m.OK, "queue is fine"))
    monkeypatch.setattr(m, "read_clock", lambda now=None: {"session": "closed",
                                                           "trading_day": True, "now_et": None})
    monkeypatch.setattr(m, "changed_paths", lambda b, h: ["api/main.py"])
    # ⚰️ THE FIRST VERSION HANDED main() THE REAL 09-15 TIMESTAMPS AND IT PASSED THE
    # CADENCE. `decide_cadence` is called from `main()` with `now=None`, i.e. the
    # real clock — so a fixture pinned to a past hour reads as ancient history and
    # "master is quiet" is the CORRECT answer to it. A recorded window is only a
    # fixture for the pure function; through `main()` the rows must be anchored to
    # now. Same shape as the 09-15 night: one deploy inside the recency window,
    # three inside the hour.
    import datetime as _dt
    now = _dt.datetime.now(_dt.timezone.utc)

    def _ago(s):
        return (now - _dt.timedelta(seconds=s)).isoformat().replace("+00:00", "Z")

    monkeypatch.setattr(m, "recent_deployments", lambda: {"state": "READ", "rows": [
        {"commit": "busyaaaaa", "createdAt": _ago(120), "status": "SUCCESS", "message": ""},
        {"commit": "busybbbbb", "createdAt": _ago(1400), "status": "SUCCESS", "message": ""},
        {"commit": "busyccccc", "createdAt": _ago(2600), "status": "SUCCESS", "message": ""},
    ]})
    assert m.main([]) == 1
    assert "REFUSING THE PUSH" in capsys.readouterr().out


# ══════════════════════════════════════════════════════════════════════════════
# R19 — the BURST clause's owner attestation, and R20's machine-readable reason
#
# ⛔⛔ THE ONE PROPERTY EVERY TEST BELOW EXISTS TO PROTECT: an attestation exits the
# BURST clause and NOTHING ELSE. Recency, in-flight/SUCCESS and every fail-closed path
# are measurements of the world — a human saying "I looked" does not make a build stop
# being in flight. The burst clause is different in kind: its own refusal text asks for
# "a human who can see every workstream, not a guard", so a named human at a named
# minute is exactly the thing it was waiting for.
# ══════════════════════════════════════════════════════════════════════════════

def _attest_env(monkeypatch, m, *, by="Patrick", age_s=0, set_by=True, set_at=True):
    now = _dt.datetime.now(_dt.timezone.utc) - _dt.timedelta(seconds=age_s)
    monkeypatch.delenv(m.ATTEST_BY_ENV, raising=False)
    monkeypatch.delenv(m.ATTEST_AT_ENV, raising=False)
    if set_by:
        monkeypatch.setenv(m.ATTEST_BY_ENV, by)
    if set_at:
        monkeypatch.setenv(m.ATTEST_AT_ENV, now.isoformat(timespec="seconds"))


def _burst_rows(m, n=3):
    """A deployment list that trips BURST but NOT recency — distinct commits, all
    older than the 600 s recency window, all inside the 60 min burst window."""
    now = _dt.datetime.now(_dt.timezone.utc)
    return {"state": "READ",
            "rows": [{"createdAt": (now - _dt.timedelta(seconds=900 + i * 600)).isoformat(),
                      "commit": "c%d" % i, "message": "m%d" % i} for i in range(n)]}


# ── read_attestation is pure; drive it directly ──────────────────────────────

def test_a_fresh_attestation_is_VALID(monkeypatch):
    _attest_env(monkeypatch, G)
    a = G.read_attestation()
    assert a["state"] == "VALID" and a["by"] == "Patrick"


def test_no_attestation_at_all_is_ABSENT_not_invalid(monkeypatch):
    monkeypatch.delenv(G.ATTEST_BY_ENV, raising=False)
    monkeypatch.delenv(G.ATTEST_AT_ENV, raising=False)
    assert G.read_attestation()["state"] == "ABSENT"


def test_half_an_attestation_is_not_an_attestation(monkeypatch):
    """⛔ A name with no time is a standing grant that would live in a shell profile
    forever; a time with no name is anonymous. Neither is a statement."""
    _attest_env(monkeypatch, G, set_at=False)
    assert G.read_attestation()["state"] == "INVALID"
    _attest_env(monkeypatch, G, set_by=False)
    assert G.read_attestation()["state"] == "INVALID"


def test_a_stale_attestation_is_refused(monkeypatch):
    """⛔ An owner who looked twenty minutes ago has not looked at THIS queue — three
    other workstreams push to this repo, and tonight four deploys landed in an hour."""
    _attest_env(monkeypatch, G, age_s=G.ATTEST_MAX_AGE_SECONDS + 120)
    a = G.read_attestation()
    assert a["state"] == "STALE" and "not about THIS queue" in a["why"]


def test_an_attestation_from_the_future_is_a_clock_problem(monkeypatch):
    _attest_env(monkeypatch, G, age_s=-600)
    assert G.read_attestation()["state"] == "INVALID"


def test_an_unparsable_attested_time_is_INVALID(monkeypatch):
    monkeypatch.setenv(G.ATTEST_BY_ENV, "Patrick")
    monkeypatch.setenv(G.ATTEST_AT_ENV, "tuesday-ish")
    assert G.read_attestation()["state"] == "INVALID"


# ── through main(): the clause boundary is the whole point ───────────────────

def test_an_attestation_ALLOWS_a_burst_refusal(tmp_path, monkeypatch, capsys):
    """The D-09 burst refusal, replayed, with an attestation: it ALLOWS, and the
    attestation is logged verbatim."""
    m = _load()
    monkeypatch.setattr(m, "BYPASS_LOG", tmp_path / "bypass.log")
    monkeypatch.setattr(m, "read_clock", lambda *a, **k: _clock(20, 0))
    monkeypatch.setattr(m, "changed_paths", lambda *a, **k: ["api/main.py"])
    monkeypatch.setattr(m, "latest_deployment", lambda: _dep(commit="9b1d6c537"))
    monkeypatch.setattr(m, "decide", lambda dep, **k: (m.OK, "web is SUCCESS, settled"))
    monkeypatch.setattr(m, "recent_deployments", lambda: _burst_rows(m))
    monkeypatch.delenv(m.BYPASS_ENV, raising=False)
    _attest_env(monkeypatch, m)

    assert m.main() == 0, "a burst refusal with a valid attestation still refused"
    out = capsys.readouterr().out
    assert "BURST CLAUSE ATTESTED by Patrick" in out
    assert "NOT overridden" in out, "the output must say recency/in-flight were not waived"
    log = (tmp_path / "bypass.log").read_text(encoding="utf-8")
    assert "BURST-ATTESTED" in log and "Patrick" in log, "the attestation was not logged verbatim"


def test_the_same_burst_refuses_WITHOUT_an_attestation(tmp_path, monkeypatch):
    """⛔ NON-VACUITY. The test above proves nothing unless the same fixture REFUSES
    when the attestation is absent."""
    m = _load()
    monkeypatch.setattr(m, "BYPASS_LOG", tmp_path / "bypass.log")
    monkeypatch.setattr(m, "read_clock", lambda *a, **k: _clock(20, 0))
    monkeypatch.setattr(m, "changed_paths", lambda *a, **k: ["api/main.py"])
    monkeypatch.setattr(m, "latest_deployment", lambda: _dep(commit="9b1d6c537"))
    monkeypatch.setattr(m, "decide", lambda dep, **k: (m.OK, "web is SUCCESS, settled"))
    monkeypatch.setattr(m, "recent_deployments", lambda: _burst_rows(m))
    monkeypatch.delenv(m.BYPASS_ENV, raising=False)
    monkeypatch.delenv(m.ATTEST_BY_ENV, raising=False)
    monkeypatch.delenv(m.ATTEST_AT_ENV, raising=False)
    assert m.main() == 1


def test_an_attestation_NEVER_satisfies_recency(tmp_path, monkeypatch, capsys):
    """⛔⛔ THE LOAD-BEARING BOUNDARY. A build really is in flight; looking at the
    queue does not change that. Measured live on 2026-09-15: the guard printed
    'attestation NOT APPLIED' while a deploy was 2s old, which is the correct answer."""
    m = _load()
    monkeypatch.setattr(m, "BYPASS_LOG", tmp_path / "bypass.log")
    monkeypatch.setattr(m, "read_clock", lambda *a, **k: _clock(20, 0))
    monkeypatch.setattr(m, "changed_paths", lambda *a, **k: ["api/main.py"])
    monkeypatch.setattr(m, "latest_deployment", lambda: _dep(commit="9b1d6c537"))
    monkeypatch.setattr(m, "decide", lambda dep, **k: (m.OK, "web is SUCCESS, settled"))
    now = _dt.datetime.now(_dt.timezone.utc)
    monkeypatch.setattr(m, "recent_deployments", lambda: {
        "state": "READ",
        "rows": [{"createdAt": (now - _dt.timedelta(seconds=60)).isoformat(),
                  "commit": "fresh", "message": "just landed"}]})
    monkeypatch.delenv(m.BYPASS_ENV, raising=False)
    _attest_env(monkeypatch, m)

    assert m.main() == 1, "an attestation bought the recency clause"
    assert "NOT APPLIED" in capsys.readouterr().out


def test_an_attestation_NEVER_satisfies_the_in_flight_clause(tmp_path, monkeypatch):
    """A swap in flight is measured, not attested. `decide` refusing must stand even
    with the burst clause attested."""
    m = _load()
    monkeypatch.setattr(m, "BYPASS_LOG", tmp_path / "bypass.log")
    monkeypatch.setattr(m, "read_clock", lambda *a, **k: _clock(20, 0))
    monkeypatch.setattr(m, "changed_paths", lambda *a, **k: ["api/main.py"])
    monkeypatch.setattr(m, "latest_deployment", lambda: _dep(status="BUILDING"))
    monkeypatch.setattr(m, "decide", lambda dep, **k: (m.REFUSE, "a swap is in flight"))
    monkeypatch.setattr(m, "recent_deployments", lambda: _burst_rows(m))
    monkeypatch.delenv(m.BYPASS_ENV, raising=False)
    _attest_env(monkeypatch, m)
    assert m.main() == 1, "an attestation bought the in-flight clause"


def test_a_stale_attestation_does_not_allow_a_burst(tmp_path, monkeypatch):
    m = _load()
    monkeypatch.setattr(m, "BYPASS_LOG", tmp_path / "bypass.log")
    monkeypatch.setattr(m, "read_clock", lambda *a, **k: _clock(20, 0))
    monkeypatch.setattr(m, "changed_paths", lambda *a, **k: ["api/main.py"])
    monkeypatch.setattr(m, "latest_deployment", lambda: _dep(commit="9b1d6c537"))
    monkeypatch.setattr(m, "decide", lambda dep, **k: (m.OK, "web is SUCCESS, settled"))
    monkeypatch.setattr(m, "recent_deployments", lambda: _burst_rows(m))
    monkeypatch.delenv(m.BYPASS_ENV, raising=False)
    _attest_env(monkeypatch, m, age_s=m.ATTEST_MAX_AGE_SECONDS + 300)
    assert m.main() == 1


def test_an_attestation_NEVER_satisfies_fail_closed(tmp_path, monkeypatch):
    """⛔ An unreadable deployment list is the one state where the guard knows it has
    stopped working. Attesting past it would be attesting to something unseen."""
    m = _load()
    monkeypatch.setattr(m, "BYPASS_LOG", tmp_path / "bypass.log")
    monkeypatch.setattr(m, "read_clock", lambda *a, **k: _clock(20, 0))
    monkeypatch.setattr(m, "changed_paths", lambda *a, **k: ["api/main.py"])
    monkeypatch.setattr(m, "latest_deployment", lambda: _dep(commit="9b1d6c537"))
    monkeypatch.setattr(m, "decide", lambda dep, **k: (m.OK, "web is SUCCESS, settled"))
    monkeypatch.setattr(m, "recent_deployments",
                        lambda: {"state": m.UNREADABLE, "why": "railway CLI exit 1"})
    monkeypatch.delenv(m.BYPASS_ENV, raising=False)
    _attest_env(monkeypatch, m)
    assert m.main() == 1


def test_the_clause_label_names_which_clause_decided():
    """⛔ R19 can only honour the clause boundary if the decision SAYS which clause it
    was. Prose cannot be read reliably; the out-dict is filled in the same pass."""
    now = _dt.datetime.now(_dt.timezone.utc)

    def rows(*ages):
        return {"state": "READ",
                "rows": [{"createdAt": (now - _dt.timedelta(seconds=a)).isoformat(),
                          "commit": "c%d" % i, "message": "m"} for i, a in enumerate(ages)]}

    for expected, dep in (("quiet", rows(5000)),
                          ("recency", rows(60, 5000)),
                          ("burst", rows(900, 1500, 2500)),
                          ("unreadable", {"state": G.UNREADABLE, "why": "x"})):
        c: dict = {}
        G.decide_cadence(dep, clause=c)
        assert c.get("name") == expected, f"{expected!r} labelled {c.get('name')!r}"


# ── R20: the machine-readable reason code ────────────────────────────────────

def test_the_bypass_log_carries_a_machine_readable_reason_code(tmp_path, monkeypatch):
    """⭐ The prose says what was overridden in words a person reads; the code says
    which clause in a token a script can count. A log carrying only prose cannot answer
    'how many window overrides last month' without grepping sentences that change
    whenever somebody rewords the message."""
    m = _load()
    monkeypatch.setattr(m, "BYPASS_LOG", tmp_path / "bypass.log")
    m._log_bypass({"status": "S", "commit": "c"}, "because", code="CLOCK-WINDOW")
    m._log_bypass({"status": "S", "commit": "c"}, "because")
    lines = (tmp_path / "bypass.log").read_text(encoding="utf-8").splitlines()
    assert "reason_code=CLOCK-WINDOW" in lines[0]
    assert "reason_code=UNSPECIFIED" in lines[1], "an uncoded bypass must say so, not be blank"
