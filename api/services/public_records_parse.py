"""PUBR's readers of the four agencies' answers: each agency's JSON -> the rows the panel draws. Pure: no
network, no clock (the day is passed in). The shapes are as each agency's own documentation and one
confirming request gave them on 2026-11-22:

  USAspending.gov   POST /api/v2/search/spending_by_category/recipient/  -> {results: [{name, amount,
                    recipient_id, code, uei, total_outlays}], page_metadata: {hasNext}}
                    POST /api/v2/search/spending_by_award/ -> {results: [{"Award ID", "Recipient Name",
                    recipient_id, "Base Obligation Date", "Award Amount", "Awarding Agency", "Awarding Sub
                    Agency", Description, "Primary Place of Performance": {city_name, state_code,
                    country_name}, "Contract Award Type", generated_internal_id}], page_metadata: {hasNext}}
  ClinicalTrials.gov GET /api/v2/studies -> {totalCount, studies: [{protocolSection: {identificationModule:
                    {nctId, briefTitle}, statusModule: {overallStatus, startDateStruct: {date, type},
                    primaryCompletionDateStruct, lastUpdatePostDateStruct}, sponsorCollaboratorsModule:
                    {leadSponsor: {name, class}}, conditionsModule: {conditions}, designModule: {phases,
                    enrollmentInfo: {count, type}}}}], nextPageToken}; GET /api/v2/version -> {dataTimestamp}
  openFDA           GET /drug/drugsfda.json -> {meta: {last_updated, disclaimer, results: {total}}, results:
                    [{application_number, sponsor_name, products: [{brand_name, active_ingredients: [{name}]}],
                    submissions: [{submission_type, submission_number, submission_status,
                    submission_status_date (YYYYMMDD), review_priority, submission_class_code,
                    submission_class_code_description}]}]}
  LDA.gov           GET /api/v1/filings/ -> {count, next, results: [{filing_uuid, filing_type, filing_year,
                    filing_period, income, expenses (decimal strings or null), dt_posted, filing_document_url,
                    registrant: {id, name}, client: {id, name}, lobbying_activities: [{general_issue_code,
                    general_issue_code_display}]}]}

Every field not named above is dropped; DUNS numbers (USAspending's `code`) are never kept. A row this
module cannot read is counted, never guessed at.
"""
from __future__ import annotations

import math
import re
from datetime import date, timedelta
from typing import Any, Optional

from api.services.public_records_match import Tally, match_name

ISO_DAY = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_YYYYMM = re.compile(r"^\d{4}-\d{2}$")
_NCT = re.compile(r"^NCT\d{8}$")
_APPL = re.compile(r"^(NDA|ANDA|BLA)(\d{6})$")

AWARD_CAP = 25            # matched awards an answer carries
NOT_COUNTED_CAP = 12      # names returned but not counted, shown
ACTIVE_CAP = 120          # active trials an answer carries
CLOSED_CAP = 60           # recently closed trials an answer carries
APPROVAL_CAP = 40         # FDA actions an answer carries
DESCRIPTION_CHARS = 280   # an award description is cut (at a word) past this many characters
ISSUE_CAP = 8             # issue areas shown per quarter


def figure(v: Any) -> Optional[float]:
    if v is None or isinstance(v, bool):
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


def text(v: Any) -> Optional[str]:
    if not isinstance(v, str):
        return None
    s = " ".join(v.split())
    return s or None


def iso_day(v: Any) -> Optional[str]:
    s = v.strip()[:10] if isinstance(v, str) else ""
    if not ISO_DAY.match(s):
        return None
    try:
        date.fromisoformat(s)
    except ValueError:
        return None
    return s


def cut_words(s: Optional[str], limit: int = DESCRIPTION_CHARS) -> tuple[Optional[str], bool]:
    if not s or len(s) <= limit:
        return s, False
    head = s[:limit].rsplit(" ", 1)[0].rstrip(",;:. ")
    return head or s[:limit], True


def shift_years(day: date, years: int) -> date:
    try:
        return day.replace(year=day.year + years)
    except ValueError:                   # Feb 29
        return day.replace(year=day.year + years, day=28)


# ── USAspending.gov ──────────────────────────────────────────────────────────────────────────

def contract_windows(today: date) -> dict:
    """The two twelve-month windows: `recent` ends today, `prior` is the twelve months before it."""
    start = shift_years(today, -1) + timedelta(days=1)
    prior_end = start - timedelta(days=1)
    prior_start = shift_years(prior_end, -1) + timedelta(days=1)
    return {"recent": (start.isoformat(), today.isoformat()), "prior": (prior_start.isoformat(), prior_end.isoformat())}


