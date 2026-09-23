import os
"""Local storage benchmark of the PROPOSED schema (scratch file, never production)."""
import json, sqlite3, sys, os, time, zipfile, statistics as st
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..")))
import scan
from api.services.fundamentals_pit import facts as F, filings as FL, knowledge as K, series as S
from api.services.fundamentals_pit.concepts import PRIMITIVES
TAGS = {t for p in PRIMITIVES.values() for t in p.tags}
res = json.load(open("scan_all.json")); uni = set(json.load(open("uct_universe.json")))
names = sorted({r["name"] for r in res if set(r.get("tickers") or []) & uni and "us-gaap" in r.get("tax", [])})
if os.path.exists("bench.db"): os.remove("bench.db")
db = sqlite3.connect("bench.db")
db.executescript("""
CREATE TABLE filing (filing_id INTEGER PRIMARY KEY, cik INTEGER NOT NULL, accn TEXT NOT NULL UNIQUE, form TEXT NOT NULL,
  filing_date TEXT NOT NULL, accepted_at INTEGER, public_at INTEGER NOT NULL, retrieved_at INTEGER NOT NULL);
CREATE TABLE concept (concept_id INTEGER PRIMARY KEY, tag TEXT NOT NULL UNIQUE);
CREATE TABLE fact (cik INTEGER NOT NULL, concept_id INTEGER NOT NULL, unit TEXT NOT NULL, period_start INTEGER, period_end INTEGER NOT NULL,
  val REAL NOT NULL, filing_id INTEGER NOT NULL,
  PRIMARY KEY (cik, concept_id, unit, period_end, period_start, filing_id)) WITHOUT ROWID;
CREATE TABLE series_point (cik INTEGER NOT NULL, metric TEXT NOT NULL, t_eff INTEGER NOT NULL, v REAL NOT NULL, period_end INTEGER NOT NULL,
  method TEXT NOT NULL, sources TEXT NOT NULL, derivation_version INTEGER NOT NULL,
  PRIMARY KEY (cik, metric, t_eff)) WITHOUT ROWID;
""")
scan._open()
cid = {}; t0 = time.time(); nf = npts = 0; sizes = []
for name in names:
    doc = json.loads(scan._cf.read(name)); cik = int(doc["cik"]); sizes.append(scan._cf.getinfo(name).file_size)
    main, pages = scan.sub_pages(cik); fl = FL.parse_submission_pages(pages)
    fx = F.parse_companyfacts(doc, TAGS)
    fid = {}
    for f in fx:
        if f.accn not in fl: continue
        if f.accn not in fid:
            fi = fl[f.accn]
            cur = db.execute("INSERT OR IGNORE INTO filing(cik,accn,form,filing_date,accepted_at,public_at,retrieved_at) VALUES (?,?,?,?,?,?,?)",
                             (cik, f.accn, fi.form, fi.filing_date.isoformat(), int(fi.accepted_at.timestamp()) if fi.accepted_at else None, int(fi.public_at.timestamp()), int(time.time())))
            fid[f.accn] = db.execute("SELECT filing_id FROM filing WHERE accn=?", (f.accn,)).fetchone()[0]
        if f.tag not in cid:
            db.execute("INSERT INTO concept(tag) VALUES (?)", (f.tag,)); cid[f.tag] = db.execute("SELECT concept_id FROM concept WHERE tag=?", (f.tag,)).fetchone()[0]
        ps = int(f.start.strftime("%Y%m%d")) if f.start else None
        db.execute("INSERT OR IGNORE INTO fact VALUES (?,?,?,?,?,?,?)", (cik, cid[f.tag], f.unit, ps, int(f.end.strftime("%Y%m%d")), f.val, fid[f.accn])); nf += 1
    kb = K.build(fx, fl); ser = S.build_series(kb)
    for m, pts in ser.items():
        for p in pts:
            db.execute("INSERT OR REPLACE INTO series_point VALUES (?,?,?,?,?,?,?,?)", (cik, m, int(p.t_eff.timestamp()), p.v, int(p.period_end.strftime("%Y%m%d")), p.method,
                       json.dumps(sorted({s[3] for s in p.sources if s[3]})), 1)); npts += 1
db.commit()
cnt = {t: db.execute(f"select count(*) from {t}").fetchone()[0] for t in ("filing", "fact", "series_point")}
db.execute("VACUUM"); db.close()
print("companies", len(names), "rows", cnt, "file MB", round(os.path.getsize("bench.db") / 1e6, 1), "load s", round(time.time() - t0))
print("companyfacts JSON per company: median KB", round(st.median(sizes) / 1e3), "p95 KB", round(sorted(sizes)[int(.95 * len(sizes))] / 1e3), "max MB", round(max(sizes) / 1e6, 1))
d = sqlite3.connect("bench.db")
t = time.time(); r = d.execute("select t_eff,v,period_end from series_point where cik=320193 and metric='net_margin_ttm' order by t_eff").fetchall(); q = time.time() - t
print("one-metric read AAPL:", len(r), "points", round(q * 1000, 2), "ms; JSON bytes", len(json.dumps(r)))
t = time.time(); r = d.execute("select metric,t_eff,v,period_end from series_point where cik=320193").fetchall(); q = time.time() - t
print("all-metric read AAPL:", len(r), "points", round(q * 1000, 2), "ms; JSON bytes", len(json.dumps(r)))
