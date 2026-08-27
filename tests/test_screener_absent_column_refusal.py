"""X27 — a filter naming a column absent from the LIVE table must REFUSE,
never answer silently, and must refuse the SAME WAY with the live overlay on
or off.

⛔ THE MECHANISM (confirmed at ``query.py``'s ``_Overlay.col_expr``, before this
file's fix): with the overlay OFF, a filter column becomes a BARE double-quoted
identifier, `f'"{col}"'`. SQLite's double-quoted-string misfeature degrades an
UNRESOLVABLE double-quoted identifier into a STRING LITERAL — and TEXT sorts
ABOVE every number, so:

    "vol_ratio" >= 3   ->  TRUE for every row   (THE ENTIRE UNIVERSE)
    "vol_ratio" >  3   ->  TRUE for every row
    "vol_ratio" != 3   ->  TRUE for every row
    "vol_ratio" <= 3   ->  FALSE for every row  (silently empty)
    "vol_ratio" <  3   ->  FALSE for every row
    "vol_ratio" =  3   ->  FALSE for every row

⛔ SCREENER FILTERS ARE OVERWHELMINGLY `>=` (rs_rank, vol_ratio, market_cap,
gap_pct), so the COMMON case is not "returns nothing" — it is "the member's
criterion is silently not applied at all," and they get a bigger wrong list
with no signal.

⭐ AND THE TWO OVERLAY STATES DISAGREE ABOUT WHETHER THIS IS EVEN AN ERROR.
With the overlay ON, a column the overlay does not itself own renders
TABLE-QUALIFIED (`screener_rows."col"`), and an unresolvable table-qualified
identifier RAISES (`sqlite3.OperationalError: no such column`) instead of
degrading to a string literal. One runtime flag — whether the live tier is
armed — decided whether a missing column was an exception or a silent wrong
answer. That is why the fix is not "always emit unquoted" or "always
table-qualify": either still leaves the two paths disagreeing about the
MESSAGE. The fix instead REFUSES before either rendering is built, by
consulting the table's REAL, LIVE columns (`PRAGMA table_info`) — never
`snapshot_db.COLUMNS` alone, which is the schema's INTENT and can name a
column `init_db()` has declared but not yet ALTER-added on this pod (⚠️ latent
on any pod whose `init_db()` has not run since the column was declared —
"200/200 columns present" was measured on ONE pod, once, and is not a claim
about prod generally).

⛔⛔ FIX ROUND 1 (reviewed 2026-08-26) added two more layers, below the filter
tests:
  * **F1** — `build_where` only guarded the WHERE clause. A rank criterion, a
    `sort` key and an explicit `columns=` request all name `col_expr` directly
    in `build_scan_sql`, unguarded, and each failed WORSE than a filter did: a
    rank CERTIFIED a fake receipt instead of refusing, a sort was a silent
    no-op, and an explicit column request put the column's own NAME into the
    member's cell as a value. Same fix, same `_known_columns(conn)` check,
    now at all five call sites.
  * **F2** — the refusal is member-facing (it reaches an HTTP 400 verbatim),
    and the first sentence said "pod" (an internals word), named the column
    TWICE for the common case where a filter key equals its own column, and
    read "does not exist" (permanent-sounding, and wrong — this is latency,
    not absence). The sentence is now `_readiness_refusal`, ONE function every
    call site shares, pinned verbatim by a test below.

Every regression test below builds its OWN throwaway `screener.db` in
`tmp_path` and monkeypatches `SCREENER_DB_PATH` — nothing here reads
`C:\\data`.
"""
import importlib
import sqlite3

import pytest

from api.services.screener import query