def recipient_rows(body: Any) -> tuple[list[tuple[str, Optional[float]]], bool, int]:
    """((name, amount) per recipient, more pages held, rows that could not be read)."""
    if not isinstance(body, dict) or not isinstance(body.get("results"), list):
        raise ValueError("not a spending-by-recipient answer")
    rows, bad = [], 0
    for r in body["results"]:
        name = text(r.get("name")) if isinstance(r, dict) else None
        if not name:
            bad += 1
            continue
        rows.append((name, figure(r.get("amount"))))
    meta = body.get("page_metadata") if isinstance(body.get("page_metadata"), dict) else {}
    return rows, meta.get("hasNext") is True, bad


def _place(r: dict) -> Optional[str]:
    p = r.get("Primary Place of Performance")
    parts = []
    if isinstance(p, dict):
        city, state, country = text(p.get("city_name")), text(p.get("state_code")), text(p.get("country_name"))
        if city:
            parts.append(city.title())
        if state:
            parts.append(state)
        if country and country.upper() not in ("UNITED STATES", "USA"):
            parts.append(country.title())
    if not parts:
        state, country = text(r.get("Place of Performance State Code")), text(r.get("Place of Performance Country Code"))
        parts = [x for x in (state, country if country and country != "USA" else None) if x]
    return ", ".join(parts) or None


def award_rows(body: Any) -> tuple[list[dict], bool, int]:
    """(awards, more pages held, rows that could not be read). A row needs an award id, a recipient
    name and a base obligation date."""
    if not isinstance(body, dict) or not isinstance(body.get("results"), list):
        raise ValueError("not a spending-by-award answer")
    out, bad = [], 0
    for r in body["results"]:
        if not isinstance(r, dict):
            bad += 1
            continue
        award_id, recipient, day = text(r.get("Award ID")), text(r.get("Recipient Name")), iso_day(r.get("Base Obligation Date"))
        if not (award_id and recipient and day):
            bad += 1
            continue
        desc, cut = cut_words(text(r.get("Description")))
        gid = text(r.get("generated_internal_id"))
        out.append({
            "award_id": award_id, "recipient": recipient, "date": day, "amount": figure(r.get("Award Amount")),
            "agency": text(r.get("Awarding Agency")), "sub_agency": text(r.get("Awarding Sub Agency")),
            "description": desc, "description_cut": cut, "place": _place(r), "kind": text(r.get("Contract Award Type")),
            "url": f"https://www.usaspending.gov/award/{gid}" if gid and re.match(r"^[A-Za-z0-9_.\-]+$", gid) else None,
        })
    meta = body.get("page_metadata") if isinstance(body.get("page_metadata"), dict) else {}
    return out, meta.get("hasNext") is True, bad


def shape_contracts(recent: Any, prior: Any, awards: Any, names: list[dict]) -> dict:
    """The contracts section's body from the three answers: totals over the counted names in each
    window, the counted and not-counted names, and the counted awards newest first."""
    tally = Tally(names)
    r_rows, r_more, r_bad = recipient_rows(recent)
    p_rows, p_more, p_bad = recipient_rows(prior)
    a_rows, a_more, a_bad = award_rows(awards)
    recent_total = prior_total = 0.0
    recent_any = prior_any = False
    for name, amount in r_rows:
        row = tally.add(name, amount)
        if row and row["counted"] and amount is not None:
            recent_total += amount
            recent_any = True
    prior_by_name: dict[str, float] = {}
    for name, amount in p_rows:
        row = tally.add(name, None, records=0)
        if row and row["counted"] and amount is not None:
            prior_total += amount
            prior_any = True
            prior_by_name[row["name"]] = prior_by_name.get(row["name"], 0.0) + amount
    for a in a_rows:
        tally.add(a["recipient"], None, records=0)
    counted = tally.counted()
    for c in counted:
        c["prior_amount"] = prior_by_name.get(c["name"])
    not_counted, not_counted_total = tally.not_counted(NOT_COUNTED_CAP)
    matched_awards = [a for a in a_rows if tally.is_counted(a["recipient"])]
    matched_awards.sort(key=lambda a: (a["date"], a["amount"] or 0), reverse=True)
    return {
        "recent_total": round(recent_total, 2) if recent_any else (0.0 if counted else None),
        "prior_total": round(prior_total, 2) if prior_any else (0.0 if counted else None),
        "counted": counted, "not_counted": not_counted, "not_counted_total": not_counted_total,
        "awards": matched_awards[:AWARD_CAP], "awards_cut": len(matched_awards) > AWARD_CAP,
        "awards_read": len(a_rows), "awards_more": a_more,
        "recipients_more": r_more or p_more, "dropped": r_bad + p_bad + a_bad,
    }


