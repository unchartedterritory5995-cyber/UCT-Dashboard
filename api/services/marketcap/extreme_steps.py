"""THE extreme-step evidence rule -- one implementation, used by the BUILD (to withhold) and by the VALIDATOR (to classify
what the build serves). Nothing else may re-implement it.

A >= 10x step in market cap between consecutive VALUED days that the price does not explain is a DETECTOR, never authority.
The step is settled by the evidence behind the two share states:

  1. CORROBORATION  each side's state (every class run in force) must be corroborated: another filing's observation of the
                    same class (any status except a conflict / invalid unit / non-positive) dated within 400 days agrees
                    within 1.5x. An uncorroborated side is UNPROVEN_ISOLATED and that side's run is withheld
                    (HR 2006: 15,200 shares; RJF 1995: a truncated "1,249,014"; GNLN 2025: 223 split-adjusted shares).
  2. BRIDGED        one class on both sides and every move along the path of ACCEPTED issuer counts between the two as-of
                    dates is < 10x: PROVEN (gradual issuance). Rejected observations never bridge.
  3. CAPITAL EVENT  a capital-event filing (offering, combination, tender, registration) dated after the earlier count and
                    on/before the later one, or the later count's own source filing being one, explains the step only when
                    the count ROSE and the two counts are at most 730 days apart: PROVEN. Issuance never makes a count fall
                    10x, and "some offering between" two counts years apart is not evidence of this step.
  4. SPLIT-LIKE     otherwise, with no ledger / evidence split between the counts, a FALL, or a ratio within 3% of a common
                    split factor, is a split the ledger lacks: UNPROVEN_SPLIT_LIKE, every day before the later state is
                    withheld (CMCL 487.9M -> 19.2M; RIME 2022 x1/12).
  5. otherwise      UNPROVEN: the earlier state's run is withheld.

FIXED POINT. Withholding days changes which days are adjacent, so the rule is re-evaluated until no step is unproven.
Every iteration only REMOVES valued days (it never restores one), and each productive iteration removes at least one, so
the process terminates in at most len(caps) iterations; exceeding that is an impossible state and fails the build.
"""
from __future__ import annotations

import math
from datetime import date

from . import reasons as R

SEMANTICS_VERSION = "XSTEP-2026-10-03.1"
STEP_FACTOR = 10.0
CORROBORATE_DAYS = 400
CORROBORATE_AGREE = 1.5
EVENT_WINDOW_DAYS = 730
SPLIT_FACTOR_TOL = 0.03
OFFERING_FORMS = frozenset({"424B1", "424B3", "424B4", "424B5", "424B7", "S-1", "S-1/A", "F-1", "F-1/A", "S-3", "S-3/A",
                            "F-3", "F-3/A", "S-4", "S-4/A", "F-4", "F-4/A", "S-1MEF", "F-1MEF"})
CAPITAL_EVENT_FORMS = OFFERING_FORMS | frozenset({"424B2", "425", "8-K12B", "8-K12G3", "SC TO-I", "SC TO-I/A", "DEFM14A",
                                                   "PREM14A", "DEF 14C", "10-12B"})
COMMON_SPLIT_FACTORS = (2, 3, 4, 5, 6, 7, 8, 10, 12, 15, 16, 20, 25, 30, 35, 40, 50, 60, 75, 80, 100)
BRIDGE_STATUSES = (R.ACCEPTED, R.ACCEPTED_RESTATED_BASIS)
EXCLUDED_STATUSES = (R.REJ_CONFLICT, R.REJ_INVALID_UNIT, R.REJ_NONPOSITIVE)

# obs_rows are observation rows in the build's table layout:
#   1 issuer_id, 3 class_key, 4 as_of, 8 normalized_value, 13 accession, 14 form, 18 validation_status
# runs_by_class: {(issuer_id, class_key): [(start, end, shares, accession, as_of, source), ...]}


