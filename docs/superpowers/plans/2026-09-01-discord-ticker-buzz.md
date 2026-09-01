# Discord Ticker Buzz Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Count ticker mentions in the Uncharted Territory `#main-chat` and serve them as a `/buzz` command, two ranked boards, and one rendered image posted daily.

**Architecture:** A scheduler job on Railway `web` polls `GET /channels/{id}/messages?after=<snowflake>` every 60s, runs a four-tier extractor over each message, and writes one row per (message × ticker) into a new SQLite DB on the volume. Queries arrive at the existing `POST /api/discord/interactions` endpoint. The board image renders through the existing `chart-renderer` Playwright service from a new `/r/buzz` React route.

**Tech Stack:** Python 3.11 · FastAPI · SQLite (stdlib `sqlite3`) · APScheduler · httpx · pytest · React 18 (Vite) · Playwright (via `chart-renderer`)

**Spec:** `docs/superpowers/specs/2026-09-01-discord-ticker-buzz-design.md`

## Global Constraints

- **Worktree:** `C:\Users\Patrick\uct-worktrees\discord-buzz`, branch `feat/discord-buzz`. Bash `cd` persists between calls — prefix every command with `cd /c/Users/Patrick/uct-worktrees/discord-buzz &&`.
- **Never `git add -A`.** Stage only the files a task names. The worktree shares a repo with ~95 others.
- **Ship with `git push origin feat/discord-buzz:master`.** Never force-push.
- **Never run pytest through a pipe.** `pytest ... | tail` hides the exit code. Gate on `$?` or run without a pipe. A task is not done until you have read the summary line; its absence means the run did not finish.
- **DB path:** `/data/buzz.db`, overridable via `BUZZ_DB_PATH`. Every test sets `BUZZ_DB_PATH` to a tmp file. Never let a test touch `/data` or `C:\data`.
- **Guild id:** `882293203485720596`. **`#main-chat` id:** `1216816863313657886`. **Bot app id:** `1474900505917653142`.
- **Discord snowflake → unix ms:** `(int(sid) >> 22) + 1420070400000`.
- **Flags default OFF where they post or write to Discord.** `BUZZ_DIGEST_ENABLED` ships as `0`.
- **Every new flag must be registered** so "off by default and set nowhere" is distinguishable from "off on purpose" (`project_feature_flag_ledger`, `tools/feature_flag_index.py`).
- **Timezone:** every `CronTrigger` must carry `timezone=_ET` explicitly. A pre-built trigger resolves tzlocal (UTC on Railway), not the scheduler's timezone.
- **Blocked prerequisite:** Task 5 onwards needs the `UCT Intelligence` role granted View Channel on `#main-chat`. Verify with `tools/buzz_perms.py` (Task 5) before assuming an empty result is a code bug.

---

### Task 1: Mention store

**Files:**
- Create: `api/services/buzz_store.py`
- Test: `tests/test_buzz_store.py`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `init_db(path: str | None = None) -> None`
  - `snowflake_ts(sid: str) -> int` — unix **seconds**
  - `record_mentions(rows: list[tuple[str, str, str, str, int, str]]) -> int` — rows are `(message_id, channel_id, author_id, ticker, ts, confidence)`; returns rows newly inserted
  - `get_cursor(channel_id: str) -> str | None`
  - `set_cursor(channel_id: str, message_id: str) -> None`
  - `board(start_ts: int, end_ts: int, channels: list[str], limit: int = 10) -> list[dict]` — dicts `{"ticker", "people", "mentions"}`, ordered by people desc then mentions desc
  - `count(ticker: str, start_ts: int, end_ts: int, channels: list[str]) -> int`
  - `series(ticker: str, start_ts: int, end_ts: int, buckets: int, channels: list[str]) -> list[int]`
  - `known_tickers(prefix: str, limit: int = 25) -> list[tuple[str, int]]` — `(ticker, mentions)` desc, for autocomplete
  - `latest_ts(channels: list[str]) -> int | None` — for the "counted through" coverage line

- [ ] **Step 1: Write the failing test**

```python
# tests/test_buzz_store.py
"""Buzz mention store: schema, idempotency, cursor, board maths."""
from __future__ import annotations

import os
import pytest


@pytest.fixture()
def store(tmp_path, monkeypatch):
    monkeypatch.setenv("BUZZ_DB_PATH", str(tmp_path / "buzz.db"))
    from api.services import buzz_store
    buzz_store._reset_for_tests()
    buzz_store.init_db()
    return buzz_store


CH = "1216816863313657886"


def test_snowflake_ts_is_unix_seconds(store):
    # 1544451055910129726 was posted 2026-09-01T20:57:06Z
    assert store.snowflake_ts("1544451055910129726") == 1788296226


def test_record_and_board_counts_people_and_mentions(store):
    rows = [
        ("1", CH, "alice", "NVDA", 100, "cashtag"),
        ("2", CH, "bob",   "NVDA", 101, "exact"),
        ("3", CH, "alice", "NVDA", 102, "exact"),   # alice again -> still 1 person
        ("4", CH, "carol", "SPY",  103, "alias"),
    ]
    assert store.record_mentions(rows) == 4
    board = store.board(0, 999, [CH])
    assert board[0] == {"ticker": "NVDA", "people": 2, "mentions": 3}
    assert board[1] == {"ticker": "SPY", "people": 1, "mentions": 1}


def test_reingesting_the_same_window_changes_nothing(store):
    rows = [("1", CH, "alice", "NVDA", 100, "cashtag")]
    assert store.record_mentions(rows) == 1
    assert store.record_mentions(rows) == 0          # idempotent
    assert store.board(0, 999, [CH])[0]["mentions"] == 1


def test_one_message_naming_two_tickers_is_two_rows(store):
    rows = [
        ("1", CH, "alice", "NVDA", 100, "cashtag"),
        ("1", CH, "alice", "AMD",  100, "cashtag"),
    ]
    assert store.record_mentions(rows) == 2
    assert {r["ticker"] for r in store.board(0, 999, [CH])} == {"NVDA", "AMD"}


def test_window_bounds_are_inclusive_start_exclusive_end(store):
    store.record_mentions([
        ("1", CH, "a", "NVDA", 100, "exact"),
        ("2", CH, "a", "NVDA", 200, "exact"),
    ])
    assert store.count("NVDA", 100, 200, [CH]) == 1
    assert store.count("NVDA", 100, 201, [CH]) == 2


def test_cursor_roundtrip(store):
    assert store.get_cursor(CH) is None
    store.set_cursor(CH, "999")
    assert store.get_cursor(CH) == "999"
    store.set_cursor(CH, "1000")
    assert store.get_cursor(CH) == "1000"


def test_series_buckets_by_time(store):
    store.record_mentions([
        ("1", CH, "a", "NVDA", 0,  "exact"),
        ("2", CH, "b", "NVDA", 0,  "exact"),
        ("3", CH, "c", "NVDA", 90, "exact"),
    ])
    assert store.series("NVDA", 0, 100, buckets=2, channels=[CH]) == [2, 1]


def test_known_tickers_ranks_by_mentions_and_filters_by_prefix(store):
    store.record_mentions([
        ("1", CH, "a", "NVDA", 1, "exact"),
        ("2", CH, "b", "NVDA", 2, "exact"),
        ("3", CH, "c", "NVAX", 3, "exact"),
        ("4", CH, "d", "AMD",  4, "exact"),
    ])
    assert store.known_tickers("NV") == [("NVDA", 2), ("NVAX", 1)]
    assert store.known_tickers("") [0] == ("NVDA", 2)


def test_channel_filter_excludes_other_channels(store):
    store.record_mentions([
        ("1", CH,    "a", "NVDA", 1, "exact"),
        ("2", "9999", "b", "NVDA", 2, "exact"),
    ])
    assert store.count("NVDA", 0, 99, [CH]) == 1
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /c/Users/Patrick/uct-worktrees/discord-buzz && python -m pytest tests/test_buzz_store.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'api.services.buzz_store'`

- [ ] **Step 3: Write the implementation**

```python
# api/services/buzz_store.py
"""Ticker-mention counts for #main-chat, one row per (message x ticker).

Deliberately stores NO message text. `message_id` + `channel_id` reconstruct a
Discord jump link, which stays true when a member edits or deletes; a stored
copy would not. The composite primary key makes re-ingesting an overlapping
window a no-op, so a retry can never double-count.
"""
from __future__ import annotations

import os
import sqlite3
import threading

DISCORD_EPOCH_MS = 1420070400000

_lock = threading.Lock()
_conn: sqlite3.Connection | None = None
_conn_path: str | None = None


def db_path() -> str:
    return os.environ.get("BUZZ_DB_PATH", "/data/buzz.db")


def _reset_for_tests() -> None:
    """Drop the cached handle so a test's BUZZ_DB_PATH takes effect."""
    global _conn, _conn_path
    with _lock:
        if _conn is not None:
            _conn.close()
        _conn = None
        _conn_path = None


def connect() -> sqlite3.Connection:
    global _conn, _conn_path
    path = db_path()
    with _lock:
        if _conn is None or _conn_path != path:
            if _conn is not None:
                _conn.close()
            parent = os.path.dirname(path)
            if parent:
                os.makedirs(parent, exist_ok=True)
            _conn = sqlite3.connect(path, check_same_thread=False, timeout=5.0)
            _conn.row_factory = sqlite3.Row
            _conn.execute("PRAGMA journal_mode=WAL")
            _conn_path = path
        return _conn


def init_db(path: str | None = None) -> None:
    if path:
        os.environ["BUZZ_DB_PATH"] = path
        _reset_for_tests()
    c = connect()
    c.executescript(
        """
        CREATE TABLE IF NOT EXISTS mentions (
          message_id  TEXT    NOT NULL,
          channel_id  TEXT    NOT NULL,
          author_id   TEXT    NOT NULL,
          ticker      TEXT    NOT NULL,
          ts          INTEGER NOT NULL,
          confidence  TEXT    NOT NULL,
          PRIMARY KEY (message_id, ticker)
        );
        CREATE INDEX IF NOT EXISTS idx_mentions_ticker_ts ON mentions(ticker, ts);
        CREATE INDEX IF NOT EXISTS idx_mentions_ts        ON mentions(ts);
        CREATE TABLE IF NOT EXISTS ingest_state (
          channel_id      TEXT PRIMARY KEY,
          last_message_id TEXT    NOT NULL,
          updated_at      INTEGER NOT NULL
        );
        """
    )
    c.commit()


def snowflake_ts(sid: str) -> int:
    """Unix SECONDS for a Discord snowflake."""
    return ((int(sid) >> 22) + DISCORD_EPOCH_MS) // 1000


def record_mentions(rows) -> int:
    rows = list(rows)
    if not rows:
        return 0
    c = connect()
    before = c.total_changes
    c.executemany(
        "INSERT OR IGNORE INTO mentions "
        "(message_id, channel_id, author_id, ticker, ts, confidence) VALUES (?,?,?,?,?,?)",
        rows,
    )
    c.commit()
    return c.total_changes - before


def get_cursor(channel_id: str) -> str | None:
    r = connect().execute(
        "SELECT last_message_id FROM ingest_state WHERE channel_id=?", (channel_id,)
    ).fetchone()
    return r["last_message_id"] if r else None


def set_cursor(channel_id: str, message_id: str) -> None:
    import time
    c = connect()
    c.execute(
        "INSERT INTO ingest_state (channel_id, last_message_id, updated_at) VALUES (?,?,?) "
        "ON CONFLICT(channel_id) DO UPDATE SET last_message_id=excluded.last_message_id, "
        "updated_at=excluded.updated_at",
        (channel_id, str(message_id), int(time.time())),
    )
    c.commit()


def _chan_clause(channels):
    if not channels:
        return "", []
    return " AND channel_id IN (%s)" % ",".join("?" * len(channels)), list(channels)


def board(start_ts: int, end_ts: int, channels, limit: int = 10) -> list[dict]:
    cl, params = _chan_clause(channels)
    sql = (
        "SELECT ticker, COUNT(DISTINCT author_id) AS people, COUNT(*) AS mentions "
        "FROM mentions WHERE ts >= ? AND ts < ?" + cl +
        " GROUP BY ticker ORDER BY people DESC, mentions DESC, ticker ASC LIMIT ?"
    )
    rows = connect().execute(sql, [start_ts, end_ts, *params, limit]).fetchall()
    return [{"ticker": r["ticker"], "people": r["people"], "mentions": r["mentions"]} for r in rows]


def count(ticker: str, start_ts: int, end_ts: int, channels) -> int:
    cl, params = _chan_clause(channels)
    sql = "SELECT COUNT(*) AS n FROM mentions WHERE ticker=? AND ts >= ? AND ts < ?" + cl
    return connect().execute(sql, [ticker, start_ts, end_ts, *params]).fetchone()["n"]


def series(ticker: str, start_ts: int, end_ts: int, buckets: int, channels) -> list[int]:
    out = [0] * buckets
    if end_ts <= start_ts or buckets <= 0:
        return out
    width = (end_ts - start_ts) / buckets
    cl, params = _chan_clause(channels)
    sql = "SELECT ts FROM mentions WHERE ticker=? AND ts >= ? AND ts < ?" + cl
    for r in connect().execute(sql, [ticker, start_ts, end_ts, *params]):
        i = min(buckets - 1, int((r["ts"] - start_ts) / width))
        out[i] += 1
    return out


def known_tickers(prefix: str, limit: int = 25) -> list[tuple[str, int]]:
    p = (prefix or "").upper()
    rows = connect().execute(
        "SELECT ticker, COUNT(*) AS n FROM mentions WHERE ticker LIKE ? "
        "GROUP BY ticker ORDER BY n DESC, ticker ASC LIMIT ?",
        (p + "%", limit),
    ).fetchall()
    return [(r["ticker"], r["n"]) for r in rows]


def latest_ts(channels) -> int | None:
    cl, params = _chan_clause(channels)
    r = connect().execute(
        "SELECT MAX(ts) AS t FROM mentions WHERE 1=1" + cl, params
    ).fetchone()
    return r["t"] if r and r["t"] is not None else None
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /c/Users/Patrick/uct-worktrees/discord-buzz && python -m pytest tests/test_buzz_store.py -v`
Expected: 9 passed. Read the summary line.

- [ ] **Step 5: Commit**

```bash
cd /c/Users/Patrick/uct-worktrees/discord-buzz && \
git add api/services/buzz_store.py tests/test_buzz_store.py && \
git commit -m "feat(buzz): mention store with idempotent writes and resume cursor"
```

---

### Task 2: Symbol universe and derived collision set

**Files:**
- Create: `api/services/buzz_universe.py`
- Create: `api/data/buzz_aliases.json`
- Test: `tests/test_buzz_universe.py`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `symbols() -> frozenset[str]` — uppercase symbols from **both** `cap_universe.json` and `prebuilt_etfs.json`
  - `aliases() -> dict[str, str]` — lowercased company name → ticker
  - `ambiguous() -> frozenset[str]` — symbols that collide with ordinary chat words or house vocabulary
  - `HOUSE_VOCAB: frozenset[str]`

**Why a separate module:** per `lesson_a_symbol_universe_does_not_settle_a_ticker_match`, `cap_universe.json` is a $300M+ equity screen that omits 84 of the 100 names in `prebuilt_etfs.json` and every sub-$300M name. Both must be asked. And the universe genuinely contains `RS`, `EMA`, `MA`, `GAP`, `PEG`, so a universe hit alone can never carry a match.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_buzz_universe.py
"""Buzz universe: both symbol sources, and a collision set that actually collides."""
from __future__ import annotations

