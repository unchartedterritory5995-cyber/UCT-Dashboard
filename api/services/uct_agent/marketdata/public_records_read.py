"""MD-1 kind `company.publicRecords` (owner: terminal-data, data wave 10) — one company's public records, as held.

Four government sources for one company, each its own section with its own state, source and read time: the federal
contract obligations to the recipients whose names match the company's over the last twelve months and the twelve
before (USAspending.gov), the clinical trials it leads by phase and status (ClinicalTrials.gov), its FDA drug approvals
and new uses of the last two years (openFDA, Drugs@FDA), and its lobbying over the eight most recent ended quarters
(LDA.gov); with the names each section counted and how. The Agent half of the PUBR terminal function, over the answer
of `GET /api/research/public-records/{ticker}` (`api/services/public_records.py`), with the route's own field names.

⛔ ONLY WHAT THE SERVICE ALREADY HOLDS, NEVER A BUILD (MD-1 §5). The route's `public_records.get_public_records` starts
ONE background build per section, and one for the company's names, on the first read of a company or when a held
section is a day old: each build asks an agency (USAspending.gov, ClinicalTrials.gov, openFDA, LDA.gov) and the SEC. A
turn must not, so this adapter never calls it. It reads through the service's own read-only
`public_records.held_records()`, which returns what is held for each section, or `not_held`, and never builds.
provider_calls is always 0. A rail shows `get_public_records` starting the builds in the same state.

NOTHING HELD IS SAID, NEVER "NO RECORDS": a section not held is `not_held`, in words; nothing held at all is
`unavailable`. A section whose search matched none of the company's names says "no record matched", never that no
record exists: a subsidiary that reports under its own name is not matched.

WHAT IS STATED: every figure, row and name is the service's own (`public_records_parse`, `public_records_match`), passed
through; nothing is recomputed here. A figure an agency did not give is null, never 0. Each section carries its agency's
own requirements as data (`credit`): the D&B attribution for recipient names (register row T-100), ClinicalTrials.gov's
processing date and that no text is changed (T-101), the FDA's credit and openFDA's own notice (T-102), and LDA.gov's
sentence that the Senate Office of Public Records cannot vouch for the data, with the read time (T-103).

THE CUT IS STATED: each section's list returns at most `rows` (the contract awards and the FDA actions newest first, cut
from their OLD end; the active trials by the soonest primary completion, cut from their FAR end), and the counted names
at most twelve, with each list's whole count beside it.

TIME (MD-1 §3): `as_of` is null: each section carries the time UCT read it (`read_at`) and an agency's own processing
date where it gives one; never the time of the read. A section whose last refresh did not go well keeps the answer read
before, with `check` and a note. Every read is `periodic`, as the kind is declared.

MODEL-ISOLATED (ADR-005; when in doubt, isolate): the licensing register
(docs/terminal-research/09-security-licensing-cost/licensing-register.md) clears these four sources for member display
in the PUBR panel only: rows T-100 (USAspending.gov, with the Dun & Bradstreet limitation on recipient names), T-101
(ClinicalTrials.gov), T-102 (openFDA) and T-103 (LDA.gov) each say "Nothing else reads it (no AI lane, no export, no
external publication)". No row clears these records for a model provider. Shown to the member only; the capability is
local-only.
"""
from __future__ import annotations

from typing import Any, Optional

from api.services.uct_agent.marketdata import envelope as env
from api.services.uct_agent.marketdata.short_interest import _day, _num, _read_at, _whole
from api.services.uct_agent.marketdata.stock_stats_read import check_params, clean_symbol, tree

KIND = "company.publicRecords"
SOURCE = "public-records"
DEFAULT_ROWS = 5            # rows of each section's list returned
MAX_ROWS = 25               # public_records_parse.AWARD_CAP (a rail pins the two together)
NAMES_SHOWN = 12            # public_records_parse.NOT_COUNTED_CAP: the counted names returned per section
SECTIONS = ("contracts", "trials", "fda", "lobbying")
SECTION_WORDS = {"contracts": "federal contracts", "trials": "clinical trials", "fda": "FDA approvals", "lobbying": "lobbying"}
#: each section's list: (its key, what it holds, the end it is cut from)
LISTS = {"contracts": ("awards", "contract awards to the matched names, newest first", "OLD"),
         "trials": ("active", "active trials it leads, by the soonest primary completion", "FAR"),
         "fda": ("actions", "FDA approvals and new uses, newest first", "OLD")}
#: each agency's own requirement, as the PUBR panel shows it (licensing register rows T-100 to T-103)
CREDITS = {"contracts": "Recipient names come in part from D&B Open Data (Dun & Bradstreet).",
           "trials": "Data from ClinicalTrials.gov; the titles, statuses, phases, conditions, dates and enrollment are shown as registered, and no text is changed.",
           "fda": "Data provided by the U.S. Food and Drug Administration.",
           "lobbying": "Senate Office of Public Records cannot vouch for the data or analyses derived from these data after the data have been retrieved from LDA.gov."}