# ═══════════════════════════════════════════════════════════════════════════
# CONTROL — proves the SQLite mechanism this rail defends against is real.
#
# ⛔ THIS IS THE "DECLARED EXCEPTION THAT QUIETLY RESOLVES" CONTROL, ADAPTED.
# `test_cross_module_imports_resolve.py` guards against a stale KNOWN_DEAD
# allowlist; there is no allowlist here to go stale, but the equivalent risk
# is the ASSUMPTION going stale — SQLite's own docs call the double-quoted-
# string fallback a legacy misfeature it may remove. If a future SQLite ever
# does, this test goes red FIRST, on pure sqlite3 with no app code involved,
# and tells the next reader the rationale for the refusal below needs
# re-examination rather than leaving the refusal to look like it is guarding
# nothing.
# ═══════════════════════════════════════════════════════════════════════════
def test_the_sqlite_misfeature_this_rail_defends_against_is_still_real():
    conn = sqlite3.connect(":memory:")
    conn.execute("CREATE TABLE t (ticker TEXT, price REAL)")
    conn.executemany("INSERT INTO t VALUES (?, ?)",
                      [("A", 1.0), ("B", 2.0), ("C", 5.0)])

    def count(op):
        return conn.execute(
            f'SELECT COUNT(*) FROM t WHERE "vol_ratio" {op} 3').fetchone()[0]

    # bare, unqualified, unresolvable -> string literal -> TEXT sorts above
    # every number
    assert count(">=") == 3, "the universe-return polarity stopped reproducing"
    assert count(">") == 3
    assert count("!=") == 3
    assert count("<=") == 0, "the silent-empty polarity stopped reproducing"
    assert count("<") == 0
    assert count("=") == 0

    # table-qualified, unresolvable -> RAISES, the second (disagreeing) path
    with pytest.raises(sqlite3.OperationalError, match="no such column"):
        conn.execute('SELECT COUNT(*) FROM t WHERE t."vol_ratio" >= 3').fetchone()
    conn.close()


# ─── the fixture: a pod whose init_db() has not (yet) ALTER-added a column ──
#
# `vol_ratio` is trimmed OUT of `snapshot_db.COLUMNS` before `init_db()` runs
# (so the physical table never gets the ALTER), then `COLUMNS` is restored to
# its real, full value — simulating exactly the latent case named above: the
# CODE knows about the column (so a check against `snapshot_db.COLUMNS` alone
# would wrongly wave it through), but THIS POD'S TABLE does not have it yet.
def _pod_missing_a_declared_column(monkeypatch, tmp_path, missing):
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "screener.db"))
    from api.services.screener import snapshot_db as db
    importlib.reload(db)
    real_columns = db.COLUMNS
    trimmed = [c for c in real_columns if c != missing]
    assert len(trimmed) == len(real_columns) - 1, \
        f"{missing!r} is not a real declared column — fixture picked a bad name"
    monkeypatch.setattr(db, "COLUMNS", trimmed)
    db.init_db()
    with db.connect() as c:
        have = {r[1] for r in c.execute("PRAGMA table_info(screener_rows)")}
    assert missing not in have, "the fixture failed to reproduce the gap"
    # upsert while COLUMNS is still TRIMMED, so the INSERT names only the
    # columns the physical table actually has.
    db.upsert_rows([
        {"ticker": "AAA", "sector": "Tech", "uct_composite": 90,
         "snapshot_date": "2026-08-25", "built_at": 1},
        {"ticker": "BBB", "sector": "Tech", "uct_composite": 70,
         "snapshot_date": "2026-08-25", "built_at": 1},
        {"ticker": "CCC", "sector": "Tech", "uct_composite": 50,
         "snapshot_date": "2026-08-25", "built_at": 1},
    ])
    monkeypatch.setattr(db, "COLUMNS", real_columns)  # the CODE knows; the TABLE doesn't
    importlib.reload(query)
    return db


# ═══════════════════════════════════════════════════════════════════════════
# NON-VACUITY — the check must not be a no-op in either direction: it must
# see a large, real column set (never empty/trivial), AND it must not refuse
# a filter on a column that genuinely exists.
# ═══════════════════════════════════════════════════════════════════════════
def test_known_columns_is_not_trivially_empty_or_tiny(tmp_path, monkeypatch):
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "screener.db"))
    from api.services.screener import snapshot_db as db
    importlib.reload(db)
    db.init_db()
    with db.connect() as conn:
        known = query._known_columns(conn)
    assert len(known) > 150, len(known)
    assert "ticker" in known and "rsi14" in known and "vol_ratio" in known


