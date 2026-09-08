"""Normalized earnings intelligence for the Company Intelligence panel.

ONE MODEL, ONE ENDPOINT
The Earnings tab used to assemble itself from three endpoints — this one for
reported quarters, `/api/fundamentals/earnings-table` for forward estimates and
annual history, `/api/fundamentals/{sym}` for the next report date. They
disagreed about fiscal labels ("2026 Q4" beside "FY2026 Q3"), duplicated growth
maths, and one of them was paid-gated, so a free member silently lost every
estimate and the whole Annual view. This module now owns all of it: reported
quarters, forward quarters, annual history, annual estimates and the summary.

WHY THAT ALSO SETTLES THE PAYWALL (product decision, 2026-09-07)
The gate on `earnings-table` was never about who is entitled to the data — it
was cost control on FMP-Ultimate call volume (its stated AlphaVantage
justification lapsed when that leg was removed on 2026-08-05). This module makes
the gate unnecessary rather than bypassing it: assembly is COMPANY-level and
shared, persisted to the same snapshot store as the other panels, so the first
viewer of a ticker pays once and every later viewer — free or paid — is served
from storage. It is strictly cheaper than what it replaces, because the old path
polled a per-request paid endpoint every five minutes per user per ticker.
`earnings-table` keeps its gate; it simply is not on the Earnings tab's path.

FISCAL PERIODS (the audit's top finding)
Provider rows do not carry the company's own fiscal label, and the previous
derivation assumed a calendar fiscal year, which put Micron and Microsoft two
quarters out and NVIDIA and Walmart a full year out. Fiscal identity now comes
from `fiscal_calendar.FiscalCalendar`, anchored on the fiscal-year-end dates the
company itself filed. Everything — tier-1 consensus rows, tier-2 statement rows,
forward estimates — is placed on that one calendar, which is also what makes the
two tiers joinable at all.

SOURCE PRECEDENCE — explicit, not "whoever answered first":
  1. FMP / Finnhub via earnings_estimates — the only sources carrying CONSENSUS
     estimates, so the only ones that can produce a surprise.
  2. yfinance quarterly income statement via financial_statements — reported EPS
     and revenue ACTUALS only. Free, keyless, already cached for the Financials
     tab, and the source of the fiscal anchors.
Actuals from tier 2 never invent an estimate, and a quarter whose actual and
estimate come from different bases never gets a surprise.

EPS BASIS — the trap in earnings data. FMP's `epsActual` is the
consensus-comparable figure (typically adjusted/non-GAAP); a yfinance income
statement's Diluted EPS is GAAP. Comparing one against the other's estimate
would manufacture a fake surprise, so every quarter records `eps_basis` and a
surprise is computed ONLY when actual and estimate share a basis.

CACHING — company-level and shared. Reported quarters are immutable, so the
payload persists to the same SQLite store the other panels use. Freshness is
proximity-weighted off `next_report_date`: far from a report the payload is good
for a day, inside the report window it drops to minutes, because that is the
only time the numbers actually move.
"""
from __future__ import annotations

import logging
import threading
import time
from datetime import date, datetime

from api.services import fundamentals_snapshot_store as snap_store
from api.services.cache import cache
from api.services.fiscal_calendar import FiscalCalendar, label as fiscal_label

_log = logging.getLogger(__name__)

