"""D2 CHECKPOINT 1 — derive the canonical address book. INERT DATA ONLY.

⛔ APPROVED SCOPE (owner, 2026-09-12), verbatim: *"CP1 — inert canonical address
data (the ratified form written down as data, not read by any product path) +
the derivation rail that fails when a scalar name, store, cadence, or grain
diverges from closedTable.json. … No reader migrated, no schema change on live
stores. CP2+ need new lines."*

⛔⛔ NOTHING IN `api/**` READS WHAT THIS WRITES, AND THAT IS ENFORCED.
`tests/test_canonical_address_book.py::test_no_product_path_reads_the_address_book`
walks every module under `api/` with prose stripped and fails if one does. CP1 is
the form written down; CP2 is the first reader, and it needs a new line.

⭐ THIS RATIFIES A FORM THE CODEBASE ALREADY HAD. Every field below is COPIED
from a declaration that already exists and is already load-bearing:

  metric     <- app/src/components/chart/engine/ast/closedTable.json
                (via api.services.ast_lint.TABLE — one file, two readers)
  entity     <- api/services/alert_taxonomy/predicates.resolve_entity_scope
  timeframe  <- api/services/signature/ledger._BARS_STORE_TF_KEYS
  provider   <- api/services/provider_errors.ProvenanceRecord

⛔ NOT ONE VALUE IS TYPED HERE. If a number or a name appears in the output, it
was read from one of those four. That is the whole difference between an address
book and a second authority.

Usage:
    python tools/build_canonical_address_book.py            # write the file
    python tools/build_canonical_address_book.py --check    # exit 1 if stale
"""
from __future__ import annotations

import argparse
import ast
import dataclasses
import json
import pathlib
import re
import sys

_ROOT = pathlib.Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

OUT_PATH = _ROOT / "api" / "data" / "canonical_address_book.json"

SCHEMA_VERSION = 1

#: PRD-D2 §7's classification, for the stores the metric axis actually names
#: today. ⛔ DECLARED PER STORE AND NOT PER METRIC ONLY BECAUSE ONE STORE APPEARS:
#: the SPEC's `authority` field is per-metric precisely so a store that is derived
#: AND known-wrong for a named class of input (`ticker_meta` and reused tickers)
#: can say so. When a second store joins, that nuance moves here, not away.
_STORE_AUTHORITY = {
    "screener_rows": "authoritative",
    # CP2. PRD-D2 §7: *"AUTHORITATIVE for bars, with a locked invariant:
    # newest bar wins per (ticker, tf, ts) on EVERY path"* — and
    # `bars_reconciliation` diffs it against Polygon canonical and
    # surgically deletes divergent rows, which is what makes the verdict a
    # measurement rather than a hope.
    "bars_sqlite": "authoritative",
}


def _fail(msg: str) -> None:
    raise SystemExit("[address-book] %s" % msg)


# ─────────────────────────────────────────────────────────────────────────────
# D2 CHECKPOINT 2 — the first NON-SCREENER store: `bars_sqlite`
#
# ⛔ APPROVED SCOPE (owner, 2026-09-12, line 2, NARROWED), verbatim: *"CP2 —
# extend the canonical book to the first non-screener store. … Migrate exactly
# ONE reader to resolve through the book, DARK … Derivation rail extended to the
# new store. No schema change on any live store."*
#
# ⛔⛔ THE PACKET'S OWN CRITERION PICKED THE OTHER STORE, AND THE MEASUREMENT IS
# WHY IT WAS OVERRIDDEN. `fundamentals` carries ten metric spellings to bars'
# five and seven as-of spellings to bars' two — it IS the most divergent store
# in the inventory. It has ten names *because it has no declaration*:
# `fund_snapshots` is `(kind, ticker, payload, ttl, updated_at)`, a JSON blob
# with zero per-metric columns, so addressing it means TYPING ten names here.
# That is the one thing this file may not do. GATE-D2 §CP2.1 · F-D2-1.
#
# ⭐ `bars_sqlite` needs nothing typed because it declares itself in one literal:
#
#     CREATE TABLE IF NOT EXISTS ohlcv (
#         ticker TEXT NOT NULL, tf TEXT NOT NULL, ts INTEGER NOT NULL,
#         o REAL, h REAL, l REAL, c REAL, v INTEGER,
#         PRIMARY KEY (ticker, tf, ts))
#
# Table, columns, SQL types and the key tuple all come out of it by AST. The
# METRICS are the columns minus the key. The STORE ID is the declaring module's
# own stem. The AS-OF column is the key column the store's own delta query
# filters on, cross-checked against the key tuple.
# ─────────────────────────────────────────────────────────────────────────────