def test_a_filter_on_a_column_that_really_exists_is_not_refused(tmp_path, monkeypatch):
    db = _pod_missing_a_declared_column(monkeypatch, tmp_path, "vol_ratio")
    res = query.run_scan({"filters": [{"key": "uct_composite", "op": "gte", "min": 60}]})
    assert res["total"] == 2, "a legitimate column's filter must keep working"


# ═══════════════════════════════════════════════════════════════════════════
# THE REGRESSION — both polarities, end to end through run_scan (overlay OFF,
# the default with no live tier armed).
# ═══════════════════════════════════════════════════════════════════════════
def test_gte_filter_on_an_absent_column_refuses_instead_of_returning_the_universe(
        tmp_path, monkeypatch):
    _pod_missing_a_declared_column(monkeypatch, tmp_path, "vol_ratio")
    with pytest.raises(ValueError) as exc:
        query.run_scan({"filters": [{"key": "vol_ratio", "op": "gte", "min": 3}]})
    assert "Volume Ratio" in str(exc.value)  # the member-facing LABEL (F2), not the raw key


def test_eq_filter_on_an_absent_column_refuses_instead_of_silently_returning_nothing(
        tmp_path, monkeypatch):
    _pod_missing_a_declared_column(monkeypatch, tmp_path, "vol_ratio")
    with pytest.raises(ValueError) as exc:
        query.run_scan({"filters": [{"key": "vol_ratio", "op": "eq", "value": 3}]})
    assert "Volume Ratio" in str(exc.value)


# ─── the same two polarities, one level down, with the overlay explicitly ON ─
#
# ⭐ `build_where` is exercised directly here (rather than a fully-armed
# `live_tier`), because the refusal must fire BEFORE any SQL is built — a
# manufactured `_Overlay(on=True, ...)` is enough to prove `col_expr` is never
# reached, without needing `screener_live` to physically exist. The overlay
# is deliberately NOT told about `vol_ratio` (`columns=frozenset()`), which
# is what made the pre-fix ON path table-qualify and raise the raw sqlite3
# error this test asserts we no longer see.
def _on_overlay():
    return query._Overlay(on=True, columns=frozenset(), table="screener_live",
                          predicate="1=1", join_params=())


@pytest.mark.parametrize("op,spec", [
    ("gte", {"key": "vol_ratio", "op": "gte", "min": 3}),
    ("eq", {"key": "vol_ratio", "op": "eq", "value": 3}),
])
def test_the_overlay_ON_path_refuses_the_SAME_controlled_way(
        tmp_path, monkeypatch, op, spec):
    db = _pod_missing_a_declared_column(monkeypatch, tmp_path, "vol_ratio")
    with db.connect() as conn:
        with pytest.raises(ValueError) as exc:
            query.build_where([spec], overlay=_on_overlay(), conn=conn)
    # ⛔ THE POINT: our OWN named refusal, not sqlite3's raw
    # "no such column" — the two overlay states must fail identically.
    assert not isinstance(exc.value, sqlite3.OperationalError)
    assert "Volume Ratio" in str(exc.value)


def test_both_overlay_states_produce_the_identical_refusal_text(tmp_path, monkeypatch):
    """⭐ 'refuse identically' means the MESSAGE does not depend on overlay
    state — a member-facing 400 should read the same regardless of which
    runtime flag happened to be armed when they hit it."""
    db = _pod_missing_a_declared_column(monkeypatch, tmp_path, "vol_ratio")
    spec = [{"key": "vol_ratio", "op": "gte", "min": 3}]
    with db.connect() as conn:
        with pytest.raises(ValueError) as off_exc:
            query.build_where(spec, overlay=query.OFF, conn=conn)
        with pytest.raises(ValueError) as on_exc:
            query.build_where(spec, overlay=_on_overlay(), conn=conn)
    assert str(off_exc.value) == str(on_exc.value)


def test_a_field_to_field_comparison_against_an_absent_column_also_refuses(
        tmp_path, monkeypatch):
    """The RHS of a `_col` comparison goes through the identical `col_expr`
    call as the LHS — same defect class, so it needs the same refusal."""
    db = _pod_missing_a_declared_column(monkeypatch, tmp_path, "vol_ratio")
    with db.connect() as conn:
        with pytest.raises(ValueError) as exc:
            query.build_where(
                [{"key": "price", "op": "gte_col", "other": "vol_ratio"}],
                overlay=query.OFF, conn=conn)
    assert "Volume Ratio" in str(exc.value)


