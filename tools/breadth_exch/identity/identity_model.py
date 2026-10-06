"""Exchange Breadth V1 — the LIVE identity-continuity layer (stable security IDs).

⛔⛔ WHY. The venue ledger keys a security as `ticker|delisted_utc` (`ticker|active`). A delisting
date is an ATTRIBUTE that reference snapshots learn late: the 2026-10-02 snapshot re-keyed 13 live
securities (`DBRG|active` → `DBRG|2026-10-01` …, 13,802 member-sessions). In an append, a re-keyed
name no longer finds its ledger rows and silently drops out of both exchanges.

THE MODEL. A security gets an immutable SID (`TICKER@first-session`) the first time it is
observed. Everything else is a versioned attribute of the SID: tickers (with periods), reference
keys (with the snapshot that produced them), composite FIGI / CIK observation counts, delisting
dates learned (with the snapshot that taught them). Assignment is causal — it uses only what is
known on the session being observed — and it is evidence-ranked:

  CONTINUE  the ticker's current holder SID keeps the ticker, unless one rule below fires;
  S1 GAP    the ticker was not observed for more than GAP sessions: continue ONLY on positive
            durable evidence (same composite FIGI; or, when either FIGI is unknown, same CIK);
  S2 ENDED  the holder's own reference record ended (a learned delisting date) BEFORE this session
            and this session resolves to a different reference record: a new listing — unless
            the composite FIGI matches (a true relisting of the same security);
  S3 SWAP   no gap, but the composite FIGIs differ (and the CIKs do not prove the same issuer), or
            the CIKs differ (and the FIGIs do not prove the same security): the ticker now names a
            different security (ETF → operating company, spin-off reusing the symbol);
  REATTACH  an observation that would start a new SID first looks for a SID not observed this
            session, last seen within GAP sessions, whose established FIGI (else CIK) equals this
            observation's — a rename, or the return after a one-day provider glitch.

`established` = the modal non-null value over the SID's observations so far (single-day provider
glitches cannot move it). A learned delisting date NEVER creates a SID; it is recorded on the SID.

Breadth safety: a FALSE SPLIT only means a venue stretch is re-evidenced; a FALSE MERGE cannot
create NYSE membership (NYSE is only ever asserted from a same-session dated XNYS listing).
Pure: no I/O, no clock, no network. Deterministic given the observation order.
"""
from __future__ import annotations

import hashlib
import json
from typing import Iterable, Optional, Sequence

GAP = 5
MODEL_VERSION = "exch-identity-v1"


def _mode(counts: dict) -> Optional[str]:
    if not counts:
        return None
    return sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))[0][0]


def _du(key: str) -> Optional[str]:
    v = key.rsplit("|", 1)[-1]
    return None if v == "active" else v[:10]


