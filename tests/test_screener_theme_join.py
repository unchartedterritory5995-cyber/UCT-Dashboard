"""`theme_join` — the taxonomy reader, and the four ways it refuses to guess.

Every test builds its OWN taxonomy in a `tmp_path` SQLite file and points
`auth_db._DB_PATH` at it, so nothing here reads the box's real `auth.db` (the
repo-root conftest already redirects `AUTH_DB_PATH`; this pins the module
global the connection helper actually dereferences, which a `setenv` alone
would not reach — `auth_db` captures it at import).

`theme_performance.compute_rotation_signals` is patched in EVERY test. Left
real it walks a cold cache into `get_theme_performance`, which starts a
`theme-perf-compute` daemon thread and reaches yfinance/Massive — a test that
quietly warms a provider is not a fixture, it is a side effect.

What each test protects, and the mutation that must turn it red, is stated on
the test. The verdict is the pytest exit code, not the prose.
"""
import sqlite3

import pytest

_SEEDED = "2026-07-26 03:29:56"


# ─────────────────────────── fixture plumbing ────────────────────────────

def _make_db(path, *, sectors=(("tech", "Technology"),), themes=(),
             memberships=(), engine=(), seed_version="4.22.0",
             with_engine_table=True, updated_at=_SEEDED):
    """A minimal auth.db carrying only the tables the taxonomy read touches.

    Schema copied field-for-field from `theme_db.init_theme_tables()` +
    `theme_engine/store.py` + `auth_db._SCHEMA` so the reader meets the real
    column names; the fixture never imports those modules to build it, so a
    schema drift shows up as a failing test rather than as a fixture that
    silently follows the code under test.
    """
    conn = sqlite3.connect(str(path))
    conn.executescript("""
        CREATE TABLE theme_sectors (id TEXT PRIMARY KEY, name TEXT NOT NULL,
                                    display_order INTEGER DEFAULT 0,
                                    updated_at TEXT);
        CREATE TABLE themes (id TEXT PRIMARY KEY, name TEXT NOT NULL,
                             sector_id TEXT NOT NULL, etf_ticker TEXT,
                             etf_name TEXT, display_order INTEGER DEFAULT 0,
                             sub_themes TEXT, updated_at TEXT);
        CREATE TABLE theme_memberships (
            id INTEGER PRIMARY KEY AUTOINCREMENT, theme_id TEXT NOT NULL,
            sym TEXT NOT NULL, tier TEXT NOT NULL DEFAULT 'relevant',
            sub_theme_id TEXT, rationale TEXT, updated_at TEXT,
            UNIQUE(theme_id, sym));
        CREATE TABLE user_preferences (id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
            pref_key TEXT NOT NULL, pref_value TEXT, UNIQUE(user_id, pref_key));
    """)
    if with_engine_table:
        conn.executescript("""
            CREATE TABLE engine_memberships (
                id INTEGER PRIMARY KEY AUTOINCREMENT, theme_id TEXT NOT NULL,
                sym TEXT NOT NULL, tier TEXT, sub_theme_id TEXT,
                confidence REAL, rationale TEXT,
                action TEXT NOT NULL DEFAULT 'add',
                status TEXT NOT NULL DEFAULT 'proposed',
                audit_low_count INTEGER NOT NULL DEFAULT 0, last_audit_at TEXT,
                created_at TEXT, created_run_id TEXT,
                updated_at TEXT, updated_run_id TEXT);
        """)
    for sid, sname in sectors:
        conn.execute("INSERT INTO theme_sectors (id, name) VALUES (?, ?)", (sid, sname))
    for t in themes:
        conn.execute(
            "INSERT INTO themes (id, name, sector_id, etf_ticker, sub_themes, updated_at)"
            " VALUES (?, ?, ?, ?, '[]', ?)",
            (t[0], t[1], t[2] if len(t) > 2 else "tech",
             t[3] if len(t) > 3 else None, updated_at))
    for m in memberships:
        conn.execute(
            "INSERT INTO theme_memberships (theme_id, sym, tier, rationale, updated_at)"
            " VALUES (?, ?, ?, ?, ?)",
            (m[0], m[1], m[2], "hand written", m[3] if len(m) > 3 else updated_at))
    for e in engine:
        conn.execute(
            "INSERT INTO engine_memberships (theme_id, sym, tier, action, updated_at)"
            " VALUES (?, ?, ?, 'add', ?)", (e[0], e[1], e[2], updated_at))
    if seed_version:
        conn.execute("INSERT INTO user_preferences (id, user_id, pref_key, pref_value)"
                     " VALUES ('tsv', 'system', 'theme_seed_version', ?)", (seed_version,))
    conn.commit()
    conn.close()
    return path


