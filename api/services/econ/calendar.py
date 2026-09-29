"""Release calendar: WHEN each release is expected and WHICH period it carries.

Every event is stored through ``store.put_event`` (insert-or-supersede on a date/
time change; never physically deleted) and carries its SOURCE CLASS, so the
status surface can always say how much to trust it:

  AUTHORITATIVE_FEED  machine-readable agency calendar      BEA release_dates.json (UTC),
                                                            fiscaldata release calendar (MTS)
  AUTHORITATIVE_PAGE  agency HTML table parsed               Census economic-indicator list view
  CONFIGURED          operator transcription + citation      calendars/*.json (BLS/PFEI, G.17,
                                                            FHFA, Empire State, EIA holiday table)
  RULE                agency-published cadence rule          H.15, H.4.1, H.6, NY Fed rates,
                                                            DTS / Debt to the Penny, EIA WPSR/gas,
                                                            DOL claims, past MTS (8th business day)

PRECISION (model.SchedulePrecision) describes the DATE+TIME certainty:
  exact            date AND time stated by the agency
  time_configured  date from an official publication, time CONFIGURED from agency
                   practice (BLS: the PFEI states no times). Windows open at the
                   configured time; status must not present it as agency-published.
  rule             from a published cadence rule ("each Thursday, generally 4:30 p.m.")
  date_only        date known, time NOT known -> never invent 08:30
  unknown          UCT knows a release for this period exists but NOT when (a hole in
                   an authoritative feed -- e.g. no October 2026 MTS in the fiscaldata
                   calendar -- or a holiday week with no published shift rule). An
                   unknown event can never produce CHECKING or DELAYED, only
                   NO_EXPECTATION (or CURRENT once the period is actually held).
                   Its sched_date is the EARLIEST day it could appear, not a guess.

PERIOD LABELS (calendar_event.period_label) -- one grammar for every provider:
  'YYYY-MM' (month) | 'YYYYQn' (quarter) | 'YYYY' (year) | 'YYYY-MM-DD' (daily
  observation date, or the week-ENDING date of a weekly period), optionally
  followed by '/rev<n>' when the release REVISES an already-published period
  instead of adding one (GDP second estimate = '2026Q3/rev1', third = '/rev2';
  G.17 annual revision = '2026-10/rev1'). The store keeps one active event per
  (calendar_key, period_label), which is why revisions need their own label.

COVERAGE: each calendar key may carry a coverage end (``calendar_coverage`` side
table): the calendar claims to know EVERY release up to that date. Past it, with
no future event, currentness reports NO_EXPECTATION -- a stale configured file
can never keep a series CURRENT (bls_2026.json expires 2026-12-31).
"""
from __future__ import annotations

import html as _html
import json
import re
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable, Optional

from . import timeutil
from .model import SchedulePrecision as P, ScheduleSource as S

ET_TZ = "America/New_York"
CALENDAR_DIR = Path(__file__).with_name("calendars")

BEA_URL = "https://apps.bea.gov/API/signup/release_dates.json"
CENSUS_URL = "https://www.census.gov/economic-indicators/calendar-listview.html"
FISCAL_URL = "https://api.fiscaldata.treasury.gov/services/calendar/release"
MTS_DATASET_ID = "015-BFS-2014Q1-13"

GDP_MIN_ADVANCE_DAYS = 20   # BEA's advance estimate never lands < ~25 days after quarter end
BEA_RELEASES = {"Gross Domestic Product": "bea:gdp", "Personal Income and Outlays": "bea:pio"}
CENSUS_INDICATORS = (   # (lower-case name prefix, calendar key) -- first match wins
    ("advance monthly sales for retail and food services", "census:marts"),
    ("new residential construction", "census:resconst"),
    ("advance report on durable goods", "census:m3adv"),
    ("full report - manufacturers' shipments", "census:m3"),
    ("u.s. international trade in goods and services", "census:ft900"),
    ("new residential sales", "census:ressales"),
    ("construction spending", "census:vip"),
    ("manufacturing and trade: inventories and sales", "census:mtis"),
    ("monthly wholesale trade", "census:mwts"),
)
CENSUS_MIN_ROWS = 100    # a full-year list view has ~174 rows; the phase-0 copy had 22

CONFIGURED_FILES = ("bls_2026.json", "fed_g17.json", "fhfa_hpi.json", "nyfed_esms.json")
EIA_HOLIDAY_FILE = "eia_wpsr_holidays.json"

