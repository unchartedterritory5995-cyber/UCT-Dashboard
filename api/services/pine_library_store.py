"""The Pine library store: `Author/Library/Version` -> a published library's source.

A member's script may say `import TradingView/ta/7 as tvta`. Both chart lanes can
compile the library's exported functions exactly as they compile the script's own
(`app/src/components/chart/engine/ast/pineLibraries.js`) - but only when they are
handed the library's SOURCE. This module is where that source lives.

⛔⛔ THE SOURCE NEVER LIVES IN GIT. This repository is public, and a third-party
library carries its author's licence (most often MPL-2.0, TradingView's default for
an open-source publication). The store is a DATA directory the server reads:

    $PINE_LIBRARY_DIR                    when set (tests, local scratch stores)
    $DATA_DIR/pine_libraries             otherwise (the Railway volume, `/data`)

with one JSON file per library version:

    <root>/<Author>/<Library>/<Version>.json

holding the source and, beside it, the licence and attribution the member is shown.
The repository holds only this code, its tests, and small fixture libraries written
from scratch for those tests. `tools/pine_library/fetch_library.py` is how an entry
gets INTO the store; it is run by the owner, never by a test.

⛔ A VERSION IS DIFFERENT CODE. `TradingView/ta/7` and `TradingView/ta/10` are two
entries and never stand in for each other: a lookup that misses the exact version
the script imports is a miss, and the script is refused naming that version.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
from typing import Any, Optional

#: An author or library name as TradingView spells it in an import path. Letters,
#: digits and underscores only - which is also what keeps a path built from one
#: inside the store root (no `..`, no separators).
_NAME = re.compile(r"^[A-Za-z0-9_]{1,80}$")
_IMPORT_PATH = re.compile(r"^([A-Za-z0-9_]{1,80})/([A-Za-z0-9_]{1,80})/([1-9][0-9]{0,5})$")

#: The fields an entry must carry to be served. `licence` and `attribution` are not
#: optional: a library the member cannot be told the licence of is not served.
#: ⭐⭐ U15 -- nor is an entry without the sha256 of its own source (ONE check, in
#: `validate_entry`: a version is pinned by that sha, so an entry without it could not be told
#: from a later fetch of different code under the same path).
REQUIRED_FIELDS = ("path", "author", "name", "version", "source", "licence", "attribution")
_SHA256 = re.compile(r"^[0-9a-f]{64}$")
#: The reason a held entry is not served for want of a verified sha256 (the client's 409).
NO_SHA = "library:no-sha"
#: ⭐⭐ U15 (coordinator ruling 2026-11-15) -- a NON-COMMERCIAL licence is never served on this
#: paid product: the client's 409 code, and the guard the import line is refused under.
NON_COMMERCIAL = "library:licence"
LICENCE_GUARD = "pine:library-licence"
#: `NC` as its own token in a licence id (CC-BY-NC, CC-BY-NC-SA, CC-BY-NC-ND ...), or the words.
_NON_COMMERCIAL_RX = re.compile(r"(?:^|[^A-Za-z])NC(?:[^A-Za-z]|$)|non[\s-]?commercial", re.I)


#: ⭐⭐ U15 (coordinator ruling 2026-11-15) -- THE DENY LIST, one file for every door: the browser
#: and server bundles import it (`pineLibraryStore.js`) and this module reads it. A version named
#: there is never served, whatever this store holds. The web image ships `app/src` (`COPY . /app`).
DENY_FILE = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
                         "app", "src", "components", "chart", "engine", "ast", "pineLibraryDeny.json")
DENIED = "library:denied"
DENIED_GUARD = "pine:library-denied"


#: ⭐⭐ (fail closed, 2026-11-17) -- THE PROMOTION ALLOWLIST IS WHAT IS SERVED. A version is served
#: only when `tools/pine_library/promotion_allowlist.json` has a `promote` row for it AND the store
#: holds exactly the code that row pins (its sha256): the code every importing script's captures were
#: graded MATCH on. Anything else the store holds -- a `heldOut` row, a version on no list, or a
#: promoted version under other code -- is refused by name with the deny list's member sentence
#: (409 `library:denied`, guard `pine:library-denied`). ONE authority: the served set is DERIVED from
#: that file, never retyped. Why: the production store held 42 versions on no list and one held-out
#: version, every one answered `ok` and linked into a member's chart ungraded
#: (docs/pine/evidence/2026-11-17-library-store-fail-closed/EVIDENCE.md). The web image ships the
#: file (`COPY . /app`) and `railway.web.json` watches it, so a change to it redeploys `web`.
PROMOTION_FILE = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
                              "tools", "pine_library", "promotion_allowlist.json")
#: the store statuses of a version the store holds VALIDLY but does not serve (both answer as denied)
HELD = "held"              # a `heldOut` row of the allowlist
UNPROMOTED = "unpromoted"  # on no `promote` row, or held under other code than the row pins
_MEMBER_SENTENCE = "this library version is withheld until its drawing is verified against TradingView"


def _promotion_doc() -> Any:
    """The promotion allowlist, read per call (small), or None when it cannot be read."""
    try:
        with open(PROMOTION_FILE, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def promoted_versions(doc: Any = None) -> Optional[dict]:
    """``{path: sha256}`` of the allowlist's `promote` rows (``doc``, else the committed file), or
    None when it cannot be read as one. ⛔ FAIL CLOSED: None serves NOTHING. One row that names no
    import path or no sha256, or a path promoted twice, makes the whole list unreadable: dropping that
    row would decide what is served from a list nobody wrote."""
    if doc is None:
        doc = _promotion_doc()
    rows = doc.get("promote") if isinstance(doc, dict) else None
    if not isinstance(rows, list):
        return None
    out: dict = {}
    for r in rows:
        path = r.get("path") if isinstance(r, dict) else None
        sha = r.get("sha256") if isinstance(r, dict) else None
        if not (isinstance(path, str) and parse_import_path(path) and isinstance(sha, str) and _SHA256.match(sha)) \
                or path in out:
            return None
        out[path] = sha
    return out


def _member_sentence() -> str:
    return _deny_doc().get("memberSentence") or _MEMBER_SENTENCE


def _deny_doc() -> dict:
    """The deny list, read per call (small). ⛔ FAIL CLOSED: an unreadable list denies EVERY
    version (`*`), because serving a version the list may name is the one wrong answer."""
    try:
        with open(DENY_FILE, encoding="utf-8") as f:
            doc = json.load(f)
        if not isinstance(doc, dict) or not isinstance(doc.get("deny"), list):
            raise ValueError("no deny list")
        # one row that names no path makes the whole list unreadable: dropping the row would
        # serve exactly the version it was written to withhold (`denyTableOf` is the JS twin)
        if any(not isinstance(d, dict) or not isinstance(d.get("path"), str) or not d["path"] for d in doc["deny"]):
            raise ValueError("a deny row names no path")
        return doc
    except (OSError, ValueError):
        return {"deny": [{"path": "*"}], "memberSentence": None}


def denied(path: str) -> Optional[str]:
    """The member's sentence when `path` is on the deny list (or the list cannot be read), else None."""
    doc = _deny_doc()
    names = {d.get("path") for d in doc["deny"] if isinstance(d, dict)}
    if path in names or "*" in names:
        return doc.get("memberSentence") or _MEMBER_SENTENCE
    return None


