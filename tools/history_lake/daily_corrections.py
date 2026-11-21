"""Build, publish and verify the daily corrections ledger (price-data unit; owner decisions D1-D6, 2026-11-20).

Rules: tools/history_lake/corrections_rules.py (pure). Applier: api/services/bars_corrections.py.
The ledger holds vendor prices: it is written ONLY under --out (a private disk, D:/uct-price-data), never the repo.

  candidates  python tools/history_lake/daily_corrections.py candidates --out D:/uct-price-data/u3
  minutes     python tools/history_lake/daily_corrections.py minutes    --out D:/uct-price-data/u3
  build       python tools/history_lake/daily_corrections.py build      --out D:/uct-price-data/u3
  publish     python tools/history_lake/daily_corrections.py publish    --out D:/uct-price-data/u3 --version 1 --stage SPY
  capture     python tools/history_lake/daily_corrections.py capture    --dir D:/uct-price-data/u3/prod/before --symbols SPY
  verify      python tools/history_lake/daily_corrections.py verify     --out D:/uct-price-data/u3 --before .../before --after .../after

Inputs (read-only copies): --store (a bars.db snapshot, opened mode=ro), --joined + --serve-list (the rebuild),
--yahoo (parquet: sym, d, o, h, l, c, v; yfinance auto_adjust=False), the vendor's minute and raw day files (--raw-root).
Publishing: DATA_SYNC_* in the environment; payloads first, the manifest LAST; versions only rise; the manifest's
`retired` carries every symbol an earlier version corrected, so its epoch keeps rising after a revert.
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import glob
import gzip
import json
import os
import re
import sqlite3
import subprocess
import sys
import time
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from tools.history_lake import corrections_rules as CR  # noqa: E402

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36"
HOST = "https://uctintelligence.com"


# ── inputs ─────────────────────────────────────────────────────────────────────────────────────────────────
def yahoo_iter(dirs, only=None):
    """(sym, {iso: (o, h, l, c, v)}) per symbol; a later directory's copy of a symbol replaces an earlier one."""
    import pandas as pd
    latest = {}
    for d in dirs:
        for p in sorted(glob.glob(os.path.join(d, "*.parquet"))):
            for s in pd.read_parquet(p, columns=["sym"])["sym"].unique():
                if not only or s in only:
                    latest[s] = p
    by_file = defaultdict(list)
    for s, p in latest.items():
        by_file[p].append(s)
    for p, syms in by_file.items():
        df = pd.read_parquet(p)
        for sym, g in df[df.sym.isin(syms)].groupby("sym", sort=False):
            yield sym, {d: (o, h, l, c, v) for d, o, h, l, c, v in zip(g.d, g.o, g.h, g.l, g.c, g.v)}


class Store:
    """A bars.db snapshot copy, read-only."""

    def __init__(self, path):
        self.con = sqlite3.connect(f"file:{path}?mode=ro&immutable=1", uri=True)

    def rows(self, sym, tf):
        from api.services import date_bar_keys as dk
        out = []
        for ts, o, h, l, c, v in self.con.execute("SELECT ts,o,h,l,c,v FROM ohlcv WHERE ticker=? AND tf=? ORDER BY ts", (sym, tf)):
            s = str(ts)
            if len(s) != 8 or None in (o, h, l, c) or min(o, h, l, c) <= 0:
                continue
            if tf in ("D", "W") and not dk.key_ok(tf, ts):
                continue
            out.append([f"{s[:4]}-{s[4:6]}-{s[6:]}", float(o), float(h), float(l), float(c), float(v or 0)])
        return out


def load_rebuild(joined, sym):
    try:
        return json.loads((Path(joined) / f"{sym}.json").read_text(encoding="utf-8"))
    except OSError:
        return None


def _write_jsonl(path, it):
    tmp = str(path) + ".tmp"
    n = 0
    with open(tmp, "w", encoding="utf-8") as fh:
        for r in it:
            fh.write(json.dumps(r, separators=(",", ":"), default=float) + "\n")
            n += 1
    os.replace(tmp, path)
    return n


def _each_ticker(a, minutes=None, raw=None):
    serve = set(json.load(open(a.serve_list)))
    manifest_end = a.end
    store = Store(a.store)
    only = set(a.only.split(",")) if a.only else None
    for sym, yf in yahoo_iter(a.yahoo, only):
        rec = load_rebuild(a.joined, sym)
        served = sym in serve and rec is not None
        st = {tf: store.rows(sym, tf) for tf in ("D", "W", "M")}
        yield sym, CR.build_ticker(sym, served=served, rec=rec, end=manifest_end, store=st, yf=yf, minutes=minutes, raw=raw)