STATES = ("matched", "no_match", "no_name", "not_held")
#: the fields each row keeps (the service's own names)
ROW_FIELDS = {"awards": ("award_id", "recipient", "date", "amount", "agency", "sub_agency", "description",
                         "description_cut", "place", "kind", "url"),
              "active": ("nct_id", "title", "status", "phases", "conditions", "conditions_more", "start",
                         "primary_completion", "enrollment", "enrollment_estimated", "last_update", "url"),
              "actions": ("application", "application_words", "sponsor", "drug", "drugs_more", "ingredients", "date",
                          "action", "priority", "class_words", "url")}
#: each list's whole count, beside the rows returned
HELD_KEYS = {"awards": "awards_held", "active": "active_held", "actions": "actions_held"}
QUARTER_FIELDS = ("year", "quarter", "label", "ends", "due", "reports_due", "filings", "own", "own_reports",
                  "own_no_figure", "firms", "firm_reports", "firms_no_figure", "firm_names", "issues", "issues_more")
NAME_FIELDS = ("name", "how", "how_words", "against", "amount", "prior_amount", "records")

NOTE_WHAT = ("{symbol}'s public records as UCT holds them for the PUBR panel, four government sources, each its own "
             "section with its own state, source and read time: federal contract obligations to the recipients whose "
             "names match the company's (USAspending.gov), the clinical trials it leads (ClinicalTrials.gov), its FDA "
             "drug approvals (openFDA, Drugs@FDA) and its lobbying reports (LDA.gov). A record counts only when its name "
             "matches one of the company's names. Records, not advice")
NOTE_AS_OF = ("`as_of` is null: each section carries the time UCT read it (`read_at`), and an agency's own processing "
              "date where it gives one; never the time of this read")
NOTE_NOT_HELD_SECTIONS = ("{n} of the four sections are not held on this server yet ({what}), and this read never asks "
                          "an agency. That is not the same as no record")
NOTE_NO_MATCH = ("{n} sections found no record matching the company's names ({what}): no record matched, which is not "
                 "the same as no record existing (a subsidiary that reports under its own name is not matched)")
NOTE_NO_NAME = "{n} sections had no company name to search with ({what}), so nothing was searched"
NOTE_COMPANY = "the company's names are not held yet, so the sections cannot say which names they searched with"
NOTE_CUT = "{what}: {total} matched and the first {shown} are returned: the list is cut from the {end} end"
NOTE_CHECK = ("UCT's last look at {what} did not go well: what is held is the answer it read before, and this read never "
              "looks again")
NOTE_NOT_HELD = ("{symbol}'s public records are not held on this server yet, and this read never asks an agency. That is "
                 "not the same as no records. Open PUBR for {symbol} in UCT, then ask again")
NOTE_FAILED = "the public records read failed; nothing is stated. That is not the same as no records"


def validate(params: dict) -> Optional[str]:
    """Pure parameter check, run by the gateway BEFORE admission, so a malformed request spends no read."""
    return check_params(params, MAX_ROWS, DEFAULT_ROWS)


def held_answer(sym: str) -> dict:
    """READ ONLY: what the service holds for `sym`, section by section (`public_records.held_records`: each section held,
    or `not_held`), WITHOUT starting a build or asking an agency."""
    from api.services import public_records as svc
    return svc.held_records(sym)


def _pick(row: Any, fields: tuple) -> dict:
    return {k: tree(row.get(k)) for k in fields} if isinstance(row, dict) else {}


def _section(key: str, raw: Any, limit: int) -> tuple[dict, Optional[tuple]]:
    """One section as this read returns it, and its cut `(total, shown)` or None."""
    s = raw if isinstance(raw, dict) else {}
    base = {"source": s.get("source") if isinstance(s.get("source"), str) else None,
            "source_url": s.get("source_url") if isinstance(s.get("source_url"), str) else None, "credit": CREDITS[key]}
    if s.get("status") != "ok" or s.get("state") not in STATES[:3]:
        return {**base, "state": "not_held"}, None
    counted = [_pick(n, NAME_FIELDS) for n in (s.get("counted") or []) if isinstance(n, dict)]
    out = {**base, "state": s["state"], "read_at": _read_at(s.get("read_at")) if s.get("read_at") else None,
           "searched_for": s.get("searched_for") if isinstance(s.get("searched_for"), str) else None,
           "names": [_pick(n, ("name", "source", "source_words", "until")) for n in (s.get("names") or []) if isinstance(n, dict)][:NAMES_SHOWN],
           "counted": counted[:NAMES_SHOWN], "counted_total": len(counted),
           "not_counted_total": _whole(s.get("not_counted_total")) or 0, "dropped": _whole(s.get("dropped")) or 0,
           "check": tree(s.get("check")) if isinstance(s.get("check"), dict) else None}
    cut = None
    if key == "contracts":
        out.update({"recent_total": _num(s.get("recent_total")), "prior_total": _num(s.get("prior_total")),
                    "windows": tree(s.get("windows")) if isinstance(s.get("windows"), dict) else None,
                    "recipients_more": s.get("recipients_more") is True, "awards_more": s.get("awards_more") is True})
    elif key == "trials":
        out.update({"active_matched": _whole(s.get("active_matched")) or 0, "closed_matched": _whole(s.get("closed_matched")) or 0,
                    "active_total": _whole(s.get("active_total")), "active_read": _whole(s.get("active_read")),
                    "by_phase": tree(s.get("by_phase")) if isinstance(s.get("by_phase"), dict) else {},
                    "by_status": tree(s.get("by_status")) if isinstance(s.get("by_status"), dict) else {},
                    "data_processed": s.get("data_processed") if isinstance(s.get("data_processed"), str) else None,
                    "closed_since": _day(s.get("closed_since"))})
    elif key == "fda":
        out.update({"actions_matched": _whole(s.get("actions_matched")) or 0, "other_changes": _whole(s.get("other_changes")) or 0,
                    "applications_counted": _whole(s.get("applications_counted")) or 0, "since": _day(s.get("since")),
                    "data_as_of": _day(s.get("data_as_of")),
                    "notice": s.get("notice") if isinstance(s.get("notice"), str) else None})
    else:
        out.update({"quarters": [_pick(q, QUARTER_FIELDS) for q in (s.get("quarters") or []) if isinstance(q, dict)][:8],
                    "cut": s.get("cut") is True, "filings_read": _whole(s.get("filings_read")) or 0})
    if key in LISTS:
        name = LISTS[key][0]
        rows = [_pick(r, ROW_FIELDS[name]) for r in (s.get(name) or []) if isinstance(r, dict)]
        held = {"awards": len(rows), "active": _whole(s.get("active_matched")), "actions": _whole(s.get("actions_matched"))}[name]
        held = max(held or 0, len(rows))
        out[name] = rows[:limit]
        out[HELD_KEYS[name]] = held
        if held > len(out[name]):
            cut = (held, len(out[name]))
    return out, cut


