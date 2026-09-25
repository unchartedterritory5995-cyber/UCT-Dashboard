"""Notebook read-latency benchmark at realistic library sizes (Wave 0 P0-2, extended in wave 7 I1).

VERIFICATION ONLY. This does not change product code. It measures the REAL query functions
in `notes.py` / `note_tasks.py` against a freshly seeded SQLite file per tier. It goes
through the real schema (`ensure_schema`) and the real FTS5 triggers. Seeding is a bulk
raw INSERT, not one `create_note()` per row, but `AFTER INSERT ON j2_notes` fires the same
way either way, so the FTS index is what production would build. A trivial fixture cannot
stand in for this: the defects it exists to catch only show up at real scale.

Wave 7 (lane I, I1) additions:
  * `import conftest` BEFORE any `api.*` import, the same way `tools/selection_export_bridge.py`
    does. That applies the census pins (every `/data/...` path env var goes to a sandbox)
    and arms the shared-root tripwire, so a stray write can never reach `C:\\data`.
  * Every read is timed REPEATEDLY: `--warmup` untimed runs, then `--reps` timed runs.
    Each op reports p50 / p95 / max. One sample is an anecdote, not a p95.
  * New reads: `tag_tree`, the `/notes/tags` pair (tag_counts + tag_tree), the `GET /notes`
    pair (list + count, as the route runs them), `switcher_search`, and the `list_tasks`
    scan (the `?view=tasks` read).
  * A realistic seed: nested tags (`a/b/c`) beside the flat pool, a case variant of one
    flat tag, a trashed share and an archived share, cashtag mentions beside chart embeds,
    task lists with due dates, spread `updated_at`, and ~2 KB bodies (the size the wave-5
    switcher index was measured at).
  * `--json <path>`, which is what `tools/notebook_perf_budgets.py` reads. `--thresholds`
    compares a run against the committed budget and exits non-zero on a breach.

A `q=` search also writes one `activity_log` row (`notes._log_notebook_event`), a real
commit production pays on every search. The conftest sandbox's auth.db gets its schema
(`auth_db.init_db()`) at start-up, so that write lands and is timed. It must not fail fast,
because a failed write would look cheaper than a real one.

`get_symbol_backlinks` also looks up sector/industry/theme through `ticker_meta`, which
is a 24h-cached NETWORK lookup (yfinance / FMP / Finnhub). A benchmark must never make a
network call, and a network call is not a query cost, so that lookup is STUBBED here. The
number is the reverse-index read only.

Usage:
    python tools/notebook_scale_benchmark.py [--tiers 1000,10000,50000] [--reps 20]
        [--warmup 2] [--json report.json] [--thresholds docs/notebook/perf-budgets.json]
        [--keep-db] [--work-dir DIR]

Exit codes: 0 = every correctness check passed and no budget was breached; 1 = a
correctness check failed; 2 = a budget was breached (named on stdout); 3 = bad arguments
or a thresholds file this run cannot evaluate.
"""
from __future__ import annotations

import argparse
import contextlib
import json
import math
import os
import platform
import random
import sqlite3
import subprocess
import sys
import tempfile
import time
import tracemalloc
import types
import uuid
from datetime import datetime
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[1]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

import conftest  # noqa: E402,F401 -- the census and the tripwire, before any api.* import


@contextlib.contextmanager
def _ticker_meta_stubbed():
    """Swap the network-backed metadata lookup `get_symbol_backlinks` performs for a
    constant, for the duration of the measurement only, then put back whatever was
    there. It goes through sys.modules because the product imports it lazily INSIDE
    the function. It is scoped, not installed at import, because a test session that
    imports this tool must keep the real module for every other test."""
    key = "api.services.ticker_meta"
    had, prior = key in sys.modules, sys.modules.get(key)
    stub = types.ModuleType(key)
    stub.get_ticker_meta = lambda sym: {"sector": None, "industry": None, "theme": None}
    sys.modules[key] = stub
    try:
        yield stub
    finally:
        if had:
            sys.modules[key] = prior
        else:
            sys.modules.pop(key, None)