def test_the_refusal_sentence_is_pinned_member_facing_and_names_the_label_once(
        tmp_path, monkeypatch):
    _pod_missing_a_declared_column(monkeypatch, tmp_path, "vol_ratio")
    with pytest.raises(ValueError) as exc:
        query.run_scan({"filters": [{"key": "vol_ratio", "op": "gte", "min": 3}]})
    msg = str(exc.value)
    assert msg == "Volume Ratio isn't ready on this screen yet " + chr(8212) + " remove it and try again"
    assert "pod" not in msg.lower(), "an internals word no trader has a mental model for"
    assert msg.count("Volume Ratio") == 1, "the label must not be said twice"
    assert "vol_ratio" not in msg, "the raw internal column name must never reach a member"
    assert "does not exist" not in msg, \
        "permanent-sounding and wrong -- this is latency (_known_columns), not absence"


def test_the_pinned_sentence_is_the_SAME_function_every_refusal_site_calls():
    assert query._readiness_refusal("Volume Ratio").args[0] == \
        "Volume Ratio isn't ready on this screen yet " + chr(8212) + " remove it and try again"
    import inspect
    src = inspect.getsource(query.build_scan_sql) + inspect.getsource(query.build_where)
    # 5 call sites: build_where's filter LHS + field-to-field RHS, and
    # build_scan_sql's rank criterion + sort key + explicit columns request.
    assert src.count("_readiness_refusal(") == 5, src.count("_readiness_refusal(")


def test_a_rank_criterion_on_an_absent_column_refuses_instead_of_certifying_a_fake_receipt(
        tmp_path, monkeypatch):
    _pod_missing_a_declared_column(monkeypatch, tmp_path, "vol_ratio")
    with pytest.raises(ValueError) as exc:
        query.run_scan({"rank": {"criteria": [{"key": "vol_ratio", "weight": 1}]}})
    assert "Volume Ratio" in str(exc.value)


def test_sorting_by_an_absent_column_refuses_instead_of_a_silent_noop(tmp_path, monkeypatch):
    _pod_missing_a_declared_column(monkeypatch, tmp_path, "vol_ratio")
    with pytest.raises(ValueError) as exc:
        query.run_scan({"sort": {"key": "vol_ratio"}})
    assert "Volume Ratio" in str(exc.value)


def test_requesting_an_absent_column_explicitly_refuses_instead_of_leaking_the_literal_name(
        tmp_path, monkeypatch):
    _pod_missing_a_declared_column(monkeypatch, tmp_path, "vol_ratio")
    with pytest.raises(ValueError) as exc:
        query.run_scan({"columns": ["vol_ratio"]})
    assert "Volume Ratio" in str(exc.value)


@pytest.mark.parametrize("label,spec", [
    ("rank", {"rank": {"criteria": [{"key": "vol_ratio", "weight": 1}]}}),
    ("sort", {"sort": {"key": "vol_ratio"}}),
    ("columns", {"columns": ["vol_ratio"]}),
])
def test_rank_sort_and_columns_all_refuse_the_SAME_controlled_way_with_the_overlay_ON(
        tmp_path, monkeypatch, label, spec):
    db = _pod_missing_a_declared_column(monkeypatch, tmp_path, "vol_ratio")
    with db.connect() as conn:
        with pytest.raises(ValueError) as exc:
            query.build_scan_sql(spec, overlay=_on_overlay(), conn=conn)
    assert not isinstance(exc.value, sqlite3.OperationalError)
    assert "Volume Ratio" in str(exc.value)


def test_a_rank_columns_and_sort_request_on_columns_that_really_exist_still_work(
        tmp_path, monkeypatch):
    _pod_missing_a_declared_column(monkeypatch, tmp_path, "vol_ratio")
    res = query.run_scan({
        "rank": {"criteria": [{"key": "uct_composite", "weight": 1}]},
        "sort": {"key": "uct_composite"},
        "columns": ["uct_composite"],
    })
    assert res["total"] == 3
    assert res["rank"]["excluded_incomplete"] == 0