#: The store module that OWNS the DDL. Its stem is the store id — so the id
#: cannot drift from the module, and a rename shows up here as a build failure
#: rather than as a book that quietly addresses a store nobody has.
_BARS_STORE_MODULE = _ROOT / "api" / "services" / "bars_sqlite.py"

#: SQL type -> the manifest's OWN yields vocabulary (`closedTable.json` uses
#: `bool` and `num`). ⛔ A GRAMMAR, NOT A VALUE: it maps two declared alphabets
#: onto each other and invents no name. An unlisted type REFUSES rather than
#: guessing `num`, because a silently-numified TEXT column would be an address
#: that promises arithmetic on a string.
_SQL_TYPE_TO_YIELDS = {
    "REAL": "num",
    "INTEGER": "num",
    "NUMERIC": "num",
    "BOOLEAN": "bool",
}

#: Fields `closedTable.json` declares for every screener scalar and the bars
#: store declares for none of its columns. ⛔ THEY ARE WRITTEN `None`, NEVER
#: DEFAULTED. Defaulting `cadence` to the book's only existing value would make
#: a continuously-fetched store look like a nightly batch one, in the very field
#: `scan_evaluator.cadence_ceiling` reasons about. "We could not compute it" and
#: "nightly" are different facts — the CoverageLine discipline, one layer down.
#: GATE-D2 §CP2.4 · F-D2-2 (the grain varies by timeframe and is declared
#: nowhere; it is re-derived inline seven times in bars_fetch.py).
_UNDECLARED_BY_THE_BARS_STORE = ("cadence", "grain", "sentence")


#: Regex atoms, spelled once. This file has already been bitten by a
#: shell heredoc turning a backslash-b into a literal 0x08 backspace;
#: naming them makes that damage a NameError instead of a silent
#: pattern that matches nothing.
_RXS = chr(92) + "s"      # whitespace
_RXW = chr(92) + "w"      # word char
_RXB = chr(92) + "b"      # word boundary


class _DropDocstrings(ast.NodeTransformer):
    """⛔⛔ CODE, NEVER PROSE — and this file nearly shipped without it.

    The first run of this derivation found *three* `CREATE TABLE` literals in
    `bars_sqlite.py` and refused. Two are real DDL; the third is a DOCSTRING
    that says a recovery helper *"would run `CREATE TABLE` against damage."*
    A parser that counted it would have been reporting a property of the
    module's explanation as a property of its schema — the six-instances-in-one-
    session defect this repo keeps paying for.
    """

    def visit_Expr(self, node):
        if isinstance(node.value, ast.Constant) and isinstance(node.value.value, str):
            return None
        return self.generic_visit(node)


def _module_source(path: pathlib.Path) -> ast.Module:
    if not path.exists():
        _fail("the store module is missing: %s" % path)
    tree = _DropDocstrings().visit(ast.parse(path.read_text(encoding="utf-8")))
    ast.fix_missing_locations(tree)
    return tree


def _string_constants(node: ast.AST) -> list:
    return [n.value for n in ast.walk(node)
            if isinstance(n, ast.Constant) and isinstance(n.value, str)]


