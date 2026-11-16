"""Web side of stream-ingest (PR5b): NH/NL, the volume push and Time & Sales in REMOTE mode.

In local mode these three read the Massive tape inside the web pod (nhnl_live's print
listener, volume_live.on_aggregate off bar_stream's on_bar, time_and_sales.on_trade as a
trade listener). In remote mode there is no tape in this pod; stream-ingest produces
what each needs (ingest_side_feeds) and the feed client hands every batch here, which
feeds the SAME module entry points, so the three features do not know the difference:

  agg   {sym: (av, c, s)}  -> volume_live.on_aggregate(sym, {"av", "c", "t"}, "A")
  tas   {sym: [prints]}    -> time_and_sales.on_trade(sym, {"t", "p", "s", "c"}) per print
                              (a gap marker means prints were lost; counted, the tape
                              itself has no gap row)
  nhnl  {sym: marks}       -> folded into nhnl_live._print_counts (the counts the scanner
                              folds into its served state every tick, exactly as the local
                              listener's are)
  nhnl_rt {"hi", "lo"}     -> the per-epoch cumulative print events; the increase since
                              the last value (in this epoch) is added to nhnl_live's
                              _rt_hi / _rt_lo, which drive the H/L Pulse rate

And what this pod asks for (added to the feed client's desired set):

  nhnl_seeds  for every symbol in nhnl_live._print_counts: its marks AS SEEDED (captured
              the first time the symbol appears in the print set, not the live values,
              so the desired set does not churn with every new high), with the session
              key `sk` = YYYYMMDD * 10 + window (pre 0, rth 1, post 2)
  tas_syms    every symbol a Time & Sales client is watching
Every NEW CONNECTION re-seeds from the live counts (`on_connect`): stream-ingest may
have lost its marks (a restart, or a lease that expired), and a seed taken hours ago
would roll the session's counts back. Marks folded in are MONOTONIC within a session
(counts and the high only grow, the low only falls), the guarantee local mode has.

A known, bounded overlap: ingest's `nhnl_rt` sums every client's seeded symbols, held
leases included, so for the few hundred ms between this pod dropping a symbol and ingest
hearing of it (or up to the lease after a pod restart under a new client_id, or with two
replicas) an event can be counted by both the web poll and the tape.

The T channel for those symbols is held by the existing owners ("nhnl" via
nhnl_live._manage_print_set, "bars" via time_and_sales' broadcaster interest), which
bar_stream records and the feed client sends as `owners`.
"""
from __future__ import annotations

import logging
import math
from typing import Optional

from api.services import feed_protocol as fp

log = logging.getLogger("api.services.remote_side_feeds")

_WINDOW_SK = {"pre": 0, "rth": 1, "post": 2}


def session_key(date: Optional[str], window: Optional[str]) -> int:
    """nhnl_live's session (`date` YYYY-MM-DD, `window`) as an increasing integer."""
    try:
        d = int(str(date).replace("-", ""))
    except (TypeError, ValueError):
        return 0
    return d * 10 + _WINDOW_SK.get(window or "", 3)