def licence_problem(entry: Any) -> Optional[str]:
    """Why `entry`'s licence keeps it off this product, or None. ONE rule, read by every door
    (`validate_entry`, so the read door, the list, the server run and `fetch_library`): a
    non-commercial licence -- `NC` in its licence id, or the `nonCommercial` flag the fetch
    records -- is never served, whatever else the entry carries."""
    if not isinstance(entry, dict):
        return None
    licence = entry.get("licence")
    if entry.get("nonCommercial") is True or (isinstance(licence, str) and _NON_COMMERCIAL_RX.search(licence)):
        return ("its licence, %s, is non-commercial, and this is a paid product, so its code is not "
                "served here" % (licence if isinstance(licence, str) and licence else "unnamed"))
    return None


def store_root() -> str:
    explicit = os.environ.get("PINE_LIBRARY_DIR")
    if explicit:
        return explicit
    return os.path.join(os.environ.get("DATA_DIR", "/data"), "pine_libraries")


def parse_import_path(path: str) -> Optional[tuple[str, str, int]]:
    """`"TradingView/ta/7"` -> `("TradingView", "ta", 7)`, or None for anything else."""
    m = _IMPORT_PATH.match(path or "")
    if not m:
        return None
    return m.group(1), m.group(2), int(m.group(3))


