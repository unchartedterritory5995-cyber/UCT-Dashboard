"""Revalidation of the integration code (C:\\w\\econint) against the COPY of the accepted DB.
Read-only against the copy. Writes a JSON evidence file."""
import csv, json, os, sys, sqlite3
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

REPO = r"C:\w\econint"
DB = r"C:\w\econint-data\econ.db"
for k in ("AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_ENDPOINT",
          "R2_BUCKET", "R2_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN", "BLS_API_KEY", "BEA_API_KEY", "CENSUS_API_KEY",
          "EIA_API_KEY", "DATABASE_URL"):
    os.environ.pop(k, None)
os.environ.update(ECON_SERVING_SOURCE="db", ECON_DB_PATH=DB, ECON_PUBLISH_R2="0", ECON_ENABLED="1",
                  ECON_CACHE_TTL="0")
sys.path.insert(0, REPO)
import api.services.econ as econpkg  # noqa
assert os.path.abspath(econpkg.__file__).lower().startswith(REPO.lower()), econpkg.__file__
from api.services.econ import store as S, serving, publish as P, registry as R, derive as D
from api.services.econ import backfill_timing as BT, timeutil as TU

ET = ZoneInfo("America/New_York")
def et(ts): return datetime.fromtimestamp(int(ts), timezone.utc).astimezone(ET).strftime("%Y-%m-%d %H:%M:%S ET")
def num(x):
    if x in ("", None): return None
    return float(x)

out = {"code": econpkg.__file__, "db": DB}
db = S.connect(DB, readonly=True)

# ── 1. census comparison (store + serving path)
census = {r["symbol"]: r for r in csv.DictReader(open(r"C:\w\econ1\docs\economic-data\COHORT-CENSUS.csv", encoding="utf-8"))}
SYMS = ["USCPINSA", "USCPI", "USRGDPQA", "USPCEPI", "USDEBT", "USTGA", "USMTSDEF", "UST10Y", "USM2", "USFEDBAL",
        "USEFFR", "USFEDFUNDSU", "USFEDFUNDSL", "USSOFR", "USRRP", "USFHFAHPI", "USCRUDEINV", "USGASPRICE", "USICSA",
        "USUNRATE", "USNFP", "USJOLTSO", "USCPIYOY", "USPCEPIYOY", "UST10Y2Y", "USNFPCHG", "USDEBTGDP"]
rows1 = []
for sym in SYMS:
    c = census.get(sym)
    lr = db.latest_rows(sym)
    st, body, _ = serving.series(sym)
    pts = body.get("points") or [] if st == 200 else []
    # points columns t,v,ps,pe,pit
    sp = sorted(pts, key=lambda p: p[2])
    got = {"count": len(lr), "oldest": lr[0].period_start if lr else None, "newest": lr[-1].period_start if lr else None,
           "latest": lr[-1].value if lr else None,
           "srv_status": st, "srv_count": len(pts), "srv_oldest": sp[0][2] if sp else None,
           "srv_newest": sp[-1][2] if sp else None, "srv_latest": sp[-1][1] if sp else None,
           "na": sum(1 for r in lr if r.value is None)}
    if c is None:
        rows1.append({"symbol": sym, "census": None, **got, "verdict": "NO CENSUS ROW"}); continue
    exp = {"count": int(c["count"]), "oldest": c["oldest"], "newest": c["newest"], "latest": num(c["latest_value"]),
           "na": int(c["na"])}
    ok = (got["count"] == exp["count"] == got["srv_count"] and got["oldest"] == exp["oldest"] == got["srv_oldest"]
          and got["newest"] == exp["newest"] == got["srv_newest"] and got["na"] == exp["na"]
          and (exp["latest"] == got["latest"] == got["srv_latest"]))
    rows1.append({"symbol": sym, "exp": exp, **got, "verdict": "MATCH" if ok else "MISMATCH"})
out["census"] = rows1
# also: all cohort series in the census, store-only
allcmp = []
for sym, c in census.items():
    lr = db.latest_rows(sym)
    g = (len(lr), lr[0].period_start if lr else "", lr[-1].period_start if lr else "", lr[-1].value if lr else None)
    e = (int(c["count"]), c["oldest"], c["newest"], num(c["latest_value"]))
    allcmp.append({"symbol": sym, "ok": g == e, "got": g, "exp": e})
out["census_all"] = {"n": len(allcmp), "mismatch": [a for a in allcmp if not a["ok"]]}

# ── 2. revision / as-of
def rel_of(sym, ps, pick_live=True):
    return db._dicts("SELECT o.available_at, o.value, o.pit_class, o.available_method, r.release_key, r.scheduled_at "
                     "FROM observation o JOIN release r USING(release_id) WHERE o.series_id=? AND o.period_start=? "
                     "ORDER BY o.available_at", (sym, ps))
rev = {}
for sym, ps in (("USFHFAHPI", "2026-06-01"), ("USJOLTSO", "2026-07-01")):
    vs = db.versions(sym, ps)
    detail = rel_of(sym, ps)
    live_t = max(v.available_at for v in vs)
    def at(t):
        stt, b, _ = serving.series(sym, asof=t)
        m = [p for p in b["points"] if p[2] == ps]
        return {"asof": t, "asof_et": et(t), "status": stt, "view": b.get("view"),
                "currentness": b.get("currentness"), "value": m[0][1] if m else None, "t": m[0][0] if m else None}
    rev[sym] = {"period": ps, "versions": [{"available_at": v.available_at, "et": et(v.available_at), "value": v.value,
                                            "pit": v.pit_class, "method": v.available_method, "release_id": v.release_id}
                                           for v in vs],
                "release_rows": detail, "live_available_at": live_t, "live_et": et(live_t),
                "before": at(live_t - 1), "after": at(live_t)}
    stl, bl, _ = serving.series(sym)
    ml = [p for p in bl["points"] if p[2] == ps]
    rev[sym]["latest_view"] = {"value": ml[0][1], "t": ml[0][0], "t_et": et(ml[0][0])}
