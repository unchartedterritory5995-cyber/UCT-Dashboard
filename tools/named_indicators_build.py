"""Build the derived halves of the NAMED-INDICATOR LIBRARY (`api/data/named_indicators.json`).

A person writes an entry's `formula` TEXT (with `{param}` where a parameter's number goes). This
tool runs each text through the SHIPPED parser (`engine/ast/parse.js`, bundled with the esbuild
in `app/node_modules`) and writes what nobody should type by hand:

  * `tree`   the tree of the formula at its default numbers, in the form the assistant writes
             (an offered function such as `roc` or `linreg` stays a plain call);
  * `sites`  where each parameter's number sits in that tree, found by parsing the text a second
             time with a different number for every parameter and reading where the trees differ;
  * the newest version's `maths` fingerprint, when it is still empty.

    python tools/named_indicators_build.py            # rewrite the derived halves
    python tools/named_indicators_build.py --check    # change nothing; exit 1 if anything is stale

⛔ THE VERSION RULE (the house set's own): an entry's maths never changes under the same version.
If a text edit moves the tree, this tool REFUSES; add a new entry to that indicator's `versions`
(next number, today's date, the reason, `"maths": ""`) and run it again.

The same facts are held without this tool by `namedIndicators.test.js` (text and tree agree, by
the shipped parser) and `tests/test_named_indicators.py` (sites, fingerprints, evidence).
"""
from __future__ import annotations

import argparse
import io
import json
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any, Dict, List, Tuple

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / "app"
sys.path.insert(0, str(ROOT))

from api.services import named_indicators as ni  # noqa: E402

PARSE_MJS = r"""
import fs from 'node:fs'
import { parseFormula } from '%(app)s/src/components/chart/engine/ast/parse.js'
import { collapseExpansions } from '%(app)s/src/components/chart/engine/ast/callExpansions.js'
const [inPath, outPath] = process.argv.slice(2)
const texts = JSON.parse(fs.readFileSync(inPath, 'utf8'))
const out = {}
for (const [k, src] of Object.entries(texts)) {
  let r
  try { r = parseFormula(src) } catch (e) { r = { ok: false, error: 'THREW: ' + String(e && e.message) } }
  out[k] = r.ok ? { ok: true, tree: collapseExpansions(r.ast) } : { ok: false, error: String(r.error).slice(0, 400) }
}
fs.writeFileSync(outPath, JSON.stringify(out))
"""
BUILD_MJS = r"""
import { pathToFileURL } from 'node:url'
const [esbuildPath, entry, outfile, appDir] = process.argv.slice(2)
const esbuild = await import(pathToFileURL(esbuildPath).href)
await esbuild.build({ entryPoints: [entry], outfile, bundle: true, platform: 'node', format: 'esm', target: 'node20',
  absWorkingDir: appDir, logLevel: 'error', loader: { '.js': 'jsx', '.json': 'json' },
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" } })
"""

#: A different number for every parameter, so the second parse shows where each one sits. Small
#: enough to pass every window guard; a text that already holds one of them is refused.
INT_PROBES = (131, 137, 139, 149, 151, 157)
FLOAT_PROBES = (1.37, 2.37, 3.37, 4.37, 5.37, 6.37)


def parse_texts(texts: Dict[str, str]) -> Dict[str, Any]:
    esbuild = APP / "node_modules" / "esbuild" / "lib" / "main.js"
    if not esbuild.exists():
        sys.exit(f"esbuild not found at {esbuild} (app/node_modules missing?)")
    work = Path(tempfile.mkdtemp(prefix="named_"))
    entry, bundle = APP / "_named_parse.mjs", APP / "_named_bundle.mjs"
    (work / "build.mjs").write_text(BUILD_MJS, encoding="utf-8")
    entry.write_text(PARSE_MJS % {"app": str(APP).replace("\\", "/")}, encoding="utf-8")
    (work / "in.json").write_text(json.dumps(texts), encoding="utf-8")
    try:
        p = subprocess.run(["node", str(work / "build.mjs"), str(esbuild), str(entry), str(bundle), str(APP)],
                           capture_output=True, text=True)
        if p.returncode != 0:
            sys.exit("bundle failed: " + (p.stderr or p.stdout)[:2000])
        r = subprocess.run(["node", str(bundle), str(work / "in.json"), str(work / "out.json")],
                           capture_output=True, text=True, encoding="utf-8", errors="replace")
        if r.returncode != 0:
            sys.exit("parse run failed: " + (r.stderr or r.stdout)[:2000])
        return json.loads((work / "out.json").read_text(encoding="utf-8"))
    finally:
        for f in (entry, bundle):
            if f.exists():
                f.unlink()