def entry_file(author: str, name: str, version: int, root: Optional[str] = None) -> str:
    if not (_NAME.match(author or "") and _NAME.match(name or "")):
        raise ValueError("not a library name: %r/%r" % (author, name))
    if not (isinstance(version, int) and version > 0):
        raise ValueError("not a library version: %r" % (version,))
    return os.path.join(root or store_root(), author, name, "%d.json" % version)


def validate_entry(entry: Any) -> list[str]:
    """Every reason `entry` may not be served; [] when it may."""
    if not isinstance(entry, dict):
        return ["not an object"]
    problems = ["missing %s" % f for f in REQUIRED_FIELDS if not entry.get(f)]
    if problems:
        return problems
    parsed = parse_import_path(entry["path"])
    if not parsed:
        return ["path %r is not Author/Library/Version" % entry["path"]]
    if parsed != (entry["author"], entry["name"], entry["version"]):
        return ["path %r disagrees with author/name/version" % entry["path"]]
    if not isinstance(entry["source"], str) or not re.search(r"^\s*library\s*\(", entry["source"], re.M):
        return ["source does not declare library()"]
    # ⭐⭐ U15 -- THE ONE sha CHECK: served only with the sha256 of its own source. (A value equal
    # to the source's hexdigest is 64 lowercase hex by construction, so no second format check.)
    if entry.get("sha256") != hashlib.sha256(entry["source"].encode("utf-8")).hexdigest():
        return ["sha256 is missing or is not the sha256 of its source"]
    licence = licence_problem(entry)
    if licence:
        return [licence]
    return []


def entry_status(path: str, root: Optional[str] = None) -> tuple:
    """WHAT THIS SERVER SERVES for an import path: ``("ok", entry)`` only for a version the
    promotion allowlist promotes, held under the sha256 that row pins. Otherwise the stored
    status (`stored_status`: missing, denied, licence, unservable) or, for a valid stored entry
    that is not promoted, ``(HELD | UNPROMOTED, [the member's sentence])``. Every serving door
    reads this: the read door, the list, `read_entry`, `pinned_entries` (the server run)."""
    status, got = stored_status(path, root=root)
    if status != "ok":
        return status, got
    doc = _promotion_doc()
    promoted = promoted_versions(doc)
    if promoted is not None and promoted.get(path) == got["sha256"]:
        return "ok", got
    held = {r.get("path") for r in (doc.get("heldOut") if isinstance(doc, dict) else None) or ()
            if isinstance(r, dict)}
    return (HELD if promoted is not None and path not in promoted and path in held else UNPROMOTED), \
        [_member_sentence()]


def stored_status(path: str, root: Optional[str] = None) -> tuple:
    """``("ok", entry)``, ``("missing", None)`` or ``("unservable", reasons)`` for an import path:
    the STORE'S OWN RULE (deny list, licence, sha256, shape), before the promotion allowlist.
    Only the owner's tools read it (`promotion_check`, `fetch_library`); a serving door reads
    `entry_status`.

    ⭐ U15 -- a version the store HOLDS but will not serve (no verified sha256, or any other
    reason `validate_entry` gives) is told apart from one it does not hold, so the member's
    import line can say which: the router answers the first 409 and the second 404."""
    parsed = parse_import_path(path)
    if not parsed:
        return "missing", None
    # ⭐⭐ U15 -- a denied version is never served, whatever the store holds (or does not)
    deny = denied(path)
    if deny:
        return "denied", [deny]
    fp = entry_file(*parsed, root=root)
    if not os.path.isfile(fp):
        return "missing", None
    try:
        with open(fp, encoding="utf-8") as f:
            entry = json.load(f)
    except (OSError, ValueError):
        return "unservable", ["the stored entry is not readable JSON"]
    problems = validate_entry(entry)
    if problems:
        # a non-commercial licence is its own answer (409 `library:licence`, `pine:library-licence`)
        return ("licence" if licence_problem(entry) and problems == [licence_problem(entry)] else "unservable"), problems
    return "ok", entry


