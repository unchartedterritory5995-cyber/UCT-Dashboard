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

    @property
    def usable(self) -> bool:
        return self.status in (R.ACCEPTED, R.ACCEPTED_RESTATED_BASIS)


def _logr(a: float, b: float) -> float:
    return abs(math.log10(a / b))


def _is_scale_error(v: float, ref: float) -> bool:
    lr = math.log10(v / ref)
    return any(abs(lr - k) < 0.05 for k in (3, -3, 6, -6))


def validate(obs: list[Obs], ledger: Ledger, conflict_tol: float = 0.10, dup_tol: float = 0.02) -> list[Checked]:
    """Classify every observation. Deterministic: input order does not matter.

    1. non-positive -> rejected;
    2. per (as_of, source) the EARLIEST public report is the primary; a later re-report that agrees is
       redundant (kept for provenance, status ACCEPTED, not a new state); one that differs supersedes only
       when it is an amendment (/A), otherwise it is a SOURCE_CONFLICT;
    3. split basis: a value whose as-of precedes a split that was effective before it became public may
       already be restated; both bases are tested against the neighbouring accepted states, the consistent
       one wins, an undecidable one is refused (false negative over false positive);
    4. scale: a 10^3/10^6 jump against the neighbouring accepted state -> rejected; a > 3x move that
       reverts at the next observation -> isolated outlier, rejected; any other > 3x move is kept and flagged;
    5. same as-of, different sources, > conflict_tol apart -> both refused.
    """
    out: list[Checked] = []
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
                    out.append(Checked(o, R.REJ_CONFLICT, note=f"one filing states {sorted(by_accn[o.accn])} for {o.as_of}"))
            groups[gk] = [o for o in grp if o.accn not in bad]
            if not groups[gk]:
                del groups[gk]

    # primaries (one chain entry per (as_of, source), amendments may replace the value later)
    prim: list[tuple[Obs, list[Obs]]] = []
    for (_d, _s), grp in sorted(groups.items(), key=lambda kv: (kv[0][0], R.RANK[kv[0][1]])):
        prim.append((grp[0], grp[1:]))

    # sequential basis + scale validation over primaries in as-of order
    accepted_vals: list[tuple[date, float]] = []
    decided: dict[int, Checked] = {}
    order = list(range(len(prim)))

    def ref_near(i: int) -> float | None:
        if accepted_vals:
            return accepted_vals[-1][1]
        # no earlier accepted state: use the next primary with an unambiguous basis
        for j in range(i + 1, len(prim)):
            bj = bases(prim[j][0])
            if len(bj) == 1:
                return bj["AS_OF"]
        return None

    def next_val(i: int) -> float | None:
        for j in range(i + 1, len(prim)):
            bj = bases(prim[j][0])
            if len(bj) == 1:
                return bj["AS_OF"]
        return None

    for i in order:
        o = prim[i][0]
        b = bases(o)
        ref = ref_near(i)
        if len(b) == 2:
            if ref is None:
                decided[i] = Checked(o, R.REJ_BASIS_AMBIGUOUS, note="no neighbouring state to decide split basis")
                continue
            da, dp = _logr(b["AS_OF"], ref), _logr(b["PUBLIC"], ref)
            pick = "AS_OF" if da < dp else "PUBLIC"
            best, other = min(da, dp), max(da, dp)
            if not (best < math.log10(1.5) and other - best > math.log10(1.5)):
                decided[i] = Checked(o, R.REJ_BASIS_AMBIGUOUS,
                                     note=f"as_of basis {b['AS_OF']:.0f} vs public basis {b['PUBLIC']:.0f} vs ref {ref:.0f}")
                continue
            val = b[pick]
            st = R.ACCEPTED if pick == "AS_OF" else R.ACCEPTED_RESTATED_BASIS
        else:
            val, pick, st = b["AS_OF"], "AS_OF", R.ACCEPTED
        c = Checked(o, st, val, pick)
        if ref is not None:
            if _is_scale_error(val, ref):
                decided[i] = Checked(o, R.REJ_BAD_SCALE, note=f"{val:.0f} vs neighbour {ref:.0f}")
                continue
            if _logr(val, ref) > math.log10(3):
                nv = next_val(i)
                if accepted_vals and nv is not None and _logr(nv, ref) < math.log10(1.5):
                    decided[i] = Checked(o, R.REJ_OUTLIER, note=f"{val:.0f} vs {ref:.0f}, next {nv:.0f} reverts")
                    continue
                c.flags.append(R.FLAG_LARGE_CHANGE)
        decided[i] = c
        accepted_vals.append((o.as_of, val))

    # same-as-of cross-source conflicts
    by_asof: dict[date, list[int]] = {}
    for i, (o, _r) in enumerate(prim):
        if decided[i].usable:
            by_asof.setdefault(o.as_of, []).append(i)
    for d, idx in by_asof.items():
        if len(idx) > 1:
            vals = [decided[i].normalized for i in idx]
            if max(vals) / min(vals) - 1 > conflict_tol:
                for i in idx:
                    decided[i] = replace(decided[i], status=R.REJ_CONFLICT,
                                         note=f"same as-of {d}: {sorted(round(v) for v in vals)}")
            elif max(vals) / min(vals) - 1 > dup_tol:
                for i in idx:
                    decided[i].flags.append(R.SOURCE_CONFLICT)

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
                out.append(Checked(r, R.ACCEPTED, rb[match[0]], match[0],
                                   ["REDUNDANT"]))
            elif r.is_amendment:
                k = min(rb, key=lambda k: _logr(rb[k], c.normalized))
                if _is_scale_error(rb[k], c.normalized):
                    out.append(Checked(r, R.REJ_BAD_SCALE, note="amendment scale"))
                else:
                    out.append(Checked(r, R.ACCEPTED, rb[k], k, ["AMENDS"]))
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
             bound_days: int = R.SAFETY_BOUND_DAYS) -> list[DayState]:
    """Authoritative state per trading day (days ascending).

    Selection at day D among usable observations known by D's close: the LATEST as-of; ties by source rank,
    then the latest public (an amendment supersedes its original from its own publication onward).
    Days before any evidence are PRE_EDGAR while EDGAR did not yet cover the issuer (1996-05-06 domestic,
    2002-05-06 foreign private issuers), PRE_FIRST_AUTHORITATIVE_SHARE_EVIDENCE after that.
    """
    edgar = edgar_complete or date.fromisoformat(R.EDGAR_COMPLETE)
    usable = sorted((c for c in checked if c.usable and "REDUNDANT" not in c.flags),
                    key=lambda c: c.obs.known_from)
    best: Checked | None = None
    p = 0
    out: list[DayState] = []

    def better(a: Checked, b: Checked | None) -> bool:
        if b is None:
            return True
        ka = (a.obs.as_of, -a.obs.rank, a.obs.public_at)
        kb = (b.obs.as_of, -b.obs.rank, b.obs.public_at)
        return ka > kb

    for d in days:
        while p < len(usable) and usable[p].obs.known_from <= d:
            if better(usable[p], best):
                best = usable[p]
            p += 1
        if best is None:
            pre = d < edgar
            out.append(DayState(None, R.PRE_EDGAR if pre else R.PRE_FIRST))
            continue
        age = (d - best.obs.as_of).days
        if age > bound_days:
            out.append(DayState(None, R.STALE, best.obs, age))
        else:
            out.append(DayState(best.normalized, None, best.obs, age))
    return out
