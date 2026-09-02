#!/usr/bin/env python
"""tools/seed_large_notebook.py — Wave-0 scale gate (Task 6): seed a Notebook
with thousands of migrated-looking notes, into a LOCAL, THROWAWAY database.

Inserts N notes (default 5,000) for one user via the SAME code path the note
importer uses — `api.services.journal_two.notes.import_confirm()` — so a
seeded row is byte-for-byte what an imported note looks like on disk (title,
subtitle, tags, ticker, folder placement, body_json/body_plain via the real
`extract_plain_text`, import_hash/import_key, and the FTS5 mirror populated by
the real `j2_notes_fts_ai` trigger). This script does not reimplement the
INSERT; it calls the importer's own function.

Body lengths are drawn from a log-normal distribution (median ~65 words, long
tail to ~4,000) to mimic a migrated library: mostly short quick notes with a
handful of long-form playbooks/theses mixed in. A rare marker word
("convexity", ~1 note in 12) is seeded into a controlled fraction of bodies so
`--measure-search` has a real term to look for on both the FTS and LIKE paths.

──────────────────────────────────────────────────────────────────────────
⛔ SAFETY — READ BEFORE RUNNING. NON-NEGOTIABLE.
──────────────────────────────────────────────────────────────────────────
`C:\\data` (posix `/data`) is the owner's LIVE PRODUCTION data root on this
box (`C:\\data\\auth.db` alone holds ~20,000 real users). The repo-root
`conftest.py` tripwire that keeps the *test suite* out of that root only
arms when pytest imports it — a bare `python tools/seed_large_notebook.py`
run gets NONE of that protection. This script builds its own guard instead
of relying on it:

  * `--db` is REQUIRED (or the `NOTEBOOK_SEED_DB_PATH` env var). There is
    deliberately NO default — a tool with a default path is a tool that
    "just works" once, gets copy-pasted, and eventually runs with no
    argument against whatever `AUTH_DB_PATH` happens to resolve to.
  * The resolved `--db` path, AND the resolved sandbox this script points
    every other `/data`-derived Journal-2.0 write at (the notebook-migration
    flag files `journal_two/db.py` writes via `DATA_DIR`, the attachment
    root), are BOTH checked against the shared roots (`C:\\data`, `/data`)
    BEFORE anything is imported. Refuses to run (exit 2) if either lands
    inside one.
  * The check runs before `api.services.auth_db` (or anything importing it)
    is imported. `AUTH_DB_PATH`/`DATA_DIR` are read ONCE, at import time, by
    the product modules — setting them after import is a silent no-op that
    would leave the real default in effect.

Usage:
    python tools/seed_large_notebook.py --db C:\\tmp\\notebook_scale\\seed.db \\
        --count 5000 --user-id scale-test-user

    # or, via env var:
    set NOTEBOOK_SEED_DB_PATH=C:\\tmp\\notebook_scale\\seed.db
    python tools/seed_large_notebook.py --count 5000

Re-running against the same --db tops the user up to --count (existing
importKeys are skipped as unchanged content — the real importer's own
dedupe behaviour, inherited for free by calling import_confirm() directly).

Search-timing measurement (Task 6 §2), against whatever the db already has:
    python tools/seed_large_notebook.py --db <path> --user-id <id> \\
        --skip-seed --measure-search
"""
from __future__ import annotations

import argparse
import os
import random
import sys
import time
from pathlib import Path

# ─────────────────────────────────────────────────────────────────────────
#  Safety guard — MUST run, and MUST resolve+set env vars, before any
#  `api.*` import. See module docstring.
# ─────────────────────────────────────────────────────────────────────────

#: The one known shared production root on this box, in both spellings the
#: product code uses (Windows dev box + the posix literals baked into the
#: product's env-var defaults, e.g. `AUTH_DB_PATH`'s own `"/data/auth.db"`).
_SHARED_ROOT_CANDIDATES = ("C:/data", "/data")


def _norm(p: str) -> str:
    return os.path.normcase(os.path.abspath(p))


def _shared_root_hit(path: str) -> str | None:
    """The shared root `path` resolves inside, or None."""
    target = _norm(path)
    for root in _SHARED_ROOT_CANDIDATES:
        r = _norm(root)
        if target == r or target.startswith(r + os.sep):
            return root
    return None


