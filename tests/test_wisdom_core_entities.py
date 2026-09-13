"""Ticker -> entity resolution through S3 Entity Master (W1 §4.2; manifest §4.8).

WHAT THIS FILE HAS TO BE ABLE TO SAY RED FOR
1. a symbol or cashtag not resolving through entity_master.api.resolve as of the date,
   or the date not reaching it;
2. a single-letter ticker (W, U) without its confidence penalty;
3. a crypto name resolving to the equity that shares its symbol instead of its vehicle
   (ETH is Ethan Allen on the NYSE), or a vehicle not recording its underlying;
4. an approved alias not resolving, or an unapproved one resolving;
5. anything unresolvable, ambiguous, blank, undated or failing coming back as an entity
   instead of None — the writer refuses a CALL on None, so a guess here is a false CALL.
The real entity-master path is exercised against a temporary entity_master.db, including
an alias window that closed before the as-of date.
"""
from __future__ import annotations

import sqlite3
from datetime import date, datetime
from types import SimpleNamespace

import pytest

from api.services.wisdom.core import aliases, entities, store, timeutil


def _resolver(table, calls=None, status="resolved"):
    def resolve(symbol, as_of):
        if calls is not None:
            calls.append((symbol, as_of))
        if symbol not in table:
            return SimpleNamespace(status="not_found", entity=None)
        return SimpleNamespace(status=status, entity=SimpleNamespace(
            entity_id=table[symbol], entity_type="equity", lifecycle_state="active"))
    return resolve


TABLE = {"NVDA": "ent_nvda", "W": "ent_wayfair", "U": "ent_unity", "WW": "ent_ww", "ETH": "ent_ethan_allen",
         "ETHA": "ent_etha", "ETHU": "ent_ethu", "IBIT": "ent_ibit", "LITE": "ent_lite", "BRK.B": "ent_brkb"}


@pytest.fixture
def wisdom_db(tmp_path, monkeypatch):
    monkeypatch.setenv("WISDOM_DB_PATH", str(tmp_path / "wisdom.db"))
    store.init_db()
    aliases.clear_cache()
    yield tmp_path
    aliases.clear_cache()


def test_a_symbol_and_a_cashtag_resolve_as_of_the_date(wisdom_db):
    calls = []
    got = entities.resolve("$nvda", date(2026, 9, 11), resolver=_resolver(TABLE, calls))
    assert got["entity_id"] == "ent_nvda" and got["ticker"] == "NVDA" and got["via"] == "symbol"
    assert got["confidence"] == 1.0 and got["single_letter"] is False and got["crypto_vehicle"] is False
    assert calls == [("NVDA", "2026-09-11")]
    assert entities.resolve("BRK.B", "2026-09-11", resolver=_resolver(TABLE))["entity_id"] == "ent_brkb"


@pytest.mark.parametrize("as_of", [date(2026, 9, 11), "2026-09-11", "20260911", "2026-09-11T10:30:00-04:00",
                                   datetime(2026, 9, 11, 22, 0, tzinfo=timeutil.ET)])
def test_every_as_of_form_reaches_the_resolver_as_one_date(wisdom_db, as_of):
    calls = []
    entities.resolve("NVDA", as_of, resolver=_resolver(TABLE, calls))
    assert calls == [("NVDA", "2026-09-11")]


@pytest.mark.parametrize("symbol", ["W", "U"])
def test_a_single_letter_ticker_carries_its_penalty(wisdom_db, symbol):
    got = entities.resolve(symbol, "2026-09-11", resolver=_resolver(TABLE))
    assert got["single_letter"] is True and got["confidence"] == entities.SINGLE_LETTER_PENALTY
    control = entities.resolve("WW", "2026-09-11", resolver=_resolver(TABLE))
    assert control["single_letter"] is False and control["confidence"] == 1.0


@pytest.mark.parametrize("name", ["ETH", "$eth", "Ethereum", "ether"])
def test_a_crypto_name_resolves_to_its_vehicle_not_the_equity_sharing_its_symbol(wisdom_db, name):
    got = entities.resolve(name, "2026-09-11", resolver=_resolver(TABLE))
    assert got["entity_id"] == "ent_etha" and got["via"] == "crypto_vehicle"
    assert got["underlying"] == "ETH" and got["crypto_vehicle"] is True
    assert got["confidence"] == entities.CRYPTO_VEHICLE_PENALTY
    assert entities.resolve("bitcoin", "2026-09-11", resolver=_resolver(TABLE))["ticker"] == "IBIT"


def test_a_listed_vehicle_records_its_underlying(wisdom_db):
    got = entities.resolve("ETHU", "2026-09-11", resolver=_resolver(TABLE))
    assert got["via"] == "symbol" and got["underlying"] == "ETH" and got["confidence"] == 1.0


def test_an_approved_alias_resolves_and_an_unapproved_one_does_not(wisdom_db):
    got = entities.resolve("light", "2026-09-11", resolver=_resolver(TABLE))
    assert got["ticker"] == "LITE" and got["via"] == "alias" and got["confidence"] == entities.ALIAS_PENALTY
    with store.write() as conn:
        conn.execute("UPDATE wisdom_ticker_aliases SET approved = 0 WHERE alias = 'light'")
    aliases.clear_cache()
    assert entities.resolve("light", "2026-09-11", resolver=_resolver(TABLE)) is None


def test_unresolvable_ambiguous_blank_undated_and_failing_are_none(wisdom_db):
    assert entities.resolve("ZZZZ", "2026-09-11", resolver=_resolver(TABLE)) is None
    assert entities.resolve("NVDA", "2026-09-11", resolver=_resolver(TABLE, status="ambiguous")) is None
    assert entities.resolve("", "2026-09-11", resolver=_resolver(TABLE)) is None
    assert entities.resolve(None, "2026-09-11", resolver=_resolver(TABLE)) is None
    assert entities.resolve("NVDA", "not a date", resolver=_resolver(TABLE)) is None

    def boom(symbol, as_of):
        raise sqlite3.OperationalError("database is locked")

    assert entities.resolve("NVDA", "2026-09-11", resolver=boom) is None


def test_the_real_entity_master_path_honours_the_alias_window(wisdom_db, tmp_path):
    from api.services.entity_master import schema

    db_path = str(tmp_path / "entity_master.db")
    conn = schema.init_db(db_path=db_path)
    conn.executemany("INSERT INTO entities(entity_id, entity_type, lifecycle_state, created_at, updated_at) "
                     "VALUES (?, 'equity', 'active', '2026-01-01', '2026-01-01')", [("ent_lite",), ("ent_old",)])
    conn.executemany("INSERT INTO entity_aliases(entity_id, alias, valid_from, valid_to, source, created_at) "
                     "VALUES (?, ?, ?, ?, 'test', '2026-01-01')",
                     [("ent_lite", "LITE", "2015-01-01", None), ("ent_old", "OLDX", "2010-01-01", "2020-01-01")])
    conn.commit()
    conn.close()
    got = entities.resolve("LITE", "2026-09-11", db_path=db_path)
    assert got is not None and got["entity_id"] == "ent_lite" and got["lifecycle_state"] == "active"
    assert entities.resolve("OLDX", "2019-06-01", db_path=db_path)["entity_id"] == "ent_old"
    assert entities.resolve("OLDX", "2026-09-11", db_path=db_path) is None  # the alias closed in 2020