from api.services import buzz_universe as u


def test_symbols_include_equities_and_etfs():
    s = u.symbols()
    assert "NVDA" in s
    assert "TQQQ" in s or "SPY" in s, "ETF source not merged"
    assert all(x == x.upper() for x in list(s)[:200])


def test_house_vocabulary_is_marked_ambiguous_even_though_it_is_real_tickers():
    # Every one of these is a genuine listed symbol AND desk vocabulary.
    amb = u.ambiguous()
    for token in ("RS", "EMA", "MA", "GAP", "PEG"):
        assert token in amb, f"{token} must be ambiguous, not a free ticker match"


def test_ordinary_chat_words_that_are_real_tickers_are_ambiguous():
    # Every token here was VERIFIED present in api/data/cap_universe.json on
    # 2026-09-01. Do not add a word without checking it is in the universe --
    # ambiguous() is an intersection, so a non-symbol can never appear in it
    # and the assertion would fail for a reason that has nothing to do with
    # the code under test.
    amb = u.ambiguous()
    for token in ("ALL", "OPEN", "PLAY", "REAL", "CASH", "NOW", "AI", "KEY", "RUN", "LOW"):
        assert token in amb


def test_index_symbols_are_countable_and_unambiguous():
    # The owner named SPX explicitly in the brief. Indices are absent from
    # cap_universe (an EQUITY screen), so they must be added deliberately.
    s, amb = u.symbols(), u.ambiguous()
    for token in ("SPX", "NDX", "VIX"):
        assert token in s
        assert token not in amb


def test_single_letter_symbols_exist_but_are_not_extractable():
    # cap_universe genuinely contains A, B, C ... Z. They are real tickers, so
    # they stay in the universe; the EXTRACTOR floors token length at 2, which
    # kills them structurally rather than by listing each one.
    assert "A" in u.symbols()


def test_unambiguous_names_are_not_in_the_collision_set():
    amb = u.ambiguous()
    for token in ("NVDA", "TSLA", "AMZN", "PLTR", "SMCI", "DELL"):
        assert token not in amb, f"{token} is not an English word; gating it loses real mentions"


def test_aliases_map_company_names_to_tickers():
    a = u.aliases()
    assert a["amazon"] == "AMZN"
    assert a["nvidia"] == "NVDA"
    assert a["tesla"] == "TSLA"
    assert a["dell"] == "DELL"


def test_alias_keys_are_lowercase():
    assert all(k == k.lower() for k in u.aliases())


def test_ambiguous_is_a_subset_of_the_universe():
    # A collision set listing things that are not symbols is not measuring collisions.
    assert u.ambiguous() <= u.symbols()


def test_SPOT_is_deliberately_countable_despite_colliding_with_spot_price():
    """SPOT came out of the same derived chart-vocabulary intersection as LINE,
    BAND, BULL, GAIN and PUMP and is deliberately NOT gated: Spotify is traded
    here, and banishing a traded symbol deletes real mentions permanently while
    a false positive is visible and cheap. The second half is a CONTROL -- without
    it this passes against an emptied HOUSE_VOCAB."""
    assert "SPOT" in u.symbols()
    assert "SPOT" not in u.ambiguous()
    assert "SPOT" not in u.HOUSE_VOCAB
    for gated in ("LINE", "BAND", "BULL", "GAIN", "PUMP"):
        assert gated in u.HOUSE_VOCAB


def test_an_unrecognised_dict_shape_contributes_no_symbols():
    """These files are maintained in another repo, so a shape change is a matter
    of when. Falling back to a dict's KEYS would make 'count' and 'version'
    phantom tickers -- short enough to pass the length filter, absent from every
    vocabulary set, so ambiguous() could never flag them."""
    assert u._syms_from({"version": "1.0", "count": 3742, "generated": "x"}) == set()
    assert u._syms_from({"symbols": ["NVDA", "AMD"]}) == {"NVDA", "AMD"}


def test_a_malformed_universe_file_degrades_to_empty_instead_of_raising(tmp_path, monkeypatch):
    """buzz_boards imports this transitively on the /buzz query path, so a raise
    here takes the command down while an empty set only makes it quiet."""
    (tmp_path / "cap_universe.json").write_text("{not json at all", encoding="utf-8")
    monkeypatch.setattr(u, "_DATA", tmp_path)
    u._reset_caches_for_tests()
    try:
        assert u._load_json("cap_universe.json") is None
        assert isinstance(u.symbols(), frozenset)      # must not raise
    finally:
        u._reset_caches_for_tests()                    # leave no poisoned cache
```

⚠️ **The fail-soft test is only possible with a cache reset.** `symbols()`/`aliases()`/`ambiguous()` are `lru_cache`d for the process lifetime, so a test that points the loader at a bad file otherwise reads whatever was cached first — and would pass vacuously. Add:

```python
def _reset_caches_for_tests() -> None:
    """Drop the lru_caches so a test can change what the loaders see."""
    symbols.cache_clear()
    aliases.cache_clear()
    ambiguous.cache_clear()
    chat_words.cache_clear()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /c/Users/Patrick/uct-worktrees/discord-buzz && python -m pytest tests/test_buzz_universe.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'api.services.buzz_universe'`

- [ ] **Step 3: Create the alias data file**

Company names members actually type. Keys lowercase, values uppercase tickers.

```json
{
  "amazon": "AMZN", "apple": "AAPL", "nvidia": "NVDA", "tesla": "TSLA",
  "microsoft": "MSFT", "google": "GOOGL", "alphabet": "GOOGL", "meta": "META",
  "netflix": "NFLX", "dell": "DELL", "broadcom": "AVGO", "palantir": "PLTR",
  "coinbase": "COIN", "robinhood": "HOOD", "micron": "MU", "intel": "INTC",
  "boeing": "BA", "disney": "DIS", "walmart": "WMT", "costco": "COST",
  "starbucks": "SBUX", "uber": "UBER", "lyft": "LYFT", "airbnb": "ABNB",
  "shopify": "SHOP", "salesforce": "CRM", "oracle": "ORCL", "adobe": "ADBE",
  "qualcomm": "QCOM", "arm": "ARM", "supermicro": "SMCI", "smci": "SMCI",
  "moderna": "MRNA", "pfizer": "PFE", "lilly": "LLY", "novo": "NVO",
  "rocket lab": "RKLB", "rocketlab": "RKLB", "crowdstrike": "CRWD",
  "snowflake": "SNOW", "datadog": "DDOG", "cloudflare": "NET",
  "opendoor": "OPEN", "carvana": "CVNA", "affirm": "AFRM", "sofi": "SOFI",
  "spotify": "SPOT", "roku": "ROKU", "pinterest": "PINS", "snapchat": "SNAP",
  "reddit": "RDDT", "draftkings": "DKNG", "chipotle": "CMG", "nike": "NKE"
}
```

- [ ] **Step 4: Write the implementation**

```python
# api/services/buzz_universe.py
"""Symbol universe, company aliases, and the DERIVED collision set.

Three facts drive this module, all measured (see the spec):
  1. `cap_universe.json` is a $300M+ EQUITY SCREEN, not a symbol list -- 84 of
     the 100 live ETFs are absent from it. Ask both sources.
  2. The universe genuinely contains RS / EMA / MA / GAP / PEG and every single
     letter, so a universe hit CANNOT carry a ticker match by itself.
  3. The mirror-image bug is just as bad: the old #tsdr extractor excluded AI,
     OPEN, PLAY, BIG, REAL, CASH and ALL -- all real, actively traded names.

So collisions are DERIVED (universe INTERSECT chat/house vocabulary), never
typed, and the result is asserted to be a subset of the universe -- a collision
list naming things that are not symbols is not measuring collisions.
"""
from __future__ import annotations

import functools
import json
import os
import pathlib

_HERE = pathlib.Path(__file__).resolve().parents[1]      # api/
_DATA = _HERE / "data"

# Chart / setup / desk vocabulary that is ALSO a listed symbol.
# The second row was DERIVED on 2026-09-01 by intersecting a chart-vocabulary
# candidate list against the real universe -- not typed from memory. Without
# LINE, "RS line reclaiming the EMA" books a mention of LINE (a genuine ticker).
#
# ⛔ SPOT was in that derived intersection and is DELIBERATELY NOT HERE.
# Spotify is a name this room actually trades; "spot" as a word is comparatively
# rare in equity chat. Banishing a symbol members discuss deletes real mentions
# permanently, which is the exact failure mode this whole module exists to
# avoid. When a genuine name collides, tighten tier 4's context requirement --
# never remove the symbol.
HOUSE_VOCAB = frozenset({
    "RS", "EMA", "SMA", "MA", "GAP", "PEG", "EP", "ATH", "ATL", "IPO", "ETF",
    "RSI", "MACD", "VWAP", "HOD", "LOD", "PT", "TP", "SL", "IV", "OI", "DD",
    "LINE", "BAND", "BULL", "GAIN", "PUMP",
})

# Indices. cap_universe.json is an EQUITY SCREEN, so none of these are in it --
# and the owner named SPX explicitly in the brief. They are countable (people
# discuss them constantly) even though they are not tradeable; the earlier
# "indices no" ruling was about CHART CHIPS, where tapping an index opened a
# dead end. Counting a mention has no such dead end.
INDEX_SYMBOLS = frozenset({"SPX", "NDX", "DJI", "RUT", "VIX", "DXY", "IXIC"})

# ⛔ DERIVED, NOT TYPED. Loaded from api/data/buzz_collisions.json, which is
# produced by tools/buzz_derive_collisions.py measuring real chat: a token that
# is a real ticker AND an ordinary word appears mostly in lowercase ("big spot
# to breakout"), one used as a ticker appears mostly uppercase. 77 tokens as of
# 2026-09-01, each carrying its own as_word/as_ticker counts.
#
# Applying it removed 1,927 false mentions from a 7,766-message corpus (16.1% of
# everything booked; contextual tier 2,162 -> 316) while leaving the cashtag tier
# untouched and costing 0.9% of `exact`.
#
# ⛔ DO NOT hand-edit this set or the JSON. An uppercase-by-convention ACRONYM
# (AI, RS, EMA, SMA, MA, DD, OI, RSI, PEG) cannot be separated by casing and
# belongs in HOUSE_VOCAB instead.
@functools.lru_cache(maxsize=1)
def chat_words() -> frozenset[str]:
    payload = _load_json("buzz_collisions.json") or {}
    return frozenset((payload.get("tokens") or {}).keys())


def _load_json(name: str):
    for base in (_DATA, _HERE.parent / "data", pathlib.Path(os.environ.get("UCT_DATA_DIR", ""))):
        if not base or not str(base):
            continue
        p = pathlib.Path(base) / name
        if p.exists():
            try:
                return json.loads(p.read_text(encoding="utf-8"))
            except Exception:  # noqa: BLE001 - a bad file must not take the module down
                return None
    return None


def _syms_from(payload) -> set[str]:
    """Accept the two shapes these files ship in: a list of strings, or a list
    of dicts keyed by sym/ticker/symbol."""
    out: set[str] = set()
    if isinstance(payload, dict):
        # ⛔ NO `or list(payload.keys())` fallback. These files are maintained in
        # another repo; if one ever ships as metadata (`{"version":…, "count":…}`)
        # its KEYS would become phantom symbols -- short enough to pass the length
        # filter, absent from every vocabulary set, so ambiguous() could never
        # flag them, and the extractor would book "count" as a ticker mention.
        # An unrecognised shape yields nothing, which fails LOUDLY (universe size
        # collapses, every extractor rail goes red) instead of silently.
        payload = payload.get("symbols") or payload.get("tickers") or []
    for item in payload or []:
        if isinstance(item, str):
            out.add(item.strip().upper())
        elif isinstance(item, dict):
            v = item.get("sym") or item.get("ticker") or item.get("symbol")
            if v:
                out.add(str(v).strip().upper())
    return {s for s in out if s and len(s) <= 6}


@functools.lru_cache(maxsize=1)
def symbols() -> frozenset[str]:
    s = _syms_from(_load_json("cap_universe.json"))      # 3,742 equities, $300M+
    s |= _syms_from(_load_json("prebuilt_etfs.json"))    # 100 liquid ETFs
    s |= set(INDEX_SYMBOLS)                              # not in either source
    s |= set(aliases().values())                         # a name we alias is a name we know
    return frozenset(s)


@functools.lru_cache(maxsize=1)
def aliases() -> dict[str, str]:
    payload = _load_json("buzz_aliases.json") or {}
    return {str(k).lower(): str(v).upper() for k, v in payload.items()}


@functools.lru_cache(maxsize=1)
def ambiguous() -> frozenset[str]:
    """Symbols that also read as ordinary chat. DERIVED by intersection, so it
    can only ever name things that are genuinely in the universe."""
    return frozenset((chat_words() | HOUSE_VOCAB) & set(symbols()))
```

- [ ] **Step 5: Confirm the universe files (already located — do not go hunting)**

Both files are at `api/data/`, exactly where `_DATA` points. **Measured 2026-09-01, do not re-derive:**

| File | Shape | Count |
|---|---|---|
| `api/data/cap_universe.json` | flat JSON list of strings, first element `"A"` | 3,742 |
| `api/data/prebuilt_etfs.json` | flat JSON list of strings, first element `"SPY"` | 100 |
| merged + indices + alias values | — | ~3,833 |

Verified present in the merged universe: `RS EMA SMA MA GAP PEG ALL OPEN PLAY REAL CASH NOW AI KEY RUN LOW GO A` and `NVDA TSLA AMZN PLTR SMCI DELL SPY MRNA RKLB`.
Verified **absent**: `BIG EV HOME ONE TQQQ` and every index (`SPX NDX VIX` …) — which is why `INDEX_SYMBOLS` exists and why those words are not asserted into the collision set.

Do **not** copy either file anywhere; they are maintained elsewhere and a copy would drift.

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd /c/Users/Patrick/uct-worktrees/discord-buzz && python -m pytest tests/test_buzz_universe.py -v`
Expected: 7 passed.

If `test_unambiguous_names_are_not_in_the_collision_set` fails on `DELL`, a chat word was over-listed — remove it. If `test_ambiguous_is_a_subset_of_the_universe` fails, a universe file did not load; fix the path rather than weakening the assertion.

- [ ] **Step 7: Commit**

```bash
cd /c/Users/Patrick/uct-worktrees/discord-buzz && \
git add api/services/buzz_universe.py api/data/buzz_aliases.json tests/test_buzz_universe.py && \
git commit -m "feat(buzz): symbol universe from both sources + derived collision set"
```

---

### Task 3: The four-tier extractor

**Files:**
- Create: `api/services/buzz_extract.py`
- Test: `tests/test_buzz_extract.py`

**Interfaces:**
- Consumes: `buzz_universe.symbols()`, `.aliases()`, `.ambiguous()`
- Produces: `extract(text: str) -> list[tuple[str, str]]` — `(ticker, confidence)` sorted by ticker, deduplicated; confidence is one of `cashtag` | `alias` | `exact` | `contextual`

**Why this exists:** the current `uct_intelligence/ingestion/ticker_extractor.py` returned **nothing** on six consecutive real `#main-chat` messages, including the all-caps `If DELL doesn't hold`. Those six messages are the fixtures below. They are the acceptance criteria, not illustrations.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_buzz_extract.py
"""Buzz extractor, measured against REAL #main-chat messages captured 2026-09-01.

The six `_REAL_*` cases below are verbatim from the channel. The extractor this
replaces scored 0/6 on them.
"""
from __future__ import annotations

