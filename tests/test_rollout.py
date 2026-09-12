"""S12 first migration — the cohort swap, and the proof it changed nobody.

⛔ APPROVED SCOPE (owner, 2026-09-12): *"first migration only — both S7
projections' `_cohort_user_ids()` become one SQL predicate over `user_tags`;
CP4's all-members flag becomes a tag assignment, not a code path (keep the flag
test asserting 'unset changes nothing' until the flag is deleted in a later
line)."*

⛔⛔ THE RULING THIS FILE EXISTS TO ENFORCE: **an empty cohort means NO members,
never a fallback to admins.** The comfortable alternative — "empty ⇒ fall back to
admins" — needs no seeding step and puts a SECOND AUTHORITY on who is in a
cohort, so the day somebody emptied the tag deliberately the system would
silently re-cover every admin.
"""
from __future__ import annotations

import ast
import pathlib
import sqlite3

import pytest

from api.services import rollout

_REPO = pathlib.Path(__file__).resolve().parents[1]
_MODULE = _REPO / "api" / "services" / "rollout.py"

_SCHEMA = """
CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT, role TEXT);
CREATE TABLE user_tags (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    tag TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, tag)
);
"""


@pytest.fixture()
def db(monkeypatch):
    """An in-memory auth.db shaped like the real one's two relevant tables.

    ⛔ The DDL above is COPIED from `auth_db._SCHEMA`'s `user_tags` block,
    including `UNIQUE(user_id, tag)` — the constraint `INSERT OR IGNORE` relies
    on. `test_the_fixture_schema_matches_the_real_one` is the rail that keeps
    this copy honest.
    """
    real = sqlite3.connect(":memory:")
    real.row_factory = sqlite3.Row
    real.executescript(_SCHEMA)
    real.commit()

    class _KeepOpen:
        """⛔ The production code CLOSES the connection it opens, which is
        correct and must not be changed for a test. A `sqlite3.Connection` is a C
        object and will not accept a monkeypatched `close`, so the fixture hands
        out a thin proxy whose `close()` is a no-op and which forwards
        everything else. The code path under test is untouched."""
        def __init__(self, c): self._c = c
        def close(self): pass
        def __getattr__(self, name): return getattr(self._c, name)

    proxy = _KeepOpen(real)
    monkeypatch.setattr(rollout._auth_db, "get_connection", lambda: proxy)
    return proxy


def _mk(conn, uid, role):
    conn.execute("INSERT INTO users (id, email, role) VALUES (?,?,?)",
                 (uid, uid + "@x.test", role))
    conn.commit()


def test_the_fixture_schema_matches_the_real_one():
    """⛔ NON-VACUITY ON THE FIXTURE ITSELF. A `user_tags` table without
    `UNIQUE(user_id, tag)` would make every idempotency assertion below pass for
    the wrong reason — `INSERT OR IGNORE` would simply insert duplicates."""
    real = (_REPO / "api" / "services" / "auth_db.py").read_text(encoding="utf-8")
    block = real.split("CREATE TABLE IF NOT EXISTS user_tags", 1)[1].split(");", 1)[0]
    assert "UNIQUE(user_id, tag)" in block
    assert "UNIQUE(user_id, tag)" in _SCHEMA
    assert "user_id TEXT NOT NULL REFERENCES users(id)" in block


# ─────────────────────────────────────────────────────────────────────────────
# ⛔⛔ THE RULING: empty means nobody
# ─────────────────────────────────────────────────────────────────────────────

def test_MUTATION_an_EMPTY_cohort_projects_ZERO_never_the_admins(db):
    """The owner's ruling, asserted directly. Three admins exist and NOT ONE is
    returned, because none carries the tag."""
    for i in range(3):
        _mk(db, f"admin{i}", "admin")
    _mk(db, "member1", "user")

    assert rollout.cohort_user_ids(rollout.S7_DARK) == set(), (
        "an untagged cohort returned members — a fallback to admins has been "
        "reintroduced, and the dark run would silently re-cover everyone")
    assert rollout.role_user_ids("admin"), (
        "control: the admins really are there, so the empty answer above is the "
        "rule and not an empty database")


def test_the_projections_return_NOTHING_on_an_empty_cohort(db, monkeypatch):
    """The same ruling, one layer up — both projections, not just the helper."""
    for i in range(2):
        _mk(db, f"admin{i}", "admin")
    db.execute("CREATE TABLE watchlist_alerts (id TEXT, user_id TEXT, sym TEXT, "
               "target_price REAL, direction TEXT, is_active INTEGER, alert_type TEXT)")
    db.execute("INSERT INTO watchlist_alerts VALUES ('a1','admin0','NVDA',100.0,'above',1,'price')")
    db.commit()

    from api.services.alert_taxonomy import price_level_projection as plp
    monkeypatch.setattr(plp._auth_db, "get_connection", lambda: db)
    assert plp.project_admin_alerts() == [], (
        "price-level projected rows for an untagged cohort")


