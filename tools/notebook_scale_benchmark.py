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
  * New reads: `tag_tree`, the `/notes/tags` pair, the `GET /notes` pair (list + count),
    `switcher_search`, and the `list_tasks` scan (the `?view=tasks` read). The two pairs call
    what their ROUTES call (`tag_counts_and_tree`, `list_and_count_notes`), so the number is
    what a member waits for; the single-function rows beside them are the parts.
  * A realistic seed: nested tags (`a/b/c`) beside the flat pool, a case variant of one
    flat tag, a trashed share and an archived share, cashtag mentions beside chart embeds,
    task lists with due dates, spread `updated_at`, and ~2 KB bodies (the size the wave-5
    switcher index was measured at).
  * `--json <path>`, which is what `tools/notebook_perf_budgets.py` reads. `--thresholds`
    compares a run against the committed budget file and exits non-zero on a breach; which
    budgets, with `--budget` (repeatable, default `search`). The comparison itself is
    `notebook_perf_budgets.check_search` -- ONE implementation, never a copy here.

Wave 7 whole-branch fix (tooling review I-3): A BREACH MUST REPRODUCE. After a tier's timed
pass, every op whose p95 is at or over a line it is budgeted against is RE-TIMED once, with the
same warmup and reps, and the second reading is written beside the first (`"remeasure"`).
`check_search` then breaches an op only when both readings are over the line; one that did not
reproduce is printed as a note. The lines come from `--remeasure KEY` (repeatable; the CI job
names its three budgets) and, with `--thresholds`, from every enforced `--budget` too, read out
of the budget file (`--thresholds`, else `docs/notebook/perf-budgets.json`). No line moves:
this changes what counts as a reading, never what a reading must be under. Measured before the
fix: 8 of 56 runs of the CI job on `feat/notebook-w7` went red, every one on `search_ci`'s
`q=` ops, several on commits that could not move a read.

Wave 10 (lane 10A) additions:
  * `--attachments N` (clause 14b): N extracted documents (3 pages each) seeded over the notes,
    and the document reads timed through the routes a browser calls (`ATTACHMENT_OPS`), each
    with correctness checks that can fail (a rare page found once, a trashed note's page never).
  * `--curve` (clause 14d): the tiers 1k / 5k / 10k / 25k / 50k, and every op's log-log slope
    printed and bounded by the `curve` budget (`notebook_perf_budgets.check_curve`).
  * `--ratio KEY` (ruling R-10): at the budget's tier, every op it names timed as a median ratio
    to `CALIBRATION_OP`, re-measured when over its line; `--slow-op LABEL=MS` feeds a check a
    slowed op on purpose (the rail that proves the check goes red, and the CI red-once run).
  * `--members N` (fix round 1, review M-4): every tier seeds N members, each with a library
    of the tier's size (the same seed, so the same share of every search term), and times the
    FIRST member's reads. The full-text index is one table for every member, so a read that
    is not scoped to its member pays for everyone's notes -- invisible with one member.

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
        [--budget search [--budget tasks ...]] [--remeasure search_ci [--remeasure ...]]
        [--keep-db] [--work-dir DIR] [--attachments N] [--curve] [--ratio KEY]
        [--slow-op LABEL=MS]

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
import statistics
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
    "GET /notes q=common, relevance (search box)",
    "GET /notes q=rare, relevance (search box)",
    "GET /notes tag=setups (list+count)",
    "GET /notes embed_symbol (list+count)",
    "tag_counts (whole library)",
    "tag_tree (whole library)",
    "GET /notes/tags (tags+tree)",
    "folder_note_counts (whole library)",
    "notes_for_folders (heavy + 2 others)",
    "get_symbol_backlinks",
    "switcher_search (word start)",
    "switcher_search (fuzzy, in order)",
    "list_tasks (open, ?view=tasks)",
]

# ── Wave 10 (lane 10A): the 10k-attachment tier (clause 14b) ──
# The reads that grow with ATTACHMENTS rather than notes, timed through the routes a member's
# browser calls (the search box's document half, `useDocumentSearch`; the editor's per-note
# document list, `useNoteDocuments`). Added to the op table only when `--attachments N` seeds
# documents, so a run without attachments measures exactly what it always did.
ATTACHMENT_OPS = [
    "GET /notes/documents/search q=common (search box)",
    "GET /notes/documents/search q=rare (search box)",
    "GET /notes/{id}/documents (note with 50 documents)",
]
_DOC_COMMON_MARKER = "quarterly guidance reiterated"
_DOC_RARE_MARKER = "zzqdocrareterm"
_DOC_TRASH_MARKER = "zzqdoctrashonly"   # on a TRASHED note's document only: must never be found
_HEAVY_DOCS = 50
_PAGES_PER_DOC = 3
_DOC_PAGE = ("Management discussed {ticker} segment revenue, gross margin and the capital "
             "return plan for the coming quarters, with inventory normalising and pricing held. "
             "Filing page {p} of document {d}. {marker} ")