class _CountingConnection:
    """Wraps a real connection and records every SQL statement executed
    through it. Only `execute`/`executemany` are intercepted; everything else
    delegates, so `theme_db` cannot tell the difference."""

    def __init__(self, conn, log):
        self._conn = conn
        self._log = log

    def execute(self, sql, *args, **kwargs):
        self._log.append(sql)
        return self._conn.execute(sql, *args, **kwargs)

    def executemany(self, sql, *args, **kwargs):
        self._log.append(sql)
        return self._conn.executemany(sql, *args, **kwargs)

    def __getattr__(self, name):
        return getattr(self._conn, name)


@pytest.fixture
def taxonomy(monkeypatch, tmp_path):
    """Builds a taxonomy DB, points the app at it, and neutralises rotation.

    Returns a builder: `taxonomy(themes=..., memberships=..., rankings=...)`
    -> the imported `theme_join` module. Also exposes `.sql` (every statement
    the taxonomy read ran) for the bulk-read proof.
    """
    state = {"sql": []}

    def build(*, rankings=None, **kwargs):
        db = _make_db(tmp_path / "auth.db", **kwargs)
        from api.services import auth_db, theme_db, theme_performance
        monkeypatch.setattr(auth_db, "_DB_PATH", str(db))
        real_connect = auth_db.get_connection

        def counting():
            return _CountingConnection(real_connect(), state["sql"])

        # ⚠️ `theme_db` does `from api.services.auth_db import get_connection`,
        # so it holds its OWN binding — patching `auth_db.get_connection`
        # alone counts nothing and the N+1 guard passes vacuously. (It did,
        # once; the `few > 0` control below is why that was caught.) The
        # module-global `_DB_PATH` patch above still reaches both, because
        # the shared function dereferences it at call time.
        monkeypatch.setattr(auth_db, "get_connection", counting)
        monkeypatch.setattr(theme_db, "get_connection", counting)
        monkeypatch.setattr(theme_performance, "compute_rotation_signals",
                            lambda: {"rankings": rankings or {}})
        from api.services.screener import theme_join
        return theme_join

    build.sql = state["sql"]
    build.state = state
    return build


_THEMES = (("neocloud", "Neocloud", "tech", None),
           ("semis", "Semiconductors", "tech", "SMH"),
           ("meme_retail", "Meme & Retail", "tech", None))


# ───────────────────────────── the happy path ────────────────────────────

def test_a_core_member_gets_its_tier_and_its_theme_count(taxonomy):
    """The fact the collapsed TEXT `theme` column throws away. MUTATION: drop
    the `row["theme_tier"] = tier` assign, or count membership ROWS instead of
    distinct themes."""
    tj = taxonomy(themes=_THEMES,
                  memberships=(("neocloud", "CRWV", "core"),
                               ("semis", "CRWV", "peripheral"),
                               ("semis", "NVDA", "core")))
    out = tj.read_theme_fields(["CRWV", "NVDA"])

    assert out["CRWV"] == {"theme_tier": "core", "theme_count": 2}
    assert out["NVDA"] == {"theme_tier": "core", "theme_count": 1}


def test_the_tier_is_the_best_one_held_not_the_first_row_read(taxonomy):
    """`core` beats `relevant` beats `peripheral` via `groups._TIER_RANK`,
    whatever order the rows arrive in. MUTATION: use `max` instead of `min`,
    or sort by theme id."""
    tj = taxonomy(themes=_THEMES,
                  memberships=(("semis", "AMD", "peripheral"),
                               ("neocloud", "AMD", "relevant")))
    assert tj.read_theme_fields(["AMD"])["AMD"]["theme_tier"] == "relevant"