# Rule citations (agency statements, fetched 2026-09-28; see RELEASE-SYSTEM.md).
CITE = {
    "fed:h15": "rule: FRB H.15 page 'The release is posted daily Monday through Friday at 4:15pm. The release is "
               "not posted on holidays'; an observation for business day d is published the next business day",
    "fed:h41": "rule: FRB H.4.1 page 'released each Thursday, generally at 4:30 p.m. Publication may be shifted to "
               "the next business day when the regular publication date falls on a federal holiday'; label = the "
               "Wednesday level",
    "fed:h6": "rule: FRB H.6 page 'released on the fourth Tuesday of every month, generally at 1:00 p.m. Publication "
              "may be shifted to the next business day when the regular publication date falls on a federal "
              "holiday'; carries the previous month",
    "nyfed:effr": "rule: NY Fed reference-rates page 'The EFFR and the OBFR will be published at approximately 9:00 "
                  "a.m. ET each business day'; carries the previous business day",
    "nyfed:obfr": "rule: NY Fed reference-rates page 'The EFFR and the OBFR will be published at approximately 9:00 "
                  "a.m. ET each business day'; carries the previous business day",
    "nyfed:sofr": "rule: NY Fed 'Each business day, the New York Fed publishes the SOFR ... at approximately 8:00 "
                  "a.m. ET'; carries the previous business day",
    "nyfed:rrp": "rule: NY Fed ON RRP operation results published the same day (operation window 12:45-13:15 ET)",
    "fiscal:dts": "rule: Daily Treasury Statement published ~16:00 ET the next business day (fiscaldata release "
                  "calendar 015-BFS-2014Q1-03 lists 20:00/21:00 UTC)",
    "fiscal:dtp": "rule: Debt to the Penny published ~16:15 ET the next business day (fiscaldata release calendar "
                  "015-BFS-2014Q3-065 lists 20:15 UTC)",
    "fiscal:mts": "rule: Monthly Treasury Statement on the 8th business day at 14:00 ET (used ONLY for months before "
                  "the fiscaldata feed window; a month missing INSIDE the feed window is a hole, never filled)",
    "eia:wpsr": "rule: EIA WPSR schedule page 'Tables 1-14 ... released ... after 10:30 a.m. eastern time on "
                "Wednesday' for the week ending the previous Friday; holiday weeks from the EIA holiday table",
    "eia:gasdiesel": "rule: EIA Gasoline and Diesel Fuel Update, Monday survey released Monday ~17:00 ET "
                     "(next business day when Monday is a federal holiday)",
    "dol:claims": "rule: DOL weekly claims news release Thursday 08:30 ET for the week ending the previous "
                  "Saturday; NO holiday-shift rule is published on any fetchable DOL page",
}

# calendar key -> (provider, source class) -- the status coverage table.
KNOWN_CALENDARS = {
    "bea:gdp": ("bea_feed", S.AUTHORITATIVE_FEED), "bea:pio": ("bea_feed", S.AUTHORITATIVE_FEED),
    "census:marts": ("census_page", S.AUTHORITATIVE_PAGE), "census:resconst": ("census_page", S.AUTHORITATIVE_PAGE),
    "census:m3adv": ("census_page", S.AUTHORITATIVE_PAGE), "census:m3": ("census_page", S.AUTHORITATIVE_PAGE),
    "census:ft900": ("census_page", S.AUTHORITATIVE_PAGE), "census:ressales": ("census_page", S.AUTHORITATIVE_PAGE),
    "census:vip": ("census_page", S.AUTHORITATIVE_PAGE), "census:mtis": ("census_page", S.AUTHORITATIVE_PAGE),
    "census:mwts": ("census_page", S.AUTHORITATIVE_PAGE),
    "bls:cpi": ("bls_2026", S.CONFIGURED), "bls:empsit": ("bls_2026", S.CONFIGURED),
    "bls:ppi": ("bls_2026", S.CONFIGURED), "bls:eci": ("bls_2026", S.CONFIGURED),
    "bls:jolts": ("bls_2026", S.CONFIGURED),
    "fed:g17": ("fed_g17", S.CONFIGURED), "fhfa:hpi_monthly": ("fhfa_hpi", S.CONFIGURED),
    "nyfed:esms": ("nyfed_esms", S.CONFIGURED),
    "fiscal:mts": ("fiscal_feed", S.AUTHORITATIVE_FEED),
    **{k: ("rule", S.RULE) for k in ("fed:h15", "fed:h41", "fed:h6", "nyfed:effr", "nyfed:obfr", "nyfed:sofr",
                                     "nyfed:rrp", "fiscal:dts", "fiscal:dtp", "eia:wpsr", "eia:gasdiesel",
                                     "dol:claims")},
}
DAILY_KEYS = frozenset({"fed:h15", "nyfed:effr", "nyfed:obfr", "nyfed:sofr", "nyfed:rrp", "fiscal:dts",
                        "fiscal:dtp"})


