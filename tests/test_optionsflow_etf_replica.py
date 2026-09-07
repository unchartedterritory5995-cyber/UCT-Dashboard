"""The Options Flow ETF classification replica.

⛔ SEPARATE FROM ROUTING BY DESIGN. `ticker_types` on flow-worker drives
massive_processor.is_index_source(), which decides where every live OPRA trade is
stored. This replica writes to its own table and is read only by the server-side
Options Flow TOP 10. These tests pin that separation, because reconnecting the
two would silently bundle a member-visible routing change into a performance
migration.
"""
import sqlite3
import time
import pytest

from api.services import optionsflow_etf_replica as rep


@pytest.fixture()
def db(tmp_path, monkeypatch):
    p = tmp_path / "flow.db"
    monkeypatch.setattr(rep, "DB_PATH", str(p))
    monkeypatch.setattr(rep, "WEB_INTERNAL_URL", "http://web.internal")
    rep._MEM.update(generation=None, symbols=frozenset(), loaded_at=0.0)
    for k in ("last_refresh_ok_at", "last_refresh_error", "last_refresh_error_at",
              "last_canonical_generation_seen"):
        rep._STATE[k] = None
    for k in ("refreshes", "no_op_refreshes", "installs"):
        rep._STATE[k] = 0
    return str(p)


def fake_web(monkeypatch, generation, symbols, last_synced="2026-09-07T09:30:03",
             fail_on=None):
    """Stand in for web's two endpoints. `fail_on` raises for that path."""
    calls = []

    def _fetch(path):
        calls.append(path)
        if fail_on and fail_on in path:
            raise RuntimeError("boom")
        if path.endswith("/generation"):
            return {"ok": True, "generation": generation,
                    "last_synced": last_synced, "count": len(symbols)}
        return {"ok": True, "symbols": list(symbols), "generation": generation,
                "last_synced": last_synced, "count": len(symbols)}

    monkeypatch.setattr(rep, "_fetch_json", _fetch)
    return calls


# ── separation from the routing table ───────────────────────────────────────
def test_the_replica_writes_its_OWN_table_and_never_ticker_types(db, monkeypatch):
    fake_web(monkeypatch, "gen1", ["SPY", "QQQ"])
    rep.refresh_if_stale()
    conn = sqlite3.connect(db)
    names = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    conn.close()
    assert "optionsflow_etf_replica" in names
    # ⛔ The routing table must not be created or touched by this module.
    assert "ticker_types" not in names, "the replica must never write the routing table"


def test_the_module_never_WIRES_itself_to_the_routing_classifier(db):
    """If someone imports the routing classifier here, the separation the owner
    asked for has quietly ended.

    ⛔ Checks CODE, not prose. The module docstring names is_index_source on
    purpose — explaining what this must never touch IS the point of it. A
    comment-stripping version of this rail failed on its own documentation,
    which would have pressured a future reader to delete the warning to get green.
    """
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
    assert "api.ticker_types" not in imported, "the replica must not import the routing classifier"

    called = {n.func.attr for n in ast.walk(tree)
              if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)}
    called |= {n.func.id for n in ast.walk(tree)
               if isinstance(n, ast.Call) and isinstance(n.func, ast.Name)}
    assert "is_index_source" not in called
    assert "classify" not in called

    # CONTROL: the extractor really does see this module's own calls, so the
    # assertions above cannot pass by finding nothing at all.
    assert "_fetch_json" in called and "local_generation" in called


# ── convergence ─────────────────────────────────────────────────────────────
def test_first_refresh_installs_the_canonical_generation(db, monkeypatch):
    fake_web(monkeypatch, "genA", ["SPY", "QQQ", "IWM"])
    out = rep.refresh_if_stale()
    assert out["ok"] and out["changed"]
    assert rep.local_generation()["generation"] == "genA"
    assert rep.symbols() == frozenset({"SPY", "QQQ", "IWM"})


def test_a_matching_generation_does_NOT_reload_the_symbols(db, monkeypatch):
    calls = fake_web(monkeypatch, "genA", ["SPY", "QQQ"])
    rep.refresh_if_stale()
    calls.clear()
    out = rep.refresh_if_stale()
    assert out["ok"] and out["changed"] is False
    # metadata probe only — no ~19k-symbol download
    assert calls == ["/api/ticker-types/generation"]
    assert rep._STATE["no_op_refreshes"] == 1


def test_a_changed_generation_triggers_replacement(db, monkeypatch):
    fake_web(monkeypatch, "genA", ["SPY"])
    rep.refresh_if_stale()
    fake_web(monkeypatch, "genB", ["SPY", "IWM"])
    out = rep.refresh_if_stale()
    assert out["changed"] is True
    assert rep.local_generation()["generation"] == "genB"
    assert rep.symbols() == frozenset({"SPY", "IWM"})