def test_a_hyphen_class_share_target_finds_its_dot_form_taxonomy_row(taxonomy):
    """`cap_universe` says `BRK-B`; the taxonomy stores `BRK.B` (measured: the
    one dotted symbol in the store). The output is keyed by the TARGET's form
    so `snapshot_builder`'s `theme_map.get(T)` hits. MUTATION: drop the
    `to_taxonomy_sym` call."""
    tj = taxonomy(themes=_THEMES, memberships=(("neocloud", "BRK.B", "core"),))
    out = tj.read_theme_fields(["BRK-B"])
    assert "BRK-B" in out and out["BRK-B"]["theme_tier"] == "core"
    assert "BRK.B" not in out


# ───────────────── absent is not zero — the honesty contract ─────────────

def test_a_symbol_outside_the_taxonomy_is_absent_never_theme_count_zero(taxonomy):
    """🔴 THE ONE THAT MATTERS. The taxonomy is a curation, not a census:
    ~2,400 `cap_universe` names were never curated, and `theme_count = 0`
    would claim the owner looked and found nothing. MUTATION: emit
    `{"theme_count": 0}` for an unmatched target."""
    tj = taxonomy(themes=_THEMES, memberships=(("neocloud", "CRWV", "core"),))
    out = tj.read_theme_fields(["CRWV", "NOTCURATED"])

    assert "NOTCURATED" not in out
    assert out.get("NOTCURATED", {}).get("theme_count") is None
    assert set(out) == {"CRWV"}


def test_a_blank_tier_omits_the_tier_keeps_the_count_and_is_counted(taxonomy):
    """A malformed row. The membership still proves the name is in the theme,
    so it counts; the tier is unknown and stays unknown rather than defaulting
    to `relevant`. MUTATION: fall back to a default tier string."""
    tj = taxonomy(themes=_THEMES, memberships=(("neocloud", "GHOST", ""),))
    failures = {}
    row = tj.read_theme_fields(["GHOST"], failures=failures)["GHOST"]

    assert row == {"theme_count": 1}
    assert "theme_tier" not in row
    assert failures["theme_join"]["blank_tier"] == 1


def test_an_unrecognised_tier_is_served_verbatim_and_reported(taxonomy):
    """`_TIER_RANK` sorts an unknown tier last silently. The value is the
    owner's, so it ships; the fact that the vocabulary moved does not stay
    silent. MUTATION: drop the `tier_unrecognised` note."""
    tj = taxonomy(themes=_THEMES, memberships=(("neocloud", "ODD", "watchlist"),))
    failures = {}
    row = tj.read_theme_fields(["ODD"], failures=failures)["ODD"]

    assert row["theme_tier"] == "watchlist"
    assert failures["theme_join"]["tier_unrecognised:watchlist"] == 1


def test_a_dead_taxonomy_returns_empty_and_counts_the_failure(taxonomy, monkeypatch):
    """A raising store must degrade to "every column not computable", never
    take the nightly down and never look like an empty taxonomy. MUTATION:
    let the exception propagate, or return {} without the note."""
    tj = taxonomy(themes=_THEMES, memberships=(("neocloud", "CRWV", "core"),))
    from api.services import theme_db

    def boom():
        raise sqlite3.OperationalError("no such table: theme_memberships")

    monkeypatch.setattr(theme_db, "get_all_themes", boom)
    failures = {}
    assert tj.read_theme_fields(["CRWV"], failures=failures) == {}
    assert failures["theme_join"]["OperationalError"] == 1

    # …and it does not raise when nobody passes a failures dict either.
    assert tj.read_theme_fields(["CRWV"]) == {}


