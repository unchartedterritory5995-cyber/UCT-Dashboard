"""S12 — ROLLOUT COHORTS. The first migration, and nothing else.

⛔ APPROVED SCOPE (owner, 2026-09-12), verbatim: *"first migration only — both S7
projections' `_cohort_user_ids()` become one SQL predicate over `user_tags`;
CP4's all-members flag becomes a tag assignment, not a code path (keep the flag
test asserting 'unset changes nothing' until the flag is deleted in a later
line)."*

──────────────────────────────────────────────────────────────────────────────
WHY THIS EXISTS — a rollout gate written as a role check
──────────────────────────────────────────────────────────────────────────────

This app gates features four ways and NOT ONE OF THEM CAN NAME A PERSON: an env
flag (whole service), a compiled constant (whole bundle, or a hash of the
browser), a role check (`role == 'admin'`, app-wide), and a plan/entitlement
(one subscription tier). The finest grain any of them reaches is *"every
admin"*.

So the two S7 dark runs expressed their cohort as `role = 'admin'`, which is
wrong in three ways it had already started to pay for:

1. **It is not a cohort, it is a privilege.** Adding somebody to a dark run
   meant making them an administrator of the whole product.
2. **It cannot shrink.** There was no way to say *"this dark run covers three of
   the admins"*, which is what a first canary actually wants.
3. **It was duplicated** across two modules, with a third copy scheduled.

──────────────────────────────────────────────────────────────────────────────
⛔⛔ AN EMPTY COHORT MEANS NO MEMBERS. NEVER A FALLBACK TO ADMINS.
──────────────────────────────────────────────────────────────────────────────

Owner ruling, 2026-09-12. `cohort_user_ids` on an untagged cohort returns the
EMPTY SET, and the caller projects nothing.

⭐ THE DANGEROUS ALTERNATIVE IS THE COMFORTABLE ONE. "Empty ⇒ fall back to
admins" would preserve today's behaviour with no seeding step — and it would put
a SECOND AUTHORITY on who is in a cohort, so the day somebody emptied the tag
deliberately the system would silently re-cover every admin. Fail closed.

⚠️ AND FAILING CLOSED HAS A REAL COST THAT IS PAID BY SEEDING, NOT BY HOPING: an
unseeded swap covers zero people, and five sessions of "agreement" over an empty
set reads exactly like five sessions of agreement. `seed_cohort_from_role` is
what makes the swap a no-op by construction, and
`test_the_swap_projects_an_IDENTICAL_cohort` is what proves it did.

──────────────────────────────────────────────────────────────────────────────
⛔ WHAT S12 IS NOT
──────────────────────────────────────────────────────────────────────────────

- **Not a percentage.** `BARS_PUSH_ROLLOUT_PCT` is right for its job (a
  browser-level ramp). A cohort a human curates and a hash nobody can explain
  are different instruments.
- **Not an entitlement.** `entitlements.py` answers *"what has this member paid
  for"*. Folding rollout in makes an experiment look like a purchase.
- **Not a kill switch.** The env flags stay, and the ORDERING is load-bearing:
  the kill switch is evaluated FIRST, so `FLAG=false` beats any membership.
  Without that, turning a feature off would mean emptying a table.
- **Not a place for PII.** A tag name is an operational label. `rollout:` names
  a cohort; it never names a reason about a person.
"""
from __future__ import annotations

from typing import Iterable, Optional

from api.services import auth_db as _auth_db

#: ⛔ A PREFIX, NOT A SECOND TABLE, AND NOT A FREE-FOR-ALL. A second table would
#: need a second admin UI and a second migration; an unprefixed tag would make
#: every existing admin note (`vip`, `refunded`, `beta-tester`) accidentally
#: load-bearing the moment anything read the table. The prefix is what lets the
#: rows that are already there stay what they are.
#:
#: ⛔ DECLARED ONCE. `tests/test_rollout.py::test_the_prefix_is_declared_once`
#: fails if any other module writes the literal.
ROLLOUT_PREFIX = "rollout:"

#: The cohort both S7 dark runs project. ONE name, read by both, so the two can
#: never describe different populations.
S7_DARK = "s7-dark"

#: The role the S7 cohorts used before this migration. Kept so the seed can
#: reproduce the pre-swap population EXACTLY, and so the swap's no-op proof has
#: something to compare against.
LEGACY_S7_ROLE = "admin"


def tag_for(cohort: str) -> str:
    """`'s7-dark'` -> `'rollout:s7-dark'`. ⛔ The one place the two are joined."""
    c = (cohort or "").strip()
    if not c:
        raise ValueError("a cohort name is required; an empty one would tag every row")
    if c.startswith(ROLLOUT_PREFIX):
        # ⛔ REFUSE rather than normalise. `rollout:rollout:s7-dark` and
        # `rollout:s7-dark` would be two cohorts with one intent, and the second
        # one would silently project nobody.
        raise ValueError(f"cohort {c!r} already carries the prefix; pass the bare name")
    return ROLLOUT_PREFIX + c


