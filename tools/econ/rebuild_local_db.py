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
  dropped (only with --drop-non-emitted): a BACKFILL row the CURRENT adapter would not
      emit from the SAME archived payload it was written from. The row's acquisition
      archive (`local:<adapter>/<sha>.bin` under --archive-dir) is re-normalised through
      the adapter's own parser (`NORMALIZERS`); a NULL row whose period is absent from
      that output is dropped (2026-09-29: fed_ddp daily ND = market-holiday "No data").
      Fail closed: a candidate with no archive, a payload that no longer parses, or a
      VALUED row the adapter would not emit aborts the rebuild. Live rows are never
      dropped (carried verbatim). The dropped periods are also removed from the period
      list backfill placement reads, i.e. the survivors are placed under current rules.

VERIFY (report + non-zero exit on any failure)
  counts per (series, kind) equal the old DB for backfill + live (backfill: minus the
  dropped rows, exactly); every live row
  identical; 0 rows available before their release's scheduled time; audit_derived clean;
  latest (value, flag) per period identical to the old DB for EVERY series (derived
  included) apart from the dropped NULL periods (and a derived NULL on one of them);
  0 daily null rows sharing an ET availability date with a valued row; the configured
  as-of probes (FHFA June, JOLTS July by default).
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
from typing import Optional

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


# --- what the CURRENT adapter emits from an archived payload -------------------

def _fed_ddp_emitted(spec_entry: dict, body: bytes) -> set:
    """period_starts fed_ddp.to_obs emits for this series from an archived payload."""
    from api.services.econ.adapters import fed_ddp
    from api.services.econ.adapters.base import SeriesSpec
    sp = SeriesSpec(spec_entry)
    if body[:2] == b"PK":
        parsed = fed_ddp.parse_sdmx_zip(body, {fed_ddp.mnemonic_of(sp)})
    else:
        parsed = fed_ddp.parse_ddp_csv(body)
    return {o.period_start for o in fed_ddp.to_obs(sp, fed_ddp.select_series(parsed, sp))}


NORMALIZERS = {"fed_ddp": _fed_ddp_emitted}


def non_emitted(old, archive_dir: Optional[str], log=print) -> dict:
    """{(series_id, period_start): reason} of BACKFILL rows to drop. Fail closed."""
    drop: dict = {}
    cache: dict = {}
    q = ("SELECT o.series_id, o.period_start, o.value, o.acq_id, a.archive_ref FROM observation o "
         "JOIN release r USING(release_id) LEFT JOIN acquisition a ON a.acq_id = o.acq_id "
         "WHERE r.kind='backfill' ORDER BY 1, 2")
    rows_by = defaultdict(list)
    for sid, ps, v, acq, ref in old.execute(q):
        rows_by[(sid, acq, ref)].append((ps, v))
    for (sid, acq, ref), rows in sorted(rows_by.items(), key=lambda kv: (kv[0][0], kv[0][1] or 0)):
        spec = registry.get(sid) or {}
        norm = NORMALIZERS.get((spec.get("source") or {}).get("adapter"))
        if norm is None or not any(v is None for _, v in rows):
            continue
        if not ref or not str(ref).startswith("local:") or not archive_dir:
            raise SystemExit(f"{sid} acq {acq}: null rows but no local archive to re-normalise -- refusing")
        path = os.path.join(archive_dir, *str(ref)[len("local:"):].split("/"))
        if (sid, path) not in cache:
            if not os.path.exists(path):
                raise SystemExit(f"{sid}: archive {path} missing -- refusing to drop without evidence")
            with open(path, "rb") as fh:
                cache[(sid, path)] = norm(spec, fh.read())
        emitted = cache[(sid, path)]
        for ps, v in rows:
            if ps in emitted:
                continue
            if v is not None:
                raise SystemExit(f"{sid} {ps}: a VALUED backfill row the adapter no longer emits -- refusing")
            drop[(sid, ps)] = f"not emitted by {spec['source']['adapter']} from {ref}"
    log(f"non-emitted backfill rows to drop: {dict(sorted(Counter(k[0] for k in drop).items()))}")
    return drop


def _et_date(ts: int) -> str:
    return timeutil.et_date(int(ts)).isoformat()


def _cols(conn, table: str) -> list[str]:
    return [r[1] for r in conn.execute(f"PRAGMA table_info({table})")]