def _refuse_if_shared(path: str, what: str) -> None:
    hit = _shared_root_hit(path)
    if hit is not None:
        print(
            f"REFUSING TO RUN: {what} resolves to {os.path.abspath(path)!r}, "
            f"which is inside {hit!r} — the owner's LIVE PRODUCTION data "
            f"root on this box. This tool must never write there.\n"
            f"Point it at a throwaway path outside {hit!r} instead.",
            file=sys.stderr,
        )
        raise SystemExit(2)


def _resolve_db_path(args: argparse.Namespace) -> Path:
    raw = args.db or os.environ.get("NOTEBOOK_SEED_DB_PATH")
    if not raw:
        print(
            "REFUSING TO RUN: no database path given. Pass --db PATH or set "
            "NOTEBOOK_SEED_DB_PATH — there is deliberately no default.",
            file=sys.stderr,
        )
        raise SystemExit(2)
    _refuse_if_shared(raw, "--db")
    return Path(raw).resolve()


def _resolve_data_dir(args: argparse.Namespace, db_path: Path) -> Path:
    """Sandbox for every other `/data`-derived path the schema-init chain
    touches: `journal_two/db.py`'s notebook-migration flag files
    (`_data_dir() / ".notebook_migration_v1"` etc., default `DATA_DIR=/data`)
    and the attachment root (`attachment_root.py`, same default). Without
    this, calling `auth_db.init_db()` against a perfectly safe `--db` would
    still touch `C:\\data\\.notebook_migration_v1` on this box — a write
    into shared production reached through a code path this script never
    calls directly. Defaults to a sibling of `--db` so a plain `--db` run
    is safe with zero extra flags; independently re-checked in case a
    caller points `--data-dir` somewhere dangerous."""
    raw = args.data_dir or os.environ.get("NOTEBOOK_SEED_DATA_DIR")
    target = Path(raw).resolve() if raw else (db_path.parent / f"{db_path.stem}_datadir")
    _refuse_if_shared(str(target), "the resolved DATA_DIR sandbox")
    return target


# ─────────────────────────────────────────────────────────────────────────
#  Realistic body generation
# ─────────────────────────────────────────────────────────────────────────

_LOREM = (
    "market trend position risk reward setup breakout pullback volume "
    "support resistance earnings catalyst thesis stop target entry exit "
    "portfolio drawdown compounding diversification edge discipline "
    "process review journal watchlist sector rotation regime momentum "
    "reversal consolidation base flag wedge channel gap fill liquidity "
    "spread premium hedge correlation conviction sizing allocation "
    "checklist mistake lesson pattern trigger confirmation divergence "
    "accumulation distribution leadership rally decline volatility"
).split()

#: The word `--measure-search` looks for by default. Chosen for being
#: uncommon enough in `_LOREM` on its own that only the deliberately-seeded
#: fraction of notes contains it — a real term for a real search, not a
#: fabricated query.
DEFAULT_SEARCH_TERM = "convexity"

_TAG_POOL = [
    "swing", "daytrade", "options", "macro", "earnings", "tech", "energy",
    "review", "idea", "watch", "mistake", "lesson", "setup", "thesis", "recap",
]
_TICKER_POOL = [
    "AAPL", "NVDA", "TSLA", "AMD", "MSFT", "SPY", "QQQ", "COIN", "META",
    "GOOGL", None, None, None, None,  # weighted toward no ticker
]


def _word_count(rng: random.Random) -> int:
    """Log-normal: most notes are a paragraph or two, a long tail runs to a
    multi-page entry — a migrated library's realistic mix of quick daily
    notes and long-form playbooks, not a uniform synthetic size."""
    raw = rng.lognormvariate(4.2, 1.0)  # median ~= e**4.2 ~= 67 words
    return max(15, min(4000, int(raw)))