def cohort_user_ids(cohort: str, *, conn=None) -> set[str]:
    """Every user id carrying this cohort's tag.

    ⛔⛔ AN EMPTY RESULT IS AN EMPTY COHORT, AND IT IS RETURNED AS ONE. There is
    no fallback here and there must never be one — see the module header.
    """
    tag = tag_for(cohort)
    own = conn is None
    c = _auth_db.get_connection() if own else conn
    try:
        rows = c.execute(
            "SELECT ut.user_id FROM user_tags ut "
            "JOIN users u ON u.id = ut.user_id "
            "WHERE ut.tag = ?",
            (tag,),
        ).fetchall()
    finally:
        if own:
            c.close()
    # ⛔ THE JOIN TO `users` IS NOT DECORATION. `user_tags.user_id` is a FK but
    # SQLite does not enforce it unless `PRAGMA foreign_keys=ON`, so a tag left
    # behind by a deleted account would otherwise project a user id that no
    # longer exists — and the projection would then look for their alerts and
    # find none, which reads identically to a member with nothing armed.
    return {str(dict(r)["user_id"]) for r in rows}


def includes(user_id: str, cohort: str, *, conn=None) -> bool:
    """Is this member in this cohort? A per-user read, for a gate on a request."""
    if not user_id:
        return False
    tag = tag_for(cohort)
    own = conn is None
    c = _auth_db.get_connection() if own else conn
    try:
        row = c.execute(
            "SELECT 1 FROM user_tags WHERE user_id = ? AND tag = ?",
            (str(user_id), tag),
        ).fetchone()
    finally:
        if own:
            c.close()
    return row is not None


def cohorts_for(user_id: str, *, conn=None) -> set[str]:
    """The bare cohort names this member is in.

    ⛔ ONLY `rollout:`-PREFIXED TAGS. An admin's ordinary note about a member is
    not a rollout and must never become one by being read here.
    """
    if not user_id:
        return set()
    own = conn is None
    c = _auth_db.get_connection() if own else conn
    try:
        rows = c.execute(
            "SELECT tag FROM user_tags WHERE user_id = ? AND tag LIKE ?",
            (str(user_id), ROLLOUT_PREFIX + "%"),
        ).fetchall()
    finally:
        if own:
            c.close()
    return {str(dict(r)["tag"])[len(ROLLOUT_PREFIX):] for r in rows}


def seed_cohort_from_role(cohort: str, role: str, *, conn=None) -> int:
    """Give every account with `role` this cohort's tag. IDEMPOTENT.

    ⭐ THIS IS WHAT MAKES THE SWAP A NO-OP BY CONSTRUCTION. The owner's ruling:
    *"Seed existing admins in the swap commit so the swap is a no-op by
    construction, with a test asserting the projected cohort is identical before
    and after."* A mechanism that changed WHO is covered and HOW coverage is
    decided in one commit cannot be debugged when the count moves.

    ⛔ `INSERT OR IGNORE` — the table's `UNIQUE(user_id, tag)` makes a re-run
    free, so this is safe on every boot. It NEVER removes a tag: a member added
    to the cohort by hand must not be dropped by the next restart, and a member
    whose role changed must not be silently removed from a running dark
    comparison.

    Returns the number of rows actually inserted, so a caller can log a real
    number rather than "done".
    """
    tag = tag_for(cohort)
    own = conn is None
    c = _auth_db.get_connection() if own else conn
    try:
        before = c.execute("SELECT COUNT(*) FROM user_tags WHERE tag = ?", (tag,)).fetchone()[0]
        c.execute(
            "INSERT OR IGNORE INTO user_tags (id, user_id, tag) "
            "SELECT lower(hex(randomblob(16))), u.id, ? FROM users u WHERE u.role = ?",
            (tag, role),
        )
        c.commit()
        after = c.execute("SELECT COUNT(*) FROM user_tags WHERE tag = ?", (tag,)).fetchone()[0]
    finally:
        if own:
            c.close()
    return int(after) - int(before)


def role_user_ids(role: str, *, conn=None) -> set[str]:
    """The pre-swap population, kept ONLY so the no-op proof has an oracle.

    ⛔ NOT A FALLBACK AND NOT A SECOND AUTHORITY. Nothing in a product path calls
    this; `tests/test_rollout.py::test_role_user_ids_is_read_by_tests_only`
    asserts that from the source, with a non-vacuity control.
    """
    own = conn is None
    c = _auth_db.get_connection() if own else conn
    try:
        rows = c.execute("SELECT id FROM users WHERE role = ?", (role,)).fetchall()
    finally:
        if own:
            c.close()
    return {str(dict(r)["id"]) for r in rows}


def ensure_s7_dark_seeded(*, conn=None) -> int:
    """The one seeding call the swap needs, named so its single call site is
    greppable. Idempotent; safe on every boot."""
    return seed_cohort_from_role(S7_DARK, LEGACY_S7_ROLE, conn=conn)
