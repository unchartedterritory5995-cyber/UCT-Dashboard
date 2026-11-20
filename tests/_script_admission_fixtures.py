"""Shared by the two test files that hold the admission verdict in a script answer
(`tests/test_script_answer_admission.py`, the server's half; `tests/test_script_admission_window_contract.py`, the
shape the window reads), so neither test file imports the other.

A fixture is used by importing its NAME into the test module (`from tests._script_admission_fixtures import adm`).
"""
from __future__ import annotations

import pytest

from api.services import runtime_definitions as rt
from api.services import user_definitions as svc

#: drawn on every bar, every capability admitted
ADMITTED = ('//@version=5\nindicator("Pivot labels", overlay=true)\nph = ta.pivothigh(high, 5, 5)\n'
            'if not na(ph)\n    label.new(bar_index - 5, ph, str.tostring(ph))\nplot(ta.sma(close, 20), "SMA")\n')
#: reads where the chart ends: admitted for closed-bar history only (G6)
HISTORY = ('//@version=5\nindicator("Last close", overlay=true)\nvar label l = na\nif barstate.islast\n'
           '    label.delete(l)\n    l := label.new(bar_index, high, str.tostring(close))\nplot(close, "Close")\n')
#: a capability the committed registry does not admit
UNADMITTED = "//@version=5\nindicator('u')\nm = matrix.new<float>(2, 2, close)\nplot(close)\n"


@pytest.fixture
def adm(monkeypatch, tmp_path):
    """Capability admission on, no kill list, an empty store of its own, a cold LRU and open gates."""
    for k in (rt.KILL_ENV, rt.ALLOW_ENV, rt.CAPABILITY_DENY_ENV):
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setenv(rt.CAPABILITY_ADMISSION_ENV, "on")
    monkeypatch.setattr(svc, "_DB_PATH", str(tmp_path / "user_definitions.db"))
    svc._init_db()
    rt._reset_capability_cache(persisted=True)
    yield
    rt._reset_capability_cache(persisted=True)