def _make_body_json(rng: random.Random, idx: int, search_term: str) -> dict:
    n_words = _word_count(rng)
    include_term = (idx % 12 == 0)  # ~8.3% of notes carry the search term
    paragraphs = []
    words_left = n_words
    first = True
    while words_left > 0:
        take = min(words_left, rng.randint(30, 90))
        words = [rng.choice(_LOREM) for _ in range(take)]
        if include_term and first and words:
            words[min(3, len(words) - 1)] = search_term
        text = " ".join(words)
        text = text[:1].upper() + text[1:] + "."
        paragraphs.append({"type": "paragraph", "content": [{"type": "text", "text": text}]})
        words_left -= take
        first = False
    return {"type": "doc", "content": paragraphs}


def _random_iso(rng: random.Random, days_back: int = 1095) -> str:
    import datetime as dt
    delta_days = rng.randint(0, days_back)
    delta_secs = rng.randint(0, 86399)
    ts = (dt.datetime.now(dt.timezone.utc)
          - dt.timedelta(days=delta_days, seconds=delta_secs))
    return ts.replace(microsecond=0).isoformat()


def _build_import_payload(rng: random.Random, start_idx: int, n: int, search_term: str) -> dict:
    notes = []
    for i in range(start_idx, start_idx + n):
        body = _make_body_json(rng, i, search_term)
        created = _random_iso(rng)
        notes.append({
            "importKey": f"seed-{i:06d}",
            "title": f"Seed note {i:06d} — {rng.choice(_LOREM)} {rng.choice(_LOREM)}",
            "bodyJson": body,
            "tags": rng.sample(_TAG_POOL, k=rng.randint(0, 3)),
            "ticker": rng.choice(_TICKER_POOL),
            "folderPath": [],
            "createdAt": created,
            "updatedAt": created,
        })
    return {"source": "seed_large_notebook", "destFolderId": "", "notes": notes}


# ─────────────────────────────────────────────────────────────────────────
#  Search-timing measurement (Task 6 §2)
# ─────────────────────────────────────────────────────────────────────────

def _measure_search(notes_module, user_id: str, term: str, iterations: int = 5) -> None:
    """Time `list_notes(user, q=term)` on the FTS5 path, then again with the
    documented LIKE fallback forced.

    Forcing the fallback: `notes.list_notes` routes to the LIKE branch
    exactly when `fts_match_expr(q)` returns None (notes_search.py's
    documented contract — "returns None ... caller falls back to LIKE").
    That never happens for a real word, so the honest way to exercise the
    fallback for the SAME query text is to monkeypatch the name
    `notes.fts_match_expr` (what `notes.py` actually calls, per its
    `from ... import fts_match_expr`) to always return None for the
    duration of the call, then restore it. This runs notes.py's real,
    untouched LIKE branch — the SQL is not edited or reimplemented, only
    the router's decision is forced, which is what "temporarily forcing the
    fallback" means."""
    def _run(label: str) -> tuple[int, list[float]]:
        # One untimed warm-up (page cache / query-plan warm), then N timed.
        rows = notes_module.list_notes(user_id, q=term, limit=500)
        times = []
        for _ in range(iterations):
            t0 = time.perf_counter()
            rows = notes_module.list_notes(user_id, q=term, limit=500)
            times.append(time.perf_counter() - t0)
        return len(rows), times

    fts_n, fts_times = _run("fts")

    original = notes_module.fts_match_expr
    notes_module.fts_match_expr = lambda q: None
    try:
        like_n, like_times = _run("like")
    finally:
        notes_module.fts_match_expr = original

    fts_min, fts_mean = min(fts_times) * 1000, (sum(fts_times) / len(fts_times)) * 1000
    like_min, like_mean = min(like_times) * 1000, (sum(like_times) / len(like_times)) * 1000

    print(f"[measure] term={term!r} iterations={iterations}")
    print(f"[measure] FTS5 path:  {fts_n:4d} rows  min={fts_min:8.3f} ms  mean={fts_mean:8.3f} ms")
    print(f"[measure] LIKE path:  {like_n:4d} rows  min={like_min:8.3f} ms  mean={like_mean:8.3f} ms")
    if fts_min > 0:
        print(f"[measure] LIKE/FTS ratio (min): {like_min / fts_min:.2f}x")
    print(f"[measure] SUMMARY: term={term!r} fts_rows={fts_n} fts_min_ms={fts_min:.3f} "
          f"like_rows={like_n} like_min_ms={like_min:.3f}")


