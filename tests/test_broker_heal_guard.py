"""Heal-guard: a transient empty/thin broker fetch must never wipe the ledger."""

from __future__ import annotations

import pytest

from api.services import auth_db
from api.services.journal_two.db import ensure_schema
from api.services.journal_two.broker import activities_store as store


@pytest.fixture
def env(tmp_path, monkeypatch):
    dbfile = tmp_path / "auth.db"
    monkeypatch.setattr(auth_db, "_DB_PATH", str(dbfile))
    conn = auth_db.get_connection(); ensure_schema(conn); conn.close()


def _seed(n, baid="ba1"):
    acts = [{"id": f"a{i}", "type": "BUY", "symbol": {"symbol": "AAPL"},
             "trade_date": f"2026-04-{i+1:02d}"} for i in range(n)]
    store.store_activities("u1", baid, acts)


def test_empty_fetch_deletes_nothing(env):
    _seed(5)
    removed = store.heal_window("u1", "ba1", set(), since=None)
    assert removed == 0
    assert store.count("u1", "ba1") == 5


def test_thin_fetch_skips_heal(env):
    _seed(10)
    # Broker returned only 2 of 10 ids (< 50%) → suspicious → skip.
    removed = store.heal_window("u1", "ba1", {"a0", "a1"}, since=None)
    assert removed == 0
    assert store.count("u1", "ba1") == 10


def test_normal_void_still_heals(env):
    _seed(10)
    # Broker returned 9 of 10 (a3 voided) → above ratio → delete the 1.
    present = {f"a{i}" for i in range(10) if i != 3}
    removed = store.heal_window("u1", "ba1", present, since=None)
    assert removed == 1
    assert store.count("u1", "ba1") == 9


def test_full_fetch_no_voids_deletes_nothing(env):
    _seed(4)
    present = {f"a{i}" for i in range(4)}
    assert store.heal_window("u1", "ba1", present, since=None) == 0
    assert store.count("u1", "ba1") == 4
