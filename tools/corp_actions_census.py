"""D5 CHECKPOINT 1 — the corporate-actions census. INSTRUMENT ONLY.

⛔ APPROVED SCOPE (owner, 2026-09-12), verbatim: *"CP1 — the corporate-actions
census. One DERIVED inventory of every corporate-action provider READ and every
adjustment APPLICATION in the repo, three-state (outstanding / migrated /
deliberately outside with a written reason), plus a rail that fails BY NAME on a
new unregistered one. INSTRUMENT ONLY. No ledger, no producer, no reader
migrated, no product module edited, no store touched, no member-visible change.
tools/** + tests/** only."*

⛔⛔ THIS WRITES NOTHING AND CHANGES NOTHING. It reads `api/**` and prints. The
reason D5 needs an instrument before it needs a table is in the gate packet's
§5.1, and it is not an abstraction: **two corporate-action modules in this repo
are built, tested, green and reachable by nothing, and a script found both in an
afternoon while nobody had noticed either.**

──────────────────────────────────────────────────────────────────────────────
WHAT IT COUNTS — three classes, because they are three different mistakes
──────────────────────────────────────────────────────────────────────────────

  PROVIDER_READ         a corporate-action feed is fetched here (splits,
                        dividends). Five providers currently answer one
                        question, and none of them knows about the others.

  ADJUSTMENT_APPLIED    a price is RESCALED here. The entry points are derived
                        by name from `api/**`'s own `def`s, then every call site
                        of those names is found — never a typed list, so a
                        fifth adjuster appears the day it lands.

  VENDOR_ADJUSTED       the code asks a VENDOR to pre-adjust and takes the
                        answer. ⭐ THIS IS THE CLASS THAT IS EASY TO MISS AND
                        MOST WORTH SEEING: it is an adjustment decision made in
                        somebody else's process, on a basis we do not record,
                        and it is indistinguishable downstream from an
                        unadjusted price. `ohlcv` has no adjustment column, so
                        nothing in the store can tell the two apart.

⛔ THREE STATES, AND "OUTSIDE" NEEDS A WRITTEN REASON. A two-state census
(migrated / not) forces every deliberate exclusion to look like debt, and a
register in which everything is debt gets ignored. `breadth_dividends` is the
worked example: its `auto_adjust=True` basis is produced by a collector in a
DIFFERENT REPOSITORY, so reconciling it is a two-repo change D5 does not get to
make. That is `outside`, with the reason attached — not `outstanding`.

Usage:
    python tools/corp_actions_census.py            # print; exit 1 if unregistered
    python tools/corp_actions_census.py --json     # machine-readable
"""
from __future__ import annotations

import argparse
import ast
import json
import os
import re
from dataclasses import asdict, dataclass
from typing import Iterable

DEFAULT_ROOTS = ("api",)
_SKIP_DIR_PARTS = frozenset({"__pycache__", "node_modules", ".git", "external"})

PROVIDER_READ = "PROVIDER_READ"
ADJUSTMENT_APPLIED = "ADJUSTMENT_APPLIED"
VENDOR_ADJUSTED = "VENDOR_ADJUSTED"
CLASSES = (PROVIDER_READ, ADJUSTMENT_APPLIED, VENDOR_ADJUSTED)

OUTSTANDING = "outstanding"
MIGRATED = "migrated"
OUTSIDE = "outside"
STATES = (OUTSTANDING, MIGRATED, OUTSIDE)

#: A corporate-action FEED, in a URL. ⛔ Anchored on the endpoint path rather
#: than on a vendor name: the same vendor serves bars and splits, and a census
#: that matched "massive" would count every price call in the repo.
_PROVIDER_URL_RX = re.compile(
    r"reference/(splits|dividends)"
    r"|/stable/(splits|dividends)"
    r"|historical-price-full/stock_(split|dividend)",
    re.I,
)

#: A request for a VENDOR-adjusted price, IN A URL. Each of these is a
#: different vendor's spelling of the same instruction.
_VENDOR_ADJUSTED_RX = re.compile(r"adjusted=true|auto_adjust|adjClose|adjusted_close", re.I)

#: …and the same instruction as a PYTHON KEYWORD ARGUMENT.
#:
#: ⚰️ THE FIRST VERSION OF THIS CENSUS MATCHED ONLY THE URL FORM, AND THAT
#: BLIND SPOT IS THE REASON THIS LINE EXISTS. It missed `adjusted=(kind ==
#: "stock")`, `adjusted=adjusted` and `adjusted=False` — three real
#: adjustment-basis decisions, one of them (`historical_equity.py`) carrying a
#: five-line comment explaining exactly why the basis matters. ⭐ A census with
#: a blind spot reads as coverage, which is worse than no census: the register
#: would have said "every corporate-action site is classified" while three
#: were invisible to it.
_VENDOR_ADJUSTED_KWARGS = frozenset({"adjusted", "auto_adjust"})

