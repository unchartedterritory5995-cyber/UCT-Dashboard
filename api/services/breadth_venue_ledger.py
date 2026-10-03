"""THE POINT-IN-TIME VENUE LEDGER — which listing exchange a security was on, per session.

Exchange Breadth V1. Pure functions only: evidence in, change points out. No network, no store.

⭐⭐ WHY IT EXISTS. `breadth_pit_frame.reference_map` carries ONE `primary_exchange` per reference
record — today's venue for a live name, the last venue for a dead one — and the V2 `nyse`/`nasdaq`
universes applied it to every session. PEP was "Nasdaq" in 2012 (it moved 2017-12-20), WMT
"Nasdaq" in 2020 (moved 2025-12-09). ~200 listed common stocks a year 2008-2016 sat on the wrong
exchange. This module replaces that single field with dated evidence.

THE TWO EVIDENCE STREAMS (Phase 0, 2026-10-03):

  DATED   `/v3/reference/tickers?exchange=V&date=D` — the provider's listing on D, per venue.
          Names the venue (XNYS vs XASE vs ARCX …) — the ONLY source that can say "NYSE".
          ⚠ Nasdaq coverage is incomplete in early years (names listed nowhere on D).
  TAPE    the SIP tape on that session's trades: 3 = UTP = Nasdaq-listed; 1/2 = CTA = listed
          on a non-Nasdaq exchange. Assigned by the exchanges, flips on the exact transfer day.
          ⚠ It CANNOT say NYSE: CTA spans NYSE, NYSE American, NYSE Arca, Cboe, IEX.

⛔⛔ THE RESOLUTION RULES (deterministic, fail closed — no default venue, ever):

    dated XNYS   + tape CTA or none    → NYSE         (dated names it; tape agrees or is silent)
    dated XNAS   + tape UTP or none    → NASDAQ
    dated other  + tape CTA or none    → OTHER:<venue>
    dated none   + tape UTP            → NASDAQ       (tape alone suffices for Nasdaq)
    dated none   + tape CTA            → UNRESOLVED   (non-Nasdaq, but NOT provably NYSE)
    dated none   + tape none           → UNRESOLVED
    dated XNYS/other + tape UTP        → NASDAQ       (tape primary; the dated list LAGS transfers)
    dated XNAS   + tape CTA            → UNRESOLVED   (non-Nasdaq by tape, venue not nameable)
    two dated venues / unknown MIC / unknown tape value → CONFLICT

UNRESOLVED and CONFLICT sessions belong to NEITHER exchange universe and are counted.
NYSE is ONLY ever asserted from a dated XNYS listing; the tape can veto it, never create it.
"""
from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from typing import Iterable, Optional, Sequence

NYSE = "NYSE"
NASDAQ = "NASDAQ"
OTHER = "OTHER"
UNRESOLVED = "UNRESOLVED"
CONFLICT = "CONFLICT"

NASDAQ_MICS = frozenset({"XNAS", "XNGS", "XNMS", "XNCM"})
NYSE_MICS = frozenset({"XNYS"})
OTHER_MICS = frozenset({"XASE", "ARCX", "BATS", "IEXG"})
TAPE_UTP = 3                     # provider `tape` value for Nasdaq-listed (UTP plan)
TAPE_CTA = frozenset({1, 2})     # CTA plan: NYSE, NYSE American, Arca, Cboe, IEX

LEDGER_VERSION = "venue-ledger-v1"


def dated_class(venues: Iterable[str]) -> tuple[Optional[str], Optional[str]]:
    """(class, mic) from the dated listings of one ticker on one session.
    `(None, None)` = listed nowhere; `(CONFLICT, 'A|B')` = listed on two venues at once."""
    v = sorted({x for x in venues if x})
    if not v:
        return None, None
    if len(v) > 1:
        return CONFLICT, "|".join(v)
    m = v[0]
    if m in NYSE_MICS:
        return NYSE, m
    if m in NASDAQ_MICS:
        return NASDAQ, "XNAS"
    if m in OTHER_MICS:
        return OTHER, m
    return CONFLICT, m          # an unknown MIC is not guessed into a class


def tape_class(tape: Optional[int]) -> Optional[str]:
    if tape is None:
        return None
    if tape == TAPE_UTP:
        return "UTP"
    if tape in TAPE_CTA:
        return "CTA"
    return "UNKNOWN"


def classify(dated: tuple[Optional[str], Optional[str]], tape: Optional[int]) -> tuple[str, Optional[str], str]:
    """(status, mic, source) for one session. `status` ∈ NYSE/NASDAQ/OTHER/UNRESOLVED/CONFLICT."""
    dc, mic = dated
    tc = tape_class(tape)
    if tc == "UNKNOWN":
        return CONFLICT, mic, "tape:unknown"
    if dc == CONFLICT:
        return CONFLICT, mic, "dated:multi"
    # ⭐ THE TAPE IS PRIMARY FOR NASDAQ-vs-NOT (owner source hierarchy, 2026-10-03). Measured: where
    # the dated list disagrees with the tape, the dated list LAGS a real transfer — SEC Form 25 +
    # 8-A12B land 1-4 days before the tape flip on every case checked (CAR, WIN, DWA, SGC, CNET, FLL).
    if dc == NYSE:
        if tc == "UTP":
            return NASDAQ, "XNAS", "tape (dated lagging: XNYS)"
        return NYSE, mic, "dated+tape" if tc else "dated"
    if dc == NASDAQ:
        if tc == "CTA":
            # non-Nasdaq by the tape, but only the dated list can NAME a CTA venue: not provably NYSE
            return UNRESOLVED, None, "tape:CTA vs dated:XNAS (dated lagging)"
        return NASDAQ, mic, "dated+tape" if tc else "dated"
    if dc == OTHER:
        if tc == "UTP":
            return NASDAQ, "XNAS", f"tape (dated lagging: {mic})"
        return OTHER, mic, "dated+tape" if tc else "dated"
    # listed nowhere on this session
    if tc == "UTP":
        return NASDAQ, "XNAS", "tape"
    if tc == "CTA":
        return UNRESOLVED, None, "tape:CTA without dated venue"
    return UNRESOLVED, None, "no evidence"