def test_an_empty_taxonomy_returns_empty_and_is_counted_separately(taxonomy):
    """An unseeded DB is "cannot answer", not "nobody is in a theme".
    MUTATION: return a dict of empty rows instead of {}."""
    tj = taxonomy(themes=(), memberships=())
    failures = {}
    assert tj.read_theme_fields(["CRWV"], failures=failures) == {}
    assert failures["theme_join"]["empty"] == 1


def test_the_emitted_key_set_never_drifts_past_the_declared_columns(taxonomy):
    """The integration contract is a promise about column names. MUTATION: add
    a key to a row without declaring it in `THEME_COLUMNS`."""
    tj = taxonomy(themes=_THEMES,
                  memberships=(("neocloud", "CRWV", "core"),),
                  rankings={"neocloud": {"name": "Neocloud", "ticker": "neocloud",
                                         "1w_rank": 91.2, "1m_rank": 40.0}})
    emitted = set()
    for row in tj.read_theme_fields(["CRWV"]).values():
        emitted |= set(row)

    assert emitted <= set(tj.THEME_COLUMNS)
    assert emitted == {"theme_tier", "theme_count",
                       "theme_rot_pctile_1w", "theme_rot_pctile_1m"}
    # Disjoint from the column this reader must never re-answer.
    assert "theme" not in tj.THEME_COLUMNS
    assert all(c.startswith("theme_") for c in tj.THEME_COLUMNS)


# ──────────────────────────── the read is BULK ───────────────────────────

def test_the_read_runs_the_same_sql_for_two_targets_and_for_four_hundred(taxonomy):
    """⛔ N+1 GUARD. A per-ticker query here is ~3,700 scans of the taxonomy
    per build. The statement count must be a constant of the SOURCE, not a
    function of the target list. MUTATION: move the membership read inside the
    per-target loop."""
    tj = taxonomy(themes=_THEMES,
                  memberships=tuple(("neocloud", f"SYM{i}", "core") for i in range(400)))

    taxonomy.state["sql"].clear()
    tj.read_theme_fields(["SYM0", "SYM1"])
    few = len(taxonomy.state["sql"])

    taxonomy.state["sql"].clear()
    tj.read_theme_fields([f"SYM{i}" for i in range(400)])
    many = len(taxonomy.state["sql"])

    assert few == many, f"statement count scaled with targets: {few} -> {many}"
    assert few <= 8, f"{few} statements for one bulk read is not one bulk read"
    # Control: the counter CAN see a query, so equality is not vacuous.
    assert few > 0


# ───────── the tier agrees with the theme the `theme` column names ────────

def test_theme_tier_agrees_with_what_resolve_primary_theme_picks(taxonomy):
    """⭐ THE ANTI-SECOND-AUTHORITY RAIL. `snapshot_builder`'s `theme` column
    comes from `groups.resolve_primary_theme`; this reader must not disagree
    with it on the same row. Pinned against the REAL function over a symbol
    with three memberships at three tiers in three differently-sized themes,
    so the size tiebreak is live. MUTATION: sort by theme size before tier."""
    tj = taxonomy(themes=(("neocloud", "Neocloud", "tech", None),
                          ("semis", "Semiconductors", "tech", "SMH"),
                          ("software", "Software", "tech", "IGV")),
                  memberships=(("neocloud", "MULTI", "peripheral"),
                               ("semis", "MULTI", "core"),
                               ("software", "MULTI", "relevant"),
                               # bulk out `semis` so it is the BIGGEST theme —
                               # if size outranked tier the pick would move
                               ("semis", "FILL1", "relevant"),
                               ("semis", "FILL2", "relevant"),
                               ("software", "FILL3", "relevant")))
    from api.services import groups
    groups.invalidate_sizes()
    primary = groups.resolve_primary_theme("MULTI")

    assert primary is not None
    assert tj.read_theme_fields(["MULTI"])["MULTI"]["theme_tier"] == primary["tier"]
    groups.invalidate_sizes()


