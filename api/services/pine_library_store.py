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
REQUIRED_FIELDS = ("path", "author", "name", "version", "source", "licence", "attribution")


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
    sha = entry.get("sha256")
    if sha and hashlib.sha256(entry["source"].encode("utf-8")).hexdigest() != sha:
        return ["source does not match its sha256"]
    return []


def read_entry(path: str, root: Optional[str] = None) -> Optional[dict]:
    """The stored entry for an import path, or None when it is not in the store.

    ⛔ An entry that is present but malformed is ALSO None (and never partially
    served): a library whose licence or source cannot be read is not one the
    chart may compile.
    """
    parsed = parse_import_path(path)
    if not parsed:
        return None
    fp = entry_file(*parsed, root=root)
    if not os.path.isfile(fp):
        return None
    try:
        with open(fp, encoding="utf-8") as f:
            entry = json.load(f)
    except (OSError, ValueError):
        return None
    if validate_entry(entry):
        return None
    return entry


def write_entry(entry: dict, root: Optional[str] = None) -> str:
    """Write one entry atomically (temp file + os.replace). Returns the file path."""
    problems = validate_entry(entry)
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


def list_entries(root: Optional[str] = None) -> list[dict]:
    """Every servable entry's metadata (no source), sorted by path."""
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
                entry = read_entry("%s/%s/%s" % (author, name, m.group(1)), root=base)
                if entry:
                    out.append(public_metadata(entry))
    return out


def public_metadata(entry: dict) -> dict:
    """What the member is shown about a library: everything but the source."""
    return {k: entry.get(k) for k in (
        "path", "author", "name", "version", "licence", "licenceBasis",
        "attribution", "url", "sha256", "fetchedAt",
    )}
