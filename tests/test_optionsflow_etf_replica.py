"""The Options Flow ETF classification replica — PUSH model.

web = sole canonical writer AND sender  ->  flow-worker = atomic read replica.

⛔ THE TRANSPORT REVERSED BECAUSE THE TOPOLOGY DISPROVED THE PULL DESIGN.
Deployed 2026-09-07: flow-worker could not reach web at all. Railway private
networking is IPv6; web runs `uvicorn --host 0.0.0.0` (IPv4 only). Probed from
inside the pod, connections were REFUSED on 8080/8000/80 over both families.
Changing web's bind was rejected — member-facing service, no staging.

⛔ SEPARATE FROM ROUTING. `ticker_types` on flow-worker drives
massive_processor.is_index_source(), which decides where every live OPRA trade is
stored. This replica has its own table and one consumer: the server-side Options
Flow TOP 10. Reconnecting them would bundle a member-visible routing change into
a performance migration.
"""
import sqlite3
import time
import pytest

from api.services import optionsflow_etf_replica as rep
from api.services.etf_generation import generation_from_pairs


@pytest.fixture()
def db(tmp_path, monkeypatch):
    p = tmp_path / "flow.db"
    monkeypatch.setattr(rep, "DB_PATH", str(p))
    rep._MEM.update(generation=None, symbols=frozenset(), loaded_at=0.0)
    for k in ("last_push_ok_at", "last_push_error", "last_push_error_at"):
        rep._STATE[k] = None
    for k in ("pushes_received", "pushes_already_current", "pushes_rejected", "installs"):
        rep._STATE[k] = 0
    return str(p)


def snapshot(pairs, last_synced="2026-09-07T09:30:03"):
    """A well-formed push body, correctly stamped."""
    return {"generation": generation_from_pairs(pairs), "last_synced": last_synced,
            "rows": [list(p) for p in pairs]}


A = [("SPY", "ETF"), ("QQQ", "ETF")]
B = [("SPY", "ETF"), ("QQQ", "ETF"), ("IWM", "ETF")]


# ── structural separation from routing (mandatory) ──────────────────────────
def test_the_replica_writes_its_OWN_table_and_never_ticker_types(db):
    rep.install_pushed_snapshot(snapshot(A))
    conn = sqlite3.connect(db)
    names = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    conn.close()
    assert "optionsflow_etf_replica" in names
    assert "ticker_types" not in names, "the replica must never write the routing table"


def test_the_module_never_WIRES_itself_to_the_routing_classifier(db):
    """⛔ Checks CODE, not prose — the docstring names is_index_source on purpose."""
    import ast
    import inspect
    tree = ast.parse(inspect.getsource(rep))
    imported = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and node.module:
            imported.add(node.module)
        elif isinstance(node, ast.Import):
            for a in node.names:
                imported.add(a.name)
    assert "api.ticker_types" not in imported
    called = {n.func.attr for n in ast.walk(tree)
              if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)}
    called |= {n.func.id for n in ast.walk(tree)
               if isinstance(n, ast.Call) and isinstance(n.func, ast.Name)}
    assert "is_index_source" not in called and "classify" not in called
    # CONTROL: the extractor really sees this module's own calls.
    assert "local_generation" in called


def test_flow_worker_registers_no_second_canonical_sync_and_no_pull():
    """Web stays the single canonical writer, and the disproved pull design must
    not linger looking like the active architecture."""
    import pathlib
    src = (pathlib.Path(__file__).resolve().parents[1] / "api" / "flow_worker_main.py").read_text(encoding="utf-8")
    code = "\n".join(l for l in src.splitlines() if not l.strip().startswith("#"))
    assert "sync_from_massive" not in code
    assert "_ticker_types_sync" not in code
    assert "refresh_if_stale" not in code, "the pull scheduler must be gone"


# ── the receive path ────────────────────────────────────────────────────────
def test_a_valid_push_installs_and_is_readable(db):
    out = rep.install_pushed_snapshot(snapshot(A))
    assert out["status"] == "accepted"
    assert rep.local_generation()["generation"] == generation_from_pairs(A)
    assert rep.symbols() == frozenset({"SPY", "QQQ"})


def test_the_same_generation_is_IDEMPOTENT_and_rewrites_nothing(db):
    rep.install_pushed_snapshot(snapshot(A))
    installed_at = rep.local_generation()["installed_at"]
    out = rep.install_pushed_snapshot(snapshot(A))
    assert out["status"] == "already-current"
    assert rep._STATE["installs"] == 1, "a repeat push must not reinstall"
    assert rep.local_generation()["installed_at"] == installed_at


def test_a_newer_valid_generation_replaces_atomically(db):
    rep.install_pushed_snapshot(snapshot(A, "2026-09-06T05:30:00"))
    out = rep.install_pushed_snapshot(snapshot(B, "2026-09-07T05:30:00"))
    assert out["status"] == "accepted"
    assert rep.symbols() == frozenset({"SPY", "QQQ", "IWM"})
    assert rep.local_generation()["count"] == 3


def test_an_OLDER_snapshot_cannot_overwrite_a_newer_replica(db):
    """⛔ Digests have no order, so freshness comes from last_synced. A retry
    arriving late after a fresher push would otherwise roll the replica back."""
    rep.install_pushed_snapshot(snapshot(B, "2026-09-07T05:30:00"))
    out = rep.install_pushed_snapshot(snapshot(A, "2026-09-01T05:30:00"))
    assert out["status"] == "rejected" and "older" in out["reason"]
    assert rep.symbols() == frozenset({"SPY", "QQQ", "IWM"})