from api.services.journal_two import db as j2db  # noqa: E402
from api.services.journal_two import note_tasks  # noqa: E402
from api.services.journal_two import notes as notes_svc  # noqa: E402

USER_ID = "bench_user"
TODAY = "2026-09-25"  # the ET "today" every task read is evaluated against

_PARAGRAPH = (
    "Reviewed the setup on {ticker} this morning. Price reclaimed the 20 EMA "
    "on above-average volume after a three-week pullback from the prior high. "
    "Watching for a base breakout above {level} with a stop under the recent "
    "swing low. Risk stays under 1% of account size per the standard sizing "
    "rule. {marker}"
)
_COMMON_MARKER = "regime check confirms constructive breadth"
_RARE_MARKER = "zzqbenchmarkrareterm"
_TICKERS = ["AMD", "NVDA", "TSLA", "MSFT", "AAPL", "GOOGL", "META", "AVGO", "CRM", "NFLX"]
_TAGS_POOL = ["earnings", "setup", "watchlist", "review", "thesis", "risk", "macro"]
# Nested tags (Obsidian `a/b/c`), including a parent that is also a flat tag ("review")
# and a case variant of a nested path, so the tree's fold-and-recount path is exercised.
_NESTED_POOL = [
    "research/semis", "research/semis/memory", "research/software", "setups/breakout",
    "setups/breakout/vcp", "setups/pullback", "macro/rates", "Macro/Rates", "review/weekly",
]
_CASE_VARIANT = "Earnings"  # same tag_key as "earnings": the collided-group recount path

TIMED_OPS = [
    # label                                         (the route or reader it stands for)
    "list_notes (page 1, default sort)",
    "count_notes (whole library)",
    "GET /notes default (list+count)",
    "list_notes (FTS, common term ~30%)",
    "count_notes (FTS, common term ~30%)",
    "GET /notes q=common (list+count)",
    "list_notes (FTS, rare term, 1 note)",
    "GET /notes q=rare (list+count)",
    "GET /notes tag=setups (list+count)",
    "GET /notes embed_symbol (list+count)",
    "tag_counts (whole library)",
    "tag_tree (whole library)",
    "GET /notes/tags (tag_counts+tag_tree)",
    "folder_note_counts (whole library)",
    "notes_for_folders (heavy + 2 others)",
    "get_symbol_backlinks",
    "switcher_search (word start)",
    "switcher_search (fuzzy, in order)",
    "list_tasks (open, ?view=tasks)",
]


def _body(ticker: str, i: int, marker: str, paragraphs: int, tasks: list[dict] | None) -> tuple[str, str]:
    paras = []
    plain_parts = []
    for p in range(paragraphs):
        text = _PARAGRAPH.format(ticker=ticker, level=round(50 + i * 0.01 + p, 2),
                                 marker=marker if p == 0 else "")
        paras.append({"type": "paragraph", "content": [{"type": "text", "text": text}]})
        plain_parts.append(text)
    if tasks:
        items = []
        for t in tasks:
            content = [{"type": "text", "text": t["text"] + " "}]
            if t.get("due"):
                content.append({"type": "dateMention", "attrs": {"date": t["due"]}})
            items.append({"type": "taskItem", "attrs": {"checked": t["checked"]},
                          "content": [{"type": "paragraph", "content": content}]})
            plain_parts.append(t["text"])
        paras.append({"type": "taskList", "content": items})
    return json.dumps({"type": "doc", "content": paras}), " ".join(plain_parts)