def _parse_create_table(sql: str) -> tuple:
    """(table, [(column, sqltype)], [key columns]) out of one CREATE TABLE.

    ⛔ Deliberately narrow. It parses the shape this repo writes and REFUSES
    anything else; a permissive parser that shrugged at an unfamiliar clause
    would silently drop a column and the book would address a store it had
    only partly read.
    """
    m = re.search(r"CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)\s*\((.*)\)\s*$",
                  sql.strip(), re.S | re.I)
    if not m:
        _fail("could not parse a CREATE TABLE out of: %r" % sql[:80])
    table, body = m.group(1), m.group(2)

    key: list = []
    columns: list = []
    for part in re.split(r",(?![^(]*\))", body):
        part = part.strip()
        if not part:
            continue
        pk = re.match(r"PRIMARY\s+KEY\s*\((.*)\)\s*$", part, re.S | re.I)
        if pk:
            key = [c.strip() for c in pk.group(1).split(",") if c.strip()]
            continue
        bits = part.split()
        if len(bits) < 2:
            _fail("column definition %r in %s declares no type" % (part, table))
        columns.append((bits[0], bits[1].upper()))
        # SQLite lets a single-column key be declared inline. Both forms are
        # ordinary SQL and a parser that knew only the table-level one would
        # report "this table has no key" about a table that plainly has one.
        if re.search(r"\bPRIMARY\s+KEY\b", part, re.I):
            key.append(bits[0])

    if not columns:
        _fail("parsed zero columns out of %s — an empty scan is a failed "
              "invocation, not an empty table" % table)
    if not key:
        _fail("%s declares no PRIMARY KEY, so the book cannot say what one row "
              "is one of" % table)
    unknown = [c for c in key if c not in {n for n, _ in columns}]
    if unknown:
        _fail("%s's PRIMARY KEY names columns it does not declare: %s" % (table, unknown))
    return table, columns, key


def _projections_by_table(tree: ast.Module) -> dict:
    """{table: {projection tuple: [function names]}} for every `SELECT … FROM t`
    inside a function body of the store module."""
    out: dict = {}
    pat = re.compile(r"SELECT\s+([\w,\s]+?)\s+FROM\s+(\w+)\b", re.I)
    for fn in [n for n in ast.walk(tree) if isinstance(n, ast.FunctionDef)]:
        for sql in _string_constants(fn):
            for cols, table in pat.findall(sql):
                cols_t = tuple(c.strip() for c in cols.split(",") if c.strip())
                out.setdefault(table, {}).setdefault(cols_t, []).append(fn.name)
    return out


def _row_projection(tree: ast.Module, table: str, delta_fn: str) -> tuple:
    """The BAR-ROW tuple shape, and every function that hands it back.

    ⛔⛔ THE PROJECTION IS NOT THE SCHEMA, AND THAT IS WHY CP2'S READER EXISTS.
    The DDL order is `ticker, tf, ts, o, h, l, c, v` — `c` is column 6.
    `SELECT ts,o,h,l,c,v` makes it position **4**, and `ticker_returns.py` has
    the bare integer `4` typed into it three times. A reader reasoning from the
    schema would be two columns wrong.

    ⚰️ THIS FUNCTION FIRST DEMANDED UNANIMITY AND WAS WRONG TO. The retired
    sentence, verbatim: *"Unanimity is REQUIRED, not preferred: three functions
    return this tuple and a book that averaged over a disagreement would be an
    address to nowhere."* Measured, `bars_sqlite` has **eleven** distinct
    projections over `ohlcv` — `DISTINCT ticker`, `c` alone, `v` alone, a
    key-prefixed variant used by one auditor, and so on. Every one of them is
    correct code answering a different question, so unanimity was never the
    property to look for.

    ⭐ The one that IS the bar row is derived, not chosen: it is the projection
    of the function that carries the store's own delta query — the same query
    that defines the as-of column. Tying the row shape and the as-of to one
    declaration is what stops the book from having two opinions about a row.
    """
    by_table = _projections_by_table(tree).get(table) or {}
    if not by_table:
        _fail("found no `SELECT … FROM %s` in the store module — an empty scan "
              "is a failed invocation" % table)
    owning = [cols for cols, fns in by_table.items() if delta_fn in fns]
    if len(owning) != 1:
        _fail("the delta function %r does not carry exactly one projection over "
              "%s: %s" % (delta_fn, table, [list(c) for c in owning]))
    projection = owning[0]
    fns = sorted(set(by_table[projection]))
    return list(projection), fns, len(by_table)