#: How an adjustment ENTRY POINT is recognised among `api/**`'s own function
#: definitions. ⛔ DERIVED, NEVER LISTED: a fifth adjuster appears in the census
#: the day somebody defines it, which is the whole difference between an
#: inventory and a comment.
_ADJUST_DEF_RX = re.compile(r"(split|dividend|corp).*adjust|adjust.*(split|dividend|corp)", re.I)


# ─────────────────────────────────────────────────────────────────────────────
# THE REGISTER — every row the census can find today, with its state
#
# ⛔ A ROW HERE IS A DECISION SOMEBODY MADE, NOT A SUPPRESSION. `outside`
# carries a reason and the rail asserts the reason is real text; `outstanding`
# is honest debt and is MEANT to be a long list at CP1 — D5 has migrated
# nothing yet, and a census that opened with everything already "migrated"
# would be describing a programme that had not started.
# ─────────────────────────────────────────────────────────────────────────────
REGISTER: dict[tuple, tuple] = {
    # ── PROVIDER_READ ────────────────────────────────────────────────────────
    ("api/services/bars_sanitize.py", PROVIDER_READ): (
        OUTSTANDING,
        "FMP /stable/splits, read to decide whether a stored series is "
        "unadjusted. CP4's dual-compute target; it is also an INERT STRAND "
        "(flow-worker RUNS this file and does not WATCH it), so CP4 must "
        "classify live-or-incidental before it merges."),
    ("api/services/massive.py", PROVIDER_READ): (
        OUTSTANDING,
        "Massive /v3/reference/splits behind get_split_tickers, which the D5 "
        "pass measured at ZERO call sites against a 106-importer control — "
        "built, green and reachable by nothing. Retiring it is CP3's, not CP1's."),
    ("api/services/polygon_extras.py", PROVIDER_READ): (
        OUTSTANDING,
        "Massive /v3/reference/splits AND /v3/reference/dividends — the only "
        "file reading both. CP3 moves the splits half behind a D1 adapter."),
    ("api/services/breadth_dividends.py", PROVIDER_READ): (
        OUTSIDE,
        "Massive /v3/reference/dividends, consumed to build the breadth "
        "frame's own auto_adjust basis. The collector that produces that basis "
        "lives in a DIFFERENT REPOSITORY, so reconciling it is a two-repo "
        "change; product-architecture.md already calls it its own project. D5 "
        "makes the divergence nameable and does not get to resolve it."),

    # ── ADJUSTMENT_APPLIED ───────────────────────────────────────────────────
    ("api/services/bars_sanitize.py", ADJUSTMENT_APPLIED): (
        OUTSTANDING,
        "_apply_split_adjust + unadjusted_splits — the SERVE-path rescale. "
        "Nothing records that it happened: `ohlcv` has no adjustment column."),
    ("api/services/bars_split_repair.py", ADJUSTMENT_APPLIED): (
        OUTSTANDING,
        "the STORE-path rewrite, calling the same unadjusted_splits judgement "
        "from a second process. Two copies of one decision; CP4's reason for "
        "existing."),

    # ── VENDOR_ADJUSTED ──────────────────────────────────────────────────────
    # ⛔ These are NOT debt in the same sense: asking a vendor for an adjusted
    # series is often exactly right. What is missing is the LABEL, and that is
    # CP7 — the first member-visible checkpoint and the one that needs its own
    # line. Recorded `outstanding` because the label is genuinely owed, not
    # because the call is wrong.
    ("api/services/bars_fetch.py", VENDOR_ADJUSTED): (
        OUTSTANDING, "the main bars path asks the vendor to pre-adjust; the "
                     "served payload does not say so. CP7's label."),
    ("api/services/massive.py", VENDOR_ADJUSTED): (
        OUTSTANDING, "the adapter passes the flag through. CP7's label."),
    ("api/gex_service.py", VENDOR_ADJUSTED): (
        OUTSIDE, "options GEX surface; an equity split basis is not a claim it "
                 "makes, and it renders no adjusted equity price to a member."),
    ("api/gex_router.py", VENDOR_ADJUSTED): (
        OUTSIDE, "same surface as gex_service; router-level pass-through."),
    ("api/index_bars.py", VENDOR_ADJUSTED): (
        OUTSIDE, "index series; indices do not split, so the flag is inert here."),
    ("api/oi_morning.py", VENDOR_ADJUSTED): (
        OUTSIDE, "open-interest snapshot; carries no equity price series."),
    ("api/routers/live_prices.py", VENDOR_ADJUSTED): (
        OUTSTANDING, "the live quote path. CP7's label."),
    ("api/services/audit.py", VENDOR_ADJUSTED): (
        OUTSIDE, "the reconciliation auditor's own canonical fetch — it must "
                 "ask for the SAME basis it is auditing against, so this one is "
                 "correct by construction and must not be migrated."),
    ("api/services/earnings_enrichment.py", VENDOR_ADJUSTED): (
        OUTSTANDING, "earnings reaction percentages are computed off an "
                     "adjusted series with no basis recorded. CP7's label."),
    ("api/services/breadth_pit_calibrate.py", VENDOR_ADJUSTED): (
        OUTSIDE, "point-in-time calibration for the breadth frame — the same "
                 "different-repository basis as breadth_dividends above."),
    ("api/services/journal_two/broker/historical_equity.py", VENDOR_ADJUSTED): (
        OUTSIDE, "broker-sync mirrors the BROKER's own figures; imposing our "
                 "adjustment basis on them would break mirror fidelity, which "
                 "is a locked invariant."),
    ("api/services/journal_two/broker/option_marks.py", VENDOR_ADJUSTED): (
        OUTSIDE, "same mirror-fidelity invariant as historical_equity."),
    ("api/services/journal_two/broker/reconstruct.py", VENDOR_ADJUSTED): (
        OUTSIDE, "same mirror-fidelity invariant as historical_equity."),
    ("api/services/scan_gainers.py", VENDOR_ADJUSTED): (
        OUTSTANDING, "a scan ranking off an adjusted series with no basis "
                     "recorded. CP7's label."),

    # ⚰️ THE TWO THE FIRST REGISTER MISSED, AND THEY ARE THE POINT OF HAVING AN
    # INSTRUMENT. This register was hand-written from a measurement ten minutes
    # old and was already two rows short — both invisible to the URL-only
    # detector, both found the moment the keyword-argument detector landed.
    ("api/services/scan_period.py", VENDOR_ADJUSTED): (
        OUTSTANDING,
        "get_grouped_daily_closes(..., adjusted=True) — the whole-market "
        "grouped-daily endpoint, ranked on directly. Its own header says these "
        "closes are split-adjusted; nothing downstream records which basis a "
        "scan's percentage was computed on. CP7's label."),
    ("api/services/watchlist_prebuilt_refresh.py", VENDOR_ADJUSTED): (
        OUTSTANDING,
        "?adjusted=true on the grouped-daily aggregate that refreshes the "
        "prebuilt watchlists. Same basis question, a different surface, and it "
        "also constructs its own Massive URL (already quarantined in "
        "tools/massive_guard_census.py). CP7's label."),
}


