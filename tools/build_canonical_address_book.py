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
import dataclasses
import json
import pathlib
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
}


def _fail(msg: str) -> None:
    raise SystemExit("[address-book] %s" % msg)


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

    def _hist(key):
        out: dict = {}
        for m in metrics.values():
            out[str(m[key])] = out.get(str(m[key]), 0) + 1
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
            "D2 CP1 — the canonical address book as INERT DATA. Every value is "
            "derived from a declaration that already exists in this repo; none "
            "is typed here. No product path reads this file, and a rail enforces "
            "that. See PRD-D2-CANONICAL-DATA-MODEL and SPEC-D2-CANONICAL-DATA-MODEL."
        ),
        "address_grammar": "uct://<metric>@<entity>/<timeframe>?as_of=<instant>[&provider=<vendor>]",
        "axes": {
            "metric": {
                "source": "app/src/components/chart/engine/ast/closedTable.json",
                "read_through": "api.services.ast_lint.TABLE['scalars']",
                "count": len(metrics),
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
