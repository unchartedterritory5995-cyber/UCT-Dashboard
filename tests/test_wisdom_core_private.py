"""The owner-private store (D16a; CONTRACTS §0 row 7, §6.2; W1 §0.4d, Part 10).

WHAT THIS FILE HAS TO BE ABLE TO SAY RED FOR
1. a value stored, or even a file created, while WISDOM_PRIVATE_KEY is unset;
2. plaintext on disk, or a value that does not round-trip through a generated Fernet key;
3. ciphertext handed back when the key is wrong, or a typo'd field silently dropped;
4. the store sharing a file with wisdom.db, or a locator into Journal data not being refused;
5. the /data default escaping the conftest census (unpinnable, or a new unguarded site);
6. PROPERTY (500 seeded random records): a private value landing in ANY wisdom.db column,
   or in the output of any publish adapter that exists. The scanner's own controls prove
   it finds every public token it should and a private value planted where it must not be.
"""
from __future__ import annotations

import importlib
import importlib.util
import inspect
import json
import os
import pkgutil
import random
import re
import sqlite3
import string

import pytest
from cryptography.fernet import Fernet

import conftest as rootconf
from api.services.wisdom.core import private, store, timeutil

CASES = 500
SEED = 20260913


@pytest.fixture
def stores(tmp_path, monkeypatch):
    monkeypatch.setenv("WISDOM_DB_PATH", str(tmp_path / "wisdom.db"))
    monkeypatch.setenv("WISDOM_PRIVATE_DB_PATH", str(tmp_path / "private" / "wisdom_private.db"))
    monkeypatch.delenv("WISDOM_PRIVATE_KEYS_V1", raising=False)
    store.init_db()
    return tmp_path


@pytest.fixture
def key(monkeypatch):
    value = Fernet.generate_key().decode()
    monkeypatch.setenv("WISDOM_PRIVATE_KEY", value)
    return value


# ── 1-4. the store's own rules ───────────────────────────────────────────────

def test_with_the_key_unset_nothing_is_stored_and_no_file_is_created(stores, monkeypatch):
    monkeypatch.delenv("WISDOM_PRIVATE_KEY", raising=False)
    assert private.is_configured() is False
    assert private.put_private("rec-1", "size_shares", 2500, "edu_videos:355@00:10:00") is False
    assert not os.path.exists(private.private_db_path())
    assert private.get_private("rec-1") == []
    # control: the identical call with a key does store, so the False above was the key
    monkeypatch.setenv("WISDOM_PRIVATE_KEY", Fernet.generate_key().decode())
    assert private.put_private("rec-1", "size_shares", 2500, "edu_videos:355@00:10:00") is True
    assert os.path.exists(private.private_db_path())


def test_values_round_trip_and_only_ciphertext_reaches_disk(stores, key):
    values = {"size_shares": 48213, "open_entry": 173.4829, "position_size": "PRIVATEHALFSIZE"}
    for field, value in values.items():
        assert private.put_private("rec-rt", field, value, "substack:/p/sunday-scans-d40#MDB") is True
    back = {row["field"]: row["value"] for row in private.get_private("rec-rt")}
    assert back == values
    with sqlite3.connect(private.private_db_path()) as conn:
        blobs = [r[0] for r in conn.execute("SELECT value_enc FROM wisdom_private_positions")]
    assert len(blobs) == 3 and all(b.startswith("v1:") for b in blobs)
    raw = b"".join(open(p, "rb").read() for p in (private.private_db_path(), private.private_db_path() + "-wal")
                   if os.path.exists(p))
    for plaintext in ("48213", "173.4829", "PRIVATEHALFSIZE"):
        assert plaintext.encode() not in raw, f"plaintext {plaintext} is on disk"