def _is_test_file(path: str) -> bool:
    base = os.path.basename(path)
    return base.startswith("test_") or base.endswith("_test.py")


@dataclass(frozen=True)
class Row:
    path: str
    kind: str
    occurrences: int
    state: str
    reason: str

    def __str__(self) -> str:                    # pragma: no cover - formatting
        return "%-56s %-20s x%-3d %-12s %s" % (
            self.path, self.kind, self.occurrences, self.state, self.reason[:70])


def _iter_py_files(root: str, base: str) -> Iterable[str]:
    for dirpath, dirnames, filenames in os.walk(os.path.join(base, root)):
        dirnames[:] = [d for d in dirnames if d not in _SKIP_DIR_PARTS]
        for fn in sorted(filenames):
            if fn.endswith(".py"):
                yield os.path.join(dirpath, fn)


def _rel(path: str, base: str) -> str:
    return os.path.relpath(path, base).replace("\\", "/")


def _vendor_adjusted_kwarg_sites(tree: ast.AST) -> int:
    """Calls passing `adjusted=` / `auto_adjust=`, counted from the AST.

    ⛔ A KEYWORD, NEVER A SUBSTRING. `adjusted: bool = Query(False, …)` is a
    parameter DECLARATION, not a decision, and matching text would count it.
    This looks at `ast.keyword` on a `Call` — the place where somebody chooses a
    basis for a fetch.
    """
    n = 0
    for node in ast.walk(tree):
        if isinstance(node, ast.Call):
            for kw in node.keywords:
                if kw.arg in _VENDOR_ADJUSTED_KWARGS:
                    n += 1
    return n


def _code_tree(path: str):
    """The module's AST with docstrings blanked, or None."""
    try:
        with open(path, "r", encoding="utf-8") as fh:
            tree = ast.parse(fh.read(), filename=path)
    except (OSError, SyntaxError):
        return None
    for node in ast.walk(tree):
        if (isinstance(node, ast.Expr) and isinstance(node.value, ast.Constant)
                and isinstance(node.value.value, str)):
            node.value.value = ""
    return tree