@dataclass(frozen=True)
class ChangePoint:
    """One ledger row: `identity` is on `status`/`mic` from `effective_from` through `effective_to`
    (inclusive, session dates), on the evidence named in `source`."""
    identity: str
    ticker: str
    effective_from: str
    effective_to: str
    status: str
    mic: Optional[str]
    source: str
    evidence: tuple = field(default_factory=tuple)

    def row(self) -> list:
        return [self.identity, self.ticker, self.effective_from, self.effective_to,
                self.status, self.mic, self.source, list(self.evidence)]


def stretches(sessions: Sequence[str], dated_states: Sequence[tuple]) -> list[tuple[int, int, tuple]]:
    """Maximal runs of CONSECUTIVE member sessions with an identical dated state.
    `sessions` are one identity's member sessions (ascending), `dated_states[i]` its dated
    state on `sessions[i]`. Returns [(i_start, i_end, state)] in index space."""
    out = []
    if not sessions:
        return out
    a = 0
    for i in range(1, len(sessions) + 1):
        if i == len(sessions) or dated_states[i] != dated_states[a]:
            out.append((a, i - 1, dated_states[a]))
            a = i
    return out


def segment(identity: str, ticker: str, sessions: Sequence[str], dated_states: Sequence[tuple],
            tape_at: dict) -> list[ChangePoint]:
    """Change points for one identity.

    `tape_at` maps a session index → tape value (None if no trade found) for every index the
    acquisition probed: at minimum both ends of every dated stretch, plus any bisection points.
    A stretch whose ends disagree on tape class MUST have been bisected; the flip index is the
    first probed index carrying the later class. Segments are then classified per rule table.
    """
    cps: list[ChangePoint] = []
    for a, b, st in stretches(sessions, dated_states):
        probes = sorted(i for i in tape_at if a <= i <= b)
        # split the stretch wherever the probed tape CLASS changes (None does not split)
        cuts, last_cls, last_val = [a], None, None
        for i in probes:
            c = tape_class(tape_at[i])
            if c is None:
                continue
            if last_cls is not None and c != last_cls:
                cuts.append(i)
            last_cls = c
        cuts.append(b + 1)
        for x, y in zip(cuts, cuts[1:]):
            if x >= y:
                continue
            seg_probes = [tape_at[i] for i in probes if x <= i < y and tape_at[i] is not None]
            t = seg_probes[0] if seg_probes else None
            status, mic, source = classify(st, t)
            ev = tuple(sorted({f"tape@{sessions[i]}={tape_at[i]}" for i in probes if x <= i < y}))
            cps.append(ChangePoint(identity, ticker, sessions[x], sessions[y - 1], status, mic, source, ev))
    # merge adjacent identical classifications (a dated stretch boundary that changes nothing)
    merged: list[ChangePoint] = []
    for cp in cps:
        if merged and merged[-1].status == cp.status and merged[-1].mic == cp.mic \
                and merged[-1].source == cp.source:
            p = merged[-1]
            merged[-1] = ChangePoint(p.identity, p.ticker, p.effective_from, cp.effective_to,
                                     p.status, p.mic, p.source, tuple(sorted(set(p.evidence) | set(cp.evidence))))
        else:
            merged.append(cp)
    return merged


class Ledger:
    """Point-in-time lookup over change points. `status_on(identity, date)` is exact by session."""

    def __init__(self, rows: Iterable[Sequence]):
        self.by_id: dict[str, list[tuple]] = {}
        for r in rows:
            ident, tick, f, t, status, mic = r[0], r[1], r[2], r[3], r[4], r[5]
            self.by_id.setdefault(ident, []).append((f, t, status, mic))
        for v in self.by_id.values():
            v.sort()

    def status_on(self, identity: str, date: str) -> tuple[str, Optional[str]]:
        for f, t, status, mic in self.by_id.get(identity, ()):
            if f <= date <= t:
                return status, mic
        return UNRESOLVED, None

    def members(self, identities_on_date: dict, date: str, cls: str) -> set:
        """{ticker} of class `cls` on `date`, given {ticker: identity} for that session's population."""
        return {tk for tk, ident in identities_on_date.items() if self.status_on(ident, date)[0] == cls}


def canonical_bytes(rows: Iterable[Sequence]) -> bytes:
    return json.dumps(sorted([list(r) for r in rows]), separators=(",", ":"), sort_keys=True).encode()


def ledger_hash(rows: Iterable[Sequence]) -> str:
    return hashlib.sha256(canonical_bytes(rows)).hexdigest()


def identity_of(ticker: str, record: Optional[dict]) -> str:
    """V2's identity unit: provider ticker + the reference record `breadth_pit_frame.resolve` picks.
    Records are distinguished by their delisting date (the list endpoint carries no list_date)."""
    du = (record or {}).get("delisted_utc") or "active"
    return f"{ticker}|{du}"
