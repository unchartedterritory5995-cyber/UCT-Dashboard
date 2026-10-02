"""Share STATE: validate share-count observations, then select the authoritative state per trading day.

A share count is a STATE, not a flow: the last defensible actual-outstanding count
stays authoritative until it is SUPERSEDED (a newer as-of becomes public),
INVALIDATED (listing ends / identity changes) or exceeds the SAFETY BOUND
(456 days after its as-of date). See the design doc sections 3-6.

Everything here is pure: callers supply observations, a split ledger bounded to
the security's listing interval, and the trading days to evaluate.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field, replace
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from api.services.fundamentals_pit.splits import Ledger

from . import reasons as R

ET = ZoneInfo("America/New_York")
CLOSE_ET = time(16, 0)


@dataclass(frozen=True)
class Obs:
    """One candidate share-count observation, exactly as the source reported it."""
    as_of: date
    public_at: datetime              # aware UTC; the earliest instant the value was public
    value: float                     # raw reported count (already scaled to units of shares)
    source: str                      # reasons.COVER_XBRL / COVER_TEXT / BALANCE_SHEET_XBRL / IPO_PROSPECTUS
    accn: str
    form: str
    tag: str = ""                    # XBRL concept or text-location descriptor
    class_key: str = "COMMON"
    snippet: str = ""                # text evidence (pre-XBRL / IPO)
    confidence: str = "HIGH"

    @property
    def rank(self) -> int:
        return R.RANK[self.source]

    @property
    def known_from(self) -> date:
        """First trading date whose CLOSE may use the value (public by 16:00 ET that day)."""
        et = self.public_at.astimezone(ET)
        return et.date() if et.time() <= CLOSE_ET else et.date() + timedelta(days=1)

    @property
    def is_amendment(self) -> bool:
        return self.form.endswith("/A")


@dataclass
class Checked:
    obs: Obs
    status: str
    normalized: float | None = None  # shares on TODAY's split basis
    basis: str = "AS_OF"             # AS_OF | PUBLIC (value was already restated past a split)
    flags: list = field(default_factory=list)
    note: str = ""
    # ⭐ POINT-IN-TIME usability. effective_from: the first close the value may be USED -- its own known_from, or LATER
    # when it needed corroboration that only became public later (never earlier). valid_until (exclusive): a later
    # public contradiction revokes it from that close on. block: (from, until|None, reason) -- a refused count still
    # tells us the state in force is SUPERSEDED (a newer count exists that we cannot use), so it BLOCKS every older
    # state over that interval instead of letting a stale count carry on.
    effective_from: date | None = None
    valid_until: date | None = None
    block: tuple | None = None

    @property
    def usable(self) -> bool:
        return self.status in (R.ACCEPTED, R.ACCEPTED_RESTATED_BASIS)


def _logr(a: float, b: float) -> float:
    return abs(math.log10(a / b))


DISCONTINUITY = math.log10(3)        # a >= 3x move against the state in force needs independent corroboration
AGREE = math.log10(1.5)              # an observation corroborates another within 1.5x
CORROBORATE_DAYS = 200               # ... when their as-of dates are within this many days
TINY_RAW = 10_000                    # a REPORTED count below this is SUSPICIOUS (placeholder "1", "10", "100" ...)


def validate(obs: list[Obs], ledger: Ledger, conflict_tol: float = 0.10, dup_tol: float = 0.02,
             basis_evidence: dict | None = None) -> list[Checked]:
    """Classify every observation, strictly POINT IN TIME: a decision about an observation uses only what was public
    by its own known_from -- or, when it needs corroboration, it becomes usable only once that corroboration is public.
    Deterministic: input order does not matter.

    1. non-positive -> rejected;
    2. one filing stating several different values for one as-of -> every one refused, BLOCKING (the filing does not
       say which is this security's count);
    3. per (as_of, source) the EARLIEST public report is the primary; a later re-report that agrees is redundant; one
       that differs supersedes only when it is an amendment (/A), otherwise it is refused;
    4. split basis: a value whose as-of precedes a split that was effective before it became public may already be
       restated. Filing-text evidence decides it (`basis_evidence` {accession: AS_OF|PUBLIC}); otherwise the state IN
       FORCE at its public time decides it when decisive; otherwise refused (SPLIT_BASIS_UNRESOLVED, blocking). Never a
       later observation (that was lookahead);
    5. SUSPICIOUS: a reported count below 10,000 shares is used only when an independent CHANNEL (another source type
       or concept) corroborates it within 1.5x; otherwise refused, blocking (SUSPICIOUS_SHARE_COUNT);
    6. DISCONTINUITY / SCALE: a >= 3x move against the state in force (or, with none, a >= 3x contradiction inside its
       own filing) is used only once independent evidence agreeing within 1.5x is public -- until then the interval is
       blocked (SHARE_COUNT_SCALE_UNRESOLVED). Nothing is ever multiplied or divided to fit;
    7. same as-of, different sources, > conflict_tol apart -> the later-known one is refused and the earlier one is
       revoked from that moment (both are fine before the contradiction exists).
    """
    out: list[Checked] = []
    basis_evidence = basis_evidence or {}
    key = lambda o: (o.as_of, o.public_at, o.rank, o.accn, o.value)
    pool = sorted(obs, key=key)
    groups: dict[tuple, list[Obs]] = {}
    for o in pool:
        if not (o.value > 0 and math.isfinite(o.value)):
            out.append(Checked(o, R.REJ_NONPOSITIVE))
            continue
        groups.setdefault((o.as_of, o.source), []).append(o)

    def bases(o: Obs) -> dict[str, float]:
        a = o.value * ledger.factor_after(o.as_of)
        b = o.value * ledger.factor_after(o.public_at.astimezone(ET).date())
        return {"AS_OF": a} if abs(a / b - 1) < 1e-9 else {"AS_OF": a, "PUBLIC": b}

    cands = [(o, bases(o)) for grp in groups.values() for o in grp]

    # ⛔ ONE FILING, ONE AS-OF, SEVERAL DIFFERENT VALUES (a combined filing's entities, an unlabelled class split):
    # the filing itself does not say which is this security's count -> every one is refused. Never resolved by
    # sort order (it used to pick the SMALLEST: AEP 2011 took a subsidiary's 1,400,000 over the parent's 482M).
    for gk in list(groups):
        grp = groups[gk]
        by_accn: dict[str, set] = {}
        for o in grp:
            by_accn.setdefault(o.accn, set()).add(round(o.value))
        bad = {a for a, vs in by_accn.items() if len(vs) > 1 and max(vs) / max(1, min(vs)) - 1 > dup_tol}
        if bad:
            for o in grp:
                if o.accn in bad:
                    out.append(Checked(o, R.REJ_CONFLICT, note=f"one filing states {sorted(by_accn[o.accn])} for {o.as_of}",
                                       block=(o.known_from, None, R.SOURCE_CONFLICT)))
            groups[gk] = [o for o in grp if o.accn not in bad]
            if not groups[gk]:
                del groups[gk]

    prim: list[tuple[Obs, list[Obs]]] = [(grp[0], grp[1:]) for grp in groups.values()]

    def independent(a: Obs, b: Obs, channel_only: bool = False) -> bool:
        other_channel = a.source != b.source or a.tag.split("/")[0] != b.tag.split("/")[0]
        if channel_only or a.accn == b.accn:
            return other_channel and (a.accn != b.accn or a.source != b.source)
        return other_channel or a.as_of != b.as_of

    def corroborated_at(o: Obs, val: float, channel_only: bool = False) -> date | None:
        """The earliest close at which an INDEPENDENT observation agreeing with `val` (1.5x) is public."""
        best = None
        for c, cb in cands:
            if c is o or not independent(o, c, channel_only):
                continue
            if abs((c.as_of - o.as_of).days) > CORROBORATE_DAYS:
                continue
            if not any(_logr(v, val) < AGREE for v in cb.values()):
                continue
            t = max(o.known_from, c.known_from)
            if best is None or t < best:
                best = t
        return best

    decided: dict[int, Checked] = {}
    accepted: list[int] = []

    def in_force(t: date) -> Checked | None:
        best = None
        for j in accepted:
            c = decided[j]
            if not c.usable or c.effective_from > t or (c.valid_until is not None and c.valid_until <= t):
                continue
            if best is None or (c.obs.as_of, -c.obs.rank, c.obs.public_at) > (best.obs.as_of, -best.obs.rank, best.obs.public_at):
                best = c
        return best

    order = sorted(range(len(prim)), key=lambda i: (prim[i][0].known_from, prim[i][0].as_of, prim[i][0].rank, prim[i][0].accn))
    for i in order:
        o = prim[i][0]
        t0 = o.known_from
        b = bases(o)
        cur = in_force(t0)
        ref = cur.normalized if cur else None
        if len(b) == 2:
            ev = basis_evidence.get(o.accn)
            if ev in b:
                pick = ev
            elif ref is None:
                decided[i] = Checked(o, R.REJ_BASIS_AMBIGUOUS, note="split between as-of and publication; no state in force",
                                     block=(t0, None, R.SPLIT_BASIS_UNRESOLVED))
                continue
            else:
                da, dp = _logr(b["AS_OF"], ref), _logr(b["PUBLIC"], ref)
                best_, other = min(da, dp), max(da, dp)
                if not (best_ < math.log10(1.5) and other - best_ > math.log10(1.5)):
                    decided[i] = Checked(o, R.REJ_BASIS_AMBIGUOUS, block=(t0, None, R.SPLIT_BASIS_UNRESOLVED),
                                         note=f"as_of basis {b['AS_OF']:.0f} vs public basis {b['PUBLIC']:.0f} vs state {ref:.0f}")
                    continue
                pick = "AS_OF" if da < dp else "PUBLIC"
            val = b[pick]
            st = R.ACCEPTED if pick == "AS_OF" else R.ACCEPTED_RESTATED_BASIS
        else:
            val, pick, st = b["AS_OF"], "AS_OF", R.ACCEPTED
        c = Checked(o, st, val, pick, effective_from=t0)
        if o.value < TINY_RAW:
            t = corroborated_at(o, val, channel_only=True)
            if t is None:
                decided[i] = Checked(o, R.REJ_SUSPICIOUS, val, pick, note=f"reported {o.value:g} shares, uncorroborated",
                                     block=(t0, None, R.SUSPICIOUS_SHARE_COUNT))
                continue
            c.effective_from = max(c.effective_from, t)
            c.flags.append("CORROBORATED_SMALL_COUNT")
        contra = None
        if ref is not None and _logr(val, ref) >= DISCONTINUITY:
            contra = f"{val:.0f} vs state in force {ref:.0f}"
        elif ref is None and any(c2.accn == o.accn and c2.source != o.source and min(_logr(v, val) for v in cb.values()) >= DISCONTINUITY
                                 for c2, cb in cands):
            contra = "contradicted >= 3x inside its own filing"
        if contra:
            t = corroborated_at(o, val)
            if t is None:
                decided[i] = Checked(o, R.REJ_SCALE_UNRESOLVED, val, pick, note=contra + "; no independent corroboration",
                                     block=(t0, None, R.SCALE_UNRESOLVED))
                continue
            c.flags.append(R.FLAG_LARGE_CHANGE)
            c.note = contra + f"; corroborated from {t}"
            c.effective_from = max(c.effective_from, t)
        if c.effective_from > t0:
            c.block = (t0, c.effective_from, R.SCALE_UNRESOLVED if contra else R.SUSPICIOUS_SHARE_COUNT)
        # same as-of, another source, materially different: contradiction from the moment both are public
        for j in list(accepted):
            e = decided[j]
            if not e.usable or e.obs.as_of != o.as_of or e.obs.source == o.source:
                continue
            q = max(e.normalized, val) / min(e.normalized, val) - 1
            if q > conflict_tol:
                when = max(t0, e.effective_from)
                if e.effective_from >= when:
                    decided[j] = replace(e, status=R.REJ_CONFLICT, note=f"same as-of {o.as_of}: {e.normalized:.0f} vs {val:.0f}",
                                         block=(e.obs.known_from, None, R.SOURCE_CONFLICT))
                else:
                    e.valid_until = when if e.valid_until is None else min(e.valid_until, when)
                    e.flags.append("REVOKED_BY_CONTRADICTION")
                c = Checked(o, R.REJ_CONFLICT, val, pick, note=f"same as-of {o.as_of}: {e.normalized:.0f} vs {val:.0f}",
                            block=(t0, None, R.SOURCE_CONFLICT))
            elif q > dup_tol:
                c.flags.append(R.SOURCE_CONFLICT)
        decided[i] = c
        if c.usable:
            accepted.append(i)

    for i, (o, rest) in enumerate(prim):
        c = decided[i]
        out.append(c)
        for r in rest:
            rb = bases(r)
            if not c.usable:
                out.append(Checked(r, c.status, note="re-report of a refused primary"))
                continue
            match = [k for k, v in rb.items() if abs(v / c.normalized - 1) <= dup_tol]
            if match:
                out.append(Checked(r, R.ACCEPTED, rb[match[0]], match[0], ["REDUNDANT"], effective_from=r.known_from))
            elif r.is_amendment:
                k = min(rb, key=lambda k: _logr(rb[k], c.normalized))
                if _logr(rb[k], c.normalized) >= DISCONTINUITY:
                    out.append(Checked(r, R.REJ_SCALE_UNRESOLVED, note="amendment moves the count >= 3x",
                                       block=(r.known_from, None, R.SCALE_UNRESOLVED)))
                else:
                    out.append(Checked(r, R.ACCEPTED, rb[k], k, ["AMENDS"], effective_from=r.known_from))
            else:
                out.append(Checked(r, R.REJ_CONFLICT, note=f"re-report {r.value:.0f} differs from primary"))
    return sorted(out, key=lambda c: key(c.obs))


@dataclass(frozen=True)
class DayState:
    value: float | None               # shares, today's basis
    reason: str | None                # set when value is None
    obs: Obs | None = None            # the selected observation (provenance)
    age_days: int | None = None


def timeline(checked: list[Checked], days: list[date], edgar_complete: date | None = None,
             bound_days: int = R.SAFETY_BOUND_DAYS, events: list | tuple = ()) -> list[DayState]:
    """Authoritative state per trading day (days ascending).

    At day D, among every usable count EFFECTIVE by D's close (and not revoked) and every BLOCK active at D: the LATEST
    as-of wins (ties: source rank, then the latest public; a block wins an exact tie). A winning block withholds the
    day with its reason. `events` [(date, reason)] are corporate actions (a reverse split, a suspected unlisted split)
    across which a count dated BEFORE the event is never carried: from the event on, that count withholds with the
    event's reason until a count dated on/after it is effective. Days before any evidence are PRE_EDGAR while EDGAR
    did not yet cover the issuer (1996-05-06 domestic, 2002-05-06 foreign private issuers), PRE_FIRST after that.
    """
    import bisect
    import heapq
    edgar = edgar_complete or date.fromisoformat(R.EDGAR_COMPLETE)
    entries = []
    for c in checked:
        rank_key = (c.obs.as_of, -c.obs.rank, c.obs.public_at)
        if c.usable and "REDUNDANT" not in c.flags and c.effective_from is not None:
            if c.valid_until is None or c.valid_until > c.effective_from:
                entries.append((c.effective_from, c.valid_until, rank_key + (0,), c, None))
        if c.block:
            f, u, why = c.block
            if u is None or u > f:
                entries.append((f, u, rank_key + (1,), c, why))
    entries.sort(key=lambda e: e[0])
    ev = sorted(events)
    ev_days = [e[0] for e in ev]
    active: list = []
    expiry: list = []
    best = None
    p = 0
    out: list[DayState] = []
    for d in days:
        changed = False
        while p < len(entries) and entries[p][0] <= d:
            active.append(entries[p])
            if entries[p][1] is not None:
                heapq.heappush(expiry, entries[p][1])
            p += 1
            changed = True
        if expiry and expiry[0] <= d:
            while expiry and expiry[0] <= d:
                heapq.heappop(expiry)
            active = [e for e in active if e[1] is None or e[1] > d]
            changed = True
        if changed:
            best = max(active, key=lambda e: e[2]) if active else None
        if best is None:
            out.append(DayState(None, R.PRE_EDGAR if d < edgar else R.PRE_FIRST))
            continue
        c = best[3]
        if best[4]:
            out.append(DayState(None, best[4], c.obs))
            continue
        age = (d - c.obs.as_of).days
        k = bisect.bisect_right(ev_days, d) - 1
        if age > bound_days:
            out.append(DayState(None, R.STALE, c.obs, age))
        elif k >= 0 and ev_days[k] > c.obs.as_of:
            out.append(DayState(None, ev[k][1], c.obs, age))
        else:
            out.append(DayState(c.normalized, None, c.obs, age))
    return out
