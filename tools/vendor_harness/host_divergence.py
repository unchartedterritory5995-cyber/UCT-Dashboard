# -*- coding: utf-8 -*-
"""host_divergence.py - THE HOST LANE'S KNOWN-DIVERGENCE LIST, DERIVED (owner decision 2026-11-17).

    python tools/vendor_harness/host_divergence.py --check    # exit 1 when the committed list and the derivation disagree
    python tools/vendor_harness/host_divergence.py --write    # regenerate the committed list from the verdicts

THE RULE. We serve only what a reference sentence states or a committed capture grading MATCH witnesses;
otherwise we refuse BY NAME. The runtime lane has its kill list (api/data/pine_runtime_killlist.json); this
is the HOST lane's twin: every script (by the sha256 of its source, the identity the door computes) with at
least ONE committed capture that grades DIVERGE on the production lane (the host lane: the runtime lane is
dark there, `laneEvidence.runtimeDrawn == 0`) is listed, and every host door refuses it by name
(`pine:known-divergence`).

ONE AUTHORITY, TWO READERS. The committed list is
`app/src/components/chart/engine/hostKnownDivergence.json` (under app/src so the browser bundle imports the
same bytes the server reads): `engine/hostKnownDivergence.js` (the member door, the install door) and
`api/services/host_known_divergence.py` (save, served rows, alerts / scans / backtests).

⛔ NEVER HAND-TYPED. `--write` regenerates every entry from `docs/pine/vendor-harness/production/verdicts.json`
and the captures' own `source.text`; `tests/test_pine_host_known_divergence.py` re-derives and fails, by
script, when the committed list and the derivation disagree in EITHER direction. An entry comes off only when
its `liftWhen` is met: the engine fix, then a production re-grade to MATCH (or INCONCLUSIVE) on every named
capture, which removes it from the derivation, and `--write` drops it.

⛔ Only COMMITTED captures count (the file under tests/fixtures/vendor/harness in this tree): a licence-held
capture is not in CI, so a list it decided could not be re-derived there.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
VERDICTS = ROOT / "docs" / "pine" / "vendor-harness" / "production" / "verdicts.json"
LIST = ROOT / "app" / "src" / "components" / "chart" / "engine" / "hostKnownDivergence.json"
#: the capture-queue doc that makes each listed script's gap visible as work (one engine-gap row per script)
QUEUE_DOC = ROOT / "docs" / "pine" / "capture-queue-2026-11-17-host-known-divergence.md"
SCHEMA = "uct.pine-host-known-divergence/v1"
GUARD = "pine:known-divergence"

README = [
    "HOST KNOWN-DIVERGENCE LIST (owner decision 2026-11-17): the host lane's twin of the runtime kill list",
    "(api/data/pine_runtime_killlist.json). Every script, by the sha256 of its source (UTF-8, as the door receives it),",
    "with at least one COMMITTED capture grading DIVERGE on the production (host) lane. Every host door refuses a listed",
    "script BY NAME (pine:known-divergence): the member preview and the install door (engine/hostKnownDivergence.js),",
    "the save door, served rows, alerts, scans and backtests (api/services/host_known_divergence.py).",
    "GENERATED, NEVER HAND-TYPED: python tools/vendor_harness/host_divergence.py --write. The rail",
    "tests/test_pine_host_known_divergence.py re-derives it from docs/pine/vendor-harness/production/verdicts.json and fails",
    "both ways. An entry comes off only by its liftWhen: the engine fix, then a production re-grade that leaves no named",
    "capture DIVERGE (then --write drops it). Nothing stored is deleted: a saved copy is kept and comes back when unlisted.",
]


def source_hash(text: str) -> str:
    """The door's identity of a script: sha256 of its source, UTF-8 (`runtime_definitions.source_hash`)."""
    return hashlib.sha256(str(text).encode("utf-8")).hexdigest()


def _committed_pine_files() -> dict:
    """{sha256: repo path} for every git-tracked .pine file (corpus, probes, docs)."""
    out: dict = {}
    try:
        names = subprocess.check_output(["git", "ls-files", "*.pine"], cwd=ROOT).decode("utf-8").split("\n")
    except (OSError, subprocess.CalledProcessError):
        names = [str(p.relative_to(ROOT)).replace("\\", "/") for p in ROOT.rglob("*.pine") if "node_modules" not in p.parts]
    for n in sorted(x for x in names if x):
        p = ROOT / n
        try:
            b = p.read_bytes()
        except OSError:
            continue
        for v in (b, b.replace(b"\r\n", b"\n")):
            out.setdefault(hashlib.sha256(v).hexdigest(), n)
    return out


