"""SAT-1 seeding tool (owner: agent-sc): it refuses to touch anything but a sandbox, and each scenario
produces the outcome SAT-1 expects, as measured by the real SC-1 kinds. No model, no provider."""
from __future__ import annotations

import pytest

from api.services.uct_agent.marketdata import gateway
from api.services.uct_agent.scan.sat import seed


@pytest.fixture
def sandbox(tmp_path, monkeypatch):
    from api.services import auth_db
    monkeypatch.setattr(auth_db, "_DB_PATH", str(tmp_path / "auth.db"))
    for k in seed.RAILWAY:
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setenv("UCT_AGENT_DATA", "1")
    monkeypatch.setenv("UCT_AGENT_SCAN", "1")
    gateway._reset_for_test()
    yield tmp_path
    gateway._reset_for_test()


@pytest.mark.parametrize("bad", ["/data", "C:\\data", "C:/data/", "C:\\", "/"])
def test_refuses_the_shared_data_root_and_drive_roots(bad, monkeypatch):
    for k in seed.RAILWAY:
        monkeypatch.delenv(k, raising=False)
    with pytest.raises(SystemExit):
        seed.check_data_dir(bad)


def test_refuses_on_a_deployed_service(tmp_path, monkeypatch):
    monkeypatch.setenv("RAILWAY_ENVIRONMENT", "production")
    with pytest.raises(SystemExit):
        seed.check_data_dir(str(tmp_path))


def test_refuses_a_missing_dir(tmp_path, monkeypatch):
    for k in seed.RAILWAY:
        monkeypatch.delenv(k, raising=False)
    with pytest.raises(SystemExit):
        seed.check_data_dir(str(tmp_path / "nope"))


def _count(sb, scenario, spec, capsys=None):
    seed.main(["--data-dir", str(sb), "--scenario", scenario])
    gateway._reset_for_test()
    return gateway.read("screen.count", {"spec": spec}, user_id="u", turn_id="t", purpose="answer")


RS90 = {"filters": [{"key": "rs_rank", "op": "gte", "min": 90}]}


def test_fresh_is_dated_not_stale_and_has_its_receipt(sandbox):
    env = _count(sandbox, "fresh", RS90)
    import re
    assert env["status"] == "partial" and env["stale"] is False
    assert re.fullmatch(r"\d{4}-\d{2}-\d{2}T2[01]:00:00Z", env["as_of"])        # 16:00 ET, EDT or EST
    assert env["coverage"]["not_computable"] == 5 and env["coverage"]["dropped"] == 1
    assert env["data"]["count"] > 0


def test_stale_scenario_reads_stale(sandbox):
    env = _count(sandbox, "stale", RS90)
    assert env["stale"] is True and any("sessions behind" in n for n in env["notes"])


def test_mixed_scenario_reads_stale_with_the_oldest_session(sandbox):
    env = _count(sandbox, "mixed", RS90)
    assert env["stale"] is True and any("oldest" in n for n in env["notes"])


def test_empty_scenario_is_an_empty_universe(sandbox):
    env = _count(sandbox, "empty", RS90)
    assert env["status"] == "ok" and env["data"]["count"] == 0
    assert env["as_of"] is None and env["stale"] is False and env["notes"]
    assert env["coverage"] == {"evaluated": 0, "answered": 0, "dropped": 0, "not_computable": 0}


def test_a_scenario_replaces_the_previous_universe(sandbox):
    _count(sandbox, "fresh", RS90)
    assert _count(sandbox, "empty", RS90)["coverage"]["evaluated"] == 0


def test_saved_screens_for_the_member_and_another_members_screen_is_refused(sandbox):
    from api.services import auth_db, auth_service
    auth_db.init_db()
    u = auth_service.create_user("sat@local.dev", "x" * 12)
    seed.main(["--data-dir", str(sandbox), "--scenario", "fresh", "--member-email", "sat@local.dev"])
    gateway._reset_for_test()
    saved = gateway.read("screen.saved", {}, user_id=u["id"], turn_id="s", purpose="answer")
    names = {s["name"]: s for s in saved["data"]["screens"]}
    assert set(names) == {"SAT Leaders", "SAT Semis volume", "SAT EMA cross (indicator)"}
    assert names["SAT EMA cross (indicator)"]["runnable"] is False
    from api.services.screener import saved_screens
    other = [s for s in saved_screens.list_for(seed.OTHER_MEMBER)][0]
    env = gateway.read("screen.run", {"saved_id": other["id"]}, user_id=u["id"], turn_id="o", purpose="answer")
    assert env["status"] == "refused" and "no saved screen" in env["notes"][0]


def test_the_tool_imports_no_provider_or_model_client():
    import ast
    import inspect
    names = {getattr(n, "module", None) or "" for n in ast.walk(ast.parse(inspect.getsource(seed)))
             if isinstance(n, ast.ImportFrom)}
    assert not {m for m in names if any(x in m for x in ("massive", "anthropic", "openai", "nl_compile", "bars_fetch"))}