# ── Wave 10 (lane 10A): the curve (clause 14d) ──
CURVE_TIERS = (1000, 5000, 10000, 25000, 50000)

# ── Wave 10 (lane 10A): the runner-noise-robust CI latency check (ruling R-10) ──
# Each op is timed as a RATIO to an in-run calibration op: a fixed SQLite + JSON workload that
# touches no product code, so a runner that is 2x slower makes both halves 2x slower and the
# ratio does not move. The calibration builds its own table (never the product schema), so a
# product change can never move the yardstick it is measured against.
CALIBRATION_OP = "calibration (fixed SQLite + JSON workload)"
_CALIB_ROWS = 20000
_CALIB_WORDS = ("ledger", "margin", "breakout", "volume", "pullback", "earnings", "guidance",
                "sector", "rotation", "base", "pivot", "stop", "risk", "trend", "gap", "range")


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


def _seed_attachments(conn: sqlite3.Connection, count: int) -> dict:
    """Bulk raw INSERT of `count` extracted documents (`_PAGES_PER_DOC` pages each) over the
    notes `_seed` wrote, through the real schema: the page triggers fill the document FTS the
    way an extraction does. Distribution: `_HEAVY_DOCS` on one live note (the editor's per-note
    list), one per note after that across the library, every 50th on a TRASHED note (search
    must hide those), the common marker on ~30% of pages, the rare marker on exactly one live
    page and the trash marker on exactly one trashed page. Returns the ground truth.

    ⚠️ Documents only: the file bytes behind them are never written (no read here serves one),
    and no image node is added to a body -- no timed read derives anything from one."""
    rng = random.Random(1014)
    notes = conn.execute(
        "SELECT id, deleted_at, archived_at, ticker, updated_at FROM j2_notes"
        " WHERE user_id = ? ORDER BY rowid", (USER_ID,)).fetchall()
    live = [r for r in notes if r[1] is None and r[2] is None]
    trashed = [r for r in notes if r[1] is not None]
    if len(live) < 2:
        raise ValueError("the attachment seed needs at least two live notes")
    heavy_note = live[0]
    heavy = min(_HEAVY_DOCS, count)
    doc_rows, page_rows = [], []
    rare_at = heavy + (count - heavy) // 2      # a document on a live note, never the heavy one
    trash_placed = False
    rare_placed = 0
    common_live_pages = 0
    k = 1
    for d in range(count):
        on_trash = False
        if d < heavy:
            note = heavy_note
        elif trashed and d % 50 == 0 and d != rare_at:
            note = trashed[(d // 50) % len(trashed)]
            on_trash = True
        else:
            note = live[1 + (k % (len(live) - 1))]
            k += 1
        doc_id = uuid.uuid4().hex
        ts = note[4]
        doc_rows.append((doc_id, USER_ID, note[0],
                         f"/api/j2/notes/attachments/{USER_ID}/{note[0]}/files/filing-{d:05d}.pdf",
                         f"Filing {d:05d}.pdf", "ready", _PAGES_PER_DOC, 1, ts, ts))
        for p in range(1, _PAGES_PER_DOC + 1):
            markers = []
            if rng.random() < 0.30:
                markers.append(_DOC_COMMON_MARKER)
                if not on_trash:
                    common_live_pages += 1
            if d == rare_at and p == 2:
                markers.append(_DOC_RARE_MARKER)
                rare_placed += 1
            if on_trash and not trash_placed and p == 1:
                markers.append(_DOC_TRASH_MARKER)
                trash_placed = True
            text = (_DOC_PAGE.format(ticker=note[3], p=p, d=d, marker=" ".join(markers)) * 4).strip()
            page_rows.append((doc_id, USER_ID, p, text, "native"))
    conn.executemany(
        "INSERT INTO j2_note_documents (id, user_id, note_id, attachment_url, name, status,"
        " page_count, extraction_version, created_at, processed_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
        doc_rows)
    conn.executemany(
        "INSERT INTO j2_note_document_pages (document_id, user_id, page_number, text, text_origin)"
        " VALUES (?,?,?,?,?)", page_rows)
    conn.commit()
    return {"attachments": count, "pages": len(page_rows), "heavy_note_id": heavy_note[0],
            "heavy_docs": heavy, "rare_pages": rare_placed, "trash_marker_placed": trash_placed,
            "common_live_pages": common_live_pages}


@contextlib.contextmanager
def _auth_db_is(path: str):
    """Point `auth_db.get_connection()` at the tier's database for the duration of ONE route
    call, then put back whatever was there. The document routes open their own connection the
    way production does (a fresh one per request, production's own timeout and row factory),
    so the timing includes that open. Scoped per call, never for the tier: a `q=` search's
    activity write must keep landing in the conftest sandbox's auth.db."""
    from api.services import auth_db
    prior = auth_db._DB_PATH
    auth_db._DB_PATH = path
    try:
        yield
    finally:
        auth_db._DB_PATH = prior


def _build_calibration(work_dir: str) -> tuple[sqlite3.Connection, object]:
    """The calibration op's own database and the op itself. Deterministic (fixed seed, fixed
    row count), product-independent (its own table), and shaped like the timed reads: an
    `instr` scan with a GROUP BY, a `json_each` fan-out, and a Python JSON loop."""
    path = os.path.join(work_dir, "calibration.db")
    c = sqlite3.connect(path)
    c.execute("PRAGMA journal_mode=WAL")
    c.execute("DROP TABLE IF EXISTS calib")
    c.execute("CREATE TABLE calib (id INTEGER PRIMARY KEY, grp INTEGER NOT NULL,"
              " body TEXT NOT NULL, tags TEXT NOT NULL)")
    rng = random.Random(1010)
    c.executemany("INSERT INTO calib (id, grp, body, tags) VALUES (?,?,?,?)", [
        (i, i % 97, " ".join(rng.choice(_CALIB_WORDS) for _ in range(60)),
         json.dumps(rng.sample(_CALIB_WORDS, 3))) for i in range(_CALIB_ROWS)])
    c.commit()

    def op():
        a = c.execute("SELECT grp, count(*), sum(length(body)) FROM calib"
                      " WHERE instr(body, 'ledger pivot') > 0 GROUP BY grp").fetchall()
        b = c.execute("SELECT value, count(*) FROM calib, json_each(calib.tags) GROUP BY value").fetchall()
        n = 0
        for (t,) in c.execute("SELECT tags FROM calib WHERE id % 4 = 0"):
            n += len(json.loads(t))
        return len(a), len(b), n
    return c, op


def _ratio_rounds(fn, calibration, *, rounds: int, reps: int, warmup: int, measure) -> dict:
    """`rounds` interleaved (calibration, op) pairs; each round's ratio is the op's p50 over the
    calibration's p50 in THAT round, and the reading is the median round. Interleaving puts a
    burst on both halves of a round; the median discards the rounds a burst split."""
    ratios, calib = [], []
    for _ in range(rounds):
        c, _ = measure(calibration, warmup, reps)
        o, _ = measure(fn, warmup, reps)
        calib.append(c["p50_ms"])
        ratios.append(round(o["p50_ms"] / c["p50_ms"], 4) if c["p50_ms"] > 0 else float("inf"))
    return {"rounds": ratios, "median": statistics.median(ratios),
            "calibration_p50_ms": round(statistics.median(calib), 3)}


def measure_ratios(ops: dict, lines: dict[str, float], calibration, *, rounds: int,
                   reps: int, warmup: int, measure=None) -> dict:
    """The R-10 reading for every op in `lines` (`{op: ratio line}`) that `ops` holds: its median
    ratio, and -- when that median is at or over its line -- a second, independent set of rounds
    (`"remeasure"`). The budget tool breaches an op only when BOTH medians are over the line. An
    op `ops` does not hold is left out, so the checker names it as unmeasured (never a pass).
    `measure` is late-bound (`_measure` by default) so a rail can drive it with fixed readings."""
    measure = measure or _measure
    out: dict[str, dict] = {}
    for label, line in lines.items():
        fn = ops.get(label)
        if fn is None:
            continue
        r = _ratio_rounds(fn, calibration, rounds=rounds, reps=reps, warmup=warmup, measure=measure)
        if r["median"] >= line:
            r["remeasure"] = _ratio_rounds(fn, calibration, rounds=rounds, reps=reps,
                                           warmup=warmup, measure=measure)
        out[label] = r
    return out


def _slowed(fn, ms: float):
    """`fn` plus a fixed sleep: the seam that feeds the CI check a slowed op (`--slow-op`), so
    'the check goes red on a slow op' is something a rail and a CI run can show, not assert."""
    def slow():
        time.sleep(ms / 1000.0)
        return fn()
    return slow


def percentile(samples: list[float], pct: float) -> float:
    """Nearest-rank percentile (no interpolation): the smallest sample with at least
    `pct`% of the samples at or below it."""
    if not samples:
        raise ValueError("no samples")
    s = sorted(samples)
    rank = max(1, math.ceil(pct / 100.0 * len(s)))
    return s[rank - 1]


def _measure(fn, warmup: int, reps: int, clock=None) -> tuple[dict, object]:
    # `clock` is late-bound (a default argument is bound at import): a rail drives it with a
    # fake timer so a spike and a reproducing slowdown can be written, not waited for.
    clock = clock or time.perf_counter
    result = None
    for _ in range(warmup):
        result = fn()
    samples = []
    for _ in range(reps):
        t0 = clock()
        result = fn()
        samples.append((clock() - t0) * 1000.0)
    return {
        "p50_ms": round(percentile(samples, 50), 3),
        "p95_ms": round(percentile(samples, 95), 3),
        "max_ms": round(max(samples), 3),
        "min_ms": round(min(samples), 3),
        "reps": reps,
    }, result


def remeasure_breaches(stats: dict[str, dict], ops: dict, lines: dict[str, float], *,
                       warmup: int, reps: int, measure=None) -> list[str]:
    """Re-time, ONCE and with the same warmup and reps, every op whose p95 is at or over its
    line in `lines` (`{op label: p95 line in ms}`), and write the second reading beside the first
    as `stats[op]["remeasure"]`. Returns the labels re-timed. `measure` is late-bound (`_measure`
    by default) so a rail can drive both passes from one fake clock.

    ⛔ This is what makes a CI latency breach mean "it reproduced" (tooling review I-3): the job
    went red on 8 of 56 runs, all on runner noise; `check_search` now breaches an op only when
    this second reading is over the line too. Only an op that ALREADY read over its line is
    re-timed, so a quiet run pays nothing."""
    measure = measure or _measure
    again = []
    for label, line in lines.items():
        st = stats.get(label)
        if st is None or label not in ops or st["p95_ms"] < line:
            continue
        second, _ = measure(ops[label], warmup, reps)
        st["remeasure"] = {**second, "line_ms": line}
        again.append(label)
    return again


def run_tier(n: int, *, reps: int, warmup: int, paragraphs: int, keep_db: bool = False,
             work_dir: str | None = None, remeasure_lines: dict[str, float] | None = None,
             attachments: int = 0, ratio_spec: dict | None = None,
             slow_ops: dict[str, float] | None = None, members: int = 1) -> dict:
    global USER_ID       # --members seeds the others under their own ids, then restores it
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
    # Fix round 1 (review M-4): OTHER members' libraries of the same size (the same seed,
    # so the same share of every search term). The full-text index is one table for every
    # member, so a read that is not scoped to the member pays for theirs too -- a cost a
    # one-member seed cannot show. The timed reads and the correctness checks stay the
    # first member's; the others only share the tables.
    first = USER_ID
    try:
        for k in range(1, max(1, members)):
            USER_ID = f"{first}_other{k}"
            oh = notes_svc.create_folder(USER_ID, "Catch-All", conn=conn)
            oo = [notes_svc.create_folder(USER_ID, f"Folder {i}", conn=conn)["id"] for i in range(8)]
            _seed(conn, n, oh["id"], oo, paragraphs)
    finally:
        USER_ID = first
    seed_ms = (time.perf_counter() - seed_t0) * 1000.0
    notes_all_members = conn.execute("SELECT count(*) FROM j2_notes").fetchone()[0]
    # Wave 10 (lane 10A): the raw seed bypasses the door writers, which refill the
    # task index in production on every save. The boot backfill is what fills it for
    # rows written without a door, so it stands in for them here -- the same
    # "indexes maintained during the seed, as production maintains them" rule the
    # wave-7 A/B followed (perf-budgets.md §2). Its cost is reported, not hidden.
    digest_t0 = time.perf_counter()
    j2db.backfill_note_task_digest(conn)
    digest_ms = (time.perf_counter() - digest_t0) * 1000.0
    atruth = None
    attach_ms = 0.0
    if attachments:
        att_t0 = time.perf_counter()
        atruth = _seed_attachments(conn, attachments)
        attach_ms = (time.perf_counter() - att_t0) * 1000.0
    # No ANALYZE: production never runs ANALYZE or `PRAGMA optimize` on auth.db, so the
    # planner here must see the same absence of sqlite_stat1 that it sees there.
    db_bytes = os.path.getsize(db_path)

    U = USER_ID
    now_et = datetime(2026, 9, 25, 12, tzinfo=note_tasks.ET)  # == TODAY in ET

    def pair(**kw):
        # What `GET /notes` runs: the page and its true total, one call (wave 7).
        return notes_svc.list_and_count_notes(U, conn=conn, **kw)

    def tags_pair():
        # What `GET /notes/tags` runs: both halves from one grouping pass (wave 7).
        return notes_svc.tag_counts_and_tree(U, conn=conn)

    ops = {
        "list_notes (page 1, default sort)": lambda: notes_svc.list_notes(U, conn=conn),
        "count_notes (whole library)": lambda: notes_svc.count_notes(U, conn=conn),
        "GET /notes default (list+count)": lambda: pair(),
        "list_notes (FTS, common term ~30%)": lambda: notes_svc.list_notes(U, q=_COMMON_MARKER, conn=conn),
        "count_notes (FTS, common term ~30%)": lambda: notes_svc.count_notes(U, q=_COMMON_MARKER, conn=conn),
        "GET /notes q=common (list+count)": lambda: pair(q=_COMMON_MARKER),
        "list_notes (FTS, rare term, 1 note)": lambda: notes_svc.list_notes(U, q=_RARE_MARKER, conn=conn),
        "GET /notes q=rare (list+count)": lambda: pair(q=_RARE_MARKER),
        # What the search box itself asks for (FolderSidebar: sort=relevance, limit=100).
        "GET /notes q=common, relevance (search box)": lambda: pair(q=_COMMON_MARKER, sort="relevance", limit=100),
        "GET /notes q=rare, relevance (search box)": lambda: pair(q=_RARE_MARKER, sort="relevance", limit=100),
        "GET /notes tag=setups (list+count)": lambda: pair(tag="setups"),
        "GET /notes embed_symbol (list+count)": lambda: pair(embed_symbol=truth["embed_symbol"]),
        "tag_counts (whole library)": lambda: notes_svc.tag_counts(U, conn=conn),
        "tag_tree (whole library)": lambda: notes_svc.tag_tree(U, conn=conn),
        "GET /notes/tags (tags+tree)": tags_pair,
        "folder_note_counts (whole library)": lambda: notes_svc.folder_note_counts(U, conn=conn),
        "notes_for_folders (heavy + 2 others)":
            lambda: notes_svc.notes_for_folders(U, [heavy["id"], others[0], others[1]], conn=conn),
        "get_symbol_backlinks": lambda: notes_svc.get_symbol_backlinks(U, truth["embed_symbol"], conn=conn),
        "switcher_search (word start)": lambda: notes_svc.switcher_search(U, "nvda setup", conn=conn),
        "switcher_search (fuzzy, in order)": lambda: notes_svc.switcher_search(U, "ntvds", conn=conn),
        "list_tasks (open, ?view=tasks)": lambda: note_tasks.list_tasks(U, status="open", now=now_et, conn=conn),
    }
    assert list(ops) == TIMED_OPS, "TIMED_OPS and the op table drifted"
    if atruth is not None:
        from api.routers import journal_two as j2_router   # lazily: only an attachment tier needs it
        user = {"id": U}

        def doc_search(q):
            with _auth_db_is(db_path):
                return j2_router.search_note_documents_endpoint(q=q, limit=20, user=user)

        def doc_list():
            with _auth_db_is(db_path):
                return j2_router.list_note_documents_endpoint(atruth["heavy_note_id"], user=user)
        ops[ATTACHMENT_OPS[0]] = lambda: doc_search(_DOC_COMMON_MARKER)
        ops[ATTACHMENT_OPS[1]] = lambda: doc_search(_DOC_RARE_MARKER)
        ops[ATTACHMENT_OPS[2]] = doc_list
        assert list(ops) == TIMED_OPS + ATTACHMENT_OPS, "ATTACHMENT_OPS and the op table drifted"
    for label, ms in (slow_ops or {}).items():
        if label not in ops:
            raise KeyError(f"--slow-op names {label!r}, which this tier does not time")
        ops[label] = _slowed(ops[label], ms)

    stats: dict[str, dict] = {}
    results: dict[str, object] = {}
    ratio_out = None
    with _ticker_meta_stubbed():
        # ⛔⛔ TIMED WITH TRACEMALLOC OFF. The wave-0 version timed every read INSIDE
        # tracemalloc, which hooks every Python allocation. Measured on the 50k seed:
        # switcher_search 62 ms untraced vs 435 ms traced (x7.0), list_tasks x1.9,
        # tag_tree x1.6, while the SQL-bound reads did not move (tag_counts, folder
        # counts x1.0). So the instrument inflated exactly the Python-heavy reads and
        # would have sent the fix work after a slowness the product does not have.
        for label, fn in ops.items():
            stats[label], results[label] = _measure(fn, warmup, reps)
        # A reading over a budgeted line is re-timed once before it can count (I-3), still
        # untraced, after every op has had its first pass.
        if remeasure_lines:
            remeasure_breaches(stats, ops, remeasure_lines, warmup=warmup, reps=reps)
        # R-10: the ratio reading, after every op's own pass, still untraced.
        if ratio_spec is not None and int(ratio_spec["tier"]) == n:
            from tools import notebook_perf_budgets as pb
            calib_conn, calibration = _build_calibration(tmp_dir)
            try:
                lines_by_op = pb.ratio_lines(ratio_spec)
                ratio_out = {
                    "budget_line_ms": float(ratio_spec["line_ms"]),
                    "calibration_ref_ms": float(ratio_spec["calibration_ref_ms"]),
                    "line": pb.ratio_line(ratio_spec), "lines": lines_by_op,
                    "rounds": int(ratio_spec["rounds"]),
                    "ops": measure_ratios(ops, lines_by_op, calibration,
                                          rounds=int(ratio_spec["rounds"]),
                                          reps=int(ratio_spec["reps"]), warmup=warmup),
                }
            finally:
                calib_conn.close()
        # Peak memory comes from ONE untimed pass per op, traced separately.
        tracemalloc.start()
        for fn in ops.values():
            fn()
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
    if atruth is not None:
        with _auth_db_is(db_path):
            from api.routers import journal_two as j2_router
            trash_hits = j2_router.search_note_documents_endpoint(
                q=_DOC_TRASH_MARKER, limit=20, user={"id": U})["results"]
        listed = results[ATTACHMENT_OPS[2]]["documents"]
        correctness.update({
            "document search finds exactly the one rare page":
                len(results[ATTACHMENT_OPS[1]]["results"]) == atruth["rare_pages"] == 1,
            "document search returns a full page of common hits":
                len(results[ATTACHMENT_OPS[0]]["results"]) == min(20, atruth["common_live_pages"]),
            "document search hides a trashed note's documents":
                atruth["trash_marker_placed"] and trash_hits == [],
            "the heavy note lists every one of its documents, each with its whole text":
                len(listed) == atruth["heavy_docs"]
                and all(d["pagesTotal"] == _PAGES_PER_DOC and d["textComplete"] for d in listed),
        })

    conn.close()
    if not keep_db:
        for base in (db_path, os.path.join(tmp_dir, "calibration.db")):
            for suffix in ("", "-wal", "-shm"):
                try:
                    os.remove(base + suffix)
                except OSError:
                    pass
        try:
            os.rmdir(tmp_dir)
        except OSError:
            pass

    return {
        "n": n,
        "members": max(1, members),
        "notes_all_members": notes_all_members,
        "active": truth["active"], "trashed": truth["trashed"], "archived": truth["archived"],
        "seed_ms": round(seed_ms, 1),
        "task_digest_backfill_ms": round(digest_ms, 1),
        "attachments": attachments,
        "attachment_pages": atruth["pages"] if atruth else 0,
        "attachment_seed_ms": round(attach_ms, 1),
        "db_bytes": db_bytes,
        "ops": stats,
        "ratio": ratio_out,
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


def check_thresholds(report: dict, thresholds: dict, budget: str = "search") -> list[str]:
    """Every breach of `thresholds[budget]` in `report`, as sentences naming the op, tier,
    measured p95 and budget. An op the budget names but the run did not measure is a breach
    too: a budget that cannot be checked is not a budget that passed.

    ⛔ Delegates to `tools/notebook_perf_budgets.check_search`. This used to be a second copy
    of that comparison, and two copies of one rule drift (the CI job reads the budget tool,
    a local run read this)."""
    from tools.notebook_perf_budgets import check_search
    return check_search(report, thresholds[budget])


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
    ap.add_argument("--budget", action="append", default=None,
                    help="which budget key(s) of --thresholds to apply (repeatable; default: search)")
    ap.add_argument("--remeasure", action="append", default=None,
                    help="budget key(s) whose lines trigger a one-time re-measure of an op that reads "
                         "over them (repeatable; read from --thresholds, else docs/notebook/perf-budgets.json). "
                         "Every --budget applied with --thresholds is re-measured too")
    ap.add_argument("--keep-db", action="store_true")
    ap.add_argument("--work-dir", default=None, help="where the per-tier SQLite files go (default: TEMP)")
    ap.add_argument("--attachments", type=int, default=0,
                    help="seed this many extracted documents into every tier and time the "
                         "document reads (clause 14b; the `attachments` budget)")
    ap.add_argument("--curve", action="store_true",
                    help="run the curve tiers (1k/5k/10k/25k/50k unless --tiers is given) and "
                         "bound each op's log-log slope by the `curve` budget (clause 14d)")
    ap.add_argument("--ratio", default=None,
                    help="a ratio budget key (e.g. ratio_ci): time each of its ops as a ratio to "
                         "the in-run calibration op at its tier, and breach on it (ruling R-10)")
    ap.add_argument("--members", type=int, default=1,
                    help="seed this many members, each with a library of the tier's size, and "
                         "time the first one's reads (review M-4: an unscoped read pays for "
                         "every member's notes)")
    ap.add_argument("--slow-op", action="append", default=None, metavar="LABEL=MS",
                    help="add MS of sleep to one timed op: feeds a check a slowed op on purpose")
    args = ap.parse_args(argv)

    tiers_arg = args.tiers
    if args.curve and not any(a == "--tiers" or str(a).startswith("--tiers=") for a in (argv or sys.argv[1:])):
        tiers_arg = ",".join(str(t) for t in CURVE_TIERS)
    try:
        tiers = [int(x) for x in tiers_arg.split(",") if x.strip()]
    except ValueError:
        print(f"bad --tiers {tiers_arg!r}")
        return 3
    if not tiers or args.reps < 1 or args.warmup < 0 or args.attachments < 0 or args.members < 1:
        print("need at least one tier, --reps >= 1, --warmup >= 0, --attachments >= 0 and --members >= 1")
        return 3
    slow_ops: dict[str, float] = {}
    for item in args.slow_op or []:
        label, sep, ms = item.rpartition("=")
        try:
            if not sep or not label:
                raise ValueError(item)
            slow_ops[label] = float(ms)
        except ValueError:
            print(f"bad --slow-op {item!r} (want LABEL=MS)")
            return 3
    thresholds = None
    # A --ratio or --curve run applies only what it names: `search` is the default budget of a
    # plain `--thresholds` run, never of one that asked for something else.
    budget_keys = args.budget or ([] if (args.ratio or args.curve) else ["search"])
    if args.thresholds:
        try:
            thresholds = json.loads(Path(args.thresholds).read_text(encoding="utf-8"))
            for key in budget_keys:
                spec = thresholds[key]
                float(spec["p95_ms_max"]), int(spec["tier"])
                if not spec["ops"]:
                    raise ValueError(f"budget {key!r} names no ops")
        except (OSError, ValueError, KeyError, TypeError) as e:
            print(f"cannot read a search budget from {args.thresholds}: {e!r}")
            return 3
    # I-3: which budgets' lines trigger a re-measure. Every enforced --budget (with
    # --thresholds) plus every --remeasure key, read from the thresholds file when one was given,
    # else the committed budget file (looked up at CALL time, so a rail can point it elsewhere).
    remeasure_keys = list(dict.fromkeys((budget_keys if thresholds is not None else []) + (args.remeasure or [])))
    remeasure_src = thresholds
    if remeasure_keys:
        from tools import notebook_perf_budgets as pb
        try:
            if remeasure_src is None:
                remeasure_src = pb.load_budgets(pb.DEFAULT_BUDGETS)
            for key in remeasure_keys:
                spec = remeasure_src[key]
                float(spec["p95_ms_max"]), int(spec["tier"])
                if not spec["ops"]:
                    raise ValueError(f"budget {key!r} names no ops")
        except (pb.Unevaluable, OSError, ValueError, KeyError, TypeError) as e:
            print(f"cannot read a re-measure budget: {e!r}")
            return 3
    # R-10 and 14d read their specs from the thresholds file, else the committed budget file.
    ratio_spec = curve_spec = None
    if args.ratio or args.curve:
        from tools import notebook_perf_budgets as pb
        try:
            src = thresholds if thresholds is not None else pb.load_budgets(pb.DEFAULT_BUDGETS)
            if args.ratio:
                ratio_spec = src[args.ratio]
                pb.ratio_line(ratio_spec)
                int(ratio_spec["rounds"]), int(ratio_spec["reps"]), int(ratio_spec["tier"])
                if not ratio_spec["ops"]:
                    raise ValueError(f"ratio budget {args.ratio!r} names no ops")
                if int(ratio_spec["tier"]) not in tiers:
                    raise ValueError(f"ratio budget {args.ratio!r} is at {int(ratio_spec['tier']):,} "
                                     f"notes, which --tiers does not run")
            if args.curve:
                curve_spec = src["curve"]
                float(curve_spec["max_slope"]), float(curve_spec["max_last_segment_slope"])
        except (pb.Unevaluable, OSError, ValueError, KeyError, TypeError) as e:
            print(f"cannot read the ratio/curve budget: {e!r}")
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
            "remeasure_budgets": remeasure_keys,
            "timed_ops": TIMED_OPS + (ATTACHMENT_OPS if args.attachments else []),
            "attachments": args.attachments, "curve": bool(args.curve), "ratio_budget": args.ratio,
            "members": args.members,
            "slow_ops": slow_ops,
        },
        "tiers": [],
    }
    for n in tiers:
        print(f"\n=== Seeding + measuring {n:,} notes"
              + (f" x {args.members} members" if args.members > 1 else "")
              + (f" + {args.attachments:,} attachments" if args.attachments else "")
              + f" ({args.reps} reps after {args.warmup} warmup) ===")
        lines = pb.lines_at_tier(remeasure_src, remeasure_keys, n) if remeasure_keys else None
        r = run_tier(n, reps=args.reps, warmup=args.warmup, paragraphs=args.paragraphs,
                     keep_db=args.keep_db, work_dir=args.work_dir, remeasure_lines=lines,
                     attachments=args.attachments, ratio_spec=ratio_spec, slow_ops=slow_ops,
                     members=args.members)
        report["tiers"].append(r)
        print(f"  seed {r['seed_ms'] / 1000:.1f}s  db {r['db_bytes'] / 1e6:.1f} MB  "
              f"active {r['active']:,} trashed {r['trashed']:,} archived {r['archived']:,}"
              + (f"  attachments {r['attachments']:,} ({r['attachment_pages']:,} pages, "
                 f"{r['attachment_seed_ms'] / 1000:.1f}s)" if r["attachments"] else ""))
        print(f"  {'op':52s} {'p50':>9s} {'p95':>9s} {'max':>9s}")
        for label, st in r["ops"].items():
            print(f"  {label:52s} {st['p50_ms']:8.2f}ms {st['p95_ms']:8.2f}ms {st['max_ms']:8.2f}ms")
        for label, st in r["ops"].items():
            if "remeasure" in st:
                again = st["remeasure"]
                print(f"  re-measured {label}: p95 {st['p95_ms']:.2f} ms -> {again['p95_ms']:.2f} ms "
                      f"(line {again['line_ms']:g} ms)")
        if r.get("ratio"):
            ro = r["ratio"]
            print(f"  ratio to the calibration op (line {ro['line']:.3f} = {ro['budget_line_ms']:g} ms"
                  f" / {ro['calibration_ref_ms']:g} ms reference; median of {ro['rounds']} rounds):")
            for label, x in ro["ops"].items():
                again = x.get("remeasure")
                print(f"  {label:52s} {x['median']:8.3f} / line {ro['lines'].get(label, ro['line']):.3f}"
                      f"  (calibration p50 {x['calibration_p50_ms']:.2f} ms)"
                      + (f"  re-measured {again['median']:.3f}" if again else ""))
        failed = [k for k, v in r["correctness"].items() if not v]
        print(f"  XX CORRECTNESS FAILURES: {failed}" if failed else "  OK all correctness checks passed")

    curve_breaches: list[str] = []
    if curve_spec is not None:
        from tools import notebook_perf_budgets as pb
        curve_breaches, table = pb.check_curve(report, curve_spec, report["meta"]["timed_ops"])
        report["curve"] = {"spec": curve_spec, "ops": table, "breaches": curve_breaches}
        print(f"\n=== Curve: log-log slope of p50 over {[t['n'] for t in report['tiers']]} "
              f"(bound: fit <= {float(curve_spec['max_slope']):g}, last segment <= "
              f"{float(curve_spec['max_last_segment_slope']):g}) ===")
        for label, row in table.items():
            if row.get("slope") is None:
                print(f"  {label:52s} NOT MEASURED at {row.get('missing')}")
            else:
                print(f"  {label:52s} slope {row['slope']:6.3f}  last segment {row['last_segment']:6.3f}")

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
    breaches: list[str] = []
    passed: list[str] = []
    if thresholds is not None and budget_keys:
        from tools.notebook_perf_budgets import informational_notes, unreproduced_notes
        for key in budget_keys:
            breaches += [f"[{key}] {b}" for b in check_thresholds(report, thresholds, key)]
            # reported against the same line, never a breach (review M-8; I-3's one-offs)
            for note in informational_notes(report, thresholds[key]) + unreproduced_notes(report, thresholds[key]):
                print(f"  note [{key}] {note}")
        passed.append("every budgeted op under its p95 budget: " + "; ".join(
            f"{k} < {thresholds[k]['p95_ms_max']} ms at {int(thresholds[k]['tier']):,} notes"
            for k in budget_keys))
    if ratio_spec is not None:
        from tools import notebook_perf_budgets as pb
        breaches += [f"[{args.ratio}] {b}" for b in pb.check_ratio(report, ratio_spec)]
        for note in pb.ratio_unreproduced_notes(report, ratio_spec):
            print(f"  note [{args.ratio}] {note}")
        passed.append(f"{args.ratio}: every op's median ratio under {pb.ratio_line(ratio_spec):.3f}")
    if curve_spec is not None:
        breaches += [f"[curve] {b}" for b in curve_breaches]
        passed.append(f"curve: every op's slope <= {float(curve_spec['max_slope']):g}")
    if breaches:
        print("VERDICT: BUDGET BREACH")
        for b in breaches:
            print(f"  BREACH {b}")
        return 2
    if passed:
        print("VERDICT: PASS -- " + "; ".join(passed))
        return 0
    print("VERDICT: PASS (no thresholds given)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