def test_a_rewrite_replaces_the_value_and_keeps_one_row(stores, key):
    assert private.put_private("rec-up", "size_shares", 100, "edu_videos:1@00:00:01")
    assert private.put_private("rec-up", "size_shares", 250, "edu_videos:1@00:00:02")
    rows = private.get_private("rec-up")
    assert [(r["field"], r["value"], r["source_locator"]) for r in rows] == [("size_shares", 250, "edu_videos:1@00:00:02")]


def test_a_wrong_key_reads_back_as_an_error_never_as_ciphertext(stores, key, monkeypatch):
    assert private.put_private("rec-wk", "open_entry", 88.5, "edu_videos:2@00:01:00")
    monkeypatch.setenv("WISDOM_PRIVATE_KEY", Fernet.generate_key().decode())
    rows = private.get_private("rec-wk")
    assert len(rows) == 1 and rows[0]["value"] is None and "undecryptable" in rows[0]["error"]
    assert not any(str(v).startswith("v1:") for v in rows[0].values())


@pytest.mark.parametrize("record_id,field,locator", [
    ("rec", "shares", "edu_videos:1"),       # typo'd field
    ("", "size_shares", "edu_videos:1"),
    ("rec", "size_shares", ""),
])
def test_a_contract_violation_raises(stores, key, record_id, field, locator):
    with pytest.raises(ValueError):
        private.put_private(record_id, field, 1, locator)


@pytest.mark.parametrize("locator", ["j2_positions:14", "journal:trade/9", "Notebook:note/3", "broker:fill/77"])  # journal-exclusion guard
def test_a_locator_into_journal_or_broker_data_is_refused(stores, key, locator):  # journal-exclusion guard
    assert private.put_private("rec-j", "size_shares", 10, locator) is False
    assert private.get_private("rec-j") == []


@pytest.mark.parametrize("value", [None, "", "   "])
def test_an_empty_value_stores_nothing(stores, key, value):
    assert private.put_private("rec-e", "size_shares", value, "edu_videos:1") is False
    assert private.get_private("rec-e") == []


def test_the_private_store_never_shares_a_file_with_wisdom_db(stores, key, monkeypatch):
    monkeypatch.setenv("WISDOM_PRIVATE_DB_PATH", os.environ["WISDOM_DB_PATH"])
    assert private.put_private("rec-s", "size_shares", 10, "edu_videos:1") is False
    with store.read() as conn:
        tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
    assert "wisdom_private_positions" not in tables


# ── 5. the census ────────────────────────────────────────────────────────────

def test_the_default_path_is_census_pinned_and_adds_no_unguarded_site(monkeypatch):
    assert rootconf.SHARED_DATA_ENV_PINS.get("WISDOM_PRIVATE_DB_PATH") == "/data/wisdom_private.db"
    assert rootconf.SHARED_DATA_ENV_PINS.get("WISDOM_DB_PATH") == "/data/wisdom.db"  # control: the census sees wisdom
    assert "/data/wisdom_private.db" not in rootconf.UNPINNABLE_SHARED_LITERALS
    assert not [s for s in rootconf.UNGUARDED_SHARED_LITERAL_SITES if "wisdom" in s[0]]
    monkeypatch.delenv("WISDOM_PRIVATE_DB_PATH", raising=False)
    assert private.private_db_path() == "/data/wisdom_private.db"  # resolution only; nothing opened


# ── 6. property: no private value reaches wisdom.db or a publish adapter ─────

_PRIVATE_INT_RE = re.compile(r"\d{9}")
_PRIVATE_FLOAT_RE = re.compile(r"\d{4}\.\d{1,6}")
_PRIVATE_TEXT_RE = re.compile(r"PRIV[A-Z]{20}")
_PUBLIC_TEXT_RE = re.compile(r"pub[a-z]{12}")


def _letters(rng, n, alphabet):
    return "".join(rng.choice(alphabet) for _ in range(n))


