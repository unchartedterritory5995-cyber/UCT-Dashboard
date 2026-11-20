# -*- coding: utf-8 -*-
"""census_full.py - the coverage-map census over EVERY open-source script we fetch, not the 679 sample.

The coverage map (docs/pine/COVERAGE-MAP.md) measures 679 scripts: the committed corpus, the rest of the
537-entry popularity plan and TradingView's open built-ins. The 2026-09-08 ecosystem survey read 4,898
open-source scripts (docs/pine/README.md), and that cache is gone (it lived in a removed worktree). This
tool re-reads that population with the survey's own query vocabulary (tools/pine_survey/tvfetch.py
QUERIES) and runs the SAME census (run_census.drive, the same isClean predicate, both lanes, the same
library store) over all of it, on GitHub runners, in a few long shards.

⛔⛔ THE REPO IS PUBLIC, AND MOST OF THESE SOURCES ARE LICENCE-HELD (docs/pine/LICENSING.md).
  - Nothing here writes a source into the repository. The local cache is a scratch directory.
  - The committed population file (`population`) carries identifiers only: key, population, the public
    script id, the revision fetched, the source's sha256, boosts and kind. No title, author or text.
  - A runner fetches its own shard straight from TradingView's public endpoint, BY THE PINNED REVISION,
    and refuses a text whose sha256 is not the committed one. Nothing we hold is sent to CI.
  - A census row quotes source lines (`refusals[].text`). Rows leave the runner only SEALED: encrypted
    to a public key passed in by the operator (AES-256-CBC under a random key, the key wrapped with
    RSA-OAEP, `openssl` on both ends). The private key never leaves the operator's machine. What the
    runner prints and uploads in the clear is counts only.

Subcommands (operator side unless marked RUNNER):
  enumerate  --cache D                  the survey's 169 queries -> D/catalog.json
  fetch      --cache D --sample S       every open catalogued script not already in the 679 sample S,
                                        by `/last` -> D/ecosystem/<slug>.pine + D/fetch_log.json
  pin        --cache D --sample S       for each reference / built-in row of S: the revision whose text
                                        IS the cached text (the 679 map's own text) -> D/pins.json
  population --cache D --sample S --ref R --out P
                                        the committed population file P (identifiers only) and the local
                                        full cache D/full (sample_manifest.json whose paths resolve here)
  shard      --population P --shard i --of n --out O [--examples-ref R]     RUNNER: fetch + verify
  seal / unseal                         openssl hybrid envelope (see `seal_paths`)
  assemble   --population P --cache D --shards DIR --lane L --out C
                                        the unsealed shard rows -> one census cache per lane, whose
                                        census_input.json paths point at the LOCAL sources (sha-checked)

Politeness: sequential, a fixed delay, the public unauthenticated endpoints fetch_sample.py reads, no
sign-in. A non-open script is recorded and skipped, never retried another way. 4xx is an answer.
"""
import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)
sys.path.insert(0, ROOT)

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36")
SUGGEST = "https://www.tradingview.com/pubscripts-suggest-json/?search="
FACADE_GET = "https://pine-facade.tradingview.com/pine-facade/get/"
DELAY = float(os.environ.get("CENSUS_FULL_DELAY", "0.5"))
POPULATION_SCHEMA = "uct.pine-census-full-population/v1"
ECOSYSTEM = "ecosystem"
POPULATIONS = ("committed", "reference", "builtin", ECOSYSTEM)


# ── small helpers ─────────────────────────────────────────────────────────────────────────────────────
def sha256_text(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def write_json(path, obj, indent=1):
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8", newline="\n") as f:
        json.dump(obj, f, indent=indent, ensure_ascii=False)
        f.write("\n")
    os.replace(tmp, path)


def write_text(path, text):
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8", newline="") as f:
        f.write(text)
    os.replace(tmp, path)


def read_text(path):
    with open(path, encoding="utf-8", newline="") as f:
        return f.read()


def load_json(path, default=None):
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    return default


def http_get(url, tries=3):
    """(status, bytes). 400/401/403/404 are ANSWERS, never retried; other failures retry with backoff."""
    last = None
    for attempt in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json",
                                                       "Accept-Language": "en-US,en;q=0.9"})
            with urllib.request.urlopen(req, timeout=45) as r:
                return r.status, r.read()
        except urllib.error.HTTPError as e:
            if e.code in (400, 401, 403, 404):
                return e.code, b""
            last = e
        except Exception as e:  # noqa: BLE001
            last = e
        time.sleep(2.0 * (attempt + 1))
    raise last


