"""The server's half of the Pine data families (data unit S4-0, 2026-11-19).

`app/src/components/chart/engine/pineDataCatalog.json` names every non-price series a member's Pine
script may read: the TradingView-compatible built-ins (`request.earnings`, `request.dividends`,
`request.splits`, `request.financial`) and UCT's own series (`uct.*` and `UCT:` symbols). Each family
names ONE `(vendor, data_class)` pair of `provider_licensing_class.py`, and this module decides from the
LIVE table whether the family may be served:

  * served only when the pair's class is A or LA (`SERVABLE_CLASSES`) and the family carries no hold;
  * refused BY NAME otherwise (`family_refusal` -> `(guard, sentence)`), never an empty series.

The chart's half (`pineDataCatalog.js`) cannot import the Python table, so each family's `licence`
block in the JSON is GENERATED here (`python -m api.services.pine_data_catalog --write`) and
`--check` / tests/test_pine_data_catalog.py fail when the block and the table disagree. One authority
(the table), one generated mirror, one rail between them: a row flipped in the table reaches the chart
only through a regenerate, and CI says so by name.

Nothing here serves a value. The supply that reads these decisions is S4-3 onward.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
from pathlib import Path
from typing import Optional

from api.services import provider_licensing_class as _plc

REPO = Path(__file__).resolve().parents[2]
CATALOG_PATH = REPO / "app" / "src" / "components" / "chart" / "engine" / "pineDataCatalog.json"

LICENCE_GUARD = "pine-data:licence"
UNKNOWN_GUARD = "pine-data:unknown-family"
FIELD_GUARD = "pine-data:field-unserved"


def load(path: Path = CATALOG_PATH) -> dict:
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def servable_classes(catalog: Optional[dict] = None) -> frozenset:
    cat = catalog if catalog is not None else load()
    return frozenset(cat["rules"]["servableClasses"])


def families(catalog: Optional[dict] = None) -> dict:
    cat = catalog if catalog is not None else load()
    return cat["families"]


def family_of(pine_name: str, catalog: Optional[dict] = None) -> Optional[str]:
    """The family a Pine name belongs to (`request.earnings`, `earnings.actual`, `uct.rs_rating`), or None.
    A `UCT:` spelling matches its family's longest declared prefix (`UCT:COT:` before `UCT:`)."""
    name = (pine_name or "").strip()
    if not name:
        return None
    best, best_len = None, -1
    for fam, spec in families(catalog).items():
        if name in spec.get("refusedNames", {}):
            return fam
        for declared in spec.get("pine", []):
            if declared.endswith(":"):
                hit = name.upper().startswith(declared.upper())
            else:
                hit = name == declared
            if hit and len(declared) > best_len:
                best, best_len = fam, len(declared)
    return best


def licence_of(family: str, catalog: Optional[dict] = None) -> dict:
    """`{class, registerRow}` of a family's pair, from the LIVE table (never the JSON)."""
    spec = families(catalog)[family]
    entry = _plc.entry_for(spec["vendor"], spec["dataClass"])
    return {"class": entry.licensing_class, "registerRow": entry.register_row}


def _fill(template: str, **values) -> str:
    out = template
    for key, val in values.items():
        out = out.replace("{" + key + "}", str(val))
    return out


def _names(spec: dict) -> str:
    return "`, `".join(spec.get("pine", []))


def _row_text(row: str) -> str:
    """`licensing register row T-07`, or `no licensing register row` for the table's default ("n/a")."""
    return "no licensing register row" if (not row or row == "n/a") else f"licensing register row {row}"