class CalendarParseError(ValueError):
    """A calendar payload could not be trusted; the previously stored events stay."""


# ─────────────────────────────── event model ─────────────────────────────────

@dataclass(frozen=True)
class Event:
    calendar_key: str
    period_label: str
    sched_date: str                     # ISO date, America/New_York
    sched_time: Optional[str]           # 'HH:MM' ET, None when the time is not known
    precision: str                      # model.SchedulePrecision value
    source: str                         # model.ScheduleSource value
    provenance: str = ""
    tz: str = ET_TZ
    event_id: Optional[int] = None

    @classmethod
    def from_row(cls, row) -> "Event":
        if isinstance(row, Event):
            return row
        return cls(calendar_key=row["calendar_key"], period_label=row["period_label"],
                   sched_date=row["sched_date"], sched_time=row.get("sched_time"),
                   precision=row["precision"], source=row["source"], provenance=row.get("provenance") or "",
                   tz=row.get("tz") or ET_TZ, event_id=row.get("event_id"))

    @property
    def has_time(self) -> bool:
        return bool(self.sched_time) and self.precision != P.UNKNOWN.value

    @property
    def is_hole(self) -> bool:
        return self.precision == P.UNKNOWN.value

    @property
    def scheduled_at(self) -> int:
        """Unix seconds of the scheduled instant; the START of the ET day when no time is known."""
        return timeutil.et_to_utc(self.sched_date, self.sched_time if self.has_time else "00:00")

    @property
    def revision(self) -> int:
        return split_label(self.period_label)[1]

    def public(self) -> dict:
        """The member/status-safe view (dates, time, class; never internals)."""
        return {"date": self.sched_date, "time": self.sched_time if self.has_time else None, "tz": self.tz,
                "precision": self.precision, "source": self.source, "period_label": self.period_label}


@dataclass
class CalendarBatch:
    provider: str
    events: list = field(default_factory=list)
    coverage: dict = field(default_factory=dict)     # calendar_key -> (start_iso|None, end_iso|None)
    detail: str = ""


def split_label(label: str) -> tuple[str, int]:
    m = re.fullmatch(r"(.+?)/rev(\d+)", label or "")
    return (m.group(1), int(m.group(2))) if m else (label, 0)


def month_label(d: date) -> str:
    return f"{d.year:04d}-{d.month:02d}"


def prev_month(d: date) -> date:
    return timeutil.add_months(d.replace(day=1), -1)


# ─────────────────────────────── expected period ─────────────────────────────

@dataclass(frozen=True)
class Expected:
    """What an event expects to exist for one series."""
    period_start: str
    period_end: str
    label: str
    kind: str                  # 'new' (adds the period) | 'revision' (re-publishes an existing one)
    revision: int = 0


def expected_period(spec, event) -> Optional[Expected]:
    """The period `event` carries, on `spec`'s frequency grid; None when the
    label cannot be read on that grid (wrong frequency / anchor) -- the caller
    then has no expectation from this event."""
    ev = Event.from_row(event) if not isinstance(event, Event) else event
    base, rev = split_label(ev.period_label)
    f = str(getattr(_g(spec, "frequency"), "value", _g(spec, "frequency")) or "").upper()
    try:
        if f == "M":
            if not re.fullmatch(r"\d{4}-\d{2}", base):
                return None
            ps, pe = timeutil.parse_month(base)
        elif f == "Q":
            if not re.fullmatch(r"\d{4}Q[1-4]", base):
                return None
            ps, pe = timeutil.parse_quarter(base)
        elif f == "A":
            if not re.fullmatch(r"\d{4}", base):
                return None
            ps, pe = timeutil.year_bounds(int(base))
        elif f == "W":
            ps, pe = timeutil.week_bounds(base, _g(spec, "week_anchor") or None)
        elif f in ("D", "IRREG"):
            ps = pe = timeutil.as_date(base)
        else:
            return None
    except ValueError:
        return None
    return Expected(ps.isoformat(), pe.isoformat(), ev.period_label, "revision" if rev else "new", rev)


