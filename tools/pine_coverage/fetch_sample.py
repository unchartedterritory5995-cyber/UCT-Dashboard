# -*- coding: utf-8 -*-
"""fetch_sample.py - assemble the coverage-map SAMPLE of open-source Pine scripts.

The sample is three named populations, never mixed silently:

  committed   corpus/committed/*.pine (266, MPL/MIT/Apache, in the repo)
  reference   corpus/reference/*.json whose source is NOT committed (271): the
              rest of the 537-entry popularity-ranked plan
              (docs/pine/corpus-expansion-plan.json). Their source is fetched
              into a LOCAL cache only and is never committed (licence ruling,
              docs/pine/LICENSING.md).
  builtin     TradingView's own built-in indicator library
              (pine-facade list?filter=standard), the open ones only.

Only PUBLIC, UNAUTHENTICATED endpoints are read, the same two
tools/pine_survey/tvfetch.py already uses. Sequential, fixed delay, no sign-in,
nothing published. A script whose scriptAccess is not `open_no_auth` is recorded
and skipped, never retried another way.

Usage:
  python tools/pine_coverage/fetch_sample.py --cache <dir>        # fetch what is missing
  python tools/pine_coverage/fetch_sample.py --cache <dir> --status

Writes <cache>/reference/<slug>.pine, <cache>/builtin/<slug>.pine and
<cache>/sample_manifest.json (one row per script: population, slug, scriptIdPart,
title, author, agreeCount, status).
"""
import argparse
import glob
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
FACADE_GET = "https://pine-facade.tradingview.com/pine-facade/get/"
FACADE_LIST = "https://pine-facade.tradingview.com/pine-facade/list/?filter=standard"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36")
DELAY = 0.5


def http_get(url, tries=3):
    last = None
    for attempt in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=45) as r:
                return r.status, r.read()
        except urllib.error.HTTPError as e:
            # 401/403/404 are ANSWERS, not transient failures: never retried, never worked around.
            if e.code in (400, 401, 403, 404):
                return e.code, b""
            last = e
        except Exception as e:  # noqa: BLE001
            last = e
        time.sleep(1.5 * (attempt + 1))
    raise last


def save_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, indent=1, ensure_ascii=False)
    os.replace(tmp, path)


def slugify(text, sid):
    keep = []
    for ch in (text or sid or "script"):
        if ch.isalnum():
            keep.append(ch.lower())
        elif ch in " -_":
            keep.append("-")
    s = "".join(keep).strip("-")
    while "--" in s:
        s = s.replace("--", "-")
    return "%s__%s" % (s[:70] or "script", sid.split(";")[-1].replace("%", "")[:12])


