"""Rebuild a LOCAL econ.db under corrected backfill timing -- WITHOUT re-fetching.

    python tools/econ/rebuild_local_db.py --old C:\\w\\econ1-data\\econ.db \\
        --new C:\\w\\econ1-data\\econ-rebuilt.db --report C:\\w\\econ1-data\\rebuild-report.json

LOCAL ONLY. Never touches the old DB (opened read-only; its WAL must be checkpointed by
the operator first -- see BACKFILL-TIMING.md 'Rebuild procedure'), never deletes a
file, never talks to a network or to R2. The new file must not exist.

WHAT IS CARRIED AND HOW
  verbatim (same ids, every column): acquisition, calendar_event (incl. superseded rows),
      calendar_coverage, validation_event, series_ops, provider_ops, provider_quota,
      series_state; every LIVE release and every observation row under it (raw truth
      captured at release time: SOFR/EFFR/FHFA/JOLTS/...). http_validator and lease start
      empty (the first poll after the rebuild is a full fetch).
  re-placed: every BACKFILL observation row keeps series/period/value/flag/acq_id/
      ingested_at/validated_at; its available_at + available_method + pit_class are
      recomputed by `backfill_timing.place` (now = the row's original ingested_at = its
      first sighting; periods = every period the series holds; events = the active
      calendar_event rows). Backfill releases keep their release_id and gain the key suffix
      ':retimed-<date>'.
  recomputed: every derived series (derive.derive_and_write, dependency order); derived
      release ids are allocated after the carried ones.

VERIFY (report + non-zero exit on any failure)
  counts per (series, kind) equal the old DB for backfill + live; every live row
  identical; 0 rows available before their release's scheduled time; audit_derived clean;
  latest (value, flag) per period identical to the old DB for EVERY series (derived
  included); the configured as-of probes (FHFA June, JOLTS July by default).
"""
from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
import time
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from api.services.econ import backfill_timing, derive, ingest, registry, timeutil  # noqa: E402
from api.services.econ import store as S  # noqa: E402
from api.services.econ.calendar import Event  # noqa: E402

VERBATIM_TABLES = ("acquisition", "calendar_event", "calendar_coverage", "validation_event", "series_ops",
                   "provider_ops", "provider_quota", "series_state")
OBS_COLS = ("series_id", "period_start", "release_id", "period_end", "value", "flag", "available_at",
            "available_method", "pit_class", "acq_id", "inputs", "ingested_at", "validated_at")

# (symbol, period_start, as-of unix, expected value)
DEFAULT_PROBES = [
    ("USFHFAHPI", "2026-06-01", timeutil.et_to_utc("2026-09-29", "08:59:59"), 442.53),
    ("USFHFAHPI", "2026-06-01", timeutil.et_to_utc("2026-09-29", "09:00"), 442.34),
    ("USJOLTSO", "2026-07-01", timeutil.et_to_utc("2026-09-29", "09:59:59"), 7271.0),
    ("USJOLTSO", "2026-07-01", timeutil.et_to_utc("2026-09-29", "10:00"), 7335.0),
]


def _cols(conn, table: str) -> list[str]:
    return [r[1] for r in conn.execute(f"PRAGMA table_info({table})")]