def usable_rows(rows: list) -> list:
    return [r for r in rows if r[8] and r[18] not in EXCLUDED_STATUSES]


def unexplained_ratio(caps: dict, pclose: dict, a: date, b: date) -> float | None:
    if not (pclose.get(a) and pclose.get(b) and caps.get(a) and caps.get(b) and caps[a] > 0 and caps[b] > 0):
        return None
    return (caps[b] / caps[a]) / (pclose[b] / pclose[a])


def _side(runs_by_class: dict, d: date) -> list:
    ds = d.isoformat()
    return [(ck, r) for (_iss, ck), rs in runs_by_class.items() for r in rs if r[0] <= ds <= r[1]]


def _corroborated(ck: str, r: tuple, obs_rows: list) -> list:
    a = date.fromisoformat(r[4])
    return [o[13] for o in obs_rows if o[3] == ck and o[13] != r[3] and o[8]
            and abs((date.fromisoformat(o[4]) - a).days) <= CORROBORATE_DAYS
            and abs(math.log(o[8] / r[2])) < math.log(CORROBORATE_AGREE)]


def step_verdict(sa: list, sb: list, q: float, obs_rows: list, ev_forms: list, known_splits: list) -> dict:
    """The verdict on ONE step between the states `sa` (earlier valued day) and `sb` (later), [(class_key, run)].
    `ev_forms` [(filing_date iso, form)] of the issuer's capital-event filings; `known_splits` [ex_date iso]."""
    out = {"semantics": SEMANTICS_VERSION, "unexplained_ratio": q}
    bad = [(ck, r) for ck, r in sa + sb if not _corroborated(ck, r, obs_rows)]
    if bad:
        out.update(verdict="UNPROVEN_ISOLATED", isolated=[(ck, r[3], r[4], r[2]) for ck, r in bad])
        return out
    out["corroboration"] = {f"{ck}@{r[4]}": sorted(set(_corroborated(ck, r, obs_rows)))[:5] for ck, r in sa + sb}
    tot_a, tot_b = sum(r[2] for _c, r in sa), sum(r[2] for _c, r in sb)
    ratio = tot_b / tot_a
    asof_a = max(r[4] for _c, r in sa)
    asof_b = min(r[4] for _c, r in sb)
    out.update(share_ratio=ratio, asof_a=asof_a, asof_b=asof_b)
    bridged = False
    if len(sa) == 1 and len(sb) == 1 and sa[0][0] == sb[0][0]:
        ck = sa[0][0]
        mids = sorted((o[4], o[8]) for o in obs_rows if o[3] == ck and asof_a <= o[4] <= asof_b and o[18] in BRIDGE_STATUSES)
        vals = [sa[0][1][2]] + [v for _d, v in mids] + [sb[0][1][2]]
        bridged = all(abs(math.log(y / x)) < math.log(STEP_FACTOR) for x, y in zip(vals, vals[1:]))
        out["bridge_path"] = [round(v) for v in vals][:30]
    if bridged:
        out.update(verdict="PROVEN", basis="BRIDGED")
        return out
    src_b_form = next((o[14] for o in obs_rows if o[13] == sb[0][1][3]), None)
    events = [(fd, f) for fd, f in ev_forms if asof_a < fd <= asof_b]
    if src_b_form in CAPITAL_EVENT_FORMS:
        events.append((asof_b, src_b_form))
    span = (date.fromisoformat(asof_b) - date.fromisoformat(asof_a)).days
    if events and ratio > 1 and span <= EVENT_WINDOW_DAYS:
        out.update(verdict="PROVEN", basis="CAPITAL_EVENT", events=events[:20], span_days=span)
        return out
    out.update(rejected_events=events[:10], span_days=span)
    k = max(ratio, 1 / ratio)
    split_between = any(asof_a < s <= asof_b for s in known_splits)
    if not split_between and (ratio < 1 or any(abs(math.log(k / f)) < SPLIT_FACTOR_TOL for f in COMMON_SPLIT_FACTORS)):
        out.update(verdict="UNPROVEN_SPLIT_LIKE")
        return out
    out.update(verdict="UNPROVEN")
    return out


