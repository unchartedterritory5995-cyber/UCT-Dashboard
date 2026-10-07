"""Worker provisioning: byte-verified, write-once, read-only install; a changed source, a corrupted download, a
different existing destination and a tampered install all fail closed."""
from __future__ import annotations

import hashlib
import json
import os
import sqlite3

import pytest

from api.services.marketcap import provision as PV, publication as P


def _sha(p):
    return hashlib.sha256(open(p, "rb").read()).hexdigest()


@pytest.fixture
def env(tmp_path, monkeypatch):
    t = P.LocalTarget(str(tmp_path / "bucket"))
    monkeypatch.setattr(PV, "_target", lambda: t)
    src = tmp_path / "src"
    src.mkdir()
    (src / "a.json").write_text('{"x": 1}')
    db = sqlite3.connect(src / "e.db")
    db.execute("CREATE TABLE t(x)")
    db.execute("INSERT INTO t VALUES (1)")
    db.commit(), db.close()
    root = tmp_path / "root"
    items = [{"src": str(src / n), "dst": f"{root.as_posix()}/{d}", "purpose": "t", "bytes": os.path.getsize(src / n),
              "sha256": _sha(src / n), "identity": "BYTE"} for n, d in (("a.json", "x/a.json"), ("e.db", "runs/r/data/e.db"))]
    inv = tmp_path / "inv.json"
    inv.write_text(json.dumps({"items": items}))
    return {"t": t, "src": src, "root": root.as_posix(), "inv": str(inv), "items": items}


def test_push_pull_verify_installs_exact_read_only_bytes(env):
    r = PV.push(env["inv"], "p")
    assert r["uploaded"] == 2 and PV.push(env["inv"], "p")["already_present"] == 2
    out = PV.pull("p", env["root"])
    assert out["installed"] == 2 and out["bad"] == [] and out["sqlite_quick_check_ok"] == 1
    for it in env["items"]:
        assert _sha(it["dst"]) == it["sha256"] and not os.access(it["dst"], os.W_OK)
    assert PV.pull("p", env["root"])["already_present"] == 2          # idempotent


def test_a_changed_source_is_refused(env):
    (env["src"] / "a.json").write_text('{"x": 2}')
    with pytest.raises(SystemExit, match="source changed"):
        PV.push(env["inv"], "p")


def test_an_existing_destination_with_different_bytes_is_never_overwritten(env):
    PV.push(env["inv"], "p")
    d = env["items"][0]["dst"]
    os.makedirs(os.path.dirname(d), exist_ok=True)
    open(d, "w").write("other")
    with pytest.raises(SystemExit, match="DIFFERENT bytes"):
        PV.pull("p", env["root"])


def test_a_tampered_install_fails_verify(env):
    PV.push(env["inv"], "p")
    PV.pull("p", env["root"])
    d = env["items"][0]["dst"]
    os.chmod(d, 0o644)
    open(d, "w").write("tampered")
    assert PV.verify(env["root"])["bad"] == [d]


def test_missing_worker_state_fails_closed_for_the_refresh(tmp_path):
    from api.services.marketcap import refresh as RF
    r = RF.Refresh.__new__(RF.Refresh)
    r.root, r.ledger, r.cfg = str(tmp_path), RF.Ledger(str(tmp_path)), type("C", (), {"policy": {}})()
    r.data = str(tmp_path / "runs" / "x" / "data")
    os.makedirs(r.data)
    with pytest.raises(RuntimeError, match="durable identity"):
        r._identity()
