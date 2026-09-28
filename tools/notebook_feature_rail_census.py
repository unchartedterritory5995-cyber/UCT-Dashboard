"""Feature -> rail census for the Notebook (wave 10, lane 10E-1, clause 2b "with a rail").

    python tools/notebook_feature_rail_census.py            # the table, to stdout
    python tools/notebook_feature_rail_census.py --json out.json
    python tools/notebook_feature_rail_census.py --check    # exit 1 when a shipped feature has no rail

WHAT IT DERIVES, AND FROM WHERE (nothing is typed here):
  * THE FEATURES: the §B1 weekly-feature inventory of `docs/notebook/parity-scorecard.md` (each
    item maps to exactly one gap-ledger row), plus the ledger rows the inventory names.
  * SHIPPED OR NOT: the row's live status in `docs/notebook/competitive-gap-ledger.md`, bucketed
    by `tools/gap_ledger_summary.py` (the ledger is the status authority, ruling D-9B4). A row
    whose status buckets DONE or PARTIAL is shipped; BUILT-DARK, OPEN, REJECTED, BLOCKED are not
    (a dark or unbuilt feature has nothing to rail yet), and are listed with their bucket.
  * WHERE IT LIVES: every file the row's own "UCT Current" cell cites in backticks. A short path
    (`lib/x.js`, `components/notebook/Y.jsx`) resolves against `app/src/pages/journal-2-0/`, the
    Notebook's own root; a cited path that does not exist is reported, never guessed at.
  * ITS RAILS: every test file that IMPORTS one of those files (depth 1), or imports a source
    module that imports one of them (depth 2 -- the door a member uses is usually a component that
    imports the cited library, and its test renders the component) -- vitest files under `app/src`
    (static and dynamic imports, resolved with the bundler's extensions) and pytest files under
    `tests/` (`from api... import x` / `import api....`). `vi.mock` is not an import: a module a
    test mocks is not a module it exercises. The depth is reported per row.
    ⚰️ The first cut counted depth 1 only and read G-155 (member templates) UNRAILED while
    NoteMenuActions.test.jsx and NotebookTab.templates.test.jsx render its doors: the ledger cites
    the library, the tests import the components that use it. A proxy that manufactured a finding.

⛔ WHAT IT DOES NOT CLAIM. "A test imports the module" is a rail that can SEE the feature's code;
whether its assertions cover the feature's behaviour is not measured here (kind 2: name the proxy).
The rail list is printed so a reader can check. A shipped row that cites no file is UNLOCATED --
a finding about the ledger, not a pass.

CONTROL (`--self-check`): a planted shipped row whose only file no test imports must read
UNRAILED and make `--check` fail; a planted row citing a file that does not exist must read
UNLOCATED. An instrument that cannot fail is not a rail.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(REPO, "tools"))
import gap_ledger_summary as GLS  # noqa: E402

SCORECARD = "docs/notebook/parity-scorecard.md"
LEDGER = "docs/notebook/competitive-gap-ledger.md"
NB_ROOT = "app/src/pages/journal-2-0"
SHIPPED_BUCKETS = ("DONE", "PARTIAL")
JS_EXT = ("", ".js", ".jsx", ".ts", ".tsx", "/index.js", "/index.jsx")

_TICK = re.compile(r"`([^`]+)`")
_PATHISH = re.compile(r"^[\w./-]+\.(js|jsx|ts|tsx|py|css)$")
_JS_IMPORT = re.compile(r"""(?:^|[\s;])import\s+(?:[^'";]*?\sfrom\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)""", re.M)
_PY_IMPORT = re.compile(r"^\s*(?:from\s+([\w.]+)\s+import\s+([\w, ()]+)|import\s+([\w.]+))", re.M)


def _read(rel: str) -> str:
    with open(os.path.join(REPO, rel), encoding="utf-8", errors="replace") as fh:
        return fh.read().replace("\r\n", "\n")


def inventory_rows(scorecard_text: str) -> list[tuple[str, str]]:
    """(item, ledger row) from the §B1 table -- the capability rows only (the second table in
    §B1 scores properties as standards, not rows)."""
    out, inside = [], False
    for line in scorecard_text.split("\n"):
        if line.startswith("## §B1"):
            inside = True
            continue
        if inside and line.startswith("## "):
            break
        if inside and line.startswith("|") and not line.startswith("|---"):
            cells = [c.strip() for c in line.strip().strip("|").split("|")]
            if len(cells) == 4 and re.match(r"^G-\d{3}$", cells[3]):
                out.append((cells[2], cells[3]))
    return out


def ledger_rows(ledger_text: str) -> dict:
    """rid -> {status, bucket, current, line} (the UCT Current cell by its header name)."""
    rows = {r.rid: r for r in GLS.parse(ledger_text)}
    header, out = None, {}
    for i, line in enumerate(ledger_text.split("\n"), 1):
        if line.startswith("| ID |"):
            header = GLS.split_cells(line)
            continue
        if not line.startswith("| G-") or header is None:
            continue
        cells = GLS.split_cells(line)
        rid = cells[0]
        if len(cells) != len(header) or rid not in rows:
            continue
        out[rid] = {"status": rows[rid].status, "bucket": rows[rid].bucket, "line": i,
                    "current": cells[header.index("UCT Current")] if "UCT Current" in header else ""}
    return out


def cited_files(cell: str) -> tuple[list[str], list[str]]:
    """The files a UCT Current cell cites: (existing repo paths, cited-but-missing)."""
    found, missing = [], []
    for span in _TICK.findall(cell or ""):
        p = span.split(":")[0].strip()
        if not _PATHISH.match(p):
            continue
        cands = [p] if p.startswith(("app/", "api/", "tools/", "tests/", "scripts/")) else \
            [f"{NB_ROOT}/{p}", f"{NB_ROOT}/components/notebook/{p}", f"{NB_ROOT}/lib/{p}", f"app/src/{p}"]
        hit = next((c for c in cands if os.path.isfile(os.path.join(REPO, c))), None)
        if hit and hit not in found:
            found.append(hit)
        elif not hit and p not in missing:
            missing.append(p)
    return found, missing


def _resolve_js(test_rel: str, spec: str) -> str | None:
    if not spec.startswith("."):
        if spec.startswith("@/"):
            base = os.path.join("app/src", spec[2:])
        elif spec.startswith("/src/"):
            base = os.path.join("app", spec[1:])
        else:
            return None
    else:
        base = os.path.normpath(os.path.join(os.path.dirname(test_rel), spec))
    for ext in JS_EXT:
        cand = (base + ext).replace("\\", "/")
        if os.path.isfile(os.path.join(REPO, cand)):
            return cand
    return None


def _py_targets(rel: str) -> set:
    out = set()
    for frm, names, imp in _PY_IMPORT.findall(_read(rel)):
        mods = []
        if imp:
            mods.append(imp)
        elif frm:
            mods.append(frm)
            mods += [f"{frm}.{n.strip()}" for n in re.split(r"[,()\s]+", names) if n.strip()]
        for m in mods:
            cand = m.replace(".", "/") + ".py"
            if os.path.isfile(os.path.join(REPO, cand)):
                out.add(cand)
    return out


def source_importers() -> dict:
    """module -> source (non-test) modules importing it: app/src js/jsx and api/ py (one hop)."""
    rev: dict[str, set] = {}
    for root, _dirs, files in os.walk(os.path.join(REPO, "app", "src")):
        for f in files:
            if not re.search(r"\.(js|jsx)$", f) or re.search(r"\.test\.", f):
                continue
            rel = os.path.relpath(os.path.join(root, f), REPO).replace("\\", "/")
            for a, b in _JS_IMPORT.findall(_read(rel)):
                tgt = _resolve_js(rel, a or b)
                if tgt:
                    rev.setdefault(tgt, set()).add(rel)
    for root, _dirs, files in os.walk(os.path.join(REPO, "api")):
        for f in files:
            if not f.endswith(".py"):
                continue
            rel = os.path.relpath(os.path.join(root, f), REPO).replace("\\", "/")
            for tgt in _py_targets(rel):
                rev.setdefault(tgt, set()).add(rel)
    return rev


def import_index() -> dict:
    """module path -> sorted test files importing it (vitest under app/src, pytest under tests/)."""
    idx: dict[str, set] = {}
    for root, _dirs, files in os.walk(os.path.join(REPO, "app", "src")):
        if "node_modules" in root:
            continue
        for f in files:
            if not re.search(r"\.test\.(js|jsx|ts|tsx)$", f):
                continue
            rel = os.path.relpath(os.path.join(root, f), REPO).replace("\\", "/")
            text = _read(rel)
            for a, b in _JS_IMPORT.findall(text):
                tgt = _resolve_js(rel, a or b)
                if tgt:
                    idx.setdefault(tgt, set()).add(rel)
    for root, _dirs, files in os.walk(os.path.join(REPO, "tests")):
        for f in files:
            if not (f.startswith("test_") and f.endswith(".py")):
                continue
            rel = os.path.relpath(os.path.join(root, f), REPO).replace("\\", "/")
            for cand in _py_targets(rel):
                idx.setdefault(cand, set()).add(rel)
    return {k: sorted(v) for k, v in idx.items()}


def census(extra_rows: dict | None = None, extra_inventory: list | None = None) -> dict:
    """The census. `extra_*` exist for the control only (a planted row), never for real rows."""
    inv = inventory_rows(_read(SCORECARD)) + list(extra_inventory or [])
    led = ledger_rows(_read(LEDGER))
    led.update(extra_rows or {})
    idx = import_index()
    rev = source_importers()
    features: dict[str, dict] = {}
    for item, rid in inv:
        f = features.setdefault(rid, {"row": rid, "items": [], "ledger_line": None})
        f["items"].append(item)
    for rid, f in features.items():
        row = led.get(rid)
        if row is None:
            f.update(verdict="NOT-IN-LEDGER", bucket=None)
            continue
        f["ledger_line"] = row.get("line")
        f["bucket"] = row.get("bucket")
        f["status"] = (row.get("status") or "")[:160]
        files, missing = cited_files(row.get("current", ""))
        f["files"], f["cited_missing"] = files, missing
        rails = sorted({t for m in files for t in idx.get(m, [])})
        f["rail_depth"] = 1 if rails else None
        if not rails:
            via = sorted({u for m in files for u in rev.get(m, [])})
            rails = sorted({t for u in via for t in idx.get(u, [])})
            f["via"] = via[:12]
            f["rail_depth"] = 2 if rails else None
        f["rails"] = rails
        if f["bucket"] not in SHIPPED_BUCKETS:
            f["verdict"] = "NOT-SHIPPED"
        elif not files:
            f["verdict"] = "UNLOCATED"
        elif not rails:
            f["verdict"] = "UNRAILED"
        else:
            f["verdict"] = "RAILED"
    counts: dict[str, int] = {}
    for f in features.values():
        counts[f["verdict"]] = counts.get(f["verdict"], 0) + 1
    return {"features": sorted(features.values(), key=lambda x: x["row"]), "counts": counts,
            "sources": {"inventory": SCORECARD, "ledger": LEDGER, "status_buckets": "tools/gap_ledger_summary.py"},
            "index_modules": len(idx)}


def failing(c: dict) -> list[dict]:
    return [f for f in c["features"] if f["verdict"] in ("UNRAILED", "UNLOCATED", "NOT-IN-LEDGER")]


def render(c: dict) -> str:
    out = ["| row | features (§B1) | ledger bucket | verdict | files cited | depth | rails (test files importing them) |",
           "|---|---|---|---|---:|---:|---|"]
    for f in c["features"]:
        rails = f.get("rails") or []
        shown = ", ".join(f"`{r}`" for r in rails[:4]) + (f" (+{len(rails) - 4} more)" if len(rails) > 4 else "")
        out.append(f"| {f['row']} | {'; '.join(f['items'])[:90]} | {f.get('bucket')} | {f['verdict']} | "
                   f"{len(f.get('files') or [])} | {f.get('rail_depth') or '—'} | {shown or '—'} |")
    out.append("")
    out.append("Counts: " + ", ".join(f"{k} {v}" for k, v in sorted(c["counts"].items())))
    return "\n".join(out)


PLANT_ROW = "G-999"


def textual_orphan() -> str | None:
    """A real tools/*.py whose module name appears NOWHERE in tests/, api/ or app/src -- a text
    search, broader than any import form the census parses, so no rail can reach it by
    construction. (The planted orphan used to be this file itself; its own rail file then
    imported it and the control passed for the wrong reason -- a named file ages, a derived
    one does not.)"""
    corpus = []
    for top in ("tests", "api", os.path.join("app", "src")):
        for root, _dirs, files in os.walk(os.path.join(REPO, top)):
            if "node_modules" in root:
                continue
            for f in files:
                if f.endswith((".py", ".js", ".jsx", ".ts", ".tsx")):
                    corpus.append(_read(os.path.relpath(os.path.join(root, f), REPO).replace("\\", "/")))
    blob = "\n".join(corpus)
    for f in sorted(os.listdir(os.path.join(REPO, "tools"))):
        if f.endswith(".py") and f != "__init__.py" and f[:-3] not in blob:
            return f"tools/{f}"
    return None


def self_check() -> int:
    """The control: a planted shipped row that no test can see must fail the census."""
    ok = True
    orphan = textual_orphan()
    if not orphan:
        print("BAD no tools/*.py is free of every mention (the control has nothing to plant)")
        return 1
    print(f"planted orphan: {orphan}")
    c = census(extra_rows={PLANT_ROW: {"status": "DONE (planted)", "bucket": "DONE", "line": 0,
                                       "current": f"planted `{orphan}`"},
                           "G-998": {"status": "DONE (planted)", "bucket": "DONE", "line": 0,
                                     "current": "planted `lib/doesNotExistPlanted.js`"}},
               extra_inventory=[("Planted feature", PLANT_ROW), ("Planted missing", "G-998")])
    got = {f["row"]: f["verdict"] for f in c["features"]}
    for rid, want in ((PLANT_ROW, "UNRAILED"), ("G-998", "UNLOCATED")):
        good = got.get(rid) == want
        ok &= good
        print(f"{'ok ' if good else 'BAD'} planted {rid}: {got.get(rid)!r} (must be {want!r})")
    in_fail = {f["row"] for f in failing(c)}
    good = {PLANT_ROW, "G-998"} <= in_fail
    ok &= good
    print(f"{'ok ' if good else 'BAD'} --check sees both planted rows")
    return 0 if ok else 1


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--json")
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--self-check", action="store_true")
    a = ap.parse_args(argv)
    if a.self_check:
        return self_check()
    c = census()
    if a.json:
        with open(a.json, "w", encoding="utf-8", newline="\n") as fh:
            json.dump(c, fh, indent=1, ensure_ascii=False)
            fh.write("\n")
    print(render(c))
    if a.check:
        bad = failing(c)
        for f in bad:
            print(f"FAIL {f['row']}: {f['verdict']} ({'; '.join(f['items'])[:80]})")
        return 1 if bad else 0
    return 0


if __name__ == "__main__":
    for s in (sys.stdout, sys.stderr):
        try:
            s.reconfigure(encoding="utf-8", errors="replace")
        except Exception:  # noqa: BLE001
            pass
    sys.exit(main())