# ── ClinicalTrials.gov ───────────────────────────────────────────────────────────────────────

ACTIVE_STATUSES = ("RECRUITING", "NOT_YET_RECRUITING", "ACTIVE_NOT_RECRUITING", "ENROLLING_BY_INVITATION")
CLOSED_STATUSES = ("COMPLETED", "TERMINATED", "SUSPENDED", "WITHDRAWN")
PHASES = ("EARLY_PHASE1", "PHASE1", "PHASE2", "PHASE3", "PHASE4", "NA")
TRIAL_FIELDS = ("NCTId", "BriefTitle", "OverallStatus", "Phase", "Condition", "StartDate", "StartDateType",
                "PrimaryCompletionDate", "PrimaryCompletionDateType", "EnrollmentCount", "EnrollmentType",
                "LeadSponsorName", "LastUpdatePostDate")


def _partial_day(v: Any) -> Optional[str]:
    """ClinicalTrials.gov's partial date: 'YYYY-MM-DD' or 'YYYY-MM' (kept as given), else None."""
    if not isinstance(v, str):
        return None
    s = v.strip()
    if iso_day(s):
        return s
    return s if _YYYYMM.match(s) else None


def _date_struct(v: Any) -> dict:
    v = v if isinstance(v, dict) else {}
    kind = v.get("type")
    return {"date": _partial_day(v.get("date")), "estimated": kind == "ESTIMATED" if kind in ("ACTUAL", "ESTIMATED") else None}


def study_rows(body: Any) -> tuple[list[dict], Optional[int], int]:
    """(studies, the agency's total count for the query when it gave one, rows not read)."""
    if not isinstance(body, dict) or not isinstance(body.get("studies"), list):
        raise ValueError("not a studies answer")
    out, bad = [], 0
    for s in body["studies"]:
        ps = s.get("protocolSection") if isinstance(s, dict) else None
        ps = ps if isinstance(ps, dict) else {}
        ident = ps.get("identificationModule") if isinstance(ps.get("identificationModule"), dict) else {}
        status = ps.get("statusModule") if isinstance(ps.get("statusModule"), dict) else {}
        sponsor = ps.get("sponsorCollaboratorsModule") if isinstance(ps.get("sponsorCollaboratorsModule"), dict) else {}
        lead = sponsor.get("leadSponsor") if isinstance(sponsor.get("leadSponsor"), dict) else {}
        design = ps.get("designModule") if isinstance(ps.get("designModule"), dict) else {}
        cond = ps.get("conditionsModule") if isinstance(ps.get("conditionsModule"), dict) else {}
        nct = text(ident.get("nctId"))
        overall = status.get("overallStatus")
        if not nct or not _NCT.match(nct) or not isinstance(overall, str):
            bad += 1
            continue
        phases = [p for p in (design.get("phases") or []) if p in PHASES] if isinstance(design.get("phases"), list) else []
        conditions = [c for c in (text(x) for x in (cond.get("conditions") or [])) if c] if isinstance(cond.get("conditions"), list) else []
        enroll = design.get("enrollmentInfo") if isinstance(design.get("enrollmentInfo"), dict) else {}
        count = enroll.get("count")
        last = status.get("lastUpdatePostDateStruct") if isinstance(status.get("lastUpdatePostDateStruct"), dict) else {}
        out.append({
            "nct_id": nct, "title": text(ident.get("briefTitle")), "status": overall, "phases": phases,
            "conditions": conditions[:4], "conditions_more": max(0, len(conditions) - 4),
            "start": _date_struct(status.get("startDateStruct")),
            "primary_completion": _date_struct(status.get("primaryCompletionDateStruct")),
            "enrollment": count if isinstance(count, int) and not isinstance(count, bool) and count >= 0 else None,
            "enrollment_estimated": (enroll.get("type") == "ESTIMATED") if enroll.get("type") in ("ACTUAL", "ESTIMATED") else None,
            "sponsor": text(lead.get("name")), "last_update": iso_day(last.get("date")),
            "url": f"https://clinicaltrials.gov/study/{nct}",
        })
    total = body.get("totalCount")
    return out, (total if isinstance(total, int) and not isinstance(total, bool) else None), bad


