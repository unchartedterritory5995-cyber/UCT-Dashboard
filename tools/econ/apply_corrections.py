"""Apply adapter-verified registry corrections to registry/series.json.

Each correction file (docs/economic-data/registry-corrections/<adapter>.json) is a
list of {symbol, field_path, old, new, evidence}. A correction applies only if the
CURRENT value equals `old` (or is already `new`) -- anything else is reported and
skipped, never forced. Coordinator rulings are applied from RULINGS below.
Usage: python tools/econ/apply_corrections.py [--dry-run]
"""
from __future__ import annotations
import glob, json, sys, pathlib

ROOT = pathlib.Path(__file__).resolve().parents[2]
REG = ROOT / "api/services/econ/registry/series.json"
_MISSING = object()

# (symbol, field_path) corrections the coordinator declined, with the reason.
DECLINED = {
    ("USMTSDEF", "source.params.sign"): "keep the provider's authoritative sign (deficit positive); describe it, never transform it",
}

# Coordinator rulings 2026-09-29 (Phase 1): (symbol, field_path, new, reason)
RULINGS = [
    ("USICSA", "status", "enabled", "DOL press PDF (oui.doleta.gov, public domain) gives the current advance week; cross-validated; see verification/dol.txt"),
    ("USEMPIRE", "status", "enabled", "GACDISA confirmed from NY Fed data definitions; NY Fed terms permit business use with notice"),
    ("USRETAIL", "status", "unverified", "FAIL CLOSED: econ_export history (737,763 Aug) vs advance release table (773,947) differ ~4.8% on every month; basis (employer-only benchmark, April 2025) unresolved"),
    ("USRETAIL", "source.verified", False, "basis conflict unresolved; needs keyed EITS check against the release"),
]


def get(d, path):
    cur = d
    for p in path.split("."):
        if not isinstance(cur, dict) or p not in cur:
            return _MISSING
        cur = cur[p]
    return cur


def put(d, path, value):
    parts = path.split(".")
    cur = d
    for p in parts[:-1]:
        cur = cur.setdefault(p, {})
    cur[parts[-1]] = value


def main(dry: bool) -> int:
    entries = json.loads(REG.read_text(encoding="utf-8"))
    by = {e["symbol"]: e for e in entries}
    applied, skipped = [], []
    for f in sorted(glob.glob(str(ROOT / "docs/economic-data/registry-corrections/*.json"))):
        for c in json.loads(pathlib.Path(f).read_text(encoding="utf-8")):
            sym, fp = c["symbol"], c["field_path"]
            if (sym, fp) in DECLINED:
                skipped.append((sym, fp, "DECLINED: " + DECLINED[(sym, fp)])); continue
            e = by.get(sym)
            if e is None:
                skipped.append((sym, fp, "unknown symbol")); continue
            cur = get(e, fp)
            old = c.get("old")
            if cur == c.get("new"):
                continue
            if not (cur == old or (cur is _MISSING and old is None)):
                skipped.append((sym, fp, f"current {cur!r} != old {old!r}")); continue
            put(e, fp, c["new"]); applied.append((sym, fp, pathlib.Path(f).stem))
    for sym, fp, new, why in RULINGS:
        put(by[sym], fp, new)
        by[sym].setdefault("notes", [])
        note = f"ruling 2026-09-29: {fp}={new!r} -- {why}"
        if note not in by[sym]["notes"]:
            by[sym]["notes"].append(note)
        applied.append((sym, fp, "ruling"))
    print(f"applied {len(applied)}; skipped {len(skipped)}")
    for s in skipped:
        print("  SKIP", *s)
    if not dry:
        REG.write_text(json.dumps(entries, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main("--dry-run" in sys.argv))
