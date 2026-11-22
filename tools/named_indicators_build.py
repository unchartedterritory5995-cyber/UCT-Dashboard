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
    python tools/named_indicators_build.py --ship     # also record each NEW (entry, version) in the ledger

⛔ THE VERSION RULE (the house set's own): an entry's maths never changes under the same version.
If a text edit moves the tree, this tool REFUSES; add a new entry to that indicator's `versions`
(next number, today's date, the reason, `"maths": ""`) and run it again.

⛔ THE LEDGER (`api/data/named_indicators_shipped.json`, 2026-11-18). The rule above reads the
fingerprint stored in the library file itself, so a file REGENERATED with empty fingerprints (a seed
script does that) could move a shipped entry's maths and store the new fingerprint as if it had
always been version 1. The ledger closes that: every (entry, version) that has shipped is recorded
there once, and this tool refuses a library whose fingerprint for a recorded version differs, or
that has lost a recorded entry or version. `--ship` ADDS what is not recorded yet and never rewrites
a recorded line. `tests/test_named_indicators_ledger.py` holds the same without this tool.

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
INT_PROBES = (131, 137, 139, 149, 151, 157, 163, 167, 173, 179, 181, 191)    # twelve: Know Sure Thing has nine
FLOAT_PROBES = (1.37, 2.37, 3.37, 4.37, 5.37, 6.37)
#: For a setting whose own range ends below those (a share between 0 and 1, such as the Laguerre
#: pair's gamma): a formula that checks its argument would refuse 1.37 and show no place at all.
SMALL_FLOAT_PROBES = (0.137, 0.237, 0.337, 0.437, 0.537, 0.637)


def probe_for(param: Dict[str, Any], ints: Any, floats: Any, small: Any) -> Any:
    """The probe number for one setting: the next of its kind, or, when that falls outside the
    setting's own range, the next small one that falls inside it."""
    if param.get("integer"):
        return next(ints)
    value = next(floats)
    lo, hi = param.get("min"), param.get("max")
    inside = lambda v: (lo is None or v >= lo) and (hi is None or v <= hi)
    if inside(value):
        return value
    for v in small:
        if inside(v):
            return v
    return value


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


LEDGER = ROOT / "api" / "data" / "named_indicators_shipped.json"


def read_ledger(path: Any = None) -> Dict[str, Dict[str, str]]:
    """{entry id: {version: fingerprint}} for everything that has shipped. A missing file is an
    empty ledger (a new checkout of an old commit); an unreadable one is an error, never ignored."""
    path = LEDGER if path is None else path        # (read when called: the file's place is one fact)
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))["shipped"]


def ledger_problems(doc: Dict[str, Any], shipped: Dict[str, Dict[str, str]]) -> List[str]:
    """Where the library disagrees with what shipped: a recorded version whose fingerprint moved,
    or a recorded entry or version that is gone."""
    problems: List[str] = []
    by_id = {e["id"]: e for e in doc["indicators"]}
    for entry_id, versions in shipped.items():
        e = by_id.get(entry_id)
        if e is None:
            problems.append(f"{entry_id}: a SHIPPED entry is gone from the library (the ledger records it)")
            continue
        have = {str(h["version"]): h.get("maths") for h in e["versions"]}
        for version, fingerprint in versions.items():
            if version not in have:
                problems.append(f"{entry_id}: SHIPPED version {version} is gone from its `versions`")
            elif have[version] != fingerprint:
                problems.append(f"{entry_id}: the maths of SHIPPED version {version} moved. A shipped version never "
                                "changes: put the old formula's fingerprint back and make the change a NEW version "
                                "(next number, the date, the reason, \"maths\": \"\").")
    return problems


def unshipped(doc: Dict[str, Any], shipped: Dict[str, Dict[str, str]]) -> List[Tuple[str, str, str]]:
    """(entry id, version, fingerprint) for each version the ledger does not record yet."""
    return [(e["id"], str(h["version"]), h["maths"]) for e in doc["indicators"] for h in e["versions"]
            if str(h["version"]) not in shipped.get(e["id"], {})]