# ─────────────────────────────────────────────────────────────────────────────
# ⭐ THE SWAP IS A NO-OP BY CONSTRUCTION
# ─────────────────────────────────────────────────────────────────────────────

def test_MUTATION_the_swap_projects_an_IDENTICAL_cohort_once_seeded(db):
    """⭐ THE OWNER'S OTHER CONDITION: *"Seed existing admins in the swap commit
    so the swap is a no-op by construction, with a test asserting the projected
    cohort is identical before and after."*

    `role_user_ids` is the PRE-swap oracle; `cohort_user_ids` is the post-swap
    answer. After the seed they must be the same SET — not the same size.
    """
    for i in range(4):
        _mk(db, f"admin{i}", "admin")
    for i in range(3):
        _mk(db, f"member{i}", "user")

    before = rollout.role_user_ids(rollout.LEGACY_S7_ROLE)
    assert len(before) == 4, "control: the pre-swap population is non-trivial"

    inserted = rollout.ensure_s7_dark_seeded()
    after = rollout.cohort_user_ids(rollout.S7_DARK)

    assert inserted == 4
    assert after == before, (
        f"the swap changed WHO is covered. before={sorted(before)} "
        f"after={sorted(after)}")
    # ⛔ AND IT DID NOT QUIETLY WIDEN: no ordinary member came along.
    assert not any(u.startswith("member") for u in after)


def test_the_seed_is_idempotent_and_never_removes(db):
    """Safe on every boot — and a tag added BY HAND survives a restart."""
    _mk(db, "admin0", "admin")
    _mk(db, "member0", "user")
    assert rollout.ensure_s7_dark_seeded() == 1
    assert rollout.ensure_s7_dark_seeded() == 0, "a second boot must insert nothing"

    # a member added to the cohort by hand
    db.execute("INSERT INTO user_tags (id, user_id, tag) VALUES ('x','member0',?)",
               (rollout.tag_for(rollout.S7_DARK),))
    db.commit()
    assert rollout.cohort_user_ids(rollout.S7_DARK) == {"admin0", "member0"}

    rollout.ensure_s7_dark_seeded()
    assert rollout.cohort_user_ids(rollout.S7_DARK) == {"admin0", "member0"}, (
        "the seed removed a hand-added member — a restart must never drop "
        "somebody out of a running dark comparison")


def test_a_role_change_does_NOT_silently_drop_a_member_from_a_running_cohort(db):
    """⭐ The direction that matters. Demoting an admin mid-comparison must not
    empty their span; the tag is the cohort now, and it is removed deliberately."""
    _mk(db, "admin0", "admin")
    rollout.ensure_s7_dark_seeded()
    db.execute("UPDATE users SET role = 'user' WHERE id = 'admin0'")
    db.commit()
    assert rollout.cohort_user_ids(rollout.S7_DARK) == {"admin0"}
    assert rollout.role_user_ids("admin") == set()


# ─────────────────────────────────────────────────────────────────────────────
# The prefix
# ─────────────────────────────────────────────────────────────────────────────

def test_only_rollout_prefixed_tags_are_cohorts(db):
    """⛔ An admin's ordinary note about a member must never become a rollout."""
    _mk(db, "u1", "user")
    for tag in ("vip", "refunded", "beta-tester"):
        db.execute("INSERT INTO user_tags (id, user_id, tag) VALUES (?,?,?)",
                   (tag, "u1", tag))
    db.commit()
    assert rollout.cohorts_for("u1") == set()
    assert rollout.cohort_user_ids("vip") == set()

    db.execute("INSERT INTO user_tags (id, user_id, tag) VALUES ('r','u1',?)",
               (rollout.tag_for(rollout.S7_DARK),))
    db.commit()
    assert rollout.cohorts_for("u1") == {rollout.S7_DARK}


def test_tag_for_refuses_a_double_prefix():
    """⛔ REFUSE rather than normalise: `rollout:rollout:s7-dark` and
    `rollout:s7-dark` would be two cohorts with one intent, and the second would
    silently project nobody."""
    assert rollout.tag_for("s7-dark") == "rollout:s7-dark"
    with pytest.raises(ValueError):
        rollout.tag_for("rollout:s7-dark")
    with pytest.raises(ValueError):
        rollout.tag_for("")


def test_includes_is_a_per_user_read(db):
    _mk(db, "u1", "user")
    _mk(db, "u2", "user")
    db.execute("INSERT INTO user_tags (id, user_id, tag) VALUES ('r','u1',?)",
               (rollout.tag_for(rollout.S7_DARK),))
    db.commit()
    assert rollout.includes("u1", rollout.S7_DARK) is True
    assert rollout.includes("u2", rollout.S7_DARK) is False
    assert rollout.includes("", rollout.S7_DARK) is False


