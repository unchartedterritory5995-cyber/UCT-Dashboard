"""Every CI mutant manifest still names text that exists: no mutant that mutates nothing.

    python tools/ci_mutant_manifests.py            # exit 0 = the stale set is exactly the baseline; 1 = a line per problem
    python tools/ci_mutant_manifests.py --list     # every stale mutant with what is wrong, baselined or not

WHY (2026-11-23). `ci/mutants/*.json` are the manifests `tools/ci_mutant_runner.py` runs: each mutant is "replace
`from` with `to` in `file`, and the rail must go red". The runner refuses a `from` that is absent or not unique, but a
manifest is run only when someone dispatches it (pine-heavy's mutant job). So a later edit to a target file leaves a
`from` that matches nothing, or twice, and nothing says so: the manifest still reads as proof, and the mutant would
mutate nothing. Found by the engine train's agents on 2026-11-22; measured the next day on master `80398c94`: 45 of
849 mutants, in 18 of 82 manifests.

WHAT THIS HOLDS. For every manifest, each mutant is judged by the runner's own `validate()` (one authority: this file
adds no second definition of "runnable"). The mutants it refuses are the STALE set. That set must equal
`ci/mutants-stale-baseline.json`:
  * a stale mutant that is not in the baseline is a NEW one: the pull request that made it stale fixes the manifest
    (new `from`, and `to`, for the file's current text; then run that mutant) or deletes the mutant with its reason;
  * a baselined mutant that resolves again must leave the baseline, so the list only shrinks;
  * a manifest that is unreadable, of another schema, empty, or has two mutants with one id is never baselined.
The baseline is a debt list with owners (each manifest's author), not an allowance: tests/test_ci_mutant_manifests.py
pins a ceiling on its size that only goes down.

LINE ENDS. The runner reads a target file's bytes as they are on disk. In a checkout made with core.autocrlf=true
(Git for Windows' default) the same blobs hold CRLF, and a `from` with a newline in it would match nothing there. So
when any named file holds CRLF, the files are judged from a temporary copy with the blobs' line ends. On a runner
(LF) nothing is copied.

Standard library only. It reads files and writes nothing in the repo.
"""
from __future__ import annotations

import argparse
import json
import pathlib
import sys
import tempfile

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import ci_mutant_runner as runner  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parents[1]
MANIFEST_DIR = "ci/mutants"
BASELINE = "ci/mutants-stale-baseline.json"
BASELINE_SCHEMA = "uct.ci-mutants-stale/v1"
#: the key for a problem of the manifest itself (unreadable, another schema, no mutants, one id twice)
WHOLE = "(manifest)"


def _docs(root: pathlib.Path) -> dict:
    """{manifest file name: its parsed JSON, or the exception that reading it raised}."""
    out = {}
    for path in sorted((root / MANIFEST_DIR).glob("*.json")):
        try:
            out[path.name] = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as err:
            out[path.name] = err
    return out


def _mutants(doc) -> list:
    mutants = doc.get("mutants") if isinstance(doc, dict) else None
    return mutants if isinstance(mutants, list) else []


def _lf_view(root: pathlib.Path, docs: dict, tmp: pathlib.Path) -> pathlib.Path:
    """`root` itself when no file a manifest names holds CRLF; else `tmp`, holding each named file with LF."""
    named = set()
    for doc in docs.values():
        for m in _mutants(doc):
            if isinstance(m, dict) and isinstance(m.get("file"), str) and m["file"]:
                path = (root / m["file"]).resolve()
                if root.resolve() in path.parents and path.is_file():
                    named.add(path)
    raw = {path: path.read_bytes() for path in sorted(named)}
    if not any(b"\r\n" in data for data in raw.values()):
        return root
    for path, data in raw.items():
        copy = tmp / path.relative_to(root.resolve())
        copy.parent.mkdir(parents=True, exist_ok=True)
        copy.write_bytes(data.replace(b"\r\n", b"\n"))
    return tmp