import pytest

from api.services.buzz_extract import extract


def tickers(text):
    return [t for t, _ in extract(text)]


# ── the six real messages that broke the old extractor ───────────────────────

def test_real_mixed_case_bare_name():
    assert "DELL" in tickers("Dell u ok")


def test_real_company_name_in_a_sentence():
    assert "DELL" in tickers("Hold Michael Dell")


def test_real_all_caps_with_no_trading_keyword():
    # The old extractor dropped this: its caps branch required a word like
    # "chart"/"setup"/"breakout" to be present somewhere in the message.
    assert "DELL" in tickers("If DELL doesn't hold, probably means sellers are showing up")


def test_real_prose_with_no_ticker_finds_nothing():
    assert tickers("very different PA from last earnings same great report") == []


def test_real_macro_chatter_finds_nothing():
    got = tickers("Who are these sellers selling to is my broader question. "
                  "Granted volume has been abysmal, HFs are the most deleveraged "
                  "they've been since 2025 April tariff lows")
    assert got == [], f"false positives: {got}"


def test_real_meme_line_finds_nothing():
    assert tickers("i blame the globalists") == []


# ── the owner's own examples from the brief ──────────────────────────────────

@pytest.mark.parametrize("text,want", [
    ("watching Dell here",     "DELL"),
    ("Spy looking heavy",      "SPY"),
    ("Amazon reports tonight", "AMZN"),
    ("mRNA squeezing",         "MRNA"),
    ("SPX 6100 tag",           "SPX"),
])
def test_owner_examples(text, want):
    assert want in tickers(text)


# ── tiers ────────────────────────────────────────────────────────────────────

def test_cashtag_always_wins_even_for_an_ambiguous_symbol():
    assert extract("$OPEN ripping") == [("OPEN", "cashtag")]


def test_bare_lowercase_ambiguous_word_is_never_a_ticker():
    assert tickers("keep it open for now") == []
    assert tickers("that was a big play all day") == []


def test_uppercase_ambiguous_word_is_still_not_a_ticker_without_a_cashtag():
    # People shout in chat. "ALL IN" must not book an Allstate mention.
    assert tickers("I AM ALL IN NOW") == []


def test_house_vocabulary_is_never_a_ticker():
    # "line" matters here: LINE is a genuine listed symbol, so without it in
    # HOUSE_VOCAB this sentence books a LINE mention. Verified 2026-09-01.
    assert tickers("RS line reclaiming the EMA after that GAP") == []


def test_a_real_name_that_collides_with_a_word_is_still_counted():
    # Control for the test above -- it proves the vocabulary gate is a scalpel,
    # not a hammer. SPOT (Spotify) collides with "spot price" and is
    # deliberately NOT gated, because members trade it.
    assert "SPOT" in tickers("SPOT breaking out of the base")


def test_confidence_is_reported_per_tier():
    assert dict(extract("$NVDA")) == {"NVDA": "cashtag"}
    assert dict(extract("Amazon earnings")) == {"AMZN": "alias"}
    assert dict(extract("NVDA breaking out")) == {"NVDA": "exact"}
    assert dict(extract("nvda breaking out")) == {"NVDA": "contextual"}


def test_dedupes_within_one_message_keeping_the_strongest_tier():
    got = dict(extract("$NVDA and NVDA and nvda"))
    assert got == {"NVDA": "cashtag"}


def test_multiple_tickers_in_one_message():
    assert tickers("$NVDA vs AMD today") == ["AMD", "NVDA"]


def test_empty_and_none_are_safe():
    assert extract("") == []
    assert extract(None) == []


def test_urls_do_not_produce_tickers():
    assert tickers("https://example.com/AI/OPEN/ALL") == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /c/Users/Patrick/uct-worktrees/discord-buzz && python -m pytest tests/test_buzz_extract.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'api.services.buzz_extract'`

- [ ] **Step 3: Write the implementation**

```python
# api/services/buzz_extract.py
"""Extract tickers from open Discord chat, by confidence tier.

Measured 2026-09-01: the #tsdr extractor this replaces found NOTHING in six
consecutive real #main-chat messages, because (a) it required ALL CAPS and
(b) its caps branch was gated behind a "trading keyword" check that ordinary
conversation never satisfies. This room writes `Dell`, `Spy`, `Amazon`.

Tiers, strongest first:
  cashtag     $DELL                      -- certain, beats every gate
  alias       "Amazon", "Rocket Lab"     -- curated company names
  exact       DELL (exact case)          -- real symbol, not chat/house vocab
  contextual  Dell / dell                -- case-insensitive, unambiguous only

An ambiguous token (ALL, OPEN, PLAY, AI, RS, EMA ...) is ONLY ever a ticker
with a cashtag. That is deliberate: those are real symbols, so we cannot drop
them from the universe, and they are real words, so we cannot free-match them.
"""
from __future__ import annotations

import re

from api.services import buzz_universe as uni

_RANK = {"cashtag": 0, "alias": 1, "exact": 2, "contextual": 3}

_URL = re.compile(r"https?://\S+|www\.\S+")
_CASHTAG = re.compile(r"\$([A-Za-z]{1,6}(?:\.[A-Za-z]{1,2})?)\b")
_WORD = re.compile(r"\b[A-Za-z][A-Za-z.]{0,5}\b")


def _strongest(found: dict[str, str], ticker: str, tier: str) -> None:
    cur = found.get(ticker)
    if cur is None or _RANK[tier] < _RANK[cur]:
        found[ticker] = tier


def extract(text: str | None) -> list[tuple[str, str]]:
    if not text:
        return []

    # URLs carry path segments that look exactly like tickers.
    text = _URL.sub(" ", text)

    symbols = uni.symbols()
    aliases = uni.aliases()
    ambiguous = uni.ambiguous()
    found: dict[str, str] = {}

    # Tier 1 -- cashtag. Beats every gate, including ambiguity.
    for m in _CASHTAG.finditer(text):
        sym = m.group(1).upper()
        if sym in symbols:
            _strongest(found, sym, "cashtag")

    # Tier 2 -- company aliases. Longest first so "rocket lab" wins over "lab".
    low = text.lower()
    for name in sorted(aliases, key=len, reverse=True):
        if re.search(r"\b" + re.escape(name) + r"\b", low):
            _strongest(found, aliases[name], "alias")

    # Tiers 3 and 4 -- bare words.
    for m in _WORD.finditer(text):
        raw = m.group(0).strip(".")
        if len(raw) < 2:
            continue
        sym = raw.upper()
        if sym not in symbols or sym in ambiguous:
            continue
        _strongest(found, sym, "exact" if raw == sym else "contextual")

    return sorted(found.items())
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /c/Users/Patrick/uct-worktrees/discord-buzz && python -m pytest tests/test_buzz_extract.py -v`
Expected: all passed.

If `test_real_macro_chatter_finds_nothing` fails, read the false positives it prints — each one is a genuine collision that belongs in `CHAT_WORDS` in Task 2, **not** a reason to loosen the assertion.

- [ ] **Step 5: Commit**

```bash
cd /c/Users/Patrick/uct-worktrees/discord-buzz && \
git add api/services/buzz_extract.py tests/test_buzz_extract.py && \
git commit -m "feat(buzz): four-tier chat ticker extractor, railed on real #main-chat messages"
```

---

### Task 4: Ingest poller with gap-free resume

**Files:**
- Create: `api/services/buzz_ingest.py`
- Test: `tests/test_buzz_ingest.py`

**Interfaces:**
- Consumes: `buzz_store`, `buzz_extract.extract`
- Produces:
  - `ingest_enabled() -> bool`
  - `channels() -> list[str]`
  - `fetch_messages(channel_id, *, after=None, before=None, limit=100, http=None) -> list[dict]`
  - `ingest_messages(channel_id: str, messages: list[dict]) -> tuple[int, str | None]` — `(rows_written, newest_message_id)`
  - `poll_once(channel_id: str, *, fetch_fn=None) -> dict` — `{"fetched", "rows", "cursor"}`
  - `backfill(channel_id: str, days: int, *, fetch_fn=None, progress=None) -> dict`

**Design note — this is the reason the whole feature polls instead of using a gateway:** the cursor is persisted **after** the rows are written, so a crash between fetch and write re-fetches that window rather than skipping it, and the store's composite primary key absorbs the duplicate. Gap-free by construction.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_buzz_ingest.py
"""Buzz ingest: extraction wiring, bot filtering, resume, idempotency."""
from __future__ import annotations

import pytest


@pytest.fixture()
def mods(tmp_path, monkeypatch):
    monkeypatch.setenv("BUZZ_DB_PATH", str(tmp_path / "buzz.db"))
    monkeypatch.setenv("BUZZ_CHANNELS", "CH1")
    from api.services import buzz_store, buzz_ingest
    buzz_store._reset_for_tests()
    buzz_store.init_db()
    return buzz_store, buzz_ingest


def _msg(mid, author, content, bot=False):
    return {"id": str(mid), "content": content,
            "author": {"id": author, "bot": bot}}


def test_ingest_writes_one_row_per_ticker(mods):
    store, ing = mods
    rows, newest = ing.ingest_messages("CH1", [
        _msg(1000, "alice", "$NVDA and AMD look good"),
    ])
    assert rows == 2
    assert newest == "1000"


def test_bot_messages_are_skipped(mods):
    store, ing = mods
    rows, _ = ing.ingest_messages("CH1", [_msg(1000, "botty", "$NVDA", bot=True)])
    assert rows == 0


def test_empty_content_is_skipped(mods):
    store, ing = mods
    rows, _ = ing.ingest_messages("CH1", [_msg(1000, "alice", "")])
    assert rows == 0


def test_newest_id_is_the_max_not_the_last(mods):
    # Discord returns newest-first; never trust list order for the cursor.
    store, ing = mods
    _, newest = ing.ingest_messages("CH1", [
        _msg(3000, "a", "$NVDA"), _msg(1000, "b", "$AMD"), _msg(2000, "c", "$SPY"),
    ])
    assert newest == "3000"


def test_reingesting_the_same_messages_writes_nothing_new(mods):
    store, ing = mods
    msgs = [_msg(1000, "alice", "$NVDA")]
    assert ing.ingest_messages("CH1", msgs)[0] == 1
    assert ing.ingest_messages("CH1", msgs)[0] == 0


def test_poll_once_advances_the_cursor_only_after_writing(mods):
    store, ing = mods
    calls = []

    def fake_fetch(channel_id, *, after=None, before=None, limit=100, http=None):
        calls.append(after)
        return [_msg(5000, "alice", "$NVDA")] if after is None else []

    first = ing.poll_once("CH1", fetch_fn=fake_fetch)
    assert first["rows"] == 1
    assert store.get_cursor("CH1") == "5000"

    second = ing.poll_once("CH1", fetch_fn=fake_fetch)
    assert second["rows"] == 0
    assert calls == [None, "5000"], "second poll must resume from the stored cursor"


def test_a_write_failure_leaves_the_cursor_untouched(mods):
    """The gap-free property: if the write blows up, the next poll re-fetches
    the same window instead of skipping it."""
    store, ing = mods

    def fake_fetch(channel_id, **kw):
        return [_msg(5000, "alice", "$NVDA")]

    def boom(*a, **k):
        raise RuntimeError("disk full")

    orig = store.record_mentions
    store.record_mentions = boom
    try:
        with pytest.raises(RuntimeError):
            ing.poll_once("CH1", fetch_fn=fake_fetch)
    finally:
        store.record_mentions = orig
    assert store.get_cursor("CH1") is None


def test_backfill_walks_backwards_and_stops_at_the_cutoff(mods):
    store, ing = mods
    # snowflakes descending; the oldest is far outside the window
    pages = {
        None:     [_msg(1544451055910129726, "a", "$NVDA")],
        "1544451055910129726": [_msg(1200000000000000000, "b", "$AMD")],  # ancient
    }

    def fake_fetch(channel_id, *, after=None, before=None, limit=100, http=None):
        return pages.get(before, [])

    out = ing.backfill("CH1", days=30, fetch_fn=fake_fetch)
    assert out["rows"] >= 1
    assert out["pages"] <= 3, "must stop once messages fall outside the window"


def test_channels_reads_the_env(mods, monkeypatch):
    _, ing = mods
    monkeypatch.setenv("BUZZ_CHANNELS", "A, B ,C")
    assert ing.channels() == ["A", "B", "C"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /c/Users/Patrick/uct-worktrees/discord-buzz && python -m pytest tests/test_buzz_ingest.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'api.services.buzz_ingest'`

- [ ] **Step 3: Write the implementation**

```python
# api/services/buzz_ingest.py
"""Poll #main-chat for new messages and record ticker mentions.

Polling, not a gateway, and that is the CORRECT choice here rather than the
lazy one. Measured 2026-09-01: `GET /channels/{id}/messages` returns full
content for other users' messages, so no MESSAGE_CONTENT privileged intent is
needed. And the stored snowflake makes ingest gap-free across a deploy -- `web`
redeploys on every push to master, and a gateway would silently drop every
message during each ~2 minute swap.

⛔ The cursor advances only AFTER the rows are committed. A crash in between
re-fetches that window on the next poll; the store's composite primary key
absorbs the duplicate. Advancing first would lose messages permanently.
"""
from __future__ import annotations

import logging
import os
import time

from api.services import buzz_extract, buzz_store

log = logging.getLogger(__name__)

DEFAULT_CHANNEL = "1216816863313657886"      # #main-chat, Uncharted Territory
API = "https://discord.com/api/v10"
PAGE = 100
BACKFILL_PAGE_PAUSE_S = 0.25                 # measured bucket limit is 5 req/s


def ingest_enabled() -> bool:
    return os.environ.get("BUZZ_INGEST_ENABLED", "1").strip().lower() not in ("0", "false", "off", "")


def channels() -> list[str]:
    raw = os.environ.get("BUZZ_CHANNELS", "").strip()
    if not raw:
        return [DEFAULT_CHANNEL]
    return [c.strip() for c in raw.split(",") if c.strip()]


def _token() -> str:
    return os.environ.get("DISCORD_BOT_TOKEN", "").strip()


def fetch_messages(channel_id: str, *, after=None, before=None, limit: int = PAGE, http=None) -> list[dict]:
    """One page of messages, newest first. Returns [] on any failure."""
    import httpx
    params: dict = {"limit": limit}
    if after:
        params["after"] = str(after)
    if before:
        params["before"] = str(before)
    own = http is None
    c = http or httpx.Client(timeout=20.0)
    try:
        r = c.get(f"{API}/channels/{channel_id}/messages",
                  params=params, headers={"Authorization": f"Bot {_token()}"})
        if r.status_code == 429:
            time.sleep(float(r.headers.get("retry-after", "1")))
            return []
        if not r.is_success:
            log.warning("[buzz] fetch HTTP %s for %s: %s", r.status_code, channel_id, r.text[:160])
            return []
        return r.json()
    except Exception as e:  # noqa: BLE001
        log.warning("[buzz] fetch failed for %s: %s", channel_id, e)
        return []
    finally:
        if own:
            c.close()


def ingest_messages(channel_id: str, messages: list[dict]) -> tuple[int, str | None]:
    rows: list[tuple] = []
    newest: int | None = None
    for m in messages or []:
        mid = str(m.get("id") or "")
        if not mid:
            continue
        newest = max(newest or 0, int(mid))
        author = m.get("author") or {}
        if author.get("bot"):
            continue
        content = (m.get("content") or "").strip()
        if not content:
            continue
        ts = buzz_store.snowflake_ts(mid)
        for ticker, confidence in buzz_extract.extract(content):
            rows.append((mid, channel_id, str(author.get("id") or ""), ticker, ts, confidence))
    written = buzz_store.record_mentions(rows)
    return written, (str(newest) if newest is not None else None)


def poll_once(channel_id: str, *, fetch_fn=None) -> dict:
    fetch = fetch_fn or fetch_messages
    cursor = buzz_store.get_cursor(channel_id)
    msgs = fetch(channel_id, after=cursor, limit=PAGE)
    written, newest = ingest_messages(channel_id, msgs)      # raises => cursor untouched
    if newest:
        buzz_store.set_cursor(channel_id, newest)
    return {"fetched": len(msgs or []), "rows": written, "cursor": newest or cursor}


def backfill(channel_id: str, days: int = 30, *, fetch_fn=None, progress=None) -> dict:
    """Walk the channel backwards until messages fall outside the window."""
    fetch = fetch_fn or fetch_messages
    cutoff = int(time.time()) - days * 86400
    before = None
    total = pages = fetched = 0
    newest_seen: int | None = None
    while True:
        msgs = fetch(channel_id, before=before, limit=PAGE)
        if not msgs:
            break
        pages += 1
        fetched += len(msgs)
        written, newest = ingest_messages(channel_id, msgs)
        total += written
        if newest:
            newest_seen = max(newest_seen or 0, int(newest))
        oldest = min(int(m["id"]) for m in msgs)
        before = str(oldest)
        if progress:
            progress(pages, fetched, total)
        if buzz_store.snowflake_ts(str(oldest)) < cutoff:
            break
        if fetch_fn is None:
            time.sleep(BACKFILL_PAGE_PAUSE_S)
    if newest_seen and not buzz_store.get_cursor(channel_id):
        buzz_store.set_cursor(channel_id, str(newest_seen))
    return {"pages": pages, "fetched": fetched, "rows": total}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /c/Users/Patrick/uct-worktrees/discord-buzz && python -m pytest tests/test_buzz_ingest.py -v`
