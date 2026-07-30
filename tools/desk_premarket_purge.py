"""One-shot production purge: remove the retired PRE-MARKET STREAM archives
from The Desk -> Videos (owner-approved 2026-07-29).

WHY A TOOL AND NOT 28 ADMIN CLICKS: the 26 retired ids were seeded from
`api/services/education_channel_seed.py`, and `education_service.
ensure_default_videos()` re-inserts every seed id that is missing on EVERY boot
(verified against a copy of prod: a deleted row came back with a fresh id, in
the pre-taxonomy 'Live Sessions' category). So a DB-only delete is worse than
useless. The seed strip ships in the same commit as this tool; this tool then
clears the rows that are already in `/data/education.db`.

Runs ON THE POD (the DB lives on the Railway volume):

    railway ssh --service web "/opt/venv/bin/python /app/tools/desk_premarket_purge.py"                          # dry-run
    railway ssh --service web "/opt/venv/bin/python /app/tools/desk_premarket_purge.py --execute --backup-done"  # the real thing

`--execute` REFUSES unless `--backup-done` is passed AND a backup file actually
exists on the volume (the flag alone is not trusted — the file is stat'ed).

WHAT IT DOES, in ONE transaction:
  * DELETEs the 26 retired ids. Each row is title-guarded first: if a row's
    title no longer looks like a premarket stream, NOTHING is deleted and the
    tool exits nonzero (someone repurposed the id — a human should look).
  * REWRITEs the 3 survivors (clip sources for the live 'Setups Mastery' track,
    edu_paths id 11) to the title/category/description carried by the seed
    module, so seed and DB can never drift. Their youtube_ids are untouched, so
    `edu_path_steps` keeps resolving and watch progress carries.

Idempotent: re-running after a resurrection deletes the new rows too (matching
is by youtube_id, not by the old integer id, because a re-seed assigns a new
one).

AFTERWARDS (from the main repo dir, not the pod) refresh the FTS index — this
process cannot flag the running web process's in-memory `_search_dirty`, so
deep search would keep serving the deleted rows until the next restart:

    POST /api/education/taxonomy-apply  (PUSH_SECRET) with the 3 survivors
        -> bulk_apply_taxonomy() calls _mark_search_dirty() in the live process

Nothing here touches YouTube: the videos stay on the channel, they just leave
The Desk.
"""
from __future__ import annotations

import argparse
import glob
import os
import re
import sqlite3
import sys

sys.path.insert(0, "/app")

DB_PATH = os.environ.get("EDUCATION_DB_PATH", "/data/education.db")
BACKUP_GLOB = "/data/education.pre-premarket*.db"

# The 26 retired archives. 0C_apH-Q8yk was hand-deleted by the owner on
# 2026-07-29 and is listed so a resurrected copy is cleaned up too.
RETIRED = (
    "0C_apH-Q8yk", "GaelGp-hB90", "4k7yEhlw1lw", "nIudfbP1yJw", "3UVNpnWSOK4",
    "nKg9kfqYILM", "UwtAwzHR3Ws", "OLoH42NWHRI", "OJgh_u_h1U4", "4yNUQ6YEtBY",
    "4SkqBiBQAHA", "hCd0lSj6Xts", "Zt8OC2VlcEo", "D5i0kXTmzYA", "F-QBnHd9uQw",
    "3aEIpOvvSqQ", "k472jODmxho", "95hCWoh9OKo", "GZ1rKjZ9Se8", "A4-OuptmrDs",
    "e9Xn4HE6iXk", "SC2d4OtcFfE", "uaE3k0qlabg", "x5RCa1auDtU", "-YAF3vJTqh8",
    "WNFs15BQ4mA",
)

# Clip sources for edu_paths id 11 (setups-mastery, enabled) — kept, rewritten.
SURVIVORS = ("5cWcJ9GtqpY", "JrPP0ofe408", "1710-wEgJag")

# A row is only deletable while it still reads as a premarket stream.
PREMARKET = re.compile(r"pre[- ]?market", re.I)