def fetch_source(sid):
    status, raw = http_get(FACADE_GET + urllib.parse.quote(sid, safe="") + "/last")
    if status != 200:
        return None, "http-%d" % status
    data = json.loads(raw)
    if isinstance(data, list):
        data = data[0] if data else {}
    src = data.get("source") or ""
    access = data.get("scriptAccess")
    if not src:
        return None, "no-source(access=%s)" % access
    return src, "ok"


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:  # noqa: BLE001
        pass
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", required=True)
    ap.add_argument("--status", action="store_true")
    a = ap.parse_args()
    cache = os.path.abspath(a.cache)
    if os.path.abspath(cache).lower().startswith("c:\\data"):
        sys.exit("refusing to write under C:\\data")
    man_path = os.path.join(cache, "sample_manifest.json")
    manifest = {}
    if os.path.exists(man_path):
        manifest = {r["key"]: r for r in json.load(open(man_path, encoding="utf-8"))["rows"]}

    # committed: on disk already
    for p in sorted(glob.glob(os.path.join(ROOT, "corpus", "committed", "*.pine"))):
        slug = os.path.basename(p)[:-5]
        ref = os.path.join(ROOT, "corpus", "reference", slug + ".json")
        meta = json.load(open(ref, encoding="utf-8")) if os.path.exists(ref) else {}
        manifest["committed:" + slug] = {
            "key": "committed:" + slug, "population": "committed", "slug": slug,
            "path": os.path.relpath(p, ROOT).replace("\\", "/"),
            "scriptIdPart": meta.get("scriptIdPart"), "title": meta.get("title"),
            "author": meta.get("author"), "agreeCount": meta.get("agreeCount"), "status": "ok",
        }

    if a.status:
        from collections import Counter
        c = Counter((r["population"], r["status"]) for r in manifest.values())
        for k, v in sorted(c.items()):
            print(k, v)
        return

    # reference-only: fetch into the cache
    refs = []
    for p in sorted(glob.glob(os.path.join(ROOT, "corpus", "reference", "*.json"))):
        d = json.load(open(p, encoding="utf-8"))
        if d.get("our_status") == "committed":
            continue
        refs.append(d)
    out_dir = os.path.join(cache, "reference")
    os.makedirs(out_dir, exist_ok=True)
    for i, d in enumerate(refs, 1):
        slug = os.path.basename(d.get("source_file") or d.get("cached_source") or "")[:-5] \
            or slugify(d.get("title"), d["scriptIdPart"])
        key = "reference:" + slug
        if key in manifest and manifest[key]["status"] == "ok" and os.path.exists(os.path.join(out_dir, slug + ".pine")):
            continue
        src, status = fetch_source(d["scriptIdPart"])
        if src:
            with open(os.path.join(out_dir, slug + ".pine"), "w", encoding="utf-8", newline="") as f:
                f.write(src)
        manifest[key] = {
            "key": key, "population": "reference", "slug": slug,
            "path": "<cache>/reference/%s.pine" % slug,
            "scriptIdPart": d["scriptIdPart"], "title": d.get("title"), "author": d.get("author"),
            "agreeCount": d.get("agreeCount"), "licence": d.get("licence"), "status": status,
        }
        print("[ref %3d/%3d] %-8s %s" % (i, len(refs), status, slug), flush=True)
        save_json(man_path, {"rows": sorted(manifest.values(), key=lambda r: r["key"])})
        time.sleep(DELAY)

    # TradingView built-ins
    status, raw = http_get(FACADE_LIST)
    builtins = json.loads(raw) if status == 200 else []
    out_dir = os.path.join(cache, "builtin")
    os.makedirs(out_dir, exist_ok=True)
    for i, b in enumerate(builtins, 1):
        sid = b.get("scriptIdPart")
        slug = slugify(b.get("scriptName"), sid)
        key = "builtin:" + slug
        if key in manifest and manifest[key]["status"] == "ok" and os.path.exists(os.path.join(out_dir, slug + ".pine")):
            continue
        if b.get("scriptAccess") != "open_no_auth":
            st, src = "closed(%s)" % b.get("scriptAccess"), None
        else:
            src, st = fetch_source(sid)
            time.sleep(DELAY)
        if src:
            with open(os.path.join(out_dir, slug + ".pine"), "w", encoding="utf-8", newline="") as f:
                f.write(src)
        kind = (b.get("extra") or {}).get("kind")
        manifest[key] = {
            "key": key, "population": "builtin", "slug": slug,
            "path": "<cache>/builtin/%s.pine" % slug, "scriptIdPart": sid,
            "title": b.get("scriptName"), "author": "TradingView", "kind": kind, "status": st,
        }
        print("[std %3d/%3d] %-8s %s" % (i, len(builtins), st, slug), flush=True)
        save_json(man_path, {"rows": sorted(manifest.values(), key=lambda r: r["key"])})

    save_json(man_path, {"rows": sorted(manifest.values(), key=lambda r: r["key"])})
    from collections import Counter
    print(Counter((r["population"], r["status"]) for r in manifest.values()))


if __name__ == "__main__":
    main()
