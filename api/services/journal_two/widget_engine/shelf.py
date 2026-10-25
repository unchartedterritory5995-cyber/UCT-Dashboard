"""The ready-made widget examples as immutable, numbered revisions (wave 8 Task 8.10; wave 10 Task
10.8, ruling W10-R5).

`shelf/` holds one file per revision, `<slug>.r<N>.json`, each exactly
`{"id": "shelf:<slug>", "rev": N, "name", "description", "keywords", "plan"}`, and `MANIFEST.json`:
`{"version": 1, "order": [ids...], "files": [{"file", "sha256"}]}`. The hash is the SHA-256 of the
revision's canonical JSON (`canonical_hash`), so line endings and indentation cannot move it.

A revision, once released, never changes: a placed widget keeps rendering the revision it was placed
with (`revision(id, rev)`) until the member chooses to update. A wave 8 placement carries no `defRev`
and is revision 1 (wave 8 had only revision 1). `/shelf`, `/examples` and the update control use, per
id, the newest revision whose plan the caller's `allowed` accepts (the flags: a plan that needs a dark
wave is not offered). `tests/test_widget_shelf_files.py` rails released revisions against
`origin/master`'s manifest.

⛔ The whole shelf is read and validated WHEN THIS MODULE IS IMPORTED (`load()`): every manifest
file exists and hashes to its entry, every file is listed, per id the revisions run 1..N, the file
name, `id` and `rev` agree, every plan passes `plan.validate_plan` against `sources.CATALOG`, and
`order` lists every id once. A broken shelf fails the import (the app's boot and every test that
touches the engine), never a member's card. After that every read is a dict lookup: no request ever
scans the directory.

⛔ Edit `MANIFEST.json` as TEXT (insert the new entry), never load-mutate-dump it; a new revision is a
new file, never an edit of a released one.

Every reader hands out deep copies of the VALIDATED plan (defaults filled), so a caller can never
edit the shelf in place.
"""
from __future__ import annotations

import copy
import hashlib
import json
import re
from pathlib import Path
from typing import Any, Callable

from api.services.journal_two.widget_engine import plan as wplan
from api.services.journal_two.widget_engine import sources as wsources

SHELF_DIR = Path(__file__).with_name("shelf")
MANIFEST_PATH = SHELF_DIR / "MANIFEST.json"
MANIFEST_NAME = "MANIFEST.json"
MANIFEST_VERSION = 1
ID_PREFIX = "shelf:"
_ID_RE = re.compile(r"shelf:[a-z0-9]+(?:-[a-z0-9]+)*")
_FILE_RE = re.compile(r"(?P<slug>[a-z0-9]+(?:-[a-z0-9]+)*)\.r(?P<rev>[1-9][0-9]*)\.json")
_KEYS = {"id", "rev", "name", "description", "keywords", "plan"}
_SHA_RE = re.compile(r"[0-9a-f]{64}")

Allowed = Callable[[dict], bool]


def _any(_plan: dict) -> bool:
    return True


class ShelfError(RuntimeError):
    """The shelf directory is malformed, a file does not match its hash, or a plan does not validate."""


def canonical_hash(obj: Any) -> str:
    """SHA-256 of the canonical JSON: sorted keys, no spaces, UTF-8 (line endings cannot move it)."""
    blob = json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