out["revision"] = rev

# ── 3. leaks
q = ("SELECT COUNT(*) FROM observation o JOIN release r USING(release_id) "
     "WHERE r.scheduled_at IS NOT NULL AND o.available_at < r.scheduled_at")
out["leaks_before_schedule"] = db.conn.execute(q).fetchone()[0]
out["obs_total"] = db.conn.execute("SELECT COUNT(*) FROM observation").fetchone()[0]
out["releases_with_sched"] = db.conn.execute("SELECT COUNT(*) FROM release WHERE scheduled_at IS NOT NULL").fetchone()[0]
derived = [e["symbol"] for e in R.all() if e.get("derivation") and db.conn.execute(
    "SELECT 1 FROM observation WHERE series_id=? LIMIT 1", (e["symbol"],)).fetchone()]
aud = {s: D.audit_derived(db, s) for s in derived}
out["audit_derived"] = {s: {"reasons": len(r), "rows": db.conn.execute("SELECT COUNT(*) FROM observation WHERE series_id=?", (s,)).fetchone()[0],
                            "sample": r[:3]} for s, r in aud.items()}

# ── 4. shutdown / holiday hardening
h = {}
v = db.versions("USCPINSA", "2025-09-01")
floor = TU.et_to_utc("2026-01-30", "23:59")
h["USCPINSA_2025-09"] = {"rows": [{"et": et(x.available_at), "value": x.value, "pit": x.pit_class, "method": x.available_method} for x in v],
                         "catchup_floor_et": et(floor),
                         "ok": bool(v) and all(x.pit_class == "L" and x.available_at >= floor for x in v)}
v = db.versions("USNFP", "2025-09-01")
nfp_floor = TU.et_to_utc("2025-11-20", "00:00")
h["USNFP_2025-09"] = {"rows": [{"et": et(x.available_at), "value": x.value, "pit": x.pit_class, "method": x.available_method} for x in v],
                      "ok": bool(v) and all(x.available_at >= nfp_floor for x in v)}
h["UST10Y_null_rows"] = db.conn.execute("SELECT COUNT(*) FROM observation WHERE series_id='UST10Y' AND value IS NULL").fetchone()[0]
h["UST2Y_null_rows"] = db.conn.execute("SELECT COUNT(*) FROM observation WHERE series_id='UST2Y' AND value IS NULL").fetchone()[0]
h["UST10Y2Y_null_rows"] = db.conn.execute("SELECT COUNT(*) FROM observation WHERE series_id='UST10Y2Y' AND value IS NULL").fetchone()[0]
# gasoline: survey Monday = period_end (weekly, anchor MON); holiday Monday or Tuesday -> must be >= Wednesday
bad, n_hol, samples = [], 0, []
for x in db.vintages("USGASPRICE"):
    mon = date.fromisoformat(x.period_end)
    tue = mon + timedelta(days=1)
    if not (BT.is_pub_day(mon) and BT.is_pub_day(tue)):
        n_hol += 1
        d = TU.et_date(x.available_at)
        if d < mon + timedelta(days=2):
            bad.append((x.period_end, et(x.available_at)))
        elif len(samples) < 6 or x.period_end >= "2024-12-01":
            samples.append((x.period_end, et(x.available_at), x.available_method))
h["gas_holiday_weeks"] = {"holiday_week_rows": n_hol, "before_wednesday": bad, "samples": samples[-8:]}
lp = BT.lapses()
h["funding_lapses"] = {"file_exists": (BT.CAL_DIR / BT.LAPSE_FILE).exists(), "path": str(BT.CAL_DIR / BT.LAPSE_FILE),
                       "loaded_ids": [getattr(l, "id", None) for l in lp], "n": len(lp)}
out["hardening"] = h

# ── 5. USRETAIL
reg = {e["symbol"]: e for e in R.all()}
u = reg.get("USRETAIL", {})
out["retail"] = {
    "USRETAIL": {"status": u.get("status"), "source_verified": (u.get("source") or {}).get("verified"),
                 "fail_closed_note": [n for n in (u.get("notes") or []) if "FAIL CLOSED" in n]},
    "dependents": {s: {"status": (reg.get(s) or {}).get("status"), "exists": s in reg,
                       "inputs": ((reg.get(s) or {}).get("derivation") or {}).get("inputs")}
                   for s in ("USRETAILXA", "USRETAILCTRL", "USRETAILMOM", "USRETCTRLMOM")},
    "enabled_retail": [s for s, e in reg.items() if "RET" in s and e.get("status") == "enabled"],
    "serving_USRETAIL": serving.series("USRETAIL")[:2],
    "db_rows_USRETAIL": db.conn.execute("SELECT COUNT(*) FROM observation WHERE series_id='USRETAIL'").fetchone()[0],
}
vr = R.validate_registry()
out["validate_registry"] = vr if isinstance(vr, (list, dict, str, type(None))) else repr(vr)
out["enabled_count"] = len(R.enabled())
json.dump(out, open(sys.argv[1], "w"), indent=1, default=str)
print("written", sys.argv[1])
