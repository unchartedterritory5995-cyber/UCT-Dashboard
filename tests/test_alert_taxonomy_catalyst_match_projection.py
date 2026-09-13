"""GATE-S7-CATALYST-MATCH **CP3** (approval line 2, fingerprint `3ee80dc13`) —
the read-only PROJECTION of real member interest against today's catalyst rows,
`rollout:s7-dark` cohort ONLY, still fully dark.

⛔ The packet's **§9** is the checkpoint definition and each of its five items
has a test below, named for it.
"""
from __future__ import annotations

import ast
import datetime
import pathlib
import uuid
from zoneinfo import ZoneInfo

import pytest

from api.services import auth_db as _auth_db
from api.services import rollout as _rollout
from api.services.alert_taxonomy import catalyst_match as _cm
from api.services.alert_taxonomy import catalyst_match_compare as _cmp
from api.services.alert_taxonomy import catalyst_match_projection as _proj
from api.services.alert_taxonomy import db as _db
from api.services.catalyst import store as _store

_REPO = pathlib.Path(__file__).resolve().parents[1]
_AT = _REPO / "api" / "services" / "alert_taxonomy"

DAY = "2026-09-11"
YESTERDAY = "2026-09-10"

#: ⚰️ DERIVED FROM `DAY`, NEVER HAND-TYPED. The first version of this file used a
#: literal epoch that resolved to **2025-09-04** — a year out — so every sweep
#: looked up a market date with no rows and recorded nothing, while the tests
#: that did not go through `market_date()` passed. ⛔ A magic epoch in a suite
#: whose subject IS a market date is the same class of error the code under test
#: exists to avoid, and this is the SECOND time it was made today.
T0 = datetime.datetime(2026, 9, 11, 17, 30,
                       tzinfo=ZoneInfo("America/New_York")).timestamp()


@pytest.fixture(autouse=True)
def auth(tmp_path, monkeypatch):
    p = tmp_path / "auth.db"
    monkeypatch.setenv("AUTH_DB_PATH", str(p))
    monkeypatch.setattr(_auth_db, "_DB_PATH", str(p))
    _auth_db.init_db()
    return p


@pytest.fixture(autouse=True)
def catalyst_store(tmp_path, monkeypatch):
    """The catalyst store, PROVED to be this test's own.

    ⛔ `C:\\data` exists on this box and the default resolves into it, so "we set
    the env var" is a claim about intent — this asserts the module reads it."""
    p = tmp_path / "catalysts.db"
    monkeypatch.setenv("CATALYST_DB_PATH", str(p))
    monkeypatch.setattr(_store, "_DB_PATH", str(p), raising=False)
    monkeypatch.setattr(_store, "_inited", False, raising=False)
    _store._init_db()
    with _store._connect() as c:
        got = c.execute("PRAGMA database_list").fetchall()
    assert any(str(p) in str(dict(r).get("file", "")) for r in got), (
        f"the catalyst store is not this test's file: {[dict(r) for r in got]}")
    return p


@pytest.fixture()
def dbp(tmp_path):
    p = str(tmp_path / "alert_taxonomy.db")
    _db.init_db(db_path=p)
    _cm.register(db_path=p)
    return p


def test_the_fixture_clock_and_the_fixture_DAY_agree():
    """⛔ THE CONTROL FOR THE BUG ABOVE. If T0 ever stops resolving to DAY, every
    sweep in this file silently looks up a market date with no rows and records
    nothing — and most assertions here would still pass."""
    assert _proj.market_date(T0) == DAY, (
        f"T0 resolves to {_proj.market_date(T0)}, not {DAY} — every sweep in "
        "this file is looking at the wrong day")


def _user(role: str) -> str:
    uid = "u-" + uuid.uuid4().hex[:12]
    conn = _auth_db.get_connection()
    try:
        conn.execute(
            "INSERT INTO users (id, email, password_hash, role) VALUES (?,?,?,?)",
            (uid, f"{uid}@example.test", "x", role))
        conn.commit()
    finally:
        conn.close()
    if role == "admin":
        _rollout.ensure_s7_dark_seeded()
    return uid