def census(root: pathlib.Path = ROOT) -> dict:
    """{"manifests": n, "mutants": n, "stale": {manifest name: {mutant id: what the runner's validate() says}}}."""
    docs = _docs(root)
    stale: dict[str, dict[str, str]] = {}
    with tempfile.TemporaryDirectory() as tmp:
        view = _lf_view(root, docs, pathlib.Path(tmp))
        for name, doc in docs.items():
            if isinstance(doc, Exception):
                stale[name] = {WHOLE: f"cannot be read as JSON ({type(doc).__name__})"}
                continue
            mutants = _mutants(doc)
            if not isinstance(doc, dict) or doc.get("schema") != runner.SCHEMA or not mutants:
                stale[name] = {WHOLE: (runner.validate(doc, view) or ["is not a runnable manifest"])[0]}
                continue
            if not all(isinstance(m, dict) for m in mutants):
                stale[name] = {WHOLE: "every mutant must be an object"}
                continue
            bad, lines = {}, 0
            for i, m in enumerate(mutants):
                key = m["id"] if isinstance(m.get("id"), str) and m["id"] else f"mutants[{i}]"
                try:
                    found = runner.validate({"schema": runner.SCHEMA, "mutants": [m]}, view)
                except (OSError, UnicodeError) as err:
                    found = [f"{key}: {m.get('file')!r} could not be read ({type(err).__name__})"]
                lines += len(found)
                if found:
                    bad[key] = found[0]
            try:
                whole = runner.validate(doc, view)
            except (OSError, UnicodeError):
                whole = []
            if len(whole) > lines:      # a problem BETWEEN mutants, which no mutant shows alone: one id used twice
                bad[WHOLE] = next((p for p in whole if "duplicate id" in p), "a problem between its mutants")
            if bad:
                stale[name] = bad
    return {"manifests": len(docs), "mutants": sum(len(_mutants(d)) for d in docs.values()), "stale": stale}


def load_baseline(root: pathlib.Path = ROOT) -> dict:
    """{manifest name: [mutant id, ...]} from the baseline file; {} when there is none. A malformed one raises."""
    path = root / BASELINE
    if not path.is_file():
        return {}
    doc = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(doc, dict) or doc.get("schema") != BASELINE_SCHEMA or not isinstance(doc.get("stale"), dict):
        raise ValueError(f"{BASELINE}: schema must be {BASELINE_SCHEMA!r} with a `stale` object")
    for name, ids in doc["stale"].items():
        if not isinstance(ids, list) or not ids or not all(isinstance(i, str) and i for i in ids) or len(set(ids)) != len(ids):
            raise ValueError(f"{BASELINE}: {name!r} must list its stale mutant ids, each once")
    return doc["stale"]


def problems(root: pathlib.Path = ROOT, found: dict | None = None) -> list[str]:
    """Every way the stale set and the baseline disagree, one line each. Empty = they are the same set."""
    found = census(root) if found is None else found
    try:
        base = load_baseline(root)
    except (OSError, ValueError) as err:
        return [str(err)]
    out = []
    for name, bad in sorted(found["stale"].items()):
        for key, what in sorted(bad.items()):
            if key == WHOLE:
                out.append(f"{MANIFEST_DIR}/{name}: {what}. A manifest problem is never baselined: fix the manifest.")
            elif key not in base.get(name, []):
                out.append(f"{MANIFEST_DIR}/{name} mutant {what}. NEW: this mutant would mutate nothing. Give it the `from` (and "
                           f"`to`) of the file's current text and run it, or delete it with its reason. {BASELINE} takes no new entry.")
    for name, ids in sorted(base.items()):
        for key in ids:
            if key == WHOLE:
                out.append(f"{BASELINE}: {name!r} lists {WHOLE!r}, which is never baselined")
            elif key not in found["stale"].get(name, {}):
                out.append(f"{BASELINE}: {name} mutant {key} is listed as stale and is not (it resolves now, or it is gone): "
                           f"remove it from the list, which only shrinks")
    return out


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--list", action="store_true", help="print every stale mutant with what is wrong, baselined or not")
    ap.add_argument("--repo", default=None, help="the checkout to read (default: this tool's own repo)")
    a = ap.parse_args(argv)
    root = pathlib.Path(a.repo).resolve() if a.repo else ROOT
    found = census(root)
    total = sum(len(bad) for bad in found["stale"].values())
    print(f"[mutant manifests] {found['manifests']} manifests, {found['mutants']} mutants, {total} stale in {len(found['stale'])} manifests")
    if a.list:
        for name, bad in sorted(found["stale"].items()):
            for key, what in sorted(bad.items()):
                print(f"  {name}: {what}")
    out = problems(root, found)
    for line in out:
        print(f"::error::{line}")
    return 1 if out else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