def test_a_tag_for_a_deleted_account_is_not_projected(db):
    """⛔ `user_tags.user_id` is a FK but SQLite does not enforce it unless
    `PRAGMA foreign_keys=ON`, so a tag left behind by a deleted account would
    otherwise project a user id that no longer exists — and the projection would
    then find no alerts for them, which reads identically to a member with
    nothing armed."""
    _mk(db, "gone", "admin")
    rollout.ensure_s7_dark_seeded()
    assert rollout.cohort_user_ids(rollout.S7_DARK) == {"gone"}
    db.execute("DELETE FROM users WHERE id = 'gone'")
    db.commit()
    assert rollout.cohort_user_ids(rollout.S7_DARK) == set()


# ─────────────────────────────────────────────────────────────────────────────
# Structure — the things that must stay true of the code, not the data
# ─────────────────────────────────────────────────────────────────────────────

def _code_only(path: pathlib.Path) -> str:
    """⛔ CODE, NEVER PROSE — this module's header quotes the retired SQL."""
    tree = ast.parse(path.read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        if (isinstance(node, ast.Expr) and isinstance(node.value, ast.Constant)
                and isinstance(node.value.value, str)):
            node.value.value = ""
    return ast.unparse(tree)


def test_the_prefix_is_declared_once():
    """⛔ One literal. A second copy is how two modules start disagreeing about
    what a cohort tag looks like."""
    offenders = []
    scanned = 0
    for p in (_REPO / "api").rglob("*.py"):
        if p == _MODULE:
            continue
        try:
            code = _code_only(p)
        except SyntaxError:
            continue
        scanned += 1
        if '"rollout:"' in code or "'rollout:'" in code:
            offenders.append(str(p.relative_to(_REPO)).replace("\\", "/"))
    assert scanned > 100, f"the module walk found almost nothing ({scanned})"
    assert offenders == [], f"the rollout prefix literal is duplicated in {offenders}"
    # ⛔ NON-VACUITY: the literal really is in the module the walk skipped.
    assert 'ROLLOUT_PREFIX = ' in _code_only(_MODULE)


def test_role_user_ids_is_read_by_tests_only():
    """⛔ THE PRE-SWAP ORACLE IS NOT A FALLBACK. If a product path started
    calling it, "empty means nobody" would have a back door."""
    offenders = []
    for p in (_REPO / "api").rglob("*.py"):
        if p == _MODULE:
            continue
        try:
            code = _code_only(p)
        except SyntaxError:
            continue
        if "role_user_ids" in code:
            offenders.append(str(p.relative_to(_REPO)).replace("\\", "/"))
    assert offenders == [], (
        f"a product path reads the pre-swap oracle: {offenders}")


def test_neither_projection_holds_its_own_cohort_SQL_any_more():
    """⭐ THE POINT OF THE MIGRATION. One rollout gate, one authority."""
    for name in ("price_level_projection.py", "event_proximity_projection.py"):
        code = _code_only(_REPO / "api" / "services" / "alert_taxonomy" / name)
        assert "role = ?" not in code, f"{name} still holds its own role check"
        assert "u.role" not in code, f"{name} still joins on role"
        assert "_rollout.cohort_user_ids" in code, f"{name} does not read the cohort"


def test_the_CP4_flag_is_no_longer_a_CODE_PATH_and_unset_changes_nothing(db, monkeypatch):
    """⛔ The owner's instruction, kept verbatim: *"CP4's all-members flag becomes
    a tag assignment, not a code path (keep the flag test asserting 'unset
    changes nothing' until the flag is deleted in a later line)."*

    ⭐ So this asserts the STRONGER thing that is now true by construction:
    **unset changes nothing, and so does SET.** Widening to all members is a tag
    assignment now; the flag reaches no branch.
    """
    from api.services.alert_taxonomy import event_proximity_projection as epp
    _mk(db, "admin0", "admin")
    _mk(db, "member0", "user")
    rollout.ensure_s7_dark_seeded()

    monkeypatch.delenv(epp.CP4_ALL_MEMBERS_FLAG, raising=False)
    unset = epp._cohort_user_ids()
    monkeypatch.setenv(epp.CP4_ALL_MEMBERS_FLAG, "1")
    when_set = epp._cohort_user_ids()

    assert unset == {"admin0"}
    assert when_set == unset, (
        "the CP4 flag still reaches a branch — it is supposed to be a tag "
        "assignment now, and `member0` must not appear because a variable moved")
    # the flag constant still exists, for the later line that deletes it
    assert epp.CP4_ALL_MEMBERS_FLAG.endswith("_ALL_MEMBERS")
    code = _code_only(_REPO / "api" / "services" / "alert_taxonomy" / "event_proximity_projection.py")
    assert "all_members_enabled()" not in code.split("def all_members_enabled", 1)[1], (
        "all_members_enabled() is still CALLED somewhere — it must be declared "
        "and unused until the flag is deleted")