def _seed(conn: sqlite3.Connection, n: int, heavy_folder_id: str, other_folder_ids: list[str],
          paragraphs: int) -> dict:
    """Bulk raw INSERT with a deterministic, realistic distribution. Returns the ground
    truth the correctness checks compare against."""
    rng = random.Random(42)
    base_ts = 1_788_000_000  # fixed epoch -> reproducible, strictly ordered updated_at
    rows, embed_rows, mention_rows = [], [], []
    common_count = rare_count = 0
    heavy_share = max(1, int(n * 0.15))
    trashed = archived = 0
    truth_tags: dict[str, set[str]] = {}       # tag_key -> active note ids carrying it exactly
    truth_under: dict[str, set[str]] = {}      # tag_key -> active note ids at or below it
    active_ids: list[str] = []
    open_tasks = 0
    heavy_active = 0
    backlink_notes: set[str] = set()
    for i in range(n):
        note_id = uuid.uuid4().hex
        ticker = _TICKERS[i % len(_TICKERS)]
        is_common = rng.random() < 0.30
        is_rare = (i == n // 2)
        marker = ""
        if is_common:
            marker = _COMMON_MARKER
        if is_rare:
            marker = (marker + " " + _RARE_MARKER).strip()
        tags = rng.sample(_TAGS_POOL, k=rng.randint(0, 3))
        if rng.random() < 0.25:
            tags += rng.sample(_NESTED_POOL, k=rng.randint(1, 2))
        if rng.random() < 0.02 and "earnings" not in tags:
            tags.append(_CASE_VARIANT)
        # de-dup by tag_key, the way the validator stores them
        seen, kept = set(), []
        for t in tags:
            k = notes_svc.tag_key(t)
            if k not in seen:
                seen.add(k)
                kept.append(t)
        tags = kept
        task_spec = None
        if rng.random() < 0.08:
            task_spec = []
            for j in range(3):
                due = None
                r = rng.random()
                if r < 0.3:
                    due = "2026-09-2" + str(rng.randint(0, 9))
                elif r < 0.45:
                    due = "2026-10-0" + str(rng.randint(1, 9))
                task_spec.append({"text": f"Follow up on {ticker} item {j}", "checked": rng.random() < 0.4,
                                  "due": due})
        body_json, body_plain = _body(ticker, i, marker, paragraphs, task_spec)
        folder_id = heavy_folder_id if i < heavy_share else (
            other_folder_ids[i % len(other_folder_ids)] if other_folder_ids and i % 3 != 0 else None)
        ts = time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime(base_ts + i * 37))
        deleted_at = archived_at = None
        roll = rng.random()
        if roll < 0.02:
            deleted_at = ts
            trashed += 1
        elif roll < 0.05:
            archived_at = ts
            archived += 1
        rows.append((note_id, USER_ID, None, folder_id, f"Note {i:06d} — {ticker} setup", None,
                     body_json, body_plain, None, None, ticker, json.dumps(tags), ts, ts,
                     deleted_at, archived_at))
        live = deleted_at is None and archived_at is None
        if live:
            active_ids.append(note_id)
            if is_common:
                common_count += 1
            if is_rare:
                rare_count += 1
            if folder_id == heavy_folder_id:
                heavy_active += 1
            for t in tags:
                k = notes_svc.tag_key(t)
                truth_tags.setdefault(k, set()).add(note_id)
                segs = k.split("/")
                for d in range(1, len(segs) + 1):
                    truth_under.setdefault("/".join(segs[:d]), set()).add(note_id)
            if task_spec:
                open_tasks += sum(1 for t in task_spec if not t["checked"])
        if i % 10 == 0:
            embed_rows.append((note_id, USER_ID, 0, "chart", ticker, "D", None, "snapshot", ts))
            if deleted_at is None and ticker == _TICKERS[0]:
                backlink_notes.add(note_id)
        if rng.random() < 0.20:
            sym = _TICKERS[(i * 7) % len(_TICKERS)]
            mention_rows.append((note_id, USER_ID, sym, ts))
            if deleted_at is None and sym == _TICKERS[0]:
                backlink_notes.add(note_id)
    conn.executemany(
        "INSERT INTO j2_notes (id, user_id, account_id, folder_id, title, subtitle,"
        " body_json, body_plain, hero_image_url, first_image_url, ticker, tags,"
        " created_at, updated_at, deleted_at, archived_at)"
        " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        rows,
    )
    conn.executemany(
        "INSERT INTO j2_note_embeds (note_id, user_id, position, widget_id, symbol,"
        " timeframe, trade_ref, mode, captured_at) VALUES (?,?,?,?,?,?,?,?,?)",
        embed_rows,
    )
    conn.executemany(
        "INSERT OR IGNORE INTO j2_note_mentions (note_id, user_id, symbol, created_at) VALUES (?,?,?,?)",
        mention_rows,
    )
    # A few recents and favourites, so the switcher's boost paths run.
    for k, nid in enumerate(active_ids[:40]):
        conn.execute("INSERT INTO j2_note_recents (user_id, note_id, opened_at) VALUES (?,?,?)",
                     (USER_ID, nid, f"2026-09-{10 + k % 15:02d}T12:00:00+00:00"))
    for nid in active_ids[40:60]:
        conn.execute("INSERT INTO j2_note_favorites (user_id, note_id, created_at) VALUES (?,?,?)",
                     (USER_ID, nid, "2026-09-01T00:00:00+00:00"))
    conn.commit()
    return {
        "active": len(active_ids), "trashed": trashed, "archived": archived,
        "heavy_active": heavy_active, "common_count": common_count, "rare_count": rare_count,
        "embed_symbol": _TICKERS[0], "backlink_notes": len(backlink_notes),
        "truth_tags": {k: len(v) for k, v in truth_tags.items()},
        "truth_under": {k: len(v) for k, v in truth_under.items()},
        "open_tasks": open_tasks,
    }


