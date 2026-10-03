"""Exchange Breadth V1 — evidence acquisition 2/2 (SIP tape) + the ledger build.

1. STATES     for every identity in population.json, its dated state on every member session
              (from <OUT>/dated/<D>.json.gz), run-length encoded into STRETCHES.
2. PROBES     tape at BOTH ENDS of every stretch (stepping inward up to STEP sessions when a
              session printed no trade), then BISECTION inside any stretch whose end probes
              disagree on tape class. Append-only, checkpointed: <OUT>/tape_probes.jsonl.
3. LEDGER     breadth_venue_ledger.segment per identity → <OUT>/venue_ledger.json (+ sha256).

⛔ Reads the provider and <OUT>; writes only <OUT>. Restart-safe (probes are never re-asked).
Usage: python acquire_tape_and_build.py <OUT> [workers]
"""
from __future__ import annotations

try:
    import fcntl
except ImportError:          # local dry runs only
    fcntl = None
import gzip
import json
import os
import sys
import threading
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import breadth_venue_ledger as vl  # noqa: E402  (copied beside this script, byte-identical)

STEP = 5


def _key():
    k = os.environ.get("MASSIVE_API_KEY")
    if k:
        return k
    env = dict(l.split("=", 1) for l in open("/proc/1/environ").read().split("\0") if "=" in l)
    return env["MASSIVE_API_KEY"]


KEY = None


def tape(ticker: str, d: str):
    global KEY
    KEY = KEY or _key()
    nxt = (date.fromisoformat(d) + timedelta(days=1)).isoformat()
    url = (f"https://api.massive.com/v3/trades/{ticker}?timestamp.gte={d}&timestamp.lt={nxt}"
           f"&limit=1&apiKey={KEY}")
    for i in range(6):
        try:
            with urllib.request.urlopen(url, timeout=60) as r:
                rs = json.loads(r.read()).get("results") or []
            return rs[0].get("tape") if rs else None
        except urllib.error.HTTPError as e:
            if e.code in (400, 404):
                return None
            time.sleep(min(60, 2 ** i))
        except Exception:                               # noqa: BLE001
            time.sleep(min(60, 2 ** i))
    raise RuntimeError(f"tape fetch failed {ticker} {d}")


def load_states(out, pop):
    sessions = pop["sessions"]
    members_by_day = [[] for _ in sessions]
    for ident, e in pop["identities"].items():
        for a, b in e["runs"]:
            for i in range(a, b + 1):
                members_by_day[i].append(ident)
    states = {ident: [] for ident in pop["identities"]}      # [(idx, state)]
    for i, d in enumerate(sessions):
        with gzip.open(os.path.join(out, "dated", f"{d}.json.gz"), "rt") as fh:
            dated = json.load(fh)
        venues: dict = {}
        for mic, rows in dated.items():
            for r in rows:
                venues.setdefault(r[0], set()).add(mic)
        for ident in members_by_day[i]:
            t = pop["identities"][ident]["ticker"]
            states[ident].append((i, vl.dated_class(venues.get(t, ()))))
        if i % 500 == 0:
            print(time.strftime("%H:%M:%S"), "states", d, flush=True)
    return states