class IdentityState:
    """SIDs + per-ticker holder index. Sessions are observed in ascending order; re-observing an
    already-processed session (a later reference snapshot) only ENRICHES — it never reassigns."""

    def __init__(self, sessions: list[str]):
        self.S = list(sessions)
        self.pos = {d: i for i, d in enumerate(self.S)}
        self.sids: dict = {}
        self.holder: dict = {}             # ticker -> sid currently holding it
        self.at: dict = {}                 # ticker -> [[i0, i1, sid]] exact per-session ownership
        self.processed: set = set()
        self.snapshots: list = []
        self.recent: set = set()           # sids observed within the last GAP+1 sessions

    # ── internals ────────────────────────────────────────────────────────────────────────
    def _new(self, t: str, i: int, rule: str, detail) -> str:
        sid = f"{t}@{self.S[i]}"
        assert sid not in self.sids, sid
        self.sids[sid] = {"sid": sid, "first_i": i, "last_i": i, "tickers": [], "keys": [],
                          "figi": {}, "cik": {}, "delisted_learned": {}, "evidence": [[self.S[i], rule, detail]],
                          "n_obs": 0}
        return sid

    def _own(self, t: str, i: int, sid: str) -> None:
        runs = self.at.setdefault(t, [])
        if runs and runs[-1][2] == sid and self.holder.get(t) == sid:
            runs[-1][1] = i
        else:
            runs.append([i, i, sid])
        rec = self.sids[sid]
        tr = rec["tickers"]
        if tr and tr[-1][0] == t and self.holder.get(t) == sid:
            tr[-1][2] = i
        else:
            tr.append([t, i, i])
        self.holder[t] = sid

    def _key(self, sid: str, key: str, i: int, snap: str) -> None:
        ks = self.sids[sid]["keys"]
        for k in ks:
            if k[0] == key and k[3] == snap and k[2] == i - 1:
                k[2] = i
                break
            if k[0] == key and k[3] == snap and k[1] <= i <= k[2]:
                break
        else:
            ks.append([key, i, i, snap])
        du = _du(key)
        if du:
            self.sids[sid]["delisted_learned"].setdefault(du, snap)

    def sid_at(self, t: str, i: int) -> Optional[str]:
        for a, b, sid in self.at.get(t, ()):
            if a <= i <= b:
                return sid
        return None

    # ── the one entry point ──────────────────────────────────────────────────────────────
    def observe(self, i: int, members: Iterable[tuple], snap: str) -> dict:
        """members: (ticker, key, cik, figi) for every population member of session i.
        Returns {ticker: sid}. A processed session is ENRICHED only (keys/delisting learned)."""
        members = sorted(members)
        if i in self.processed:
            out = {}
            for t, key, cik, figi in members:
                sid = self.sid_at(t, i)
                if sid is None:
                    raise ValueError(f"enrichment saw an unknown member {t} on {self.S[i]}")
                self._key(sid, key, i, snap)
                out[t] = sid
            return out
        D = self.S[i]
        decided, pending = {}, []
        for t, key, cik, figi in members:
            h = self.holder.get(t)
            if h is None:
                pending.append((t, key, cik, figi, "NEW", None))
                continue
            r = self.sids[h]
            ef, ec = _mode(r["figi"]), _mode(r["cik"])
            fig_eq = bool(figi and ef and figi == ef)
            cik_eq = bool(cik and ec and cik == ec)
            gap = i - r["last_i"] - 1
            if gap > GAP and not (fig_eq or ((not figi or not ef) and cik_eq)):
                pending.append((t, key, cik, figi, "S1_GAP", [gap, ef, figi, ec, cik]))
                continue
            ended = [d for d in r["delisted_learned"] if d < D]
            if ended and key not in {k[0] for k in r["keys"]} and not fig_eq:
                pending.append((t, key, cik, figi, "S2_ENDED", [max(ended), key]))
                continue
            if (figi and ef and figi != ef and not cik_eq) or (cik and ec and cik != ec and not fig_eq):
                pending.append((t, key, cik, figi, "S3_SWAP", [ef, figi, ec, cik]))
                continue
            decided[t] = (h, key, cik, figi)
        taken = {v[0] for v in decided.values()}
        # SIDs seen within the gap window and NOT observed this session, by established id
        self.recent = {s for s in self.recent if i - self.sids[s]["last_i"] - 1 <= GAP}
        by_figi, by_cik = {}, {}
        if pending:
            for s in self.recent:
                if s in taken or self.sids[s]["last_i"] >= i:
                    continue
                ef, ec = _mode(self.sids[s]["figi"]), _mode(self.sids[s]["cik"])
                if ef:
                    by_figi.setdefault(ef, []).append(s)
                elif ec:
                    by_cik.setdefault(ec, []).append(s)
        for t, key, cik, figi, rule, detail in pending:
            cands = [s for s in by_figi.get(figi, ()) if s not in taken] if figi else []
            if not figi and cik:
                cands = [s for s in by_cik.get(cik, ()) if s not in taken]
            if len(cands) == 1:
                sid = cands[0]
                self.sids[sid]["evidence"].append([D, "REATTACH", [rule, t, figi, cik]])
            else:
                sid = self._new(t, i, rule, detail)
            taken.add(sid)
            decided[t] = (sid, key, cik, figi)
        out = {}
        for t in sorted(decided):
            sid, key, cik, figi = decided[t]
            prev = self.sids[sid]["tickers"][-1][0] if self.sids[sid]["tickers"] else None
            if prev and prev != t and self.holder.get(prev) == sid:
                del self.holder[prev]                       # rename: the old symbol is released
            self._own(t, i, sid)
            r = self.sids[sid]
            r["last_i"] = i
            r["n_obs"] += 1
            if figi:
                r["figi"][figi] = r["figi"].get(figi, 0) + 1
            if cik:
                r["cik"][cik] = r["cik"].get(cik, 0) + 1
            self._key(sid, key, i, snap)
            self.recent.add(sid)
            out[t] = sid
        self.processed.add(i)
        return out

    # ── persistence ──────────────────────────────────────────────────────────────────────
    @classmethod
    def from_doc(cls, doc: dict, sessions: list[str]) -> "IdentityState":
        """Resume EXACTLY from a persisted state (the accepted parent) so new sessions can be observed
        without replaying history. `sessions` must start with the parent's session list; it may extend
        it with the new sessions to observe. Round-trip and resume-equivalence are pinned by tests."""
        st = cls(sessions)
        pos = st.pos
        first, last, n = doc["sessions_processed"]
        st.processed = set(range(pos[first], pos[last] + 1))
        if len(st.processed) != n:
            raise ValueError("parent processed range is not contiguous in `sessions`")
        for sid, r in doc["sids"].items():
            st.sids[sid] = {"sid": sid, "first_i": pos[r["first"]], "last_i": pos[r["last"]],
                            "tickers": [[t, pos[a], pos[b]] for t, a, b in r["tickers"]],
                            "keys": [[k, pos[a], pos[b], snap] for k, a, b, snap in r["keys"]],
                            "figi": dict(r["figi"]), "cik": dict(r["cik"]),
                            "delisted_learned": dict(r["delisted_learned"]),
                            "evidence": [list(e) for e in r["evidence"]], "n_obs": r["n_obs"]}
        st.at = {t: [[pos[a], pos[b], sid] for a, b, sid in runs] for t, runs in doc["ticker_index"].items()}
        st.holder = dict(doc["holder"])
        li = pos[last]
        st.recent = {sid for sid, r in st.sids.items() if li - r["last_i"] <= GAP}
        st.snapshots = list(doc["snapshots"])
        return st

    def to_doc(self) -> dict:
        S = self.S
        sids = {}
        for sid, r in sorted(self.sids.items()):
            sids[sid] = {"first": S[r["first_i"]], "last": S[r["last_i"]], "n_obs": r["n_obs"],
                         "tickers": [[t, S[a], S[b]] for t, a, b in r["tickers"]],
                         "keys": [[k, S[a], S[b], snap] for k, a, b, snap in r["keys"]],
                         "figi": dict(sorted(r["figi"].items())), "cik": dict(sorted(r["cik"].items())),
                         "established": {"figi": _mode(r["figi"]), "cik": _mode(r["cik"])},
                         "delisted_learned": dict(sorted(r["delisted_learned"].items())),
                         "evidence": r["evidence"]}
        processed = sorted(self.processed)
        return {"model": MODEL_VERSION, "gap": GAP, "sessions_processed": [S[processed[0]], S[processed[-1]], len(processed)]
                if processed else None, "snapshots": self.snapshots, "sids": sids,
                "ticker_index": {t: [[S[a], S[b], sid] for a, b, sid in runs] for t, runs in sorted(self.at.items())},
                "holder": dict(sorted(self.holder.items()))}