def rebuild(old_path: str, new_path: str, *, stamp: str, log=print) -> dict:
    if os.path.exists(new_path):
        raise SystemExit(f"refusing: {new_path} exists (never overwritten)")
    old = sqlite3.connect(f"file:{old_path}?mode=ro", uri=True)
    old.row_factory = sqlite3.Row
    st = S.connect(new_path)
    new = st.conn
    rep: dict = {"old": old_path, "new": new_path, "stamp": stamp, "started_at": int(time.time())}

    # 1. verbatim tables
    with st.tx():
        for t in VERBATIM_TABLES:
            cols = [c for c in _cols(old, t) if c in set(_cols(new, t))]
            rows = old.execute(f"SELECT {','.join(cols)} FROM {t}").fetchall()
            new.executemany(f"INSERT INTO {t}({','.join(cols)}) VALUES ({','.join('?' * len(cols))})",
                            [tuple(r) for r in rows])
            rep.setdefault("verbatim", {})[t] = len(rows)
    log(f"verbatim tables: {rep['verbatim']}")

    # 2. releases: live + backfill keep their ids; derived are recomputed later
    rel = {r["release_id"]: dict(r) for r in old.execute("SELECT * FROM release")}
    rcols = _cols(old, "release")
    with st.tx():
        for rid, r in sorted(rel.items()):
            if r["kind"] == "derived":
                continue
            r = dict(r)
            if r["kind"] == "backfill":
                r["release_key"] = f"{r['release_key']}:retimed-{stamp}"
            new.execute(f"INSERT INTO release({','.join(rcols)}) VALUES ({','.join('?' * len(rcols))})",
                        tuple(r[c] for c in rcols))
    kinds = Counter(r["kind"] for r in rel.values())
    rep["releases_old"] = dict(kinds)

    # 3. live rows verbatim
    live_rows = old.execute(f"SELECT {','.join('o.' + c for c in OBS_COLS)} FROM observation o JOIN release r "
                            "USING(release_id) WHERE r.kind='live'").fetchall()
    with st.tx():
        new.executemany(f"INSERT INTO observation({','.join(OBS_COLS)}) VALUES ({','.join('?' * len(OBS_COLS))})",
                        [tuple(r) for r in live_rows])
    log(f"live rows carried verbatim: {len(live_rows)}")

    # 4. backfill rows re-placed
    events_by_key: dict = defaultdict(list)
    for r in old.execute("SELECT * FROM calendar_event WHERE superseded_at IS NULL"):
        events_by_key[r["calendar_key"]].append(Event.from_row(dict(r)))
    periods_by_sym: dict = defaultdict(set)
    for sid, pe in old.execute("SELECT DISTINCT o.series_id, o.period_end FROM observation o JOIN release r "
                               "USING(release_id) WHERE r.kind IN ('live','backfill')"):
        periods_by_sym[sid].add(timeutil.as_date(pe))
    bf = old.execute(f"SELECT {','.join('o.' + c for c in OBS_COLS)} FROM observation o JOIN release r "
                     "USING(release_id) WHERE r.kind='backfill' ORDER BY o.series_id, o.period_start").fetchall()
    sorted_periods = {k: sorted(v) for k, v in periods_by_sym.items()}
    stats: dict = defaultdict(Counter)
    out_rows = []
    for r in bf:
        sym = r["series_id"]
        spec = registry.get(sym)
        key = (spec.get("release") or {}).get("calendar_key") or ""
        pl = backfill_timing.place(spec, r["period_start"], r["period_end"], now=int(r["ingested_at"]),
                                   events=events_by_key.get(key, ()), periods=sorted_periods.get(sym, []))
        if pl is None:
            raise SystemExit(f"{sym} {r['period_start']}: no placement (registry has no lag rule)")
        c = stats[sym]
        c["rows"] += 1
        if pl.available_at != r["available_at"]:
            c["retimed"] += 1
            c["later" if pl.available_at > r["available_at"] else "earlier"] += 1
        if pl.pit_class != r["pit_class"]:
            c[f"pit {r['pit_class']}->{pl.pit_class}"] += 1
        if pl.lapse:
            c[f"lapse {pl.lapse}"] += 1
        c[f"method {pl.method}"] += 1
        d = dict(r)
        d.update(available_at=pl.available_at, available_method=pl.method, pit_class=pl.pit_class)
        out_rows.append(tuple(d[k] for k in OBS_COLS))
    with st.tx():
        new.executemany(f"INSERT INTO observation({','.join(OBS_COLS)}) VALUES ({','.join('?' * len(OBS_COLS))})",
                        out_rows)
    rep["backfill"] = {k: dict(v) for k, v in sorted(stats.items())}
    log(f"backfill rows re-placed: {len(out_rows)}")

    # 5. derived, fresh, in dependency order
    ents = registry.load_registry()
    base = [e["symbol"] for e in ents if e.get("status") == "enabled" and not e.get("derivation")]
    dres = {}
    for e in ingest.downstream_derived(base, ents):
        dres[e["symbol"]] = derive.derive_and_write(st, e, calendar_key=(e.get("release") or {}).get("calendar_key"))
    rep["derived_written"] = dres
    log(f"derived rows written: {sum(dres.values())}")
    st.conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    rep["verify"] = verify(old, st)
    rep["finished_at"] = int(time.time())
    st.close()
    old.close()
    return rep


def _latest_map(conn, sym: str, asof=None) -> dict:
    q = ("SELECT period_start, value, flag FROM observation o WHERE series_id=? {a} AND NOT EXISTS ("
         " SELECT 1 FROM observation p WHERE p.series_id=o.series_id AND p.period_start=o.period_start {pa}"
         " AND (p.available_at > o.available_at OR (p.available_at = o.available_at AND p.release_id > o.release_id)))")
    a = "AND o.available_at <= ?" if asof is not None else ""
    pa = "AND p.available_at <= ?" if asof is not None else ""
    args = (sym, asof, asof) if asof is not None else (sym,)
    return {r[0]: (r[1], r[2] or "") for r in conn.execute(q.format(a=a, pa=pa), args)}


