"""The in-repo watch-list mirror must be checkable against the dashboard.

`api/flow_worker_main.py`'s header is the only in-repo copy of flow-worker's
watch list, and the coverage rail trusts it. Nothing has ever compared it to
Railway, which is the authority — so the rail could be guarding a list that no
longer exists.

⛔ The comparison is unit-tested on SYNTHETIC input. The live read needs a token
that is normally absent, so a test that only exercised the network path would
skip in almost every run and prove nothing.
"""
from __future__ import annotations

import subprocess
import sys

from tools import railway_watch_patterns as rp


def test_an_exact_mirror_reports_no_drift():
    missing, extra = rp.drift({"flow_db", "flow_router"},
                              ["api/flow_db.py", "api/flow_router.py"])
    assert (missing, extra) == (set(), set())


def test_a_module_railway_dropped_is_named():
    missing, extra = rp.drift({"flow_db", "bs_iv"}, ["api/flow_db.py"])
    assert missing == {"bs_iv"} and extra == set()


def test_a_module_railway_added_is_named():
    missing, extra = rp.drift({"flow_db"},
                              ["api/flow_db.py", "api/confluence_flow.py"])
    assert missing == set() and extra == {"confluence_flow"}


def test_non_module_patterns_are_ignored_not_counted_as_drift():
    """`railway.json` and `requirements.txt` are watched but are not modules."""
    missing, extra = rp.drift({"flow_db"},
                              ["api/flow_db.py", "railway.json", "requirements.txt"])
    assert (missing, extra) == (set(), set())


def test_a_broad_glob_is_detected_rather_than_read_as_total_drift():
    """⛔ `api/**` names no module, so a naive diff would report every module as
    missing — the wrong alarm. It is its own case."""
    assert rp.has_broad_glob(["api/**", "railway.json"]) is True
    assert rp.has_broad_glob(["api/flow_db.py"]) is False


def test_an_unreadable_api_exits_INCONCLUSIVE_not_zero(monkeypatch, capsys):
    """⛔ THE LOAD-BEARING ONE. Exit 0 here would report a comparison that never
    happened.

    ⚰️ This asserted the same thing for "no RAILWAY_TOKEN", and that premise DIED
    when the CLI-session fallback landed: on any machine where `railway` works
    there is already a usable credential, so absence of the env var is no longer
    absence of auth. The test failed the moment the fallback shipped — correctly
    — and is re-pointed at the real contract rather than deleted.

    Driven by stubbing `fetch`, which is the honest reproduction of "the API
    could not be read" and needs no credential store to be moved or emptied.
    """
    monkeypatch.setattr(rp, "fetch", lambda: (None, "stubbed: unreachable"))
    rc = rp.main(["--check"])
    out = capsys.readouterr().out
    assert rc == 2, (rc, out[-300:])
    assert "INCONCLUSIVE" in out
    assert "NOT a pass" in out


def test_a_readable_api_does_not_exit_INCONCLUSIVE(monkeypatch, capsys):
    """CONTROL: without this, a `fetch` that always returned None would make the
    test above pass for the wrong reason."""
    monkeypatch.setattr(rp, "fetch", lambda: ({"data": {"project": {"services": {"edges": []}}}}, ""))
    rc = rp.main([])
    assert rc == 0, capsys.readouterr().out[-300:]


def test_auth_source_names_the_credential_without_revealing_it(monkeypatch):
    """⛔ The tool must say WHICH credential it used — a reader cannot otherwise
    tell a project-token read from a CLI-session read — and must never print the
    value itself."""
    monkeypatch.setenv("RAILWAY_TOKEN", "not-a-real-value")
    src = rp.auth_source()
    assert src == "RAILWAY_TOKEN (project)"
    assert "not-a-real-value" not in src

    monkeypatch.delenv("RAILWAY_TOKEN")
    monkeypatch.setenv("RAILWAY_API_TOKEN", "also-not-real")
    src = rp.auth_source()
    assert src == "RAILWAY_API_TOKEN (account)"
    assert "also-not-real" not in src


def test_the_cli_session_is_a_fallback_credential_not_an_absence(monkeypatch, tmp_path):
    """ROUTE B. On any machine where `railway` works, ~/.railway/config.json
    already carries an OAuth session — so 'no RAILWAY_TOKEN' is NOT the same as
    'no credential', and the tool must not report INCONCLUSIVE while a usable
    one is sitting there."""
    monkeypatch.delenv("RAILWAY_TOKEN", raising=False)
    monkeypatch.delenv("RAILWAY_API_TOKEN", raising=False)
    cfg = tmp_path / ".railway"
    cfg.mkdir()
    (cfg / "config.json").write_text('{"user": {"accessToken": "session-value"}}')
    monkeypatch.setattr(rp.os.path, "expanduser", lambda p: str(cfg / "config.json"))

    assert rp._session_token() == "session-value"
    assert rp.auth_source().startswith("railway CLI session")
    assert any("authorization" in h for h in rp._auth_headers())


def test_no_credential_anywhere_still_reports_INCONCLUSIVE(monkeypatch, tmp_path):
    """CONTROL: the fallback must not make the INCONCLUSIVE path unreachable."""
    monkeypatch.delenv("RAILWAY_TOKEN", raising=False)
    monkeypatch.delenv("RAILWAY_API_TOKEN", raising=False)
    monkeypatch.setattr(rp.os.path, "expanduser", lambda p: str(tmp_path / "nope.json"))
    assert rp._session_token() is None
    assert rp.auth_source() == "none"
    payload, reason = rp.fetch()
    assert payload is None and "no credential" in reason