def survivor_targets() -> dict[str, dict]:
    """Canonical title/category/description for the 3 survivors, read from the
    seed module so this tool can never disagree with what a future boot seeds."""
    from api.services.education_channel_seed import SEED_VIDEOS_CHANNEL
    by_id = {v["youtube_id"]: v for v in SEED_VIDEOS_CHANNEL}
    out = {}
    for yt in SURVIVORS:
        v = by_id.get(yt)
        if v is None:
            sys.exit(f"FATAL: survivor {yt} is missing from education_channel_seed.py "
                     "— it must stay seeded or a fresh DB loses the clip source.")
        if PREMARKET.search(v["title"]):
            sys.exit(f"FATAL: survivor {yt} still carries a premarket title in the seed "
                     f"({v['title']!r}) — the seed strip did not land.")
        out[yt] = {"title": v["title"], "category": v["category"],
                   "description": v.get("description") or ""}
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--execute", action="store_true", help="actually write (default: dry-run)")
    ap.add_argument("--backup-done", action="store_true",
                    help="attest the volume backup was taken (file existence is still checked)")
    args = ap.parse_args()

    targets = survivor_targets()

    if args.execute:
        if not args.backup_done:
            print("REFUSING to --execute without --backup-done. Take the backup first:\n"
                  '  railway ssh --service web "cp /data/education.db '
                  '/data/education.pre-premarket-$(date +%Y%m%d).db"', file=sys.stderr)
            return 2
        found = sorted(glob.glob(BACKUP_GLOB))
        if not found:
            print(f"REFUSING: --backup-done was passed but no backup matches {BACKUP_GLOB}.",
                  file=sys.stderr)
            return 2
        print(f"backup present: {found[-1]} ({os.path.getsize(found[-1]):,} bytes)")

    c = sqlite3.connect(DB_PATH)
    c.row_factory = sqlite3.Row
    before = c.execute("SELECT COUNT(*) FROM edu_videos").fetchone()[0]
    print(f"{DB_PATH}: {before} videos before\n")

    # ── Plan the deletes, title-guarding every single row ────────────────────
    to_delete, absent, refused = [], [], []
    for yt in RETIRED:
        rows = c.execute("SELECT id, youtube_id, title, category FROM edu_videos "
                         "WHERE youtube_id = ?", (yt,)).fetchall()
        if not rows:
            absent.append(yt)
            continue
        for r in rows:
            if PREMARKET.search(r["title"] or ""):
                to_delete.append(dict(r))
            else:
                refused.append(dict(r))

    if refused:
        print("ABORT — these rows no longer look like premarket streams; nothing was written:",
              file=sys.stderr)
        for r in refused:
            print(f"  id={r['id']} {r['youtube_id']} [{r['category']}] {r['title']!r}",
                  file=sys.stderr)
        return 1

    # ── Plan the survivor rewrites ───────────────────────────────────────────
    to_update = []
    for yt, want in targets.items():
        row = c.execute("SELECT id, youtube_id, title, category, description FROM edu_videos "
                        "WHERE youtube_id = ?", (yt,)).fetchone()
        if row is None:
            print(f"ABORT — survivor {yt} is not in the DB; refusing to run a partial purge "
                  "(a clip source for the live Setups Mastery track is missing).",
                  file=sys.stderr)
            return 1
        if (row["title"], row["category"], row["description"] or "") != (
                want["title"], want["category"], want["description"]):
            to_update.append((dict(row), want))

    for r in to_delete:
        print(f"  DELETE id={r['id']:>3} {r['youtube_id']:<12} [{r['category']}] {r['title']}")
    for yt in absent:
        print(f"  absent (nothing to do)   {yt}")
    for row, want in to_update:
        print(f"  REWRITE id={row['id']:>3} {row['youtube_id']:<12} "
              f"[{row['category']}] {row['title']!r}\n"
              f"       -> [{want['category']}] {want['title']!r}")
    if not to_update:
        print("  survivors already canonical (nothing to rewrite)")

    print(f"\n{len(to_delete)} to delete, {len(to_update)} to rewrite, "
          f"{len(absent)} already gone")

    if not args.execute:
        print("\nDRY-RUN — nothing written. Re-run with --execute --backup-done.")
        return 0

    ids = [r["id"] for r in to_delete]
    with c:  # one transaction: commit on success, rollback on any exception
        for r in to_delete:
            cur = c.execute("DELETE FROM edu_videos WHERE id = ? AND youtube_id = ?",
                            (r["id"], r["youtube_id"]))
            if cur.rowcount != 1:
                raise RuntimeError(f"delete of id={r['id']} {r['youtube_id']} "
                                   f"affected {cur.rowcount} rows — rolling back")
        for row, want in to_update:
            cur = c.execute(
                "UPDATE edu_videos SET title = ?, category = ?, description = ?, "
                "updated_at = strftime('%s','now') WHERE id = ? AND youtube_id = ?",
                (want["title"], want["category"], want["description"],
                 row["id"], row["youtube_id"]))
            if cur.rowcount != 1:
                raise RuntimeError(f"rewrite of id={row['id']} {row['youtube_id']} "
                                   f"affected {cur.rowcount} rows — rolling back")

    # ── Verify against the artifact, not against our own bookkeeping ─────────
    after = c.execute("SELECT COUNT(*) FROM edu_videos").fetchone()[0]
    still = c.execute(
        "SELECT id, youtube_id, title FROM edu_videos WHERE youtube_id IN "
        f"({','.join('?' for _ in RETIRED)})", RETIRED).fetchall()
    leftover = c.execute(
        "SELECT id, youtube_id, category, title FROM edu_videos "
        "WHERE lower(title) LIKE '%pre-market stream%' OR lower(title) LIKE '%pre market stream%' "
        "OR lower(title) LIKE '%pre-market live stream%' OR lower(title) LIKE '%premarket stream%'"
    ).fetchall()
    survivors = c.execute(
        "SELECT id, youtube_id, category, title FROM edu_videos WHERE youtube_id IN "
        f"({','.join('?' for _ in SURVIVORS)})", SURVIVORS).fetchall()
    orphan_steps = c.execute(
        "SELECT s.path_id, s.youtube_id FROM edu_path_steps s "
        "LEFT JOIN edu_videos v ON v.youtube_id = s.youtube_id "
        "WHERE v.id IS NULL AND (s.planned_title IS NULL OR s.planned_title = '')"
    ).fetchall()

    print(f"\n{after} videos after ({before} - {len(ids)} = {before - len(ids)} expected)")
    print("retired ids still present:", [dict(r) for r in still] or "none")
    print("rows still titled like a premarket stream:",
          [f"{r['id']} {r['youtube_id']} [{r['category']}] {r['title']}" for r in leftover] or "none")
    print("survivors now:")
    for r in survivors:
        print(f"  id={r['id']} {r['youtube_id']} [{r['category']}] {r['title']}")
    print("path steps pointing at a missing video:",
          [f"path {r['path_id']} -> {r['youtube_id']}" for r in orphan_steps] or "none")

    problems = []
    if after != before - len(ids):
        problems.append(f"row count {after} != expected {before - len(ids)}")
    if still:
        problems.append(f"{len(still)} retired id(s) survived the delete")
    if len(leftover) != 0:
        problems.append(f"{len(leftover)} row(s) still titled like a premarket stream")
    if len(survivors) != len(SURVIVORS):
        problems.append(f"expected {len(SURVIVORS)} survivors, found {len(survivors)}")
    if orphan_steps:
        problems.append(f"{len(orphan_steps)} path step(s) now point at a missing video")
    if problems:
        print("\nFAILED:", "; ".join(problems), file=sys.stderr)
        return 1

    print("\nOK — purge applied and verified.")
    print("NEXT: refresh the deep-search index in the LIVE process (this process cannot):\n"
          "  POST https://uctintelligence.com/api/education/taxonomy-apply  (PUSH_SECRET)\n"
          "  with the 3 survivors' {id, category, tags} -> bulk_apply_taxonomy() "
          "marks the FTS index dirty.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