def main(out, workers=8):
    lock = open(os.path.join(out, "acquire_tape.lock"), "w")
    try:
        if fcntl:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        print("another tape runner holds the lock — exiting", flush=True)
        return
    pop = json.load(open(os.path.join(out, "population.json")))
    sessions = pop["sessions"]
    missing = [d for d in sessions if not os.path.exists(os.path.join(out, "dated", f"{d}.json.gz"))]
    if missing:
        raise SystemExit(f"dated evidence incomplete: {len(missing)} sessions missing (first {missing[0]})")
    states = load_states(out, pop)

    probes_path = os.path.join(out, "tape_probes.jsonl")
    probes: dict = {}
    if os.path.exists(probes_path):
        for line in open(probes_path):
            p = json.loads(line)
            probes[(p[0], p[1])] = p[3]
    plock = threading.Lock()
    pf = open(probes_path, "a")

    def probe(ident, idx):
        k = (ident, idx)
        if k in probes:
            return probes[k]
        t = pop["identities"][ident]["ticker"]
        v = tape(t, sessions[idx])
        with plock:
            probes[k] = v
            pf.write(json.dumps([ident, idx, sessions[idx], v]) + "\n")
            pf.flush()
        return v

    # stretches in GLOBAL session-index space (a gap in membership also ends a stretch)
    def stretches_of(ident):
        seq = states[ident]
        out_ = []
        a = 0
        for j in range(1, len(seq) + 1):
            # ⭐ a membership GAP (no print that session) is not a venue change: only the dated
            # state splits a stretch, so a thinly traded name does not cost two probes per print
            if j == len(seq) or seq[j][1] != seq[a][1]:
                out_.append((seq[a][0], seq[j - 1][0], seq[a][1]))
                a = j
        return out_

    all_str = {ident: stretches_of(ident) for ident in states}
    n_str = sum(len(v) for v in all_str.values())
    print(time.strftime("%H:%M:%S"), f"identities={len(all_str)} stretches={n_str} cached_probes={len(probes)}", flush=True)

    def ends(ident, a, b):
        """First / last session in [a,b] that printed a trade (None if none within STEP)."""
        lo = hi = None
        for i in range(a, min(b, a + STEP) + 1):
            v = probe(ident, i)
            if v is not None:
                lo = i
                break
        for i in range(b, max(a, b - STEP) - 1, -1):
            v = probe(ident, i)
            if v is not None:
                hi = i
                break
        return lo, hi

    def bisect(ident, lo, hi):
        """Probe until the tape class change inside (lo, hi] is pinned to adjacent probed sessions."""
        cl = vl.tape_class(probes[(ident, lo)])
        while hi - lo > 1:
            m = (lo + hi) // 2
            v = probe(ident, m)
            j = m
            while v is None and j < hi - 1:          # no print: step forward to the next print
                j += 1
                v = probe(ident, j)
            if v is None:
                return
            if vl.tape_class(v) == cl:
                lo = j
            else:
                hi = j

    member_set = {ident: {i for i, _ in states[ident]} for ident in states}

    def work(ident):
        """Ends of every stretch, then bisect EVERY adjacent pair of probed prints whose tape
        class differs (interior probes from an earlier leg included), so each flip is pinned to
        adjacent probed member sessions."""
        for a, b, _st in all_str[ident]:
            ends(ident, a, b)
            for _ in range(64):
                pr = sorted(i for i in range(a, b + 1)
                            if i in member_set[ident] and probes.get((ident, i)) is not None)
                todo = [(x, y) for x, y in zip(pr, pr[1:])
                        if vl.tape_class(probes[(ident, x)]) != vl.tape_class(probes[(ident, y)])
                        and any(x < m < y for m in range(x + 1, y) if m in member_set[ident])]
                if not todo:
                    break
                for x, y in todo:
                    bisect(ident, x, y)
        return ident

    t0 = time.time()
    idents = sorted(all_str)
    with ThreadPoolExecutor(max_workers=workers) as ex:
        for n, _ in enumerate(ex.map(work, idents), 1):
            if n % 1000 == 0:
                print(time.strftime("%H:%M:%S"), f"{n}/{len(idents)} probes={len(probes)} "
                      f"{(time.time() - t0) / n * (len(idents) - n) / 60:.0f}min left", flush=True)
    pf.close()

    rows = []
    for ident in idents:
        idx = [i for i, _ in states[ident]]
        sts = [s for _, s in states[ident]]
        sess = [sessions[i] for i in idx]
        ta = {k: probes[(ident, g)] for k, g in enumerate(idx) if (ident, g) in probes}
        rows += [cp.row() for cp in vl.segment(ident, pop["identities"][ident]["ticker"], sess, sts, ta)]
    doc = {"version": vl.LEDGER_VERSION, "rows": sorted(rows), "sha256": vl.ledger_hash(rows),
           "population_sha256": __import__("hashlib").sha256(
               open(os.path.join(out, "population.json"), "rb").read()).hexdigest(),
           "probes": len(probes)}
    tmp = os.path.join(out, "venue_ledger.json.tmp")
    json.dump(doc, open(tmp, "w"), separators=(",", ":"))
    os.replace(tmp, os.path.join(out, "venue_ledger.json"))
    print(time.strftime("%H:%M:%S"), "LEDGER", len(rows), "rows sha256", doc["sha256"], flush=True)


if __name__ == "__main__":
    main(sys.argv[1], int(sys.argv[2]) if len(sys.argv) > 2 else 8)