# VERSIONED: the normalized row shape is part of what gets persisted, so widening
# it must invalidate stored payloads — otherwise every ticker keeps serving the
# older shape and the new fields read as missing data. Bump on schema change.
#   v4: fiscal_calendar identity, forward quarters + annual folded in, whole
#       payload served without an entitlement check.
#   v5: all-null statement periods dropped; meta.fiscal_calendar.style renamed
#       to quarter_basis. Caught in validation BY this rule — v4 payloads kept
#       serving the old shape from disk until the bump, which is precisely the
#       failure the comment above warns about.
#   v6: per-quarter net_margin_delta_pp, plus margin facts and series on the
#       summary, for the Earnings Quality block.
#   v7: summary.next_report_date is resolved DIRECTLY when no forward estimate
#       carried one. Persisted payloads hold the old null, so without this bump
#       every cached ticker would keep saying "Date TBD" after the fix shipped.
# v8: added `reaction` (earnings-day price move per quarter).
#
# ⚠️ A bump here is not a cache refresh — it is a cold rebuild for every symbol.
# The first attempt at v8 was reverted within minutes: a rebuild came back with
# empty quarters but populated `annual`, the old `_has_content` accepted that as
# a complete payload, persisted it, and the tab read "No earnings history is
# available" for the whole universe. That was never a bump problem; the bump
# only exposed it. `_has_quarterly` now refuses to persist a partial build, so
# the worst a failed rebuild costs is an hour instead of 45 days of stale gap.
_KIND = "earnings_intel_v8"
_STALE_MAX = 45 * 86400
# A build that came back without its quarterly series is held only this
# long, and never written to disk, so a transient provider failure costs
# an hour rather than weeks of "No earnings history is available".
_PARTIAL_TTL = 3600
# Proximity-weighted freshness: estimates and a pending print move, settled
# history does not.
_TTL_FAR = 24 * 3600        # > 10 days from the next report
_TTL_NEAR = 3 * 3600        # within 10 days
_TTL_WINDOW = 15 * 60       # within ~2 days either side of the report

_QUARTERS_BACK = 12         # how far the history reaches when data supports it
_FORWARD_QUARTERS = 2       # how many consensus quarters ahead to carry

_refreshing: set[str] = set()
_lock = threading.Lock()


# ── math with honest edge cases ─────────────────────────────────────────────
def _yoy(cur, prior):
    """(pct, note). A percentage across a sign change is meaningless, so those
    cases return a NOTE instead of a number."""
    if cur is None or prior is None:
        return None, None
    if prior == 0:
        return None, None
    if prior < 0 and cur >= 0:
        return None, "turned_profitable"
    if prior > 0 and cur < 0:
        return None, "turned_negative"
    if prior < 0 and cur < 0:
        # both losses: shrinking loss is an improvement, expressed on magnitudes
        return ((abs(prior) - abs(cur)) / abs(prior)) * 100.0, (
            "loss_narrowing" if abs(cur) < abs(prior) else "loss_widening")
    return ((cur - prior) / abs(prior)) * 100.0, None


def _surprise(actual, estimate, *, eps: bool):
    """(pct, abs, note). Percent surprise is unusable when the estimate sits near
    zero — a $0.01 estimate and a $0.03 actual is '+200%', which overstates a
    two-cent beat. Those return the absolute surprise instead."""
    if actual is None or estimate is None:
        return None, None, None
    diff = actual - estimate
    if eps and abs(estimate) < 0.05:
        return None, diff, "near_zero_estimate"
    if estimate == 0:
        return None, diff, "zero_estimate"
    return (diff / abs(estimate)) * 100.0, diff, None


def _prev_fiscal(fy, fq):
    """The fiscal quarter immediately before (fy, fq)."""
    if not fy or not fq:
        return None
    return (fy, fq - 1) if fq > 1 else (fy - 1, 4)


def _year_ago_fiscal(fy, fq):
    return (fy - 1, fq) if fy and fq else None


# ── the company's fiscal calendar ───────────────────────────────────────────
def _calendar_for(statements: dict) -> FiscalCalendar | None:
    """Anchored on the company's own filed fiscal-year ends where possible; a
    fiscal-year-end MONTH is the weaker fallback; nothing at all is the honest
    third case, in which quarters go unlabelled rather than guessed."""
    cal = FiscalCalendar.from_statements(statements)
    if cal:
        return cal
    fye = ((statements or {}).get("meta") or {}).get("fiscal_year_end")   # "MM-DD"
    if fye:
        try:
            return FiscalCalendar.from_year_end_month(int(str(fye)[:2]))
        except (ValueError, TypeError):
            pass
    return None


