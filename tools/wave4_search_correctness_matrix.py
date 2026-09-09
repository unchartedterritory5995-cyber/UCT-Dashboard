"""Wave 4 (Search Evolution I) — query CORRECTNESS matrix, before speed.

2026-09-06 checkpoint item 7: "Do not optimize a query that returns the
wrong research." A small, hand-built corpus with KNOWN expected results per
query -- unlike the pure-scale benchmark (wave4_fts_benchmark.py), every
assertion here is checked against ground truth, not just timed. Covers the
realistic query categories from checkpoint item 6 (A-D; E "phrase matching"
is deliberately NOT exercised -- see the finding at the bottom; F/G
date-range and entity-filter COMBINATIONS are not executable yet, those
filters don't exist in code until Wave 4 Slices 1/3 ship).

    DATA_DIR=/some/scratch/dir AUTH_DB_PATH=/some/scratch/dir/auth.db \
        python tools/wave4_search_correctness_matrix.py

Both env vars are REQUIRED and validated by notebook_sandbox_guard.py before
any workload runs -- see that module's docstring for why (this script's
list_notes() calls transitively reach auth_db.get_connection(), whose
default path is independent of DATA_DIR and resolves to the real shared
C:\\data\\auth.db on this box).

Real assertions (hand-verifiable cases) raise AssertionError on mismatch.
One case (Porter stemming on "marginalized") is EXPLORATORY -- printed, not
asserted, because guessing stemmer behavior by hand would be dishonest;
see the printed finding and the write-up this feeds into the prep doc.
"""
from __future__ import annotations

import os
import sys

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, REPO_ROOT)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from notebook_sandbox_guard import require_sandboxed_env  # noqa: E402

require_sandboxed_env()  # DATA_DIR + AUTH_DB_PATH -- fails closed, never defaults

import sqlite3  # noqa: E402

from api.services.journal_two.db import ensure_schema  # noqa: E402
from api.services.journal_two.notes import list_notes  # noqa: E402


def _conn():
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    ensure_schema(c)
    return c


def _note(c, note_id, user_id="trader1", title="", body="", tags="[]", ticker=None, deleted=False):
    c.execute(
        "INSERT INTO j2_notes (id, user_id, title, body_json, body_plain, tags,"
        " ticker, created_at, updated_at, deleted_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
        (note_id, user_id, title, '{"type":"doc","content":[]}', body, tags, ticker,
         "2026-09-01T00:00:00Z", "2026-09-01T00:00:00Z",
         "2026-09-02T00:00:00Z" if deleted else None),
    )
    c.commit()


def build_corpus(c):
    # A. sparse ticker search
    _note(c, "n1_nvda_thesis", title="NVDA thesis",
          body="semiconductor capex accelerating AI datacenter demand risk to gross margin debate",
          ticker="NVDA")
    _note(c, "n7_nvda_ticker_only", title="Just a chart screenshot",
          body="no interesting text at all", ticker="NVDA")
    _note(c, "n3_brkb", title="BRK-B position review",
          body="Berkshire class shares intrinsic value discount", ticker="BRK-B")
    # B/C. common financial terms + multi-term research queries
    _note(c, "n9_multiterm", title="Semiconductor capex thesis",
          body=("semiconductor capex accelerating due to AI datacenter demand and "
                "cloud buildout, risk to gross margin remains the debate"))
    _note(c, "n4_margin_word", title="Grocery list",
          body="milk eggs bread margin call reminder")
    _note(c, "n5_stem_trap", title="Marginal notes",
          body="marginalized ideas about the handle of a teacup")
    # Tag-only match (no body/title text overlap) -- isolates the tag OR-branch.
    _note(c, "n6_tag_only", title="Random title", body="nothing special here",
          tags='["thesis","semiconductor"]')
    # D. trash exclusion + tenant isolation controls.
    _note(c, "n11_trashed", title="Trashed NVDA note", body="semiconductor capex",
          ticker="NVDA", deleted=True)
    _note(c, "n12_other_user", user_id="trader2", title="Other user's NVDA note",
          body="semiconductor capex", ticker="NVDA")