def _first_diverging(r: dict) -> tuple:
    """(kind, sentence) of the first item a DIVERGE verdict grades DIVERGE. `kind` is `drawn` when our side
    drew something that differs, `withheld` when every diverging item is a drawing our side withholds by name
    (TradingView holds objects, ours carries none: the grade is DIVERGE, the member reads a refusal)."""
    for p in r.get("plots") or []:
        if p.get("verdict") == "DIVERGE":
            return "drawn", f"plot `{p.get('title')}`: {p.get('reason')}"
    o2 = r.get("objectsV2") or {}
    o1 = r.get("objects") or {}
    if o2.get("verdict") == "DIVERGE" or o1.get("verdict") == "DIVERGE":
        first = o2.get("first") or {}
        if o2.get("pairedNothing") is True or (not first and "withheld by name" in str(o1.get("reason"))):
            return "withheld", str(o1.get("reason") or o2.get("reason") or "").split(" — ")[0]
        if first:
            return "drawn", (f"{first.get('family')} {first.get('field')} of {first.get('where')}: "
                             f"TradingView {json.dumps(first.get('vendor'))}, ours {json.dumps(first.get('ours'))}")
        return "drawn", str(o1.get("reason") or o2.get("reason"))
    for k, v in r.items():
        if isinstance(v, dict) and v.get("verdict") == "DIVERGE":
            return "drawn", f"{k}: {v.get('reason')}"
    return "drawn", str(r.get("reason"))


def is_listed(entry: dict) -> bool:
    """⭐ THE PREDICATE (coordinator ruling on #1541, 2026-11-17): a script is listed when at least one of its
    committed production DIVERGE captures shows a DRAWN difference (our side drew something that differs). A
    capture whose only difference is objects our side already withholds BY NAME is incompleteness that is
    already refused by name, not a wrong drawing, and its plots were not shown to differ: it keeps its
    engine-gap queue row as work, marked "withheld by name, not listed", and the script is not listed for it."""
    return any(c.get("kind") == "drawn" for c in (entry.get("evidence") or {}).get("diverge") or [])


def derive(verdicts_path=VERDICTS, root=ROOT) -> dict:
    """{sha256: entry} for every LISTED script (`is_listed`): the committed list's derivation."""
    return {sha: e for sha, e in derive_all(verdicts_path, root).items() if is_listed(e)}


def _member_text(text) -> str:
    """A member-facing rendering of a grader sentence: no em dash, one line."""
    return " ".join(str(text).replace(" — ", "; ").replace("—", "-").split())


