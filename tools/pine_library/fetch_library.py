"""fetch_library.py - put a published Pine library into the library store.

    python tools/pine_library/fetch_library.py TradingView/ta/7 PineCoders/Time/5
    python tools/pine_library/fetch_library.py --from-corpus corpus/committed --recursive
    python tools/pine_library/fetch_library.py --list

A script that says `import Author/Library/Version as x` compiles on our charts only
when that exact library version is in the store (`api/services/pine_library_store.py`).
This is the tool that puts it there. It is for the OWNER / integrator to run; no test
runs it, and it never writes into the repository.

Where it writes: `$PINE_LIBRARY_DIR` when set, else `$DATA_DIR/pine_libraries` (the
server's own store). Point `PINE_LIBRARY_DIR` at a scratch directory for local work.

How it finds a library - PUBLIC, unauthenticated TradingView endpoints only, the two
`tools/pine_survey/tvfetch.py` already reads:
  1. `pubscripts-suggest-json/?search=<Library>&type=3` (3 = libraries) -> the publication whose kind is
     `library`, whose author is <Author> and whose name is <Library>  (its PUB id)
  2. `pine-facade/get/<PUB id>/<Version>.0` -> that version's source
`--pub-id PUB;xxxx` skips step 1 when the search does not surface the library.

What it refuses to store: a publication that is not open-source (`open_no_auth`), is
not a `library`, or whose returned version is not the one asked for. A version is
different code; nothing here substitutes a neighbour.

Politeness: sequential, a fixed delay between requests, the same User-Agent as tvfetch.
"""
from __future__ import annotations

import argparse
import datetime as _dt
import hashlib
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, REPO)

from api.services import pine_library_store as store  # noqa: E402
from tools.pine_survey import corpus_licence  # noqa: E402

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36")
SUGGEST = "https://www.tradingview.com/pubscripts-suggest-json/?search="
FACADE_GET = "https://pine-facade.tradingview.com/pine-facade/get/"
DELAY = 0.6

#: a top-level `import Author/Library/Version` line (column 1, as Pine requires).
IMPORT_RE = re.compile(r"^import[ \t]+([A-Za-z0-9_]+)[ \t]*/[ \t]*([A-Za-z0-9_]+)[ \t]*/[ \t]*([0-9]+)", re.M)


def http_json(url: str, tries: int = 3):
    last = None
    for attempt in range(tries):
        try:
            req = urllib.request.Request(url, headers={
                "User-Agent": UA, "Accept": "application/json, text/plain, */*"})
            with urllib.request.urlopen(req, timeout=45) as r:
                return json.loads(r.read())
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(1.5 * (attempt + 1))
    raise last


def imports_in(source: str) -> list[str]:
    return sorted({"%s/%s/%s" % m.groups() for m in IMPORT_RE.finditer(source or "")})


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def find_candidates(author: str, name: str) -> list[str]:
    """PUB ids of publications that MAY be the library `author/name`, best first.

    A publication's display name is not its import name (`Simple Trendlines` is
    imported as `SimpleTrendlines`) and an author can be renamed after publishing
    (`TFlab` -> `TradingFinder`), so the search only nominates. `fetch` decides, by
    reading the candidate's own `library("<name>")` declaration.
    """
    seen: list[str] = []
    # `type=3` narrows the search to libraries; without it a short name (`ta`,
    # `Time`) is buried under indicators that mention the word.
    for query in (name, "%s %s" % (name, author), re.sub(r"(?<=[a-z])(?=[A-Z])", " ", name)):
        data = http_json(SUGGEST + urllib.parse.quote(query) + "&type=3")
        time.sleep(DELAY)
        ranked = []
        for r in (data or {}).get("results", []):
            extra = r.get("extra") or {}
            if extra.get("kind") != "library" or not r.get("scriptIdPart"):
                continue
            who = ((r.get("author") or {}).get("username") or "")
            score = (2 if who.lower() == author.lower() else 0) + (1 if _norm(r.get("scriptName")) == _norm(name) else 0)
            if score:
                ranked.append((-score, r["scriptIdPart"]))
        for _s, pid in sorted(ranked):
            if pid not in seen:
                seen.append(pid)
    return seen


def declares(source: str, name: str) -> bool:
    """Does this source declare `library("<name>"...)` - the import name exactly?"""
    m = re.search(r"^\s*library\s*\(\s*(?:title\s*=\s*)?[\"']([^\"']*)[\"']", source or "", re.M)
    return bool(m) and m.group(1) == name