def facade(sid, rev="last"):
    """One pine-facade read: ({source, scriptAccess, version, kind}, status-string)."""
    status, raw = http_get(FACADE_GET + urllib.parse.quote(sid, safe="") + "/" + urllib.parse.quote(str(rev), safe=""))
    if status != 200:
        return None, "http-%d" % status
    data = json.loads(raw)
    if isinstance(data, list):
        data = data[0] if data else {}
    src = data.get("source") or ""
    if not src:
        return None, "no-source(access=%s)" % data.get("scriptAccess")
    return {"source": src, "scriptAccess": data.get("scriptAccess"), "version": data.get("version"),
            "kind": (data.get("extra") or {}).get("kind")}, "ok"


def safe_slug(sid, title):
    """tvfetch.safe_slug: the naming corpus/reference already uses (title, then the id's first 10)."""
    from tools.pine_survey.tvfetch import safe_slug as _s
    return _s(sid, title)


PINE_VERSION_RE = re.compile(r"^\s*//\s*@version\s*=\s*(\d+)", re.M)


def pine_version(src):
    m = PINE_VERSION_RE.search(src)
    return int(m.group(1)) if m else 1


def version_bucket(v):
    return "v%d" % v if v >= 4 else "v1-v3"


# ── operator: enumerate + fetch ───────────────────────────────────────────────────────────────────────
def cmd_enumerate(a):
    from tools.pine_survey.tvfetch import QUERIES
    cache = os.path.abspath(a.cache)
    cat_p = os.path.join(cache, "catalog.json")
    catalog = load_json(cat_p, {})
    done = set(load_json(os.path.join(cache, "queries_done.json"), []))
    for i, q in enumerate(QUERIES, 1):
        if q in done:
            continue
        status, raw = http_get(SUGGEST + urllib.parse.quote(q))
        if status != 200:
            print("QUERY %s http-%d" % (q, status), flush=True)
            time.sleep(DELAY)
            continue
        results = (json.loads(raw) or {}).get("results") or []
        new = 0
        for s in results:
            sid = s.get("scriptIdPart")
            if not sid:
                continue
            if sid not in catalog:
                new += 1
                catalog[sid] = {"scriptIdPart": sid, "title": s.get("title"),
                                "author": (s.get("author") or {}).get("username"),
                                "agreeCount": s.get("agreeCount"), "access": s.get("access"),
                                "editorsPick": s.get("editorsPick"), "kind": s.get("type"), "found_by": [q]}
            elif q not in catalog[sid]["found_by"]:
                catalog[sid]["found_by"].append(q)
        done.add(q)
        print("[%3d/%3d] %-34s results=%-3d new=%-3d total=%d" % (i, len(QUERIES), q, len(results), new,
                                                                   len(catalog)), flush=True)
        write_json(cat_p, catalog)
        write_json(os.path.join(cache, "queries_done.json"), sorted(done))
        time.sleep(DELAY)
    acc = {}
    for v in catalog.values():
        acc[v.get("access")] = acc.get(v.get("access"), 0) + 1
    print("ENUMERATE DONE unique=%d access=%s (1 open, 2 protected, 3 invite-only)" % (len(catalog), acc))


def sample_rows(sample):
    return json.load(open(os.path.join(sample, "sample_manifest.json"), encoding="utf-8"))["rows"]