# ── tier 2: free quarterly ACTUALS from the statements we already cache ─────
def _actuals_from_statements(statements: dict, cal: FiscalCalendar | None) -> dict:
    """{(fiscal_year, fiscal_quarter): row} of reported EPS/revenue from the
    yfinance quarterly income statement. GAAP diluted EPS — labelled as such,
    never silently mixed with a consensus estimate."""
    out = {}
    rows = ((statements or {}).get("income") or {}).get("quarterly") or []
    for p in rows:
        period = str(p.get("period") or "")[:10]
        if len(period) < 10:
            continue
        info = cal.resolve(period) if cal else {}
        fy, fq = info.get("fiscal_year"), info.get("fiscal_quarter")
        if not fy or not fq:
            continue
        v = p.get("values") or {}
        rev, ni = v.get("revenue"), v.get("net_income")
        # yfinance sometimes returns a trailing period with every figure blank
        # (Walmart's 2025-01-31 column, observed 2026-09-07). Carrying it would
        # put a row of em dashes in the table — an empty cell is a design
        # failure, not data. Tier 1 already drops its equivalent.
        if rev is None and v.get("eps_diluted") is None:
            continue
        # After-tax margin per quarter. Growth without margin corroboration is
        # the classic trap — a sales surge funded by discounting looks identical
        # to a real one until you see the margin. Free: same statement row.
        margin = (ni / rev * 100.0) if (rev not in (None, 0) and ni is not None) else None
        out[(fy, fq)] = {
            "period_end": period,
            "fiscal_year": fy, "fiscal_quarter": fq,
            "fiscal_confidence": info.get("confidence"),
            "eps_actual": v.get("eps_diluted"),
            "revenue_actual": rev,
            "net_margin_pct": margin,
            "eps_basis": "gaap_diluted",
            "source": "yfinance-statement",
        }
    return out


# ── tier 1: consensus-bearing quarters ──────────────────────────────────────
def _quarters_from_estimates(sym: str, cal: FiscalCalendar | None) -> dict:
    """{(fiscal_year, fiscal_quarter): row} of reported quarters WITH consensus.

    FMP keys a quarter by its REPORT date and carries no period end, so fiscal
    identity is recovered by asking the calendar which quarter a report
    published on that date was reporting on. Without a calendar we cannot place
    these rows at all, and say so rather than falling back to calendar quarters.
    """
    rows: dict = {}
    if cal is None:
        return rows
    try:
        from api.services import earnings_estimates as ee
    except Exception:  # noqa: BLE001
        return rows
    this_year = date.today().year
    collisions = 0
    for year in range(this_year - 3, this_year + 1):
        try:
            got = ee.get_year_earnings(sym, year) or []
        except Exception as e:  # noqa: BLE001
            _log.debug("get_year_earnings %s %s failed: %s", sym, year, e)
            continue
        for r in got:
            if r.get("eps_actual") is None and r.get("revenue_actual") is None:
                continue
            rd = r.get("date")
            placed = cal.period_end_for_report(rd)
            fy, fq = placed.get("fiscal_year"), placed.get("fiscal_quarter")
            if not fy or not fq:
                continue
            row = {
                "fiscal_year": fy, "fiscal_quarter": fq,
                "period_end": placed.get("period_end"),
                "fiscal_confidence": placed.get("confidence"),
                "report_date": rd,
                "eps_actual": r.get("eps_actual"),
                "eps_estimate": r.get("eps_estimate"),
                "revenue_actual": r.get("revenue_actual"),
                "revenue_estimate": r.get("revenue_estimate"),
                # FMP/Finnhub actuals are the consensus-comparable figure.
                "eps_basis": "consensus_comparable",
                "source": "fmp/finnhub",
            }
            prior = rows.get((fy, fq))
            if prior is None:
                rows[(fy, fq)] = row
                continue
            # Two reports resolving to one fiscal quarter is a data problem, not
            # a merge opportunity — combining them would fuse distinct periods.
            # Keep the one bearing a real consensus, else the later report.
            collisions += 1
            prior_has = prior.get("eps_estimate") is not None
            new_has = row.get("eps_estimate") is not None
            if new_has and not prior_has:
                rows[(fy, fq)] = row
            elif new_has == prior_has and str(rd or "") > str(prior.get("report_date") or ""):
                rows[(fy, fq)] = row
            # ⛔ ...but the DATE is decided separately, and it is the EARLIEST.
            #
            # The winner above is chosen on which row carries real consensus —
            # the right test for the financial fields. It is the wrong test for
            # the date. FMP and Finnhub disagree on when a quarter was reported:
            # for MU FY2026 Q3, FMP says 2026-06-24 (the announcement, after the
            # close) and Finnhub says 2026-06-30 (a later filing/period date).
            # Taking the later one made the earnings-reaction strip measure
            # 30 Jun -> 1 Jul, printing -6.3% for a print the market answered
            # with +17.6% on 25 Jun.
            #
            # A price reaction is measured from the ANNOUNCEMENT, so the
            # earliest date any provider reports for the quarter is the one that
            # can be right; a later one is always a filing artifact.
            dates = [d for d in (rd, rows[(fy, fq)].get("report_date")) if d]
            if dates:
                rows[(fy, fq)]["report_date"] = min(str(d)[:10] for d in dates)
    if collisions:
        _log.info("earnings_intel %s: %d report(s) collided onto an occupied fiscal quarter",
                  sym, collisions)
    return rows


