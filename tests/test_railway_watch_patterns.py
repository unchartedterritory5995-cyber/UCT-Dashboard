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


def test_without_a_token_the_tool_exits_INCONCLUSIVE_not_zero(monkeypatch, tmp_path):
    """⛔ THE LOAD-BEARING ONE. Exit 0 here would report a comparison that never
    happened — and no token is the COMMON case (local runs, CI without secrets)."""
    env = {k: v for k, v in __import__("os").environ.items()
           if k not in ("RAILWAY_TOKEN", "RAILWAY_API_TOKEN")}
    r = subprocess.run([sys.executable, "tools/railway_watch_patterns.py", "--check"],
                       capture_output=True, text=True, timeout=60, env=env)
    assert r.returncode == 2, (r.returncode, r.stdout[-400:])
    assert "INCONCLUSIVE" in r.stdout
    assert "NOT a pass" in r.stdout