# ── nothing invalid may mutate the replica ──────────────────────────────────
def test_a_DIGEST_MISMATCH_cannot_mutate_the_replica(db):
    """The caller's stamp is never trusted; the digest is recomputed here."""
    rep.install_pushed_snapshot(snapshot(A))
    bad = snapshot(B)
    bad["generation"] = generation_from_pairs(A)      # stamp of a different set
    out = rep.install_pushed_snapshot(bad)
    assert out["status"] == "rejected" and "digest" in out["reason"]
    assert rep.symbols() == frozenset({"SPY", "QQQ"})


def test_a_TRUNCATED_body_cannot_mutate_the_replica(db):
    """A partial transfer keeps the sender's stamp but loses rows — recomputing
    the digest is exactly what makes that detectable."""
    rep.install_pushed_snapshot(snapshot(A))
    truncated = snapshot(B)
    truncated["rows"] = truncated["rows"][:1]
    out = rep.install_pushed_snapshot(truncated)
    assert out["status"] == "rejected"
    assert rep.symbols() == frozenset({"SPY", "QQQ"})


@pytest.mark.parametrize("payload", [
    None, [], "nope", {},
    {"generation": "x"},
    {"rows": [["SPY", "ETF"]]},
    {"generation": "x", "rows": []},
    {"generation": "x", "rows": [["SPY"]]},
    {"generation": "x", "rows": [["SPY", 5]]},
    {"generation": "x", "rows": [["", "ETF"]]},
])
def test_a_MALFORMED_snapshot_cannot_mutate_the_replica(db, payload):
    rep.install_pushed_snapshot(snapshot(A))
    out = rep.install_pushed_snapshot(payload)
    assert out["status"] == "rejected"
    assert rep.symbols() == frozenset({"SPY", "QQQ"}), "previous replica must survive"


def test_a_REAL_mid_install_failure_rolls_back_the_delete(db):
    """⛔ Exercises the actual _install transaction, not a stand-in. An earlier
    version monkeypatched _install wholesale, so the DELETE/INSERT rollback was
    never run — swapping its `raise` for `pass` stayed green while leaving an
    EMPTIED replica."""
    rep.install_pushed_snapshot(snapshot(A))
    with pytest.raises(Exception):
        rep._install({"symbols": [{"not": "a string"}], "generation": "gX",
                      "last_synced": "x"})
    rep._MEM.update(generation=None, symbols=frozenset(), loaded_at=0.0)
    assert rep.local_generation()["generation"] == generation_from_pairs(A)
    assert rep.symbols() == frozenset({"SPY", "QQQ"})


def test_rows_without_a_generation_stamp_are_NOT_served(db):
    """'Cannot classify' must never read as 'here is the classification'."""
    conn = sqlite3.connect(db)
    rep.ensure_schema(conn)
    conn.executemany("INSERT INTO optionsflow_etf_replica (ticker, asset_type) VALUES (?, 'ETF')",
                     [("SPY",), ("QQQ",)])
    conn.commit()
    n = conn.execute("SELECT COUNT(*) FROM optionsflow_etf_replica").fetchone()[0]
    conn.close()
    assert n == 2, "fixture must actually contain rows, or this proves nothing"
    rep._MEM.update(generation=None, symbols=frozenset(), loaded_at=0.0)
    assert rep.symbols() == frozenset()


def test_no_installed_generation_yields_an_empty_set_not_a_guess(db):
    assert rep.local_generation()["generation"] is None
    assert rep.symbols() == frozenset()


def test_a_restart_keeps_a_current_replica_current(db):
    """The replica is on disk, so a flow-worker restart must not lose it."""
    rep.install_pushed_snapshot(snapshot(A))
    gen = rep.local_generation()["generation"]
    rep._MEM.update(generation=None, symbols=frozenset(), loaded_at=0.0)   # fresh process
    assert rep.local_generation()["generation"] == gen
    assert rep.symbols() == frozenset({"SPY", "QQQ"})


# ── telemetry: the freeze must be operationally obvious ─────────────────────
def test_status_reports_stale_when_nothing_is_installed(db):
    s = rep.status()
    assert s["stale"] is True and s["local_generation"] is None


def test_status_reports_fresh_after_a_push(db):
    rep.install_pushed_snapshot(snapshot(A))
    s = rep.status()
    assert s["stale"] is False
    assert s["local_count"] == 2
    assert s["installs"] == 1


def test_status_flags_a_FROZEN_replica_like_july_to_september(db):
    rep.install_pushed_snapshot(snapshot(A))
    conn = sqlite3.connect(db)
    conn.execute("INSERT OR REPLACE INTO optionsflow_etf_replica_meta (k, v) VALUES ('installed_at', ?)",
                 (str(int(time.time()) - 55 * 24 * 3600),))
    conn.commit(); conn.close()
    s = rep.status()
    assert s["stale"] is True
    assert s["replica_age_hours"] > 24 * 50


def test_status_surfaces_the_last_rejection_without_hiding_a_good_replica(db):
    rep.install_pushed_snapshot(snapshot(A))
    rep.install_pushed_snapshot({"generation": "g", "rows": []})
    s = rep.status()
    assert s["last_push_error"]
    assert s["local_generation"] == generation_from_pairs(A)


# ── flags ───────────────────────────────────────────────────────────────────
def test_receive_disabled_by_default(monkeypatch):
    monkeypatch.delenv("OPTIONSFLOW_ETF_REPLICA_RECEIVE_ENABLED", raising=False)
    assert rep.receive_enabled() is False


def test_receive_enabled_only_on_exactly_1(monkeypatch):
    for v, want in (("1", True), ("0", False), ("true", False), ("", False)):
        monkeypatch.setenv("OPTIONSFLOW_ETF_REPLICA_RECEIVE_ENABLED", v)
        assert rep.receive_enabled() is want, v