def family_refusal(family: str, catalog: Optional[dict] = None) -> Optional[tuple[str, str]]:
    """None when the family may be served; otherwise `(guard, sentence)` naming it.

    Order: an unknown family, then the licence (the table's class), then a hold (an owner item).
    ⛔ The sentence reaches the member, so it names the Pine spellings, the family's label, the class and
    the register row, and NEVER the vendor (register T-46: a vendor may forbid being named as the source)."""
    cat = catalog if catalog is not None else load()
    sentences = cat["sentences"]
    spec = cat["families"].get(family)
    if spec is None:
        return UNKNOWN_GUARD, _fill(sentences["unknown"], family=family)
    lic = licence_of(family, cat)
    if lic["class"] not in servable_classes(cat):
        return LICENCE_GUARD, _fill(sentences["licence"], names=_names(spec), label=spec["label"],
                                    rowText=_row_text(lic["registerRow"]), **{"class": lic["class"]})
    hold = spec.get("hold")
    if hold:
        return hold["code"], _fill(sentences["hold"], names=_names(spec), reason=hold["reason"])
    return None


def name_refusal(pine_name: str, catalog: Optional[dict] = None) -> Optional[tuple[str, str]]:
    """The decision for ONE Pine spelling: a field the family never serves (`earnings.standardized`) is
    refused by its own sentence; any other name takes its family's decision; a name no family claims is
    an unknown family."""
    cat = catalog if catalog is not None else load()
    fam = family_of(pine_name, cat)
    if fam is None:
        return UNKNOWN_GUARD, _fill(cat["sentences"]["unknown"], family=pine_name)
    reason = cat["families"][fam].get("refusedNames", {}).get(pine_name)
    if reason is not None:
        return FIELD_GUARD, _fill(cat["sentences"]["field"], name=pine_name, reason=reason)
    return family_refusal(fam, cat)


def disclosure(family: str, catalog: Optional[dict] = None) -> str:
    return families(catalog)[family]["disclosure"]


# ── the generated mirror ──────────────────────────────────────────────────────

def with_licence_blocks(catalog: dict) -> dict:
    """The catalogue with every family's `licence` block rewritten from the live table."""
    out = json.loads(json.dumps(catalog))
    for fam in out["families"]:
        spec = out["families"][fam]
        lic = licence_of(fam, out)
        rebuilt = {}
        for key, val in spec.items():
            if key == "licence":
                continue
            rebuilt[key] = val
            if key == "dataClass":
                rebuilt["licence"] = lic
        if "licence" not in rebuilt:
            rebuilt["licence"] = lic
        out["families"][fam] = rebuilt
    return out


def render(catalog: dict) -> str:
    return json.dumps(catalog, indent=2, ensure_ascii=False) + "\n"


def stale_families(catalog: Optional[dict] = None) -> list[str]:
    """Families whose generated `licence` block disagrees with the live table (or is missing)."""
    cat = catalog if catalog is not None else load()
    return [fam for fam, spec in cat["families"].items() if spec.get("licence") != licence_of(fam, cat)]


def _write_atomic(path: Path, text: str) -> None:
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=".pineDataCatalog.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(text)
        os.replace(tmp, path)
    except BaseException:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise


def main(argv: Optional[list[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    group = ap.add_mutually_exclusive_group(required=True)
    group.add_argument("--check", action="store_true", help="exit 1 when a licence block disagrees with the table")
    group.add_argument("--write", action="store_true", help="rewrite every licence block from the table")
    args = ap.parse_args(argv)
    cat = load()
    if args.write:
        text = render(with_licence_blocks(cat))
        if CATALOG_PATH.read_text(encoding="utf-8") != text:
            _write_atomic(CATALOG_PATH, text)
            print(f"pine_data_catalog: rewrote {CATALOG_PATH.name}")
        else:
            print("pine_data_catalog: already current")
        return 0
    stale = stale_families(cat)
    if stale:
        print("pine_data_catalog: licence blocks disagree with provider_licensing_class.py for: "
              + ", ".join(stale) + " (run python -m api.services.pine_data_catalog --write)")
        return 1
    print("pine_data_catalog: every licence block matches the table")
    return 0


if __name__ == "__main__":
    sys.exit(main())
