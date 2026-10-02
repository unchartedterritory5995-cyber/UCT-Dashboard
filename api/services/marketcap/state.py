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


def _unit_signature(a: float, b: float) -> bool:
    """a / b is a power of 1,000 (thousands / millions mis-scaling) within ~15% (the count itself may have moved:
    EIG 2011 cover 34,878,399,000 against a state of 38,561,537 is x904)."""
    lr = math.log10(a / b)
    return any(abs(lr - k) < 0.06 for k in (3, -3, 6, -6))


def _chan(o: "Obs") -> tuple:
    """A CHANNEL is a source + concept; the rendered member suffix ("[entity]") and the ADS conversion tag are not a
    different channel (EIG: the companyfacts and the rendered cover of ONE filing 'corroborated' a x1000 count)."""
    import re as _re
    t = _re.sub(r"\[.*?\]", "", o.tag.split("/")[0])
    return (o.source, _re.sub(r"@\d+$", "", t))          # a text rule's byte offset is not a channel (PENN 2006/2009)


DISCONTINUITY = math.log10(3)        # a >= 3x move against the state in force needs independent corroboration
AGREE = math.log10(1.5)              # an observation corroborates another within 1.5x
CORROBORATE_DAYS = 200               # ... when their as-of dates are within this many days
TINY_RAW = 10_000                    # a REPORTED count below this is SUSPICIOUS (placeholder "1", "10", "100" ...)


def _okey(o: Obs) -> tuple:
    return (o.accn, o.as_of, o.source, o.value, o.tag)


def validate(obs: list[Obs], ledger: Ledger, conflict_tol: float = 0.10, dup_tol: float = 0.02,
             basis_evidence: dict | None = None) -> list[Checked]:
    """Iterates the point-in-time pass: counts found to be a unit-error LEVEL (see the post-pass) are excluded from
    anchoring anything and the pass re-runs, until no new unit-error level appears (at most 4 passes)."""
    quarantine: set = set()
    for _ in range(4):
        out, found = _validate_pass(obs, ledger, conflict_tol, dup_tol, basis_evidence, quarantine)
        if not (found - quarantine):
            return out
        quarantine |= found
    return out