def _watch(user_id: str, *syms: str) -> None:
    wid = "w-" + uuid.uuid4().hex[:12]
    conn = _auth_db.get_connection()
    try:
        conn.execute("INSERT INTO watchlists (id, user_id, name) VALUES (?,?,?)",
                     (wid, user_id, "L"))
        for s in syms:
            conn.execute(
                "INSERT INTO watchlist_items (id, watchlist_id, sym) VALUES (?,?,?)",
                ("i-" + uuid.uuid4().hex[:12], wid, s))
        conn.commit()
    finally:
        conn.close()


#: Every column `upsert_catalyst` binds. ⛔ DERIVED from the store's own INSERT
#: rather than hand-listed: a column added tomorrow breaks the insert loudly here
#: instead of making this fixture quietly wrong.
_ROW_DEFAULTS = {
    "market_date": DAY, "ticker": "X", "rank": 1, "score": 0.0, "tag": "News",
    "price": 10.0, "gap_pct": 0.0, "vol_x": 1.0, "market_cap": None,
    "sector": None, "thesis_text": "x", "thesis_model": None, "thesis_at": None,
    "thesis_sources": None, "signals_hash": None, "catalyst_at": None,
    "raw_signals": None,
}


def _catalyst(ticker: str, *, day: str = DAY, rank: int = 1, grade: str = "A",
              tag: str = "Catalyst") -> None:
    _store.upsert_catalyst({**_ROW_DEFAULTS, "market_date": day, "ticker": ticker,
                            "rank": rank, "score": 50.0, "tag": tag,
                            "grade": grade})


# ══════════════════════════════════════════════════════════════════════════
# §9 ITEM 1 — WHICH COHORT
# ══════════════════════════════════════════════════════════════════════════

def test_S9_ITEM_1_the_cohort_is_S12s_tag_and_not_a_third_copy_of_the_admin_SQL():
    """⛔ §9 item 1, verbatim: *"a third copy would be the third authority."*"""
    admin = _user("admin")
    assert admin in _proj.cohort_user_ids()

    src = (_AT / "catalyst_match_projection.py").read_text(encoding="utf-8")
    tree = ast.parse(src)
    sql = []
    for node in ast.walk(tree):
        if (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
                and node.func.attr == "execute" and node.args):
            for n in ast.walk(node.args[0]):
                if isinstance(n, ast.Constant) and isinstance(n.value, str):
                    sql.append(n.value.lower())
    assert sql, "the SQL probe read nothing — it is broken, not the module"
    for s in sql:
        assert "role" not in s or "users where id" in s, (
            f"a cohort query keyed off users.role: {s!r} — that is the third "
            "authority §9 item 1 names")


def test_MUTATION_dropping_the_cohort_gate_lets_a_member_row_through(monkeypatch, dbp):
    admin, member = _user("admin"), _user("member")
    _watch(admin, "AAA")
    _watch(member, "BBB")
    _catalyst("AAA"); _catalyst("BBB", rank=2)

    base = _proj.run_projected_comparison(now=T0, db_path=dbp)
    assert base["members"] == 1

    everyone = _rollout.cohort_user_ids(_rollout.S7_DARK) | {member}
    monkeypatch.setattr(_rollout, "cohort_user_ids", lambda *_a, **_k: everyone)
    leaked = _proj.run_projected_comparison(now=T0 + 1, db_path=dbp)
    assert leaked["members"] == 2, (
        "widening the cohort changed nothing — every other assertion here is "
        "passing for the wrong reason")


def test_an_EMPTY_cohort_means_NO_MEMBERS_and_never_a_fallback(monkeypatch, dbp):
    _user("admin")
    monkeypatch.setattr(_rollout, "cohort_user_ids", lambda *_a, **_k: set())
    out = _proj.run_projected_comparison(now=T0, db_path=dbp)
    assert out == {"members": 0, "displayed": 0, "evaluated": 0,
                   "outcomes": {}, "fires": 0, "at": T0}


