"""Exchange Breadth V1 — evidence acquisition 1/2: the provider's DATED venue lists, every session.

For each session D and each venue V in VENUES, `/v3/reference/tickers?exchange=V&date=D&active=true`
returns every security the provider considers listed on V as of D. Stored verbatim-minimal as
`<OUT>/dated/<D>.json.gz` = {venue: [[ticker, type, cik, composite_figi, share_class_figi], ...]}.

⭐ DENSE, NOT SAMPLED. One file per session, so the venue ledger never has to infer a transfer
date from a sparse snapshot.
⭐ RESUMABLE + SINGLETON. A date whose file exists is skipped; files are written atomically
(tmp + rename); an flock on <OUT>/acquire_dated.lock admits one runner. Safe to kill and rerun.
⛔ READ-ONLY toward the provider and toward every production store. Writes only under <OUT>.

Usage (on the runner, detached):  python acquire_dated_venues.py <OUT> <sessions.txt> [workers]
"""
from __future__ import annotations

import fcntl
import gzip
import json
import os
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor

VENUES = ("XNYS", "XNAS", "XASE", "ARCX", "BATS", "IEXG")
BASE = "https://api.massive.com/v3/reference/tickers"


def _key() -> str:
    k = os.environ.get("MASSIVE_API_KEY")
    if k:
        return k
    env = dict(l.split("=", 1) for l in open("/proc/1/environ").read().split("\0") if "=" in l)
    return env["MASSIVE_API_KEY"]


def _get(url: str, tries: int = 6) -> dict:
    err = None
    for i in range(tries):
        try:
            with urllib.request.urlopen(url, timeout=90) as r:
                return json.loads(r.read())
        except Exception as e:                       # noqa: BLE001 — retried, then raised
            err = e
            time.sleep(min(60, 2 ** i))
    raise RuntimeError(f"fetch failed after {tries}: {err}")


def fetch_day(d: str, key: str) -> dict:
    out = {}
    for v in VENUES:
        rows, url = [], f"{BASE}?market=stocks&exchange={v}&date={d}&active=true&limit=1000&apiKey={key}"
        while url:
            j = _get(url)
            for r in j.get("results") or []:
                rows.append([r.get("ticker"), r.get("type"), r.get("cik"),
                             r.get("composite_figi"), r.get("share_class_figi")])
            nxt = j.get("next_url")
            url = f"{nxt}&apiKey={key}" if nxt else None
        out[v] = rows
    return out


def main(out_dir: str, sessions_path: str, workers: int = 4) -> None:
    os.makedirs(os.path.join(out_dir, "dated"), exist_ok=True)
    lock = open(os.path.join(out_dir, "acquire_dated.lock"), "w")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        print("another acquire_dated runner holds the lock — exiting", flush=True)
        return
    key = _key()
    sessions = [s.strip() for s in open(sessions_path) if s.strip()]
    todo = [d for d in sessions if not os.path.exists(os.path.join(out_dir, "dated", f"{d}.json.gz"))]
    print(time.strftime("%H:%M:%S"), f"sessions={len(sessions)} todo={len(todo)} workers={workers}", flush=True)

    def one(d: str):
        data = fetch_day(d, key)
        path = os.path.join(out_dir, "dated", f"{d}.json.gz")
        tmp = path + ".tmp"
        with gzip.open(tmp, "wt") as fh:
            json.dump(data, fh, separators=(",", ":"))
        os.replace(tmp, path)
        return d, {v: len(r) for v, r in data.items()}

    done = 0
    t0 = time.time()
    with ThreadPoolExecutor(max_workers=workers) as ex:
        for d, counts in ex.map(one, todo):
            done += 1
            if done % 50 == 0 or done == len(todo):
                rate = done / max(1e-9, time.time() - t0)
                print(time.strftime("%H:%M:%S"), f"{done}/{len(todo)} last={d} {counts} "
                      f"eta={(len(todo) - done) / max(rate, 1e-9) / 60:.0f}min", flush=True)
    print(time.strftime("%H:%M:%S"), "DONE", flush=True)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else 4)