def percentile(samples: list[float], pct: float) -> float:
    """Nearest-rank percentile (no interpolation): the smallest sample with at least
    `pct`% of the samples at or below it."""
    if not samples:
        raise ValueError("no samples")
    s = sorted(samples)
    rank = max(1, math.ceil(pct / 100.0 * len(s)))
    return s[rank - 1]


def _measure(fn, warmup: int, reps: int) -> tuple[dict, object]:
    result = None
    for _ in range(warmup):
        result = fn()
    samples = []
    for _ in range(reps):
        t0 = time.perf_counter()
        result = fn()
        samples.append((time.perf_counter() - t0) * 1000.0)
    return {
        "p50_ms": round(percentile(samples, 50), 3),
        "p95_ms": round(percentile(samples, 95), 3),
        "max_ms": round(max(samples), 3),
        "min_ms": round(min(samples), 3),
        "reps": reps,
    }, result


def run_tier(n: int, *, reps: int, warmup: int, paragraphs: int, keep_db: bool = False,
             work_dir: str | None = None) -> dict:
    tmp_dir = tempfile.mkdtemp(prefix=f"j2_bench_{n}_", dir=work_dir)
    db_path = os.path.join(tmp_dir, "bench.db")
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    j2db.ensure_schema(conn)

    heavy = notes_svc.create_folder(USER_ID, "Catch-All", conn=conn)
    others = [notes_svc.create_folder(USER_ID, f"Folder {i}", conn=conn)["id"] for i in range(8)]

    seed_t0 = time.perf_counter()
    truth = _seed(conn, n, heavy["id"], others, paragraphs)
    seed_ms = (time.perf_counter() - seed_t0) * 1000.0
    # No ANALYZE: production never runs ANALYZE or `PRAGMA optimize` on auth.db, so the
    # planner here must see the same absence of sqlite_stat1 that it sees there.
    db_bytes = os.path.getsize(db_path)

    U = USER_ID
    now_et = datetime(2026, 9, 25, 12, tzinfo=note_tasks.ET)  # == TODAY in ET

    def pair(**kw):
        rows = notes_svc.list_notes(U, conn=conn, **kw)
        total = notes_svc.count_notes(U, conn=conn, **{k: v for k, v in kw.items() if k != "sort"})
        return rows, total

    def tags_pair():
        return notes_svc.tag_counts(U, conn=conn), notes_svc.tag_tree(U, conn=conn)

    ops = {
        "list_notes (page 1, default sort)": lambda: notes_svc.list_notes(U, conn=conn),
        "count_notes (whole library)": lambda: notes_svc.count_notes(U, conn=conn),
        "GET /notes default (list+count)": lambda: pair(),
        "list_notes (FTS, common term ~30%)": lambda: notes_svc.list_notes(U, q=_COMMON_MARKER, conn=conn),
        "count_notes (FTS, common term ~30%)": lambda: notes_svc.count_notes(U, q=_COMMON_MARKER, conn=conn),
        "GET /notes q=common (list+count)": lambda: pair(q=_COMMON_MARKER),
        "list_notes (FTS, rare term, 1 note)": lambda: notes_svc.list_notes(U, q=_RARE_MARKER, conn=conn),
        "GET /notes q=rare (list+count)": lambda: pair(q=_RARE_MARKER),
        "GET /notes tag=setups (list+count)": lambda: pair(tag="setups"),
        "GET /notes embed_symbol (list+count)": lambda: pair(embed_symbol=truth["embed_symbol"]),
        "tag_counts (whole library)": lambda: notes_svc.tag_counts(U, conn=conn),
        "tag_tree (whole library)": lambda: notes_svc.tag_tree(U, conn=conn),
        "GET /notes/tags (tag_counts+tag_tree)": tags_pair,
        "folder_note_counts (whole library)": lambda: notes_svc.folder_note_counts(U, conn=conn),
        "notes_for_folders (heavy + 2 others)":
            lambda: notes_svc.notes_for_folders(U, [heavy["id"], others[0], others[1]], conn=conn),
        "get_symbol_backlinks": lambda: notes_svc.get_symbol_backlinks(U, truth["embed_symbol"], conn=conn),
        "switcher_search (word start)": lambda: notes_svc.switcher_search(U, "nvda setup", conn=conn),
        "switcher_search (fuzzy, in order)": lambda: notes_svc.switcher_search(U, "ntvds", conn=conn),
        "list_tasks (open, ?view=tasks)": lambda: note_tasks.list_tasks(U, status="open", now=now_et, conn=conn),
    }
    assert list(ops) == TIMED_OPS, "TIMED_OPS and the op table drifted"

    tracemalloc.start()
    stats: dict[str, dict] = {}
    results: dict[str, object] = {}
    with _ticker_meta_stubbed():
        for label, fn in ops.items():
            stats[label], results[label] = _measure(fn, warmup, reps)
    _, peak_bytes = tracemalloc.get_traced_memory()
    tracemalloc.stop()

    counts = results["folder_note_counts (whole library)"]
    tag_rows = {notes_svc.tag_key(r["tag"]): r["count"] for r in results["tag_counts (whole library)"]}
    tree = {nd["key"]: nd for nd in results["tag_tree (whole library)"]}
    flat_truth = {k: c for k, c in truth["truth_tags"].items()}
    tasks = results["list_tasks (open, ?view=tasks)"]
    common_rows, common_total = results["GET /notes q=common (list+count)"]
    rare_rows = results["list_notes (FTS, rare term, 1 note)"]
    setups_rows, setups_total = results["GET /notes tag=setups (list+count)"]
    correctness = {
        "count_notes matches the seeded active total":
            results["count_notes (whole library)"] == truth["active"],
        "folder counts sum to the active total": counts["total"] == truth["active"],
        "heavy folder count matches the seeded active share":
            counts["counts"].get(heavy["id"]) == truth["heavy_active"],
        "notes_for_folders returns the heavy folder honestly (not capped at the old 100)":
            len(results["notes_for_folders (heavy + 2 others)"].get(heavy["id"], []))
            == min(truth["heavy_active"], 200),
        "FTS common-term count matches the seeded share":
            common_total == truth["common_count"] and len(common_rows) <= common_total,
        "FTS rare-term finds exactly the one seeded note": len(rare_rows) == truth["rare_count"],
        "tag_counts equals the recomputed truth for every tag (flat and nested)":
            tag_rows == flat_truth,
        "tag_tree totals equal the recomputed subtree truth":
            all(tree.get(k, {}).get("total") == c for k, c in truth["truth_under"].items())
            and set(tree) == set(truth["truth_under"]),
        "tag=setups returns the whole subtree": setups_total == truth["truth_under"].get("setups", 0),
        "backlinks count matches embeds UNION mentions for that symbol":
            results["get_symbol_backlinks"]["count"] == truth["backlink_notes"],
        "list_tasks returns every open task on an active note": tasks["count"] == truth["open_tasks"],
        "switcher finds titles": len(results["switcher_search (word start)"]["notes"]) > 0,
    }

    conn.close()
    if not keep_db:
        for suffix in ("", "-wal", "-shm"):
            try:
                os.remove(db_path + suffix)
            except OSError:
                pass
        try:
            os.rmdir(tmp_dir)
        except OSError:
            pass

    return {
        "n": n,
        "active": truth["active"], "trashed": truth["trashed"], "archived": truth["archived"],
        "seed_ms": round(seed_ms, 1),
        "db_bytes": db_bytes,
        "ops": stats,
        "peak_tracemalloc_bytes": peak_bytes,
        "correctness": correctness,
        "db_path": db_path if keep_db else None,
    }


