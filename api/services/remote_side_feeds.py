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
The T channel for those symbols is held by the existing owners ("nhnl" via
nhnl_live._manage_print_set, "bars" via time_and_sales' broadcaster interest), which
bar_stream records and the feed client sends as `owners`.
"""
from __future__ import annotations

import logging
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
                         "nhnl_unknown": 0, "rt_hi": 0, "rt_lo": 0}

    # ── what this pod asks for ────────────────────────────────────────────

    def desired_extras(self) -> tuple:
        """(nhnl_seeds, tas_syms) for the feed client's desired set."""
        return self._nhnl_seeds(), self._tas_syms()

    def _nhnl_seeds(self) -> dict:
        from api.services import nhnl_live as nl
        with nl._lock:
            sk = session_key(nl._state.get("date"), nl._state.get("window"))
        with nl._print_lock:
            current = {p: dict(pc) for p, pc in nl._print_counts.items()}
        for p in [p for p in self._seeds if p not in current]:
            del self._seeds[p]
        for p, pc in current.items():
            s = self._seeds.get(p)
            if s is None or s["sk"] != sk:
                self._seeds[p] = {"hod": pc.get("hod", 0.0), "lod": pc.get("lod", 0.0),
                                  "nh": pc.get("nh", 0), "nl": pc.get("nl", 0),
                                  "last": pc.get("last"), "sk": sk}
        return dict(self._seeds)

    @staticmethod
    def _tas_syms() -> frozenset:
        from api.services import time_and_sales as ts
        with ts._lock:
            return frozenset(s for s, n in ts._watchers.items() if n)

    # ── what ingest sent ───────────────────────────────────────────────────

    def new_epoch(self) -> None:
        """The feed restarted its counters (a new ingest epoch / connection)."""
        self._rt_last = None

    def apply(self, batch: fp.Batch) -> None:
        if batch.agg:
            self._apply_agg(batch.agg)
        if batch.tas:
            self._apply_tas(batch.tas)
        if batch.nhnl:
            self._apply_nhnl(batch.nhnl)
        if batch.nhnl_rt:
            self._apply_rt(batch.nhnl_rt)

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
                for k in ("hod", "lod", "nh", "nl", "last", "hi_ms", "lo_ms"):
                    if k in m:
                        pc[k] = m[k]
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
            self.counters["rt_hi"] += dh
            self.counters["rt_lo"] += dl

    def status(self) -> dict:
        return {"nhnl_seeds": len(self._seeds), "counters": dict(self.counters)}