CASES = [
    ("A. sparse ticker",       "NVDA",                {"n1_nvda_thesis", "n7_nvda_ticker_only"}),
    # REAL FINDING (2026-09-06, confirmed by running this matrix, not assumed):
    # $NVDA does NOT reach n7 (ticker-field-only note) today. notes.py's
    # exact-ticker OR-branch does `exact_ticker = q.strip().upper()` --
    # $ is stripped by fts_match_expr() for the FTS branch but NOT for the
    # ticker-exact comparison, so `ticker = '$NVDA'` never matches a stored
    # ticker value of 'NVDA'. n1 still matches because its TITLE literally
    # contains the word "NVDA" (found via FTS, not the ticker branch). This
    # is a genuine, narrow, PRE-EXISTING gap -- independent of anything
    # Wave 4 adds -- affecting only notes whose sole NVDA signal is the
    # ticker field with no text mention. See the prep doc's spec-corrections
    # section; candidate fix is a one-line strip of separator chars before
    # the ticker comparison, in scope for Wave 4's combined-filter work
    # (checkpoint item 13), not fixed here (prep only, no production change).
    ("A. cashtag == ticker",   "$NVDA",                {"n1_nvda_thesis"}),
    ("A. hyphenated ticker",   "BRK-B",                {"n3_brkb"}),
    ("B. common term",         "margin",               None),  # see stemming finding below
    ("C. multi-term AND",      "semiconductor capex",  {"n1_nvda_thesis", "n9_multiterm"}),
    ("tag-only match",         "semiconductor",        {"n1_nvda_thesis", "n6_tag_only", "n9_multiterm"}),
    ("D. no results",          "quantumfluxcapacitor", set()),
]


def run():
    c = _conn()
    build_corpus(c)

    print("=== Correctness matrix (trader1's view) ===")
    failures = []
    for label, q, expected in CASES:
        actual = {r["id"] for r in list_notes("trader1", q=q, conn=c)}
        if expected is None:
            print(f"[{label}] {q!r} -> {sorted(actual)} (exploratory, see stemming note)")
            continue
        ok = actual == expected
        print(f"[{'OK' if ok else 'MISMATCH'}] {label} {q!r} -> expected={sorted(expected)} actual={sorted(actual)}")
        if not ok:
            failures.append((label, q, expected, actual))

    # Exploratory: does the porter stemmer fold "marginalized"/"marginal" onto
    # "margin"? This determines whether "margin" is a false-positive risk
    # against non-financial prose, or a legitimate stemmed match.
    margin_actual = {r["id"] for r in list_notes("trader1", q="margin", conn=c)}
    stem_trap_included = "n5_stem_trap" in margin_actual
    print(f"\n[FINDING] porter stemmer folds 'marginalized'/'marginal' onto 'margin' MATCH: {stem_trap_included}")
    print(f"          margin query -> {sorted(margin_actual)}")

    print("\n=== Tenant isolation + trash exclusion ===")
    trader2_nvda = {r["id"] for r in list_notes("trader2", q="NVDA", conn=c)}
    print(f"trader2 searching NVDA -> {sorted(trader2_nvda)} (must be trader2's own note only, never trader1's or the trashed one)")
    if trader2_nvda != {"n12_other_user"}:
        failures.append(("tenant isolation", "NVDA (as trader2)", {"n12_other_user"}, trader2_nvda))

    trader1_nvda = {r["id"] for r in list_notes("trader1", q="NVDA", conn=c)}
    if "n11_trashed" in trader1_nvda:
        failures.append(("trash exclusion", "NVDA (as trader1)", "n11_trashed NOT in results", trader1_nvda))
    else:
        print(f"trader1 searching NVDA excludes the trashed note: OK -> {sorted(trader1_nvda)}")

    print("\n=== Ordering ===")
    rows = list_notes("trader1", q="semiconductor", conn=c)
    order = [(r["id"], r["updatedAt"]) for r in rows]
    print(f"order for 'semiconductor': {order}")
    print("NOTE: current ordering is updated_at DESC, unconditionally -- there is")
    print("NO relevance/rank ordering today (see ranking verdict in the prep doc).")

    if failures:
        print(f"\n{len(failures)} FAILURE(S):")
        for label, q, expected, actual in failures:
            print(f"  - {label} {q!r}: expected {expected}, got {actual}")
        raise SystemExit(1)
    print("\nAll hand-verified cases correct.")


if __name__ == "__main__":
    run()