def _validate_pass(obs: list[Obs], ledger: Ledger, conflict_tol: float, dup_tol: float,
                   basis_evidence: dict | None, quarantine: set) -> tuple[list, set]:
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
        other_channel = _chan(a) != _chan(b)
        if channel_only or a.accn == b.accn:
            return other_channel and (a.accn != b.accn or a.source != b.source)
        return other_channel or a.as_of != b.as_of

    def corroborated_at(o: Obs, val: float, channel_only: bool = False, other_filing: bool = False) -> date | None:
        """The earliest close at which an INDEPENDENT observation agreeing with `val` (1.5x) is public. With
        `other_filing` the corroboration must come from ANOTHER filing (a unit error repeats inside one filing)."""
        best = None
        for c, cb in cands:
            if c is o or not independent(o, c, channel_only) or (other_filing and c.accn == o.accn):
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
        if _okey(o) in quarantine:
            decided[i] = Checked(o, R.REJ_SCALE_UNRESOLVED, note="unit-error level (x1000 of a better-supported level)",
                                 block=(o.known_from, None, R.SCALE_UNRESOLVED))
            continue
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
            # another FILING and another CHANNEL: a pre-merger shell's cover and balance sheet both say "1,000 shares"
            # (RBBN, MLCI) or "1 share" (FTI) inside one filing -- that is not corroboration of a listed count
            t = corroborated_at(o, val, channel_only=True, other_filing=True)
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
            unit = ref is not None and _unit_signature(val, ref)
            tenx = ref is not None and _logr(val, ref) >= 1
            t = corroborated_at(o, val, channel_only=unit or tenx, other_filing=unit)
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
            unit_pair = _unit_signature(e.normalized, val) and {e.obs.source, o.source} == {R.COVER_XBRL, R.BALANCE_SHEET_XBRL}
            if q > conflict_tol and unit_pair:
                # ⛔ an exact x1000 disagreement between a filing's cover count and its balance-sheet count for the SAME
                # date is the balance sheet presented in thousands (SSYS 2013: cover 49,211,075 / balance sheet 49,211):
                # the COVER stands, the scaled count is refused (it never anchors later counts)
                if o.source == R.BALANCE_SHEET_XBRL:
                    c = Checked(o, R.REJ_SCALE_UNRESOLVED, val, pick, note=f"same as-of {o.as_of}: x1000 of the cover {e.normalized:.0f}")
                else:
                    decided[j] = replace(e, status=R.REJ_SCALE_UNRESOLVED, note=f"same as-of {o.as_of}: x1000 of the cover {val:.0f}",
                                         valid_until=None)
                continue
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

    # ⛔ UNIT / SCALE ERROR SIGNATURE (AMTX 32,564, HNRG 28,309, SSYS 49,328: counts filed IN THOUSANDS in BOTH the
    # cover and the balance sheet of one filing, so the two channels "corroborate" each other). A count that sits an
    # EXACT power of 1,000 away from the accepted counts of the filings on BOTH sides of it (which agree with each
    # other), or -- for the first count -- from the next two filings, is a unit error: it is WITHHELD over its
    # interval (blocking; never rescaled, nothing substituted). This uses later filings only to WITHHOLD.
    acc_order = sorted((j for j in decided if decided[j].usable), key=lambda j: (decided[j].obs.as_of, decided[j].obs.public_at))
    for n_, j in enumerate(acc_order):
        c = decided[j]
        others = [decided[x] for x in acc_order if decided[x].obs.accn != c.obs.accn and decided[x].usable]
        prev = [x for x in others if x.obs.as_of < c.obs.as_of][-1:]
        nxt = [x for x in others if x.obs.as_of > c.obs.as_of][:2]
        sides = prev + nxt[:1] if prev else nxt[:2]
        if len(sides) < 2 or not all(_unit_signature(c.normalized, x.normalized) for x in sides):
            continue
        if _logr(sides[0].normalized, sides[1].normalized) >= AGREE:
            continue
        decided[j] = replace(c, status=R.REJ_SCALE_UNRESOLVED, block=(c.effective_from, None, R.SCALE_UNRESOLVED),
                             note=f"unit-error signature: {c.normalized:.0f} vs {sides[0].normalized:.0f} / {sides[1].normalized:.0f}")

    # ⛔ TWO LEVELS AN EXACT x1000 APART: a level is as strong as its WEAKEST independence dimension -- min(distinct
    # filings, distinct channels) agreeing with it within 200 days. The weaker level is the unit error and its accepted
    # counts are withheld: SSYS 2013-14 balance sheet in thousands over 3 filings but 1 channel (1) vs the cover + a
    # later units balance sheet (2); BNTX 2021 cover x1000 (1) vs balance sheet + IPO prospectus (2). A tie decides
    # nothing (HNRG: two cover filings vs one filing's two channels -- the both-sides rule above withholds it).
    every = [(o_, cb) for o_, cb in cands]
    found: set = set()

    def _support(v: float, a: date) -> int:
        agree = [o_ for o_, cb in every if abs((o_.as_of - a).days) <= CORROBORATE_DAYS and any(_logr(x, v) < AGREE for x in cb.values())]
        return min(len({o_.accn for o_ in agree}), len({_chan(o_) for o_ in agree}))
    for j in [j for j in decided if decided[j].usable]:
        c = decided[j]
        rivals = [o_ for o_, cb in every if abs((o_.as_of - c.obs.as_of).days) <= CORROBORATE_DAYS
                  and any(_unit_signature(c.normalized, x) for x in cb.values())]
        if not rivals:
            continue
        mine = _support(c.normalized, c.obs.as_of)
        if any(_support(next(iter(bases(r).values())), r.as_of) > mine for r in rivals):
            found.add(_okey(c.obs))
            decided[j] = replace(c, status=R.REJ_SCALE_UNRESOLVED, block=(c.effective_from, None, R.SCALE_UNRESOLVED),
                                 note=f"unit-error level: {c.normalized:.0f} has fewer independent channels than its x1000 rival")

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
    return sorted(out, key=lambda c: key(c.obs)), found


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
    # (date, reason) or (date, reason, threshold): with a threshold the event stops only counts dated BEFORE it
    ev = sorted((e[0], e[1], e[2] if len(e) > 2 else None) for e in events)
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
        k = bisect.bisect_right(ev_days, d)
        hit = next((e for e in reversed(ev[:k]) if e[0] > c.obs.as_of and (e[2] is None or c.obs.as_of < e[2])), None)
        if age > bound_days:
            out.append(DayState(None, R.STALE, c.obs, age))
        elif hit is not None:
            out.append(DayState(None, hit[1], c.obs, age))
        else:
            out.append(DayState(c.normalized, None, c.obs, age))
    return out
