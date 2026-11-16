"""stream-ingest: the three per-print side feeds (ingest PR4c).

Besides chart bars and quotes (ingest_runtime), three web features read the Massive
stocks tape. In the web pod they hang off bar_stream directly; once the socket lives in
stream-ingest, this module produces what each of them needs and puts it in the feed
batches. Each one is pure bookkeeping on the service's one loop (no IO, no threads):

NEW HIGHS / NEW LOWS (print-exact, nhnl_live's `_on_trade_print`)
    The web scanner picks the bounded set of symbols to count print by print and SEEDS
    each from its own poll marks (desired.nhnl_seeds, {sym: seed}). Here every T print
    of a seeded symbol that may set a high/low (the SIP condition filter,
    trade_conditions.classify, exactly as on web) is compared with the running marks.
      seed (web -> ingest):  {"hod": num, "lod": num, "nh": int, "nl": int, "last": num|null}
      nhnl (ingest -> web):  {sym: {"hod", "lod", "nh", "nl", "last", "hi_ms", "lo_ms"}}
                             for every symbol whose marks changed since the last batch
      nhnl_rt (ingest -> web): {"hi": n, "lo": n}: new-high / new-low events counted since
                             this ingest epoch began (cumulative, so a replayed or
                             duplicated batch is harmless; web differences consecutive
                             values within an epoch to drive the H/L Pulse rate)
    A re-sent seed for a symbol already being counted is MERGED (highest high, lowest
    low, larger counts): the web poll may have seen what the tape missed, and neither
    side ever moves a mark backwards. A symbol dropped from the seeds stops counting.

VOLUME (volume_live's `on_aggregate`)
    For every symbol a client holds under owner "volume", the latest A/AM aggregate's
    (av = day volume so far, c = close, s = aggregate start ms), sent at most once per
    AGG_INTERVAL_S (1 s) per symbol, only when it changed.

TIME & SALES (time_and_sales's `on_trade`)
    Every T print of a symbol in a client's tas set (<= 20 per client, the web cap and
    BufferLimits.max_tas_syms) as [t, p, s, conditions]. The tick test, size tiers and
    the rings stay on web; the buffer bounds each symbol and marks any overflow with an
    explicit gap.

Routing mirrors ingest_runtime: only CONNECTED clients have buffers; a newly connected
client (or one that newly holds a symbol) is first given the current state (NH/NL
marks, the latest aggregate, the cumulative rt counters).
"""
from __future__ import annotations

import logging
import math
import time
from typing import Callable, Optional

from api.services import feed_protocol as fp
from api.services import trade_conditions

log = logging.getLogger("api.services.ingest_side_feeds")

VOLUME_OWNER = "volume"
AGG_INTERVAL_S = 1.0
_EPS = 1e-6          # nhnl_live's float-noise guard for the high-water-mark compare


def _num(x) -> Optional[float]:
    if isinstance(x, bool) or not isinstance(x, (int, float)):
        return None
    x = float(x)
    return x if math.isfinite(x) else None


def _cnt(x) -> int:
    return int(x) if isinstance(x, int) and not isinstance(x, bool) and x >= 0 else 0