def doc_hash(doc: dict) -> str:
    return hashlib.sha256(json.dumps(doc, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def ledger_key(state: IdentityState, sid: str, i: int, ledger_snap: str = "LEDGER") -> Optional[str]:
    """The key the ACCEPTED ledger used for this security on session i (the continuity bridge)."""
    for k, a, b, snap in state.sids[sid]["keys"]:
        if snap == ledger_snap and a <= i <= b:
            return k
    return None


class Bridge:
    """THE LIVE LOOKUP: (ticker, session) -> (SID, accepted-ledger key, venue status).

    Built from a persisted identity-state document and the ACCEPTED ledger rows. The vintage's own
    `ticker|delisted_utc` key is never consulted, so a reference snapshot learning a delisting date
    cannot move a security out of its exchange.
      * SID = the ticker's holder as of the session (latest ownership run starting on/before it —
        runs span non-trading gaps exactly as the accepted ledger rows do);
      * status = the ledger rows of whichever of the SID's ledger keys FOR THIS TICKER cover the session;
        none -> UNRESOLVED (security known, no evidence), two -> CONFLICT (fail closed),
        SID unknown / no ledger key at all -> absent.
    """

    def __init__(self, doc: dict, ledger_rows: Iterable[Sequence]):
        self.tidx = doc["ticker_index"]
        self.keys = {sid: sorted({k[0] for k in r["keys"] if k[3] == "LEDGER"}) for sid, r in doc["sids"].items()}
        self.rows: dict = {}
        for r in ledger_rows:
            self.rows.setdefault(r[0], []).append((r[2], r[3], r[4]))

    def sid(self, ticker: str, d: str) -> Optional[str]:
        best = None
        for a, _b, sid in self.tidx.get(ticker, ()):
            if a <= d:
                best = sid
        return best

    def status(self, ticker: str, d: str) -> tuple:
        sid = self.sid(ticker, d)
        if sid is None:
            return None, None, "absent"
        # venue evidence is per (ticker, period): a SID that carried another symbol (a rename whose old
        # symbol was later reused — IR -> TT, RBC -> RRX) must only read rows for THIS ticker
        keys = [k for k in self.keys.get(sid, ()) if k in self.rows and k.rsplit("|", 1)[0] == ticker]
        cov = [(k, st) for k in keys for f, t, st in self.rows[k] if f <= d <= t]
        if len(cov) == 1:
            return sid, cov[0][0], cov[0][1]
        if len(cov) > 1:
            return sid, "|".join(k for k, _ in cov), "CONFLICT"
        return sid, None, ("UNRESOLVED" if keys else "absent")