def phase_key(phases: list[str]) -> str:
    """One trial's phase as one key: 'PHASE1+PHASE2' for a combined phase, 'NONE' with no phase."""
    return "+".join(phases) if phases else "NONE"


def shape_trials(active: Any, closed: Any, names: list[dict]) -> dict:
    """The trials section's body: the counted trials (the company is their lead sponsor), active ones by
    the next primary completion, recently closed ones newest first, and the counts by phase and status."""
    tally = Tally(names)
    a_rows, a_total, a_bad = study_rows(active)
    c_rows, c_total, c_bad = study_rows(closed)
    for s in a_rows + c_rows:
        tally.add(s["sponsor"] or "")
    counted_active = [s for s in a_rows if tally.is_counted(s["sponsor"])]
    counted_closed = [s for s in c_rows if tally.is_counted(s["sponsor"])]
    by_status: dict[str, int] = {}
    by_phase: dict[str, int] = {}
    grid: dict[str, dict[str, int]] = {}
    for s in counted_active + counted_closed:
        by_status[s["status"]] = by_status.get(s["status"], 0) + 1
    for s in counted_active:
        k = phase_key(s["phases"])
        by_phase[k] = by_phase.get(k, 0) + 1
        grid.setdefault(k, {})
        grid[k][s["status"]] = grid[k].get(s["status"], 0) + 1
    far = "9999-12-31"
    counted_active.sort(key=lambda s: ((s["primary_completion"]["date"] or far), s["nct_id"]))
    counted_closed.sort(key=lambda s: ((s["last_update"] or ""), s["nct_id"]), reverse=True)
    not_counted, not_counted_total = tally.not_counted(NOT_COUNTED_CAP)
    return {
        "active": counted_active[:ACTIVE_CAP], "active_cut": len(counted_active) > ACTIVE_CAP,
        "active_matched": len(counted_active), "active_read": len(a_rows), "active_total": a_total,
        "closed": counted_closed[:CLOSED_CAP], "closed_cut": len(counted_closed) > CLOSED_CAP,
        "closed_matched": len(counted_closed), "closed_read": len(c_rows), "closed_total": c_total,
        "by_status": by_status, "by_phase": by_phase, "phase_status": grid,
        "counted": tally.counted(), "not_counted": not_counted, "not_counted_total": not_counted_total,
        "dropped": a_bad + c_bad,
    }


def data_timestamp(body: Any) -> Optional[str]:
    """ClinicalTrials.gov's `dataTimestamp` (when its data were processed), as given, or None."""
    v = body.get("dataTimestamp") if isinstance(body, dict) else None
    return v.strip()[:32] if isinstance(v, str) and re.match(r"^\d{4}-\d{2}-\d{2}", v.strip()) else None


# ── openFDA (Drugs@FDA) ──────────────────────────────────────────────────────────────────────

APPLICATION_WORDS = {"NDA": "New drug application", "ANDA": "Generic drug application (ANDA)",
                     "BLA": "Biologic license application"}


def _fda_day(v: Any) -> Optional[str]:
    s = v.strip() if isinstance(v, str) else ""
    if not re.match(r"^\d{8}$", s):
        return None
    return iso_day(f"{s[:4]}-{s[4:6]}-{s[6:]}")


def fda_action(sub: dict) -> Optional[str]:
    """'approval' | 'tentative' | 'new_use' | 'other_change' for an approved or tentatively approved
    submission, else None. An original application approved is an approval; a supplement whose class is
    efficacy is a new use (a new indication, dosing or population); any other approved supplement
    (labeling, manufacturing) is an other change."""
    status, kind = sub.get("submission_status"), sub.get("submission_type")
    if status == "TA":
        return "tentative"
    if status != "AP":
        return None
    if kind == "ORIG":
        return "approval"
    cls = str(sub.get("submission_class_code") or "").upper()
    if kind == "SUPPL" and cls.startswith("EFFICACY"):
        return "new_use"
    return "other_change"


