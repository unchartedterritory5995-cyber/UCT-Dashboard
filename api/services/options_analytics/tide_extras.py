"""What else Market Tide's ONE tape read yields (lane/o-options-remainders):

  sectors  FT-056 -- the tide's signed-premium rule split by the tape's own `Sector` column.
  minutes  FT-057 -- per minute, the prints the tide counted there (largest premium first, capped
           at MINUTE_CAP and counted), so a click on the tide can open THAT minute's tape.
  blocks   FT-073 -- the session's prints the tape itself types BLOCK (largest premium first,
           capped at BLOCK_CAP and counted).
  multileg FT-073 remainder -- the session's prints the tape types ML/ (multi-leg: the OPRA
           condition codes 232-247, classified on flow-worker before the print reaches the tape,
           `build_gap_fill_csv.py` MULTI_LEG_CONDITIONS), grouped into one structure per symbol
           and print second. Only the legs that cleared the tape's own filters are on it, so a
           structure can show fewer legs than were traded; the count of legs seen is stated.

Fed row by row from `market_tide.build` beside its own accumulator, so arming these surfaces adds
no second read of the tape. Held per session; `result` answers for the session the tide answers.

⛔ The tape's own filters apply (50+ contracts, $10K+ premium): `market_tide.TAPE_FILTERS`.
⛔ A sector the tape left blank is 'Unclassified' and NAMED, never dropped.
⛔ A cap is stated with the count it capped (`shown` of `count`).
"""
from __future__ import annotations

import heapq

from api.services.options_analytics import market_tide as mt

MINUTE_CAP = 15
BLOCK_CAP = 200
MULTILEG_CAP = 100          # structures returned, largest total premium first
MULTILEG_LEGS = 8           # legs shown per structure (the count seen is always stated)
MULTILEG_GROUP_CAP = 20000  # structures held per session while reading; beyond it new ones are counted, not held
UNCLASSIFIED = "Unclassified"
_FIELDS = ("Symbol", "CallPut", "Strike", "ExpirationDate", "Side", "Premium", "Volume", "Price",
           "Type", "CreatedTime", "Sector", "Spot", "OI")


def _print(r: dict, prem: float) -> tuple:
    return (prem, tuple((r.get(k) or "").strip() if isinstance(r.get(k), str) else r.get(k) for k in _FIELDS))


def _as_dict(p: tuple) -> dict:
    prem, vals = p
    d = dict(zip(_FIELDS, vals))
    return {"symbol": d["Symbol"], "type": (d["CallPut"] or "").lower(), "strike": mt._f(d["Strike"]),
            "expiration": d["ExpirationDate"], "side": d["Side"], "premium": round(prem),
            "contracts": mt._f(d["Volume"]), "price": mt._f(d["Price"]), "trade_type": d["Type"],
            "time": d["CreatedTime"], "sector": d["Sector"] or UNCLASSIFIED, "spot": mt._f(d["Spot"]),
            "open_interest": mt._f(d.get("OI"))}


def is_multileg(r: dict) -> bool:
    return (r.get("Type") or "").strip().upper().startswith("ML")


def _push(heap: list, item: tuple, cap: int, seq: int) -> None:
    entry = (item[0], seq, item)
    if len(heap) < cap:
        heapq.heappush(heap, entry)
    elif entry[0] > heap[0][0]:
        heapq.heapreplace(heap, entry)