def derive_all(verdicts_path=VERDICTS, root=ROOT) -> dict:
    """{sha256: entry} for every script with a committed production capture grading DIVERGE, listed or not."""
    doc = json.loads(pathlib.Path(verdicts_path).read_text(encoding="utf-8"))
    if doc.get("lane") != "production":
        raise SystemExit(f"{verdicts_path}: lane {doc.get('lane')!r}, not the production lane")
    per: dict = {}
    for r in doc.get("results") or []:
        f = pathlib.Path(root) / str(r.get("file") or "")
        if not f.is_file():
            continue                                       # licence-held / absent: not a committed capture
        try:
            text = (json.loads(f.read_text(encoding="utf-8")).get("source") or {}).get("text")
        except (OSError, ValueError):
            continue
        if not isinstance(text, str) or not text:
            continue
        e = per.setdefault(source_hash(text), {"title": r.get("script"), "diverge": [], "match": [], "other": []})
        cap = {"capture": r["id"], "symbol": r.get("symbol"), "timeframe": r.get("timeframe")}
        if r.get("verdict") == "DIVERGE":
            kind, first = _first_diverging(r)
            e["diverge"].append({**cap, "kind": kind, "firstDiverging": first})
        elif r.get("verdict") == "MATCH":
            e["match"].append(cap)
        else:
            e["other"].append(cap)
    files = _committed_pine_files()
    out: dict = {}
    for sha, e in per.items():
        if not e["diverge"]:
            continue
        src = files.get(sha)
        slug = (pathlib.Path(src).stem.split("__")[0] if src else e["diverge"][0]["capture"].rsplit("-1d-", 1)[0])
        d0 = e["diverge"][0]
        drawn = [c for c in e["diverge"] if c["kind"] == "drawn"]
        named = drawn[0] if drawn else d0
        what = named["firstDiverging"]
        caps = ", ".join(c["capture"] for c in e["diverge"])
        out[sha] = {
            "slug": slug,
            "sha256": sha,
            "title": e["title"],
            "source": src or (pathlib.Path(str(next(r["file"] for r in doc["results"] if r["id"] == d0["capture"]))).as_posix()),
            "reason": (f"on a captured {named['symbol']} {named['timeframe']} chart (capture {named['capture']}) it draws "
                       f"something that differs from TradingView: {_member_text(what)}"
                       if drawn else
                       f"on a captured {named['symbol']} {named['timeframe']} chart (capture {named['capture']}) TradingView "
                       f"draws objects this lane already withholds by name ({_member_text(what)})"),
            "evidence": {
                "diverge": e["diverge"],
                "match": sorted(c["capture"] for c in e["match"]),
                "inconclusive": sorted(c["capture"] for c in e["other"]),
            },
            "liftWhen": (f"an engine fix to the first diverging item, then a production re-grade that leaves none of "
                         f"{caps} DIVERGE (MATCH, or INCONCLUSIVE by name)"),
        }
    return dict(sorted(out.items(), key=lambda kv: (kv[1]["slug"], kv[0])))


def committed(path=LIST) -> dict:
    """{sha256: entry} as committed."""
    doc = json.loads(pathlib.Path(path).read_text(encoding="utf-8"))
    return {s["sha256"]: s for s in doc.get("scripts") or []}


def disagreements(committed_list: dict, derived: dict) -> list:
    """Every way the committed list and the derivation disagree, each naming the script."""
    out = []
    for sha in sorted(set(derived) - set(committed_list)):
        out.append(f"NOT LISTED: {derived[sha]['slug']} ({sha[:12]}) has a committed DIVERGE capture with a drawn "
                   f"difference ({', '.join(c['capture'] for c in derived[sha]['evidence']['diverge'] if c['kind'] == 'drawn')}) "
                   "and is not on the list")
    for sha in sorted(set(committed_list) - set(derived)):
        out.append(f"STALE: {committed_list[sha].get('slug')} ({sha[:12]}) is listed but no committed capture of it "
                   "grades DIVERGE with a drawn difference on the production lane (its liftWhen is met: --write drops it)")
    for sha in sorted(set(committed_list) & set(derived)):
        if committed_list[sha] != derived[sha]:
            out.append(f"DRIFTED: {derived[sha]['slug']} ({sha[:12]}): its entry is not the derivation's (--write)")
    return out


def render(derived: dict) -> str:
    return json.dumps({"schema": SCHEMA, "guard": GUARD, "_readme": README, "scripts": list(derived.values())},
                      indent=1, ensure_ascii=False) + "\n"


def queue_row_id(slug: str) -> str:
    """A listed script's queue row id (the evidence engine reads row ids of at most 60 characters)."""
    return f"hkd:{slug}"[:60]


def _cell(text) -> str:
    return " ".join(str(text).replace("|", "/").split())