def shape_fda(body: Any, names: list[dict], since: str) -> dict:
    """The FDA section's body: the counted applications' approvals, tentative approvals and new uses on
    or after `since` (ISO day), newest first, and how many other approved changes there were."""
    if not isinstance(body, dict) or not isinstance(body.get("results"), list):
        raise ValueError("not a drugsfda answer")
    tally = Tally(names)
    actions, other_changes, bad = [], 0, 0
    apps_counted = 0
    for app in body["results"]:
        if not isinstance(app, dict):
            bad += 1
            continue
        number, sponsor = text(app.get("application_number")), text(app.get("sponsor_name"))
        m = _APPL.match(number or "")
        if not m or not sponsor:
            bad += 1
            continue
        row = tally.add(sponsor)
        if not row or not row["counted"]:
            continue
        apps_counted += 1
        products = app.get("products") if isinstance(app.get("products"), list) else []
        brands, ingredients = [], []
        for p in products:
            if not isinstance(p, dict):
                continue
            b = text(p.get("brand_name"))
            if b and b not in brands:
                brands.append(b)
            for ai in p.get("active_ingredients") or []:
                n = text(ai.get("name")) if isinstance(ai, dict) else None
                if n and n not in ingredients:
                    ingredients.append(n)
        for sub in app.get("submissions") or []:
            if not isinstance(sub, dict):
                continue
            day = _fda_day(sub.get("submission_status_date"))
            action = fda_action(sub)
            if not day or not action or day < since:
                continue
            if action == "other_change":
                other_changes += 1
                continue
            actions.append({
                "application": number, "application_kind": m.group(1),
                "application_words": APPLICATION_WORDS[m.group(1)], "sponsor": sponsor,
                "drug": ", ".join(brands[:3]) or None, "drugs_more": max(0, len(brands) - 3),
                "ingredients": ", ".join(ingredients[:3]) or None, "date": day, "action": action,
                "submission": f"{text(sub.get('submission_type')) or ''} {text(sub.get('submission_number')) or ''}".strip() or None,
                "priority": text(sub.get("review_priority")) if sub.get("review_priority") in ("PRIORITY", "STANDARD") else None,
                "class_words": text(sub.get("submission_class_code_description")),
                "url": ("https://www.accessdata.fda.gov/scripts/cder/daf/index.cfm?event=overview.process&ApplNo="
                        f"{m.group(2)}"),
            })
    actions.sort(key=lambda a: (a["date"], a["application"]), reverse=True)
    meta = body.get("meta") if isinstance(body.get("meta"), dict) else {}
    results = meta.get("results") if isinstance(meta.get("results"), dict) else {}
    total = results.get("total")
    not_counted, not_counted_total = tally.not_counted(NOT_COUNTED_CAP)
    disclaimer, _ = cut_words(text(meta.get("disclaimer")), 400)
    return {
        "actions": actions[:APPROVAL_CAP], "actions_cut": len(actions) > APPROVAL_CAP, "actions_matched": len(actions),
        "other_changes": other_changes, "applications_counted": apps_counted,
        "applications_read": len(body["results"]),
        "applications_total": total if isinstance(total, int) and not isinstance(total, bool) else None,
        "counted": tally.counted(), "not_counted": not_counted, "not_counted_total": not_counted_total,
        "data_as_of": iso_day(meta.get("last_updated")), "notice": disclaimer, "dropped": bad,
    }


# ── LDA.gov (lobbying) ───────────────────────────────────────────────────────────────────────

PERIODS = {"first_quarter": 1, "second_quarter": 2, "third_quarter": 3, "fourth_quarter": 4}
REPORT_DAYS = 20          # a quarterly report is due 20 days after the quarter ends (LDA section 5)