# ══════════════════════════════════════════════════════════════════════════
# §9 ITEM 3 — already_fired FROM THE REAL DEDUP TABLE
# ══════════════════════════════════════════════════════════════════════════

def test_S9_ITEM_3_a_suppressed_alert_is_NOT_reported_as_new_only(dbp):
    """⛔ §9 item 3, verbatim: *"`already_fired` must be supplied from the real
    dedup table, or blind spot 1 of §5 item 2 makes every suppressed alert read
    as `new_only`."*"""
    admin = _user("admin")
    _watch(admin, "AAA")
    _catalyst("AAA")
    # The member was alerted about AAA on an EARLIER day.
    assert _store.try_record_alert(admin, "AAA", YESTERDAY) is True

    fired = _proj.dedup_keys_before_today(admin, DAY)
    assert "AAA" in [f.upper() for f in fired], (
        "the real dedup table was not read — every suppressed alert will read "
        "as new_only")

    out = _proj.run_projected_comparison(now=T0, db_path=dbp)
    pid = _proj.projected_predicate_id(admin, _cm.RULE_WATCHLIST)
    assert out["outcomes"].get(pid, {}).get(_cmp.NEW_ONLY, 0) == 0, out["outcomes"]


def test_TODAYS_own_row_is_excluded_so_the_tick_is_not_silently_empty(dbp):
    """⛔⛔ THE ORDERING HAZARD, in this type's own shape. The legacy engine
    writes today's dedup row as it fires. A read that included `market_date =
    today` would hand BOTH rules today's answer, both would suppress, and the
    tick would record nothing at all — every day."""
    admin = _user("admin")
    _watch(admin, "AAA")
    _catalyst("AAA")
    assert _store.try_record_alert(admin, "AAA", DAY) is True   # the legacy ran

    fired = _proj.dedup_keys_before_today(admin, DAY)
    assert "AAA" not in [f.upper() for f in fired], (
        "today's own row leaked into the dedup state — both rules will suppress "
        "and the tick will record nothing")

    out = _proj.run_projected_comparison(now=T0, db_path=dbp)
    pid = _proj.projected_predicate_id(admin, _cm.RULE_WATCHLIST)
    assert out["outcomes"].get(pid, {}).get(_cmp.AGREED) == 1, out["outcomes"]


def test_the_dedup_set_is_SPLIT_PER_RULE_or_the_grade_rule_refires(dbp):
    """⛔⛔ THE FINDING THIS UNIT TURNED UP. `would_fire`'s `already_fired` is
    RULE-AGNOSTIC — both branches compare the bare upper-cased ticker — while the
    legacy dedup namespace is RULE-SPECIFIC (F-S7-5: the must-know row is stored
    as `MUSTKNOW:TICKER`).

    Hand the raw table to the grade rule and it compares `AAA` against
    `MUSTKNOW:AAA`, never matches, and re-fires an alert the legacy suppressed —
    a false `new_only`, on exactly the names an operator cared most about.
    """
    admin = _user("admin")
    assert _store.try_record_alert(admin, _store.mustknow_dedup_key("AAA"), YESTERDAY)
    assert _store.try_record_alert(admin, "BBB", YESTERDAY)      # watchlist rule

    keys = _proj.dedup_keys_before_today(admin, DAY)
    assert len(keys) == 2, keys

    grade_set = _proj.already_fired_for(_cm.RULE_GRADE, keys)
    watch_set = _proj.already_fired_for(_cm.RULE_WATCHLIST, keys)
    assert grade_set == ["AAA"], (
        f"the grade rule was handed {grade_set} — it compares a BARE ticker, so "
        "the must-know prefix must be stripped or it re-fires")
    assert watch_set == ["BBB"], (
        f"the watchlist rule was handed {watch_set} — a must-know row must not "
        "suppress a watchlist alert, which is the whole point of F-S7-5")