# ── forward consensus quarters ──────────────────────────────────────────────
def _forward_quarters(sym: str, cal: FiscalCalendar | None, reported: dict) -> list:
    """Upcoming quarters with consensus EPS/revenue, oldest-period first.

    Reuses the provider assembly `earnings_table` already owns rather than
    duplicating it, but re-derives every fiscal label through the calendar —
    that helper labels from a calendar-quarter assumption of its own.
    """
    out = []
    try:
        from api.services import earnings_table as et
        raw = et._forward_quarters(sym, _FORWARD_QUARTERS) or []
    except Exception as e:  # noqa: BLE001
        _log.debug("forward quarters failed for %s: %s", sym, e)
        return out
    for r in raw:
        eps_e, rev_e = r.get("eps_estimate"), r.get("rev_estimate")
        if eps_e is None and rev_e is None:
            continue
        fy = fq = conf = None
        period_end = r.get("period_end")
        if cal and period_end:
            info = cal.resolve(period_end)
            fy, fq, conf = info.get("fiscal_year"), info.get("fiscal_quarter"), info.get("confidence")
        if (not fy or not fq) and cal and r.get("report_date"):
            placed = cal.period_end_for_report(r["report_date"])
            fy, fq = placed.get("fiscal_year"), placed.get("fiscal_quarter")
            period_end = period_end or placed.get("period_end")
            conf = placed.get("confidence")
        if not fy or not fq:
            # A provider row with no period end and no calendar cannot be placed
            # on the timeline; a sequence guess would be a fabricated label.
            continue
        if (fy, fq) in reported:
            continue                      # already reported — not a forecast
        out.append({
            "fiscal_year": fy, "fiscal_quarter": fq,
            "label": fiscal_label(fy, fq),
            "period_end": period_end,
            "report_date": r.get("report_date"),
            "fiscal_confidence": conf,
            "reported": False,
            "eps_estimate": eps_e,
            "revenue_estimate": rev_e,
            "eps_actual": None, "revenue_actual": None,
            "source": "fmp/yfinance-consensus",
        })
    out.sort(key=lambda r: (r["fiscal_year"], r["fiscal_quarter"]))
    return out


# ── annual ──────────────────────────────────────────────────────────────────
def _annual(sym: str) -> dict:
    """{'reported': [...], 'estimates': [...]} newest-first.

    Growth on an estimate row is flagged, because an FY+2 estimate's growth is
    consensus-over-consensus and must never look like measured history.
    """
    blank = {"reported": [], "estimates": []}
    try:
        from api.services.annual_financials import get_annual_financials
        rows = get_annual_financials(sym) or []
    except Exception as e:  # noqa: BLE001
        _log.debug("annual financials failed for %s: %s", sym, e)
        return blank
    ordered = sorted((r for r in rows if r.get("year")), key=lambda r: r["year"])
    out = []
    for i, r in enumerate(ordered):
        prev = ordered[i - 1] if i else None
        eps_pct, eps_note = _yoy(r.get("eps"), prev.get("eps") if prev else None)
        rev_pct, rev_note = _yoy(r.get("sales"), prev.get("sales") if prev else None)
        est = bool(r.get("estimate"))
        out.append({
            "fiscal_year": r["year"],
            "label": f"FY{r['year']}",
            "estimate": est,
            "eps": r.get("eps"),
            "revenue": r.get("sales"),
            "eps_yoy_pct": eps_pct, "eps_yoy_note": eps_note,
            "rev_yoy_pct": rev_pct, "rev_yoy_note": rev_note,
            # An estimate compared against another estimate is a projection of a
            # projection. The UI must not present it as measured growth.
            "yoy_basis": ("vs_estimate" if est and prev and prev.get("estimate")
                          else "vs_actual" if prev else None),
        })
    out.reverse()
    return {"reported": [r for r in out if not r["estimate"]],
            "estimates": [r for r in out if r["estimate"]]}


