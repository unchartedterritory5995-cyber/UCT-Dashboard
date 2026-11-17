"""licence_held.py — committed fixtures that left the tree for their licence, and where they live now.

On 2026-11-15 every committed fixture whose embedded third-party Pine source is not permitted by
`tools/pine_survey/corpus_licence.py` was removed (docs/pine/LICENSING.md §1: an explicit MPL-2.0 /
MIT / Apache-2.0 header, nothing else; "no licence line is not permissive"). The record of what
left, by path and hash only, is `docs/pine/vendor-harness/licence-held.json`. The bytes stay out of
git in the capture store `regrade` already reads (`evidence_ledger.capture_store()`):

    <store>/<run>/captures/<file>.json     a vendor capture
    <store>/<run>/sources/<repo path>      a .pine source, or (kind `derived`) a translated document

A rail that reads one of these files asks `fixture_path(rel)`: the tree first, then the store, and a
store copy counts ONLY at its recorded `fileSha256` (a wrong file raises). `None` means the file is
not on this machine, and the rail must SKIP by name with `note(...)`, never pass.

⛔ The JS twin is `app/src/components/chart/engine/ast/__tests__/licenceHeld.js`. Both read the same
registry and the same store rule; neither restates the list.
"""

from __future__ import annotations

import hashlib
import json
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
REPO = HERE.parent.parent
sys.path.insert(0, str(HERE))

import evidence_ledger as el  # noqa: E402 -- the store rule and the ledger: one authority

REGISTRY = REPO / "docs" / "pine" / "vendor-harness" / "licence-held.json"
SCHEMA = "uct.licence-held/v1"

#: Every key an entry may carry. Hashes and names only: never source text.
ENTRY_FIELDS = frozenset({
    "path", "kind", "fileSha256", "sourceSha256", "licenceInSource", "record", "recordLicence",
    "recordStorage", "admittedBy", "captureId", "symbol", "timeframe", "storedAt", "derivedFrom",
})


def _norm(rel) -> str:
    return str(rel).replace("\\", "/")


def registry(path: pathlib.Path = REGISTRY) -> dict:
    return json.loads(pathlib.Path(path).read_text(encoding="utf-8"))


def entries(path: pathlib.Path = REGISTRY) -> list:
    return list(registry(path).get("entries") or [])


def entry(rel, path: pathlib.Path = REGISTRY):
    r = _norm(rel)
    return next((e for e in entries(path) if e.get("path") == r), None)


def _candidates(e: dict, store: pathlib.Path) -> list:
    runs = sorted(p for p in store.iterdir() if p.is_dir()) if store.is_dir() else []
    if e.get("kind") == "capture":
        return [run / "captures" / pathlib.PurePosixPath(e["path"]).name for run in runs]
    return [run / "sources" / pathlib.PurePosixPath(e["path"]) for run in runs]


def fixture_path(rel, *, repo: pathlib.Path = REPO, store: pathlib.Path | None = None,
                 path: pathlib.Path = REGISTRY):
    """Where a fixture's bytes are on this machine: the tree, else a held copy at its recorded hash,
    else None. Raises ValueError on a held copy whose bytes are not the recorded ones."""
    r = _norm(rel)
    in_tree = pathlib.Path(repo) / r
    if in_tree.exists():
        return in_tree
    e = entry(r, path)
    if not e:
        return None
    for p in _candidates(e, pathlib.Path(store) if store else el.capture_store()):
        if not p.is_file():
            continue
        got = hashlib.sha256(p.read_bytes()).hexdigest()
        if got != e["fileSha256"]:
            raise ValueError(f"licence-held {r}: the copy at {p} hashes to {got[:12]}, not the recorded "
                             f"{e['fileSha256'][:12]}; refusing to measure the wrong bytes")
        return p
    return None


def ledger_verdict(e: dict, ledger: pathlib.Path = el.LEDGER) -> str:
    rows = []
    if pathlib.Path(ledger).exists():
        for ln in pathlib.Path(ledger).read_text(encoding="utf-8").splitlines():
            try:
                row = json.loads(ln) if ln.strip() else None
            except ValueError:
                continue
            if row and row.get("schema") == el.SCHEMA and (
                    (e.get("captureId") and row.get("captureId") == e["captureId"])
                    or row.get("sourceSha256") == e.get("sourceSha256")):
                rows.append(row)
    if not rows:
        return ("evidence ledger: NO ROW FILED YET" if e.get("kind") == "capture"
                else "evidence ledger: no row (not a vendor capture; licence verdict per the record)")
    v = rows[-1].get("verdicts") or {}
    return (f"evidence ledger: {rows[-1].get('captureId')} production {(v.get('production') or {}).get('verdict')}"
            f" / runtime-on {(v.get('runtime-on') or {}).get('verdict')}"
            f" (engine {rows[-1].get('scriptEngineVersion')}, {str(rows[-1].get('gradedAtUTC'))[:10]})")


def note(rels) -> str:
    """The sentence a skipped rail carries: which files, the licence finding, the ledger verdict."""
    parts = []
    for r in rels:
        e = entry(r) or {}
        parts.append(f"{pathlib.PurePosixPath(_norm(r)).name} [licence {e.get('licenceInSource')}; "
                     f"{ledger_verdict(e)}]")
    return (f"SKIPPED, NOT VERIFIED: {len(parts)} licence-held fixture(s) absent on this machine: "
            f"{', '.join(parts)}. Not committed (docs/pine/LICENSING.md section 1, 2c; "
            f"docs/pine/vendor-harness/licence-held.json). Put the file in the capture store "
            f"(${el.CAPTURE_STORE_ENV}) at its recorded hash to run it.")


def resolve(rel) -> str:
    """For a tool that reads a capture by its repo path (a verdicts row's `file`): the tree, else a
    licence-held copy in the store, else the repo path as given (missing, as before)."""
    if pathlib.PurePath(str(rel)).is_absolute():
        return str(rel)
    p = fixture_path(rel)
    return str(p if p is not None else REPO / _norm(rel))