class SideFeeds:
    def __init__(self, monotonic: Callable[[], float] = time.monotonic,
                 agg_interval_s: float = AGG_INTERVAL_S):
        self._mono = monotonic
        self.agg_interval_s = float(agg_interval_s)
        # per connected client: (client, vol_syms, tas_syms, nhnl_syms)
        self._views: dict = {}
        self._vol_routes: dict = {}
        self._tas_routes: dict = {}
        self._nhnl_routes: dict = {}
        self._nhnl_clients: list = []
        # volume
        self._vol_syms: frozenset = frozenset()
        self._agg: dict = {}                 # sym -> (av, c, s)
        self._agg_dirty: set = set()
        self._agg_next = 0.0
        # NH/NL
        self._nh: dict = {}                  # sym -> marks
        self._nh_dirty: set = set()
        self.rt = {"hi": 0, "lo": 0}
        self._rt_dirty = False
        self.counters = {"tas_forwarded": 0, "tas_rejected": 0, "nhnl_events": 0,
                         "nhnl_updates": 0, "nhnl_bad_seeds": 0, "agg_offered": 0,
                         "invalid": 0}

    # ── control plane ─────────────────────────────────────────────────────────

    def sync(self, union: fp.DesiredUnion) -> None:
        """Follow the union: the volume symbol set and the NH/NL seeds."""
        self._vol_syms = union.owner_syms(VOLUME_OWNER)
        for sym in [s for s in self._agg if s not in self._vol_syms]:
            del self._agg[sym]
            self._agg_dirty.discard(sym)
        seeds = union.nhnl_seeds()
        for sym in [s for s in self._nh if s not in seeds]:
            del self._nh[sym]
            self._nh_dirty.discard(sym)
        for sym, seed in seeds.items():
            self._seed(sym, seed)

    def _seed(self, sym: str, seed) -> None:
        if not isinstance(seed, dict):
            self.counters["nhnl_bad_seeds"] += 1
            return
        hod, lod, last = _num(seed.get("hod")), _num(seed.get("lod")), _num(seed.get("last"))
        if hod is None or lod is None:
            self.counters["nhnl_bad_seeds"] += 1
            return
        nh, nl = _cnt(seed.get("nh")), _cnt(seed.get("nl"))
        st = self._nh.get(sym)
        if st is None:
            self._nh[sym] = {"hod": hod, "lod": lod, "nh": nh, "nl": nl, "last": last,
                             "hi_ms": None, "lo_ms": None}
            return
        changed = False
        if hod > st["hod"]:
            st["hod"], changed = hod, True
        if lod > 0 and (st["lod"] <= 0 or lod < st["lod"]):
            st["lod"], changed = lod, True
        if nh > st["nh"]:
            st["nh"], changed = nh, True
        if nl > st["nl"]:
            st["nl"], changed = nl, True
        if changed:
            self._nh_dirty.add(sym)

    def client_updated(self, client, union: fp.DesiredUnion, fresh: bool) -> None:
        """`fresh`: a new connection (an empty buffer)."""
        cid = client.client_id
        vol = union.client_owner_syms(cid, VOLUME_OWNER)
        tas = union.client_tas(cid)
        nhnl = union.client_nhnl_syms(cid)
        old = self._views.get(cid)
        if fresh or old is None or old[0] is not client:
            o_vol = o_tas = o_nhnl = frozenset()
        else:
            _, o_vol, o_tas, o_nhnl = old
        self._views[cid] = (client, vol, tas, nhnl)
        self._reindex()
        buf = client.buffer
        for sym in sorted(vol - o_vol):
            a = self._agg.get(sym)
            if a is not None:
                self._offer(lambda: buf.offer_agg(sym, *a))
        for sym in sorted(nhnl - o_nhnl):
            st = self._nh.get(sym)
            if st is not None:
                self._offer(lambda: buf.offer_nhnl({sym: dict(st)}))
        if nhnl and not o_nhnl:
            self._offer(lambda: buf.offer_nhnl_rt(dict(self.rt)))

    def client_gone(self, client) -> None:
        cid = client.client_id
        v = self._views.get(cid)
        if v is not None and v[0] is client:
            del self._views[cid]
            self._reindex()

    def _reindex(self) -> None:
        vr: dict = {}
        tr: dict = {}
        nr: dict = {}
        nc: list = []
        for client, vol, tas, nhnl in self._views.values():
            for s in vol:
                vr.setdefault(s, []).append(client)
            for s in tas:
                tr.setdefault(s, []).append(client)
            for s in nhnl:
                nr.setdefault(s, []).append(client)
            if nhnl:
                nc.append(client)
        self._vol_routes, self._tas_routes, self._nhnl_routes, self._nhnl_clients = vr, tr, nr, nc

    # ── data plane (bar_stream's on_bar, via ingest_runtime) ──────────────────

    def on_event(self, sym: str, payload: dict, kind: str) -> None:
        if kind == "T":
            if sym in self._nh:
                self._count(sym, payload)
            targets = self._tas_routes.get(sym)
            if targets:
                self._tas(sym, payload, targets)
            return
        if sym in self._vol_syms:
            av, c = _num(payload.get("av")), _num(payload.get("c"))
            if av is None or av <= 0 or c is None or c <= 0:
                return
            a = (av, c, payload.get("t"))
            if self._agg.get(sym) != a:
                self._agg[sym] = a
                self._agg_dirty.add(sym)

    def _count(self, sym: str, trade: dict) -> None:
        p = _num(trade.get("p"))
        if p is None or p <= 0:
            return
        try:
            hl_ok = trade_conditions.classify(trade.get("c"))[0]
        except Exception:  # noqa: BLE001 - nhnl_live: an unknown classification counts
            hl_ok = True
        if not hl_ok:
            return
        st = self._nh[sym]
        ms = trade.get("t")
        if p > st["hod"] * (1 + _EPS):
            st["nh"] += 1
            st["hod"] = p
            st["hi_ms"] = ms
            self.rt["hi"] += 1
            self._rt_dirty = True
            self.counters["nhnl_events"] += 1
        elif p < st["lod"] * (1 - _EPS):
            st["nl"] += 1
            st["lod"] = p
            st["lo_ms"] = ms
            self.rt["lo"] += 1
            self._rt_dirty = True
            self.counters["nhnl_events"] += 1
        st["last"] = p
        self._nh_dirty.add(sym)

    def _tas(self, sym: str, trade: dict, targets) -> None:
        conds = trade.get("c")
        conds = [int(x) for x in conds if isinstance(x, int) and not isinstance(x, bool)] \
            if isinstance(conds, (list, tuple)) else None
        for client in targets:
            r = self._offer(lambda: client.buffer.offer_tas(sym, trade.get("t"), trade.get("p"),
                                                            trade.get("s"), conds))
            if r is fp.Offer.ACCEPTED:
                self.counters["tas_forwarded"] += 1
            elif r is fp.Offer.REJECTED:
                self.counters["tas_rejected"] += 1

    def flush(self) -> None:
        """Once per batch tick (ingest_runtime.before_flush)."""
        if self._nh_dirty:
            dirty, self._nh_dirty = self._nh_dirty, set()
            for sym in dirty:
                st = self._nh.get(sym)
                if st is None:
                    continue
                for client in self._nhnl_routes.get(sym, ()):
                    if self._offer(lambda: client.buffer.offer_nhnl({sym: dict(st)})) is fp.Offer.ACCEPTED:
                        self.counters["nhnl_updates"] += 1
        if self._rt_dirty:
            self._rt_dirty = False
            for client in self._nhnl_clients:
                self._offer(lambda: client.buffer.offer_nhnl_rt(dict(self.rt)))
        now = self._mono()
        if self._agg_dirty and now >= self._agg_next:
            self._agg_next = now + self.agg_interval_s
            dirty, self._agg_dirty = self._agg_dirty, set()
            for sym in dirty:
                a = self._agg.get(sym)
                if a is None:
                    continue
                for client in self._vol_routes.get(sym, ()):
                    if self._offer(lambda: client.buffer.offer_agg(sym, *a)) is fp.Offer.ACCEPTED:
                        self.counters["agg_offered"] += 1

    def _offer(self, fn):
        try:
            return fn()
        except fp.ProtocolError as e:
            self.counters["invalid"] += 1
            log.debug("[stream-ingest] unsendable side-feed item: %s", e)
            return None

    def status(self) -> dict:
        return {"nhnl_symbols": len(self._nh), "rt": dict(self.rt),
                "volume_symbols": len(self._vol_syms), "tas_symbols": len(self._tas_routes),
                "counters": dict(self.counters)}