def test_a_factor_bucket_is_excluded_exactly_as_the_theme_column_excludes_it(taxonomy):
    """`resolve_primary_theme` refuses factor buckets, so a name whose ONLY
    membership is one has a NULL `theme`. Giving it a tier here would put a
    tier beside a blank theme. Measured: 9 symbols on this box. MUTATION: drop
    the `factor_names` filter."""
    tj = taxonomy(themes=_THEMES,
                  memberships=(("meme_retail", "AMC", "core"),
                               ("neocloud", "CRWV", "core"),
                               ("meme_retail", "CRWV", "core")))
    out = tj.read_theme_fields(["AMC", "CRWV"])

    assert "AMC" not in out
    # …and CRWV's factor membership does not inflate its footprint either.
    assert out["CRWV"]["theme_count"] == 1


# ───────────────── owner precedence — hard constraint (1) ────────────────

def test_an_overlay_add_never_moves_a_symbol_the_owner_already_classified(taxonomy):
    """⛔ Engine-sourced memberships must never be counted into owner
    aggregates. A symbol with any owner row is described by its owner rows
    alone, so a background absorption cannot silently change a member-facing
    tier or count overnight. MUTATION: use the merged rows unconditionally."""
    tj = taxonomy(themes=_THEMES,
                  memberships=(("neocloud", "CRWV", "peripheral"),),
                  engine=(("semis", "CRWV", "core"),))
    row = tj.read_theme_fields(["CRWV"])["CRWV"]

    assert row["theme_tier"] == "peripheral"
    assert row["theme_count"] == 1


def test_a_symbol_the_owner_never_classified_is_described_by_the_overlay(taxonomy):
    """The other half of owner PRECEDENCE (not owner-only): an absorbed orphan
    has an engine-derived `theme` too, so withholding its tier would leave a
    named theme beside a blank tier. MUTATION: filter engine rows out entirely."""
    tj = taxonomy(themes=_THEMES, memberships=(),
                  engine=(("semis", "ORPHAN", "relevant"),))
    row = tj.read_theme_fields(["ORPHAN"])["ORPHAN"]

    assert row == {"theme_tier": "relevant", "theme_count": 1}


def test_a_pre_migration_database_with_no_overlay_table_still_answers(taxonomy):
    """`theme_db` falls back to an owner-only read when `engine_memberships`
    does not exist. That must reach a column, not an exception. MUTATION: make
    the reader require the overlay table."""
    tj = taxonomy(themes=_THEMES, memberships=(("neocloud", "CRWV", "core"),),
                  with_engine_table=False)
    assert tj.read_theme_fields(["CRWV"])["CRWV"]["theme_tier"] == "core"


# ───────────────────────── rotation percentiles ──────────────────────────

def test_the_percentiles_are_theme_performance_s_own_numbers_verbatim(taxonomy):
    """`theme_performance` owns the ranking. This consumes `1w_rank`/`1m_rank`
    unchanged — no re-rank, no re-round, no derived delta. MUTATION: recompute
    a percentile, round it, or add a `theme_momentum_delta` key."""
    tj = taxonomy(themes=_THEMES,
                  memberships=(("neocloud", "CRWV", "core"),),
                  rankings={"neocloud": {"name": "Neocloud", "ticker": "neocloud",
                                         "1w_rank": 91.2, "1m_rank": 40.7,
                                         "momentum_delta": 50.5}})
    row = tj.read_theme_fields(["CRWV"])["CRWV"]

    assert row["theme_rot_pctile_1w"] == 91.2
    assert row["theme_rot_pctile_1m"] == 40.7
    assert "theme_momentum_delta" not in row


def test_the_pair_comes_from_one_theme_the_hottest_never_a_mix(taxonomy):
    """A name in two themes takes BOTH percentiles from the theme with the
    higher 1-week rank — a 1w from one theme beside a 1m from another is a
    number that describes nothing. MUTATION: take max(1w) and max(1m)
    independently."""
    tj = taxonomy(themes=_THEMES,
                  memberships=(("neocloud", "CRWV", "core"),
                               ("semis", "CRWV", "core")),
                  rankings={"neocloud": {"name": "Neocloud", "ticker": "neocloud",
                                         "1w_rank": 91.2, "1m_rank": 12.0},
                            "SMH": {"name": "Semiconductors", "ticker": "SMH",
                                    "1w_rank": 60.0, "1m_rank": 99.9}})
    row = tj.read_theme_fields(["CRWV"])["CRWV"]

    assert row["theme_rot_pctile_1w"] == 91.2
    assert row["theme_rot_pctile_1m"] == 12.0


