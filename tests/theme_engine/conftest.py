"""Shared fixtures for theme-engine tests: scratch auth.db + reloaded modules.

`store` — api.services.theme_engine.store reloaded against a scratch auth.db
  (engine tables only; moved here from test_store.py so test_orphans.py can
  share it).

`db` bundles everything the merged-read tests need:
  db.store      — api.services.theme_engine.store (reloaded against scratch DB)
  db.theme_db   — api.services.theme_db (reloaded against scratch DB)
  db.run        — an open engine run_id for store mutations
  db.monkeypatch — the test's monkeypatch (for _find_taxonomy_file patching)
"""
import contextlib
import importlib
from types import SimpleNamespace

import pytest


@pytest.fixture()
def store(monkeypatch, tmp_path):
    # Point auth_db at a scratch DB (house pattern: AUTH_DB_PATH env honored by auth_db)
    monkeypatch.setenv("AUTH_DB_PATH", str(tmp_path / "auth.db"))
    import api.services.auth_db as auth_db
    importlib.reload(auth_db)
    import api.services.theme_engine.store as st
    importlib.reload(st)
    # Task-5 adaptation: orphans.run_orphan_batch's unpatched _candidates_for
    # reads theme_db.get_all_themes() against the same scratch DB — the (empty)
    # theme tables must exist or every batch test dies on OperationalError.
    import api.services.theme_db as theme_db
    importlib.reload(theme_db)
    theme_db.init_theme_tables()
    st.init_engine_tables()
    return st


def _seed_owner(c):
    c.execute("INSERT INTO theme_sectors (id, name) VALUES ('tech','Technology')")
    c.execute("INSERT INTO themes (id, name, sector_id) VALUES ('ai','AI','tech')")
    c.execute("INSERT INTO theme_memberships (theme_id, sym, tier) VALUES ('ai','NVDA','core')")


@pytest.fixture()
def db(monkeypatch, tmp_path):
    # Point auth_db at a scratch DB (house pattern: AUTH_DB_PATH env honored by auth_db)
    monkeypatch.setenv("AUTH_DB_PATH", str(tmp_path / "auth.db"))
    import api.services.auth_db as auth_db
    importlib.reload(auth_db)
    import api.services.theme_engine.store as store
    importlib.reload(store)
    import api.services.theme_db as theme_db
    importlib.reload(theme_db)

    theme_db.init_theme_tables()
    store.init_engine_tables()
    with contextlib.closing(auth_db.get_connection()) as c:
        # seed_from_json reads/writes user_preferences — create just that table
        # (full auth_db.init_db() is unnecessary weight for these tests).
        c.executescript("""
            CREATE TABLE IF NOT EXISTS user_preferences (
                id          TEXT PRIMARY KEY,
                user_id     TEXT NOT NULL,
                pref_key    TEXT NOT NULL,
                pref_value  TEXT,
                UNIQUE(user_id, pref_key)
            );
        """)
        _seed_owner(c)
        c.commit()

    run = store.start_run("test")
    return SimpleNamespace(store=store, theme_db=theme_db, run=run,
                           monkeypatch=monkeypatch)