class RemoteSideFeeds:
    def __init__(self):
        self._seeds: dict = {}            # prov sym -> seed as first seen (+ sk)
        self._rt_last: Optional[dict] = None   # last nhnl_rt of the current epoch
        self.counters = {"agg_in": 0, "tas_in": 0, "tas_gaps": 0, "nhnl_in": 0,
                         "nhnl_unknown": 0, "rt_hi": 0, "rt_lo": 0, "bad_seeds": 0,
                         "errors": 0}

    # ── what this pod asks for ────────────────────────────────────────────

    def desired_extras(self) -> tuple:
        """(nhnl_seeds, tas_syms) for the feed client's desired set."""
        return self._nhnl_seeds(), self._tas_syms()

    def on_connect(self) -> None:
        """A new feed connection: re-seed every symbol from the live counts."""
        self._seeds.clear()

    def _nhnl_seeds(self) -> dict:
        from api.services import nhnl_live as nl
        # No nl._lock here: this runs on the uvicorn loop, and the scanner's tick holds
        # that lock across the whole universe. Two dict reads are atomic under the GIL.
        st = nl._state
        sk = session_key(st.get("date"), st.get("window"))
        with nl._print_lock:
            current = {p: dict(pc) for p, pc in nl._print_counts.items()}
        for p in [p for p in self._seeds if p not in current]:
            del self._seeds[p]
        for p, pc in current.items():
            s = self._seeds.get(p)
            if s is None or s["sk"] != sk:
                seed = {"hod": pc.get("hod", 0.0), "lod": pc.get("lod", 0.0),
                        "nh": pc.get("nh", 0), "nl": pc.get("nl", 0),
                        "last": pc.get("last"), "sk": sk}
                if not all(v is None or (isinstance(v, (int, float)) and math.isfinite(v))
                           for k, v in seed.items() if k != "sk"):
                    # A non-finite mark would make the whole desired message unsendable
                    # (and the bars feed with it): leave the symbol to the web poll.
                    self.counters["bad_seeds"] += 1
                    self._seeds.pop(p, None)
                    continue
                self._seeds[p] = seed
        return dict(self._seeds)

    @staticmethod
    def _tas_syms() -> frozenset:
        from api.services import time_and_sales as ts
        with ts._lock:
            return frozenset(s for s, n in ts._watchers.items() if n)

    # ── what ingest sent ───────────────────────────────────────────────────

    def new_epoch(self) -> None:
        """The feed restarted its counters (a new ingest epoch / connection). T&S has no
        snapshot, so every tape has a gap here: its tick direction starts over."""
        self._rt_last = None
        self._tas_gap(None)

    def apply(self, batch: fp.Batch) -> None:
        # each part on its own: one failing never loses another's data
        for part, fn in (("agg", self._apply_agg), ("tas", self._apply_tas),
                         ("nhnl", self._apply_nhnl), ("nhnl_rt", self._apply_rt)):
            data = getattr(batch, part)
            if not data:
                continue
            try:
                fn(data)
            except Exception as e:  # noqa: BLE001
                self.counters["errors"] += 1
                log.warning("[remote_side_feeds] %s failed: %s: %s", part, type(e).__name__, e)

    @staticmethod
    def _tas_gap(sym: Optional[str]) -> None:
        """Prints were lost: the next print's tick test must not lean on a stale price."""
        from api.services import time_and_sales as ts
        with ts._lock:
            tapes = list(ts._tapes.values()) if sym is None else [t for t in [ts._tapes.get(sym)] if t]
            for tape in tapes:
                tape.last_price = None
                tape.last_dir = ""

    def _apply_agg(self, agg: dict) -> None:
        from api.services import volume_live
        for sym, (av, c, s) in agg.items():
            self.counters["agg_in"] += 1
            volume_live.on_aggregate(sym, {"av": av, "c": c, "t": s}, "A")

    def _apply_tas(self, tas: dict) -> None:
        from api.services import time_and_sales
        for sym, items in tas.items():
            for it in items:
                if isinstance(it, fp.TasGap):
                    self.counters["tas_gaps"] += it.dropped
                    self._tas_gap(sym)
                    continue
                t, p, s, conds = it
                self.counters["tas_in"] += 1
                time_and_sales.on_trade(sym, {"t": t, "p": p, "s": s, "c": list(conds or ())})

    def _apply_nhnl(self, marks: dict) -> None:
        from api.services import nhnl_live as nl
        with nl._print_lock:
            for sym, m in marks.items():
                pc = nl._print_counts.get(sym)
                seed = self._seeds.get(sym)
                if pc is None or not isinstance(m, dict) or (seed is not None and m.get("sk") != seed["sk"]):
                    self.counters["nhnl_unknown"] += 1    # dropped since, or another session's
                    continue
                # MONOTONIC within the session: a mark never moves a count back
                hod, lod = m.get("hod"), m.get("lod")
                if isinstance(hod, (int, float)) and hod > (pc.get("hod") or 0):
                    pc["hod"] = hod
                    if m.get("hi_ms") is not None:
                        pc["hi_ms"] = m["hi_ms"]
                if isinstance(lod, (int, float)) and lod > 0 and (not pc.get("lod") or lod < pc["lod"]):
                    pc["lod"] = lod
                    if m.get("lo_ms") is not None:
                        pc["lo_ms"] = m["lo_ms"]
                for k in ("nh", "nl"):
                    if isinstance(m.get(k), int) and m[k] > (pc.get(k) or 0):
                        pc[k] = m[k]
                if m.get("last") is not None:
                    pc["last"] = m["last"]
                self.counters["nhnl_in"] += 1

    def _apply_rt(self, rt: dict) -> None:
        from api.services import nhnl_live as nl
        hi, lo = int(rt.get("hi") or 0), int(rt.get("lo") or 0)
        last = self._rt_last
        self._rt_last = {"hi": hi, "lo": lo}
        if last is None:
            return            # a new epoch's first value is a baseline, not new events
        dh, dl = max(0, hi - last["hi"]), max(0, lo - last["lo"])
        if dh or dl:
            with nl._print_lock:
                nl._rt_hi += dh
                nl._rt_lo += dl
                nl._print_events_total += dh + dl
            self.counters["rt_hi"] += dh
            self.counters["rt_lo"] += dl

    def status(self) -> dict:
        return {"nhnl_seeds": len(self._seeds), "counters": dict(self.counters)}
