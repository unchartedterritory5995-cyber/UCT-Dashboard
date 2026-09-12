"""S12 — the operator door for `rollout:` cohorts. READ-ONLY UNLESS `--apply`.

⛔ APPROVED SCOPE (owner, 2026-09-12, GATE-S12 line 2): the second migration.
This is the mechanism that replaces the deleted `..._DARK_ALL_MEMBERS` flag.

⛔⛔ IT EXISTS BECAUSE THE ALTERNATIVE IS A HAND-TYPED INSERT. The owner's
standing instruction, 2026-09-12: *"Do not write tag rows by hand from the
shell."* Before this, widening a cohort meant exactly that — and the first
migration's packet described widening as "a tag assignment" while providing
nothing that assigned one. A documented workaround is not a recovery path.

⭐ EVERY WRITE PRINTS THE DIFF IT WOULD MAKE, FIRST, AND THEN REFUSES UNLESS
`--apply` IS PRESENT. A cohort is a list of real people; the failure mode is not
a crash, it is a quiet over-inclusion that nobody notices because the sweep
keeps running and the numbers only get bigger.

Usage
-----
    python tools/rollout_cohort.py list
    python tools/rollout_cohort.py show      --cohort s7-dark
    python tools/rollout_cohort.py add       --cohort s7-dark --user <id> [--user <id>...]
    python tools/rollout_cohort.py remove    --cohort s7-dark --user <id>
    python tools/rollout_cohort.py seed-role --cohort s7-dark --role admin
    python tools/rollout_cohort.py seed-all  --cohort s7-dark
    …add `--apply` to any of the last four to actually write.

⚠️ IDS ONLY. This never prints an email, a name or any other column of `users` —
an operational label must not become a place personal data leaks into a log.
"""
from __future__ import annotations

import argparse
import pathlib
import sys

_ROOT = pathlib.Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))


def _rollout():
    from api.services import rollout
    return rollout


def _print_set(label: str, ids) -> None:
    ids = sorted(ids)
    print("%s (%d):" % (label, len(ids)))
    for u in ids:
        print("   ", u)
    if not ids:
        # ⛔ AN EMPTY COHORT IS A FACT, NOT A BLANK. Printing nothing here reads
        # identically to a command that failed before it reached the query.
        print("    (none — an empty cohort means NO members, never a fallback)")


def _target_ids(rollout, args) -> set:
    if args.cmd == "seed-all":
        conn = rollout._auth_db.get_connection()
        try:
            rows = conn.execute("SELECT id FROM users").fetchall()
        finally:
            conn.close()
        return {str(dict(r)["id"]) for r in rows}
    if args.cmd == "seed-role":
        return rollout.role_user_ids(args.role)
    return {str(u) for u in (args.user or [])}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("cmd", choices=["list", "show", "add", "remove", "seed-role", "seed-all"])
    ap.add_argument("--cohort", help="cohort name WITHOUT the rollout: prefix")
    ap.add_argument("--user", action="append", help="a user id; repeatable")
    ap.add_argument("--role", help="for seed-role")
    ap.add_argument("--apply", action="store_true",
                    help="actually write. Without it this only prints the diff.")
    args = ap.parse_args(argv)

    rollout = _rollout()

    if args.cmd == "list":
        conn = rollout._auth_db.get_connection()
        try:
            rows = conn.execute(
                "SELECT tag, COUNT(*) FROM user_tags WHERE tag LIKE ? "
                "GROUP BY tag ORDER BY tag", (rollout.ROLLOUT_PREFIX + "%",)).fetchall()
        finally:
            conn.close()
        if not rows:
            print("no rollout: cohorts exist")
            return 0
        for r in rows:
            t = dict(r)
            print("%-40s %d" % (list(t.values())[0], list(t.values())[1]))
        return 0

    if not args.cohort:
        ap.error("--cohort is required for %s" % args.cmd)
    if args.cmd == "seed-role" and not args.role:
        ap.error("--role is required for seed-role")
    if args.cmd in ("add", "remove") and not args.user:
        ap.error("--user is required for %s" % args.cmd)

    before = rollout.cohort_user_ids(args.cohort)

    if args.cmd == "show":
        _print_set("cohort %r" % args.cohort, before)
        return 0

    targets = _target_ids(rollout, args)
    if args.cmd == "remove":
        after = before - targets
        _print_set("WOULD REMOVE", before & targets)
    else:
        after = before | targets
        _print_set("WOULD ADD", targets - before)

    print()
    print("cohort %r: %d -> %d members" % (args.cohort, len(before), len(after)))

    if not args.apply:
        # ⛔ THE DEFAULT IS A DRY RUN AND IT SAYS SO. A tool whose default is to
        # write is one typo away from a rollout nobody chose.
        print("\nDRY RUN — nothing was written. Re-run with --apply to commit.")
        return 0

    if args.cmd == "remove":
        n = rollout.remove_from_cohort(args.cohort, sorted(targets))
        print("removed %d row(s)" % n)
    elif args.cmd == "seed-all":
        n = rollout.seed_cohort_all_members(args.cohort)
        print("added %d row(s)" % n)
    elif args.cmd == "seed-role":
        n = rollout.seed_cohort_from_role(args.cohort, args.role)
        print("added %d row(s)" % n)
    else:
        n = rollout.assign_cohort(args.cohort, sorted(targets))
        print("added %d row(s)" % n)

    _print_set("cohort %r is now" % args.cohort, rollout.cohort_user_ids(args.cohort))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