# ── assembly ────────────────────────────────────────────────────────────────
def _build(sym: str) -> dict:
    try:
        from api.services.financial_statements import get_statements
        statements = get_statements(sym) or {}
    except Exception as e:  # noqa: BLE001
        _log.debug("statements failed for %s: %s", sym, e)
        statements = {}

    cal = _calendar_for(statements)
    tier2 = _actuals_from_statements(statements, cal)
    tier1 = _quarters_from_estimates(sym, cal)

    # ── merge on ONE fiscal identity ────────────────────────────────────────
    # Both tiers are now keyed by (fiscal_year, fiscal_quarter) off the same
    # calendar, which is what makes the join possible at all — the previous
    # model keyed tier 1 by (year, quarter) and tier 2 by period_end, so the
    # backfill never matched and net margin was permanently unreachable.
    merged: dict = {}
    for key, row in tier2.items():
        merged[key] = {**row, "reported": True}
    for key, row in tier1.items():
        base = merged.get(key, {})
        combined = {**base, **{k: v for k, v in row.items() if v is not None}}
        # Tier 1 owns consensus and basis; tier 2 owns margin and the filed
        # period end. Actuals prefer tier 1 (consensus-comparable), then tier 2.
        combined["eps_basis"] = row.get("eps_basis") or base.get("eps_basis")
        combined["net_margin_pct"] = base.get("net_margin_pct")
        combined["period_end"] = base.get("period_end") or row.get("period_end")
        combined["reported"] = True
        for k in ("eps_actual", "revenue_actual"):
            if combined.get(k) is None:
                combined[k] = base.get(k)
        merged[key] = combined

    ordered = sorted(merged.values(),
                     key=lambda q: (q["fiscal_year"], q["fiscal_quarter"]), reverse=True)
    used = ("fmp/finnhub" if tier1 else "yfinance-statement" if tier2 else None)
    quarters = ordered[:_QUARTERS_BACK]
    for q in quarters:
        q["label"] = fiscal_label(q.get("fiscal_year"), q.get("fiscal_quarter"))

    # ── year-over-year against the SAME fiscal quarter ──────────────────────
    # The YoY partner may sit outside the 12 we return, so index the full merge.
    full = {(q["fiscal_year"], q["fiscal_quarter"]): q for q in merged.values()}
    for q in quarters:
        prior = full.get(_year_ago_fiscal(q["fiscal_year"], q["fiscal_quarter"]))
        eps_yoy, eps_note = _yoy(q.get("eps_actual"), prior.get("eps_actual") if prior else None)
        rev_yoy, rev_note = _yoy(q.get("revenue_actual"), prior.get("revenue_actual") if prior else None)
        q["eps_yoy_pct"], q["eps_yoy_note"] = eps_yoy, eps_note
        q["rev_yoy_pct"], q["rev_yoy_note"] = rev_yoy, rev_note
        q["yoy_basis"] = "vs_actual" if prior else None
        # Margin moves in PERCENTAGE POINTS, not percent: 60% → 68% is +8pp, and
        # calling it "+13%" would be a different (and misleading) statement.
        pm = prior.get("net_margin_pct") if prior else None
        q["net_margin_delta_pp"] = (
            q["net_margin_pct"] - pm
            if (q.get("net_margin_pct") is not None and pm is not None) else None)

        # A surprise is only computed when both sides share a basis.
        if q.get("eps_basis") == "consensus_comparable":
            sp, sa, note = _surprise(q.get("eps_actual"), q.get("eps_estimate"), eps=True)
            q["eps_surprise_pct"], q["eps_surprise_abs"], q["eps_surprise_note"] = sp, sa, note
            rp, ra, rnote = _surprise(q.get("revenue_actual"), q.get("revenue_estimate"), eps=False)
            q["rev_surprise_pct"], q["rev_surprise_abs"], q["rev_surprise_note"] = rp, ra, rnote
        else:
            q["eps_surprise_pct"] = q["eps_surprise_abs"] = None
            q["eps_surprise_note"] = "no_comparable_estimate"
            q["rev_surprise_pct"] = q["rev_surprise_abs"] = None
            q["rev_surprise_note"] = "no_comparable_estimate"

        # Factual statements about the reported numbers, never a verdict.
        q["eps_triple"] = bool(eps_yoy is not None and eps_yoy >= 100)
        q["rev_triple"] = bool(rev_yoy is not None and rev_yoy >= 100)
        q["double_triple"] = bool(q["eps_triple"] and q["rev_triple"])
        eb = (q.get("eps_surprise_abs") if q.get("eps_surprise_pct") is None
              else q.get("eps_surprise_pct"))
        rb = (q.get("rev_surprise_abs") if q.get("rev_surprise_pct") is None
              else q.get("rev_surprise_pct"))
        q["eps_beat"] = None if eb is None else bool(eb > 0)
        q["rev_beat"] = None if rb is None else bool(rb > 0)
        # None (not scored) is NOT a miss — see _summarize.
        q["double_beat"] = (None if (q["eps_beat"] is None or q["rev_beat"] is None)
                            else bool(q["eps_beat"] and q["rev_beat"]))

    # ── forward quarters, with growth against the year-ago ACTUAL ───────────
    estimates = _forward_quarters(sym, cal, full)
    for e in estimates:
        prior = full.get(_year_ago_fiscal(e["fiscal_year"], e["fiscal_quarter"]))
        eps_yoy, eps_note = _yoy(e.get("eps_estimate"), prior.get("eps_actual") if prior else None)
        rev_yoy, rev_note = _yoy(e.get("revenue_estimate"), prior.get("revenue_actual") if prior else None)
        e["eps_yoy_pct"], e["eps_yoy_note"] = eps_yoy, eps_note
        e["rev_yoy_pct"], e["rev_yoy_note"] = rev_yoy, rev_note
        e["yoy_basis"] = "vs_actual" if prior else None
        e["eps_triple"] = bool(eps_yoy is not None and eps_yoy >= 100)
        e["rev_triple"] = bool(rev_yoy is not None and rev_yoy >= 100)
        e["double_triple"] = bool(e["eps_triple"] and e["rev_triple"])
    estimates.reverse()          # furthest-out first, reading down to the present

    annual = _annual(sym)
    summary = _summarize(quarters, estimates)

    # ── the scheduled date is a FACT, independent of forecast placement ──────
    # `_summarize` can only report a date that rides on a forward estimate row,
    # and those rows are dropped when they cannot be placed on the fiscal
    # timeline — FMP's yfinance fallback supplies no period_end or label, so
    # every such row is discarded and the date goes with it. The panel then
    # said "Date TBD" (or showed nothing) for symbols whose next report date
    # the provider had told us plainly.
    #
    # The date does not depend on the estimate: ask for it directly when the
    # merge did not carry one through. Cheap (one cached provider read) and
    # only on the miss.
    if not summary.get("next_report_date"):
        try:
            from api.services import earnings_table as _et
            nrd = _et._next_report_date(sym)
            if nrd:
                summary["next_report_date"] = nrd
                if not summary.get("next_report_label") and cal:
                    placed = cal.period_end_for_report(nrd)
                    fy, fq = placed.get("fiscal_year"), placed.get("fiscal_quarter")
                    if fy and fq:
                        summary["next_report_label"] = fiscal_label(fy, fq)
        except Exception as e:  # noqa: BLE001 — a missing date is never fatal
            _log.debug("next_report_date fallback failed for %s: %s", sym, e)
    cal_desc = cal.describe() if cal else {"known": False}

    # Earnings-day price reaction, from OUR OWN daily bars (no metered call).
    # Never let it break the tab: the reaction strip is one block inside
    # Earnings, so a failure here must cost that block, not the whole payload.
    try:
        from api.services import earnings_reaction as _er
        reaction = _er.reaction_for(sym, quarters)
    except Exception as e:                                # noqa: BLE001
        _log.warning("earnings reaction failed for %s: %s", sym, e)
        reaction = None

    return {
        "ticker": sym,
        "quarters": quarters,
        "estimates": estimates,
        "annual": annual,
        "summary": summary,
        "reaction": reaction,
        # Drives the proximity-weighted TTL below. Previously read but never
        # written, so every payload silently took the 24-hour branch.
        "next_report_date": summary.get("next_report_date"),
        "meta": {
            "actuals_source": used,
            "estimates_available": bool(tier1),
            "eps_basis": ("consensus-comparable (provider adjusted)" if tier1
                          else "GAAP diluted, as reported"),
            "retrieved_at": time.time(),
            "quarters_returned": len(quarters),
            "quarters_available": len(merged),
            "fiscal_calendar": cal_desc,
            "fiscal_year_end_month": cal_desc.get("fiscal_year_end_month"),
            "surprise_method": "(actual − estimate) ÷ |estimate|; absolute surprise when |EPS estimate| < $0.05",
            "yoy_method": "same fiscal quarter one year earlier; sign changes reported as turned profitable/negative rather than a percentage",
            "fiscal_method": (
                "Fiscal periods are placed on the company's own filed fiscal-year-end dates."
                if cal_desc.get("known") else
                "This company's fiscal calendar could not be established, so quarters are "
                "left unlabelled rather than assumed to follow the calendar year."),
        },
    }


