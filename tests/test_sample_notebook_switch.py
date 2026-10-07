"""W14-C1 controller ruling (2026-10-05): W14-E's extra examples obey the wave-14 switch.

With the switch OFF (`NOTEBOOK_ONBOARDING_ENABLED` and `NOTEBOOK_GETTING_STARTED_ENABLED` not
both on), "Add a sample notebook" must write EXACTLY what it wrote before wave 14: compared
row for row, table by table, against the pre-wave-14 `sample_notebook.seed` itself (its blob at
`b06ec4fd85`, the wave-13 landing wave 14 branched from), run against the same database
schema. With the switch ON, the examples arrive (the W14-E rails in
test_sample_notebook_examples.py describe them).

The server's switch is a mirror of the client's ONE rule (`checklistEnabled` in
gettingStartedPref.js); the mirror rail below reads the keys out of that JS function, so the
server's list is never restated by hand.
"""
from __future__ import annotations

import importlib.util
import json
import re
import subprocess
import sys
from pathlib import Path

import pytest

from api.routers import auth as auth_router
from api.services import auth_db, auth_service, notebook_flags, notebook_wave14_switch
from api.services.journal_two import sample_examples, sample_notebook

ROOT = Path(__file__).resolve().parents[1]
PREF_JS = ROOT / "app/src/pages/journal-2-0/components/notebook/onboarding/gettingStartedPref.js"
REGISTRY_JS = ROOT / "app/src/pages/journal-2-0/components/notebook/onboarding/tourRegistry.js"
PRE_WAVE14 = "b06ec4fd85"
U_NOW, U_PRE = "u-switch-now", "u-switch-pre"
SWITCH = ("NOTEBOOK_ONBOARDING_ENABLED", "NOTEBOOK_GETTING_STARTED_ENABLED")
#: Columns that differ between two runs by construction (ids, clocks, the member), not content.
VOLATILE = re.compile(r"(^id$|_id$|_at$|^at$|^ts$|^created|^updated|^rowid$|hash$|^user_id$)", re.I)


# ── the mirror ────────────────────────────────────────────────────────────────────────────

def test_the_server_switch_is_the_client_rule_read_from_its_source():
    src = PREF_JS.read_text(encoding="utf-8")
    m = re.search(r"export function checklistEnabled\(flag\)\s*\{(.*?)\n\}", src, re.S)
    assert m, "checklistEnabled() not found in gettingStartedPref.js"
    client_keys = re.findall(r"flag\('([a-z0-9_]+)'\)\s*===\s*true", m.group(1))
    assert client_keys, "no flag keys read out of checklistEnabled() (the reader is broken)"
    server_keys = [auth_router._notebook_flag_key(n) for n in notebook_wave14_switch.WAVE14_SWITCH]
    assert sorted(server_keys) == sorted(client_keys)
    # both are rows of the one table, so the server reads them with the payload's defaults
    for n in notebook_wave14_switch.WAVE14_SWITCH:
        assert n in auth_router.NOTEBOOK_FLAGS
    # and the client's tour rule really is built on that function, not a copy of it
    assert "checklistEnabled(flag)" in REGISTRY_JS.read_text(encoding="utf-8")


@pytest.mark.parametrize("on,gs,expected", [
    (None, None, False), ("1", None, False), (None, "1", False), ("1", "0", False), ("0", "1", False),
    ("1", "1", True), ("true", "yes", True),
])
def test_the_switch_reads_like_the_payload(monkeypatch, on, gs, expected):
    for name, v in zip(SWITCH, (on, gs)):
        if v is None:
            monkeypatch.delenv(name, raising=False)
        else:
            monkeypatch.setenv(name, v)
    assert notebook_wave14_switch.wave14_switch_on() is expected
    p = auth_router._access_payload({"role": "member"}, "free")
    assert (p["notebook_onboarding_enabled"] and p["notebook_getting_started_enabled"]) is expected


# ── the two states ────────────────────────────────────────────────────────────────────────

@pytest.fixture
def db(monkeypatch, tmp_path):
    monkeypatch.setattr(auth_db, "_DB_PATH", str(tmp_path / "switch.db"))
    auth_db.init_db()
    c = auth_db.get_connection()
    try:
        for uid in (U_NOW, U_PRE):
            c.execute("INSERT INTO users (id, email, password_hash, display_name, role)"
                      " VALUES (?, ?, 'x', 'x', 'member')", (uid, f"{uid}@example.test"))
        c.commit()
    finally:
        c.close()