def _delta_filter_columns(tree: ast.Module) -> dict:
    """{table: {column, ...}} for every `SELECT … FROM t … <col> > ?` in the
    store module — the queries that answer *"what is new since?"*.

    ⭐ THIS IS ALSO WHAT MAKES A TABLE ADDRESSABLE AT ALL. A store module
    declares bookkeeping tables beside its data (`_migrations` here), and both
    are declared AND selected from, so neither of those two tests separates
    them. The one that does is the as-of: an address is
    `uct://…?as_of=<instant>`, and a table nothing ever asks "since when" about
    has no instant to name. `_migrations` is read as `WHERE name=?` and is
    excluded by its own shape rather than by a list of table names here.
    """
    out: dict = {}
    pat = re.compile(r"FROM" + _RXS + r"(" + _RXW + r"+)" + r"(?:(?!FROM).)*?"
                     + _RXB + r"(" + _RXW + r"+)" + _RXS + r"*>" + _RXS + r"*" + chr(92) + r"?",
                     re.I | re.S)
    for fn in [n for n in ast.walk(tree) if isinstance(n, ast.FunctionDef)]:
        for sql in _string_constants(fn):
            for table, col in pat.findall(sql):
                out.setdefault(table, {}).setdefault(col, set()).add(fn.name)
    return out


def _delta_filter_column(tree: ast.Module, table: str, key: list) -> tuple:
    """The as-of column of ONE table, read off the store's own delta query.

    Never guessed from a name and never taken as "the last key column".
    Cross-checked against the key so a projection alias or a value column can
    never be mistaken for it.
    """
    found = _delta_filter_columns(tree).get(table) or {}
    if len(found) != 1:
        _fail("expected exactly one `<col> > ?` delta filter over %s, found %s"
              % (table, sorted(found)))
    col = sorted(found)[0]
    fns = sorted(found[col])
    if len(fns) != 1:
        _fail("more than one function carries the delta query over %s: %s — the "
              "book will not guess which one declares the row shape"
              % (table, fns))
    if col not in key:
        _fail("the delta filter column %r is not in %s's PRIMARY KEY %s — the "
              "book will not call a non-key column an as-of" % (col, table, key))
    return col, fns[0]


def bars_store() -> tuple:
    """(store_id, store_record, metrics) for `bars_sqlite`. Nothing typed."""
    store_id = _BARS_STORE_MODULE.stem
    tree = _module_source(_BARS_STORE_MODULE)

    # ⭐ WHICH TABLE IS THE ADDRESSABLE ONE IS DERIVED, NOT NAMED HERE. A store
    # module declares bookkeeping tables too (`_migrations`). The addressable
    # table is the one that BOTH carries a CREATE TABLE and is read back through
    # a row projection by the module's own readers — a table nothing selects
    # from cannot be the subject of an address.
    ddls = {}
    for s in _string_constants(tree):
        if not re.search(r"CREATE\s+TABLE", s, re.I):
            continue
        table_i, columns_i, key_i = _parse_create_table(s)
        ddls[table_i] = (columns_i, key_i)
    if not ddls:
        _fail("no CREATE TABLE literal in %s — an empty scan is a failed "
              "invocation" % _BARS_STORE_MODULE.name)

    projections = _projections_by_table(tree)
    deltas = _delta_filter_columns(tree)
    addressable = sorted(set(ddls) & set(projections) & set(deltas))
    if len(addressable) != 1:
        _fail("expected exactly one table in %s that is declared, read back "
              "through a projection AND asked `since when`; got %s "
              "(declared=%s, projected=%s, delta-filtered=%s)"
              % (_BARS_STORE_MODULE.name, addressable, sorted(ddls),
                 sorted(projections), sorted(deltas)))
    table = addressable[0]
    columns, key = ddls[table]
    as_of, delta_fn = _delta_filter_column(tree, table, key)
    projection, projection_fns, projection_count = _row_projection(tree, table, delta_fn)

    missing = [c for c in projection if c not in {n for n, _ in columns}]
    if missing:
        _fail("the row projection names columns %s that %s does not declare"
              % (missing, table))

    if store_id not in _STORE_AUTHORITY:
        _fail("store %r is not classified in PRD-D2 §7" % store_id)

    metrics: dict = {}
    for name, sqltype in columns:
        if name in key:
            continue                       # a key is an AXIS, never a metric
        if sqltype not in _SQL_TYPE_TO_YIELDS:
            _fail("%s.%s declares SQL type %r, which the yields vocabulary does "
                  "not cover — refusing to guess" % (table, name, sqltype))
        metrics["%s.%s" % (table, name)] = {
            "store": store_id,
            "column": name,
            "as_of_column": as_of,
            "grain": None,
            "cadence": None,
            "yields": _SQL_TYPE_TO_YIELDS[sqltype],
            "authority": _STORE_AUTHORITY[store_id],
            "sentence": None,
        }
    if not metrics:
        _fail("%s yielded no addressable columns — every column is a key?" % table)

    record = {
        "declared_in": str(_BARS_STORE_MODULE.relative_to(_ROOT)).replace("\\", "/"),
        "table": table,
        "key": key,
        "as_of_column": as_of,
        "row_projection": projection,
        "row_projection_declared_by": delta_fn,
        "row_projection_shared_with": [f for f in projection_fns if f != delta_fn],
        "distinct_projections_over_this_table": projection_count,
        "authority": _STORE_AUTHORITY[store_id],
        "undeclared_by_this_store": list(_UNDECLARED_BY_THE_BARS_STORE),
    }
    return store_id, record, metrics