def _get_version(pub: str, version: int):
    data = http_json(FACADE_GET + urllib.parse.quote(pub, safe="") + "/%d.0" % version)
    time.sleep(DELAY)
    if isinstance(data, list):
        data = data[0] if data else {}
    return data or {}


def fetch(path: str, pub_id: str | None = None) -> dict:
    parsed = store.parse_import_path(path)
    if not parsed:
        raise ValueError("%r is not Author/Library/Version" % path)
    author, name, version = parsed
    candidates = [pub_id] if pub_id else find_candidates(author, name)
    if not candidates:
        raise LookupError("%s: the public search did not surface a library %s by %s - "
                          "pass --pub-id" % (path, name, author))
    reasons = []
    for pub in candidates:
        try:
            data = _get_version(pub, version)
        except Exception as e:  # noqa: BLE001
            reasons.append("%s: %s" % (pub, str(e)[:60]))
            continue
        got = str(data.get("version") or "")
        kind = (data.get("extra") or {}).get("kind")
        access = data.get("scriptAccess")
        source = data.get("source") or ""
        if kind != "library":
            reasons.append("%s is a %r" % (pub, kind))
        elif access != "open_no_auth" or not source:
            reasons.append("%s is not open-source (%r)" % (pub, access))
        elif got not in ("%d.0" % version, str(version)):
            reasons.append("%s answered version %r" % (pub, got))
        elif not declares(source, name):
            reasons.append("%s does not declare library(%r)" % (pub, name))
        else:
            break
    else:
        raise LookupError("%s: no candidate is that library at that version (%s)" % (path, "; ".join(reasons)))
    licence = corpus_licence.detect(source)
    basis = "header"
    if licence == corpus_licence.NONE_FOUND:
        # TradingView's House Rules publish an open-source script under MPL-2.0 when
        # its author names no licence. Recorded as THAT, never as a header we read.
        licence, basis = "MPL-2.0", "tradingview-default"
    return {
        "path": path,
        "author": author,
        "name": name,
        "version": version,
        "source": source,
        "sha256": hashlib.sha256(source.encode("utf-8")).hexdigest(),
        "licence": licence,
        "licenceBasis": basis,
        "attribution": "%s v%d by %s, published on TradingView as an open-source library" % (name, version, author),
        "url": "https://www.tradingview.com/u/%s/#published-scripts" % author,
        "pubId": pub,
        "fetchedAt": _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "imports": imports_in(source),
    }


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("paths", nargs="*", help="Author/Library/Version")
    ap.add_argument("--from-corpus", help="also fetch every library a .pine under this directory imports")
    ap.add_argument("--recursive", action="store_true", help="also fetch what each fetched library imports")
    ap.add_argument("--pub-id", help="the PUB id to use (only with exactly one path)")
    ap.add_argument("--refetch", action="store_true", help="replace an entry already in the store")
    ap.add_argument("--list", action="store_true", help="list the store and exit")
    args = ap.parse_args(argv)
    root = store.store_root()
    if args.list:
        for e in store.list_entries(root):
            print("%-48s %-10s %s" % (e["path"], e["licence"], e.get("licenceBasis") or ""))
        return 0
    queue = list(args.paths)
    if args.from_corpus:
        for dp, _d, files in os.walk(args.from_corpus):
            for fn in files:
                if fn.endswith(".pine"):
                    with open(os.path.join(dp, fn), encoding="utf-8") as f:
                        queue.extend(imports_in(f.read()))
    if args.pub_id and len(queue) != 1:
        ap.error("--pub-id names one library; pass exactly one path")
    seen, failed = set(), 0
    print("store: %s" % root)
    while queue:
        path = queue.pop(0)
        if path in seen:
            continue
        seen.add(path)
        existing = store.read_entry(path, root=root)
        if existing and not args.refetch:
            print("have  %s" % path)
            if args.recursive:
                queue.extend(imports_in(existing["source"]))
            continue
        try:
            entry = fetch(path, args.pub_id)
        except Exception as e:  # noqa: BLE001
            failed += 1
            print("FAIL  %s  %s" % (path, str(e)[:160]))
            continue
        fp = store.write_entry(entry, root=root)
        print("ok    %s  %s (%s)  -> %s" % (path, entry["licence"], entry["licenceBasis"], fp))
        if args.recursive:
            queue.extend(entry["imports"])
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