def _stable(v):
    """A JSON value with its clock fields dropped (the sample preference's `at`)."""
    if isinstance(v, str) and v.startswith("{"):
        try:
            d = json.loads(v)
        except ValueError:
            return v
        if isinstance(d, dict):
            return json.dumps({k: x for k, x in d.items() if k != "at"}, sort_keys=True)
    return v


def _census(user_id: str) -> dict[str, list]:
    """Every row the member has, table by table, volatile columns dropped, order-free."""
    c = auth_db.get_connection()
    try:
        out = {}
        for (t,) in c.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall():
            cols = [r[1] for r in c.execute(f"PRAGMA table_info('{t}')")]
            if "user_id" not in cols:
                continue
            keep = [col for col in cols if not VOLATILE.search(col)]
            rows = c.execute(f"SELECT {', '.join(repr(k) for k in keep) or '1'} FROM '{t}' WHERE user_id = ?",
                             (user_id,)).fetchall()
            if rows:
                out[t] = sorted(json.dumps([_stable(r[k]) for k in range(len(keep))], default=str) for r in rows)
        return out
    finally:
        c.close()


def _pref(user_id):
    return json.loads(auth_service.get_user_preferences(user_id)[sample_notebook.PREF_KEY])


def _pre_wave14_module():
    """`sample_notebook.py` exactly as it was before wave 14, loaded from git."""
    src = subprocess.run(["git", "show", f"{PRE_WAVE14}:api/services/journal_two/sample_notebook.py"],
                         cwd=ROOT, capture_output=True, check=True).stdout.decode("utf-8")
    assert "sample_examples" not in src          # non-vacuity: really the pre-W14-E module
    spec = importlib.util.spec_from_loader("_pre_wave14_sample_notebook", loader=None)
    mod = importlib.util.module_from_spec(spec)
    mod.__file__ = sample_notebook.__file__      # the same sample_notebook.json beside it
    sys.modules[spec.name] = mod
    exec(compile(src, f"{PRE_WAVE14}:sample_notebook.py", "exec"), mod.__dict__)
    return mod


@pytest.mark.parametrize("on,gs", [(None, None), ("1", None), (None, "1"), ("1", "0")])
def test_switch_off_writes_exactly_the_pre_wave14_rows(db, monkeypatch, on, gs):
    for name, v in zip(SWITCH, (on, gs)):
        if v is None:
            monkeypatch.delenv(name, raising=False)
        else:
            monkeypatch.setenv(name, v)
    called = []
    monkeypatch.setattr(sample_examples, "seed", lambda *a, **k: called.append(1) or {})

    now = sample_notebook.seed(U_NOW)
    pre = _pre_wave14_module().seed(U_PRE)

    assert called == [], "the switch is off, yet the W14-E examples were asked for"
    assert len(now["ids"]) == len(pre["ids"]) == 5
    a, b = _census(U_NOW), _census(U_PRE)
    assert a, "non-vacuity: the census saw no rows"
    assert a == b, f"tables differ: now {sorted(a)} vs pre-wave-14 {sorted(b)}"
    pa, pb = _pref(U_NOW), _pref(U_PRE)
    assert sorted(pa) == sorted(pb) == ["at", "ids", "v"] and pa["v"] == pb["v"] == 1


def test_switch_on_adds_the_examples_over_the_same_base(db, monkeypatch):
    for name in SWITCH:
        monkeypatch.setenv(name, "1")
    now = sample_notebook.seed(U_NOW)
    for name in SWITCH:
        monkeypatch.delenv(name, raising=False)
    sample_notebook.seed(U_PRE)                  # switch off: the pre-wave-14 shape
    a, b = _census(U_NOW), _census(U_PRE)
    assert len(now["ids"]) > 5
    assert a["j2_notes"] != b["j2_notes"] and len(a["j2_notes"]) > len(b["j2_notes"])
    pref = _pref(U_NOW)
    assert pref["v"] == 2 and "examples" in pref
    # remove() still undoes everything either state wrote
    assert sample_notebook.remove(U_NOW)["trashed"]
    assert sample_notebook.remove(U_PRE)["trashed"]