def differences(a: Any, b: Any, path: Tuple[int, ...] = ()) -> List[Tuple[Tuple[int, ...], Any]]:
    """Every place two trees of ONE shape hold a different number: (path, b's number there)."""
    if not (isinstance(a, dict) and isinstance(b, dict)) or a.get("type") != b.get("type") or a.get("name") != b.get("name"):
        raise ValueError(f"the two parses differ in SHAPE at {list(path)}: a parameter changed more than a number")
    out: List[Tuple[Tuple[int, ...], Any]] = []
    if a.get("value") != b.get("value"):
        out.append((path, b.get("value")))
    aa, ba = a.get("args") or [], b.get("args") or []
    if len(aa) != len(ba):
        raise ValueError(f"the two parses differ in SHAPE at {list(path)}")
    for i, (x, y) in enumerate(zip(aa, ba)):
        out.extend(differences(x, y, path + (i,)))
    return out


def derive(doc: Dict[str, Any]) -> Tuple[Dict[str, Any], List[str]]:
    """The document with every derived half recomputed, and the problems found on the way."""
    problems: List[str] = []
    texts: Dict[str, str] = {}
    probes: Dict[str, Dict[str, Any]] = {}
    for e in doc["indicators"]:
        ints, floats = iter(INT_PROBES), iter(FLOAT_PROBES)
        probes[e["id"]] = {p["key"]: (next(ints) if p.get("integer") else next(floats)) for p in e["params"]}
        defaults = {p["key"]: p["default"] for p in e["params"]}
        for o in e["outputs"]:
            for v in probes[e["id"]].values():
                if ni.number_text(v) in o["formula"].replace("{", " ").replace("}", " ").split():
                    problems.append(f"{e['id']}.{o['key']}: the text already holds the probe number {v}")
            texts[f"{e['id']}|{o['key']}|default"] = ni.formula_at(o["formula"], defaults)
            texts[f"{e['id']}|{o['key']}|probe"] = ni.formula_at(o["formula"], probes[e["id"]])
    parsed = parse_texts(texts)
    out = json.loads(json.dumps(doc))
    for e in out["indicators"]:
        for o in e["outputs"]:
            d, p = parsed[f"{e['id']}|{o['key']}|default"], parsed[f"{e['id']}|{o['key']}|probe"]
            if not d["ok"] or not p["ok"]:
                problems.append(f"{e['id']}.{o['key']}: the shipped parser refuses it: {d.get('error') or p.get('error')}")
                continue
            by_value = {v: k for k, v in probes[e["id"]].items()}
            sites: Dict[str, List[List[int]]] = {k: [] for k in probes[e["id"]]}
            try:
                for path, value in differences(d["tree"], p["tree"]):
                    if value not in by_value:
                        raise ValueError(f"a number at {list(path)} moved to {value}, which is no parameter's probe: "
                                         "write the parameter itself there, not arithmetic the parser folds")
                    sites[by_value[value]].append(list(path))
            except ValueError as exc:
                problems.append(f"{e['id']}.{o['key']}: {exc}")
                continue
            o["tree"], o["sites"] = d["tree"], {k: v for k, v in sites.items() if v}
        unused = [p["key"] for p in e["params"] if not any(p["key"] in (o.get("sites") or {}) for o in e["outputs"])]
        if unused:
            problems.append(f"{e['id']}: parameter(s) {unused} appear in no formula")
        if all("tree" in o for o in e["outputs"]):
            maths = ni.fingerprint(e)
            last = e["versions"][-1]
            if not last.get("maths"):
                last["maths"] = maths
            elif last["maths"] != maths:
                problems.append(f"{e['id']}: its maths moved and its version did not. Add an entry to its `versions` "
                                "(next number, the date, the reason, \"maths\": \"\") and run this again.")
    return out, problems


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--check", action="store_true", help="change nothing; exit 1 if the file is stale")
    args = ap.parse_args(argv)
    raw = ni.PATH.read_text(encoding="utf-8")
    built, problems = derive(json.loads(raw))
    for line in problems:
        print("PROBLEM:", line)
    if problems:
        return 1
    text = json.dumps(built, indent=1, ensure_ascii=False) + "\n"
    if args.check:
        stale = text != raw.replace("\r\n", "\n")
        print("STALE: run tools/named_indicators_build.py" if stale else f"ok: {len(built['indicators'])} indicators, nothing stale")
        return 1 if stale else 0
    with io.open(ni.PATH, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(text)
    print(f"wrote {ni.PATH.relative_to(ROOT)}: {len(built['indicators'])} indicators, "
          f"{sum(len(e['outputs']) for e in built['indicators'])} formulas, {len(built.get('held') or [])} held names")
    return 0


if __name__ == "__main__":
    sys.exit(main())