def render_queue(derived_all: dict) -> str:
    """The queue doc: one row per script with a committed production DIVERGE (`derive_all`) and its
    `engine-gap` disposition, naming the capture and the first diverging item. A listed script's row says
    it is refused by name; a withheld-only one says "withheld by name, not listed" (its gap is still work).
    Regenerated with the list (`--write`); `--check` holds it to the derivation too."""
    rows, disp = [], []
    for e in derived_all.values():
        listed = is_listed(e)
        drawn = [c for c in e["evidence"]["diverge"] if c["kind"] == "drawn"]
        c = (drawn or e["evidence"]["diverge"])[0]
        rid = queue_row_id(e["slug"])
        kept = (f"`{GUARD}`: the whole script is refused by name on the host lane" if listed else
                "withheld by name, not listed: only objects this lane already withholds by name differ; its plots are served")
        rows.append(f"| {rid} | none: engine gap (the capture `{c['capture']}` is in the harness) "
                    f"| `{c['symbol']} {c['timeframe']}` | {kept} "
                    f"| a production re-grade leaving none of its {len(e['evidence']['diverge'])} DIVERGE capture(s) DIVERGE "
                    f"| engine |")
        disp.append(f"| {rid} | engine-gap | {'listed' if listed else 'withheld by name, not listed'}: "
                    f"`{c['capture']}` grades DIVERGE on the host lane; first diverging item "
                    f"({c['kind']}): {_cell(c['firstDiverging'])}. What closes it is an engine fix and a re-grade, "
                    f"not a TradingView reading |")
    return "\n".join([
        "# Capture queue: the host lane's known divergences (2026-11-17)",
        "",
        "GENERATED by `python tools/vendor_harness/host_divergence.py --write` with",
        "`app/src/components/chart/engine/hostKnownDivergence.json` (owner decision 2026-11-17: the host lane gets the",
        "runtime lane's kill-list protection). One row per script with a committed TradingView capture grading DIVERGE on",
        "the production (host) lane. A script with a DRAWN difference (our side drew something that differs) is LISTED and",
        "every host door refuses it by name (`pine:known-divergence`). A script whose only difference is objects our side",
        "already withholds by name is NOT listed (coordinator ruling on #1541): its row stays here as work. Each row is the gap:",
        "an engine fix to the first diverging item named below, then a production re-grade. Never hand-edit: regenerate.",
        "",
        "| id | probe | symbol / tf | refusal kept | unblocks | owner |",
        "|---|---|---|---|---|---|",
        *rows,
        "",
        "## Not capture questions (queue dispositions)",
        "",
        "Read by `tools/vendor_harness/evidence_engine.py queue`: each row named here leaves `rowsNeedingProbe` and is "
        "listed, with this reason, in `rowsNotCaptureQuestions` (dispositions: `DISPOSITIONS` in the engine).",
        "",
        "| not a capture | disposition | reason |",
        "|---|---|---|",
        *disp,
        "",
    ])


def main(argv=None) -> int:
    p = argparse.ArgumentParser()
    g = p.add_mutually_exclusive_group(required=True)
    g.add_argument("--check", action="store_true")
    g.add_argument("--write", action="store_true")
    g.add_argument("--table", action="store_true", help="print what members lose, per script and symbol")
    a = p.parse_args(argv)
    every = derive_all()
    d = {sha: e for sha, e in every.items() if is_listed(e)}
    if a.write:
        tmp = LIST.with_suffix(".json.tmp")
        tmp.write_text(render(d), encoding="utf-8", newline="\n")
        tmp.replace(LIST)
        tmp = QUEUE_DOC.with_suffix(".md.tmp")
        tmp.write_text(render_queue(every), encoding="utf-8", newline="\n")
        tmp.replace(QUEUE_DOC)
        print(f"wrote {LIST.relative_to(ROOT)} ({len(d)} listed) and {QUEUE_DOC.relative_to(ROOT)} "
              f"({len(every)} rows, {len(every) - len(d)} withheld by name, not listed)")
        return 0
    if a.table:
        for e in every.values():
            ev = e["evidence"]
            print(f"{'LISTED    ' if is_listed(e) else 'not listed'} {e['slug']} | DIVERGE: "
                  + "; ".join(f"{c['symbol']} {c['capture']} [{c['kind']}]" for c in ev["diverge"])
                  + f" | MATCH: {', '.join(ev['match']) or '-'}")
        return 0
    probs = disagreements(committed(), d)
    try:
        if QUEUE_DOC.read_text(encoding="utf-8") != render_queue(every):
            probs.append(f"QUEUE: {QUEUE_DOC.relative_to(ROOT)} is not the derivation's (--write)")
    except OSError:
        probs.append(f"QUEUE: {QUEUE_DOC.relative_to(ROOT)} is missing (--write)")
    for x in probs:
        print(x)
    print("host known-divergence list: %s (%d derived, %d committed)"
          % ("AGREES" if not probs else "DISAGREES", len(d), len(committed())))
    return 1 if probs else 0


if __name__ == "__main__":
    sys.exit(main())