def test_an_etf_backed_theme_is_matched_by_its_etf_ticker_key(taxonomy):
    """`compute_rotation_signals` keys `rankings` by the WIRE ticker — the
    etf_ticker for ETF-backed themes, the theme id for curated-only ones.
    Matching on the id alone would silently drop every ETF-backed theme to
    "no rank". MUTATION: look the entry up by theme id only."""
    tj = taxonomy(themes=_THEMES,
                  memberships=(("semis", "NVDA", "core"),),
                  rankings={"SMH": {"name": "Semiconductors", "ticker": "SMH",
                                    "1w_rank": 77.0, "1m_rank": 55.0}})
    assert tj.read_theme_fields(["NVDA"])["NVDA"]["theme_rot_pctile_1w"] == 77.0


def test_a_theme_with_no_rank_yet_omits_the_percentiles_never_zero(taxonomy):
    """0 is the WORST percentile on the board, which is the opposite of
    unknown — a member screening `theme_rot_pctile_1w < 10` would be handed
    every unranked theme. MUTATION: default a missing rank to 0."""
    tj = taxonomy(themes=_THEMES,
                  memberships=(("neocloud", "CRWV", "core"),),
                  rankings={"neocloud": {"name": "Neocloud", "ticker": "neocloud",
                                         "1w_rank": None, "1m_rank": None}})
    row = tj.read_theme_fields(["CRWV"])["CRWV"]

    assert row == {"theme_tier": "core", "theme_count": 1}


def test_a_ranked_1w_with_no_1m_emits_only_the_one_it_has(taxonomy):
    """Half an answer is still an answer; the missing half stays missing.
    MUTATION: emit both or neither."""
    tj = taxonomy(themes=_THEMES,
                  memberships=(("neocloud", "CRWV", "core"),),
                  rankings={"neocloud": {"name": "Neocloud", "ticker": "neocloud",
                                         "1w_rank": 88.0, "1m_rank": None}})
    row = tj.read_theme_fields(["CRWV"])["CRWV"]

    assert row["theme_rot_pctile_1w"] == 88.0
    assert "theme_rot_pctile_1m" not in row


def test_a_cold_rotation_cache_costs_only_the_percentiles_and_is_counted(taxonomy):
    """`compute_rotation_signals` returns empty rankings on a cold
    theme-performance cache — a real post-deploy state. The taxonomy columns
    must survive it and the gap must be named. MUTATION: return {} from the
    whole reader when rotation is unavailable."""
    tj = taxonomy(themes=_THEMES, memberships=(("neocloud", "CRWV", "core"),),
                  rankings={})
    failures = {}
    row = tj.read_theme_fields(["CRWV"], failures=failures)["CRWV"]

    assert row == {"theme_tier": "core", "theme_count": 1}
    assert failures["theme_rotation"]["rotation_empty"] == 1


def test_a_raising_rotation_source_costs_only_the_percentiles(taxonomy, monkeypatch):
    """Separate failure domains: `theme_performance` blowing up must not cost
    the taxonomy answer. MUTATION: hoist the rotation call out of its try."""
    tj = taxonomy(themes=_THEMES, memberships=(("neocloud", "CRWV", "core"),))
    from api.services import theme_performance

    def boom():
        raise RuntimeError("massive is down")

    monkeypatch.setattr(theme_performance, "compute_rotation_signals", boom)
    failures = {}
    row = tj.read_theme_fields(["CRWV"], failures=failures)["CRWV"]

    assert row == {"theme_tier": "core", "theme_count": 1}
    assert failures["theme_rotation"]["RuntimeError"] == 1