# ── the vendor's minute and raw day files ─────────────────────────────────────────────────────────────────
def _minute_day(arg):
    root, d, syms, gzip_bin, grep_bin = arg
    p = os.path.join(root, "raw", d[:4], f"{d}.csv.gz")
    if not os.path.exists(p):
        return d, {}
    pat = "^(" + "|".join(re.escape(s) for s in sorted(syms)) + "),"
    z = subprocess.Popen([gzip_bin, "-dc", p], stdout=subprocess.PIPE)
    g = subprocess.Popen([grep_bin, "-E", pat], stdin=z.stdout, stdout=subprocess.PIPE)
    z.stdout.close()
    data, _ = g.communicate()
    z.wait()
    return d, minute_stats(data.decode().splitlines(), syms)


def minute_stats(lines, syms):
    """Per symbol: the extreme minutes (all and regular hours), their bodies, the next extremes, the last
    regular-hours close. `lines`: the vendor's minute CSV rows (ticker,volume,open,close,high,low,window_start,...)."""
    from zoneinfo import ZoneInfo
    et = ZoneInfo("America/New_York")
    rows = defaultdict(list)
    for line in lines:
        r = line.split(",")
        if r[0] not in syms:
            continue
        hm = dt.datetime.fromtimestamp(int(r[6]) // 10**9, et).strftime("%H:%M")
        rows[r[0]].append((hm, float(r[2]), float(r[4]), float(r[5]), float(r[3])))
    out = {}
    for s in syms:
        m = sorted(rows.get(s, ()))
        if not m:
            out[s] = {"n": 0}
            continue
        rth = [x for x in m if "09:30" <= x[0] < "16:00"]
        rec = {"n": len(m)}
        for pre, xs in (("", m), ("rth_", rth)):
            if not xs:
                continue
            lo, hi = sorted(xs, key=lambda x: x[3]), sorted(xs, key=lambda x: -x[2])
            rec.update({pre + "low": lo[0][3], pre + "low_at": lo[0][0], pre + "low_bar": list(lo[0][1:5]),
                        pre + "low2": lo[1][3] if len(lo) > 1 else None,
                        pre + "high": hi[0][2], pre + "high_at": hi[0][0], pre + "high_bar": list(hi[0][1:5]),
                        pre + "high2": hi[1][2] if len(hi) > 1 else None})
        rec["rth_close"] = rth[-1][4] if rth else None
        rec["rth_close_at"] = rth[-1][0] if rth else None
        out[s] = rec
    return out


def read_raw_days(root, by_day):
    res = {}
    for d, syms in sorted(by_day.items()):
        p = os.path.join(root, "raw_day", d[:4], f"{d}.csv.gz")
        if not os.path.exists(p):
            continue
        with gzip.open(p, "rt", newline="") as fh:
            rd = csv.reader(fh)
            ix = {n: i for i, n in enumerate(next(rd))}
            for r in rd:
                if r[ix["ticker"]] in syms:
                    res[f"{r[ix['ticker']]}|{d}"] = [float(r[ix[c]]) for c in ("open", "high", "low", "close", "volume")]
    return res


# ── commands ──────────────────────────────────────────────────────────────────────────────────────────────
def cmd_candidates(a):
    pairs = set()
    for _sym, (_rows, _entries, _s, cands) in _each_ticker(a):
        pairs.update(cands)
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    json.dump(sorted(pairs), open(out / "pairs.json", "w"))
    print("pairs", len(pairs))


def cmd_minutes(a):
    from multiprocessing import Pool
    out = Path(a.out)
    pairs = json.load(open(out / "pairs.json"))
    by_day = defaultdict(set)
    for s, d in pairs:
        by_day[d].add(s)
    mp = out / "minutes.json"
    res = json.load(open(mp)) if mp.exists() else {}
    todo = [(a.raw_root, d, sorted(s), a.gzip, a.grep) for d, s in sorted(by_day.items()) if any(f"{x}|{d}" not in res for x in s)]
    with Pool(a.workers) as pool:
        for d, o in pool.imap_unordered(_minute_day, todo, chunksize=4):
            for s, v in o.items():
                res[f"{s}|{d}"] = v
    _atomic_json(mp, res)
    _atomic_json(out / "rawday.json", read_raw_days(a.raw_root, by_day))
    print("minutes", len(res))


def _atomic_json(path, obj):
    tmp = str(path) + ".tmp"
    with open(tmp, "w") as fh:
        json.dump(obj, fh)
    os.replace(tmp, path)


def cmd_build(a):
    out = Path(a.out)
    minutes = json.load(open(out / "minutes.json"))
    raw = json.load(open(out / "rawday.json"))
    ent_dir = out / "entries"
    ent_dir.mkdir(parents=True, exist_ok=True)
    stats = defaultdict(Counter)
    tmp = out / "ledger.jsonl.tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        for sym, (rows, entries, S, _c) in _each_ticker(a, minutes, raw):
            stats["all"].update(S)
            for r in rows:
                fh.write(json.dumps(r, separators=(",", ":"), default=float) + "\n")
            if entries:
                _atomic_json(ent_dir / f"{sym}.json", entries)
            elif (ent_dir / f"{sym}.json").exists():
                (ent_dir / f"{sym}.json").unlink()
    os.replace(tmp, out / "ledger.jsonl")
    json.dump({k: dict(sorted(v.items())) for k, v in stats.items()}, open(out / "stats.json", "w"), indent=1)
    print(json.dumps(stats["all"], indent=1))


def entries_hash(entries) -> str:
    """The content a ticker's payload carries, independent of the version it is published at."""
    import hashlib
    return hashlib.sha256(json.dumps(entries, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()


def plan_manifest(prev: dict | None, version: int, symbols, stage: str, hashes: dict | None = None) -> dict:
    """The manifest a publish writes. Versions only rise; `retired` = every symbol an earlier version listed or retired
    that this one does not list. `revs` (U5): per ticker, the version at which IT last changed: a listed ticker whose
    content hash equals the previous manifest's keeps its rev; new, re-listed, changed and newly retired tickers get
    `version`. Derived, never typed."""
    prev = prev or {}
    hashes = {str(k).upper(): v for k, v in (hashes or {}).items()}
    pv = int(prev.get("version") or 0)
    if version <= pv:
        raise SystemExit(f"refused: version {version} is not above the published v{pv} (versions only rise)")
    syms = sorted({str(s).upper() for s in symbols})
    p_syms = {str(s).upper() for s in (prev.get("symbols") or ())}
    p_ret = {str(s).upper() for s in (prev.get("retired") or ())}
    p_revs = {str(k).upper(): int(v) for k, v in (prev.get("revs") or {}).items()}
    p_hash = {str(k).upper(): v for k, v in (prev.get("hashes") or {}).items()}
    retired = sorted((p_syms | p_ret) - set(syms))
    revs = {}
    for s in syms:
        same = s in p_syms and hashes.get(s) is not None and hashes.get(s) == p_hash.get(s)
        revs[s] = int(p_revs.get(s) or pv) if same else version
    for s in retired:
        revs[s] = int(p_revs.get(s) or pv) if s in p_ret else version
    return {"version": version, "built_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "stage": stage,
            "symbols": syms, "retired": retired, "revs": revs, "hashes": {s: hashes[s] for s in syms if s in hashes}}


def cmd_publish(a, client=None, bucket=None):
    from api.services import bars_corrections as K
    out = Path(a.out)
    have = {p.stem for p in (out / "entries").glob("*.json")}
    if a.stage == "none":
        names = set()                                     # the revert drill: every earlier symbol retires
    else:
        names = have if a.stage == "all" else {s for s in a.stage.split(",") if s} & have
        if not names:
            raise SystemExit(f"nothing to publish: {a.stage} has no entries")
    if client is None:
        from tools.history_lake.publish import s3_client_from_env
        client, bucket = s3_client_from_env(), os.environ["DATA_SYNC_BUCKET"]
    try:
        prev = json.loads(client.get_object(Bucket=bucket, Key=K.MANIFEST_KEY)["Body"].read())
    except Exception as e:  # noqa: BLE001
        if "NoSuchKey" not in type(e).__name__ and "NoSuchKey" not in str(e) and "Not Found" not in str(e) and "404" not in str(e):
            raise
        prev = None
    ents = {s: json.load(open(out / "entries" / f"{s}.json")) for s in sorted(names)}
    m = plan_manifest(prev, a.version, names, a.stage, {s: entries_hash(e) for s, e in ents.items()})
    rec_dir = out / "published" / f"v{a.version}"
    rec_dir.mkdir(parents=True, exist_ok=True)
    for s in sorted(names):
        if m["revs"][s] != a.version:
            continue                                       # unchanged: its payload is already at v<rev>
        body = K.encode_payload(s, a.version, ents[s])
        K.decode_payload(body)
        if not a.dry:
            client.put_object(Bucket=bucket, Key=f"{K.PREFIX}v{a.version}/{s}.json.gz", Body=body, ContentType="application/json")
        (rec_dir / f"{s}.json.gz").write_bytes(body)
    body = json.dumps(m).encode("utf-8")
    if not a.dry:
        client.put_object(Bucket=bucket, Key=K.MANIFEST_KEY, Body=body, ContentType="application/json", CacheControl="no-store")
    (rec_dir / "manifest.json").write_bytes(body)
    print("manifest", {k: (v if k not in ("symbols", "retired") else len(v)) for k, v in m.items()}, "dry" if a.dry else "PUBLISHED")
    return m


def fetch(sym, tf, nbars):
    import urllib.error
    import urllib.request
    backoff = 60
    for _ in range(5):
        req = urllib.request.Request(f"{HOST}/api/bars/{sym}?tf={tf}&bars={nbars}", headers={"User-Agent": UA, "Accept-Encoding": "gzip"})
        try:
            with urllib.request.urlopen(req, timeout=90) as r:
                raw = r.read()
                if r.headers.get("Content-Encoding") == "gzip":
                    raw = gzip.decompress(raw)
                return json.loads(raw)
        except urllib.error.HTTPError as e:
            if e.code in (429, 503):
                time.sleep(backoff)
                backoff = min(backoff * 2, 900)
                continue
            raise
    raise RuntimeError(f"{sym} {tf}: refused five times")


def _yahoo_frames(syms, backoff=60.0, sleep=3.0, chunk=40, max_refusals=5):
    """{sym: DataFrame} from yfinance (period=max, auto_adjust=False: split-adjusted, the app's basis). Polite: 40 per
    call, 3 s between calls, 60 s doubling to 900 s on a 429 (the production breaker's numbers), stops after 5 refusals."""
    import yfinance as yf
    try:
        from yfinance.exceptions import YFRateLimitError
    except Exception:  # noqa: BLE001
        YFRateLimitError = Exception
    out, refusals, wait = {}, 0, backoff
    syms = sorted(set(syms))
    k = 0
    while k < len(syms):
        part = syms[k:k + chunk]
        try:
            data = yf.download(part, period="max", auto_adjust=False, actions=False, group_by="ticker", progress=False,
                               threads=True)
        except YFRateLimitError:
            refusals += 1
            if refusals >= max_refusals:
                raise SystemExit(f"Yahoo refused {refusals} times in a row; stopping at {part[0]}")
            time.sleep(wait)
            wait = min(wait * 2, 900.0)
            continue
        refusals, wait = 0, backoff
        for s in part:
            try:
                df = (data[s] if len(part) > 1 else data).dropna(subset=["Close"])
            except Exception:  # noqa: BLE001
                continue
            if len(df):
                out[s] = df
        k += chunk
        time.sleep(sleep)
    return out


def cmd_yahoo(a):
    """Re-fetch Yahoo for the symbols in --symbols-file under their own symbol AND every earlier vendor symbol of their
    lineage (the rebuild's segments), merged per date (the current symbol wins). Writes one parquet under --dir."""
    import pandas as pd
    syms = [x.strip() for x in open(a.symbols_file) if x.strip()]
    alt = {}
    for s in syms:
        rec = load_rebuild(a.joined, s)
        alt[s] = [seg["sym"].replace(".", "-") for seg in (rec or {}).get("segments") or ()]
    frames = _yahoo_frames(set(syms) | {x for v in alt.values() for x in v})
    rows = []
    for s in syms:
        got = {}
        for src in [s] + alt[s]:
            df = frames.get(src)
            if df is None:
                continue
            for i, r in df.iterrows():
                d = str(i)[:10]
                if d not in got:
                    got[d] = (src, float(r["Open"]), float(r["High"]), float(r["Low"]), float(r["Close"]), float(r["Volume"] or 0))
        rows += [(s, d, *v) for d, v in got.items()]
    df = pd.DataFrame(rows, columns=["sym", "d", "yahoo_sym", "o", "h", "l", "c", "v"])
    Path(a.dir).mkdir(parents=True, exist_ok=True)
    df.to_parquet(Path(a.dir) / "refetch.parquet.tmp", index=False)
    os.replace(Path(a.dir) / "refetch.parquet.tmp", Path(a.dir) / "refetch.parquet")
    print("refetched", df.sym.nunique(), "symbols", len(df), "rows; via an earlier symbol:", int((df.sym != df.yahoo_sym).sum()))


def cmd_capture(a):
    d = Path(a.dir)
    d.mkdir(parents=True, exist_ok=True)
    for sym in a.symbols.split(","):
        for tf, n in (("D", 12500), ("W", 5000), ("M", 2000)):
            doc = fetch(sym, tf, n)
            _atomic_json(d / f"{sym}_{tf}.json", doc)
            print(sym, tf, len(doc.get("bars") or []), "history_rev", doc.get("history_rev"), flush=True)
            time.sleep(2.5)


def diff_served(before: list, after: list, tol=1e-4):
    """{date: (before_ohlc|None, after_ohlc|None)} for every bar that differs between two answers."""
    b = {str(x["t"])[:10]: [x["o"], x["h"], x["l"], x["c"]] for x in before}
    a = {str(x["t"])[:10]: [x["o"], x["h"], x["l"], x["c"]] for x in after}
    out = {}
    for d in sorted(set(b) | set(a)):
        x, y = b.get(d), a.get(d)
        if x is None or y is None or any(abs(x[q] - y[q]) > tol * max(1.0, abs(x[q])) for q in range(4)):
            out[d] = (x, y)
    return out


def cmd_verify(a):
    out = Path(a.out)
    want = defaultdict(dict)       # (sym, tf) -> {date: row}
    syms = set(a.symbols.split(","))
    for line in open(out / "ledger.jsonl", encoding="utf-8"):
        r = json.loads(line)
        if r.get("sym") in syms and r.get("op") in ("set", "drop", "keep_wick", "derived_at_serve"):
            want[(r["sym"], r["tf"])][r["d"]] = r
    report = {}
    for sym in sorted(syms):
        for tf in ("D", "W", "M"):
            bf = json.load(open(Path(a.before) / f"{sym}_{tf}.json"))
            af = json.load(open(Path(a.after) / f"{sym}_{tf}.json"))
            dif = diff_served(bf.get("bars") or [], af.get("bars") or [])
            w = want.get((sym, tf), {})
            last = max((str(x["t"])[:10] for x in af.get("bars") or []), default="")
            extra = {d: v for d, v in dif.items() if d not in w and d != last}       # the developing bar moves on its own
            report[f"{sym}_{tf}"] = {"changed": len(dif), "ledger_rows": len(w), "changed_not_in_ledger": len(extra),
                                     "extra_sample": dict(list(extra.items())[:5]),
                                     "history_rev": [bf.get("history_rev"), af.get("history_rev")]}
    print(json.dumps(report, indent=1, default=str))
    return report


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=("candidates", "minutes", "build", "publish", "capture", "verify", "yahoo"))
    ap.add_argument("--out", default="D:/uct-price-data/u3")
    ap.add_argument("--store", default="D:/uct-price-data/snapshot/x/bars.db")
    ap.add_argument("--joined", default="D:/uct-history/daily-v1/joined")
    ap.add_argument("--serve-list", default="D:/uct-history/daily-v1/serve_list.json")
    ap.add_argument("--end", default="2026-11-17", help="the rebuild manifest's end")
    ap.add_argument("--yahoo", nargs="+", default=["D:/uct-price-data/inputs/data-audit-2026-11-20/yf"])
    ap.add_argument("--raw-root", default="D:/uct-history")
    ap.add_argument("--gzip", default=r"C:\Program Files\Git\usr\bin\gzip.exe")
    ap.add_argument("--grep", default=r"C:\Program Files\Git\usr\bin\grep.exe")
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--only", default="")
    ap.add_argument("--version", type=int, default=0)
    ap.add_argument("--stage", default="")
    ap.add_argument("--dry", action="store_true")
    ap.add_argument("--dir", default="")
    ap.add_argument("--symbols", default="")
    ap.add_argument("--before", default="")
    ap.add_argument("--after", default="")
    ap.add_argument("--symbols-file", default="")
    a = ap.parse_args(argv)
    {"candidates": cmd_candidates, "minutes": cmd_minutes, "build": cmd_build, "publish": cmd_publish,
     "capture": cmd_capture, "verify": cmd_verify, "yahoo": cmd_yahoo}[a.cmd](a)


if __name__ == "__main__":
    main()