def _read(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        raise ShelfError(f"{path.name}: could not be read: {e}") from e


def _check_revision(name: str, obj: Any) -> dict:
    """One revision file, checked: the shape, the name/id/rev agreement, the copy, the plan."""
    m = _FILE_RE.fullmatch(name)
    if m is None:
        raise ShelfError(f"{name}: a revision file is named '<slug>.r<N>.json'")
    if not isinstance(obj, dict) or set(obj) != _KEYS:
        raise ShelfError(f"{name}: keys must be exactly {sorted(_KEYS)}")
    sid, rev = obj["id"], obj["rev"]
    if not isinstance(sid, str) or not _ID_RE.fullmatch(sid):
        raise ShelfError(f"{name}: id {sid!r} is not 'shelf:<slug>'")
    if isinstance(rev, bool) or not isinstance(rev, int) or rev < 1:
        raise ShelfError(f"{name}: rev must be a whole number from 1")
    if sid != ID_PREFIX + m["slug"] or rev != int(m["rev"]):
        raise ShelfError(f"{name}: the file name, id {sid!r} and rev {rev} disagree")
    for k in ("name", "description"):
        if not isinstance(obj[k], str) or not obj[k].strip() or len(obj[k]) > wplan.MAX_TEXT:
            raise ShelfError(f"{sid} r{rev}: {k} must be 1 to {wplan.MAX_TEXT} characters")
    kws = obj["keywords"]
    if not isinstance(kws, list) or not all(isinstance(k, str) and k.strip() for k in kws):
        raise ShelfError(f"{sid} r{rev}: keywords must be a list of words")
    if not isinstance(obj["plan"], dict):
        raise ShelfError(f"{sid} r{rev}: the plan is not an object")
    try:
        validated = wplan.validate_plan(copy.deepcopy(obj["plan"]), wsources.CATALOG)
    except wplan.PlanError as err:
        raise ShelfError(f"{sid} r{rev} ({name}): {err.sentence}") from err
    src = wsources.CATALOG.sources[validated["source"]]
    return {"id": sid, "rev": rev, "name": obj["name"], "description": obj["description"],
            "keywords": list(kws), "plan": validated,
            "summary": wplan.summary(validated, wsources.CATALOG, None, src.unit)}


def _build(directory: Path) -> tuple[tuple[str, ...], dict[str, tuple[dict, ...]]]:
    """Read and check a whole shelf directory; `(order, {id: (r1, r2, ...)})` or `ShelfError`."""
    directory = Path(directory)
    man = _read(directory / MANIFEST_NAME)
    if not isinstance(man, dict) or set(man) != {"version", "order", "files"} \
            or man.get("version") != MANIFEST_VERSION:
        raise ShelfError(f"{MANIFEST_NAME}: must be version {MANIFEST_VERSION} with order and files")
    order, entries = man["order"], man["files"]
    if not isinstance(order, list) or not isinstance(entries, list) or not entries:
        raise ShelfError(f"{MANIFEST_NAME}: order and files must be lists, files not empty")
    hashes: dict[str, str] = {}
    for e in entries:
        if not isinstance(e, dict) or set(e) != {"file", "sha256"} or not isinstance(e["file"], str) \
                or not isinstance(e["sha256"], str) or not _SHA_RE.fullmatch(e["sha256"]):
            raise ShelfError(f"{MANIFEST_NAME}: each file entry is exactly {{file, sha256}}: {e!r}")
        if e["file"] in hashes:
            raise ShelfError(f"{MANIFEST_NAME}: {e['file']} is listed twice")
        hashes[e["file"]] = e["sha256"]
    try:
        on_disk = {p.name for p in directory.iterdir() if p.is_file() and p.name != MANIFEST_NAME}
    except OSError as err:
        raise ShelfError(f"the shelf directory could not be listed: {err}") from err
    unlisted = sorted(on_disk - set(hashes))
    if unlisted:
        raise ShelfError(f"{', '.join(unlisted)}: not listed in {MANIFEST_NAME}")
    missing = sorted(set(hashes) - on_disk)
    if missing:
        raise ShelfError(f"{', '.join(missing)}: listed in {MANIFEST_NAME} but not on disk")

    by_id: dict[str, dict[int, dict]] = {}
    for name in sorted(hashes):
        obj = _read(directory / name)
        if canonical_hash(obj) != hashes[name]:
            raise ShelfError(f"{name}: its content does not match the hash in {MANIFEST_NAME} "
                             "(a released revision never changes; add a new revision instead)")
        r = _check_revision(name, obj)
        by_id.setdefault(r["id"], {})[r["rev"]] = r
    revisions: dict[str, tuple[dict, ...]] = {}
    for sid, revs in by_id.items():
        if sorted(revs) != list(range(1, len(revs) + 1)):
            raise ShelfError(f"{sid}: revisions must be contiguous from 1, found {sorted(revs)}")
        revisions[sid] = tuple(revs[n] for n in range(1, len(revs) + 1))
    if not all(isinstance(i, str) for i in order) or len(order) != len(set(order)) \
            or set(order) != set(revisions):
        raise ShelfError(f"{MANIFEST_NAME}: order must list every id exactly once "
                         f"(missing {sorted(set(revisions) - set(order))}, "
                         f"unknown {sorted(set(order) - set(revisions))})")
    return tuple(order), revisions


#: `(order, {id: (r1, ..., rN)})`, replaced as ONE assignment so a reader never sees half a shelf.
_STATE: tuple[tuple[str, ...], dict[str, tuple[dict, ...]]] = ((), {})


def load(dir: Path = SHELF_DIR) -> None:  # noqa: A002 -- the brief's name
    """Read, check and install a shelf directory as THE shelf; raise `ShelfError` naming the first
    broken file, leaving the installed shelf untouched."""
    global _STATE
    _STATE = _build(dir)


load()


def _entry(r: dict) -> dict:
    return copy.deepcopy(r)


def _newest(sid: str, allowed: Allowed) -> dict | None:
    for r in reversed(_STATE[1].get(sid, ())):
        if allowed(copy.deepcopy(r["plan"])):
            return r
    return None


def examples(allowed: Allowed = _any) -> list[dict]:
    """Per id in shelf order, the newest revision whose plan `allowed` accepts (an id with none is
    left out): `{id, rev, name, description, keywords, plan, summary}`."""
    order, _ = _STATE
    out = []
    for sid in order:
        r = _newest(sid, allowed)
        if r is not None:
            out.append(_entry(r))
    return out


def example(shelf_id: Any, allowed: Allowed = _any) -> dict | None:
    """One id's newest allowed revision, or None."""
    if not isinstance(shelf_id, str):
        return None
    r = _newest(shelf_id, allowed)
    return _entry(r) if r is not None else None


def revision(shelf_id: Any, rev: Any) -> dict | None:
    """Exactly revision `rev` of `shelf_id` (a pinned placement), or None. No flag filter: whether
    the plan may run is the caller's gate, never a silent swap to another revision."""
    if not isinstance(shelf_id, str) or isinstance(rev, bool) or not isinstance(rev, int) or rev < 1:
        return None
    revs = _STATE[1].get(shelf_id, ())
    return _entry(revs[rev - 1]) if rev <= len(revs) else None


def latest_rev(shelf_id: Any, allowed: Allowed = _any) -> int | None:
    """The newest revision number `allowed` accepts, or None."""
    if not isinstance(shelf_id, str):
        return None
    r = _newest(shelf_id, allowed)
    return r["rev"] if r is not None else None


def known(shelf_id: Any) -> bool:
    """Is `shelf_id` on the shelf at all (whatever the flags allow)?"""
    return isinstance(shelf_id, str) and shelf_id in _STATE[1]