def cmd_fetch(a):
    """Every open catalogued script that is not already one of the 679 sample's scripts, by `/last`."""
    cache = os.path.abspath(a.cache)
    catalog = load_json(os.path.join(cache, "catalog.json"), {})
    in_sample = {r.get("scriptIdPart") for r in sample_rows(a.sample) if r.get("scriptIdPart")}
    log_p = os.path.join(cache, "fetch_log.json")
    log = load_json(log_p, {})
    items = [v for v in catalog.values() if v.get("access") == 1 and v["scriptIdPart"] not in in_sample]
    items.sort(key=lambda v: (-(v.get("agreeCount") or 0), v["scriptIdPart"]))
    if a.limit:
        items = items[:a.limit]
    ok = skip = fail = 0
    t0 = time.time()
    for i, v in enumerate(items, 1):
        sid = v["scriptIdPart"]
        prev = log.get(sid) or {}
        if prev.get("status") == "ok" and os.path.exists(os.path.join(cache, ECOSYSTEM, prev["slug"] + ".pine")):
            skip += 1
            continue
        if prev.get("status") in ("not_open",) or (prev.get("status") or "").startswith("http-4"):
            skip += 1
            continue
        try:
            d, st = facade(sid)
        except Exception as e:  # noqa: BLE001
            log[sid] = {"status": "error", "error": str(e)[:160]}
            fail += 1
            time.sleep(DELAY)
            continue
        if d is None or d["scriptAccess"] != "open_no_auth":
            log[sid] = {"status": "not_open" if d is not None else st,
                        "scriptAccess": d["scriptAccess"] if d else None}
            skip += 1
        else:
            slug = safe_slug(sid, v.get("title"))
            write_text(os.path.join(cache, ECOSYSTEM, slug + ".pine"), d["source"])
            log[sid] = {"status": "ok", "slug": slug, "rev": d["version"], "sha256": sha256_text(d["source"]),
                        "kind": d["kind"], "pineVersion": pine_version(d["source"])}
            ok += 1
        if (ok + fail + skip) % 25 == 0:
            write_json(log_p, log)
            print("[%4d/%4d] ok=%d skip=%d fail=%d %.0fs" % (i, len(items), ok, skip, fail, time.time() - t0),
                  flush=True)
        time.sleep(DELAY)
    write_json(log_p, log)
    print("FETCH DONE ok=%d skip=%d fail=%d of %d (%.0fs)" % (ok, skip, fail, len(items), time.time() - t0))


def cmd_pin(a):
    """The revision of each reference / built-in sample script whose text IS the 679 cache's text, so a
    runner measures the very text the 679 map measured. `/last` first; a changed script walks back."""
    cache = os.path.abspath(a.cache)
    pins_p = os.path.join(cache, "pins.json")
    pins = load_json(pins_p, {})
    sample = os.path.abspath(a.sample)
    rows = [r for r in sample_rows(sample) if r["status"] == "ok" and r["population"] in ("reference", "builtin")]
    for i, r in enumerate(rows, 1):
        if r["key"] in pins and pins[r["key"]].get("status") in ("pinned", "changed", "gone"):
            continue
        text = read_text(r["path"].replace("<cache>", sample))
        want = sha256_text(text)
        sid = r["scriptIdPart"]
        tried = []
        found = None
        try:
            d, st = facade(sid)
            time.sleep(DELAY)
            if d and sha256_text(d["source"]) == want:
                found = d["version"]
            elif d and d.get("version"):
                tried.append(d["version"])
                try:
                    top = int(float(d["version"]))
                except ValueError:
                    top = 0
                for n in range(top - 1, max(0, top - 40), -1):
                    rev = "%d.0" % n
                    dd, _st = facade(sid, rev)
                    time.sleep(DELAY)
                    tried.append(rev)
                    if dd and sha256_text(dd["source"]) == want:
                        found = rev
                        break
        except Exception as e:  # noqa: BLE001
            pins[r["key"]] = {"status": "error", "error": str(e)[:160]}
            continue
        if found:
            pins[r["key"]] = {"status": "pinned", "rev": found, "sha256": want}
        elif d is not None and d.get("scriptAccess") in ("open_no_auth", None):
            # ⚠️ no revision reproduces the 679 cache's text: the full census measures TODAY's text, kept
            # locally beside the cache, and the row says so (`textChangedSince679`)
            write_text(os.path.join(cache, "changed", r["population"], r["slug"] + ".pine"), d["source"])
            pins[r["key"]] = {"status": "changed", "rev": d["version"], "sha256": sha256_text(d["source"]),
                              "sha256At679": want, "tried": tried[:6]}
        else:
            pins[r["key"]] = {"status": "gone", "answer": st, "sha256At679": want}
        if i % 20 == 0:
            write_json(pins_p, pins)
            print("[%3d/%3d] pinned=%d" % (i, len(rows), sum(1 for p in pins.values() if p["status"] == "pinned")),
                  flush=True)
    write_json(pins_p, pins)
    c = {}
    for p in pins.values():
        c[p["status"]] = c.get(p["status"], 0) + 1
    print("PIN DONE %s" % c)