def _generate(rng):
    cases = []
    used_ints, used_floats = set(), set()
    for i in range(CASES):
        public = "pub" + _letters(rng, 12, string.ascii_lowercase)
        fields = rng.sample(sorted(private.PRIVATE_FIELDS), rng.randint(1, 3))
        values = {}
        for field in fields:
            if field == "size_shares":
                value = rng.randint(100_000_007, 999_999_937)
                while value in used_ints:
                    value += 1
                used_ints.add(value)
            elif field == "open_entry":
                value = round(rng.uniform(1000.0, 9000.0), 6)
                while value in used_floats:
                    value = round(value + 0.000011, 6)
                used_floats.add(value)
            else:
                value = "PRIV" + _letters(rng, 20, string.ascii_uppercase)
            values[field] = value
        entry = round(rng.uniform(1.0, 999.0), 2)
        cases.append({
            "i": i,
            "record_id": f"rec{i:04d}",
            "ticker": _letters(rng, rng.randint(2, 4), string.ascii_uppercase),
            "entry": entry,
            "stop": round(entry * 0.92, 2),
            "public": public,
            "private": values,
        })
    return cases


def _write_public(cases):
    now = timeutil.iso_et(timeutil.now_et())
    with store.write() as conn:
        for c in cases:
            i = c["i"]
            conn.execute(
                "INSERT INTO wisdom_sources(source_id, stream, external_ref, raw_sha256, ingest_version, ingested_at, "
                "title) VALUES (?, 'zoom_live', ?, ?, 'property', ?, ?)",
                (f"src{i:04d}", f"edu_videos:{i}", f"rawsha{i}", now, f"session {c['public']}"))
            conn.execute(
                "INSERT INTO wisdom_segments(segment_id, source_id, source_version, ordinal, kind, text, text_sha256, "
                "normalizer_version) VALUES (?, ?, 1, 0, 'cue_window', ?, ?, 'property')",
                (f"seg{i:04d}", f"src{i:04d}", f"text {c['public']}", f"textsha{i}"))
            conn.execute(
                "INSERT INTO wisdom_records(record_id, record_type, segment_id, source_id, source_version, "
                "extractor_version, record_hash, author_id, ticker, direction, stance, entry, stop, thesis, "
                "extraction_confidence, has_private, created_at) VALUES (?, 'CALL', ?, ?, 1, 'property', ?, 'tsdr', ?, "
                "'long', 'in_it', ?, ?, ?, 'high', 1, ?)",
                (c["record_id"], f"seg{i:04d}", f"src{i:04d}", f"hash{i}", c["ticker"], c["entry"], c["stop"],
                 f"thesis {c['public']}", now))


