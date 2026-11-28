"""500-member replay against a LOCAL bars-api (never production): virtual members drive the chart client's
request shapes at the quality the owner ruled (2026-11-28) and we measure what the origin must carry.

Modes (what reaches the ORIGIN, /api/bars + /api/bars-history):
  old       today's shipped client: press + legacy +-6 neighbour warms (front tf) to origin.
  full      quality-maximal client with TODAY'S routing (nothing answered at the edge): press, +-6 neighbour
            warms on the front AND linked tfs, hidden-pane (next symbol) fill on every linked tf, all-timeframe
            dwell warm at 300 ms, k=3 typed candidates x linked tfs per keystroke, deep D join on rest.
  edge      the same client after PR 1.7 / edge-first: neighbour, dwell, typed 2-3 and hidden-pane fills are
            answered by device/edge; the origin sees the press tails, typed top-1 + one tail ahead, and a
            device-miss fraction (EDGE_MISS) of the warms.
Each member: a board of 2-4 widgets with linked tfs, a watchlist of 40-150 names drawn by liquidity (Zipf),
scan bursts (arrow every 250-600 ms), typed searches (150 ms/key), tf changes, rests.

Universe: the local store's 4,504 daily tickers (rank = 20-day dollar volume). Intraday asks for a ticker the
local store does not hold intraday are sent for an intraday-held ticker of similar rank WITH A DISTINCT `bars`
(1199 - h % 97): the server's memory cache keys on (ticker, tf, bars), so the cache sees the real universe's key
cardinality while every read is a real full-size SQLite read.

Usage: python replay_members.py --targets URL[,URL...] --members 500 --duration 90 --ramp 20 --mode full
         --shard 0 --shards 4 --out run.json
"""
import argparse, asyncio, json, math, os, random, time, bisect, zlib

import aiohttp

HERE = os.path.dirname(os.path.abspath(__file__))
ALL_TFS = ["D", "5", "60", "30", "15", "W", "M", "1"]
INTRA = {"1", "5", "15", "30", "60"}
STEP = {"1": 60, "5": 300, "15": 900, "30": 1800, "60": 3600}
EDGE_MISS = 0.10      # edge mode: fraction of device/edge warms that still reach origin (cold tier, miss)


class Universe:
    def __init__(self, path, zipf_s=1.05, seed=0):
        u = json.load(open(path))
        self.daily = [s for s, _ in u["D"]]
        self.intra = u["intraday"]
        n = len(self.daily)
        w = [1.0 / ((i + 1) ** zipf_s) for i in range(n)]
        tot = sum(w)
        acc, c = [], 0.0
        for x in w:
            c += x / tot
            acc.append(c)
        self.cdf = acc
        self.rank = {s: i for i, s in enumerate(self.daily)}
        self.intra_sets = {tf: set(v) for tf, v in self.intra.items()}
        # intraday-held tickers in liquidity order, per tf
        self.intra_ranked = {tf: sorted(v, key=lambda s: self.rank.get(s, 10 ** 6)) for tf, v in self.intra.items()}

    def draw(self, rng):
        return self.daily[min(len(self.daily) - 1, bisect.bisect_left(self.cdf, rng.random()))]

    def wire(self, sym, tf):
        """(ticker, bars) actually sent for a member's (sym, tf)."""
        if tf == "D":
            return sym, 600
        if sym in self.intra_sets.get(tf, ()):
            return sym, (1199 if tf in INTRA else 600)
        lst = self.intra_ranked.get(tf) or self.intra_ranked["5"]
        r = self.rank.get(sym, 0)
        frac = r / max(1, len(self.daily))
        sub = lst[min(len(lst) - 1, int(frac * len(lst)))]
        h = zlib.crc32(sym.encode())
        return sub, (1199 if tf in INTRA else 600) - (h % 97) - 1


class Stats:
    def __init__(self):
        self.rows = []   # (t_start_rel, cls, status, ms, bytes)

    def add(self, *r):
        self.rows.append(r)


