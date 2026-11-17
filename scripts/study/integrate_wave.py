"""Merge an overbuild wave's results into the course files and report what is left to fix.

    python -m scripts.study.integrate_wave WAVE_DIR UNIT [UNIT ...] --batch wave1 [--write] [--report report.json]

WAVE_DIR holds one folder per chunk (`<unit>-full`, `<unit>-lightA`, ...) with the files the wave workflow wrote:
upgraded.json, final.json (the Resolver's), check_final.json (the final re-check). For each unit the layers are applied
in order, chunk by chunk (upgrade, then the Resolver's changes, then the re-check's fixes), cuts last, and the unit is
validated. Chunks that failed to produce files are named and skipped, never guessed at. Nothing is written without
--write. The report lists per unit: upgraded / cut / new counts and every validator problem, so a repair pass can fix
exactly those.
"""
from __future__ import annotations

import argparse
import json
import pathlib
import sys

from scripts.study import apply_upgrade as au
from scripts.study import courses_lib as cl


def _read(p: pathlib.Path):
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def integrate(wave_dir: pathlib.Path, unit: str, batch: str):
    """Return (doc, report) for one unit; the doc is the merged lesson (not yet written)."""
    track = unit.split(".")[0]
    path = cl.COURSES_DIR / track / f"{unit}.json"
    doc = cl.load_unit(path)
    chunk_dirs = sorted(d for d in wave_dir.glob(f"{unit}-*") if d.is_dir())
    ups: dict = {}
    extra: dict = {"cut": [], "new_questions": [], "new_facts": [], "new_sources": []}
    cks: dict = {}
    skipped: list[str] = []
    for d in chunk_dirs:
        upgraded = _read(d / "upgraded.json")
        if upgraded is None:
            skipped.append(f"{d.name}: no upgraded.json")
            continue
        layers = [upgraded]
        final = _read(d / "final.json")
        if final is not None:
            layers.append(final)
        else:
            skipped.append(f"{d.name}: no final.json (the Resolver did not finish; only the writer's upgrade is applied)")
        for blob in layers:
            for k, v in (blob.get("questions") or {}).items():
                ups[k] = {**ups.get(k, {}), **v}
            for name in extra:
                extra[name].extend(blob.get(name) or [])
        check = _read(d / "check_final.json")
        if check is not None:
            cks.update(check.get("questions") or {})
        elif final is not None:
            skipped.append(f"{d.name}: no check_final.json (not independently re-checked)")
    notes = au.apply(doc, ups, batch, cks, extra)
    problems = cl.unit_problems(doc)
    live = sum(1 for q in doc["questions"] if (doc["verify"].get(q["key"]) or {}).get("status") == "pass")
    report = {"unit": unit, "chunks": [d.name for d in chunk_dirs], "upgraded": len(ups), "new": len(extra["new_questions"]),
              "cut": len(set(extra["cut"])), "rechecked": len(cks), "live_after": live, "notes": notes, "skipped": skipped,
              "problems": problems}
    return doc, report


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("wave_dir")
    ap.add_argument("units", nargs="+")
    ap.add_argument("--batch", required=True)
    ap.add_argument("--write", action="store_true")
    ap.add_argument("--report")
    a = ap.parse_args(argv)
    reports = []
    for unit in a.units:
        doc, rep = integrate(pathlib.Path(a.wave_dir), unit, a.batch)
        reports.append(rep)
        if a.write:
            p = cl.COURSES_DIR / unit.split(".")[0] / f"{unit}.json"
            p.write_text(json.dumps(doc, ensure_ascii=False, indent=1) + "\n", encoding="utf-8", newline="")
        print(f"{unit}: {rep['upgraded']} upgraded, {rep['new']} new, {rep['cut']} cut, {rep['rechecked']} rechecked, "
              f"{len(rep['problems'])} problem(s)" + (f", {len(rep['skipped'])} skipped chunk file(s)" if rep["skipped"] else ""))
    if a.report:
        pathlib.Path(a.report).write_text(json.dumps(reports, ensure_ascii=False, indent=1), encoding="utf-8")
    bad = sum(len(r["problems"]) for r in reports)
    print(f"total: {len(reports)} lessons, {bad} problem(s)" + (" (written)" if a.write else " (dry run; nothing written)"))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