def test_the_rotation_leg_is_killable_by_env_without_touching_the_taxonomy(
        taxonomy, monkeypatch):
    """The call reaches a provider and can start a background recompute, so it
    has an off switch — exercised here, because a rollback nobody has run is
    not a rollback. MUTATION: ignore the env var."""
    monkeypatch.setenv("SCREENER_THEME_ROTATION", "0")
    tj = taxonomy(themes=_THEMES, memberships=(("neocloud", "CRWV", "core"),),
                  rankings={"neocloud": {"name": "Neocloud", "ticker": "neocloud",
                                         "1w_rank": 91.2, "1m_rank": 40.7}})
    failures = {}
    row = tj.read_theme_fields(["CRWV"], failures=failures)["CRWV"]

    assert row == {"theme_tier": "core", "theme_count": 1}
    assert failures["theme_rotation"]["disabled"] == 1


# ─────────────────────────────── freshness ───────────────────────────────

def test_taxonomy_asof_reports_the_seed_stamp_its_version_and_its_age(taxonomy):
    """The ONE derivation of the taxonomy's age, for the manifest layer to
    consume instead of computing a second one. MUTATION: return the row count
    without the stamp, or hard-code an age."""
    tj = taxonomy(themes=_THEMES,
                  memberships=(("neocloud", "CRWV", "core"),
                               ("semis", "NVDA", "core")))
    asof = tj.taxonomy_asof()

    assert asof["owner_updated_at"] == _SEEDED
    assert asof["owner_rows"] == 2
    assert asof["seed_version"] == "4.22.0"
    assert asof["owner_age_days"] > 14        # the store's real state today
    assert asof["engine_rows"] == 0


def test_taxonomy_asof_survives_a_database_with_no_overlay_table(taxonomy):
    """The owner answer must not depend on the overlay migration having run.
    MUTATION: drop the guard around the engine query."""
    tj = taxonomy(themes=_THEMES, memberships=(("neocloud", "CRWV", "core"),),
                  with_engine_table=False)
    asof = tj.taxonomy_asof()

    assert asof["owner_rows"] == 1
    assert asof["engine_rows"] == 0


def test_a_stale_taxonomy_is_named_with_its_age_never_served_as_current(taxonomy):
    """⛔ All 2,029 memberships share ONE `updated_at` — a bulk seed, 28 days
    old when this was written, with the engine meant to refresh it at 0 rows.
    The build census says how old, by number. MUTATION: drop the note, or
    raise the threshold above the store's real age."""
    tj = taxonomy(themes=_THEMES, memberships=(("neocloud", "CRWV", "core"),))
    failures = {}
    tj.read_theme_fields(["CRWV"], failures=failures)

    stale = [k for k in failures["theme_join"] if k.startswith("stale_taxonomy:")]
    assert len(stale) == 1
    assert int(stale[0].split(":")[1].rstrip("d")) > 14


def test_a_freshly_seeded_taxonomy_raises_no_staleness_note(taxonomy):
    """The control for the test above: the note is a MEASUREMENT of the store,
    not something the reader always says. MUTATION: emit the note
    unconditionally — this goes red while the stale test stays green."""
    from datetime import datetime, timedelta, timezone
    fresh = (datetime.now(timezone.utc) - timedelta(days=1)).strftime("%Y-%m-%d %H:%M:%S")
    tj = taxonomy(themes=_THEMES, memberships=(("neocloud", "CRWV", "core"),),
                  updated_at=fresh)
    failures = {}
    tj.read_theme_fields(["CRWV"], failures=failures)

    assert not [k for k in failures.get("theme_join", {})
                if k.startswith("stale_taxonomy:")]


def test_the_freshness_probe_never_costs_the_columns(taxonomy, monkeypatch):
    """A probe is a bonus on top of an already-answered read. MUTATION: let
    the probe's failure return {} from the reader."""
    tj = taxonomy(themes=_THEMES, memberships=(("neocloud", "CRWV", "core"),))
    monkeypatch.setattr(tj, "_auth_db_uri", lambda: None)
    failures = {}
    row = tj.read_theme_fields(["CRWV"], failures=failures)["CRWV"]

    assert row == {"theme_tier": "core", "theme_count": 1}
    assert failures["theme_asof"]["no_db_path"] == 1