def _summarize(quarters: list, estimates: list) -> dict:
    """Streaks and growth trend — computed over the quarters we actually have,
    returning None rather than a number when the inputs are absent."""
    rep = [q for q in quarters if q.get("reported")]

    def accel(key):
        """Consecutive most-recent quarters whose YoY growth RATE exceeded the
        prior quarter's — acceleration as a COUNT, not an adjective.

        Walks the FISCAL SEQUENCE. A quarter that is missing, or whose YoY is
        non-comparable (a swing through zero has a state, not a rate), ENDS the
        run. The previous version filtered nulls out of a list and then compared
        adjacent survivors, silently measuring across the gap — so a loss→profit
        inflection, the most dramatic one there is, was skipped and the two
        quarters either side of it were treated as consecutive.
        """
        if len(rep) < 2:
            return None, None
        run_up = run_down = 0
        for i in range(len(rep) - 1):          # rep is newest-first
            cur, prv = rep[i], rep[i + 1]
            if (prv.get("fiscal_year"), prv.get("fiscal_quarter")) != _prev_fiscal(
                    cur.get("fiscal_year"), cur.get("fiscal_quarter")):
                break                          # a quarter is missing from the run
            a, b = cur.get(key), prv.get(key)
            if a is None or b is None:
                break                          # non-comparable: the run stops here
            if a > b:
                if run_down:
                    break
                run_up += 1
            elif a < b:
                if run_up:
                    break
                run_down += 1
            else:
                break
        if run_up:
            return run_up, "accelerating"
        if run_down:
            return run_down, "decelerating"
        return None, None

    eps_n, eps_dir = accel("eps_yoy_pct")
    rev_n, rev_dir = accel("rev_yoy_pct")

    # Beat streak. A quarter with no revenue consensus is NOT SCORED, and an
    # unscored quarter cannot be claimed as part of a streak — so it ends the
    # run rather than counting as a miss, which is what `bool(None and x)` did.
    streak = 0
    streak_scored = 0
    for q in rep:                              # newest first
        if q.get("double_beat") is None:
            break
        streak_scored += 1
        if q["double_beat"]:
            streak += 1
        else:
            break

    scored = [q for q in rep if q.get("eps_beat") is not None]
    rev_scored = [q for q in rep if q.get("rev_beat") is not None]

    dated = next((e for e in reversed(estimates) if e.get("report_date")), None)
    nearest = estimates[-1] if estimates else None

    # Profitability trend. The series runs OLDEST → NEWEST so a sparkline can
    # consume it directly, and carries only quarters that actually reported a
    # margin — a gap is skipped rather than drawn as a dip to zero.
    margin_q = [q for q in rep if q.get("net_margin_pct") is not None]
    latest_margin = margin_q[0] if margin_q else None
    series = [q["net_margin_pct"] for q in reversed(margin_q)]

    return {
        "eps_beats": sum(1 for q in scored if q["eps_beat"]) if scored else None,
        "eps_beats_of": len(scored) or None,
        "rev_beats": sum(1 for q in rev_scored if q["rev_beat"]) if rev_scored else None,
        "rev_beats_of": len(rev_scored) or None,
        "double_beat_streak": streak or None,
        "double_beat_scored": streak_scored or None,
        "eps_accel_quarters": eps_n, "eps_trend": eps_dir,
        "rev_accel_quarters": rev_n, "rev_trend": rev_dir,
        "next_report_date": (dated or {}).get("report_date"),
        "next_report_label": (dated or nearest or {}).get("label"),
        "next_eps_estimate": (dated or nearest or {}).get("eps_estimate"),
        "next_revenue_estimate": (dated or nearest or {}).get("revenue_estimate"),
        "net_margin_pct": (latest_margin or {}).get("net_margin_pct"),
        "net_margin_delta_pp": (latest_margin or {}).get("net_margin_delta_pp"),
        # Only worth drawing when there is a trend to see, not two points.
        "net_margin_series": series if len(series) >= 6 else None,
    }