# ── operator: the population (committed, identifiers only) and the local full cache ───────────────────
def example_rows(ref_path, out_dir):
    """run_census.build_examples (the census's own example selection), each with its text's sha256."""
    import run_census as rc
    rows = rc.build_examples(ref_path, out_dir)
    for r in rows:
        r["sha256"] = sha256_text(read_text(r["path"]))
    return rows


def cmd_population(a):
    cache = os.path.abspath(a.cache)
    sample = os.path.abspath(a.sample)
    full = os.path.join(cache, "full")
    catalog = load_json(os.path.join(cache, "catalog.json"), {})
    log = load_json(os.path.join(cache, "fetch_log.json"), {})
    pins = load_json(os.path.join(cache, "pins.json"), {})
    rows, local, dropped = [], [], []
    for r in sample_rows(sample):
        if r["status"] != "ok":
            continue
        pop = r["population"]
        if pop == "committed":
            path = os.path.join(ROOT, r["path"]) if not os.path.isabs(r["path"]) else r["path"]
            rev, changed = None, False
        else:
            pin = pins.get(r["key"]) or {}
            if pin.get("status") == "pinned":
                path, rev, changed = r["path"].replace("<cache>", sample), pin["rev"], False
            elif pin.get("status") == "changed":
                path, rev, changed = os.path.join(cache, "changed", pop, r["slug"] + ".pine"), pin["rev"], True
            else:
                dropped.append({"key": r["key"], "why": pin.get("status") or "unpinned"})
                continue
        text = read_text(path)
        rows.append({"key": r["key"], "population": pop, "scriptIdPart": r.get("scriptIdPart"), "rev": rev,
                     "sha256": sha256_text(text), "agreeCount": r.get("agreeCount"), "kind": r.get("kind"),
                     "pineVersion": pine_version(text), "inSample679": True,
                     **({"textChangedSince679": True} if changed else {})})
        local.append({**r, "path": os.path.abspath(path)})
    for sid, lg in sorted(log.items()):
        if lg.get("status") != "ok":
            continue
        c = catalog.get(sid) or {}
        key = "%s:%s" % (ECOSYSTEM, lg["slug"])
        path = os.path.join(cache, ECOSYSTEM, lg["slug"] + ".pine")
        text = read_text(path)
        if sha256_text(text) != lg["sha256"]:
            sys.exit("cache text of %s is not the text fetched (%s)" % (key, path))
        rows.append({"key": key, "population": ECOSYSTEM, "scriptIdPart": sid, "rev": lg["rev"],
                     "sha256": lg["sha256"], "agreeCount": c.get("agreeCount"), "kind": lg.get("kind"),
                     "pineVersion": lg.get("pineVersion") or pine_version(text), "inSample679": False})
        local.append({"key": key, "population": ECOSYSTEM, "slug": lg["slug"], "path": os.path.abspath(path),
                      "scriptIdPart": sid, "title": c.get("title"), "author": c.get("author"),
                      "agreeCount": c.get("agreeCount"), "kind": lg.get("kind"), "status": "ok"})
    keys = [r["key"] for r in rows]
    if len(set(keys)) != len(keys):
        sys.exit("duplicate keys in the population")
    rows.sort(key=lambda r: r["key"])
    exs = example_rows(a.ref, os.path.join(full, "examples"))
    counts = {}
    for r in rows:
        c = counts.setdefault(r["population"], {"scripts": 0, "byVersion": {}})
        c["scripts"] += 1
        vb = version_bucket(r["pineVersion"])
        c["byVersion"][vb] = c["byVersion"].get(vb, 0) + 1
    out = {
        "schema": POPULATION_SCHEMA,
        "generatedBy": "tools/pine_coverage/census_full.py population",
        "createdOn": a.created_on,
        "note": ("Identifiers only: no source text, title or author. A runner fetches each non-committed script "
                 "from TradingView's public pine-facade endpoint BY `rev` and refuses a text whose sha256 differs."),
        "catalogue": {"queries": len(load_json(os.path.join(cache, "queries_done.json"), [])),
                      "scripts": len(catalog),
                      "open": sum(1 for v in catalog.values() if v.get("access") == 1)},
        "counts": counts, "total": len(rows), "notMeasurable": dropped,
        "examples": [{"key": e["key"], "sha256": e["sha256"], "item": e["item"], "collection": e["collection"]}
                     for e in exs],
        "rows": rows,
    }
    write_json(a.out, out)
    write_json(os.path.join(full, "sample_manifest.json"), {"rows": sorted(local, key=lambda r: r["key"])})
    write_json(os.path.join(full, "examples.json"), exs)
    print("POPULATION %d scripts %s; %d examples; not measurable %d -> %s" % (
        len(rows), json.dumps({k: v["scripts"] for k, v in counts.items()}), len(exs), len(dropped), a.out))