# ─────────────────────────────────────────────────────────────────────────
#  Main
# ─────────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--db", help="Path to the throwaway SQLite database "
                                      "(or set NOTEBOOK_SEED_DB_PATH). Required.")
    parser.add_argument("--data-dir", help="Sandbox for DATA_DIR-derived paths "
                                            "(attachment root, migration flags). "
                                            "Defaults to a sibling of --db.")
    parser.add_argument("--count", type=int, default=5000,
                         help="Target number of notes for --user-id (default 5000).")
    parser.add_argument("--user-id", default="scale-test-seed-user",
                         help="j2_notes.user_id to seed (no FK on this column "
                              "— any string works; pass a real signed-up "
                              "user's id to view the result in a browser).")
    parser.add_argument("--seed", type=int, default=1234, help="RNG seed.")
    parser.add_argument("--batch-size", type=int, default=500,
                         help="Notes per import_confirm() call "
                              "(the importer's own per-call cap is 500).")
    parser.add_argument("--skip-seed", action="store_true",
                         help="Don't insert notes — just run --measure-search "
                              "against what's already in --db.")
    parser.add_argument("--measure-search", nargs="?", const=DEFAULT_SEARCH_TERM,
                         default=None, metavar="TERM",
                         help="After seeding, time list_notes(q=TERM) on the "
                              "FTS path and the forced-LIKE-fallback path. "
                              f"TERM defaults to {DEFAULT_SEARCH_TERM!r} (the "
                              "marker word this script seeds into ~8%% of "
                              "bodies).")
    args = parser.parse_args()

    db_path = _resolve_db_path(args)
    data_dir = _resolve_data_dir(args, db_path)
    db_path.parent.mkdir(parents=True, exist_ok=True)
    data_dir.mkdir(parents=True, exist_ok=True)

    # MUST precede any `api.services.auth_db` import (directly or transitively)
    # — both vars are captured at module import time by the product code.
    os.environ["AUTH_DB_PATH"] = str(db_path)
    os.environ["DATA_DIR"] = str(data_dir)
    os.environ.setdefault("J2_ATTACHMENT_ROOT", str(data_dir / "j2_attachments"))

    repo_root = Path(__file__).resolve().parents[1]
    if str(repo_root) not in sys.path:
        sys.path.insert(0, str(repo_root))

    from api.services import auth_db
    from api.services.journal_two import notes as notes_service

    print(f"[seed] db={db_path}")
    print(f"[seed] data_dir={data_dir}")
    auth_db.init_db()

    def _note_count(user_id: str) -> int:
        conn = auth_db.get_connection()
        try:
            row = conn.execute(
                "SELECT COUNT(*) AS c FROM j2_notes WHERE user_id = ?", (user_id,),
            ).fetchone()
            return int(row["c"] if row else 0)
        finally:
            conn.close()

    if not args.skip_seed:
        rng = random.Random(args.seed)
        existing = _note_count(args.user_id)
        print(f"[seed] user={args.user_id!r} already has {existing} note(s)")
        to_create = max(0, args.count - existing)
        if to_create == 0:
            print(f"[seed] already at or above --count={args.count}; nothing to insert")
        else:
            batch_size = max(1, min(500, args.batch_size))
            t0 = time.perf_counter()
            created = 0
            conn = auth_db.get_connection()
            try:
                for start in range(existing, existing + to_create, batch_size):
                    n = min(batch_size, existing + to_create - start)
                    payload = _build_import_payload(rng, start, n, DEFAULT_SEARCH_TERM)
                    result = notes_service.import_confirm(args.user_id, payload, conn=conn)
                    created += len(result["created"]) + len(result["updated"])
                    print(f"[seed] batch {start}-{start + n}: "
                          f"created={len(result['created'])} "
                          f"updated={len(result['updated'])} "
                          f"skipped={len(result['skipped'])}")
            finally:
                conn.close()
            dt = time.perf_counter() - t0
            total = _note_count(args.user_id)
            rate = created / dt if dt > 0 else float("inf")
            print(f"[seed] SUMMARY: seeded_now={created} total_for_user={total} "
                  f"db={db_path} elapsed_s={dt:.1f} rate_notes_per_s={rate:.0f}")

    if args.measure_search:
        _measure_search(notes_service, args.user_id, args.measure_search)


if __name__ == "__main__":
    main()