def _g(obj, key, default=None):
    if isinstance(obj, dict):
        return obj.get(key, default)
    return getattr(obj, key, default)


# ─────────────────────────────── providers ───────────────────────────────────

def bea_events(payload) -> CalendarBatch:
    """BEA release_dates.json -> bea:gdp / bea:pio. Exact UTC instants.

    GDP (the file has NO estimate labels): a release carries the latest quarter
    that ended at least GDP_MIN_ADVANCE_DAYS before it; the estimate is read
    from the lag after quarter end (<=45 d advance = NEW, <=75 '/rev1' second,
    <=110 '/rev2' third, later '/rev3'), forced strictly increasing per
    quarter. Verified on the 2026 remainder (Sep 30 = 2026Q2/rev2, Oct 29 =
    2026Q3 advance, Nov 25 = /rev1, Dec 23 = /rev2); the post-shutdown Jan-Apr
    2026 catch-up releases may be mislabelled -- they are past and only the
    latest past event drives currentness. PIO: the month before the release month.
    Duplicate entries (BEA repeats some) are dropped.
    """
    data = json.loads(payload) if isinstance(payload, (bytes, str)) else payload
    if not isinstance(data, dict):
        raise CalendarParseError("bea: release_dates.json is not an object")
    stamp = str(data.get("file_last_updated") or "?")
    out = CalendarBatch("bea_feed", detail=f"file_last_updated={stamp}")
    for name, key in BEA_RELEASES.items():
        block = data.get(name)
        if not isinstance(block, dict) or not isinstance(block.get("release_dates"), list):
            raise CalendarParseError(f"bea: release {name!r} missing")
        instants = set()
        for s in block["release_dates"]:
            try:
                instants.add(int(datetime.fromisoformat(str(s)).astimezone(timezone.utc).timestamp()))
            except (TypeError, ValueError):
                raise CalendarParseError(f"bea: unparseable release instant in {name!r}") from None
        if len(instants) < 4:
            raise CalendarParseError(f"bea: {name!r} lists only {len(instants)} dates")
        per_q: dict[str, int] = {}
        years = set()
        for ts in sorted(instants):
            et = timeutil.utc_to_et(ts)
            d = et.date()
            years.add(d.year)
            if key == "bea:gdp":
                y, q = timeutil.quarter_of(d)
                q -= 1
                if q == 0:
                    y, q = y - 1, 4
                qend = timeutil.quarter_bounds(y, q)[1]
                if (d - qend).days < GDP_MIN_ADVANCE_DAYS:    # too soon for this quarter: a late release of the prior one
                    y, q = (y, q - 1) if q > 1 else (y - 1, 4)
                    qend = timeutil.quarter_bounds(y, q)[1]
                base = f"{y}Q{q}"
                lag = (d - qend).days
                n = 0 if lag <= 45 else 1 if lag <= 75 else 2 if lag <= 110 else 3
                n = max(n, per_q.get(base, -1) + 1)          # labels strictly increase per quarter
                per_q[base] = n
                label = base if n == 0 else f"{base}/rev{n}"
            else:
                label = month_label(prev_month(d))
                if label in per_q:            # two PIO releases in one month: keep the later
                    out.events = [e for e in out.events if e.period_label != label or e.calendar_key != key]
                per_q[label] = 1
            out.events.append(Event(key, label, d.isoformat(), et.strftime("%H:%M"), P.EXACT.value,
                                    S.AUTHORITATIVE_FEED.value,
                                    f"BEA release_dates.json '{name}' {et.isoformat()} ({stamp}); {BEA_URL}"))
        first = min(e.sched_date for e in out.events if e.calendar_key == key)
        out.coverage[key] = (first, f"{max(years)}-12-31")
    return out


_CENSUS_ROW = re.compile(r"<tr[^>]*>(.*?)</tr>", re.S | re.I)
_TD = re.compile(r"<td[^>]*>(.*?)</td>", re.S | re.I)