def pinned_entries(pins, root: Optional[str] = None) -> tuple:
    """⭐⭐ U15 -- the store entries a document's pins name, for a server run (the runtime
    service has no store of its own). ``pins`` is ``meta.libraries``: ``[{path, sha256}]``.

    Returns ``(entries, None)`` or ``(None, (guard, sentence))``: a pin the store does not hold,
    holds unservable, or holds under ANOTHER sha256 refuses the run by name, and nothing is
    sent. Never raises."""
    out = []
    try:
        items = list(pins or [])
    except TypeError:
        return None, ("pine:library-changed", "the document's library pins are not a list")
    for pin in items:
        path = pin.get("path") if isinstance(pin, dict) else None
        sha = pin.get("sha256") if isinstance(pin, dict) else None
        if not (isinstance(path, str) and parse_import_path(path) and isinstance(sha, str) and _SHA256.match(sha)):
            return None, ("pine:library-changed", "a library pin on the document is not {path, sha256}")
        status, got = entry_status(path, root=root)
        if status == "missing":
            return None, ("runtime:library", "the library %s is not in the library store" % path)
        # held out / not promoted: refused under the deny guard, with the deny list's sentence
        if status in ("denied", HELD, UNPROMOTED):
            return None, (DENIED_GUARD, "the library %s is not served: %s" % (path, "; ".join(got)))
        if status == "licence":
            return None, (LICENCE_GUARD, "the library %s is not served: %s" % (path, "; ".join(got)))
        if status == "unservable":
            return None, ("pine:library-no-sha", "the library %s is not served: %s" % (path, "; ".join(got)))
        if got["sha256"] != sha:
            return None, ("pine:library-changed",
                          "the library %s has changed since this script was saved (saved against sha256 %s..., "
                          "the store holds %s...)" % (path, sha[:12], got["sha256"][:12]))
        out.append({k: got[k] for k in ("path", "source", "sha256", "licence", "attribution")})
    return out, None


def read_entry(path: str, root: Optional[str] = None) -> Optional[dict]:
    """The stored entry for an import path, or None when it is not in the store.

    ⛔ An entry that is present but malformed is ALSO None (and never partially
    served): a library whose licence or source cannot be read is not one the
    chart may compile.
    """
    # ⭐ U15 -- ONE authority over what is served: `entry_status` (denied, licence, sha, shape,
    # and since 2026-11-17 the promotion allowlist)
    status, entry = entry_status(path, root=root)
    return entry if status == "ok" else None


def stored_entry(path: str, root: Optional[str] = None) -> Optional[dict]:
    """The stored entry when it is valid by the store's own rule (`stored_status`), promoted or
    not. For the owner's tools only (a fetch that must not re-fetch what it holds, an install that
    copies from a staging store); never a serving door."""
    status, entry = stored_status(path, root=root)
    return entry if status == "ok" else None


def write_entry(entry: dict, root: Optional[str] = None) -> str:
    """Write one entry atomically (temp file + os.replace). Returns the file path."""
    # a non-commercial entry may be STORED (so the read door can name why it is not served);
    # every other problem refuses the write
    problems = [p for p in validate_entry(entry) if p != licence_problem(entry)]
    if problems:
        raise ValueError("refusing to store %s: %s" % (entry.get("path"), "; ".join(problems)))
    fp = entry_file(entry["author"], entry["name"], entry["version"], root=root)
    os.makedirs(os.path.dirname(fp), exist_ok=True)
    tmp = fp + ".tmp"
    with open(tmp, "w", encoding="utf-8", newline="\n") as f:
        json.dump(entry, f, indent=1, ensure_ascii=False)
        f.write("\n")
    os.replace(tmp, fp)
    return fp


def list_entries(root: Optional[str] = None, served: bool = True) -> list[dict]:
    """Every served entry's metadata (no source), sorted by path. ``served=False`` (the fetch
    tool's `--list` only) lists every entry valid by the store's own rule, promoted or not."""
    read = read_entry if served else stored_entry
    base = root or store_root()
    out: list[dict] = []
    if not os.path.isdir(base):
        return out
    for author in sorted(os.listdir(base)):
        adir = os.path.join(base, author)
        if not (os.path.isdir(adir) and _NAME.match(author)):
            continue
        for name in sorted(os.listdir(adir)):
            ndir = os.path.join(adir, name)
            if not (os.path.isdir(ndir) and _NAME.match(name)):
                continue
            for fn in sorted(os.listdir(ndir)):
                m = re.match(r"^([1-9][0-9]{0,5})\.json$", fn)
                if not m:
                    continue
                entry = read("%s/%s/%s" % (author, name, m.group(1)), root=base)
                if entry:
                    out.append(public_metadata(entry))
    return out


def public_metadata(entry: dict) -> dict:
    """What the member is shown about a library: everything but the source."""
    return {k: entry.get(k) for k in (
        "path", "author", "name", "version", "licence", "licenceBasis",
        "attribution", "url", "sha256", "fetchedAt",
    )}