def _code_only(path: str) -> str | None:
    """The module with docstrings blanked, re-emitted.

    ⛔⛔ CODE, NEVER PROSE, and here it is load-bearing rather than ritual: the
    files this census inspects DISCUSS splits and adjustment at length —
    `bars_sanitize.py`'s own header explains the whole split-adjustment
    doctrine. A raw scan would book every explanation as a call site, and the
    register would be an inventory of comments.
    """
    try:
        with open(path, "r", encoding="utf-8") as fh:
            tree = ast.parse(fh.read(), filename=path)
    except (OSError, SyntaxError):
        return None
    for node in ast.walk(tree):
        if (isinstance(node, ast.Expr) and isinstance(node.value, ast.Constant)
                and isinstance(node.value.value, str)):
            node.value.value = ""
    try:
        return ast.unparse(tree)
    except Exception:                            # pragma: no cover - defensive
        return None


def adjustment_entry_points(base: str, roots: Iterable[str] = DEFAULT_ROOTS) -> dict:
    """{function name: [file:line]} for every adjustment entry point DEFINED in
    the tree. Derived from the `def`s, never typed."""
    out: dict = {}
    for root in roots:
        for path in _iter_py_files(root, base):
            rel = _rel(path, base)
            if _is_test_file(path):
                continue
            try:
                with open(path, "r", encoding="utf-8") as fh:
                    tree = ast.parse(fh.read(), filename=path)
            except (OSError, SyntaxError):
                continue
            for node in ast.walk(tree):
                if (isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
                        and _ADJUST_DEF_RX.search(node.name)):
                    out.setdefault(node.name, []).append("%s:%d" % (rel, node.lineno))
    return out


def census(base: str, roots: Iterable[str] = DEFAULT_ROOTS,
           include_tests: bool = False) -> list:
    """Every (file, class) row the repo contains today, with its register state.

    A row with no register entry gets state `"UNREGISTERED"` and an empty
    reason — that is the failure the rail exists to catch, and it is reported as
    a row rather than raised, so one new adjuster does not hide the rest.
    """
    entry_names = set(adjustment_entry_points(base, roots))
    rows: list = []
    for root in roots:
        for path in _iter_py_files(root, base):
            rel = _rel(path, base)
            if not include_tests and _is_test_file(path):
                continue
            code = _code_only(path)
            if code is None:
                continue

            tree = _code_tree(path)
            counts = {
                PROVIDER_READ: len(_PROVIDER_URL_RX.findall(code)),
                VENDOR_ADJUSTED: (len(_VENDOR_ADJUSTED_RX.findall(code))
                                  + (_vendor_adjusted_kwarg_sites(tree) if tree else 0)),
                ADJUSTMENT_APPLIED: 0,
            }
            if entry_names:
                calls = re.compile(
                    r"\b(?:%s)\s*\(" % "|".join(re.escape(n) for n in sorted(entry_names)))
                counts[ADJUSTMENT_APPLIED] = len(calls.findall(code))

            for kind in CLASSES:
                n = counts[kind]
                if not n:
                    continue
                state, reason = REGISTER.get((rel, kind), ("UNREGISTERED", ""))
                rows.append(Row(rel, kind, n, state, reason))
    rows.sort(key=lambda r: (r.kind, r.path))
    return rows


def repo_root() -> str:
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def main(argv=None) -> int:                      # pragma: no cover - operator entry
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args(argv)

    base = repo_root()
    rows = census(base)
    entry_points = adjustment_entry_points(base)
    unregistered = [r for r in rows if r.state == "UNREGISTERED"]

    if args.json:
        print(json.dumps({
            "rows": [asdict(r) for r in rows],
            "adjustment_entry_points": entry_points,
            "unregistered": [asdict(r) for r in unregistered],
        }, indent=2))
        return 1 if unregistered else 0

    print("CORPORATE-ACTIONS CENSUS — %d rows across %d files"
          % (len(rows), len({r.path for r in rows})))
    print()
    print("adjustment entry points, DERIVED from api/**'s own defs:")
    for name, where in sorted(entry_points.items()):
        print("    %-28s %s" % (name, ", ".join(where)))
    print()
    for kind in CLASSES:
        sub = [r for r in rows if r.kind == kind]
        by_state = {s: sum(1 for r in sub if r.state == s) for s in STATES}
        print("== %s — %d rows (%s) ==" % (
            kind, len(sub), ", ".join("%s %d" % (s, by_state[s]) for s in STATES)))
        for r in sub:
            print("    " + str(r))
        print()

    if unregistered:
        print("⛔ UNREGISTERED (%d) — a corporate-action site nobody has classified:"
              % len(unregistered))
        for r in unregistered:
            print("    %s [%s] x%d" % (r.path, r.kind, r.occurrences))
        return 1
    print("OK — every corporate-action site is registered with a state.")
    return 0


if __name__ == "__main__":                       # pragma: no cover
    raise SystemExit(main())