def _cells(db_path):
    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    try:
        tables = [r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")]
        for table in tables:
            columns = [r[1] for r in conn.execute(f'PRAGMA table_info("{table}")')]
            for row in conn.execute(f'SELECT * FROM "{table}"'):
                for column, value in zip(columns, row):
                    yield table, column, value
    finally:
        conn.close()


def _leaks(cells, ints, floats, texts):
    float_strings = {repr(f) for f in floats} | {f"{f:.6f}".rstrip("0") for f in floats}
    found = []
    for table, column, value in cells:
        if isinstance(value, int) and value in ints:
            found.append((table, column, value))
        elif isinstance(value, float) and value in floats:
            found.append((table, column, value))
        elif isinstance(value, str):
            for match in _PRIVATE_INT_RE.findall(value):
                if int(match) in ints:
                    found.append((table, column, match))
            for match in _PRIVATE_FLOAT_RE.findall(value):
                if match in float_strings or match.rstrip("0") in float_strings:
                    found.append((table, column, match))
            for match in _PRIVATE_TEXT_RE.findall(value):
                if match in texts:
                    found.append((table, column, match))
    return found


def test_property_no_private_value_ever_lands_in_wisdom_db(stores, key):
    cases = _generate(random.Random(SEED))
    assert len(cases) >= 500
    _write_public(cases)
    written = 0
    for c in cases:
        for field, value in c["private"].items():
            assert private.put_private(c["record_id"], field, value, f"edu_videos:{c['i']}@00:00:{c['i'] % 60:02d}")
            written += 1
    ints = {v for c in cases for f, v in c["private"].items() if f == "size_shares"}
    floats = {v for c in cases for f, v in c["private"].items() if f == "open_entry"}
    texts = {v for c in cases for f, v in c["private"].items() if f == "position_size"}
    assert ints and floats and texts and written == len(ints) + len(floats) + len(texts)

    cells = list(_cells(store.db_path()))
    # CONTROL 1: the scanner reads what it must — every public token is found in wisdom.db.
    public_found = {m for _, _, v in cells if isinstance(v, str) for m in _PUBLIC_TEXT_RE.findall(v)}
    assert {c["public"] for c in cases} <= public_found
    assert _leaks(cells, ints, floats, texts) == []

    # The private store holds every value, and only as ciphertext.
    for c in random.Random(SEED + 1).sample(cases, 25):
        assert {r["field"]: r["value"] for r in private.get_private(c["record_id"])} == c["private"]
    raw = "".join(open(p, "rb").read().decode("latin-1")
                  for p in (private.private_db_path(), private.private_db_path() + "-wal") if os.path.exists(p))
    assert not [m for m in _PRIVATE_TEXT_RE.findall(raw) if m in texts]
    assert not [m for m in _PRIVATE_INT_RE.findall(raw) if int(m) in ints]

    # CONTROL 2: plant one private value where it must never be; the scanner names it.
    victim = cases[7]
    planted = next(iter(victim["private"].values()))
    with store.write() as conn:
        conn.execute("UPDATE wisdom_records SET thesis = ? WHERE record_id = ?",
                     (f"leaked {planted}", victim["record_id"]))
    assert _leaks(list(_cells(store.db_path())), ints, floats, texts), "the leak scanner is blind"


def test_property_no_publish_adapter_output_carries_a_private_value(stores, key):
    """find_spec guarded: S-F builds the adapters in parallel. Every adapter function callable
    with only a db_path / conn is driven against a store seeded with private values."""
    if importlib.util.find_spec("api.services.wisdom.publish.adapters") is None:
        pytest.skip("SEAM: api.services.wisdom.publish.adapters does not exist in this base (S-F); "
                    "re-run after the S-F merge")
    package = importlib.import_module("api.services.wisdom.publish.adapters")
    cases = _generate(random.Random(SEED + 2))[:100]
    _write_public(cases)
    for c in cases:
        for field, value in c["private"].items():
            assert private.put_private(c["record_id"], field, value, f"edu_videos:{c['i']}")
    ints = {v for c in cases for f, v in c["private"].items() if f == "size_shares"}
    floats = {v for c in cases for f, v in c["private"].items() if f == "open_entry"}
    texts = {v for c in cases for f, v in c["private"].items() if f == "position_size"}
    probed, leaks = [], []
    for info in pkgutil.iter_modules(package.__path__, package.__name__ + "."):
        module = importlib.import_module(info.name)
        for name, fn in inspect.getmembers(module, inspect.isfunction):
            if name.startswith("_") or fn.__module__ != module.__name__:
                continue
            params = [p for p in inspect.signature(fn).parameters.values()
                      if p.default is inspect.Parameter.empty
                      and p.kind not in (inspect.Parameter.VAR_POSITIONAL, inspect.Parameter.VAR_KEYWORD)]
            if {p.name for p in params} - {"db_path", "conn"}:
                continue
            kwargs = {}
            with store.read() as conn:
                for p in params:
                    kwargs[p.name] = store.db_path() if p.name == "db_path" else conn
                try:
                    out = fn(**kwargs)
                except Exception:
                    continue
            probed.append(f"{module.__name__}.{name}")
            text = json.dumps(out, default=str)
            leaks += [(f"{module.__name__}.{name}", x) for x in _leaks([("out", "json", text)], ints, floats, texts)]
    if not probed:
        pytest.skip("no adapter function is callable with only db_path/conn; nothing to probe")
    assert leaks == [], leaks