def census_events(page, *, min_rows: int = CENSUS_MIN_ROWS) -> CalendarBatch:
    """Census economic-indicator calendar list view -> census:* keys.

    Rows carry hidden sort keys A{YYYYMMDDHHMM} (release instant, ET) and
    A{YYYYMM} (period covered). A page with fewer than `min_rows` rows is
    refused (the phase-0 saved copy was truncated at 22 rows)."""
    text = page.decode("utf-8", "replace") if isinstance(page, bytes) else str(page)
    m = re.search(r"(\d{4})\s+Economic Indicator Release Schedule", text)
    if not m:
        raise CalendarParseError("census: page is not the economic-indicator list view")
    year = int(m.group(1))
    rows = []
    for tr in _CENSUS_ROW.findall(text):
        tds = _TD.findall(tr)
        keys = [re.sub(r"\s+", "", _html.unescape(re.sub(r"<[^>]+>", "", t))) for t in tds]
        inst = next((k for k in keys if re.fullmatch(r"A\d{12}", k)), None)
        per = next((k for k in keys if re.fullmatch(r"A\d{6}", k)), None)
        if not inst or not per or not tds:
            continue
        name = " ".join(_html.unescape(re.sub(r"<[^>]+>", " ", tds[0])).split())
        rows.append((name, inst[1:], per[1:]))
    if len(rows) < min_rows:
        raise CalendarParseError(f"census: only {len(rows)} rows (< {min_rows}); refusing a truncated page")
    out = CalendarBatch("census_page", detail=f"{len(rows)} rows, year {year}")
    seen = set()
    for name, inst, per in rows:
        low = name.lower()
        key = next((k for prefix, k in CENSUS_INDICATORS if low.startswith(prefix)), None)
        if key is None:
            continue
        d = date(int(inst[:4]), int(inst[4:6]), int(inst[6:8]))
        hhmm = f"{inst[8:10]}:{inst[10:12]}"
        label = f"{per[:4]}-{per[4:6]}"
        if (key, label) in seen:
            continue
        seen.add((key, label))
        out.events.append(Event(key, label, d.isoformat(), hhmm, P.EXACT.value, S.AUTHORITATIVE_PAGE.value,
                                f"Census list view '{name}' {d.isoformat()} {hhmm} ET, period {label}; {CENSUS_URL}"))
    for key in {e.calendar_key for e in out.events}:
        first = min(e.sched_date for e in out.events if e.calendar_key == key)
        out.coverage[key] = (first, f"{year}-12-31")
    if not out.events:
        raise CalendarParseError("census: no mapped indicators found")
    return out


def nth_business_day(year: int, month: int, n: int) -> date:
    d = timeutil.on_or_after_business_day(date(year, month, 1))
    return timeutil.add_business_days(d, n - 1)


def fiscal_events(payload) -> CalendarBatch:
    """fiscaldata release calendar -> fiscal:mts (exact; times read as UTC --
    the offset is INFERRED from the 1-hour shift at DST end, not documented).

    A month inside the feed window whose 8th-business-day falls inside the
    window but that has NO MTS entry becomes a HOLE event (precision unknown):
    UCT knows the statement exists and does not know when -> NO_EXPECTATION,
    never an invented date."""
    data = json.loads(payload) if isinstance(payload, (bytes, str)) else payload
    if isinstance(data, dict):
        data = data.get("data")
    if not isinstance(data, list) or len(data) < 50:
        raise CalendarParseError("fiscaldata: calendar is not a list of releases")
    dates = []
    mts: dict[str, Event] = {}
    for r in data:
        try:
            d = date.fromisoformat(str(r["date"]))
            dates.append(d)
            if r.get("datasetId") != MTS_DATASET_ID:
                continue
            hh, mm = str(r.get("time") or "").split(":")
            ts = int(datetime(d.year, d.month, d.day, int(hh), int(mm), tzinfo=timezone.utc).timestamp())
        except (KeyError, TypeError, ValueError):
            raise CalendarParseError("fiscaldata: malformed release row") from None
        et = timeutil.utc_to_et(ts)
        label = month_label(prev_month(et.date()))
        mts[label] = Event("fiscal:mts", label, et.date().isoformat(), et.strftime("%H:%M"), P.EXACT.value,
                           S.AUTHORITATIVE_FEED.value,
                           f"fiscaldata release calendar {MTS_DATASET_ID} {r['date']} {r['time']} (UTC, inferred); "
                           f"{FISCAL_URL}")
    lo, hi = min(dates), max(dates)
    out = CalendarBatch("fiscal_feed", events=sorted(mts.values(), key=lambda e: e.sched_date),
                        detail=f"window {lo}..{hi}, {len(mts)} MTS rows")
    m = lo.replace(day=1)
    while m <= hi:
        rule = nth_business_day(m.year, m.month, 8)
        label = month_label(prev_month(m))
        if lo <= rule <= hi and label not in mts:
            first = timeutil.on_or_after_business_day(max(m, lo))
            out.events.append(Event("fiscal:mts", label, first.isoformat(), None, P.UNKNOWN.value,
                                    S.AUTHORITATIVE_FEED.value,
                                    f"HOLE: the fiscaldata release calendar (window {lo}..{hi}) lists NO MTS for "
                                    f"period {label}; UCT does not invent a date (the 8th-business-day rule would "
                                    f"say {rule}). sched_date = earliest possible day"))
        m = timeutil.add_months(m, 1)
    out.coverage["fiscal:mts"] = (lo.isoformat(), hi.isoformat())
    return out