def shard_of(rows, shard, of):
    """1-based shard `shard` of `of`: every `of`-th row of the key-sorted population (populations interleave)."""
    return [r for i, r in enumerate(sorted(rows, key=lambda r: r["key"])) if i % of == shard - 1]


# ── RUNNER: fetch a shard by pinned revision, verify, and lay it out for the census ───────────────────
def cmd_shard(a):
    pop = json.load(open(a.population, encoding="utf-8"))
    if pop.get("schema") != POPULATION_SCHEMA:
        sys.exit("not a population file: %s" % a.population)
    out = os.path.abspath(a.out)
    rows = shard_of(pop["rows"], a.shard, a.of)
    if a.limit:
        # a cost measurement: `limit` rows spread evenly over the shard (every population, not the first keys)
        rows = rows[::max(1, len(rows) // a.limit)][:a.limit]
    items, report = [], {"shard": a.shard, "of": a.of, "rows": len(rows), "ok": 0, "byPopulation": {},
                         "mismatch": [], "unavailable": [], "examples": None}
    t0 = time.time()
    for i, r in enumerate(rows, 1):
        slug = r["key"].split(":", 1)[1]
        if r["population"] == "committed":
            path = os.path.join(ROOT, "corpus", "committed", slug + ".pine")
            text = read_text(path) if os.path.exists(path) else None
            answer = "ok" if text is not None else "missing-in-repo"
        else:
            try:
                d, answer = facade(r["scriptIdPart"], r["rev"])
            except Exception as e:  # noqa: BLE001
                d, answer = None, "error:%s" % type(e).__name__
            text = d["source"] if d else None
            time.sleep(DELAY)
            path = os.path.join(out, "src", r["population"], slug + ".pine")
        if text is None:
            report["unavailable"].append({"key": r["key"], "answer": answer})
            continue
        if sha256_text(text) != r["sha256"]:
            report["mismatch"].append(r["key"])
            continue
        if r["population"] != "committed":
            write_text(path, text)
        items.append({"key": r["key"], "path": os.path.abspath(path), "cap": 8})
        report["ok"] += 1
        report["byPopulation"][r["population"]] = report["byPopulation"].get(r["population"], 0) + 1
        if i % 100 == 0:
            print("[%4d/%4d] ok=%d %.0fs" % (i, len(rows), report["ok"], time.time() - t0), flush=True)
    if a.examples_ref:
        report["examples"] = shard_examples(pop["examples"], a.examples_ref, os.path.join(out, "examples"), items)
    write_json(os.path.join(out, "items.json"), items)
    write_json(os.path.join(out, "fetch_report.json"), report)
    print("SHARD %d/%d: %d of %d rows ready (mismatch %d, unavailable %d), examples %s, %.0fs" % (
        a.shard, a.of, report["ok"], len(rows), len(report["mismatch"]), len(report["unavailable"]),
        json.dumps(report["examples"]), time.time() - t0))


def shard_examples(wanted, ref_path, out_dir, items):
    """TradingView's own reference examples, from a FRESH extract on the runner, kept only where the text's
    sha256 is one the population names, under the population's key (the census input's own shape)."""
    import run_census as rc
    try:
        fresh = rc.build_examples(ref_path, out_dir)
    except Exception as e:  # noqa: BLE001
        return {"wanted": len(wanted), "found": 0, "error": str(e)[:160]}
    by_sha = {}
    for e in fresh:
        by_sha.setdefault(sha256_text(read_text(e["path"])), e)
    found = 0
    for w in wanted:
        e = by_sha.get(w["sha256"])
        if e is None:
            continue
        items.append({"key": w["key"], "path": e["path"], "cap": 1, "item": w["item"], "collection": w["collection"]})
        found += 1
    return {"wanted": len(wanted), "found": found, "extracted": len(fresh)}


# ── RUNNER: one lane over the shard, with a stall watchdog ────────────────────────────────────────────
def _lane_pids(out_file):
    """Processes (Linux /proc) whose environment carries COVERAGE_OUT=<out_file>: the lane's vitest and its
    workers, and nothing else (the other lane runs with its own COVERAGE_OUT)."""
    want = ("COVERAGE_OUT=" + out_file).encode()
    pids = []
    for d in os.listdir("/proc"):
        if not d.isdigit() or int(d) == os.getpid():
            continue
        try:
            with open("/proc/%s/environ" % d, "rb") as f:
                if want in f.read().split(b"\0"):
                    pids.append(int(d))
        except OSError:
            continue
    return pids


def cmd_lane(a):
    """run_census.drive over the shard's items, unchanged (the coverage map's own loop: restarts past a process
    death, names the killer, proves the lane and the store). ⭐ A STALL WATCHDOG beside it: a script that never
    returns would hold the runner to its job timeout, so when no row lands for --stall-min minutes the lane's
    processes are killed and drive() records the script in current.txt as `killed`, exactly as it records an
    OOM death on the dev PC."""
    import signal
    import threading
    import run_census as rc
    items = json.load(open(a.items, encoding="utf-8"))
    if a.reverse:
        items = list(reversed(items))   # two lanes on one runner meet a heap-hungry script at different times
    cache = os.path.abspath(a.cache)
    out_file = os.path.join(cache, "census.jsonl")
    stop = threading.Event()
    kills = []

    def watchdog():
        last_size, last_change = -1, time.time()
        while not stop.wait(30):
            size = os.path.getsize(out_file) if os.path.exists(out_file) else 0
            if size != last_size:
                last_size, last_change = size, time.time()
                continue
            if time.time() - last_change > a.stall_min * 60 and sys.platform.startswith("linux"):
                cur = os.path.join(cache, "current.txt")
                who = read_text(cur).strip() if os.path.exists(cur) else ""
                pids = _lane_pids(out_file)
                for pid in pids:
                    try:
                        os.kill(pid, signal.SIGKILL)
                    except OSError:
                        pass
                kills.append({"script": who, "pids": len(pids)})
                print("WATCHDOG: no row for %d min, killed %d process(es) on %s" % (a.stall_min, len(pids), who),
                      flush=True)
                last_change = time.time()

    t = threading.Thread(target=watchdog, daemon=True)
    t.start()
    t0 = time.time()
    try:
        rows = rc.drive(items, cache, a.lane, max_restarts=a.max_restarts, library_store=a.library_store)
    finally:
        stop.set()
    write_json(os.path.join(cache, "watchdog.json"), kills)
    print("LANE %s: %d rows in %.0fs, watchdog kills %d" % (a.lane, rows, time.time() - t0, len(kills)))


# ── the sealed envelope (openssl on both ends) ────────────────────────────────────────────────────────
def _openssl(*args, **kw):
    subprocess.run(["openssl"] + list(args), check=True, **kw)


def cmd_seal(a):
    """tar.gz the named paths, encrypt under a random AES-256 key, wrap the key with the RSA public key
    (OAEP, SHA-256). Writes <out>.tgz.enc and <out>.key.enc; deletes every clear intermediate."""
    import tarfile
    base = os.path.abspath(a.out)
    tgz = base + ".tgz"
    os.makedirs(os.path.dirname(base), exist_ok=True)
    missing = [p for p in a.paths if not os.path.exists(p)]
    with tarfile.open(tgz, "w:gz") as tf:
        for p in a.paths:
            if os.path.exists(p):
                tf.add(p, arcname=os.path.relpath(os.path.abspath(p), os.path.abspath(a.root)).replace(os.sep, "/"))
    if missing:
        print("not sealed (absent): %s" % ", ".join(os.path.relpath(p, a.root) for p in missing))
    keyhex = base + ".key"
    with open(keyhex, "w") as f:
        f.write(os.urandom(32).hex())
    try:
        _openssl("enc", "-aes-256-cbc", "-pbkdf2", "-iter", "200000", "-salt", "-in", tgz, "-out", tgz + ".enc",
                 "-pass", "file:" + keyhex)
        _openssl("pkeyutl", "-encrypt", "-pubin", "-inkey", a.pubkey, "-pkeyopt", "rsa_padding_mode:oaep",
                 "-pkeyopt", "rsa_oaep_md:sha256", "-in", keyhex, "-out", base + ".key.enc")
    finally:
        for p in (tgz, keyhex):
            if os.path.exists(p):
                os.remove(p)
    print("SEALED %s.tgz.enc (%d bytes)" % (base, os.path.getsize(tgz + ".enc")))


def cmd_unseal(a):
    import tarfile
    base = os.path.abspath(a.sealed)
    keyhex = base + ".key"
    _openssl("pkeyutl", "-decrypt", "-inkey", a.privkey, "-pkeyopt", "rsa_padding_mode:oaep",
             "-pkeyopt", "rsa_oaep_md:sha256", "-in", base + ".key.enc", "-out", keyhex)
    try:
        _openssl("enc", "-d", "-aes-256-cbc", "-pbkdf2", "-iter", "200000", "-in", base + ".tgz.enc",
                 "-out", base + ".tgz", "-pass", "file:" + keyhex)
    finally:
        os.remove(keyhex)
    os.makedirs(a.out, exist_ok=True)
    with tarfile.open(base + ".tgz", "r:gz") as tf:
        for m in tf.getmembers():
            if m.name.startswith("/") or ".." in m.name.split("/") or not (m.isfile() or m.isdir()):
                sys.exit("refusing a member that leaves the output: %s" % m.name)
        tf.extractall(a.out)
    os.remove(base + ".tgz")
    print("UNSEALED -> %s" % a.out)


# ── operator: the unsealed shards -> one census cache per lane (paths are the LOCAL sources) ──────────
def cmd_assemble(a):
    """Concatenate the shards' rows of one lane into <out>/census.jsonl, and write the census_input.json,
    sample_manifest.json, lane.jsonl and library_store.json coverage_map.py reads, with every path pointing at
    the local source whose sha256 the population names. Refuses a missing shard, a duplicate key, a row
    whose lane is not the one asked for, or two shards measured with different library stores."""
    import run_census as rc
    pop = json.load(open(a.population, encoding="utf-8"))
    cache = os.path.abspath(a.cache)
    full = os.path.join(cache, "full")
    local = {r["key"]: r for r in json.load(open(os.path.join(full, "sample_manifest.json"), encoding="utf-8"))["rows"]}
    exs = {e["key"]: e for e in json.load(open(os.path.join(full, "examples.json"), encoding="utf-8"))}
    want = {r["key"]: r for r in pop["rows"]}
    sub = "prod" if a.lane == rc.LANE_PRODUCTION else "rt"
    out = os.path.abspath(a.out)
    os.makedirs(out, exist_ok=True)
    rows, inputs, lane_lines, stores, reports = {}, [], [], set(), []
    shard_dirs = sorted(d for d in os.listdir(a.shards) if os.path.isdir(os.path.join(a.shards, d)))
    if len(shard_dirs) != a.of:
        sys.exit("expected %d shard directories under %s, found %d" % (a.of, a.shards, len(shard_dirs)))
    for d in shard_dirs:
        sd = os.path.join(a.shards, d)
        lane_dir = os.path.join(sd, sub)
        stores.add(json.dumps(json.load(open(os.path.join(lane_dir, "library_store.json"), encoding="utf-8"))))
        lane_lines += [l for l in open(os.path.join(lane_dir, "lane.jsonl"), encoding="utf-8") if l.strip()]
        reports.append(json.load(open(os.path.join(sd, "fetch_report.json"), encoding="utf-8")))
        for l in open(os.path.join(lane_dir, "census.jsonl"), encoding="utf-8"):
            if not l.strip():
                continue
            r = json.loads(l)
            if r["key"] in rows:
                sys.exit("duplicate row %s (shard %s)" % (r["key"], d))
            if rc.row_lane(r) != a.lane and r.get("stuck") != "killed":
                sys.exit("row %s is lane %s, not %s" % (r["key"], rc.row_lane(r), a.lane))
            rows[r["key"]] = l if l.endswith("\n") else l + "\n"
    if len(stores) != 1:
        sys.exit("the shards were measured with different library stores")
    for key in sorted(rows):
        if key.startswith("example:"):
            e = exs.get(key)
            if e is None:
                sys.exit("example row %s is not in the local example set" % key)
            inputs.append({"key": key, "path": e["path"], "cap": 1, "item": e["item"], "collection": e["collection"]})
            continue
        if key not in want or key not in local:
            sys.exit("row %s is not in the population" % key)
        p = local[key]["path"]
        if sha256_text(read_text(p)) != want[key]["sha256"]:
            sys.exit("local text of %s is not the text the runner measured" % key)
        inputs.append({"key": key, "path": p, "cap": 8})
    with open(os.path.join(out, "census.jsonl"), "w", encoding="utf-8", newline="\n") as f:
        for key in sorted(rows):
            f.write(rows[key])
    with open(os.path.join(out, "lane.jsonl"), "w", encoding="utf-8", newline="\n") as f:
        f.writelines(l if l.endswith("\n") else l + "\n" for l in lane_lines)
    write_json(os.path.join(out, "census_input.json"), inputs)
    write_json(os.path.join(out, rc.LIBRARY_STORE_FILE), json.loads(stores.pop()))
    write_json(os.path.join(out, "sample_manifest.json"),
               {"rows": [local[k] for k in sorted(rows) if k in local]})
    write_json(os.path.join(out, "fetch_reports.json"), reports)
    missing = sorted(set(want) - set(rows))
    write_json(os.path.join(out, "unmeasured.json"), missing)
    n = rc.assert_lane_measured(out, a.lane)
    rc.assert_store_loaded(out, json.load(open(os.path.join(out, rc.LIBRARY_STORE_FILE), encoding="utf-8")))
    print("ASSEMBLED %s: %d rows (%d population scripts, %d examples), %d population scripts unmeasured -> %s" % (
        a.lane, n, sum(1 for k in rows if not k.startswith("example:")), sum(1 for k in rows if k.startswith("example:")),
        len(missing), out))


def main(argv=None):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:  # noqa: BLE001
        pass
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("enumerate")
    p.add_argument("--cache", required=True)
    p.set_defaults(fn=cmd_enumerate)
    p = sub.add_parser("fetch")
    p.add_argument("--cache", required=True)
    p.add_argument("--sample", required=True, help="the 679 sample cache (its scripts are not fetched again)")
    p.add_argument("--limit", type=int, default=None)
    p.set_defaults(fn=cmd_fetch)
    p = sub.add_parser("pin")
    p.add_argument("--cache", required=True)
    p.add_argument("--sample", required=True)
    p.set_defaults(fn=cmd_pin)
    p = sub.add_parser("population")
    p.add_argument("--cache", required=True)
    p.add_argument("--sample", required=True)
    p.add_argument("--ref", required=True, help="the reference whose examples the 679 census used (ref_rebuilt.json)")
    p.add_argument("--out", required=True, help="the committed population file (identifiers only)")
    p.add_argument("--created-on", required=True)
    p.set_defaults(fn=cmd_population)
    p = sub.add_parser("shard")
    p.add_argument("--population", required=True)
    p.add_argument("--shard", type=int, required=True)
    p.add_argument("--of", type=int, required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--examples-ref", default=None, help="a fresh reference extract: this shard also runs the examples")
    p.add_argument("--limit", type=int, default=0, help="measure only this many rows, spread over the shard")
    p.set_defaults(fn=cmd_shard)
    p = sub.add_parser("lane")
    p.add_argument("--items", required=True)
    p.add_argument("--cache", required=True)
    p.add_argument("--lane", required=True, choices=("production", "runtime-on"))
    p.add_argument("--library-store", default=None)
    p.add_argument("--reverse", action="store_true")
    p.add_argument("--stall-min", type=float, default=15.0)
    p.add_argument("--max-restarts", type=int, default=60)
    p.set_defaults(fn=cmd_lane)
    p = sub.add_parser("seal")
    p.add_argument("--pubkey", required=True)
    p.add_argument("--root", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("paths", nargs="+")
    p.set_defaults(fn=cmd_seal)
    p = sub.add_parser("unseal")
    p.add_argument("--privkey", required=True)
    p.add_argument("--sealed", required=True, help="the base path: <base>.tgz.enc and <base>.key.enc")
    p.add_argument("--out", required=True)
    p.set_defaults(fn=cmd_unseal)
    p = sub.add_parser("assemble")
    p.add_argument("--population", required=True)
    p.add_argument("--cache", required=True)
    p.add_argument("--shards", required=True, help="one unsealed directory per shard")
    p.add_argument("--of", type=int, required=True)
    p.add_argument("--lane", required=True, choices=("production", "runtime-on"))
    p.add_argument("--out", required=True)
    p.set_defaults(fn=cmd_assemble)
    a = ap.parse_args(argv)
    for k in ("cache", "out"):
        v = getattr(a, k, None)
        if v and os.path.abspath(v).lower().replace("/", "\\").startswith("c:\\data"):
            sys.exit("refusing to write under C:\\data")
    return a.fn(a)


if __name__ == "__main__":
    main()