def rebuild(old_path: str, new_path: str, *, stamp: str, log=print, drop_non_emitted: bool = False,
            archive_dir: Optional[str] = None, probes=None) -> dict:
    if os.path.exists(new_path):
        raise SystemExit(f"refusing: {new_path} exists (never overwritten)")
    old = sqlite3.connect(f"file:{old_path}?mode=ro", uri=True)
    old.row_factory = sqlite3.Row
    st = S.connect(new_path)
    new = st.conn
    rep: dict = {"old": old_path, "new": new_path, "stamp": stamp, "started_at": int(time.time())}
    dropped = non_emitted(old, archive_dir, log=log) if drop_non_emitted else {}
    rep["dropped"] = {"rule": "backfill null rows the current adapter does not emit (fed_ddp daily ND)",
                      "archive_dir": archive_dir, "count": len(dropped),
                      "by_series": dict(sorted(Counter(k[0] for k in dropped).items())),
                      "sample": sorted(f"{a} {b}" for a, b in dropped)[:10]}

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
    for sid, ps in dropped:                       # daily: period_start == period_end
        live = old.execute("SELECT 1 FROM observation o JOIN release r USING(release_id) WHERE r.kind='live' "
                           "AND o.series_id=? AND o.period_start=?", (sid, ps)).fetchone()
        if not live:
            periods_by_sym[sid].discard(timeutil.as_date(ps))
    bf = old.execute(f"SELECT {','.join('o.' + c for c in OBS_COLS)} FROM observation o JOIN release r "
                     "USING(release_id) WHERE r.kind='backfill' ORDER BY o.series_id, o.period_start").fetchall()
    sorted_periods = {k: sorted(v) for k, v in periods_by_sym.items()}
    stats: dict = defaultdict(Counter)
    out_rows = []
    for r in bf:
        sym = r["series_id"]
        if (sym, r["period_start"]) in dropped:
            stats[sym]["dropped"] += 1
            continue
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
    rep["verify"] = verify(old, st, dropped=dropped, probes=DEFAULT_PROBES if probes is None else probes)
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


def verify(old, st, probes=DEFAULT_PROBES, dropped=None) -> dict:
    new = st.conn
    dropped = dropped or {}
    v: dict = {"failures": [], "dropped": len(dropped)}
    fail = v["failures"].append
    drop_n = Counter(k[0] for k in dropped)
    drop_periods = {k[1] for k in dropped}

    def counts(conn):
        return {(r[0], r[1]): r[2] for r in conn.execute(
            "SELECT o.series_id, r.kind, COUNT(*) FROM observation o JOIN release r USING(release_id) GROUP BY 1,2")}
    co, cn = counts(old), counts(new)
    for k in sorted(set(co) | set(cn)):
        want = (co.get(k) or 0) - (drop_n.get(k[0], 0) if k[1] == "backfill" else 0)
        if k[1] in ("live", "backfill") and want != (cn.get(k) or 0):
            fail(f"count {k}: old {co.get(k)} - dropped {drop_n.get(k[0], 0)} != new {cn.get(k)}")
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
    excused = Counter()
    for s in syms:
        a, b = _latest_map(old, s), _latest_map(new, s)
        derived = bool((registry.get(s) or {}).get("derivation"))
        for p in [p for p in a if p not in b and a[p][0] is None and
                  ((s, p) in dropped or (derived and p in drop_periods))]:
            del a[p]                              # a dropped holiday null (or a derived null on one)
            excused[s] += 1
        if a != b:
            bad = [p for p in set(a) | set(b) if a.get(p) != b.get(p)]
            diff[s] = sorted(bad)[:5] + ([f"... {len(bad)} total"] if len(bad) > 5 else [])
    v["latest_mismatch"] = diff
    v["latest_excused_dropped_nulls"] = dict(sorted(excused.items()))
    # a daily NULL placed on the same ET availability date as a VALUED row masks it on the
    # release-date timeline -- the defect the drop removes. Must be 0 after a dropping rebuild.
    masked = {}
    for e in registry.load_registry():
        if e.get("frequency") != "D":
            continue
        byday = defaultdict(set)
        for r in st.latest_rows(e["symbol"]):
            byday[_et_date(r.first_available_at)].add(r.value is None)
        n = sum(1 for flags in byday.values() if flags == {True, False})
        if n:
            masked[e["symbol"]] = n
    v["daily_null_shares_date_with_value"] = masked
    if dropped and masked:
        fail(f"daily nulls still share an availability date with a value: {masked}")
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
    ap.add_argument("--drop-non-emitted", action="store_true",
                    help="drop backfill NULL rows the current adapter no longer emits from their archived payload")
    ap.add_argument("--archive-dir", default=os.environ.get("ECON_ARCHIVE_DIR"),
                    help="ECON_ARCHIVE_DIR of the old DB (required with --drop-non-emitted)")
    a = ap.parse_args(argv)
    if a.drop_non_emitted and not a.archive_dir:
        ap.error("--drop-non-emitted needs --archive-dir (evidence), never a guess")
    for k in list(os.environ):          # no credentials in this process, ever
        if k.startswith(("AWS_", "R2_", "CLOUDFLARE_")) or k.endswith("_API_KEY"):
            del os.environ[k]
    os.environ["ECON_PUBLISH_R2"] = "0"
    rep = rebuild(a.old, a.new, stamp=a.stamp, drop_non_emitted=a.drop_non_emitted, archive_dir=a.archive_dir)
    text = json.dumps(rep, indent=1, default=str)
    if a.report:
        Path(a.report).write_text(text, encoding="utf-8")
    v = rep["verify"]
    print(f"verify ok={v['ok']} dropped={v['dropped']} masked={v['daily_null_shares_date_with_value']} "
          f"leaks={v['leaks_before_schedule']} live_rows={v['live_rows']} "
          f"latest_mismatch={len(v['latest_mismatch'])} audit={len(v['audit_derived'])}")
    for f in v["failures"]:
        print("FAIL:", f)
    for p in v["probes"]:
        print(f"probe {p['series']} {p['period']} asof={p['asof']} want={p['want']} got={p['got']} ok={p['ok']}")
    return 0 if v["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
