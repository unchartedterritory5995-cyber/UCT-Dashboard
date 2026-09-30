"""Build api/services/econ/calendars/release_history.json -- ACTUAL historical release
dates (evidence) used by backfill placement (`backfill_timing`).

    python tools/econ/build_release_history.py --sources C:\\w\\econ1-data\\sources\\release_history

LOCAL ONLY. Every source is a saved copy of an agency page (or its Wayback capture);
the output records each file's sha256 so the evidence is reproducible. Nothing here
talks to production. Sources (file names inside --sources):

  bls_histreleasedates.txt   `pdftotext -layout` of https://www.bls.gov/bls/histreleasedates.pdf
                             ("Historical release dates for selected BLS news releases, 2000 and
                             earlier"; Wayback 20251219185556). Dates only (no times).
  bls_archive_<rel>_{2016,2026}.html
                             BLS "Archived News Releases" lists (bls.gov/bls/news-release/<rel>.htm,
                             Wayback captures 2016-11..2017-01 and 2026-08..09). Each link is
                             archives/<rel>_MMDDYYYY.htm = the release date; its text names the
                             reference period. BLS embargo time 08:30 ET (JOLTS 10:00 ET) is
                             CONFIGURED practice -> precision time_configured.
  eia_wpsr_archive.html      https://www.eia.gov/petroleum/supply/weekly/archive/ (Release date /
                             Data ending, 2011-08 onward). Wednesday = 10:30 (EIA schedule
                             statement); any other weekday = date only.
  fed_g17_default.html       https://www.federalreserve.gov/releases/g17/default.htm (every
                             monthly release 1997-12 onward; 'For release at 9:15 a.m.').
  census/*.html              Wayback captures of the Census economic-indicator calendar list
                             view; only rows whose release date is ON/BEFORE the capture date
                             are kept (an observed release, not a stale schedule).
  bls_archive_{prod,ximpim}_2026.html
                             BLS archived news-release lists for Productivity and Costs
                             (bls.gov/bls/news-release/prod.htm, links prod2_MMDDYYYY) and Import/
                             Export Price Indexes (ximpim.htm), Wayback 2026 captures; the FIRST
                             ('Preliminary') release of a quarter / month; 08:30 time_configured.
  fed_<rel>_releaseDates.json
                             The Board's own release-date archives (the JSON behind
                             federalreserve.gov/releases/<rel>/default.htm "Release Dates"; every
                             release actually posted, 1996+): H.8 / H.4.1 / H.10 / G.19 / H.6.
                             DATE ONLY; the time comes from fed_statcalendar.json when that exact
                             date is listed there (exact), else the row is date-only (end of day).
                             Release -> period mapping (checked on archived releases, FED_MAPPING):
                             H.8 week = the latest Wednesday >= 8 days before the release; H.4.1 =
                             the latest Wednesday before it; H.10 = every business day of the week
                             before it; G.19 = the 2nd month before the release month; H.6 (monthly
                             era from 2021-02-23) = the previous month. A period is mapped to the
                             FIRST release that can carry it, and only inside a plausibility window
                             (an archive gap -- e.g. H.10 2007-2008 -- leaves periods unmapped
                             rather than mapped to a far later release).
  fed_statcalendar.json      https://www.federalreserve.gov/data/statcalendar.json (the Board's
                             statistical release calendar: title, month, days, time). Times only.

Rows: {calendar_key: {period_label: [release_date_ET, time_ET|null, precision, source_id]}}.
A null time means DATE ONLY: backfill places such a row at the END of that ET day
(never earlier than the release, never an invented time).
"""
from __future__ import annotations

import argparse
import datetime as dt
import gzip
import hashlib
import html as _html
import json
import re
import sys
from pathlib import Path
from typing import Optional

ROOT =Path(__file__).resolve().parents[2]
OUT = ROOT / "api" / "services" / "econ" / "calendars" / "release_history.json"
MONS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October",
        "November", "December"]
MON = {m: i for i, m in enumerate(MONS, 1)}
MRE = "|".join(MONS)