def _ttl_for(payload: dict) -> float:
    """Freshness by proximity to the next report — cheap when nothing is moving,
    responsive when it is."""
    nxt = payload.get("next_report_date")
    if not nxt:
        return _TTL_FAR
    try:
        d = datetime.strptime(str(nxt)[:10], "%Y-%m-%d").date()
    except (ValueError, TypeError):
        return _TTL_FAR
    days = (d - date.today()).days
    if abs(days) <= 2:
        return _TTL_WINDOW
    if 0 <= days <= 10:
        return _TTL_NEAR
    return _TTL_FAR


def _has_content(payload: dict) -> bool:
    """Anything worth returning to a caller at all."""
    return bool(payload.get("quarters") or payload.get("estimates")
                or (payload.get("annual") or {}).get("reported"))


def _has_quarterly(payload: dict) -> bool:
    """The QUARTERLY series — what this payload actually exists to carry.

    ⛔ Not the same question as `_has_content`, and conflating them cost the
    Earnings tab its history. A build can lose both quarterly tiers and still
    return populated `annual`, because annual is derived from the statements
    document while the quarters need the fiscal calendar and the estimates
    provider. `_has_content` said True on the annual alone, so that half-built
    payload was cached at full TTL AND persisted to disk — and the tab read "No
    earnings history is available for MU" while serving it stale for up to 45
    days. A payload with no quarters is a PARTIAL build: worth returning once,
    never worth remembering.
    """
    return bool(payload.get("quarters") or payload.get("estimates"))