def configured_events(names: Iterable[str] = CONFIGURED_FILES, *, directory: Path = CALENDAR_DIR) -> CalendarBatch:
    """calendars/*.json -> events. Provenance = '<date citation> | <time citation>'."""
    out = CalendarBatch("configured")
    for name in names:
        doc = json.loads((directory / name).read_text(encoding="utf-8"))
        cites = doc.get("citations") or {}
        cov = doc.get("coverage") or {}
        for key, cal in (doc.get("calendars") or {}).items():
            prec = P(cal["precision"]).value
            src = S(cal.get("source", "configured")).value
            dc, tc = cites.get(cal.get("date_cite"), ""), cites.get(cal.get("time_cite"), "")
            prov = f"[{doc['id']}] date: {dc}" + (f" | {tc}" if tc and tc != dc else "")
            for row in cal["events"]:
                d, label = row[0], row[1]
                t = row[2] if len(row) > 2 else cal.get("time_et")
                timeutil.as_date(d)
                out.events.append(Event(key, label, d, t, prec, src, prov))
            out.coverage[key] = (cov.get("start"), cov.get("end"))
        out.detail += f"{doc['id']} "
    return out


def _eia_exceptions(directory: Path = CALENDAR_DIR) -> tuple[dict, Optional[str], str]:
    doc = json.loads((directory / EIA_HOLIDAY_FILE).read_text(encoding="utf-8"))
    ex = {r[0]: (r[1], r[2]) for r in doc["exceptions"]}
    return ex, (doc.get("coverage") or {}).get("end"), (doc.get("citations") or {}).get("wpsr", "")


def _days(start: date, end: date):
    d = start
    while d <= end:
        yield d
        d += timedelta(days=1)


def _holiday_between(a: date, b: date) -> bool:
    return any(timeutil.is_federal_holiday(d) for d in _days(a, b))