def _git(*args: str) -> str | None:
    try:
        return subprocess.run(["git", "-C", str(_REPO_ROOT), *args], capture_output=True,
                              text=True, encoding="utf-8", errors="replace", timeout=20).stdout.strip()
    except Exception:  # noqa: BLE001 -- provenance is best-effort, never a reason to fail a run
        return None


def check_thresholds(report: dict, thresholds: dict) -> list[str]:
    """Every breach of `thresholds["search"]` in `report`, as sentences naming the op,
    tier, measured p95 and budget. An op the budget names but the run did not measure is
    a breach too: a budget that cannot be checked is not a budget that passed."""
    spec = thresholds.get("search") or {}
    limit = float(spec["p95_ms_max"])
    tier = int(spec["tier"])
    ops = spec["ops"]
    breaches: list[str] = []
    by_n = {t["n"]: t for t in report.get("tiers", [])}
    if tier not in by_n:
        return [f"budget tier {tier:,} was not run (ran: {sorted(by_n)}) -- nothing was checked"]
    measured = by_n[tier]["ops"]
    for op in ops:
        st = measured.get(op)
        if st is None:
            breaches.append(f"{op!r} at {tier:,} notes: not measured by this run")
        elif st["p95_ms"] >= limit:
            breaches.append(f"{op!r} at {tier:,} notes: p95 {st['p95_ms']:.1f} ms >= budget {limit:.0f} ms")
    return breaches