def quarter_end(year: int, q: int) -> date:
    month = q * 3
    nxt = date(year + (month // 12), (month % 12) + 1, 1)
    return nxt - timedelta(days=1)


def last_quarters(today: date, n: int = 8) -> list[dict]:
    """The `n` most recent quarters that have ended, newest first: {year, quarter, label, ends, due,
    reports_due (the report deadline has not passed yet)}."""
    q = (today.month - 1) // 3 + 1
    year, q = (today.year, q - 1) if q > 1 else (today.year - 1, 4)
    out = []
    for _ in range(n):
        ends = quarter_end(year, q)
        due = ends + timedelta(days=REPORT_DAYS)
        out.append({"year": year, "quarter": q, "label": f"Q{q} {year}", "ends": ends.isoformat(),
                    "due": due.isoformat(), "reports_due": today < due})
        year, q = (year, q - 1) if q > 1 else (year - 1, 4)
    return out


def filing_rows(body: Any) -> tuple[list[dict], Optional[int], bool, int]:
    """(filings, the agency's count for the query, another page exists, rows not read)."""
    if not isinstance(body, dict) or not isinstance(body.get("results"), list):
        raise ValueError("not a filings answer")
    out, bad = [], 0
    for r in body["results"]:
        if not isinstance(r, dict):
            bad += 1
            continue
        reg = r.get("registrant") if isinstance(r.get("registrant"), dict) else {}
        cli = r.get("client") if isinstance(r.get("client"), dict) else {}
        year = r.get("filing_year")
        period = PERIODS.get(r.get("filing_period"))
        client, registrant = text(cli.get("name")), text(reg.get("name"))
        if not (isinstance(year, int) and period and client and registrant):
            bad += 1
            continue
        issues = []
        for a in r.get("lobbying_activities") or []:
            w = text(a.get("general_issue_code_display")) if isinstance(a, dict) else None
            if w and w not in issues:
                issues.append(w)
        out.append({
            "uuid": text(r.get("filing_uuid")), "type": text(r.get("filing_type")), "year": year, "quarter": period,
            "income": figure(r.get("income")), "expenses": figure(r.get("expenses")),
            "posted": text(r.get("dt_posted")), "client": client, "client_id": cli.get("id"),
            "registrant": registrant, "registrant_id": reg.get("id"), "issues": issues,
            "url": text(r.get("filing_document_url")) if str(r.get("filing_document_url") or "").startswith("https://lda.gov/") else None,
        })
    count = body.get("count")
    return out, (count if isinstance(count, int) and not isinstance(count, bool) else None), bool(body.get("next")), bad


def shape_lobbying(filings: list[dict], names: list[dict], quarters: list[dict]) -> dict:
    """Per quarter, from the counted filings (the client is the company): what the company reported
    spending on its own lobbying (the `expenses` of a report it filed itself) and what outside firms
    reported being paid by it (their `income`), the firms, and the issue areas. An amended report replaces
    the one it amends (one per registrant, client and quarter, the latest posted). The two figures are
    kept apart, never added: a company's own figure may already include what it paid the firms."""
    tally = Tally(names)
    wanted = {(q["year"], q["quarter"]) for q in quarters}
    latest: dict[tuple, dict] = {}
    for f in filings:
        row = tally.add(f["client"])
        if not row or not row["counted"] or (f["year"], f["quarter"]) not in wanted:
            continue
        key = (f["registrant_id"], f["client_id"], f["year"], f["quarter"])
        held = latest.get(key)
        if held is None or (f["posted"] or "") > (held["posted"] or ""):
            latest[key] = f
    out = []
    for q in quarters:
        rows = [f for f in latest.values() if (f["year"], f["quarter"]) == (q["year"], q["quarter"])]
        own = [f for f in rows if is_self_filed(f, names)]
        firms = [f for f in rows if f not in own]
        own_figs = [f["expenses"] for f in own if f["expenses"] is not None]
        firm_figs = [f["income"] for f in firms if f["income"] is not None]
        issue_count: dict[str, int] = {}
        for f in rows:
            for i in f["issues"]:
                issue_count[i] = issue_count.get(i, 0) + 1
        issues = sorted(issue_count.items(), key=lambda kv: (-kv[1], kv[0]))
        out.append({
            **q, "filings": len(rows),
            "own": round(sum(own_figs), 2) if own_figs else None, "own_reports": len(own),
            "own_no_figure": len(own) - len(own_figs),
            "firms": round(sum(firm_figs), 2) if firm_figs else None, "firm_reports": len(firms),
            "firms_no_figure": len(firms) - len(firm_figs),
            "firm_names": sorted({f["registrant"] for f in firms})[:12],
            "issues": [{"issue": k, "filings": v} for k, v in issues[:ISSUE_CAP]], "issues_more": max(0, len(issues) - ISSUE_CAP),
            "links": [f["url"] for f in sorted(rows, key=lambda f: f["posted"] or "", reverse=True) if f["url"]][:3],
        })
    not_counted, not_counted_total = tally.not_counted(NOT_COUNTED_CAP)
    return {"quarters": out, "counted": tally.counted(), "not_counted": not_counted,
            "not_counted_total": not_counted_total}


def is_self_filed(f: dict, names: list[dict]) -> bool:
    """A report the company filed for itself: the registrant's name is the company's too (the same rule)."""
    return match_name(f["registrant"], names) is not None