def _read(p: Path) -> str:
    b = p.read_bytes()
    try:
        b = gzip.decompress(b)
    except OSError:
        pass
    return b.decode("utf-8", "replace").replace("&nbsp;", " ")


def _sha(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def _month_end(y: int, m: int) -> dt.date:
    return dt.date(y + (m == 12), m % 12 + 1, 1) - dt.timedelta(days=1)


# ─────────────────────────────── BLS 1953-2000 (PDF text) ─────────────────────

_TOK = re.compile(r"--|(" + MRE + r") (\d{1,2})(?:, (\d{4}))?")


def _tokens(s: str):
    """'--' | (month, day, year|None). Footnote digits glued to a day/year are dropped
    ('November 52' = Nov 5 + note 2; '19961' = 1996 + note 1)."""
    out = []
    for m in re.finditer(r"--|(" + MRE + r") (\d{1,3})(?:, (\d{4})\d?)?", s):
        if m.group(0) == "--":
            out.append(None)
            continue
        day = int(m.group(2))
        if day > 31:
            day = int(str(day)[0])
        out.append((MON[m.group(1)], day, int(m.group(3)) if m.group(3) else None))
    return out


def _section(text: str, start: str, end: str) -> list[str]:
    a = text.index(start)
    b = text.index(end, a)
    return text[a:b].splitlines()


def bls_pdf_empsit(text: str) -> dict:
    out = {}
    for line in _section(text, "Release dates for national employment", "SOURCE:"):
        m = re.match(r"^(\d{4})\s+(.*)$", line)
        if not m:
            continue
        y = int(m.group(1))
        toks = _tokens(m.group(2))
        for i, t in enumerate(toks[:12]):
            if t is None:
                continue
            mon, day, yr = t
            ref_m = i + 1
            ry = yr or y
            out[f"{y}-{ref_m:02d}"] = dt.date(ry, mon, day).isoformat()
    return out


def bls_pdf_cpi(text: str) -> dict:
    lines = _section(text, "Release dates for the Consumer Price Index", "SOURCE:")
    body = "\n".join(lines)
    out = {}
    # December reference months: the right-margin column, in order, Dec 1953 .. Dec 2000
    decs = [(int(m.group(3)) if len(m.group(3)) == 4 else int(m.group(3)[:4]), MON[m.group(1)], int(m.group(2)))
            for m in re.finditer(r"(January|February) (\d{1,2}), (\d{4,5})", body)]
    for i, (yy, mon, day) in enumerate(decs):
        out[f"{1953 + i}-12"] = dt.date(yy, mon, day).isoformat()
    for line in lines:
        m = re.match(r"^(\d{4})\s+(.*)$", line)
        if not m:
            continue
        y = int(m.group(1))
        if y in (1995, 1996):
            continue                                   # layout-shifted rows: transcribed below
        toks = [t for t in _tokens(m.group(2)) if t is not None and t[2] is None]   # drop margin (Dec) dates
        for i, (mon, day, _) in enumerate(toks[:11]):
            out[f"{y}-{i + 1:02d}"] = dt.date(y, mon, day).isoformat()
    # 1995/1996 (PDF text layer shifts the January cells; footnotes 1 and 2 of the table):
    fix = {"1995-01": "1995-02-15", "1995-02": "1995-03-16", "1995-03": "1995-04-12", "1995-04": "1995-05-12",
           "1995-05": "1995-06-13", "1995-06": "1995-07-14", "1995-07": "1995-08-11", "1995-08": "1995-09-13",
           "1995-09": "1995-10-13", "1995-10": "1995-11-15", "1995-11": "1995-12-14",
           "1996-01": "1996-02-28", "1996-02": "1996-03-15", "1996-03": "1996-04-12", "1996-04": "1996-05-14",
           "1996-05": "1996-06-12", "1996-06": "1996-07-16", "1996-07": "1996-08-13", "1996-08": "1996-09-13",
           "1996-09": "1996-10-16", "1996-10": "1996-11-14", "1996-11": "1996-12-12"}
    out.update(fix)
    return out


# ─────────────────────────────── BLS 2002+ (archive lists) ───────────────────

def bls_archive(texts: list[tuple[str, dt.date]], rel: str) -> dict:
    rows: dict[str, set] = {}
    for s, snap in texts:
        for li in re.findall(r"<li>(.*?)</li>", s, re.S):
            m = re.search(r"archives/" + rel + r"_(\d{8})\.(?:htm|pdf)", li)
            if not m:
                continue
            d = m.group(1)
            day = dt.date(int(d[4:]), int(d[:2]), int(d[2:4]))
            if day > snap:
                continue                               # a link to a not-yet-published release
            txt = " ".join(re.sub(r"<[^>]+>", " ", li).split())
            if rel == "eci":
                q = re.search(r"(March|June|September|December)\s+(\d{4})", txt)
                if not q:
                    continue
                label = f"{q.group(2)}Q{ {'March': 1, 'June': 2, 'September': 3, 'December': 4}[q.group(1)] }"
            else:
                mm = re.search(r"(" + MRE + r")\s+(\d{4})", txt)
                if not mm:
                    continue
                label = f"{mm.group(2)}-{MON[mm.group(1)]:02d}"
            rows.setdefault(label, set()).add(day)
    out = {}
    for label, days in rows.items():
        if "Q" in label:
            y, q = int(label[:4]), int(label[-1])
            pe = _month_end(y, q * 3)
        else:
            pe = _month_end(int(label[:4]), int(label[5:7]))
        after = sorted(d for d in days if d > pe)
        if after:
            out[label] = after[0].isoformat()          # the FIRST release of the period
    return out


# ─────────────────────────────── EIA WPSR ────────────────────────────────────

def eia_wpsr(s: str) -> dict:
    pairs = []
    for m in re.finditer(r'href="[^"]*archive/(\d{4})/(\d{4})_(\d{2})_(\d{2})/[^"]*"[^>]*>\s*\d+\s*</a>\s*</td>\s*'
                         r'<td>\s*(?:\d+/)?(\d+)\s*</td>', s):
        rel = dt.date(int(m.group(2)), int(m.group(3)), int(m.group(4)))
        day = int(m.group(5))
        de = next((rel - dt.timedelta(days=k) for k in range(1, 16)
                   if (rel - dt.timedelta(days=k)).day == day and (rel - dt.timedelta(days=k)).weekday() == 4), None)
        if de:
            pairs.append((de, rel))
    by = {de: rel for de, rel in pairs}
    out = {}
    lo, hi = min(by), max(by)
    d = lo
    while d <= hi:
        if d in by:
            rel = by[d]
            out[d.isoformat()] = (rel.isoformat(), "10:30" if rel.weekday() == 2 else None, "listed")
        else:
            nxt = min(k for k in by if k > d)           # a week with no own release: published with/after the next
            out[d.isoformat()] = (by[nxt].isoformat(), None, "not listed; bounded by the next listed release")
        d += dt.timedelta(days=7)
    return out


# ─────────────────────────────── Fed G.17 ────────────────────────────────────

G17_OVERRIDES = {   # release date -> reference months (read from each release's g17.txt header)
    "2013-10-28": ["2013-09"],                         # 2013 lapse: 'total industrial production in September'
    "2025-12-03": ["2025-09"],                         # 2025 lapse: '... total IP in September ...'
    "2025-12-23": ["2025-10", "2025-11"],              # 'preliminary estimates ... October ... November'
}


def fed_g17(s: str) -> dict:
    out = {}
    for _, cell in re.findall(r'<tr>\s*<td>([A-Za-z]+ \d+)</td>\s*<td class="table__center">(.*?)</td>', s, re.S):
        for d in re.findall(r'href="(\d{8})', cell):
            day = dt.date(int(d[:4]), int(d[4:6]), int(d[6:8]))
            labels = G17_OVERRIDES.get(day.isoformat())
            if labels is None:
                pm = (day.replace(day=1) - dt.timedelta(days=1))
                labels = [f"{pm.year}-{pm.month:02d}"]
            for lab in labels:
                if lab not in out or day.isoformat() < out[lab]:
                    out[lab] = day.isoformat()
    return out


# ─────────────────────────────── Census ──────────────────────────────────────

CENSUS_KEYS = (("advance report on durable goods", "census:m3adv"), ("new residential construction", "census:resconst"),
               ("u.s. international trade in goods and services", "census:ft900"))


def census_pages(files: list[tuple[str, dt.date]]) -> dict:
    best: dict = {}
    for t, snap in files:
        for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", t, re.S | re.I):
            tds = re.findall(r"<td[^>]*>(.*?)</td>", tr, re.S | re.I)
            if len(tds) < 3:
                continue
            txt = [" ".join(_html.unescape(re.sub(r"<[^>]+>", " ", x)).split()) for x in tds]
            key = next((k for p, k in CENSUS_KEYS if txt[0].lower().startswith(p)), None)
            if not key:
                continue
            keys = [re.sub(r"\s+", "", x) for x in txt]
            inst = next((k for k in keys if re.fullmatch(r"A\d{12}", k)), None)
            per = next((k for k in keys if re.fullmatch(r"A\d{6}", k)), None)
            if inst and per:
                d = dt.date(int(inst[1:5]), int(inst[5:7]), int(inst[7:9]))
                tm, label = f"{inst[9:11]}:{inst[11:13]}", f"{per[1:5]}-{per[5:7]}"
            else:
                a = next((m for m in (re.fullmatch(r"(" + MRE + r") (\d{1,2}), (\d{4})", x) for x in txt) if m), None)
                b = next((m for m in (re.fullmatch(r"(" + MRE + r") (\d{4})", x) for x in txt) if m), None)
                c = next((m for m in (re.fullmatch(r"(\d{1,2}):(\d{2}) ?([AP])\.?M\.?", x, re.I) for x in txt) if m), None)
                if not (a and b and c):
                    continue
                d = dt.date(int(a.group(3)), MON[a.group(1)], int(a.group(2)))
                label = f"{b.group(2)}-{MON[b.group(1)]:02d}"
                tm = f"{int(c.group(1)) % 12 + (12 if c.group(3).upper() == 'P' else 0):02d}:{c.group(2)}"
            if d > snap:
                continue                                  # a SCHEDULE seen before the release: not evidence
            k = (key, label)
            if k not in best or snap > best[k][2]:
                best[k] = (d.isoformat(), tm, snap)
    out: dict = {}
    for (key, label), (d, tm, snap) in best.items():
        out.setdefault(key, {})[label] = (d, tm)
    return out


# ─────────────────────────────── BLS quarterly P&C ───────────────────────────

_QNAME = {"First": 1, "Second": 2, "Third": 3, "Fourth": 4}


def bls_prod(texts: list[tuple[str, dt.date]]) -> dict:
    """Productivity and Costs archive: '<YYYY> <Nth> Quarter (Preliminary|Revised)' ->
    the FIRST (preliminary) release date of each quarter."""
    rows: dict[str, set] = {}
    for s, snap in texts:
        for li in re.findall(r"<li>(.*?)</li>", s, re.S):
            m = re.search(r"archives/prod2_(\d{8})\.(?:htm|pdf)", li)
            if not m:
                continue
            d = m.group(1)
            day = dt.date(int(d[4:]), int(d[:2]), int(d[2:4]))
            if day > snap:
                continue
            txt = " ".join(re.sub(r"<[^>]+>", " ", li).split())
            q = re.search(r"(\d{4})\s+(First|Second|Third|Fourth)\s+Quarter", txt)
            if not q:
                continue
            rows.setdefault(f"{q.group(1)}Q{_QNAME[q.group(2)]}", set()).add(day)
    out = {}
    for label, days in rows.items():
        pe = _month_end(int(label[:4]), int(label[-1]) * 3)
        after = sorted(d for d in days if d > pe)
        if after:
            out[label] = after[0].isoformat()
    return out


# ─────────────────────────────── Fed release-date archives ────────────────────

FED_STATCAL_TITLE = {"h8": "H.8", "h41": "H.4.1", "h10": "H.10", "g19": "G.19", "h6": "H.6"}
FED_MAPPING = {   # evidence for each release -> period rule (archived releases read 2026-09-30)
    "h8": "archived releases 1996-06-14, 2001-01-05, 2008-01-04, 2015-01-02, 2026-09-25 each carry the Wednesday "
          "9 days earlier as their latest week (H.8 page: released Friday, Thursday when Friday is a holiday)",
    "h41": "H.4.1 page: 'released each Thursday' for the week ended Wednesday (the Wednesday level)",
    "h10": "H.10 page: 'On Mondays ... releases daily ... for the previous business week'; the following "
           "business day when Monday is a holiday",
    "g19": "archived releases 1996-12-06 (Oct 1996), 2000-06-07 (Apr), 2008-10-07 (Aug), 2013-10-07 (Aug), "
           "2025-10-07 (Aug), 2025-11-07 (Sep), 2026-09-08 (Jul): the second month before the release month",
    "h6": "monthly release since 2021-02-23 (4th Tuesday) carries the previous month; the weekly era is NOT "
          "mapped (the archive does not say which weekly release first carried a month)",
}


def _fed_dates(doc) -> list[dt.date]:
    out = set()
    for y in doc:
        for m in y.get("Months") or ():
            for x in m.get("Dates") or ():
                x = re.sub(r"\*+$", "", str(x))            # '20210223***' = a footnoted release (still a release)
                if re.fullmatch(r"\d{8}", x):
                    try:
                        out.add(dt.date(int(x[:4]), int(x[4:6]), int(x[6:])))
                    except ValueError:
                        pass
    return sorted(out)


def _statcal_times(doc: dict, title: str) -> dict:
    """{date: 'HH:MM'} for one release family from statcalendar.json."""
    out = {}
    for e in doc.get("events") or ():
        t = str(e.get("title") or "").strip()
        if not (t.startswith(title + " ") or t.startswith(title + "-")):
            continue
        if not re.fullmatch(r"\d{4}-\d{2}", str(e.get("month") or "")):
            continue
        m = re.fullmatch(r"(\d{1,2}):(\d{2}) ([ap])\.m\.", str(e.get("time") or "").strip())
        if not m:
            continue
        hh = int(m.group(1)) % 12 + (12 if m.group(3) == "p" else 0)
        y, mo = int(e["month"][:4]), int(e["month"][5:])
        for d in str(e.get("days") or "").split(","):
            if d.strip().isdigit():
                out[dt.date(y, mo, int(d))] = f"{hh:02d}:{m.group(2)}"
    return out


def _first_on_or_after(dates: list[dt.date], d: dt.date) -> Optional[dt.date]:
    import bisect
    i = bisect.bisect_left(dates, d)
    return dates[i] if i < len(dates) else None


def fed_archive(rel: str, dates: list[dt.date]) -> dict:
    """period label -> first release date that carries it (see FED_MAPPING)."""
    out: dict[str, dt.date] = {}
    if not dates:
        return out
    lo, hi = dates[0], dates[-1]
    if rel in ("h8", "h41"):
        lag, window = (8, 16) if rel == "h8" else (1, 8)
        w = lo - dt.timedelta(days=30)
        w += dt.timedelta(days=(2 - w.weekday()) % 7)                  # first Wednesday
        while w <= hi:
            r = _first_on_or_after(dates, w + dt.timedelta(days=lag))
            if r is not None and (r - w).days <= window:
                out[w.isoformat()] = r
            w += dt.timedelta(days=7)
    elif rel == "h10":
        d = lo - dt.timedelta(days=14)
        while d <= hi:
            if d.weekday() < 5:
                fri = d + dt.timedelta(days=4 - d.weekday())
                r = _first_on_or_after(dates, fri + dt.timedelta(days=1))
                if r is not None and (r - d).days <= 14:
                    out[d.isoformat()] = r
            d += dt.timedelta(days=1)
    elif rel in ("g19", "h6"):
        back = 2 if rel == "g19" else 1
        for r in dates:
            if rel == "h6" and r < dt.date(2021, 2, 23):
                continue
            pm = r.replace(day=1)
            for _ in range(back):
                pm = (pm - dt.timedelta(days=1)).replace(day=1)
            lab = f"{pm.year}-{pm.month:02d}"
            if lab not in out or r < out[lab]:
                out[lab] = r
    return out


# ─────────────────────────────── main ────────────────────────────────────────

MANUAL = {   # official BLS lapse notices (https://www.bls.gov/bls/2025-lapse-revised-release-dates.htm)
    "bls:empsit": {"2025-10": ("2025-12-16", "08:30", "Oct 2025 establishment data published with Nov 2025")},
    "bls:jolts": {"2025-09": ("2025-12-09", "10:00", "Sep 2025 JOLTS cancelled, published with Oct 2025")},
    "bls:ppi": {"2025-10": ("2026-01-14", "08:30", "Oct 2025 PPI published with Nov 2025")},
}


def build(src: Path) -> dict:
    sources, fam = {}, {}

    def reg(sid, path, url, note=""):
        sources[sid] = {"file": path.name, "sha256": _sha(path), "url": url, **({"note": note} if note else {})}

    pdf_txt = src / "bls_histreleasedates.txt"
    text = pdf_txt.read_text(encoding="utf-8", errors="replace")
    reg("bls_hist_pdf", pdf_txt, "https://www.bls.gov/bls/histreleasedates.pdf (Wayback 20251219185556)",
        "pdftotext -layout of the PDF; PDF sha256 in bls_histreleasedates.pdf")
    for key, rows in (("bls:cpi", bls_pdf_cpi(text)), ("bls:empsit", bls_pdf_empsit(text))):
        for lab, d in rows.items():
            fam.setdefault(key, {})[lab] = [d, None, "date_only", "bls_hist_pdf"]
    rel_key = {"cpi": ("bls:cpi", "08:30"), "empsit": ("bls:empsit", "08:30"), "ppi": ("bls:ppi", "08:30"),
               "eci": ("bls:eci", "08:30"), "jolts": ("bls:jolts", "10:00")}
    for rel, (key, tm) in rel_key.items():
        texts = []
        for yr, snap in (("2016", dt.date(2017, 1, 7)), ("2026", dt.date(2026, 9, 15))):
            p = src / f"bls_archive_{rel}_{yr}.html"
            texts.append((_read(p), snap))
            reg(f"bls_archive_{rel}_{yr}", p, f"https://www.bls.gov/bls/news-release/{rel}.htm (Wayback {yr})")
        for lab, d in bls_archive(texts, rel).items():
            fam.setdefault(key, {})[lab] = [d, tm, "time_configured", f"bls_archive_{rel}"]
    for key, rows in MANUAL.items():
        for lab, (d, tm, note) in rows.items():
            fam.setdefault(key, {})[lab] = [d, tm, "time_configured", "bls_lapse_notice"]
    sources["bls_lapse_notice"] = {"url": "https://www.bls.gov/bls/2025-lapse-revised-release-dates.htm",
                                   "note": "; ".join(f"{k} {lab}: {v[2]}" for k, r in MANUAL.items()
                                                     for lab, v in r.items())}
    p = src / "eia_wpsr_archive.html"
    reg("eia_wpsr_archive", p, "https://www.eia.gov/petroleum/supply/weekly/archive/ (fetched 2026-09-29)")
    for lab, (d, tm, how) in eia_wpsr(_read(p)).items():
        fam.setdefault("eia:wpsr", {})[lab] = [d, tm, "exact" if tm else "date_only", "eia_wpsr_archive"]
    p = src / "fed_g17_default.html"
    reg("fed_g17", p, "https://www.federalreserve.gov/releases/g17/default.htm (fetched 2026-09-29); "
                      "every release states 'For release at 9:15 a.m.'")
    for lab, d in fed_g17(_read(p)).items():
        fam.setdefault("fed:g17", {})[lab] = [d, "09:15", "exact", "fed_g17"]
    files = []
    for p in sorted((src / "census").glob("*.html")):
        m = re.search(r"(\d{14})", p.name)
        if not m:
            continue
        ts = m.group(1)
        files.append((_read(p), dt.date(int(ts[:4]), int(ts[4:6]), int(ts[6:8]))))
    sources["census_listview"] = {"url": "https://www.census.gov/economic-indicators/calendar-listview.html "
                                         "(Wayback captures 2014-2026; rows kept only when released on/before "
                                         "the capture)", "files": len(files),
                                  "sha256_of_files": hashlib.sha256(b"".join(
                                      _sha(p).encode() for p in sorted((src / "census").glob("s*.html")))).hexdigest()}
    for key, rows in census_pages(files).items():
        for lab, (d, tm) in rows.items():
            fam.setdefault(key, {})[lab] = [d, tm, "exact", "census_listview"]
    # BLS Productivity and Costs + Import/Export Price Indexes (archive lists, 2002+)
    p = src / "bls_archive_prod_2026.html"
    reg("bls_archive_prod_2026", p, "https://www.bls.gov/bls/news-release/prod.htm (Wayback 20260819060112)")
    for lab, d in bls_prod([(_read(p), dt.date(2026, 8, 19))]).items():
        fam.setdefault("bls:prod", {})[lab] = [d, "08:30", "time_configured", "bls_archive_prod"]
    p = src / "bls_archive_ximpim_2026.html"
    reg("bls_archive_ximpim_2026", p, "https://www.bls.gov/bls/news-release/ximpim.htm (Wayback 20260927134815)")
    for lab, d in bls_archive([(_read(p), dt.date(2026, 9, 27))], "ximpim").items():
        fam.setdefault("bls:mxp", {})[lab] = [d, "08:30", "time_configured", "bls_archive_ximpim"]
    # Fed release-date archives (+ statcalendar times)
    p = src / "fed_statcalendar.json"
    reg("fed_statcalendar", p, "https://www.federalreserve.gov/data/statcalendar.json (fetched 2026-09-30)",
        "times only: a row is 'exact' when statcalendar lists that same date for the release")
    statcal = json.loads(p.read_text(encoding="utf-8-sig"))
    for rel, key in (("h8", "fed:h8"), ("h41", "fed:h41"), ("h10", "fed:h10"), ("g19", "fed:g19"),
                     ("h6", "fed:h6")):
        p = src / f"fed_{rel}_releaseDates.json"
        reg(f"fed_{rel}_archive", p, f"https://www.federalreserve.gov/releases/{rel}/releaseDates.json "
                                     f"(fetched 2026-09-30)", "mapping: " + FED_MAPPING[rel])
        times = _statcal_times(statcal, FED_STATCAL_TITLE[rel])
        for lab, d in fed_archive(rel, _fed_dates(json.loads(p.read_text(encoding="utf-8-sig")))).items():
            tm = times.get(d)
            fam.setdefault(key, {})[lab] = [d.isoformat(), tm, "exact" if tm else "date_only",
                                            f"fed_{rel}_archive"]
    return {
        "_doc": ("ACTUAL historical release dates (evidence) for backfill placement. Built by "
                 "tools/econ/build_release_history.py from saved agency pages (sources below, sha256). "
                 "Row = [release_date_ET, time_ET|null, precision, source]. null time = date only -> "
                 "placed at the end of that ET day. See docs/economic-data/BACKFILL-TIMING.md."),
        "id": "release_history",
        "built_at": dt.date.today().isoformat(),
        "sources": sources,
        "families": {k: dict(sorted(v.items())) for k, v in sorted(fam.items())},
    }


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--sources", required=True)
    ap.add_argument("--out", default=str(OUT))
    a = ap.parse_args(argv)
    doc = build(Path(a.sources))
    Path(a.out).write_text(json.dumps(doc, indent=1, sort_keys=False) + "\n", encoding="utf-8")
    for k, v in doc["families"].items():
        labs = sorted(v)
        print(f"{k:18s} {len(labs):5d} {labs[0]} .. {labs[-1]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