def rule_events(today, *, back_days: int = 70, fwd_days: int = 120, daily_back: int = 10,
                daily_fwd: int = 14, skip_labels: Optional[dict] = None,
                directory: Path = CALENDAR_DIR) -> CalendarBatch:
    """Rule-generated events whose RELEASE date is in [today-back, today+fwd]
    (daily families: a shorter horizon). Deterministic for a given `today`.
    `skip_labels` = {calendar_key: set(labels)} already held by a better source
    (only fiscal:mts uses it)."""
    today = timeutil.as_date(today)
    lo, hi = today - timedelta(days=back_days), today + timedelta(days=fwd_days)
    dlo, dhi = today - timedelta(days=daily_back), today + timedelta(days=daily_fwd)
    out = CalendarBatch("rule")
    R, RS = P.RULE.value, S.RULE.value

    def add(key, label, d, t, prec=R, src=RS, note=""):
        out.events.append(Event(key, label, d.isoformat(), t, prec, src, CITE[key] + (f"; {note}" if note else "")))

    # daily families: observation d -> release date/time
    for obs in _days(dlo - timedelta(days=7), dhi):
        if not timeutil.is_business_day(obs):
            continue
        nxt = timeutil.next_business_day(obs)
        for key, rel, t in (("fed:h15", nxt, "16:15"), ("nyfed:effr", nxt, "09:00"), ("nyfed:obfr", nxt, "09:00"),
                            ("nyfed:sofr", nxt, "08:00"), ("nyfed:rrp", obs, "13:15"),
                            ("fiscal:dts", nxt, "16:00"), ("fiscal:dtp", nxt, "16:15")):
            if dlo <= rel <= dhi:
                add(key, obs.isoformat(), rel, t)
    ex, ex_end, ex_cite = _eia_exceptions(directory)
    for d in _days(lo - timedelta(days=14), hi):
        wd = d.weekday()
        if wd == 2:                                          # Wednesday level -> H.4.1 Thursday
            rel = timeutil.on_or_after_business_day(d + timedelta(days=1))
            if lo <= rel <= hi:
                add("fed:h41", d.isoformat(), rel, "16:30")
        elif wd == 4:                                        # week ending Friday -> WPSR
            wed = d + timedelta(days=5)
            if d.isoformat() in ex:
                alt, t = ex[d.isoformat()]
                rel = timeutil.as_date(alt)
                if lo <= rel <= hi:
                    add("eia:wpsr", d.isoformat(), rel, t, P.EXACT.value, S.CONFIGURED.value,
                        f"holiday exception from the EIA holiday table: {ex_cite}")
            elif _holiday_between(d + timedelta(days=3), wed):
                if lo <= wed <= hi:
                    add("eia:wpsr", d.isoformat(), wed, None, P.UNKNOWN.value, RS,
                        "holiday week NOT in the EIA holiday table -> release day unknown (earliest = Wednesday)")
            elif lo <= wed <= hi:
                add("eia:wpsr", d.isoformat(), wed, "10:30")
        elif wd == 0:                                        # Monday survey -> gasoline
            rel = timeutil.on_or_after_business_day(d)
            if lo <= rel <= hi:
                add("eia:gasdiesel", d.isoformat(), rel, "17:00")
        elif wd == 5:                                        # week ending Saturday -> claims Thursday
            thu = d + timedelta(days=5)
            if timeutil.is_federal_holiday(thu):
                wed = thu - timedelta(days=1)
                if lo <= wed <= hi:
                    add("dol:claims", d.isoformat(), wed, None, P.UNKNOWN.value, RS,
                        "Thursday is a federal holiday and DOL publishes no shift rule -> date UNKNOWN")
            elif _holiday_between(d + timedelta(days=2), thu - timedelta(days=1)):
                if lo <= thu <= hi:
                    add("dol:claims", d.isoformat(), thu, None, P.DATE_ONLY.value, RS,
                        "holiday week: shift rule unknown -> date only, no time claimed")
            elif lo <= thu <= hi:
                add("dol:claims", d.isoformat(), thu, "08:30")
    m = lo.replace(day=1)
    held = (skip_labels or {}).get("fiscal:mts", set())
    while m <= hi:
        tue4 = timeutil._nth_weekday(m.year, m.month, 1, 4)
        rel = timeutil.on_or_after_business_day(tue4)
        if lo <= rel <= hi:
            add("fed:h6", month_label(prev_month(m)), rel, "13:00")
        mts = nth_business_day(m.year, m.month, 8)
        label = month_label(prev_month(m))
        if lo <= mts <= today and label not in held:          # past months only: never forecast MTS by rule
            add("fiscal:mts", label, mts, "14:00")
        m = timeutil.add_months(m, 1)
    for key in {e.calendar_key for e in out.events}:
        if key == "fiscal:mts":
            continue
        out.coverage[key] = (None, None)                      # rules never expire (horizon refreshed daily)
    return out


# ─────────────────────────────── persistence ─────────────────────────────────

_COVERAGE_DDL = """
CREATE TABLE IF NOT EXISTS calendar_coverage (
    calendar_key   TEXT PRIMARY KEY,
    provider       TEXT NOT NULL,
    source         TEXT NOT NULL,
    coverage_start TEXT,
    coverage_end   TEXT,
    refreshed_at   INTEGER NOT NULL,
    detail         TEXT
)"""


def ensure_schema(store) -> None:
    """Side table owned by calendar.py (idempotent; see RELEASE-SYSTEM.md 'Side tables')."""
    store.conn.execute(_COVERAGE_DDL)