def _schedule_refresh(sym: str) -> None:
    with _lock:
        if sym in _refreshing:
            return
        _refreshing.add(sym)

    def _run():
        try:
            fresh = _build(sym)
            if _has_content(fresh):
                ttl = _ttl_for(fresh)
                cache.set(f"{_KIND}::{sym}", fresh, ttl)
                snap_store.put(_KIND, sym, fresh, ttl)
        except Exception as e:  # noqa: BLE001
            _log.warning("earnings refresh %s failed: %s", sym, e)
        finally:
            with _lock:
                _refreshing.discard(sym)

    threading.Thread(target=_run, name=f"earn-refresh-{sym}", daemon=True).start()


def get_earnings(ticker: str) -> dict:
    """Normalized earnings for a ticker. memory → disk (fresh) → disk (stale,
    refresh behind the response) → build. Shared by every user, free or paid."""
    sym = (ticker or "").upper().strip()
    if not sym:
        return {"error": "ticker required"}
    ck = f"{_KIND}::{sym}"
    hit = cache.get(ck)
    if hit is not None:
        return hit
    stored = snap_store.get(_KIND, sym)
    if stored is not None:
        payload, age, ttl = stored
        # A persisted payload with no quarterly series is a partial build that
        # an earlier, more permissive check let through. Treat it as a miss so
        # it rebuilds now, rather than serving the gap for the rest of its TTL.
        if isinstance(payload, dict) and _has_quarterly(payload):
            payload.setdefault("meta", {})["age_seconds"] = int(age)
            if age <= ttl:
                cache.set(ck, payload, max(60, int(ttl - age)))
                return payload
            if age <= _STALE_MAX:
                payload["meta"]["stale"] = True
                cache.set(ck, payload, 300)
                _schedule_refresh(sym)
                return payload
    out = _build(sym)
    ttl = _ttl_for(out)
    if _has_quarterly(out):
        cache.set(ck, out, ttl)
        snap_store.put(_KIND, sym, out, ttl)
    else:
        # Partial or empty: hold it briefly so a burst of requests doesn't
        # re-hammer the providers, but NEVER persist it and never let it reach
        # the 45-day stale window. It retries on its own within the hour.
        cache.set(ck, out, _PARTIAL_TTL if _has_content(out) else 600)
    return out
