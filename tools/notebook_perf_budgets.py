"""Notebook performance budgets: one checker for the bytes and the search latency (wave 7, lane I2).

It enforces the two budgets in `docs/notebook/perf-budgets.json`. That file is edited BY HAND,
and only when a budget is raised on purpose. The reason goes in `docs/notebook/perf-budgets.md`
and in the commit.

1. **Notebook JS bytes.** The JS a browser fetches before the Notebook route can render: the
   entry, plus every chunk in the STATIC import closure of the route's lazy roots. It is read
   from Vite's build manifest (`app/dist/.vite/manifest.json`, written because
   `vite.config.js` sets `build.manifest: true`). The chunk list is DERIVED from the import
   graph on every run and never typed. A hand-typed list goes stale on the next rename, and
   it goes stale in the direction that looks fine: a renamed chunk falls out of the sum.
   Dynamic imports are excluded, because they load on demand, not on first open.
2. **Read latency p95.** Reads the JSON `tools/notebook_scale_benchmark.py --json` writes and
   checks every budgeted op's p95 at the budgeted tier, for each budget named with `--budget`
   (repeatable; default `search`). An op or tier the run did not measure is a BREACH, not a
   pass: a budget that could not be checked did not pass. A budget may also name
   `"informational"` ops: measured and printed against the same line, never a breach. That is
   for a tier where the line is known to sit inside a shared runner's noise; it is never a
   raised budget, and the op stays enforced by whichever budget lists it in `ops`.
   ⛔ A BREACH COUNTS ONLY IF IT REPRODUCES (wave 7 whole-branch fix, tooling review I-3). When
   the report carries a re-measure of an op (`"remeasure"`, written by the benchmark's
   `--remeasure` / `--thresholds`: the op re-timed once, same warmup and reps, right after the
   pass that read it over its line), the op breaches only when BOTH readings are at or over the
   line. A reading that did not reproduce is printed as a note, never a breach, and no line
   moves. A report without a re-measure is judged on its one reading -- the stricter direction.
   Why a re-measure and not more reps: several of the CI job's reds were BURSTS, not two stray
   samples -- in 3 of the 6 red runs whose artifacts were read, the breaching op's p50 was 2-3x
   its usual value (run 36197064574: `q=common, relevance` p50 74.7 ms, p95 192.5 ms), so more
   reps in the same pass would mostly sample more of the same burst. A second pass, taken after
   every other op has been timed, is what a burst on a shared runner usually does not reach.

Usage:
    python tools/notebook_perf_budgets.py --dist app/dist            # bytes only
    python tools/notebook_perf_budgets.py --bench report.json --budget search_ci
    python tools/notebook_perf_budgets.py --bench report.json --budget search --budget reads --budget tasks
    python tools/notebook_perf_budgets.py --dist app/dist --bench report.json --json out.json

Exit codes: 0 = within every budget checked; 1 = a budget was breached (named, with both
numbers); 3 = the inputs could not be evaluated (missing manifest, a route root the
manifest does not know, an unreadable budget file). Exit 3 fails CLOSED on purpose.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
DEFAULT_BUDGETS = REPO / "docs" / "notebook" / "perf-budgets.json"
ENTRY = "index.html"


class Unevaluable(Exception):
    """The inputs cannot answer the question. Exit 3; never read as a pass."""


def load_manifest(dist: Path) -> dict:
    path = Path(dist) / ".vite" / "manifest.json"
    if not path.is_file():
        raise Unevaluable(f"no Vite manifest at {path} -- run `npm run build` (build.manifest must stay on)")
    return json.loads(path.read_text(encoding="utf-8"))


def static_closure(manifest: dict, roots: list[str]) -> list[str]:
    """Manifest keys reachable from `roots` through STATIC `imports` only, sorted."""
    missing = [r for r in roots if r not in manifest]
    if missing:
        raise Unevaluable(f"route root(s) not in the manifest: {missing} -- renamed or moved? "
                          "Fix the roots in perf-budgets.json; the budget measured nothing")
    seen: set[str] = set()
    stack = list(roots)
    while stack:
        k = stack.pop()
        if k in seen:
            continue
        seen.add(k)
        stack.extend(manifest[k].get("imports", []))
    return sorted(seen)


def closure_bytes(manifest: dict, dist: Path, keys: list[str]) -> tuple[int, list[tuple[str, int]]]:
    """Sum of the JS files behind `keys` (CSS is not JS and is not in this budget)."""
    rows = []
    for k in keys:
        f = manifest[k]["file"]
        if not f.endswith(".js"):
            continue
        p = Path(dist) / f
        if not p.is_file():
            raise Unevaluable(f"manifest names {f} but it is not in {dist} -- a stale or partial build")
        rows.append((f, p.stat().st_size))
    rows.sort(key=lambda r: -r[1])
    return sum(b for _, b in rows), rows


def check_bytes(budgets: dict, dist: Path) -> tuple[list[str], dict]:
    """(breaches, detail) for every entry under budgets["bytes"]."""
    manifest = load_manifest(dist)
    breaches: list[str] = []
    detail: dict = {}
    for name, spec in (budgets.get("bytes") or {}).items():
        roots = [ENTRY, *spec["roots"]]
        keys = static_closure(manifest, roots)
        total, rows = closure_bytes(manifest, dist, keys)
        if total <= 0 or len(rows) < 2:
            raise Unevaluable(f"{name}: the closure holds {len(rows)} JS file(s), {total} bytes -- "
                              "that is not a route, the graph walk found nothing")
        limit = int(spec["max"])
        detail[name] = {"bytes": total, "max": limit, "baseline": spec.get("baseline"),
                        "chunks": len(rows), "largest": rows[:8]}
        if total > limit:
            over = total - limit
            breaches.append(f"bytes.{name}: {total:,} B > budget {limit:,} B (+{over:,} B over); "
                            f"largest chunks: " + ", ".join(f"{f} {b:,}" for f, b in rows[:4]))
    return breaches, detail


def remeasured_p95(st: dict) -> float | None:
    """The p95 of the op's re-measure, or None when the run did not re-time it (or wrote
    something this cannot read -- judged on the one reading, the stricter direction)."""
    again = st.get("remeasure") if isinstance(st, dict) else None
    if not isinstance(again, dict):
        return None
    try:
        return float(again["p95_ms"])
    except (KeyError, TypeError, ValueError):
        return None


def check_search(report: dict, spec: dict) -> list[str]:
    """Every breach of one search budget in a benchmark report, as sentences naming the op,
    tier, measured p95 and the budget. The ONE implementation: the benchmark's own
    `--thresholds` calls this too. An op over its line whose re-measure came in UNDER it did
    not reproduce, so it is not a breach (`unreproduced_notes` reports it)."""
    limit = float(spec["p95_ms_max"])
    tier = int(spec["tier"])
    ops = list(spec["ops"])
    if not ops:
        raise Unevaluable("the search budget names no ops -- it would pass by checking nothing")
    both = sorted(set(ops) & set(spec.get("informational", [])))
    if both:
        raise Unevaluable(f"{both} are both enforced and informational -- a budget file must say which")
    by_n = {t["n"]: t for t in report.get("tiers", [])}
    if tier not in by_n:
        return [f"budget tier {tier:,} was not run (ran: {sorted(by_n)}) -- nothing was checked"]
    measured = by_n[tier]["ops"]
    breaches: list[str] = []
    for op in ops:
        st = measured.get(op)
        if st is None:
            breaches.append(f"{op!r} at {tier:,} notes: not measured by this run")
        elif st["p95_ms"] >= limit:
            again = remeasured_p95(st)
            if again is not None and again < limit:
                continue                  # did not reproduce: a note, never a breach
            tail = f"; re-measured {again:.1f} ms" if again is not None else ""
            breaches.append(f"{op!r} at {tier:,} notes: p95 {st['p95_ms']:.1f} ms >= budget {limit:.0f} ms{tail}")
    return breaches


def unreproduced_notes(report: dict, spec: dict) -> list[str]:
    """The enforced ops that read over the line once and UNDER it on their immediate
    re-measure, as sentences with both numbers. Never a breach, never silent."""
    limit, tier = float(spec["p95_ms_max"]), int(spec["tier"])
    measured = {t["n"]: t for t in report.get("tiers", [])}.get(tier, {}).get("ops", {})
    notes = []
    for op in spec.get("ops", []):
        st = measured.get(op)
        if st is None or st["p95_ms"] < limit:
            continue
        again = remeasured_p95(st)
        if again is not None and again < limit:
            notes.append(f"{op!r} at {tier:,} notes: p95 {st['p95_ms']:.1f} ms, then {again:.1f} ms "
                         f"on an immediate re-measure -- did not reproduce, not a breach "
                         f"(the {limit:.0f} ms line is unchanged)")
    return notes


def lines_at_tier(budgets: dict, keys: list[str], tier: int) -> dict[str, float]:
    """`{op: line}` for every op the named budgets ENFORCE at `tier` (the lowest line when two
    budgets name one op) -- what the benchmark re-times when a reading crosses it. Informational
    ops are not re-timed: they can never breach."""
    lines: dict[str, float] = {}
    for key in keys:
        spec = budgets.get(key)
        if not spec:
            raise Unevaluable(f"no {key!r} budget to re-measure against")
        if int(spec["tier"]) != int(tier):
            continue
        for op in spec["ops"]:
            lines[op] = min(lines.get(op, float("inf")), float(spec["p95_ms_max"]))
    return lines


def informational_notes(report: dict, spec: dict) -> list[str]:
    """The ops a budget REPORTS but does not enforce at its tier (`"informational"`), as
    sentences. Never a breach, and never a raised line: the number is still printed against
    the same limit, and the op stays enforced wherever another budget lists it in `ops` (the
    CI twin's switcher is informational at 10k and enforced by the local 50k `search` gate)."""
    info = list(spec.get("informational", []))
    if not info:
        return []
    limit, tier = float(spec["p95_ms_max"]), int(spec["tier"])
    measured = {t["n"]: t for t in report.get("tiers", [])}.get(tier, {}).get("ops", {})
    notes = []
    for op in info:
        st = measured.get(op)
        if st is None:
            notes.append(f"{op!r} at {tier:,} notes: not measured by this run (informational)")
        else:
            over = "OVER" if st["p95_ms"] >= limit else "under"
            notes.append(f"{op!r} at {tier:,} notes: p95 {st['p95_ms']:.1f} ms, {over} the "
                         f"{limit:.0f} ms line (informational at this tier, not enforced)")
    return notes


def load_budgets(path: Path) -> dict:
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        raise Unevaluable(f"cannot read budgets from {path}: {e!r}")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--budgets", default=str(DEFAULT_BUDGETS))
    ap.add_argument("--dist", default=None, help="a built app/dist (with .vite/manifest.json)")
    ap.add_argument("--bench", default=None, help="a notebook_scale_benchmark.py --json report")
    ap.add_argument("--budget", action="append", default=None,
                    help="latency budget key(s) to apply to --bench (repeatable; default: search)")
    ap.add_argument("--json", dest="json_path", default=None)
    args = ap.parse_args(argv)
    if not args.dist and not args.bench:
        print("nothing to check: pass --dist and/or --bench")
        return 3
    out: dict = {"budgets": args.budgets, "breaches": []}
    try:
        budgets = load_budgets(Path(args.budgets))
        if args.dist:
            b, detail = check_bytes(budgets, Path(args.dist))
            out["bytes"] = detail
            out["breaches"] += b
            for name, d in detail.items():
                print(f"bytes.{name}: {d['bytes']:,} B across {d['chunks']} JS chunks "
                      f"(budget {d['max']:,} B, baseline {d['baseline']:,} B)")
        if args.bench:
            report = json.loads(Path(args.bench).read_text(encoding="utf-8"))
            out["latency"] = {}
            for key in args.budget or ["search"]:
                spec = budgets.get(key)
                if not spec:
                    raise Unevaluable(f"no {key!r} budget in {args.budgets}")
                s = check_search(report, spec)
                info = informational_notes(report, spec)
                once = unreproduced_notes(report, spec)
                out["breaches"] += [f"[{key}] {b}" for b in s]
                out["latency"][key] = {"tier": spec["tier"], "p95_ms_max": spec["p95_ms_max"],
                                       "ops": len(spec["ops"]), "breaches": len(s),
                                       "informational": info, "unreproduced": once}
                print(f"{key}: {len(spec['ops'])} ops at {int(spec['tier']):,} notes, "
                      f"p95 < {spec['p95_ms_max']} ms -- {len(s)} breach(es)")
                for note in info + once:
                    print(f"  note [{key}] {note}")
    except (Unevaluable, OSError, ValueError, KeyError) as e:
        print(f"VERDICT: UNEVALUABLE -- {e}")
        out["unevaluable"] = str(e)
        if args.json_path:
            Path(args.json_path).write_text(json.dumps(out, indent=2), encoding="utf-8")
        return 3
    if args.json_path:
        Path(args.json_path).write_text(json.dumps(out, indent=2), encoding="utf-8")
    if out["breaches"]:
        print("VERDICT: BUDGET BREACH")
        for b in out["breaches"]:
            print(f"  BREACH {b}")
        return 1
    print("VERDICT: PASS -- within every budget checked")
    return 0


if __name__ == "__main__":
    sys.exit(main())