# ── failure retains the previous COMPLETE replica ───────────────────────────
def test_generation_probe_failure_is_non_fatal_and_keeps_the_replica(db, monkeypatch):
    fake_web(monkeypatch, "genA", ["SPY", "QQQ"])
    rep.refresh_if_stale()
    fake_web(monkeypatch, "genB", ["ZZZ"], fail_on="/generation")
    out = rep.refresh_if_stale()
    assert out["ok"] is False
    assert rep.local_generation()["generation"] == "genA"      # intact
    assert rep.symbols() == frozenset({"SPY", "QQQ"})
    assert rep._STATE["last_refresh_error"]


def test_snapshot_fetch_failure_keeps_the_previous_replica(db, monkeypatch):
    fake_web(monkeypatch, "genA", ["SPY", "QQQ"])
    rep.refresh_if_stale()
    fake_web(monkeypatch, "genB", ["ZZZ"], fail_on="etf-index-symbols")
    assert rep.refresh_if_stale()["ok"] is False
    assert rep.local_generation()["generation"] == "genA"
    assert rep.symbols() == frozenset({"SPY", "QQQ"})


def test_an_EMPTY_snapshot_is_rejected_not_installed(db, monkeypatch):
    """An empty payload is a provider fault, not a real 'no ETFs exist'.
    Installing it would classify every ETF as a stock, silently."""
    fake_web(monkeypatch, "genA", ["SPY", "QQQ"])
    rep.refresh_if_stale()
    fake_web(monkeypatch, "genB", [])
    out = rep.refresh_if_stale()
    assert out["ok"] is False and "validation" in out["reason"]
    assert rep.symbols() == frozenset({"SPY", "QQQ"})


def test_an_UNSTAMPED_snapshot_is_rejected(db, monkeypatch):
    fake_web(monkeypatch, "genA", ["SPY"])
    rep.refresh_if_stale()
    fake_web(monkeypatch, None, ["SPY", "IWM"])
    assert rep.refresh_if_stale()["ok"] is False
    assert rep.local_generation()["generation"] == "genA"


def test_install_failure_rolls_back_leaving_no_half_updated_set(db, monkeypatch):
    fake_web(monkeypatch, "genA", ["SPY", "QQQ"])
    rep.refresh_if_stale()

    real = rep._install
    def boom(snapshot):
        raise sqlite3.OperationalError("disk full mid-install")
    monkeypatch.setattr(rep, "_install", boom)
    fake_web(monkeypatch, "genB", ["AAA", "BBB", "CCC"])
    assert rep.refresh_if_stale()["ok"] is False
    monkeypatch.setattr(rep, "_install", real)
    # ⛔ The old generation is whole — not a mixture of both.
    assert rep.local_generation()["generation"] == "genA"
    assert rep.symbols() == frozenset({"SPY", "QQQ"})


def test_the_stamp_and_the_rows_are_installed_together(db, monkeypatch):
    fake_web(monkeypatch, "genA", ["SPY", "QQQ", "IWM"])
    rep.refresh_if_stale()
    info = rep.local_generation()
    assert info["count"] == 3 and info["generation"] == "genA"


# ── "cannot classify" is not "no ETFs" ──────────────────────────────────────
def test_no_installed_generation_yields_an_empty_set_not_a_guess(db):
    assert rep.local_generation()["generation"] is None
    assert rep.symbols() == frozenset()


# ── telemetry: the freeze must be visible ───────────────────────────────────
def test_status_reports_stale_when_nothing_is_installed(db):
    s = rep.status()
    assert s["stale"] is True
    assert s["local_generation"] is None
    assert s["matches_canonical"] is False


def test_status_reports_fresh_and_matching_after_convergence(db, monkeypatch):
    fake_web(monkeypatch, "genA", ["SPY"])
    rep.refresh_if_stale()
    s = rep.status()
    assert s["stale"] is False
    assert s["matches_canonical"] is True
    assert s["local_count"] == 1
    assert s["replica_age_seconds"] is not None


def test_status_flags_a_FROZEN_replica_like_july_to_september(db, monkeypatch):
    """The 55-day freeze was invisible because nothing reported replica age."""
    fake_web(monkeypatch, "genA", ["SPY"])
    rep.refresh_if_stale()
    conn = sqlite3.connect(db)
    old = str(int(time.time()) - 55 * 24 * 3600)
    conn.execute("INSERT OR REPLACE INTO optionsflow_etf_replica_meta (k, v) VALUES ('installed_at', ?)", (old,))
    conn.commit(); conn.close()
    s = rep.status()
    assert s["stale"] is True
    assert s["replica_age_hours"] > 24 * 50


def test_status_surfaces_the_last_error_without_hiding_the_good_replica(db, monkeypatch):
    fake_web(monkeypatch, "genA", ["SPY"])
    rep.refresh_if_stale()
    fake_web(monkeypatch, "genB", ["X"], fail_on="/generation")
    rep.refresh_if_stale()
    s = rep.status()
    assert s["last_refresh_error"]
    assert s["local_generation"] == "genA"     # still serving the good one