def build() -> dict:
    from api.services.ast_lint import TABLE
    from api.services.signature import ledger as _sig_ledger

    scalars = TABLE.get("scalars") or {}
    if not scalars:
        # ⛔ AN EMPTY SCAN IS A FAILED INVOCATION. Writing an empty address book
        # would be indistinguishable, on disk, from a codebase with no metrics.
        _fail("closedTable.json declared no scalars — refusing to write an empty book")

    metrics: dict = {}
    for name in sorted(scalars):
        d = scalars[name]
        src = d.get("source") or {}
        as_of = d.get("as_of") or {}
        store = src.get("store")
        if store is None:
            _fail("scalar %r declares no store" % name)
        if store not in _STORE_AUTHORITY:
            # ⛔ A store nobody has classified must not be silently addressed.
            # PRD §7 is where the verdict is made; this refuses rather than
            # guessing "derived", which would be the flattering default.
            _fail("scalar %r names store %r, which PRD-D2 §7 has not classified"
                  % (name, store))
        metrics[name] = {
            "store": store,
            "column": src.get("column"),
            "as_of_column": as_of.get("column"),
            "grain": as_of.get("grain"),
            "cadence": d.get("cadence"),
            "yields": d.get("yields"),
            "authority": _STORE_AUTHORITY[store],
            "sentence": d.get("sentence"),
        }

    screener_count = len(metrics)

    # ── CP2: the first NON-SCREENER store ────────────────────────────────────
    bars_id, bars_record, bars_metrics = bars_store()
    clash = sorted(set(metrics) & set(bars_metrics))
    if clash:
        # ⛔ ONE FLAT NAMESPACE, SO A COLLISION IS AN ADDRESS THAT ANSWERS FOR
        # TWO VALUES. The bars metrics are table-qualified (`ohlcv.c`) precisely
        # so a one-letter column can never shadow a screener scalar — but the
        # check is here rather than trusted, because the qualifier is derived
        # and a future store could derive the same one.
        _fail("two stores claim the same metric name: %s" % clash)
    metrics.update(bars_metrics)
    metrics = dict(sorted(metrics.items()))

    stores = {
        "screener_rows": {
            "declared_in": "app/src/components/chart/engine/ast/closedTable.json",
            "authority": _STORE_AUTHORITY["screener_rows"],
            "metric_count": screener_count,
        },
        bars_id: dict(bars_record, metric_count=len(bars_metrics)),
    }

    def _hist(key):
        out: dict = {}
        for m in metrics.values():
            # ⛔ AN UNDECLARED FIELD IS REPORTED AS UNDECLARED, NEVER FOLDED IN
            # WITH A DECLARED VALUE. `str(None)` would put "None" in the same
            # histogram as "nightly" and read like a third cadence.
            k = "(undeclared)" if m[key] is None else str(m[key])
            out[k] = out.get(k, 0) + 1
        return dict(sorted(out.items()))

    # ── the timeframe axis, and its measured duplicates ──────────────────────
    tf_map = dict(_sig_ledger._BARS_STORE_TF_KEYS)

    # ── the provider axis: the ProvenanceRecord field list, read off the class,
    #    never retyped. A field added there appears here on the next build.
    from api.services import provider_errors as _pe
    provenance_fields = [f.name for f in dataclasses.fields(_pe.ProvenanceRecord)]

    return {
        "schema_version": SCHEMA_VERSION,
        "generated_by": "tools/build_canonical_address_book.py",
        "what_this_is": (
            "D2 CP2 — the canonical address book. Every value is derived from a "
            "declaration that already exists in this repo; none is typed here. "
            "CP1 shipped it inert; CP2 adds the first non-screener store "
            "(bars_sqlite, derived from its own CREATE TABLE) and exactly ONE "
            "product reader, api/services/canonical/address_book.py, which is "
            "named by the rail that used to require zero readers. "
            "See PRD-D2-CANONICAL-DATA-MODEL and SPEC-D2-CANONICAL-DATA-MODEL."
        ),
        "address_grammar": "uct://<metric>@<entity>/<timeframe>?as_of=<instant>[&provider=<vendor>]",
        "axes": {
            "metric": {
                "sources": [
                    "app/src/components/chart/engine/ast/closedTable.json"
                    " (via api.services.ast_lint.TABLE['scalars'])",
                    "api/services/bars_sqlite.py :: the ohlcv CREATE TABLE literal",
                ],
                "count": len(metrics),
                "note": "a bars metric is table-qualified (ohlcv.c) so a "
                        "one-letter column cannot shadow a screener scalar",
            },
            "entity": {
                "source": "api/services/alert_taxonomy/predicates.py",
                "resolver": "resolve_entity_scope(alias, *, vendor, as_of)",
                "canonical_key": "entity id (S3 Entity Master); a ticker is an ALIAS",
            },
            "timeframe": {
                "source": "api/services/signature/ledger.py::_BARS_STORE_TF_KEYS",
                "canonical_key": "the bars-store CODE (e.g. 'D'), not the product label ('1D')",
                "code_to_label": tf_map,
            },
            "provider": {
                "source": "api/services/provider_errors.py::ProvenanceRecord",
                "fields": provenance_fields,
                "note": "optional in an address; its ABSENCE means 'the value we hold'",
            },
        },
        "stores": stores,
        "axis_report": {
            "metric_count": len(metrics),
            "stores": _hist("store"),
            "cadences": _hist("cadence"),
            "grains": _hist("grain"),
            "as_of_columns": _hist("as_of_column"),
            "yields": _hist("yields"),
        },
        "metrics": metrics,
    }


def _dumps(book: dict) -> str:
    return json.dumps(book, indent=2, ensure_ascii=False, sort_keys=False) + "\n"


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--check", action="store_true",
                    help="exit 1 if the checked-in book is not what this derives")
    args = ap.parse_args(argv)

    book = build()
    text = _dumps(book)

    if args.check:
        if not OUT_PATH.exists():
            print("[address-book] MISSING: %s" % OUT_PATH)
            return 1
        current = OUT_PATH.read_text(encoding="utf-8")
        if current != text:
            print("[address-book] STALE — the checked-in book is not what the "
                  "declarations derive. Re-run without --check.")
            return 1
        print("[address-book] OK — %d metrics, derivation matches" % len(book["metrics"]))
        return 0

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(text, encoding="utf-8")
    print("[address-book] wrote %s — %d metrics" % (OUT_PATH, len(book["metrics"])))
    print("[address-book] axes: %s" % json.dumps(book["axis_report"], ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