def steps(caps: dict, pclose: dict, runs_by_class: dict, obs_rows: list, ev_forms: list, known_splits: list):
    """Every >= 10x unexplained step between consecutive valued days with its verdict: [(a, b, verdict dict)]."""
    days = sorted(caps)
    out = []
    for a, b in zip(days, days[1:]):
        q = unexplained_ratio(caps, pclose, a, b)
        if q is None or abs(math.log(q)) < math.log(STEP_FACTOR):
            continue
        sa, sb = _side(runs_by_class, a), _side(runs_by_class, b)
        if not sa or not sb:
            continue
        v = step_verdict(sa, sb, q, obs_rows, ev_forms, known_splits)
        v["_sa"], v["_sb"] = sa, sb
        out.append((a, b, v))
    return out


def withhold_for(days: list, a: date, b: date, v: dict) -> dict:
    """{day: (reason, note)} that the verdict on the step a -> b withholds."""
    if v["verdict"] == "UNPROVEN_ISOLATED":
        hold = {}
        for ck, accn, as_of, sh in v["isolated"]:
            run = next(r for c, r in v["_sa"] + v["_sb"] if c == ck and r[3] == accn and r[4] == as_of)
            for d in days:
                if run[0] <= d.isoformat() <= run[1]:
                    hold[d] = (R.SCALE_UNRESOLVED, f"ISOLATED_EXTREME_STATE {ck} {sh:.0f} (as of {as_of}, {accn}): no independent "
                                                   f"filing agrees within {CORROBORATE_DAYS} days; cap step x{v['unexplained_ratio']:.3g}")
        return hold
    if v["verdict"] == "UNPROVEN_SPLIT_LIKE":
        return {d: (R.HIST_SPLIT_UNRESOLVED, f"SPLIT_LIKE_EXTREME_STEP x{v['share_ratio']:.4g} between {v['asof_a']} and "
                                             f"{v['asof_b']}: no ledger or issuer split, no capital event") for d in days if d < b}
    if v["verdict"] == "UNPROVEN":
        return {d: (R.SCALE_UNRESOLVED, f"UNPROVEN_EXTREME_STEP x{v['share_ratio']:.4g} between {v['asof_a']} and {v['asof_b']}: "
                                        "not bridged by issuer counts, no qualifying capital-event filing")
                for d in days if any(r[0] <= d.isoformat() <= r[1] for _c, r in v["_sa"])}
    return {}


class ConvergenceError(RuntimeError):
    pass


def converge(caps: dict, pclose: dict, runs_by_class: dict, obs_rows: list, ev_forms: list, known_splits: list):
    """Withhold until no served step is unproven (a FIXED POINT). Mutates nothing; returns
    (holds {day: (reason, note)}, productive_iterations, final served steps [(a, b, verdict)])."""
    served = dict(caps)
    holds: dict = {}
    limit = len(served) + 1                      # an impossible-state guard: each productive iteration removes >= 1 day
    for it in range(limit + 1):
        cur = steps(served, pclose, runs_by_class, obs_rows, ev_forms, known_splits)
        first = next(((a, b, v) for a, b, v in cur if v["verdict"] != "PROVEN"), None)
        if first is None:
            return holds, it, cur
        a, b, v = first
        h = withhold_for(sorted(served), a, b, v)
        h = {d: x for d, x in h.items() if d in served}
        if not h:
            raise ConvergenceError(f"unproven step {a}->{b} ({v['verdict']}) withholds nothing")
        for d, x in h.items():
            del served[d]                        # monotone: a withheld day never returns
            holds[d] = x
    raise ConvergenceError(f"no fixed point within {limit} iterations")