def test_missing_web_url_is_reported_not_crashed(db, monkeypatch):
    monkeypatch.setattr(rep, "WEB_INTERNAL_URL", "")
    assert rep.status()["web_internal_url_configured"] is False
    out = rep.refresh_if_stale()
    assert out["ok"] is False


# ── the flag ────────────────────────────────────────────────────────────────
def test_disabled_by_default(monkeypatch):
    monkeypatch.delenv("OPTIONSFLOW_ETF_REPLICA_ENABLED", raising=False)
    assert rep.enabled() is False


def test_enabled_only_on_exactly_1(monkeypatch):
    for v, want in (("1", True), ("0", False), ("true", False), ("", False)):
        monkeypatch.setenv("OPTIONSFLOW_ETF_REPLICA_ENABLED", v)
        assert rep.enabled() is want, v


# ── the two cases mutation testing proved were not covered ──────────────────
def test_a_REAL_mid_install_failure_rolls_back_the_delete(db, monkeypatch):
    """⛔ Exercises the actual _install transaction, not a monkeypatched stand-in.

    The earlier failure test replaced _install wholesale, so the DELETE/INSERT
    rollback inside it was never run — swapping its `raise` for `pass` left the
    suite green while leaving an EMPTIED replica behind. This binds a value
    sqlite cannot store, which fails during executemany AFTER the DELETE.
    """
    fake_web(monkeypatch, "genA", ["SPY", "QQQ"])
    rep.refresh_if_stale()
    assert rep.symbols() == frozenset({"SPY", "QQQ"})

    with pytest.raises(Exception):
        rep._install({"symbols": [{"not": "a string"}], "generation": "genB",
                      "last_synced": "x"})

    rep._MEM.update(generation=None, symbols=frozenset(), loaded_at=0.0)
    # The previous generation must be WHOLE — not emptied by the failed DELETE.
    assert rep.local_generation()["generation"] == "genA"
    assert rep.symbols() == frozenset({"SPY", "QQQ"})


def test_rows_without_a_generation_stamp_are_NOT_served(db, monkeypatch):
    """⛔ 'Cannot classify' must never read as 'here is the classification'.

    Rows present with no stamp is exactly the state a half-install would leave.
    Serving them would hand the TOP 10 an unidentifiable set that no generation
    check could reject — the mismatch rail would be blind to it.
    """
    conn = sqlite3.connect(db)
    rep.ensure_schema(conn)
    conn.executemany(
        "INSERT INTO optionsflow_etf_replica (ticker, asset_type) VALUES (?, 'ETF')",
        [("SPY",), ("QQQ",)],
    )
    conn.commit()
    n = conn.execute("SELECT COUNT(*) FROM optionsflow_etf_replica").fetchone()[0]
    conn.close()
    assert n == 2, "fixture must actually contain rows, or this proves nothing"

    rep._MEM.update(generation=None, symbols=frozenset(), loaded_at=0.0)
    assert rep.local_generation()["generation"] is None
    assert rep.symbols() == frozenset(), "unstamped rows must not be served"


# ── the wiring rail ─────────────────────────────────────────────────────────
# This repo's most-repeated defect is a feature that is built, tested, green and
# connected to nothing — the insights pass ran that way for weeks. These derive
# the wiring from the source rather than trusting that it was done.
def test_the_replica_is_actually_scheduled_on_flow_worker():
    import ast
    import pathlib
    src = pathlib.Path(__file__).resolve().parents[1] / "api" / "flow_worker_main.py"
    tree = ast.parse(src.read_text(encoding="utf-8"))
    ids = {kw.value.value
           for n in ast.walk(tree) if isinstance(n, ast.Call)
           for kw in n.keywords
           if kw.arg == "id" and isinstance(kw.value, ast.Constant)}
    assert "optionsflow_etf_replica_refresh" in ids, "replica refresh is not scheduled"
    # CONTROL: the extractor sees other real job ids, so this cannot pass by
    # finding an empty set.
    assert len(ids) > 1


def test_the_status_endpoint_is_mounted_under_the_proxied_flow_prefix():
    import pathlib
    src = (pathlib.Path(__file__).resolve().parents[1] / "api" / "flow_router.py").read_text(encoding="utf-8")
    assert '@flow_router.get("/etf-replica-status")' in src
    # /api/flow* is proxied to flow-worker, which is the ONLY pod whose replica
    # state is meaningful. Mounting it on web would report an empty table forever.
    proxy = (pathlib.Path(__file__).resolve().parents[1] / "api" / "flow_proxy.py").read_text(encoding="utf-8")
    assert '"/api/flow"' in proxy


def test_flow_worker_does_not_schedule_a_second_ticker_types_sync():
    """⛔ The owner ruled out independent daily syncs that can drift. Web remains
    the single canonical writer; flow-worker only replicates."""
    import pathlib
    src = (pathlib.Path(__file__).resolve().parents[1] / "api" / "flow_worker_main.py").read_text(encoding="utf-8")
    code = "\n".join(l for l in src.splitlines() if not l.strip().startswith("#"))
    assert "sync_from_massive" not in code
    assert "_ticker_types_sync" not in code