class TideExtras:
    def __init__(self):
        self._s: dict = {}
        self._seq = 0

    def _sess(self, session: str) -> dict:
        return self._s.setdefault(session, {"sectors": {}, "minutes": {}, "blocks": [], "blocks_n": 0,
                                            "ml": {}, "ml_n": 0, "ml_dropped": 0})

    @staticmethod
    def _ml_add(s: dict, key: tuple, p: tuple, n_prints: int = 1) -> None:
        g = s["ml"].get(key)
        if g is None:
            if len(s["ml"]) >= MULTILEG_GROUP_CAP:
                s["ml_dropped"] += n_prints
                return
            g = s["ml"][key] = {"premium": 0.0, "legs": []}
        g["premium"] += p[0]
        g["legs"].append(p)

    def add(self, r: dict) -> None:
        session = mt._date_iso(r.get("CreatedDate"))
        mn = mt._minute(r.get("CreatedTime"))
        prem = mt._f(r.get("Premium"))
        cp = (r.get("CallPut") or "").strip().upper()
        if session is None or mn is None or prem is None or cp not in ("CALL", "PUT"):
            return
        self._seq += 1
        s = self._sess(session)
        side = (r.get("Side") or "").strip().upper()
        sign = 1 if side in mt._ASK else -1 if side in mt._BID else 0
        sector = (r.get("Sector") or "").strip() or UNCLASSIFIED
        sec = s["sectors"].setdefault(sector, {"minutes": {}, "prints": 0, "unsigned": 0})
        sec["prints"] += 1
        if sign == 0:
            sec["unsigned"] += 1
        else:
            b = sec["minutes"].setdefault(mn, [0.0, 0.0])
            b[0 if cp == "CALL" else 1] += sign * prem
        m = s["minutes"].setdefault(mn, {"heap": [], "n": 0})
        m["n"] += 1
        p = _print(r, prem)
        _push(m["heap"], p, MINUTE_CAP, self._seq)
        if (r.get("Type") or "").strip().upper() in ("BLOCK", "BLK"):
            s["blocks_n"] += 1
            _push(s["blocks"], p, BLOCK_CAP, self._seq)
        if is_multileg(r):
            s["ml_n"] += 1
            self._ml_add(s, ((r.get("Symbol") or "").strip(), (r.get("CreatedTime") or "").strip()), p)

    def merge(self, other: "TideExtras") -> None:
        for session, o in other._s.items():
            s = self._sess(session)
            for name, sec in o["sectors"].items():
                d = s["sectors"].setdefault(name, {"minutes": {}, "prints": 0, "unsigned": 0})
                d["prints"] += sec["prints"]
                d["unsigned"] += sec["unsigned"]
                for mn, (c, p) in sec["minutes"].items():
                    b = d["minutes"].setdefault(mn, [0.0, 0.0])
                    b[0] += c
                    b[1] += p
            for mn, m in o["minutes"].items():
                d = s["minutes"].setdefault(mn, {"heap": [], "n": 0})
                d["n"] += m["n"]
                for prem, seq, item in m["heap"]:
                    self._seq += 1
                    _push(d["heap"], item, MINUTE_CAP, self._seq)
            s["blocks_n"] += o["blocks_n"]
            for prem, seq, item in o["blocks"]:
                self._seq += 1
                _push(s["blocks"], item, BLOCK_CAP, self._seq)
            s["ml_n"] += o.get("ml_n", 0)
            s["ml_dropped"] += o.get("ml_dropped", 0)
            for key, g in (o.get("ml") or {}).items():
                for leg in g["legs"]:
                    self._ml_add(s, key, leg)

    def result(self, session) -> dict:
        s = self._s.get(session) or {"sectors": {}, "minutes": {}, "blocks": [], "blocks_n": 0,
                                     "ml": {}, "ml_n": 0, "ml_dropped": 0}
        sectors = []
        for name, sec in s["sectors"].items():
            cc = cp = 0.0
            series = []
            for mn in sorted(sec["minutes"]):
                c, p = sec["minutes"][mn]
                cc += c
                cp += p
                series.append({"t": mn, "cum_net_premium": round(cc - cp)})
            sectors.append({"sector": name, "prints": sec["prints"], "prints_unsigned": sec["unsigned"],
                            "totals": {"net_call_premium": round(cc), "net_put_premium": round(cp),
                                       "net_premium": round(cc - cp)},
                            "minutes": series})
        sectors.sort(key=lambda x: (-abs(x["totals"]["net_premium"]), x["sector"]))
        minutes = {mn: {"count": m["n"],
                        "prints": [_as_dict(it) for _, _, it in sorted(m["heap"], key=lambda e: (-e[0], e[1]))]}
                   for mn, m in s["minutes"].items()}
        blocks = [_as_dict(it) for _, _, it in sorted(s["blocks"], key=lambda e: (-e[0], e[1]))]
        structures = []
        for (sym, t), g in sorted(s["ml"].items(), key=lambda kv: (-kv[1]["premium"], kv[0])):
            if len(structures) >= MULTILEG_CAP:
                break
            legs = [_as_dict(p) for p in sorted(g["legs"], key=lambda p: -p[0])]
            structures.append({"symbol": sym, "time": t, "premium": round(g["premium"]),
                               "legs_seen": len(legs), "legs": legs[:MULTILEG_LEGS],
                               "expirations": sorted({x["expiration"] for x in legs if x["expiration"]})})
        return {"session": session, "sectors": sectors, "minutes": minutes,
                "blocks": blocks, "blocks_count": s["blocks_n"],
                "multileg": structures, "multileg_prints": s["ml_n"],
                "multileg_structures": len(s["ml"]), "multileg_unheld_prints": s["ml_dropped"]}