class Member:
    def __init__(self, mid, uni, mode, rng, send, t0):
        self.id, self.u, self.mode, self.rng, self.send, self.t0 = mid, uni, mode, rng, send, t0
        nw = rng.choice([2, 3, 3, 4])
        self.tfs = rng.sample(["D", "D", "60", "5", "15", "W"], 1)
        while len(set(self.tfs)) < min(nw, 3):
            self.tfs.append(rng.choice(["D", "60", "5", "15", "30", "W", "1"]))
        self.tfs = list(dict.fromkeys(self.tfs))
        self.front_tf = self.tfs[0]
        self.lists = [[uni.draw(rng) for _ in range(rng.randint(40, 150))] for _ in range(rng.randint(1, 3))]
        self.lst = self.lists[0]
        self.idx = rng.randrange(len(self.lst))
        self.held = {}          # (sym, tf) -> last bar marker (tail asks thereafter)
        self.deep_done = set()

    # -- request helpers --------------------------------------------------------------------------
    def _bars(self, sym, tf, cls, warm=False):
        key = (sym, tf)
        tick, n = self.u.wire(sym, tf)
        if key in self.held:
            since = (int(time.time()) // STEP[tf] * STEP[tf] - 3 * STEP[tf]) if tf in INTRA else "2026-11-20"
            q = "tf=%s&bars=%d&since=%s" % (tf, n, since)
            cls = cls + "-tail"
        else:
            q = "tf=%s&bars=%d" % (tf, n)
            self.held[key] = 1
        if warm:
            q += "&warm=1"
        return self.send("/api/bars/%s?%s" % (tick, q), cls)

    def _cold_only(self, sym, tf, cls, warm=True, edge_class=True):
        if (sym, tf) in self.held:
            return None
        if self.mode == "edge" and edge_class and self.rng.random() >= EDGE_MISS:
            self.held[(sym, tf)] = 1          # answered by device/edge: the key is held, origin never asked
            return None
        return self._bars(sym, tf, cls, warm)

    def _deep(self, sym):
        if sym in self.deep_done:
            return None
        self.deep_done.add(sym)
        return self.send("/api/bars-history/%s?tf=D&bars=60000" % sym, "deep")

    def _fire(self, coros):
        for c in coros:
            if c is not None:
                asyncio.ensure_future(c)

    def _origin_warm(self):
        """Is a device/edge-class warm sent to ORIGIN in this mode?"""
        return self.mode == "full" or (self.mode == "edge" and self.rng.random() < EDGE_MISS)

    def neighbours(self, radius=6):
        L = len(self.lst)
        out = []
        for d in range(1, radius + 1):
            out += [self.lst[(self.idx + d) % L], self.lst[(self.idx - d) % L]]
        return list(dict.fromkeys(s for s in out if s != self.lst[self.idx]))

    # -- actions ----------------------------------------------------------------------------------
    def press(self, sym, typed=False):
        reqs = []
        for tf in self.tfs:                                    # front panes, every linked tf
            reqs.append(self._bars(sym, tf, "press"))
        nb = self.neighbours()
        if self.mode == "old":
            reqs += [self._cold_only(s, self.front_tf, "nbr-old", warm=(i >= 2)) for i, s in enumerate(nb)]
        else:
            for i, s in enumerate(nb):
                for tf in self.tfs:
                    reqs.append(self._cold_only(s, tf, "nbr", warm=(i >= 2)))
            # hidden pane = the next symbol on every linked tf (A.* + T.* subscribed: stream side, not HTTP)
            nxt = self.lst[(self.idx + 1) % len(self.lst)]
            for tf in self.tfs:
                reqs.append(self._cold_only(nxt, tf, "hidden", warm=False))
        self._fire(reqs)

    def dwell(self, sym, ms):
        if self.mode == "old" or ms < 300:
            return
        reqs = []
        for tf in ALL_TFS:
            reqs.append(self._cold_only(sym, tf, "dwell"))
        if ms >= 1000:
            for s in [sym] + self.neighbours(1):
                if self.mode == "full" or self.rng.random() < EDGE_MISS:
                    reqs.append(self._deep(s))
        self._fire(reqs)

    def keystroke(self, cands):
        if self.mode == "old":
            return
        reqs = []
        for i, s in enumerate(cands[:3]):
            for tf in self.tfs:
                # top-1 asks origin for its tail ahead (edge mode too); 2-3 are device/edge class
                reqs.append(self._cold_only(s, tf, "typed", warm=False, edge_class=(i > 0)))
        self._fire(reqs)

    async def run(self, until):
        rng = self.rng
        await asyncio.sleep(rng.random() * 3)
        while time.monotonic() < until:
            a = rng.random()
            if a < 0.55:                                   # scan burst through the list
                for _ in range(rng.randint(5, 25)):
                    self.idx = (self.idx + (1 if rng.random() < 0.85 else -1)) % len(self.lst)
                    sym = self.lst[self.idx]
                    self.press(sym)
                    gap = rng.uniform(250, 600)
                    if gap >= 300:
                        self.dwell(sym, gap)
                    await asyncio.sleep(gap / 1000)
                rest = rng.uniform(1.5, 8)
                self.dwell(self.lst[self.idx], rest * 1000)
                await asyncio.sleep(rest)
            elif a < 0.80:                                 # typed search: 2-5 keys at 150 ms, Enter
                target = self.u.draw(rng)
                pool = [target] + [self.u.draw(rng) for _ in range(6)]
                keys = rng.randint(2, 5)
                for k in range(keys):
                    rng.shuffle(pool[1:])
                    cands = [pool[0]] + pool[1 + k % 3: 4 + k % 3] if k == keys - 1 else pool[k % 2: k % 2 + 3]
                    self.keystroke(cands)
                    await asyncio.sleep(0.15)
                self.press(target, typed=True)
                rest = rng.uniform(2, 12)
                self.dwell(target, rest * 1000)
                await asyncio.sleep(rest)
            elif a < 0.90:                                 # tf change on the front widget
                self.front_tf = rng.choice(ALL_TFS)
                if self.front_tf not in self.tfs:
                    self.tfs[0] = self.front_tf
                self.press(self.lst[self.idx])
                await asyncio.sleep(rng.uniform(1, 5))
            elif a < 0.95:                                 # switch list
                self.lst = rng.choice(self.lists)
                self.idx = rng.randrange(len(self.lst))
                self.press(self.lst[self.idx])
                await asyncio.sleep(rng.uniform(1, 4))
            else:                                          # read the chart
                await asyncio.sleep(rng.uniform(5, 20))


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--targets", required=True)
    ap.add_argument("--members", type=int, default=500)
    ap.add_argument("--duration", type=float, default=90)
    ap.add_argument("--ramp", type=float, default=20)
    ap.add_argument("--mode", choices=["old", "full", "edge"], default="full")
    ap.add_argument("--shard", type=int, default=0)
    ap.add_argument("--shards", type=int, default=1)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--timeout", type=float, default=8.0)
    ap.add_argument("--out", required=True)
    ap.add_argument("--dry", action="store_true", help="record the request stream only; contact nothing")
    a = ap.parse_args()
    for t in a.targets.split(","):
        assert t.startswith("http://127.0.0.1:"), "replay targets must be loopback, got %r" % t
    targets = a.targets.split(",")
    uni = Universe(os.path.join(HERE, "universe.json"))
    st = Stats()
    t0 = time.monotonic()
    conn = aiohttp.TCPConnector(limit=0, limit_per_host=0, ttl_dns_cache=300)
    to = aiohttp.ClientTimeout(total=a.timeout)
    inflight = [0]
    async with aiohttp.ClientSession(connector=conn, timeout=to) as sess:
        rr = [0]

        async def send(path, cls):
            if a.dry:
                st.add(round(time.monotonic() - t0, 3), cls, 200, 0.0, 0, path)
                return
            base = targets[rr[0] % len(targets)]
            rr[0] += 1
            ts = time.monotonic()
            inflight[0] += 1
            try:
                async with sess.get(base + path) as r:
                    body = await r.read()
                    stv = r.headers.get("server-timing", "")
                    layer = stv.split('desc="', 1)[1].split('"', 1)[0] if 'desc="' in stv else ""
                    st.add(round(ts - t0, 3), cls, r.status, round((time.monotonic() - ts) * 1000, 2), len(body), layer)
            except asyncio.TimeoutError:
                st.add(round(ts - t0, 3), cls, 0, round((time.monotonic() - ts) * 1000, 2), 0, "timeout")
            except Exception as e:
                st.add(round(ts - t0, 3), cls, -1, round((time.monotonic() - ts) * 1000, 2), 0, type(e).__name__)
            finally:
                inflight[0] -= 1

        until = t0 + a.ramp + a.duration
        mids = [m for m in range(a.members) if m % a.shards == a.shard]
        tasks = []
        for i, m in enumerate(mids):
            rng = random.Random(a.seed * 100003 + m)
            mem = Member(m, uni, a.mode, rng, send, t0)

            async def start(mem=mem, delay=a.ramp * i / max(1, len(mids))):
                await asyncio.sleep(delay)
                await mem.run(until)
            tasks.append(asyncio.ensure_future(start()))
        peak_inflight = 0
        while time.monotonic() < until:
            await asyncio.sleep(0.5)
            peak_inflight = max(peak_inflight, inflight[0])
        for t in tasks:
            t.cancel()
        deadline = time.monotonic() + a.timeout + 1
        while inflight[0] > 0 and time.monotonic() < deadline:
            await asyncio.sleep(0.1)
    json.dump({"args": vars(a), "rows": st.rows, "peak_inflight": peak_inflight}, open(a.out, "w"))


if __name__ == "__main__":
    asyncio.run(main())