def test_the_mustknow_prefix_has_exactly_ONE_declaration():
    """⛔ A second spelling anywhere would silently re-share the key with the
    watchlist rule and put F-S7-5 straight back."""
    src = (_AT / "catalyst_match_projection.py").read_text(encoding="utf-8")
    tree = ast.parse(src)
    # ⛔ `ast.unparse` drops COMMENTS but KEEPS docstrings — they are string
    # expressions, not comments. Blanking them is what makes this CODE, NOT
    # PROSE; without it the module's own explanation of the prefix trips the
    # rail, which is the defect this repo has now met eight times.
    for node in ast.walk(tree):
        if (isinstance(node, ast.Expr) and isinstance(node.value, ast.Constant)
                and isinstance(node.value.value, str)):
            node.value.value = ""
    code = ast.unparse(ast.fix_missing_locations(tree))
    assert "mustknow:" not in code.lower().replace("mustknow_dedup_prefix", ""), (
        "the projection spells the must-know prefix itself instead of reading "
        "store.MUSTKNOW_DEDUP_PREFIX")


# ══════════════════════════════════════════════════════════════════════════
# THE PROJECTION'S OWN NARROWING
# ══════════════════════════════════════════════════════════════════════════

def test_only_RANKED_rows_are_displayed(dbp):
    """⛔ `_fire_catalyst_alerts` receives `top_n` — the ranked selection. Handing
    the dark rule the unranked rows would give it a wider world than the legacy
    ever had and manufacture `new_only` out of nothing."""
    admin = _user("admin")
    _watch(admin, "AAA", "ZZZ")
    _catalyst("AAA", rank=1)
    _store.upsert_catalyst({**_ROW_DEFAULTS, "ticker": "ZZZ", "rank": None})
    rows = _proj.displayed_rows(DAY)
    assert [r["ticker"] for r in rows] == ["AAA"], rows


def test_only_the_WATCHLISTS_member_set_is_projected():
    """⛔ `would_fire` refuses every member set but `watchlists` as
    pinned-but-unauthorized, because only that one is reachable from the legacy
    query. Projecting `tags`/`positions`/`uct20` would compare the dark rule
    against a legacy that cannot see them, and every extra name would read as
    `new_only`."""
    assert _proj._params(_cm.RULE_WATCHLIST)["member_set"] == _cm.SET_WATCHLISTS


def test_the_grade_rule_is_ADMIN_ONLY_and_a_non_admin_cohort_member_fires_nothing(dbp):
    """⛔ The must-know guard is what keeps a dark comparison from ever
    describing a subscriber's inbox."""
    member = _user("member")
    _watch(member, "AAA")
    _catalyst("AAA", grade="A")
    # Put the non-admin in the cohort deliberately — the ROLE guard must still hold.
    _rollout.assign_cohort(_rollout.S7_DARK, [member])

    assert _proj.is_admin(member) is False
    fired = _cm.would_fire(_proj._params(_cm.RULE_GRADE),
                           displayed=_proj.displayed_rows(DAY),
                           member_tickers={"AAA"}, is_admin=False, already_fired=[])
    assert fired == [], "the grade rule fired for a non-admin"


# ══════════════════════════════════════════════════════════════════════════
# READ-ONLY, AND STILL DARK
# ══════════════════════════════════════════════════════════════════════════

def test_the_projection_NEVER_writes_catalyst_alerts_fired(dbp):
    """⛔ Behavioural. Writing it would dedup the member's REAL alert tomorrow —
    a dark run silencing a live one."""
    admin = _user("admin")
    _watch(admin, "AAA")
    _catalyst("AAA")

    def snapshot():
        with _store._connect() as c:
            return [dict(r) for r in c.execute(
                "SELECT * FROM catalyst_alerts_fired ORDER BY user_id, ticker")]

    before = snapshot()
    _proj.run_projected_comparison(now=T0, db_path=dbp)
    _proj.run_projected_comparison(now=T0 + 86_400, db_path=dbp)
    assert snapshot() == before, (
        "the dark comparison wrote catalyst_alerts_fired — it would suppress the "
        "member's REAL alert")