def write_ledger(doc: Dict[str, Any], path: Any = None) -> int:
    """ADD every version the ledger does not record. A recorded line is never rewritten."""
    path = LEDGER if path is None else path
    shipped = read_ledger(path)
    added = unshipped(doc, shipped)
    for entry_id, version, fingerprint in added:
        shipped.setdefault(entry_id, {})[version] = fingerprint
    out = {"_": ("THE SHIPPED-VERSION LEDGER of the named-indicator library: every (entry, version) that has shipped, and "
                 "the fingerprint of its maths. Written by `python tools/named_indicators_build.py --ship`, which only ever "
                 "ADDS a line. A recorded line never changes and is never removed: the build tool and "
                 "tests/test_named_indicators_ledger.py refuse a library that disagrees with it. To change a formula, add "
                 "a new version to the entry."),
           "shipped": {k: dict(sorted(v.items(), key=lambda kv: int(kv[0]))) for k, v in sorted(shipped.items())}}
    with io.open(path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(json.dumps(out, indent=1, ensure_ascii=False) + "\n")
    return len(added)


def derive(doc: Dict[str, Any], shipped: Any = None) -> Tuple[Dict[str, Any], List[str]]:
    """The document with every derived half recomputed, and the problems found on the way.
    ``shipped`` is the ledger to hold it to (the committed one unless a test hands another)."""
    problems: List[str] = []
    texts: Dict[str, str] = {}
    probes: Dict[str, Dict[str, Any]] = {}
    for e in doc["indicators"]:
        ints, floats, small = iter(INT_PROBES), iter(FLOAT_PROBES), iter(SMALL_FLOAT_PROBES)
        probes[e["id"]] = {p["key"]: probe_for(p, ints, floats, small) for p in e["params"]}
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
    if not problems:                               # (fingerprints are only all known once every text parsed)
        problems.extend(ledger_problems(out, read_ledger() if shipped is None else shipped))
    return out, problems


#: ⭐ THE BROWSER'S COPY (2026-11-18): the public half of the library, for the Create Indicator
#: window. With it the window shows a library indicator's Inputs as the entry's own settings (one
#: per parameter, every place it sits moving together) and reads it back in one phrase. DERIVED
#: from the library file, never written by hand: `--check` fails when it is stale. It holds no
#: evidence, no aliases and no formula text: the name, the settings, each output's phrase, its tree
#: and where each setting sits in it.
BROWSER_COPY = ROOT / "app" / "src" / "components" / "chart" / "builder" / "authoring" / "checkedLibrary.json"
BROWSER_CONTRACT = "uct.named-indicators.browser/1"
NEWLINE = chr(10)


def browser_copy(doc: Dict[str, Any]) -> str:
    """The browser's file as text: one indicator per line (small, and a change reads as one line)."""
    rows = []
    for e in doc["indicators"]:
        rows.append(json.dumps({
            "id": e["id"], "name": e["name"], "version": ni.version(e),
            "params": [{k: p[k] for k in ("key", "label", "default", "min", "max", "integer")} for p in e["params"]],
            "outputs": [{"key": o["key"], "label": o["label"], "says": o["says"], "tree": o["tree"], "sites": o["sites"]}
                        for o in e["outputs"]],
        }, ensure_ascii=False, separators=(",", ":")))
    note = ("GENERATED by tools/named_indicators_build.py from api/data/named_indicators.json. Do not edit: "
            "change the library and run the tool.")
    # ⭐ the names that are UCT's own built-in indicators: the browser tells the door which of these
    # its registry can add right now (`converseClient.offerableBuiltIns`)
    # (a name that is ONE SETTING of a built-in also carries which input and which values: the window
    # acts on an offer for it only when the offer names that input and one of those values)
    built_ins = [json.dumps({"id": e["id"], "name": e["name"], "indicator": e["built_in"]["indicator"],
                             "builtInName": e["built_in"]["name"],
                             **({"setting": {"input": ni.built_in_setting(e)["input"],
                                             "values": list(ni.built_in_setting(e)["values"])}}
                                if ni.built_in_setting(e) is not None else {})},
                            ensure_ascii=False, separators=(",", ":"))
                 for e in doc.get("held") or [] if ni.built_in(e) is not None]
    return ('{"_":' + json.dumps(note) + ',"contract":' + json.dumps(BROWSER_CONTRACT) + ',"indicators":[' + NEWLINE
            + ("," + NEWLINE).join(rows) + NEWLINE + '],"builtIns":[' + NEWLINE
            + ("," + NEWLINE).join(built_ins) + NEWLINE + "]}" + NEWLINE)


def _read_unix(path: Any) -> str:
    return path.read_text(encoding="utf-8").replace(chr(13) + NEWLINE, NEWLINE) if path.exists() else ""


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--check", action="store_true", help="change nothing; exit 1 if the file is stale")
    ap.add_argument("--ship", action="store_true", help="also ADD each version the ledger does not record yet")
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
        if _read_unix(BROWSER_COPY) != browser_copy(built):
            print(f"STALE: {BROWSER_COPY.relative_to(ROOT)} (the browser's copy): run tools/named_indicators_build.py")
            stale = True
        waiting = unshipped(built, read_ledger())
        if waiting:
            print(f"NOT IN THE LEDGER: {', '.join(f'{i} v{v}' for i, v, _ in waiting)}: run with --ship")
        print("STALE: run tools/named_indicators_build.py" if stale else f"ok: {len(built['indicators'])} indicators, nothing stale")
        return 1 if stale or waiting else 0
    with io.open(ni.PATH, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(text)
    with io.open(BROWSER_COPY, "w", encoding="utf-8", newline=NEWLINE) as fh:
        fh.write(browser_copy(built))
    if args.ship:
        print(f"ledger: {write_ledger(built)} version(s) added to {LEDGER.relative_to(ROOT)}")
    print(f"wrote {ni.PATH.relative_to(ROOT)}: {len(built['indicators'])} indicators, "
          f"{sum(len(e['outputs']) for e in built['indicators'])} formulas, {len(built.get('held') or [])} held names")
    return 0


if __name__ == "__main__":
    sys.exit(main())
