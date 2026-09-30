"""Launch-catalog readiness census (Gates 3 + 4) over a LOCAL econ.db.

    python tools/econ/readiness_census.py --db C:\\w\\econready-data\\econ.db \\
        [--out-dir docs/economic-data/readiness]

Reads the registry, docs/economic-data/expansion_151.csv (the 110 LAUNCH rows) and
the 41-series cohort (= the 151 launch candidates), and the local DB (read-only).
Writes CATALOG.csv + CATALOG.md with, per candidate: identity, units, frequency,
release + observation semantics, PIT class distribution, history range, latest
value, currentness expectation + state, validation state, placement accuracy
(exact / reconstructed / conservative / unknown), chart presentation, entitlement,
and status + reason. Exits non-zero when any enabled series fails a gate (a
validation rejection, a leak, a derived-audit reason, a placement that does not
re-derive, or a row placed before the agency's archived release).

Placement classes (backfill rows of NON-derived series; derived rows inherit):
  exact          snapped to an agency-stated release DATE AND TIME (release_history
                 row or calendar event with precision exact)
  reconstructed  agency-stated date with a configured time (time_configured) or date
                 only (end of that ET day), or an agency-published cadence rule
                 (a RULE-class calendar: H.15/H.4.1/H.6/H.8/H.10, NY Fed, DTS/DTP,
                 EIA, DOL) outside any era margin
  conservative   late-side estimate: registry lag rule, era margin, or funding-lapse floor
  unknown        the stored placement does not re-derive from backfill_timing.place
LOCAL ONLY; never writes the DB.
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import sqlite3
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from api.services.econ import backfill_timing as bt, calendar as cal, derive, registry, timeutil  # noqa: E402
from api.services.econ import store as S  # noqa: E402
from api.services.econ.calendar import Event  # noqa: E402
from api.services.econ.model import ScheduleSource  # noqa: E402

EXPANSION = ROOT / "docs" / "economic-data" / "expansion_151.csv"
RULE_KEYS = {k for k, (_p, src) in cal.KNOWN_CALENDARS.items() if src == ScheduleSource.RULE}

# Why a candidate is NOT enabled (Gate 3, 2026-09-30). Evidence: readiness/verify_*.txt.
REASONS = {
    "USRETAIL": "FAIL CLOSED (owner ruling 2026-09-29): econ_export/MRTS history vs advance-release table differ "
                "~4.8% every month; basis unresolved",
    "USRETAILXA": "retail basis conflict inherited from USRETAIL (owner decision required); data itself validates",
    "USRETAILCTRL": "retail basis conflict + inputs USRETAILMV (unverified) / USRETAILGAS, USRETAILBM, USRETAILFS "
                    "(disabled, outside the 151)",
    "USRETAILMOM": "input USRETAIL failed closed",
    "USRETCTRLMOM": "input USRETAILCTRL not enabled",
    "USCURACCT": "NEW ADAPTER CODE: BEA ITA dataset is API-only (key) -- bea.py implements NIPA only; no keyless "
                 "ITA path; calendar bea:ita not built",
    "USGOODSBAL": "SOURCE: Census econ_export FTD BOPG/BAL returns NA for every 2026 month (live 2026-09-30); no "
                  "keyless goods-only BOP balance series found",
    "USCCSA": "CURRENTNESS: continued claims come only from the r539cy XML history, which lags the Thursday release "
              "by ~4 weeks (newest w/e 2026-08-29 on 2026-09-30); the press-PDF path is initial-claims only, so "
              "dol:claims (the initial-claims week) would read DELAYED every week. Data validates (3,113 weeks)",
    "USDEPOSITS": "RELEASE SEMANTICS: monthly-average deposits (B1058NCBAM); which weekly H.8 release first carries "
                  "a month is not evidenced and the pe+5 lag is earlier than the H.8 Friday/+9 practice; fed:h8 "
                  "events are weekly labels (no monthly expectation). Data validates (644 months, units corrected)",
    "USNATGASSTOR": "SOURCE (keyless): EIA dnav LeafHandler 404s for NG and the static NG history page is stale "
                    "(Release Date 10/30/2025); needs EIA_API_KEY (v2) -- verify keyed in production. Calendar "
                    "eia:ngs is built and tested",
    "USNATGASCHG": "input USNATGASSTOR not enabled",
    "USSCEINF1Y": "NEW ADAPTER CODE: regional_fed_file (NY Fed SCE chart-data xlsx) not implemented; no nyfed:sce "
                  "calendar",
    "USTIC": "NEW ADAPTER CODE: treasury_tic (mfh.txt) not implemented; no treasury:tic calendar",
    "USIORB": "NEW ADAPTER CODE: fed_policy (IORB has no DDP mnemonic) not implemented; event-driven fed:policy "
              "calendar not built",
    "USMTSINT": "NEW ADAPTER CODE: MTS table 5 rows are not month-named, so the fiscaldata adapter takes the DAILY "
                "path and emits no monthly observation (live 2026-09-30: 0 rows)",
}


def candidates() -> list[str]:
    with open(EXPANSION, encoding="utf-8") as f:
        launch = [r["symbol"] for r in csv.DictReader(f)]
    cohort = [e["symbol"] for e in registry.cohort() if e["symbol"] not in set(launch)]
    return cohort + launch


def obs_semantics(e: dict) -> str:
    f = e["frequency"]
    if f == "W":
        return f"week ending {e['week_anchor']} (period = 7 days, label = end date)"
    return {"D": "business day (period = the day)", "M": "calendar month", "Q": "calendar quarter",
            "A": "calendar year"}.get(f, f)


def classify(spec, row, events, periods, history) -> tuple[str, str]:
    """(class, detail) for one backfill row; re-derives the placement."""
    ps, pe = row["period_start"], row["period_end"]
    p = bt.place(spec, ps, pe, now=row["ingested_at"], events=events, periods=periods)
    if p is None or p.available_at != row["available_at"]:
        return "unknown", "placement does not re-derive"
    key = spec["release"]["calendar_key"]
    if p.method.endswith(":history"):
        f = spec["frequency"]
        lab = pe if f in ("W", "D") else bt.label_for(spec, timeutil.as_date(ps))
        h = history.get(key, {}).get(lab)
        return ("exact" if h and h[2] == "exact" else "reconstructed"), "history"
    if p.method.endswith(":calendar"):
        return ("exact" if "(authoritative" in p.basis and "/exact)" in p.basis
                else "exact" if "/exact)" in p.basis else "reconstructed"), "calendar"
    if p.lapse or "era:" in p.basis:
        return "conservative", "lapse" if p.lapse else "era"
    if key in RULE_KEYS:
        return "reconstructed", "cadence rule"
    return "conservative", "registry lag"


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", required=True)
    ap.add_argument("--out-dir", default=str(ROOT / "docs" / "economic-data" / "readiness"))
    ap.add_argument("--bls-note", default="local backfill 1997-2026 (keyless v1, 6 queries); FULL history needs the "
                                          "keyed production backfill")
    a = ap.parse_args(argv)
    st = S.connect(a.db, readonly=True)
    conn = st.conn
    conn.row_factory = sqlite3.Row
    history = bt.history()
    events_by_key = defaultdict(list)
    for r in conn.execute("SELECT * FROM calendar_event WHERE superseded_at IS NULL"):
        events_by_key[r["calendar_key"]].append(Event.from_row(dict(r)))
    cands = candidates()
    rows_out, fails = [], []
    totals = Counter()
    per_provider = Counter()
    for sym in cands:
        e = registry.get(sym)
        src = e["source"]
        key = e["release"]["calendar_key"]
        known = cal.KNOWN_CALENDARS.get(key)
        rec = {
            "canonical_id": f"ECON:{sym}", "symbol": sym, "display_name": e["name"], "category": e["category"],
            "provider": src["agency"], "adapter": src["adapter"],
            "provider_id": src.get("provider_series_id") or (json.dumps(e["derivation"]) if e["derivation"] else ""),
            "units": f"{e['units']['raw']} (fmt {e['units']['fmt']}, scale {e['units']['scale']})",
            "frequency": e["frequency"] + (f"/{e['week_anchor']}" if e["week_anchor"] else ""),
            "seasonal_adjustment": e["seasonal_adjustment"],
            "release_semantics": f"{key}; {e['release'].get('cadence') or ''}; lag {json.dumps({k: v for k, v in (e['release'].get('lag_rule') or {}).items() if k != 'basis'})}",
            "observation_semantics": obs_semantics(e),
            "currentness_expectation": f"{key} ({known[0]}/{known[1].value})" if known else f"{key} (UNKNOWN calendar)",
            "presentation": f"{e['presentation']['style']}; max_age_days {registry.max_age_days(e)}",
            "entitlement": "paid (require_bars_access -> meets_plan_gate; the one bars gate)",
            "revision": e["revision"]["type"], "status": e["status"], "cohort": e["cohort"],
            "reason": "" if e["status"] == "enabled" else REASONS.get(sym, "not enabled"),
        }
        st_row = conn.execute("SELECT state, reason FROM series_state WHERE series_id=?", (sym,)).fetchone()
        rec["state"] = st_row["state"] if st_row else ""
        cnt = conn.execute("SELECT COUNT(DISTINCT period_start), MIN(period_start), MAX(period_start), COUNT(*) "
                           "FROM observation WHERE series_id=?", (sym,)).fetchone()
        rec["count"], rec["oldest"], rec["newest"], rec["rows"] = cnt[0], cnt[1] or "", cnt[2] or "", cnt[3]
        lp = st.latest_point(sym) if cnt[0] else None
        rec["latest_value"] = "" if lp is None else ("NA" if lp.value is None else f"{lp.value:.6g}")
        pit = Counter(r[0] for r in conn.execute("SELECT pit_class FROM observation WHERE series_id=?", (sym,)))
        rec["pit"] = " ".join(f"{k}:{v}" for k, v in sorted(pit.items()))
        rej = conn.execute("SELECT COUNT(*) FROM validation_event WHERE series_id=? AND severity='reject'",
                           (sym,)).fetchone()[0]
        leaks = conn.execute("SELECT COUNT(*) FROM observation o JOIN release r USING(release_id) WHERE "
                             "o.series_id=? AND r.scheduled_at IS NOT NULL AND o.available_at < r.scheduled_at",
                             (sym,)).fetchone()[0]
        rec["validation"] = f"rejects {rej}; leaks {leaks}"
        audit = []
        cls = Counter()
        early = 0
        if e["status"] == "enabled" and cnt[0]:
            if e["derivation"]:
                audit = derive.audit_derived(st, sym)
                cls["derived"] = cnt[3]
            else:
                bf = [dict(r) for r in conn.execute(
                    "SELECT o.* FROM observation o JOIN release r USING(release_id) WHERE r.kind='backfill' "
                    "AND o.series_id=? ORDER BY o.period_start", (sym,))]
                periods = sorted(timeutil.as_date(r[0]) for r in conn.execute(
                    "SELECT DISTINCT period_end FROM observation WHERE series_id=?", (sym,)))
                fam = history.get(key, {})
                evc: dict = {}
                for r in bf:
                    # the events the pipeline saw: cal.load_events around the row's first sighting
                    if r["ingested_at"] not in evc:
                        evc[r["ingested_at"]] = cal.load_events(st, key, r["ingested_at"])
                    c, _d = classify(e, r, evc[r["ingested_at"]], periods, history)
                    cls[c] += 1
                    lab = r["period_end"] if e["frequency"] in ("W", "D") else bt.label_for(e, timeutil.as_date(r["period_start"]))
                    h = fam.get(lab)
                    if h and r["available_at"] < timeutil.et_to_utc(h[0], h[1] or "00:00"):
                        early += 1
                live = conn.execute("SELECT COUNT(*) FROM observation o JOIN release r USING(release_id) "
                                    "WHERE r.kind='live' AND o.series_id=?", (sym,)).fetchone()[0]
                if live:
                    cls["live"] = live
            if rej or leaks or audit or early or cls.get("unknown"):
                fails.append(f"{sym}: rejects={rej} leaks={leaks} audit={len(audit)} early_vs_archive={early} "
                             f"unknown={cls.get('unknown', 0)}")
            if not e["derivation"]:
                for k in ("exact", "reconstructed", "conservative", "unknown"):
                    totals[k] += cls.get(k, 0)
            per_provider[src["agency"] if not e["derivation"] else "UCT (derived)"] += 1
        rec["placement"] = " ".join(f"{k}:{v}" for k, v in sorted(cls.items()))
        rec["placement_early_vs_archive"] = early
        rec["derived_audit"] = "clean" if not audit else f"{len(audit)} reasons"
        rec["bls_history"] = a.bls_note if src["adapter"] == "bls" and e["status"] == "enabled" and not e["cohort"] else ""
        rows_out.append(rec)

    out = Path(a.out_dir)
    out.mkdir(parents=True, exist_ok=True)
    cols = list(rows_out[0])
    with open(out / "CATALOG.csv", "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader()
        w.writerows(rows_out)
    st_counts = Counter(r["status"] for r in rows_out)
    en = [r for r in rows_out if r["status"] == "enabled"]
    md = [f"# Economic Data launch catalog: readiness census",
          "",
          f"Generated by `tools/econ/readiness_census.py --db {a.db}` (LOCAL DB, fresh build 2026-09-30, keyless). "
          "Machine-readable: [`CATALOG.csv`](CATALOG.csv).",
          "",
          f"**151 candidates -> {st_counts['enabled']} enabled / {sum(v for k, v in st_counts.items() if k == 'disabled')} "
          f"disabled / {st_counts['unverified']} unverified** (excluded: {st_counts.get('excluded', 0)}).",
          "",
          f"Gate failures among enabled series: **{len(fails)}**" + ("" if not fails else ": " + "; ".join(fails)),
          "",
          "## Enabled by provider", "", "| provider | enabled |", "|---|---:|"]
    md += [f"| {k} | {v} |" for k, v in sorted(per_provider.items(), key=lambda x: -x[1])]
    tb = sum(totals.values())
    md += ["", "## Backfill placement accuracy (non-derived backfill rows)", "",
           "| class | rows | share |", "|---|---:|---:|"]
    md += [f"| {k} | {totals[k]:,} | {100 * totals[k] / tb:.1f}% |" for k in ("exact", "reconstructed", "conservative",
                                                                               "unknown")] if tb else []
    md += [f"| **total** | {tb:,} | |", "",
           "exact = agency-stated date AND time; reconstructed = agency-stated date with configured time / end of day, "
           "or an agency-published cadence rule; conservative = late-side lag/era/lapse estimate; unknown = does "
           "not re-derive. `placement_early_vs_archive` counts rows placed before an archived agency release "
           "(must be 0).", "",
           "## Not enabled (status + reason)", "", "| symbol | status | reason |", "|---|---|---|"]
    md += [f"| {r['symbol']} | {r['status']} | {r['reason']} |" for r in rows_out if r["status"] != "enabled"]
    md += ["", "## Per series", "",
           "| id | name | provider id | units | freq | SA | calendar (source) | PIT | range (count) | latest | "
           "state | validation | placement | status |", "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|"]
    for r in rows_out:
        md.append(f"| {r['canonical_id']} | {r['display_name']} | `{r['provider_id'][:40]}` | {r['units']} | "
                  f"{r['frequency']} | {r['seasonal_adjustment']} | {r['currentness_expectation']} | {r['pit']} | "
                  f"{r['oldest']}..{r['newest']} ({r['count']}) | {r['latest_value']} | {r['state']} | "
                  f"{r['validation']} | {r['placement']} | {r['status']} |")
    md += ["", "Entitlement for every enabled series: paid, `require_bars_access` (the one bars gate). "
           "Chart presentation per series is in CATALOG.csv (`presentation`).",
           "", f"BLS: {a.bls_note}."]
    (out / "CATALOG.md").write_text("\n".join(md) + "\n", encoding="utf-8")
    print(f"candidates {len(rows_out)}: {dict(st_counts)}; placement {dict(totals)}; fails {len(fails)}")
    for f_ in fails:
        print("  FAIL", f_)
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