def read_records(params: dict, ctx: dict) -> dict:  # noqa: ARG001 — no per-user state
    why = validate(params)
    if why:
        return env.unavailable(KIND, params, SOURCE, why)
    sym, limit = clean_symbol(params["symbol"]), params.get("rows", DEFAULT_ROWS)
    try:
        got = held_answer(sym)                                    # what is held only: never a build
        if not isinstance(got, dict) or got.get("status") != "ok" or not all(isinstance(got.get(k), dict) for k in SECTIONS):
            return env.unavailable(KIND, params, SOURCE, NOTE_FAILED)
        built = {k: _section(k, got[k], limit) for k in SECTIONS}
    except Exception:  # noqa: BLE001 — a failing read is an honest unavailable, never "no records"
        return env.unavailable(KIND, params, SOURCE, NOTE_FAILED)
    sections = {k: v[0] for k, v in built.items()}
    by_state = {s: [k for k in SECTIONS if sections[k]["state"] == s] for s in STATES}
    if len(by_state["not_held"]) == len(SECTIONS):
        return env.unavailable(KIND, params, SOURCE, NOTE_NOT_HELD.format(symbol=sym))
    c = got.get("company") if isinstance(got.get("company"), dict) else {}
    company = ({"state": "ok", "cik": c.get("cik") if isinstance(c.get("cik"), str) else None,
                "names": [_pick(n, ("name", "source", "source_words", "until")) for n in (c.get("names") or []) if isinstance(n, dict)][:NAMES_SHOWN],
                "read_at": _read_at(c.get("read_at")) if c.get("read_at") else None, "source": c.get("source")}
               if c.get("status") == "ok" else {"state": "not_held", "source": c.get("source")})

    words = lambda ks: ", ".join(SECTION_WORDS[k] for k in ks)      # noqa: E731
    notes = [NOTE_WHAT.format(symbol=sym), NOTE_AS_OF]
    if by_state["not_held"]:
        notes.append(NOTE_NOT_HELD_SECTIONS.format(n=len(by_state["not_held"]), what=words(by_state["not_held"])))
    if by_state["no_match"]:
        notes.append(NOTE_NO_MATCH.format(n=len(by_state["no_match"]), what=words(by_state["no_match"])))
    if by_state["no_name"]:
        notes.append(NOTE_NO_NAME.format(n=len(by_state["no_name"]), what=words(by_state["no_name"])))
    if company["state"] != "ok":
        notes.append(NOTE_COMPANY)
    for k in SECTIONS:
        cut = built[k][1]
        if cut:
            notes.append(NOTE_CUT.format(what=LISTS[k][1], total=cut[0], shown=cut[1], end=LISTS[k][2]))
    checked = [k for k in SECTIONS if sections[k].get("check")]
    if checked:
        notes.append(NOTE_CHECK.format(what=words(checked)))

    held = [k for k in SECTIONS if sections[k]["state"] != "not_held"]
    data = {"symbol": sym, "as_of": None, "company": company, **sections}
    coverage = {"evaluated": len(SECTIONS), "answered": len(held), "dropped": len(SECTIONS) - len(held),
                "not_computable": len(by_state["no_name"])}
    status = "ok" if len(held) == len(SECTIONS) else "partial"
    return env.make_envelope(KIND, params, status=status, freshness="periodic", as_of=None, source=SOURCE, data=data,
                             stale=bool(checked), coverage=coverage, notes=notes, provider_calls=0)