def verify(old, st, probes=DEFAULT_PROBES) -> dict:
    new = st.conn
    v: dict = {"failures": []}
    fail = v["failures"].append

    def counts(conn):
        return {(r[0], r[1]): r[2] for r in conn.execute(
            "SELECT o.series_id, r.kind, COUNT(*) FROM observation o JOIN release r USING(release_id) GROUP BY 1,2")}
    co, cn = counts(old), counts(new)
    for k in sorted(set(co) | set(cn)):
        if k[1] in ("live", "backfill") and co.get(k) != cn.get(k):
            fail(f"count {k}: old {co.get(k)} new {cn.get(k)}")
    v["counts_old"] = {f"{a}/{b}": n for (a, b), n in sorted(co.items())}
    v["counts_new"] = {f"{a}/{b}": n for (a, b), n in sorted(cn.items())}
    q = (f"SELECT {','.join('o.' + c for c in OBS_COLS)} FROM observation o JOIN release r USING(release_id) "
         "WHERE r.kind='live' ORDER BY 1,2,3")
    lo, ln = [tuple(r) for r in old.execute(q)], [tuple(r) for r in new.execute(q)]
    v["live_rows"] = len(ln)
    if lo != ln:
        fail("live rows differ from the old DB")
    leaks = new.execute("SELECT COUNT(*) FROM observation o JOIN release r USING(release_id) "
                        "WHERE r.scheduled_at IS NOT NULL AND o.available_at < r.scheduled_at").fetchone()[0]
    v["leaks_before_schedule"] = leaks
    if leaks:
        fail(f"{leaks} rows available before their release's scheduled time")
    late = new.execute("SELECT COUNT(*) FROM observation o JOIN release r USING(release_id) WHERE r.kind='backfill' "
                       "AND o.available_at > o.ingested_at AND o.available_method NOT LIKE 'scheduled%'").fetchone()[0]
    v["unsnapped_after_first_sighting"] = late
    if late:
        fail(f"{late} unsnapped backfill rows placed after their first sighting")
    syms = sorted({r[0] for r in new.execute("SELECT DISTINCT series_id FROM observation")} |
                  {r[0] for r in old.execute("SELECT DISTINCT series_id FROM observation")})
    diff = {}
    for s in syms:
        a, b = _latest_map(old, s), _latest_map(new, s)
        if a != b:
            bad = [p for p in set(a) | set(b) if a.get(p) != b.get(p)]
            diff[s] = sorted(bad)[:5] + ([f"... {len(bad)} total"] if len(bad) > 5 else [])
    v["latest_mismatch"] = diff
    if diff:
        fail(f"latest values differ: {sorted(diff)}")
    audits = {}
    for e in registry.load_registry():
        if e.get("derivation") and e.get("status") == "enabled":
            errs = derive.audit_derived(st, e["symbol"])
            if errs:
                audits[e["symbol"]] = errs[:3]
    v["audit_derived"] = audits
    if audits:
        fail(f"audit_derived: {sorted(audits)}")
    pr = []
    for sym, ps, asof, want in probes:
        got = _latest_map(new, sym, asof).get(ps)
        ok = got is not None and got[0] is not None and abs(got[0] - want) < 1e-9
        pr.append({"series": sym, "period": ps, "asof": asof, "want": want, "got": got and got[0], "ok": ok})
        if not ok:
            fail(f"as-of probe {sym} {ps} @ {asof}: want {want} got {got}")
    v["probes"] = pr
    pit = defaultdict(Counter)
    for s, p, n in new.execute("SELECT series_id, pit_class, COUNT(*) FROM observation GROUP BY 1,2"):
        pit[s][p] = n
    v["pit_new"] = {k: dict(c) for k, c in sorted(pit.items())}
    v["ok"] = not v["failures"]
    return v


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="rebuild a local econ.db under corrected backfill timing")
    ap.add_argument("--old", required=True)
    ap.add_argument("--new", required=True)
    ap.add_argument("--report", default=None)
    ap.add_argument("--stamp", default=time.strftime("%Y-%m-%d", time.gmtime()))
    a = ap.parse_args(argv)
    for k in list(os.environ):          # no credentials in this process, ever
        if k.startswith(("AWS_", "R2_", "CLOUDFLARE_")) or k.endswith("_API_KEY"):
            del os.environ[k]
    os.environ["ECON_PUBLISH_R2"] = "0"
    rep = rebuild(a.old, a.new, stamp=a.stamp)
    text = json.dumps(rep, indent=1, default=str)
    if a.report:
        Path(a.report).write_text(text, encoding="utf-8")
    v = rep["verify"]
    print(f"verify ok={v['ok']} leaks={v['leaks_before_schedule']} live_rows={v['live_rows']} "
          f"latest_mismatch={len(v['latest_mismatch'])} audit={len(v['audit_derived'])}")
    for f in v["failures"]:
        print("FAIL:", f)
    for p in v["probes"]:
        print(f"probe {p['series']} {p['period']} asof={p['asof']} want={p['want']} got={p['got']} ok={p['ok']}")
    return 0 if v["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