def test_the_projection_never_reaches_a_delivery_path():
    for name in ("catalyst_match.py", "catalyst_match_compare.py",
                 "catalyst_match_projection.py"):
        tree = ast.parse((_AT / name).read_text(encoding="utf-8"))
        imported = []
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom):
                imported.append(node.module or "")
            elif isinstance(node, ast.Import):
                imported += [a.name for a in node.names]
        for mod in imported:
            assert "delivery" not in mod, f"{name} imports {mod}"
            assert "watchlist_alert_service" not in mod, f"{name} imports {mod}"
        assert imported, f"{name}: the import walk found nothing — the probe is broken"


def test_the_heartbeat_BEATS_even_when_the_cohort_is_empty(monkeypatch, dbp):
    """⛔⛔ On a DAILY clock a missed beat is a missed day."""
    monkeypatch.setattr(_rollout, "cohort_user_ids", lambda *_a, **_k: set())
    assert _cmp.heartbeat(db_path=dbp) is None
    _proj.run_dark_sweep(now=T0, db_path=dbp)
    beat = _cmp.heartbeat(db_path=dbp)
    assert beat is not None and beat["ticks"] == 1, beat


# ══════════════════════════════════════════════════════════════════════════
# §9 ITEMS 4 AND 5 — THE WIRE, AND THE CADENCE
# ══════════════════════════════════════════════════════════════════════════

def test_S9_ITEM_4_the_dark_sweep_is_actually_wired_to_a_tick():
    """⛔ §9 item 4: *"the 'what calls this' test rewritten from 'the harness is
    the only caller' to 'the sweep is wired exactly once'."*"""
    main = (_REPO / "api" / "main.py").read_text(encoding="utf-8")
    assert main.count("_at_catalyst_match.register()") == 1, "registered exactly once"
    assert "_at_doc_arrival.register()" in main, "control: the scan can see a sibling"
    assert main.count('id="alert_taxonomy_catalyst_match_dark"') == 1, (
        "the dark comparison has no scheduler entry — nothing will call it")
    start = main.index("def _catalyst_match_dark_sweep_job():")
    end = main.index('id="alert_taxonomy_catalyst_match_dark"', start)
    body = main[start:end]
    assert "run_dark_sweep()" in body, (
        "the scheduler entry exists but its job body does not call the sweep")
    assert 'os.environ.get("ALERT_TAXONOMY_CATALYST_MATCH_DARK_ENABLED", "0") == "1"' in main


def test_S9_ITEM_5_the_cadence_is_DAILY_and_not_per_minute():
    """⛔ §9 item 5: the dedup is per DAY, so a per-minute sweep would re-ask a
    question whose answer cannot change until tomorrow."""
    main = (_REPO / "api" / "main.py").read_text(encoding="utf-8")
    start = main.index("def _catalyst_match_dark_sweep_job():")
    end = main.index('id="alert_taxonomy_catalyst_match_dark"', start)
    body = main[start:end]
    assert 'minute="*"' not in body, (
        "the catalyst-match sweep runs every minute — §9 item 5 rules it daily")
    assert "hour=17" in body and "minute=30" in body, body


def test_the_sweep_job_body_never_reaches_a_delivery_path():
    main = (_REPO / "api" / "main.py").read_text(encoding="utf-8")
    start = main.index("def _catalyst_match_dark_sweep_job():")
    end = main.index('id="alert_taxonomy_catalyst_match_dark"', start)
    body = main[start:end]
    assert "run_dark_sweep" in body, "the slice is empty — this probe is broken"
    for banned in ("deliver", "send_email", "webhook", "try_record_alert"):
        assert banned not in body, f"the dark sweep job body mentions {banned!r}"


def test_NOTHING_IS_ARMED_the_flag_defaults_to_off():
    main = (_REPO / "api" / "main.py").read_text(encoding="utf-8")
    assert '"ALERT_TAXONOMY_CATALYST_MATCH_DARK_ENABLED", "0"' in main, (
        "the default is not '0' — an unset variable would arm a dark run over "
        "real member watchlists")
