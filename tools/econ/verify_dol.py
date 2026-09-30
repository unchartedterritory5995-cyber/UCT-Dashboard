"""Live verification of the DOL claims adapter (keyless, oui.doleta.gov only).

History mode: the r539cy national XML 1967..now (one POST) + the CURRENT
weekly news-release PDF (weeklyRedirect.php -> press/<YYYY>/<MMDDYY>.pdf).
Prints both results, the PDF cross-checks, and compares with Phase 0.

    python -m tools.econ.verify_dol
"""
from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timezone

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from api.services.econ import timeutil  # noqa: E402
from api.services.econ.adapters import dol  # noqa: E402
from api.services.econ.adapters.base import as_specs  # noqa: E402
from api.services.econ.http import HttpClient  # noqa: E402
from api.services.econ.model import EconError  # noqa: E402

COHORT = ["USICSA"]
# Phase 0: XML wk 08/29 SA 207,000; PDF (092426) advance wk 09/19 SA 197,000, prior wk 09/12 revised 198,000
PHASE0 = {"2026-08-29": (207000.0, ""), "2026-09-19": (197000.0, "a"), "2026-09-12": (198000.0, "")}


def _fmt_ts(ts):
    if not ts:
        return "None"
    return (f"{ts} = {datetime.fromtimestamp(ts, timezone.utc):%Y-%m-%dT%H:%M:%SZ} = "
            f"{timeutil.utc_to_et(ts):%a %Y-%m-%d %H:%M} ET")


def main() -> int:
    with open(os.path.join(ROOT, "api", "services", "econ", "registry", "series.json"), encoding="utf-8") as f:
        e = {x["symbol"]: x for x in json.load(f)}
    [spec] = as_specs([e[s] for s in COHORT])
    http = HttpClient()
    print(f"# DOL claims live verification  {datetime.now(timezone.utc):%Y-%m-%dT%H:%MZ}  (keyless)")
    rc = 0
    try:
        results = dol.DolAdapter().fetch([spec], mode="history", start=None, end=None, http=http)
    except EconError as ex:
        print(f"USICSA: FAILED {type(ex).__name__}: {ex}")
        return 1
    merged = {}
    for res in results:
        obs = res.observations
        print(f"\n{spec.symbol}  request_key={res.request_key}")
        if obs:
            new = obs[-1]
            print(f"  count={len(obs)}  NA={sum(1 for o in obs if o.value is None)}  "
                  f"oldest={obs[0].period_start}..{obs[0].period_end}  newest={new.period_start}..{new.period_end}  "
                  f"newest_value={new.value!r} flag={new.flag!r}  units={spec.units.get('raw')!r}  "
                  f"bytes={res.payload_bytes}")
        else:
            print("  count=0")
        print(f"  source_published_at={_fmt_ts(res.source_published_at)}  warnings={res.warnings}")
        for o in obs[-4:]:
            print(f"    wk {o.period_end}  {o.value:,.0f}  flag={o.flag!r}  row_published={_fmt_ts(o.source_published_at)}")
        for o in obs:
            merged[o.period_end] = (o.value, o.flag)
    for wk, exp in PHASE0.items():
        got = merged.get(wk)
        ok = got == exp
        print(f"  Phase0 wk {wk} = {exp}  adapter = {got}  -> {'MATCH' if ok else 'MISMATCH'}")
        rc |= 0 if ok else 1

    # Cross-check detail for the current release (re-parses the same PDF bytes' text).
    try:
        url = dol.discover_press_url(http)
        r = http.get(url)
        pr = dol.parse_press_text(dol.pdf_text(r.content))
        weeks = dol.parse_xml(http.post_form(dol.XML_URL, [
            ("level", "us"), ("final_yr", str(datetime.now(timezone.utc).year + 1)),
            ("strtdate", str(pr.weeks[-1].year)), ("enddate", str(pr.weeks[0].year)),
            ("filetype", "xml")]).content)
        print(f"\ncurrent release: {url}  Last-Modified={r.headers.get('last-modified')}  "
              f"embargo={_fmt_ts(pr.embargo_ts)}")
        print(f"  prose: advance SA {pr.prose_sa:,.0f}; prior revised {pr.prose_prev_sa}; advance NSA {pr.prose_nsa}")
        for w in pr.weeks:
            sf = weeks.get(w, {}).get("initial", {}).get("SF")
            implied = pr.nsa[w] / (sf / 100.0) if sf else None
            dev = abs(implied - pr.sa[w]) / pr.sa[w] * 100 if implied else None
            print(f"  wk {w}: table SA {pr.sa[w]:,.0f}  NSA {pr.nsa[w]:,.0f}  XML SF {sf}  "
                  f"NSA/SF {implied:,.0f}  |dev| {dev:.3f}%")
    except EconError as ex:
        print(f"cross-check detail FAILED {type(ex).__name__}: {ex}")
        rc = 1
    print(f"\nhttp stats: {http.stats()}")
    return rc


if __name__ == "__main__":
    raise SystemExit(main())