Expected: 9 passed.

- [ ] **Step 5: Wire the poll job into the scheduler**

Modify `api/main.py`. Add near `_discord_chart_hot_warm` (around line 737):

```python
BUZZ_POLL_INTERVAL_S = int(os.environ.get("BUZZ_POLL_INTERVAL_S", "60"))


def _buzz_poll() -> None:
    """Pull new #main-chat messages and record ticker mentions. Cheap: one HTTP
    call per channel per minute, and the cursor makes it gap-free across a
    deploy."""
    log = logging.getLogger(__name__)
    try:
        from api.services import buzz_ingest, buzz_store
        if not buzz_ingest.ingest_enabled():
            return
        buzz_store.init_db()
        for ch in buzz_ingest.channels():
            out = buzz_ingest.poll_once(ch)
            if out["rows"]:
                log.info("[buzz] %s: %d message(s), %d mention(s)",
                         ch, out["fetched"], out["rows"])
    except Exception as e:  # noqa: BLE001 - never take the scheduler down
        log.warning("[buzz] poll error: %s", e)
```

Then register it beside the other `scheduler.add_job` calls (follow the shape used for the live scan sweep around line 1502):

```python
    from apscheduler.triggers.interval import IntervalTrigger as _BuzzInterval
    scheduler.add_job(
        _buzz_poll,
        trigger=_BuzzInterval(seconds=BUZZ_POLL_INTERVAL_S),
        id="buzz_poll", replace_existing=True, misfire_grace_time=60,
        max_instances=1,
    )
```

⛔ **`max_instances=1` is load-bearing, not decoration.** `buzz_store` caches ONE
module-level connection, and `record_mentions` measures its insert count as a
`total_changes` delta on that shared handle. Two overlapping poll runs would
interleave on the same connection and corrupt each other's count. It is also the
guard that keeps the poller the single sequential writer the store is designed
around. The Task 1 reviewer flagged the unguarded delta; this is where it is
actually solved — a lock inside the store would serialise the arithmetic but
still allow two concurrent polls to double-fetch the same window.

- [ ] **Step 6: Verify the job is registered**

Run: `cd /c/Users/Patrick/uct-worktrees/discord-buzz && python -m pytest tests/ -k "scheduler or main_jobs" -v`
Expected: existing scheduler rails still pass. If a rail asserts an exact job-id list, add `buzz_poll` to it.

- [ ] **Step 7: Commit**

```bash
cd /c/Users/Patrick/uct-worktrees/discord-buzz && \
git add api/services/buzz_ingest.py tests/test_buzz_ingest.py api/main.py && \
git commit -m "feat(buzz): gap-free ingest poller + scheduler job"
```

---

### Task 5: Permission probe, backfill tool, and corpus measurement

**Files:**
- Create: `tools/buzz_perms.py`
- Create: `tools/buzz_backfill.py`
- Create: `tools/buzz_collisions.py`

**Interfaces:**
- Consumes: `buzz_ingest.backfill`, `buzz_store`, `buzz_extract`, `buzz_universe`
- Produces: three CLIs. No importable API.

**This task has TWO halves, and only the second is blocked.**

### Half A — collision derivation. NOT blocked. Do this first.

There is a real corpus on disk that needs no permission: `uct_intelligence/data/processed/processed_messages.json` — **7,766 genuine Discord messages** from this community's `#tsdr`. It is the wrong corpus for a *baseline* (one disciplined trader, not the room) but the right one for **precision**: any token it books that is not a stock is a genuine collision.

**Measured 2026-09-01, and it changed the design.** Running the extractor over those 7,766 messages booked 11,967 mentions, of which the `contextual` tier alone contributed 2,162 — and its top entries were almost entirely English:

```
SPOT 277 ("big spot to breakout")   IMO 157   BIT 151 ("little bit of")
LOT  150 ("lot of heavy moves")     WAY 149   POST 125   TWO 101   JAN 59
```

⛔ **A hand-written stopword list cannot fix this class.** Every common English word that is also a ticker will fire, and there are hundreds. The fix has to be derived.

**The derivation rule — and it is fully measurable:** a token that is a real ticker *and* an ordinary word appears in chat mostly in **lowercase**; a token used as a ticker appears mostly **uppercase**. So for each symbol, count its uppercase vs non-uppercase occurrences in the corpus. Below 35% uppercase (with ≥8 occurrences) it is a word.

That produced `api/data/buzz_collisions.json` — **77 tokens, each carrying its own evidence**:

```json
"SPOT": {"as_word": 308, "as_ticker": 39, "upper_pct": 11.2}
"OPEN": {"as_word": 280, "as_ticker": 49, "upper_pct": 14.9}
"GAP":  {"as_word": 355, "as_ticker":  7, "upper_pct":  1.9}
```

**Measured effect of applying it** (same corpus, before → after):

| tier | before | after | |
|---|---|---|---|
| `contextual` | 2,162 | **316** | −85% |
| `exact` | 9,205 | 9,124 | −0.9% |
| `cashtag` | 258 | **258** | untouched |

**1,927 false mentions removed — 16.1% of everything the extractor was booking**, with the cashtag tier not moved at all and under 1% collateral on `exact`.

⭐ **This overturned an earlier ruling of mine.** I had ruled that `SPOT` must stay ungated because "Spotify is a name this room trades." The corpus says 11% uppercase. I was wrong, and only real data could show it — which is the whole argument for this half of the task.

**What casing CANNOT separate:** uppercase-by-convention acronyms — `AI`, `RS`, `EMA`, `SMA`, `MA`, `DD`, `OI`, `RSI`, `PEG`. Those stay hand-curated in `HOUSE_VOCAB`. The derived file is for words; the hand list is for acronyms. Do not merge them.

### Half B — the `#main-chat` backfill. BLOCKED.

**Blocked until the owner grants the `UCT Intelligence` role View Channel on `#main-chat`.** Measured 2026-09-01: the bot reads 3 of 70 channels and `#main-chat` is not one of them. **Run `tools/buzz_perms.py` first every time** — an empty backfill with no permission looks exactly like an empty backfill with a broken extractor, and that ambiguity will cost hours.

When it lands, re-run the derivation against main-chat and **regenerate `buzz_collisions.json` from that corpus instead** — `#main-chat` is casual where `#tsdr` is disciplined, so it will surface collisions this corpus cannot. Half A's output is the floor, not the ceiling.

- [ ] **Step 1: Write the permission probe**

```python
# tools/buzz_perms.py
"""Can the bot actually read the channels we intend to count? Read-only.

Run this BEFORE concluding that an empty ingest is a code bug.
Usage: python tools/buzz_perms.py
"""
from __future__ import annotations

import os
import sys

import requests
from dotenv import load_dotenv

load_dotenv()
TOKEN = os.environ.get("DISCORD_BOT_TOKEN", "").strip()
GUILD = os.environ.get("DISCORD_GUILD_ID", "882293203485720596").strip()
H = {"Authorization": f"Bot {TOKEN}"}
B = "https://discord.com/api/v10"
VIEW, HIST, ADMIN = 1 << 10, 1 << 16, 1 << 3


def main() -> int:
    if not TOKEN:
        print("DISCORD_BOT_TOKEN not set")
        return 2
    me = requests.get(f"{B}/users/@me", headers=H).json()
    member = requests.get(f"{B}/guilds/{GUILD}/members/{me['id']}", headers=H).json()
    my_roles = set(member.get("roles") or [])
    roles = {r["id"]: r for r in requests.get(f"{B}/guilds/{GUILD}/roles", headers=H).json()}

    base = int(roles.get(GUILD, {}).get("permissions", 0))
    for rid in my_roles:
        base |= int(roles[rid]["permissions"]) if rid in roles else 0
    is_admin = bool(base & ADMIN)

    chans = requests.get(f"{B}/guilds/{GUILD}/channels", headers=H).json()
    from api.services import buzz_ingest
    wanted = set(buzz_ingest.channels())

    bad = 0
    for ch in chans:
        if ch["id"] not in wanted:
            continue
        perms = VIEW | HIST if is_admin else base
        if not is_admin:
            ows = {o["id"]: o for o in ch.get("permission_overwrites") or []}
            ev = ows.get(GUILD)
            if ev:
                perms &= ~int(ev["deny"]); perms |= int(ev["allow"])
            d = a = 0
            for rid in my_roles:
                if rid in ows:
                    d |= int(ows[rid]["deny"]); a |= int(ows[rid]["allow"])
            perms &= ~d; perms |= a
        ok = bool(perms & VIEW) and bool(perms & HIST)
        print(f"  [{'READ' if ok else 'BLIND'}] #{ch['name']}  id={ch['id']}")
        if not ok:
            bad += 1
    if bad:
        print(f"\n{bad} wanted channel(s) NOT readable.")
        print("FIX (owner only -- the bot holds no MANAGE_ROLES):")
        print("  Channel Settings -> Permissions -> Add members or roles -> 'UCT Intelligence'")
        print("  Do NOT click 'Sync Now' -- it overwrites the channel's own overwrites.")
        return 1
    print("\nAll wanted channels readable.")
    return 0


if __name__ == "__main__":
    sys.path.insert(0, os.getcwd())
    raise SystemExit(main())
```

- [ ] **Step 2: Run the probe**

Run: `cd /c/Users/Patrick/uct-worktrees/discord-buzz && python tools/buzz_perms.py`
Expected while blocked: `[BLIND] #💬丨main-chat` and exit 1.
**Do not continue past this step until it prints `READ` and exits 0.**

- [ ] **Step 3: Write the backfill CLI**

```python
# tools/buzz_backfill.py
"""One-time 30-day backfill of #main-chat mentions.

Usage: python tools/buzz_backfill.py [--days 30] [--channel <id>] [--dry-run]
"""
from __future__ import annotations

import argparse
import os
import sys
import time


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=30)
    ap.add_argument("--channel", default="")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    from dotenv import load_dotenv
    load_dotenv()
    from api.services import buzz_ingest, buzz_store

    buzz_store.init_db()
    chans = [args.channel] if args.channel else buzz_ingest.channels()
    t0 = time.time()
    for ch in chans:
        print(f"backfilling {ch} for {args.days} day(s)...")

        def progress(pages, fetched, rows):
            print(f"   page {pages:>4}  messages {fetched:>6}  mentions {rows:>6}", end="\r")

        if args.dry_run:
            page = buzz_ingest.fetch_messages(ch, limit=5)
            print(f"   dry run: {len(page)} message(s) readable")
            continue
        out = buzz_ingest.backfill(ch, days=args.days, progress=progress)
        print(f"\n   {out['pages']} pages, {out['fetched']} messages, {out['rows']} mentions")
    print(f"done in {time.time() - t0:.1f}s")
    return 0


if __name__ == "__main__":
    sys.path.insert(0, os.getcwd())
    raise SystemExit(main())
```

- [ ] **Step 4: Run the backfill**

Run: `cd /c/Users/Patrick/uct-worktrees/discord-buzz && python tools/buzz_backfill.py --dry-run`
Then, if it reads messages: `python tools/buzz_backfill.py --days 30`
Expected: roughly 400-900 pages at ~4 pages/sec, a few minutes.

- [ ] **Step 5: Write the collision measurement tool**

This is the step that turns the extractor from a guess into a measurement.

```python
# tools/buzz_collisions.py
"""What did the extractor actually book, and what does the corpus say is junk?

Prints the most-counted tickers by tier. Anything at the top of the
`contextual` or `exact` list that is NOT a stock is a collision that belongs in
buzz_universe.CHAT_WORDS. The junk this prints IS the stopword list.

Usage: python tools/buzz_collisions.py [--top 40]
"""
from __future__ import annotations

import argparse
import collections
import os
import sys


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--top", type=int, default=40)
    args = ap.parse_args()

    from dotenv import load_dotenv
    load_dotenv()
    from api.services import buzz_store, buzz_universe

    c = buzz_store.connect()
    rows = c.execute(
        "SELECT ticker, confidence, COUNT(*) n FROM mentions GROUP BY ticker, confidence"
    ).fetchall()

    by_tier = collections.defaultdict(collections.Counter)
    for r in rows:
        by_tier[r["confidence"]][r["ticker"]] = r["n"]

    for tier in ("cashtag", "alias", "exact", "contextual"):
        print(f"\n=== {tier} ===")
        for tick, n in by_tier[tier].most_common(args.top):
            print(f"  {tick:<8} {n:>6}")

    print("\n=== already gated as ambiguous (for reference) ===")
    print("  " + " ".join(sorted(buzz_universe.ambiguous())))
    print("\nREVIEW: any non-stock at the top of exact/contextual is a collision.")
    print("Add it to buzz_universe.CHAT_WORDS, re-run the extractor tests, re-backfill.")
    return 0


if __name__ == "__main__":
    sys.path.insert(0, os.getcwd())
    raise SystemExit(main())
```

- [ ] **Step 6: Measure, then tighten**

Run: `cd /c/Users/Patrick/uct-worktrees/discord-buzz && python tools/buzz_collisions.py --top 40`

