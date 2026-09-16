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
    spec = importlib.util.spec_from_file_location("prepush", str(_TOOL))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


G = _load()


def _dep(status="SUCCESS", commit="abc123def", msg="a commit"):
    return {"state": "READ", "status": status, "createdAt": None,
            "commit": commit, "message": msg}


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
    monkeypatch.setattr(m, "decide_clock", lambda *a, **k: (verdict or m.OK, reason))


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
# ⚰️ THE CLOCK GUARD IS RETIRED — owner ruling 2026-09-15.
#   "There are no mid-day push blocks, ever. A push goes when its gate is sound."
# The twelve tests that asserted the 09:25-16:05 ET refusal are DELETED rather than
# skipped: a skipped test asserting a retired rule is how the rule comes back.
# What remains asserts the RETIREMENT, and every QUEUE-guard test is untouched —
# that guard is separate and still load-bearing.
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


def test_an_unreadable_diff_outside_the_window_is_still_fine():
    """CONTROL. The diff only matters INSIDE the window; refusing at 21:00 because
    git was quiet would be a guard testing the adjacent thing."""
    assert G.decide_clock(_clock(21, 0), None)[0] == G.OK


# ─────────────────────────────── changed_paths: None and [] are different

def test_changed_paths_returns_None_when_git_cannot_answer():
    assert G.changed_paths(base="definitely-not-a-ref-zzz", head="HEAD") is None


def test_changed_paths_actually_reads_the_repo():
    """NON-VACUITY: every assertion about "which paths" is worthless if the command
    silently returns nothing."""
    paths = G.changed_paths(base="HEAD~1", head="HEAD")
    assert paths, "git returned nothing for HEAD~1...HEAD — a failed invocation, not a clean diff"
    assert all(isinstance(p, str) and p for p in paths)


# ─────────────────────────────── the override is an act, not a reflex


# ══════════════════════════════════════════════════════════════════════════
# The retirement, asserted rather than assumed.
# ══════════════════════════════════════════════════════════════════════════


def test_the_rth_window_no_longer_refuses_anything():
    """
    ⛔ The old window's own worst case: a trading day, 15:49 ET, an uncleared
    api/ path. That combination used to REFUSE. It must now pass.
    """
    import importlib.util, pathlib as _p
    s = importlib.util.spec_from_file_location('G', _p.Path('tools/pre_push_guard.py'))
    G = importlib.util.module_from_spec(s); s.loader.exec_module(G)
    import datetime as dt
    clock = {'state': 'READ', 'session': 'rth', 'trading_day': True,
             'now_et': dt.datetime(2026, 9, 15, 15, 49, 12)}
    v, why = G.decide_clock(clock, ['api/main.py'])
    assert v == G.OK, why
    assert 'RETIRED' in why


def test_an_unreadable_clock_no_longer_refuses_either():
    """
    ⭐ It used to REFUSE, on the reasoning that a guard which passes when it
    cannot tell the time is not a guard. With no window to be inside, being unable
    to tell the time cannot put a push on the wrong side of one.
    """
    import importlib.util, pathlib as _p
    s = importlib.util.spec_from_file_location('G', _p.Path('tools/pre_push_guard.py'))
    G = importlib.util.module_from_spec(s); s.loader.exec_module(G)
    v, why = G.decide_clock({'state': G.UNREADABLE, 'why': 'no tz db'}, ['api/main.py'])
    assert v == G.OK
    assert 'RETIRED' in why