def _prepare_activity_sink() -> None:
    """Give the conftest sandbox's auth.db the schema and the one user row a search's
    `activity_log` INSERT needs, so the write every `q=` search makes in production is
    made (and timed) here too. The store is the sandbox conftest minted, never the shared
    data root."""
    from api.services import auth_db  # AUTH_DB_PATH was pointed at a temp store by conftest
    auth_db.init_db()
    aconn = auth_db.get_connection()
    try:
        aconn.execute("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, ?)",
                      (USER_ID, "bench@local.invalid", "x"))
        aconn.commit()
    finally:
        aconn.close()


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--tiers", default="1000,10000,50000")
    ap.add_argument("--reps", type=int, default=20)
    ap.add_argument("--warmup", type=int, default=2)
    ap.add_argument("--paragraphs", type=int, default=5, help="body paragraphs per note (~350 chars each)")
    ap.add_argument("--json", dest="json_path", default=None, help="write the machine-readable report here")
    ap.add_argument("--out", dest="json_path", help=argparse.SUPPRESS)  # the old flag name
    ap.add_argument("--thresholds", default=None, help="budget JSON (docs/notebook/perf-budgets.json)")
    ap.add_argument("--keep-db", action="store_true")
    ap.add_argument("--work-dir", default=None, help="where the per-tier SQLite files go (default: TEMP)")
    args = ap.parse_args(argv)

    try:
        tiers = [int(x) for x in args.tiers.split(",") if x.strip()]
    except ValueError:
        print(f"bad --tiers {args.tiers!r}")
        return 3
    if not tiers or args.reps < 1 or args.warmup < 0:
        print("need at least one tier, --reps >= 1 and --warmup >= 0")
        return 3
    thresholds = None
    if args.thresholds:
        try:
            thresholds = json.loads(Path(args.thresholds).read_text(encoding="utf-8"))
            thresholds["search"]["p95_ms_max"], thresholds["search"]["tier"], thresholds["search"]["ops"]
        except (OSError, ValueError, KeyError, TypeError) as e:
            print(f"cannot read a search budget from {args.thresholds}: {e!r}")
            return 3

    violations_before = len(conftest.SHARED_ROOT_VIOLATIONS)
    _prepare_activity_sink()

    report = {
        "meta": {
            "tool": "tools/notebook_scale_benchmark.py",
            "argv": sys.argv[1:] if argv is None else argv,
            "git_head": _git("rev-parse", "HEAD"),
            "git_dirty_paths": (_git("status", "--porcelain", "--", "api", "tools") or "").splitlines(),
            "python": platform.python_version(), "sqlite": sqlite3.sqlite_version,
            "platform": platform.platform(), "reps": args.reps, "warmup": args.warmup,
            "paragraphs": args.paragraphs, "started_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        },
        "tiers": [],
    }
    for n in tiers:
        print(f"\n=== Seeding + measuring {n:,} notes ({args.reps} reps after {args.warmup} warmup) ===")
        r = run_tier(n, reps=args.reps, warmup=args.warmup, paragraphs=args.paragraphs,
                     keep_db=args.keep_db, work_dir=args.work_dir)
        report["tiers"].append(r)
        print(f"  seed {r['seed_ms'] / 1000:.1f}s  db {r['db_bytes'] / 1e6:.1f} MB  "
              f"active {r['active']:,} trashed {r['trashed']:,} archived {r['archived']:,}")
        print(f"  {'op':52s} {'p50':>9s} {'p95':>9s} {'max':>9s}")
        for label, st in r["ops"].items():
            print(f"  {label:52s} {st['p50_ms']:8.2f}ms {st['p95_ms']:8.2f}ms {st['max_ms']:8.2f}ms")
        failed = [k for k, v in r["correctness"].items() if not v]
        print(f"  XX CORRECTNESS FAILURES: {failed}" if failed else "  OK all correctness checks passed")

    stray = conftest.SHARED_ROOT_VIOLATIONS[violations_before:]
    report["meta"]["shared_root_writes"] = [{"op": v["op"], "path": v["path"]} for v in stray]
    if args.json_path:
        Path(args.json_path).write_text(json.dumps(report, indent=2), encoding="utf-8")
        print(f"\nreport: {args.json_path}")
    if stray:
        print(f"VERDICT: FAIL -- {len(stray)} write(s) reached the shared data root: {stray[:3]}")
        return 1
    if any(not v for t in report["tiers"] for v in t["correctness"].values()):
        print("VERDICT: FAIL -- a correctness check failed (a fast wrong answer is not a pass)")
        return 1
    if thresholds is not None:
        breaches = check_thresholds(report, thresholds)
        if breaches:
            print("VERDICT: BUDGET BREACH")
            for b in breaches:
                print(f"  BREACH {b}")
            return 2
        print(f"VERDICT: PASS -- every budgeted op under {thresholds['search']['p95_ms_max']} ms p95 "
              f"at {thresholds['search']['tier']:,} notes")
        return 0
    print("VERDICT: PASS (no thresholds given)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
