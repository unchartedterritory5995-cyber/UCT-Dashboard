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

def test_the_bypass_is_an_env_var_and_it_is_logged(tmp_path, monkeypatch, capsys):
    m = _load()
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