Read the `exact` and `contextual` lists. For each non-stock token near the top:
1. Add it to `CHAT_WORDS` in `api/services/buzz_universe.py`
2. Add a case to `tests/test_buzz_extract.py` using a **real sentence from the corpus** that produced it
3. Re-run `python -m pytest tests/test_buzz_extract.py -v`
4. `python tools/buzz_backfill.py --days 30` again (idempotent — it will only correct, never double-count)

Repeat until the top of each list is all real tickers.

- [ ] **Step 7: Commit**

```bash
cd /c/Users/Patrick/uct-worktrees/discord-buzz && \
git add tools/buzz_perms.py tools/buzz_backfill.py tools/buzz_collisions.py \
        api/services/buzz_universe.py tests/test_buzz_extract.py && \
git commit -m "feat(buzz): perms probe, backfill CLI, corpus-derived collision tightening"
```

---

### Task 6: Boards — people ranking and heat score

**Files:**
- Create: `api/services/buzz_boards.py`
- Test: `tests/test_buzz_boards.py`

**Interfaces:**
- Consumes: `buzz_store`
- Produces:
  - `window_bounds(name: str, now: int, tz=_ET) -> tuple[int, int]` — names: `open` | `today` | `noon` | `week` | `month`
  - `top_board(window: str, now: int, limit: int = 5) -> list[dict]` — `{"ticker","people","mentions","spark":[int]}`
  - `full_board(window: str, now: int) -> list[dict]` — **every** ticker in the window, ranked, no limit (owner: "honestly want every ticker mentioned")
  - `split_tail(rows: list[dict]) -> tuple[list[dict], list[str]]` — the tail after the ranked head, split into `(multi, singles)`: names mentioned 2+ times keep their counts, names mentioned exactly once return as bare tickers for a compressed final line

**⛔ The tail is RANKED, not grouped.** Theme grouping was built, rendered and rejected — see Task 8. Rank order needs no taxonomy join, no threshold constant, and cannot fragment. `split_tail` exists only to keep the once-mentioned names from occupying a third of the image.
  - `heat_board(now: int, limit: int = 4, sessions: int = 30) -> list[dict]` — `{"ticker","mentions","ratio"}`
  - `ticker_detail(ticker: str, window: str, now: int) -> dict`
  - `coverage(now: int) -> str` — e.g. `"counted through 3:58p"`
  - `totals(window: str, now: int) -> dict` — `{"messages", "members", "tickers"}` for the board header
  - `MIN_CURRENT: int`, `MIN_BASELINE: float`

**The two things that decide whether this board is trusted:**

1. **Matched denominator.** Today-so-far vs a 30-day *daily* average is apples to oranges at 09:45 — everything reads cold. Compare same-elapsed-session to same-elapsed-session.
2. **A volume floor.** 1 mention in 30 days then 3 today is "3x" and means nothing.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_buzz_boards.py
"""Buzz boards: people ranking, and the two heat-score traps."""
from __future__ import annotations

import datetime as dt

import pytest

ET = dt.timezone(dt.timedelta(hours=-4))
CH = "CH1"


@pytest.fixture()
def mods(tmp_path, monkeypatch):
    monkeypatch.setenv("BUZZ_DB_PATH", str(tmp_path / "buzz.db"))
    monkeypatch.setenv("BUZZ_CHANNELS", CH)
    from api.services import buzz_store, buzz_boards
    buzz_store._reset_for_tests()
    buzz_store.init_db()
    return buzz_store, buzz_boards


def _at(day, hour, minute=0):
    return int(dt.datetime(2026, 9, day, hour, minute, tzinfo=ET).timestamp())


def _put(store, ts, ticker, author, mid):
    store.record_mentions([(str(mid), CH, author, ticker, ts, "exact")])


def test_top_board_ranks_by_people_not_raw_mentions(mods):
    store, boards = mods
    now = _at(1, 15)
    for i in range(30):                        # one loud member, 30 messages
        _put(store, _at(1, 10), "LOUD", "spammer", 1000 + i)
    for i, who in enumerate("abcdefgh"):       # eight members, one each
        _put(store, _at(1, 10), "REAL", who, 2000 + i)
    board = boards.top_board("open", now, limit=2)
    assert board[0]["ticker"] == "REAL", "8 people must outrank 1 person x30"
    assert board[0]["people"] == 8
    assert board[1]["ticker"] == "LOUD"
    assert board[1]["mentions"] == 30


def test_top_board_carries_a_sparkline(mods):
    store, boards = mods
    _put(store, _at(1, 10), "NVDA", "a", 1)
    _put(store, _at(1, 14), "NVDA", "b", 2)
    row = boards.top_board("open", _at(1, 15), limit=1)[0]
    assert isinstance(row["spark"], list) and len(row["spark"]) >= 4
    assert sum(row["spark"]) == 2


# ── heat-score fixtures ──────────────────────────────────────────────────────
#
# ⛔ These seed the WEEKDAYS heat_board actually walks, not calendar days. An
# earlier draft of this plan seeded Sept 1-20 (14 weekdays) against a 30-session
# baseline reaching back to Aug 10, giving base = 14/30 = 0.47 -- below
# MIN_BASELINE -- while today's 4 mentions sat below MIN_CURRENT=5. It failed
# BOTH gates and could never have passed. Compute the arithmetic, don't eyeball it.

def _prior_weekdays(now_dt, n):
    """The same days `_prior_session_days` walks: weekdays only, going back."""
    out, d = [], now_dt
    while len(out) < n:
        d = d - dt.timedelta(days=1)
        if d.weekday() < 5:
            out.append(d)
    return out


def _seed_baseline(store, now_dt, ticker, per_session, sessions=30,
                   at_hour=9, at_min=40, mid=100000):
    """`per_session` mentions just after the open on each of the last
    `sessions` weekdays -> baseline == per_session exactly."""
    for d in _prior_weekdays(now_dt, sessions):
        ts = int(d.replace(hour=at_hour, minute=at_min, second=0,
                           microsecond=0).timestamp())
        for _ in range(per_session):
            _put(store, ts, ticker, f"u{mid}", mid)
            mid += 1
    return mid


def test_heat_uses_a_MATCHED_denominator_not_a_daily_average(mods):
    """THE trap. PLTR normally has 2 mentions by 09:45 and ~32 across a full
    day. Today it has 8 by 09:45.

      matched denominator (correct): 8 / 2   = 4.0x  -> HOT
      daily-average denominator     : 8 / 32  = 0.25x -> reads stone cold

    The afternoon mentions exist purely to make those two answers disagree.
    """
    store, boards = mods
    now_dt = dt.datetime(2026, 9, 21, 9, 45, tzinfo=ET)   # Monday, 15 min in
    now = int(now_dt.timestamp())

    mid = _seed_baseline(store, now_dt, "PLTR", per_session=2)   # 2 by 09:45
    for d in _prior_weekdays(now_dt, 30):                        # +30 each afternoon
        ts = int(d.replace(hour=14, minute=0, second=0, microsecond=0).timestamp())
        for _ in range(30):
            _put(store, ts, "PLTR", f"v{mid}", mid); mid += 1

    for k in range(8):                                           # today: 8 by 09:45
        _put(store, _at(21, 9, 40), "PLTR", f"t{k}", mid); mid += 1

    rows = {r["ticker"]: r for r in boards.heat_board(now, sessions=30)}
    assert "PLTR" in rows, "a matched denominator must see this as hot"
    assert rows["PLTR"]["ratio"] == 4.0, rows["PLTR"]


def test_heat_control_a_busy_but_NORMAL_name_is_not_flagged(mods):
    """The control that proves the test above can fail. Same volume as a hot
    name (6 today, clears MIN_CURRENT), but 6 is exactly its normal -> ratio
    1.0, so it must NOT appear. If this ever passes trivially, the heat board
    is measuring volume, not surprise."""
    store, boards = mods
    now_dt = dt.datetime(2026, 9, 21, 9, 45, tzinfo=ET)
    now = int(now_dt.timestamp())

    mid = _seed_baseline(store, now_dt, "CALM", per_session=6)
    for k in range(6):
        _put(store, _at(21, 9, 40), "CALM", f"t{k}", mid); mid += 1

    assert "CALM" not in {r["ticker"] for r in boards.heat_board(now, sessions=30)}


def test_heat_volume_floor_rejects_a_loud_ratio_on_a_tiny_count(mods):
    """1 mention on each of 30 sessions, then 3 today, is 'below normal' -- but
    even a 10x on 3 mentions is noise. cur < MIN_CURRENT excludes it."""
    store, boards = mods
    now_dt = dt.datetime(2026, 9, 21, 9, 45, tzinfo=ET)
    now = int(now_dt.timestamp())

    mid = _seed_baseline(store, now_dt, "NOISE", per_session=1)
    for k in range(3):                                   # 3 < MIN_CURRENT (5)
        _put(store, _at(21, 9, 40), "NOISE", f"t{k}", mid); mid += 1

    assert "NOISE" not in {r["ticker"] for r in boards.heat_board(now, sessions=30)}


def test_heat_baseline_floor_rejects_a_name_with_no_real_history(mods):
    """Clears the volume gate (8 today) but has almost no baseline: seen on
    only 6 of the last 30 sessions -> base 0.2, under MIN_BASELINE. '40x normal'
    off a base that thin is an artifact, not a signal."""
    store, boards = mods
    now_dt = dt.datetime(2026, 9, 21, 9, 45, tzinfo=ET)
    now = int(now_dt.timestamp())

    mid = _seed_baseline(store, now_dt, "THIN", per_session=1, sessions=6)
    for k in range(8):
        _put(store, _at(21, 9, 40), "THIN", f"t{k}", mid); mid += 1

    assert "THIN" not in {r["ticker"] for r in boards.heat_board(now, sessions=30)}


def test_window_bounds_open_starts_at_the_market_open(mods):
    _, boards = mods
    start, end = boards.window_bounds("open", _at(1, 15))
    assert dt.datetime.fromtimestamp(start, ET).hour == 9
    assert dt.datetime.fromtimestamp(start, ET).minute == 30
    assert end == _at(1, 15)


def test_window_bounds_noon(mods):
    _, boards = mods
    start, _ = boards.window_bounds("noon", _at(1, 15))
    assert dt.datetime.fromtimestamp(start, ET).hour == 12


def test_coverage_says_how_fresh_the_count_is(mods):
    store, boards = mods
    _put(store, _at(1, 14, 58), "NVDA", "a", 1)
    assert "2:58" in boards.coverage(_at(1, 15)) or "14:58" in boards.coverage(_at(1, 15))