def apply_batch(store, batch: CalendarBatch, now: int, *, withdraw_future: bool = True) -> dict:
    """Write a batch: put_event every event (supersede on date/time change) and,
    for each key in the batch, withdraw FUTURE active events inside the batch's
    coverage window that the batch no longer lists (a cancelled/rescheduled
    release). Past events are never withdrawn."""
    ensure_schema(store)
    today = timeutil.et_date(now).isoformat()
    n_new = n_withdrawn = 0
    by_key: dict[str, set] = {}
    with store.tx():
        for e in batch.events:
            before = store.conn.execute(
                "SELECT event_id FROM calendar_event WHERE calendar_key=? AND period_label=? AND superseded_at IS NULL",
                (e.calendar_key, e.period_label)).fetchone()
            eid = store.put_event(e.calendar_key, e.period_label, e.sched_date, sched_time=e.sched_time, tz=e.tz,
                                  precision=e.precision, source=e.source, provenance=e.provenance, fetched_at=now)
            if before is None or before[0] != eid:
                n_new += 1
            by_key.setdefault(e.calendar_key, set()).add(e.period_label)
        if withdraw_future:
            for key, labels in by_key.items():
                if key not in batch.coverage:      # e.g. the rule batch's past-only fiscal:mts rows
                    continue
                start, end = batch.coverage[key]
                lo = max(today, start or today)
                for row in store.events(key, start=lo, end=end):
                    if row["period_label"] not in labels:
                        store.delete_event(row["event_id"], at=now)
                        n_withdrawn += 1
        src = {k: v[1].value for k, v in KNOWN_CALENDARS.items()}
        for key, (start, end) in batch.coverage.items():
            store.conn.execute(
                "INSERT INTO calendar_coverage(calendar_key, provider, source, coverage_start, coverage_end,"
                " refreshed_at, detail) VALUES (?,?,?,?,?,?,?) ON CONFLICT(calendar_key) DO UPDATE SET"
                " provider=excluded.provider, source=excluded.source, coverage_start=excluded.coverage_start,"
                " coverage_end=excluded.coverage_end, refreshed_at=excluded.refreshed_at, detail=excluded.detail",
                (key, batch.provider, src.get(key, "rule"), start, end, now, batch.detail[:500]))
    return {"events": len(batch.events), "changed": n_new, "withdrawn": n_withdrawn}


def coverage(store, calendar_key: str) -> Optional[dict]:
    ensure_schema(store)
    r = store._dicts("SELECT * FROM calendar_coverage WHERE calendar_key=?", (calendar_key,))
    return r[0] if r else None


def coverage_end(store, calendar_key: str) -> Optional[str]:
    c = coverage(store, calendar_key)
    return c["coverage_end"] if c else None


def load_events(store, calendar_key: str, now: Optional[int] = None, *, back_days: int = 400,
                fwd_days: int = 400) -> list[Event]:
    """Active events for a key around `now` (all when now is None), in schedule order."""
    if now is None:
        rows = store.events(calendar_key)
    else:
        d = timeutil.et_date(now)
        rows = store.events(calendar_key, start=(d - timedelta(days=back_days)).isoformat(),
                            end=(d + timedelta(days=fwd_days)).isoformat())
    evs = [Event.from_row(r) for r in rows]
    evs.sort(key=lambda e: (e.scheduled_at, e.period_label))
    return evs


def fetch_feed(http, url: str) -> bytes:
    """GET a keyless public calendar (no validators: a calendar is small and must re-parse)."""
    resp = http.get(url)
    resp.raise_for_status()
    if resp.not_modified or not resp.content:
        raise CalendarParseError(f"empty calendar response from {resp.url_redacted}")
    return resp.content


def refresh(store, now: int, *, http=None, feeds: bool = True, payloads: Optional[dict] = None) -> dict:
    """Refresh every calendar. Rules + configured files always; the three feeds
    (bea / census / fiscal) from `payloads[name]` (tests) or over `http` when
    given. A feed that fails keeps its previously stored events. Returns a
    per-provider summary {provider: {"ok": bool, ...}} (errors redacted)."""
    from . import secrets
    ensure_schema(store)
    summary: dict[str, Any] = {}
    payloads = dict(payloads or {})
    parsers = (("bea_feed", BEA_URL, bea_events), ("census_page", CENSUS_URL, census_events),
               ("fiscal_feed", FISCAL_URL, fiscal_events))
    if feeds:
        for name, url, parse in parsers:
            try:
                raw = payloads.get(name)
                if raw is None:
                    if http is None:
                        continue
                    raw = fetch_feed(http, url)
                summary[name] = {"ok": True, **apply_batch(store, parse(raw), now)}
            except Exception as e:  # noqa: BLE001 -- a bad feed never takes the refresh down
                summary[name] = {"ok": False, "error": secrets.safe_exc(e)}
    try:
        summary["configured"] = {"ok": True, **apply_batch(store, configured_events(), now)}
    except Exception as e:  # noqa: BLE001
        summary["configured"] = {"ok": False, "error": secrets.safe_exc(e)}
    held = {"fiscal:mts": {r["period_label"] for r in store.events("fiscal:mts")}}
    summary["rule"] = {"ok": True, **apply_batch(store, rule_events(timeutil.et_date(now), skip_labels=held), now)}
    return summary