def test_ticker_detail_reports_people_mentions_and_a_link(mods):
    store, boards = mods
    _put(store, _at(1, 10), "NVDA", "a", 1544451055910129726)
    d = boards.ticker_detail("NVDA", "open", _at(1, 15))
    assert d["mentions"] == 1 and d["people"] == 1
    assert "discord.com/channels/" in d["link"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /c/Users/Patrick/uct-worktrees/discord-buzz && python -m pytest tests/test_buzz_boards.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'api.services.buzz_boards'`

- [ ] **Step 3: Write the implementation**

```python
# api/services/buzz_boards.py
"""The two boards: most-talked-about (by people) and heating-up (vs baseline).

⛔ HEAT SCORE, TRAP 1 -- THE DENOMINATOR MUST MATCH. Comparing today-so-far
against a 30-day DAILY average is apples to oranges: at 09:45 every ticker
looks stone cold, and the board lies all morning. The baseline is the mean of
each prior session measured over THE SAME ELAPSED TIME from its own open.

⛔ HEAT SCORE, TRAP 2 -- A FLOOR, OR IT IS NOISE. A name mentioned once in 30
days and three times today is "3x normal" and completely meaningless. A ratio
without a base rate is not a signal.
"""
from __future__ import annotations

import datetime as dt
import os
from zoneinfo import ZoneInfo

from api.services import buzz_store

_ET = ZoneInfo("America/New_York")

OPEN_H, OPEN_M = 9, 30
CLOSE_H, CLOSE_M = 16, 0

MIN_CURRENT = int(os.environ.get("BUZZ_HEAT_MIN_CURRENT", "5"))
MIN_BASELINE = float(os.environ.get("BUZZ_HEAT_MIN_BASELINE", "1.0"))
SPARK_BUCKETS = 8

WINDOW_LABEL = {
    "open": "since the open", "today": "today", "noon": "since noon",
    "week": "this week", "month": "this month",
}

GUILD_ID = os.environ.get("DISCORD_GUILD_ID", "882293203485720596")


def _channels() -> list[str]:
    from api.services import buzz_ingest
    return buzz_ingest.channels()


def _et(ts: int) -> dt.datetime:
    return dt.datetime.fromtimestamp(ts, _ET)


def _session_open(d: dt.datetime) -> int:
    return int(d.replace(hour=OPEN_H, minute=OPEN_M, second=0, microsecond=0).timestamp())


def window_bounds(name: str, now: int) -> tuple[int, int]:
    d = _et(now)
    if name == "open":
        return _session_open(d), now
    if name == "noon":
        return int(d.replace(hour=12, minute=0, second=0, microsecond=0).timestamp()), now
    if name == "today":
        return int(d.replace(hour=0, minute=0, second=0, microsecond=0).timestamp()), now
    if name == "week":
        monday = d - dt.timedelta(days=d.weekday())
        return int(monday.replace(hour=0, minute=0, second=0, microsecond=0).timestamp()), now
    if name == "month":
        return int(d.replace(day=1, hour=0, minute=0, second=0, microsecond=0).timestamp()), now
    return _session_open(d), now


def top_board(window: str, now: int, limit: int = 5) -> list[dict]:
    start, end = window_bounds(window, now)
    chans = _channels()
    rows = buzz_store.board(start, end, chans, limit=limit)
    for r in rows:
        r["spark"] = buzz_store.series(r["ticker"], start, end, SPARK_BUCKETS, chans)
    return rows


def _prior_session_days(now: int, sessions: int) -> list[dt.datetime]:
    d = _et(now)
    out, day = [], d
    while len(out) < sessions:
        day = day - dt.timedelta(days=1)
        if day.weekday() < 5:                      # weekdays only
            out.append(day)
    return out


def heat_board(now: int, limit: int = 4, sessions: int = 30) -> list[dict]:
    chans = _channels()
    open_ts = _session_open(_et(now))
    elapsed = max(0, now - open_ts)
    candidates = buzz_store.board(open_ts, now, chans, limit=40)

    out: list[dict] = []
    for row in candidates:
        cur = row["mentions"]
        if cur < MIN_CURRENT:
            continue
        prior = []
        for day in _prior_session_days(now, sessions):
            o = _session_open(day)
            prior.append(buzz_store.count(row["ticker"], o, o + elapsed, chans))
        base = (sum(prior) / len(prior)) if prior else 0.0
        if base < MIN_BASELINE:
            continue
        out.append({"ticker": row["ticker"], "mentions": cur, "ratio": round(cur / base, 1)})

    out.sort(key=lambda r: r["ratio"], reverse=True)
    return [r for r in out if r["ratio"] >= 1.5][:limit]


def ticker_detail(ticker: str, window: str, now: int) -> dict:
    start, end = window_bounds(window, now)
    chans = _channels()
    rows = buzz_store.board(start, end, chans, limit=200)
    hit = next((r for r in rows if r["ticker"] == ticker.upper()), None)
    mentions = hit["mentions"] if hit else 0
    people = hit["people"] if hit else 0
    c = buzz_store.connect()
    cl = " AND channel_id IN (%s)" % ",".join("?" * len(chans)) if chans else ""
    last = c.execute(
        "SELECT message_id, channel_id FROM mentions WHERE ticker=? AND ts>=? AND ts<?" + cl +
        " ORDER BY ts DESC LIMIT 1", [ticker.upper(), start, end, *chans]
    ).fetchone()
    link = ""
    if last:
        link = f"https://discord.com/channels/{GUILD_ID}/{last['channel_id']}/{last['message_id']}"
    return {
        "ticker": ticker.upper(), "window": window,
        "mentions": mentions, "people": people,
        "spark": buzz_store.series(ticker.upper(), start, end, SPARK_BUCKETS, chans),
        "link": link,
    }


def coverage(now: int) -> str:
    t = buzz_store.latest_ts(_channels())
    if not t:
        return "no messages counted yet"
    d = _et(t)
    # ⛔ NOT strftime("%-I") -- that is glibc-only and raises on Windows, where
    # these tests also run. Build the 12-hour clock explicitly.
    hour = d.hour % 12 or 12
    return f"counted through {hour}:{d.minute:02d}{'a' if d.hour < 12 else 'p'}"
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /c/Users/Patrick/uct-worktrees/discord-buzz && python -m pytest tests/test_buzz_boards.py -v`
Expected: 9 passed.

`test_heat_control_a_normal_day_is_not_flagged` is the control — if it ever passes while `test_heat_uses_a_MATCHED_denominator` also passes trivially, the heat board is not measuring anything. Both must be meaningful.

- [ ] **Step 5: Commit**

```bash
cd /c/Users/Patrick/uct-worktrees/discord-buzz && \
git add api/services/buzz_boards.py tests/test_buzz_boards.py && \
git commit -m "feat(buzz): people-ranked board + heat score with matched denominator and floor"
```

---

### Task 7: The `/buzz` command

**Files:**
- Modify: `api/services/discord_interactions.py` (add `BUZZ_COMMAND`, extend `build_commands()`)
- Modify: `api/routers/discord_interactions.py` (dispatch + autocomplete)
- Create: `api/services/buzz_reply.py`
- Test: `tests/test_buzz_command.py`

**Interfaces:**
- Consumes: `buzz_boards`, `buzz_store.known_tickers`
- Produces:
  - `buzz_reply.build_board_text(now: int, window: str) -> str`
  - `buzz_reply.build_ticker_text(ticker: str, window: str, now: int) -> str`
  - `discord_interactions.BUZZ_COMMAND = "buzz"`
  - `discord_interactions.WINDOW_CHOICES: dict[str, str]`

**Constraint:** one command, one picker row. v19 shrank the picker from 6 rows to 3 for exactly this reason; do not add `/trending`, `/mentions` or `/hot` as separate commands.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_buzz_command.py
"""/buzz: registration payload, reply text, autocomplete backed by real data."""
from __future__ import annotations

import pytest

CH = "CH1"


@pytest.fixture()
def mods(tmp_path, monkeypatch):
    monkeypatch.setenv("BUZZ_DB_PATH", str(tmp_path / "buzz.db"))
    monkeypatch.setenv("BUZZ_CHANNELS", CH)
    from api.services import buzz_store, buzz_reply
    buzz_store._reset_for_tests()
    buzz_store.init_db()
    return buzz_store, buzz_reply


def test_buzz_is_registered_as_exactly_one_command():
    from api.services import discord_interactions as di
    names = [c["name"] for c in di.build_commands()]
    assert names.count("buzz") == 1
    assert not {"trending", "mentions", "hot"} & set(names), "one command, one picker row"


def test_buzz_command_is_guild_only():
    from api.services import discord_interactions as di
    cmd = next(c for c in di.build_commands() if c["name"] == "buzz")
    assert cmd["integration_types"] == [0]
    assert cmd["contexts"] == [0]


def test_buzz_options_are_ticker_and_window_only():
    from api.services import discord_interactions as di
    cmd = next(c for c in di.build_commands() if c["name"] == "buzz")
    assert [o["name"] for o in cmd.get("options", [])] == ["ticker", "window"]
    ticker = cmd["options"][0]
    assert ticker.get("autocomplete") is True
    assert ticker.get("required") in (False, None)


def test_window_choices_cover_what_the_owner_asked_for():
    from api.services import discord_interactions as di
    assert set(di.WINDOW_CHOICES) == {"open", "today", "noon", "week", "month"}


def test_every_choice_obeys_discord_limits():
    from api.services import discord_interactions as di
    cmd = next(c for c in di.build_commands() if c["name"] == "buzz")
    for opt in cmd["options"]:
        for ch in opt.get("choices", []):
            assert len(ch["name"]) <= 100 and len(str(ch["value"])) <= 100
        assert len(opt.get("choices", [])) <= 25


def test_board_text_names_both_boards(mods):
    store, reply = mods
    import datetime as dt
    ET = dt.timezone(dt.timedelta(hours=-4))
    now = int(dt.datetime(2026, 9, 1, 15, 0, tzinfo=ET).timestamp())
    ts = int(dt.datetime(2026, 9, 1, 10, 0, tzinfo=ET).timestamp())
    store.record_mentions([(str(1000 + i), CH, f"u{i}", "NVDA", ts, "exact") for i in range(6)])
    text = reply.build_board_text(now, "open")
    assert "NVDA" in text
    assert "6" in text
    assert "counted through" in text


def test_board_text_when_empty_says_so_rather_than_showing_a_blank_board(mods):
    store, reply = mods
    import time
    text = reply.build_board_text(int(time.time()), "open")
    assert "nothing" in text.lower() or "no mentions" in text.lower()


def test_ticker_text_includes_a_jump_link(mods):
    store, reply = mods
    import datetime as dt
    ET = dt.timezone(dt.timedelta(hours=-4))
    now = int(dt.datetime(2026, 9, 1, 15, 0, tzinfo=ET).timestamp())
    ts = int(dt.datetime(2026, 9, 1, 10, 0, tzinfo=ET).timestamp())
    store.record_mentions([("1544451055910129726", CH, "a", "NVDA", ts, "exact")])
    text = reply.build_ticker_text("NVDA", "open", now)
    assert "discord.com/channels/" in text


def test_autocomplete_is_backed_by_real_mentions_not_the_universe(mods):
    """v20: a suggestion list that cannot offer a name members actually use
    reads as a refusal. Here the only valid suggestions ARE the counted ones."""
    store, _ = mods
    store.record_mentions([
        ("1", CH, "a", "NVDA", 1, "exact"),
        ("2", CH, "b", "NVDA", 2, "exact"),
        ("3", CH, "c", "NVAX", 3, "exact"),
    ])
    from api.routers import discord_interactions as rt
    choices = rt.buzz_ticker_choices("NV")
    assert [c["value"] for c in choices] == ["NVDA", "NVAX"]
    assert len(choices) <= 25


def test_autocomplete_returns_at_most_25(mods):
    store, _ = mods
    store.record_mentions([(str(i), CH, "a", f"T{i:03d}", i, "exact") for i in range(40)])
    from api.routers import discord_interactions as rt
    assert len(rt.buzz_ticker_choices("T")) <= 25
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /c/Users/Patrick/uct-worktrees/discord-buzz && python -m pytest tests/test_buzz_command.py -v`
Expected: FAIL — no `buzz` command in `build_commands()`.

- [ ] **Step 3: Add the command definition**

In `api/services/discord_interactions.py`, near `CHART_COMMAND_NAMES` (line ~311):

```python
BUZZ_COMMAND = "buzz"
WINDOW_CHOICES = {
    "open":  "Since the open",
    "today": "Today",
    "noon":  "Since noon",
    "week":  "This week",
    "month": "This month",
}
```

Then add a builder function mirroring `build_settings_command()` — that file's house pattern is one `build_*_command()` per command, and `build_commands()` composes them. **Do not append an inline dict.**

```python
def build_buzz_command() -> dict:
    """`/buzz` - what the room is talking about.

    ONE command, one picker row. Bare = the board; a ticker = that name's
    numbers. v19 shrank this picker from 6 rows to 3 for exactly this reason,
    so `/trending` and `/mentions` are deliberately not separate commands."""
    return {
        "name": BUZZ_COMMAND, "type": 1,
        "description": "What the room is talking about - run it bare for the board, or name a ticker",
        "options": [
            {"name": "ticker", "type": 3, "required": False, "autocomplete": True,
             "description": "One ticker (leave blank for the board)"},
            {"name": "window", "type": 3, "required": False, "description": "Time window",
             "choices": [{"name": label, "value": value} for value, label in WINDOW_CHOICES.items()]},
        ],
    }
```

And add it to the existing list inside `build_commands()` — that is the whole change to that function:

```python
    cmds = [build_chart_command(), build_alias_command(),
            build_settings_command(), build_buzz_command()]
```

⚠️ Note the choice shape: `build_settings_command`'s `ch()` helper maps `{value: label}`, so a `{"name": label, "value": value}` pair comes from iterating `.items()` as `(value, label)`. `WINDOW_CHOICES` is declared in that same `{value: label}` direction, so the comprehension above is right — reversing it silently registers the labels as the values Discord sends back.

- [ ] **Step 4: Write the reply builder**

```python
# api/services/buzz_reply.py
"""Text replies for /buzz. The image is a separate, optional layer -- if the
renderer is busy or off, the member still gets the numbers."""
from __future__ import annotations

from api.services import buzz_boards

BAR_W = 18


def _bar(n: int, top: int) -> str:
    if top <= 0:
        return ""
    return "\u2588" * max(1, round(BAR_W * n / top))


def build_board_text(now: int, window: str = "open") -> str:
    rows = buzz_boards.top_board(window, now, limit=5)
    label = buzz_boards.WINDOW_LABEL.get(window, window)
    if not rows:
        return f"No mentions counted yet for **{label}**. {buzz_boards.coverage(now)}."

    top = rows[0]["mentions"]
    lines = [f"**Most talked about \u2014 {label}**", "```"]
    for r in rows:
        lines.append(f"{r['ticker']:<6}{_bar(r['mentions'], top):<{BAR_W}}  "
                     f"{r['mentions']:>3}   {r['people']:>2} ppl")
    lines.append("```")

    heat = buzz_boards.heat_board(now)
    if heat:
        lines.append("\U0001f525 **Heating up** \u2014 " +
                     " \u00b7 ".join(f"{h['ticker']} {h['ratio']}x" for h in heat))
    lines.append(f"_{buzz_boards.coverage(now)}_")
    return "\n".join(lines)


def build_ticker_text(ticker: str, window: str, now: int) -> str:
    d = buzz_boards.ticker_detail(ticker, window, now)
    if not d["mentions"]:
        return f"**{d['ticker']}** \u2014 no mentions in that window. {buzz_boards.coverage(now)}."
    spark = "".join("\u2581\u2582\u2583\u2585\u2586\u2587\u2588"[min(6, v)] for v in d["spark"])
    out = [f"**{d['ticker']}** \u2014 {d['mentions']} mention(s) from {d['people']} member(s)",
           f"`{spark}`"]
    if d["link"]:
        out.append(f"[jump to the latest]({d['link']})")
    out.append(f"_{buzz_boards.coverage(now)}_")
    return "\n".join(out)
```

`WINDOW_LABEL` is already defined in `buzz_boards.py` from Task 6 — import it, do not redeclare it. A second authority over one value is how the picker and the reply drift apart.

- [ ] **Step 5: Wire dispatch and autocomplete into the router**

In `api/routers/discord_interactions.py`, add near `fetch_ticker_choices` (line ~75):

```python
def buzz_ticker_choices(q: str, limit: int = 25) -> list[dict]:
    """Autocomplete from what the room ACTUALLY said, not from cap_universe.
    v20's lesson: a picker whose silence is indistinguishable from a refusal
    reads as a refusal. Here every suggestion is a name with real counts."""
    from api.services import buzz_store
    try:
        return [{"name": f"{t} \u2014 {n} mention(s)", "value": t}
                for t, n in buzz_store.known_tickers(q or "", limit=limit)]
    except Exception:  # noqa: BLE001
        return []
```

**⛔ The autocomplete goes INSIDE the existing `itype == 4` block, not before the chart dispatch.** That block (around line 187) early-returns `_autocomplete([])` for any command name it does not recognise, so a buzz branch placed after it is unreachable and the picker would silently show "no options match" forever. The current block reads:

```python
    if itype == 4:
        if name not in di.CHART_COMMAND_NAMES:
            return _autocomplete([])
        q = di.parse_autocomplete(interaction)
        return _autocomplete(fetch_ticker_choices(q) if q else [])
```

Change it to:

```python
    if itype == 4:
        if name == di.BUZZ_COMMAND:
            # Backed by what the room ACTUALLY said, so an empty query is still
            # useful: it offers the most-mentioned names.
            return _autocomplete(buzz_ticker_choices(di.parse_autocomplete(interaction)))
        if name not in di.CHART_COMMAND_NAMES:
            return _autocomplete([])
        q = di.parse_autocomplete(interaction)
        return _autocomplete(fetch_ticker_choices(q) if q else [])
```

**Use `di.parse_autocomplete(interaction)` — it already exists** (it returns the focused option's text, uppercased and clipped to 10 chars). Do **not** add a `focused_option` helper; a second reader of the same field is how the two drift apart.

Then, for the command itself, before the chart dispatch (around line 217):

```python
    if itype == 2 and name == di.BUZZ_COMMAND:
        import time as _t
        from api.services import buzz_reply
        opts = {o["name"]: o.get("value") for o in
                ((interaction.get("data") or {}).get("options") or [])}
        window = (opts.get("window") or "open").strip()
        ticker = (opts.get("ticker") or "").strip().upper()
        now = int(_t.time())
        try:
            text = (buzz_reply.build_ticker_text(ticker, window, now) if ticker
                    else buzz_reply.build_board_text(now, window))
        except Exception as e:  # noqa: BLE001
            logging.getLogger(__name__).warning("[buzz] reply failed: %s", e)
            return _ephemeral("Could not read the counts right now.")
        return {"type": 4, "data": {"content": text}}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd /c/Users/Patrick/uct-worktrees/discord-buzz && python -m pytest tests/test_buzz_command.py tests/test_discord_chart.py -v`
Expected: all passed. The chart suite must stay green — `build_commands()` is shared.

- [ ] **Step 7: Register the command against Discord**

Run: `cd /c/Users/Patrick/uct-worktrees/discord-buzz && python tools/discord_chart_commands.py --env-file ../../uct_intelligence/.env --token-var DISCORD_BOT_TOKEN register --global`

Then confirm: `python tools/discord_chart_commands.py --env-file ../../uct_intelligence/.env --token-var DISCORD_BOT_TOKEN show`
Expected: `chart · c · chartsettings · buzz`.

Clients show "This command is outdated" for a few minutes after any re-registration — that is client cache and self-heals.

- [ ] **Step 8: Commit**

```bash
cd /c/Users/Patrick/uct-worktrees/discord-buzz && \
git add api/services/discord_interactions.py api/routers/discord_interactions.py \
        api/services/buzz_reply.py api/services/buzz_boards.py tests/test_buzz_command.py && \
git commit -m "feat(buzz): /buzz command, data-backed autocomplete, text boards"
```

---

### Task 8: The `/r/buzz` render page

**Files:**
- Modify: `api/routers/render_panels.py` (add the token-gated data endpoint — declared `@router.get("/r/buzz")`, but that router carries `prefix="/api"`, so the real path is **`/api/r/buzz`**)
- Create: `app/src/pages/BuzzRender.jsx`
- Modify: `app/src/App.jsx` (lazy import, route, and the logged-out route list at line ~285)
- Test: `tests/api/test_buzz_render_panel.py`  ← **`tests/api/`, not `tests/`** — that is where every router test that builds a `TestClient` from `api.main` lives (see `tests/api/test_cot_endpoints.py`)
- Test: `app/src/pages/__tests__/BuzzRender.test.jsx`

**Interfaces:**
- Consumes: `buzz_boards.top_board`, `.heat_board`, `.coverage`
- Produces: `GET /api/r/buzz?token=...&window=open` →

```jsonc
{
  "window": "open", "label": "since the open",
  "rows":   [ {"ticker","people","mentions","spark":[int],"hot": 6.3|null} ],  // top 14, full treatment
  "tail":    [ {"ticker","mentions","hot": 2.2|null} ],                          // the tail, ranked
  "singles": ["ABCD","EFGH"],                                                  // mentioned once, compressed
  "heat":   [ {"ticker","ratio"} ],
  "totals": {"messages": 318, "members": 63, "tickers": 77},
  "coverage": "counted through 4:08p", "asOf": 1788303268
}
```

The page sets `window.__buzzReady = true` once every row **and** every tail chip has laid out.

**⭐ OWNER DIRECTION 2026-09-01: the board shows EVERY ticker, not a top 5.** *"I think we can significantly improve that rendered image to be much more detailed and longer and more insightful. Honestly want every ticker mentioned."*

Layout, validated by rendering a 77-ticker mockup at 1400px:
- **Left column (~560px):** the top 14 with the full treatment — bar, count, people, sparkline, inline heat multiplier.
- **Right column:** the whole remaining tail as compact `TICKER n` chips, **ranked by mentions**, flowing across 4 CSS columns. Names mentioned exactly once collapse into one final de-emphasised line of bare symbols, no counts — that is the least interesting third of any day and it should not occupy a third of the image. Chips for names on the heat board get a gold outline, so the two boards fuse instead of needing a second image.

⛔ **NOT grouped by theme.** Owner decision 2026-09-01 after seeing it rendered: *"I don't like the theme groups exactly, but I do want to see everything mentioned."* Theme grouping was built and measured first — it needed a taxonomy join, a `min_group` floor that was a guess, and it fragmented into 41 groups of size one before that floor was added. Rank order needs none of that and cannot fragment. `themed_groups` and `ticker_themes` are **dropped from this plan**; the taxonomy join is recorded in the deferred section if it is ever wanted back.
- **Header:** totals (`318 messages · 63 members · 77 tickers`).

⛔ **The tail MUST NOT be an ungrouped list, and grouping MUST use the `min_group` floor** — see Task 6. Rendering the ungrouped/unfloored version is what proved this: 41 groups of size one is worse than no grouping at all.

**Readiness matters here.** `⛔ A SIZED CANVAS IS NOT A DRAWN CHART` — the chart work shipped blank images twice because "an element exists" was satisfied before content arrived. The flag must be set from real laid-out rows, not from mount.

- [ ] **Step 1: Write the failing backend test**

```python
# tests/api/test_buzz_render_panel.py
"""/r/buzz data endpoint: token gate and payload shape."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("BUZZ_DB_PATH", str(tmp_path / "buzz.db"))
    monkeypatch.setenv("BUZZ_CHANNELS", "CH1")
    monkeypatch.setenv("CHART_RENDER_TOKEN", "secret-token")
    from api.services import buzz_store
    buzz_store._reset_for_tests()
    buzz_store.init_db()
    from api.main import app
    return TestClient(app), buzz_store


def test_requires_the_render_token(client):
    c, _ = client
    assert c.get("/api/r/buzz").status_code in (401, 403)
    assert c.get("/api/r/buzz", params={"token": "wrong"}).status_code in (401, 403)


def test_returns_rows_and_coverage(client):
    c, store = client
    import time
    ts = int(time.time()) - 60
    store.record_mentions([(str(1000 + i), "CH1", f"u{i}", "NVDA", ts, "exact") for i in range(4)])
    r = c.get("/api/r/buzz", params={"token": "secret-token", "window": "today"})
    assert r.status_code == 200
    body = r.json()
    assert body["rows"][0]["ticker"] == "NVDA"
    assert body["rows"][0]["people"] == 4
    assert isinstance(body["rows"][0]["spark"], list)
    assert "coverage" in body and "label" in body


def test_empty_store_returns_an_empty_list_not_an_error(client):
    c, _ = client
    r = c.get("/api/r/buzz", params={"token": "secret-token"})
    assert r.status_code == 200 and r.json()["rows"] == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /c/Users/Patrick/uct-worktrees/discord-buzz && python -m pytest tests/api/test_buzz_render_panel.py -v`
Expected: FAIL — 404 on `/api/r/buzz`.

- [ ] **Step 3: Add the data endpoint**

In `api/routers/render_panels.py`, following the shape of the existing `/r/catalysts` handler (line ~70) for the token gate:

```python
@router.get("/r/buzz")
def buzz_panel(token: str = "", window: str = "open"):
    _check_token(token)
    _rate_limit()
    import time
    from api.services import buzz_boards
    now = int(time.time())
    every = buzz_boards.full_board(window, now)        # EVERY ticker, ranked
    head, tail = every[:14], every[14:]
    multi, singles = buzz_boards.split_tail(tail)
    hot = {h["ticker"]: h["ratio"] for h in buzz_boards.heat_board(now, limit=12)}
    for r in head:
        r["hot"] = hot.get(r["ticker"])
    return {
        "window": window,
        "label": buzz_boards.WINDOW_LABEL.get(window, window),
        "rows": head,
        "tail":    [{"ticker": t["ticker"], "mentions": t["mentions"],
                     "hot": hot.get(t["ticker"])} for t in multi],
        "singles": singles,
        "heat": buzz_boards.heat_board(now),
        "totals": buzz_boards.totals(window, now),
        "coverage": buzz_boards.coverage(now),
        "asOf": now,
    }
```

**Verified 2026-09-01 — the helpers are named `_check_token(token)` and `_rate_limit()`**, both already defined in `api/routers/render_panels.py`; `/r/catalysts` calls `_check_token` the same way. Do not invent a new gate.

⚠️ Read that file's module docstring before adding the route. It states the rule these endpoints live under: the render token is **inlined into the frontend JS bundle**, so `/r/*` is **effectively public** — return only fields safe to expose and rate-limit so it cannot drive unbounded provider calls.

**Two consequences, and the second is an owner decision, not an engineering one:**

1. **Never put member identity in this payload.** No `author_id`, no `message_id`, no jump links. Those belong in the `/buzz` command reply, which is authenticated and answered inside the member's own server. Here they would publish who said what from a paywalled community. The payload is aggregate counts and tickers only.

2. **Even the aggregate board becomes effectively public through this endpoint** — anyone holding the bundled render token could poll "what is the paid Discord talking about today." That is a low-value leak (ticker counts, no names, no theses) and the same class of exposure the other `/r/*` panels already accept, so this plan proceeds with it. **If the owner would rather not publish that at all, the fix is small and there is a house pattern for it:** drop `/r/buzz` and hand the board to the page as a base64url query param the way `discord_chart_house.build_render_url` already passes `?stats=`. No public endpoint, no token, page renders from what the caller stamped. The cost is that the page can no longer refresh itself — irrelevant for a screenshot.

- [ ] **Step 4: Write the React page**

```jsx
// app/src/pages/BuzzRender.jsx
/**
 * Headless board for the Discord /buzz image. Logged out, static, screenshotted
 * by chart-renderer against #buzz-export.
 *
 * window.__buzzReady is set from ROWS THAT HAVE LAID OUT (measured height > 0),
 * never from mount. A sized container is not a drawn board -- that mistake
 * shipped blank chart images twice.
 */
import { useEffect, useRef, useState } from 'react'
import styles from './BuzzRender.module.css'

export default function BuzzRender() {
  const [data, setData] = useState(null)
  const [failed, setFailed] = useState(false)
  const listRef = useRef(null)
  const params = new URLSearchParams(window.location.search)

  useEffect(() => {
    const qs = new URLSearchParams({
      token: params.get('token') || '',
      window: params.get('window') || 'open',
    })
    fetch(`/api/r/buzz?${qs}`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(setData)
      .catch(() => setFailed(true))
  }, [])

  useEffect(() => {
    if (!data) return
    const el = listRef.current
    if (!el) return
    const rows = el.querySelectorAll('[data-buzz-row]')
    if (data.rows.length && rows.length !== data.rows.length) return
    const laidOut = [...rows].every(r => r.getBoundingClientRect().height > 0)
    if (laidOut || !data.rows.length) window.__buzzReady = true
  }, [data])

  if (failed) return <div className={styles.wrap} id="buzz-export">Unavailable</div>
  if (!data) return <div className={styles.wrap} id="buzz-export" />

  const top = data.rows[0]?.mentions || 1
  return (
    <div className={styles.wrap} id="buzz-export">
      <div className={styles.head}>
        <span className={styles.brand}>UNCHARTED TERRITORY · THE ROOM</span>
        <span className={styles.when}>{data.label}</span>
      </div>
      <div ref={listRef} className={styles.rows}>
        {data.rows.map(r => (
          <div key={r.ticker} data-buzz-row className={styles.row}>
            <span className={styles.sym}>{r.ticker}</span>
            <span className={styles.barTrack}>
              <span className={styles.bar} style={{ width: `${(100 * r.mentions) / top}%` }} />
            </span>
            <span className={styles.n}>{r.mentions}</span>
            <span className={styles.ppl}>{r.people} ppl</span>
            <Spark values={r.spark} />
          </div>
        ))}
      </div>
      {data.heat?.length > 0 && (
        <div className={styles.heat}>
          🔥 {data.heat.map(h => `${h.ticker} ${h.ratio}x`).join('  ·  ')}
        </div>
      )}
      <div className={styles.foot}>
        <span>{data.coverage}</span>
        <span>uctintelligence.com</span>
      </div>
    </div>
  )
}

function Spark({ values }) {
  const max = Math.max(1, ...(values || []))
  return (
    <svg className={styles.spark} viewBox={`0 0 ${(values?.length || 1) * 4} 12`}
         preserveAspectRatio="none" aria-hidden="true">
      {(values || []).map((v, i) => (
        <rect key={i} x={i * 4} y={12 - (10 * v) / max} width="3" height={(10 * v) / max || 0.5} />
      ))}
    </svg>
  )
}
```

Create `app/src/pages/BuzzRender.module.css` alongside it. **Load the `frontend-design` and `dataviz` skills before writing the styles** — palette, type scale and spacing are a real design pass against the live house tokens, not an improvisation. Read the tokens `ChartRender.jsx` already uses rather than inventing colours; the chart work once shipped a comparison line byte-identical to the EMA-20 because a colour was picked by eye.

- [ ] **Step 5: Register the route**

In `app/src/App.jsx`:
- line ~136: `const BuzzRender = lazy(() => import('./pages/BuzzRender'))`
- line ~285: add `'/r/buzz'` to the logged-out route list
- line ~390 area: `<Route path="/r/buzz" element={<BuzzRender />} />`

- [ ] **Step 6: Write the frontend test**

```jsx
// app/src/pages/__tests__/BuzzRender.test.jsx
import { render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import BuzzRender from '../BuzzRender'

const PAYLOAD = {
  window: 'open', label: 'since the open',
  rows: [{ ticker: 'NVDA', people: 14, mentions: 47, spark: [1, 2, 3] }],
  heat: [{ ticker: 'PLTR', ratio: 6.3 }],
  coverage: 'counted through 3:58p', asOf: 1,
}

beforeEach(() => {
  window.__buzzReady = undefined
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(PAYLOAD) })))
})

describe('BuzzRender', () => {
  it('renders a row per ticker with people and mentions', async () => {
    render(<BuzzRender />)
    expect(await screen.findByText('NVDA')).toBeInTheDocument()
    expect(screen.getByText('47')).toBeInTheDocument()
    expect(screen.getByText('14 ppl')).toBeInTheDocument()
  })

  it('shows the heat line', async () => {
    render(<BuzzRender />)
    await waitFor(() => expect(screen.getByText(/PLTR 6.3x/)).toBeInTheDocument())
  })

  it('does not claim ready before data arrives', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
    render(<BuzzRender />)
    expect(window.__buzzReady).toBeUndefined()
  })

  it('renders "Unavailable" rather than a blank board on fetch failure', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, status: 500 })))
    render(<BuzzRender />)
    expect(await screen.findByText('Unavailable')).toBeInTheDocument()
  })
})
```

- [ ] **Step 7: Run both suites**

Run: `cd /c/Users/Patrick/uct-worktrees/discord-buzz && python -m pytest tests/api/test_buzz_render_panel.py -v`
Run: `cd /c/Users/Patrick/uct-worktrees/discord-buzz/app && npx vitest run src/pages/__tests__/BuzzRender.test.jsx`
Expected: both green.

> jsdom computes no layout, so `getBoundingClientRect().height` is 0 there and
> the ready flag will not set in the unit test. That is expected and is why the
> third test asserts only the negative case. Readiness is proven for real in
> Task 9 by counting pixels in the PNG.

- [ ] **Step 8: Commit**

```bash
cd /c/Users/Patrick/uct-worktrees/discord-buzz && \
git add api/routers/render_panels.py app/src/pages/BuzzRender.jsx \
        app/src/pages/BuzzRender.module.css app/src/App.jsx \
        tests/api/test_buzz_render_panel.py app/src/pages/__tests__/BuzzRender.test.jsx && \
git commit -m "feat(buzz): /r/buzz data endpoint + headless board render page"
```

---

### Task 9: Board PNG and the daily digest

**Files:**
- Create: `api/services/buzz_image.py`
- Create: `api/services/discord_buzz_digest.py`
- Modify: `api/main.py` (digest scheduler job)
- Modify: `api/routers/discord_interactions.py` (attach the image to `/buzz`)
- Test: `tests/test_buzz_digest.py`

**Interfaces:**
- Consumes: `buzz_boards`, `CHART_RENDERER_URL`, `CHART_RENDERER_SECRET`, `CHART_RENDER_TOKEN`, `CHART_RENDER_BASE_URL`
- Produces:
  - `buzz_image.image_enabled() -> bool`
  - `buzz_image.render_board_png(window: str, *, client=None) -> bytes | None`
  - `discord_buzz_digest.digest_enabled() -> bool`
  - `discord_buzz_digest.run_digest(*, now=None, render_fn=None, post_fn=None) -> dict`

**Ships disarmed.** `BUZZ_DIGEST_ENABLED` defaults to `0`. Posting into a 750-member room is the owner's call.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_buzz_digest.py
"""Buzz image + digest: blank guard, disarmed default, one post per day, lock."""
from __future__ import annotations

import datetime as dt

import pytest

ET = dt.timezone(dt.timedelta(hours=-4))


@pytest.fixture()
def mods(tmp_path, monkeypatch):
    monkeypatch.setenv("BUZZ_DB_PATH", str(tmp_path / "buzz.db"))
    monkeypatch.setenv("BUZZ_STATE_PATH", str(tmp_path / "buzz_state.json"))
    monkeypatch.setenv("BUZZ_CHANNELS", "CH1")
    from api.services import buzz_store, buzz_image, discord_buzz_digest
    buzz_store._reset_for_tests()
    buzz_store.init_db()
    return buzz_store, buzz_image, discord_buzz_digest


def test_digest_is_disarmed_by_default(mods, monkeypatch):
    _, _, digest = mods
    monkeypatch.delenv("BUZZ_DIGEST_ENABLED", raising=False)
    assert digest.digest_enabled() is False


def test_digest_refuses_to_post_while_disarmed(mods, monkeypatch):
    _, _, digest = mods
    monkeypatch.delenv("BUZZ_DIGEST_ENABLED", raising=False)
    posts = []
    out = digest.run_digest(now=int(dt.datetime(2026, 9, 1, 16, 10, tzinfo=ET).timestamp()),
                            render_fn=lambda w: b"\x89PNG-fake",
                            post_fn=lambda **kw: posts.append(kw) or True)
    assert posts == []
    assert out["posted"] is False


def test_digest_posts_once_per_day(mods, monkeypatch):
    store, _, digest = mods
    monkeypatch.setenv("BUZZ_DIGEST_ENABLED", "1")
    monkeypatch.setenv("BUZZ_DIGEST_WEBHOOK", "https://example.invalid/hook")
    ts = int(dt.datetime(2026, 9, 1, 10, 0, tzinfo=ET).timestamp())
    store.record_mentions([(str(1000 + i), "CH1", f"u{i}", "NVDA", ts, "exact") for i in range(6)])
    now = int(dt.datetime(2026, 9, 1, 16, 10, tzinfo=ET).timestamp())
    posts = []

    def post(**kw):
        posts.append(kw)
        return True

    first = digest.run_digest(now=now, render_fn=lambda w: b"\x89PNGdata", post_fn=post)
    assert first["posted"] is True and len(posts) == 1
    second = digest.run_digest(now=now + 60, render_fn=lambda w: b"\x89PNGdata", post_fn=post)
    assert second["posted"] is False, "already posted today"
    assert len(posts) == 1


def test_digest_posts_text_when_the_render_fails(mods, monkeypatch):
    store, _, digest = mods
    monkeypatch.setenv("BUZZ_DIGEST_ENABLED", "1")
    monkeypatch.setenv("BUZZ_DIGEST_WEBHOOK", "https://example.invalid/hook")
    ts = int(dt.datetime(2026, 9, 1, 10, 0, tzinfo=ET).timestamp())
    store.record_mentions([(str(1000 + i), "CH1", f"u{i}", "NVDA", ts, "exact") for i in range(6)])
    posts = []
    out = digest.run_digest(now=int(dt.datetime(2026, 9, 1, 16, 10, tzinfo=ET).timestamp()),
                            render_fn=lambda w: None,
                            post_fn=lambda **kw: posts.append(kw) or True)
    assert out["posted"] is True
    assert posts[0]["png"] is None and "NVDA" in posts[0]["content"]


def test_digest_skips_a_day_with_nothing_to_say(mods, monkeypatch):
    _, _, digest = mods
    monkeypatch.setenv("BUZZ_DIGEST_ENABLED", "1")
    monkeypatch.setenv("BUZZ_DIGEST_WEBHOOK", "https://example.invalid/hook")
    posts = []
    out = digest.run_digest(now=int(dt.datetime(2026, 9, 1, 16, 10, tzinfo=ET).timestamp()),
                            render_fn=lambda w: b"\x89PNG",
                            post_fn=lambda **kw: posts.append(kw) or True)
    assert out["posted"] is False and posts == []


def test_a_non_png_body_is_rejected(mods, monkeypatch):
    """A 200 that is not a PNG is a failed render, not a board. The chart work
    shipped blank images twice by trusting the status code."""
    _, image, _ = mods
    monkeypatch.setenv("CHART_RENDERER_URL", "https://renderer.invalid")

    class FakeResp:
        is_success = True
        content = b"<html>error</html>"
        status_code = 200
        text = "error"

    class FakeClient:
        def post(self, *a, **k):
            return FakeResp()

    assert image.render_board_png("open", client=FakeClient()) is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /c/Users/Patrick/uct-worktrees/discord-buzz && python -m pytest tests/test_buzz_digest.py -v`
Expected: FAIL — modules do not exist.

- [ ] **Step 3: Write the image renderer**

```python
# api/services/buzz_image.py
"""PNG of the buzz board, via the existing chart-renderer service.

Same contract as discord_chart_house.render_house_chart: POST /render with a
url + selector + ready_js, get PNG bytes back. Never raises -- a failed render
degrades to a text board, it does not cost the member their answer.
"""
from __future__ import annotations

import logging
import os

log = logging.getLogger(__name__)

# 1400 wide because the board carries EVERY ticker: a ranked column plus the
# themed tail in three sub-columns. Height is a generous VIEWPORT -- the
# renderer screenshots the #buzz-export element's own box, so a day with more
# tickers simply produces a taller PNG.
BOARD_W, BOARD_H, SCALE = 1400, 1400, 2
RENDER_TIMEOUT_S = 45.0

READY_JS = "() => window.__buzzReady === true"


def image_enabled() -> bool:
    if os.environ.get("BUZZ_IMAGE_ENABLED", "1").strip().lower() in ("0", "false", "off", ""):
        return False
    return bool(os.environ.get("CHART_RENDERER_URL", "").strip())


def render_board_png(window: str = "open", *, client=None) -> bytes | None:
    renderer = os.environ.get("CHART_RENDERER_URL", "").strip().rstrip("/")
    if not renderer:
        return None
    base = os.environ.get("CHART_RENDER_BASE_URL", "https://uctintelligence.com")
    token = os.environ.get("CHART_RENDER_TOKEN", "")
    secret = os.environ.get("CHART_RENDERER_SECRET", "")
    url = f"{base}/r/buzz?token={token}&window={window}"
    try:
        import httpx
        own = client is None
        c = client or httpx.Client(timeout=RENDER_TIMEOUT_S)
        try:
            r = c.post(f"{renderer}/render", headers={"X-Render-Secret": secret}, json={
                "url": url, "selector": "#buzz-export",
                "width": BOARD_W, "height": BOARD_H, "scale": SCALE,
                "settle_ms": 400, "ready_js": READY_JS, "ready_timeout_ms": 15000,
                # Count the artifact, do not trust the flag. Comes back as the
                # X-Chart-Probe header; 0 rows means "ready but empty" -> discard.
                "probe_js": "document.querySelectorAll('[data-buzz-row]').length",
            })
            if not r.is_success:
                log.warning("[buzz] render HTTP %s: %s", r.status_code, r.text[:160])
                return None
            if not r.content.startswith(b"\x89PNG"):
                log.warning("[buzz] render returned non-PNG")
                return None
            return r.content
        finally:
            if own:
                c.close()
    except Exception as e:  # noqa: BLE001
        log.warning("[buzz] render failed: %s", e)
        return None
```

- [ ] **Step 4: Write the digest**

```python
# api/services/discord_buzz_digest.py
"""The daily buzz post. Ships DISARMED -- posting into a 750-member room is the
owner's call, not a default.

⛔ _RUN_LOCK plus a persisted last-posted day: two overlapping runs would
double-post, which is exactly the failure the index close post hit.
"""
from __future__ import annotations

import datetime as dt
import json
import logging
import os
import pathlib
import threading
from zoneinfo import ZoneInfo

from api.services import buzz_image, buzz_reply, buzz_boards

log = logging.getLogger(__name__)
_ET = ZoneInfo("America/New_York")
_RUN_LOCK = threading.Lock()


def digest_enabled() -> bool:
    return os.environ.get("BUZZ_DIGEST_ENABLED", "0").strip().lower() in ("1", "true", "on")


def webhook_url() -> str:
    return os.environ.get("BUZZ_DIGEST_WEBHOOK", "").strip()


def _state_path() -> pathlib.Path:
    return pathlib.Path(os.environ.get("BUZZ_STATE_PATH", "/data/buzz_state.json"))


def last_posted() -> str:
    try:
        return json.loads(_state_path().read_text(encoding="utf-8")).get("last_posted", "")
    except Exception:  # noqa: BLE001
        return ""


def mark_posted(day: str) -> None:
    p = _state_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps({"last_posted": day}), encoding="utf-8")
    os.replace(tmp, p)          # never truncate the real file before the write can fail


def _post(url: str, content: str, png: bytes | None) -> bool:
    import requests
    files = {"files[0]": ("buzz.png", png, "image/png")} if png else None
    payload = {"content": content}
    r = requests.post(url, data={"payload_json": json.dumps(payload)}, files=files, timeout=60)
    return r.status_code in (200, 204)


def run_digest(*, now: int | None = None, render_fn=None, post_fn=None) -> dict:
    import time
    now = now or int(time.time())
    if not digest_enabled():
        return {"posted": False, "reason": "disarmed"}
    url = webhook_url()
    if not url:
        return {"posted": False, "reason": "no webhook"}
    day = dt.datetime.fromtimestamp(now, _ET).strftime("%Y-%m-%d")
    if last_posted() == day:
        return {"posted": False, "reason": "already posted today"}
    if not _RUN_LOCK.acquire(blocking=False):
        return {"posted": False, "reason": "already running"}
    try:
        rows = buzz_boards.top_board("open", now, limit=5)
        if not rows:
            return {"posted": False, "reason": "nothing to say"}
        content = buzz_reply.build_board_text(now, "open")

        render = render_fn or (buzz_image.render_board_png if buzz_image.image_enabled() else None)
        png = render("open") if render else None

        poster = post_fn or (lambda **kw: _post(kw["url"], kw["content"], kw["png"]))
        ok = poster(url=url, content=content, png=png)
        if ok:
            mark_posted(day)
        return {"posted": bool(ok), "reason": "", "had_image": png is not None}
    finally:
        _RUN_LOCK.release()
```

- [ ] **Step 5: Attach the image to `/buzz` replies**

In the `/buzz` command branch added in Task 7, when no ticker was given and
`buzz_image.image_enabled()`, defer (`{"type": 5}`) and render in a
`BackgroundTasks` job that PATCHes `@original` with the PNG — mirroring
`run_chart_job`. When a ticker **was** given, keep the immediate text reply.

⛔ A PATCH that does not re-declare the attachment DROPS it — `desk_session_announce._edit` is this repo's measured counter-example. Re-declare `attachments` on every edit.

- [ ] **Step 6: Register the digest job**

In `api/main.py`, beside the other cron jobs:

```python
def _buzz_digest() -> None:
    log = logging.getLogger(__name__)
    try:
        from api.services import discord_buzz_digest
        out = discord_buzz_digest.run_digest()
        if out.get("posted"):
            log.info("[buzz] digest posted (image=%s)", out.get("had_image"))
    except Exception as e:  # noqa: BLE001
        log.warning("[buzz] digest error: %s", e)
```

```python
    scheduler.add_job(
        _buzz_digest,
        trigger=CronTrigger(day_of_week="mon-fri", hour=16, minute=10, timezone=_ET),
        id="buzz_digest", replace_existing=True, misfire_grace_time=300,
    )
```

`timezone=_ET` is load-bearing — a pre-built trigger resolves tzlocal (UTC on Railway), which would fire this at 11:10 ET.

- [ ] **Step 7: Run the tests**

Run: `cd /c/Users/Patrick/uct-worktrees/discord-buzz && python -m pytest tests/test_buzz_digest.py -v`
Expected: 6 passed.

- [ ] **Step 8: Run the whole buzz suite plus the chart suite**

Run: `cd /c/Users/Patrick/uct-worktrees/discord-buzz && python -m pytest tests/test_buzz_store.py tests/test_buzz_universe.py tests/test_buzz_extract.py tests/test_buzz_ingest.py tests/test_buzz_boards.py tests/test_buzz_command.py tests/api/test_buzz_render_panel.py tests/test_buzz_digest.py tests/test_discord_chart.py -v`
Expected: all green. **Read the summary line** — no pipe, gate on `$?`.

- [ ] **Step 9: Commit and push**

```bash
cd /c/Users/Patrick/uct-worktrees/discord-buzz && \
git add api/services/buzz_image.py api/services/discord_buzz_digest.py \
        api/main.py api/routers/discord_interactions.py tests/test_buzz_digest.py && \
git commit -m "feat(buzz): board PNG via chart-renderer + daily digest (ships disarmed)" && \
git push origin feat/discord-buzz:master
```

- [ ] **Step 10: Verify on the pod, by the artifact**

After the deploy reports SUCCESS (~2 min boot):
1. `railway logs -s web | grep -i buzz` — the poll job should log mention counts.
2. Run `/buzz` in `#dev-chat` on the **dev** server first. Never test in Uncharted Territory without the owner saying so.
3. Judge the image by opening it. A flag-on, scheduled, running job can still write nothing — the artifact is the evidence, not the log line.

---

## Deferred to a follow-up plan

Owner decision 2026-09-01, mid-build: *"let's just start basic here first with what we have, then move on to the additional stuff later."* Everything below is **designed and costed, not built.** It is recorded at this depth so picking it up is a read rather than a fresh brainstorm.

### Extra metrics — the owner picked these three, then parked them with the rest

| Metric | What it shows | Cost |
|---|---|---|
| **Silent movers** — "the room missed" | Names that moved hard today with zero or near-zero mentions | Joins `mentions` against the movers feed (`api.services.massive.get_movers`). One new dependency; the repo already owns it. |
| **Cooling off + New today** | The inverse of Heating Up (loud names gone quiet), and first-timers unseen in 30 days | **Free** — the same window queries `heat_board` already runs, with the ratio inverted and a `NOT EXISTS` over the trailing window |
| **First caller** | Who mentioned each name first today | **Free** — `author_id` and `ts` are already stored; it is `MIN(ts)` per ticker per day |

⚠️ **First caller names individual members on a posted image.** The owner took that tradeoff knowingly after it was spelled out. If it ships, it needs an opt-out, and it should never appear on the `/r/buzz` payload (see Task 8's exposure note) — only in the authenticated command reply and the member-server digest.

### Further ideas, ranked by how hard they are to copy

1. **Room vs the Wire** — cross-reference chat against the Morning Wire Top 5 and UCT20. ⭐ The only item on this list a competitor structurally cannot build: it needs both the wire and the chat, and one party owns both. It is also feedback on the wire itself — "the room ignored 4 of 5 picks" is a product signal, not a vanity metric.
2. **Lead or lag** — first-mention time vs the time of the price move, per name and as a running 30-day verdict on the room. The deepest thing derivable from this data. Needs weeks of history before the aggregate means anything.
3. **Your personal buzz** — private per-member: names you hold or watch that are lit up today. Reuses watchlists + `j2_positions`. Ephemeral, so no privacy question, and the stickiest of the set because it makes the board about the reader.
4. **Themes the room invented** — co-mention clustering, diffed against `themes_taxonomy.json` to catch a theme forming before the taxonomy names it. Most novel; needs a co-occurrence floor or it produces noise on thin days.
5. **The scoreboard** — of the top 5 each day, how many were green the next session. A running hit rate that makes the bot honest about itself.
6. **Room temperature** — distinct tickers today vs normal, and the share of chatter held by the top 3. Offered and declined; recorded because it is two aggregate queries and free.

**Nothing here needs a schema change.** Every one is a query over `mentions` as it already exists, optionally joined to price or wire data. That is the payoff of storing one row per (message × ticker) with the author and timestamp rather than a pre-aggregated daily count.

### Other deferrals

- Trader-feed board (`#tsdr`, `#bracco`, …) as a separate "the desk" view
- Weekly Friday wrap (the daily digest proves the mechanism first)
- Sentiment, DM alerts, Discord↔dashboard account linking
