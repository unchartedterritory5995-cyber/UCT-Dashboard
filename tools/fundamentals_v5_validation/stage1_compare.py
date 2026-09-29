"""POST-GRIND STAGE 1: full V4 <-> V5 census, attribution and ground truth.
Runs under the PINNED V5 code. Production store opened READ-ONLY; V5 store READ-ONLY."""
import sys
CODE = "/data/fundamentals_pit_v5/code/7dfda83de6a7"
sys.path.insert(0, CODE)
import os
import datetime as dt, json, time, traceback, collections
from concurrent.futures import ProcessPoolExecutor

RUN = "/data/fundamentals_pit_v5/run"
OUT = os.environ.get("V5OUT", "/data/fundamentals_pit_v5/validation")
PROD = "/data/fundamentals_pit.db"
V5DB = os.environ.get("V5DB", f"{RUN}/v5.db")
os.makedirs(OUT, exist_ok=True)
PERIODIC = {"10-K", "10-Q", "10-K/A", "10-Q/A", "10-KT", "10-QT", "10-KT/A", "10-QT/A"}


def d8(x):
    x = str(x).replace("-", "")
    return dt.date(int(x[:4]), int(x[4:6]), int(x[6:8]))


def ov(s0, e0, ps, pe, tol=0):
    a, b = d8(s0 or e0) - dt.timedelta(days=tol), d8(e0) + dt.timedelta(days=tol)
    return a <= d8(pe) and d8(ps or pe) <= b


def near_me(d):
    """FS data sets round ddate to the NEAREST month-end."""
    nxt = (d.replace(day=28) + dt.timedelta(days=4)); this_end = nxt - dt.timedelta(days=nxt.day)
    prev_end = d.replace(day=1) - dt.timedelta(days=1)
    return this_end if (this_end - d) <= (d - prev_end) else prev_end


def fs_pairs(fsig, isig):
    """Same filing, same tag, FS end == instance end rounded to the nearest month-end,
    both instants or both durations (the FS start is RECONSTRUCTED, so it is not compared)."""
    if fsig[0] != isig[0] or fsig[1] != isig[1]:
        return False
    f_inst, i_inst = fsig[2] == fsig[3], isig[2] == isig[3]
    return f_inst == i_inst and (d8(fsig[3]) == near_me(d8(isig[3])) or abs((d8(fsig[3]) - d8(isig[3])).days) <= 4)


def ts(iso):
    return dt.datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp()


def close(a, b):
    tol = max(abs(a) * 0.005, 1000.0) if abs(a) > 1e5 else max(abs(a) * 0.005, 0.005)
    return abs(a - b) <= tol


def ymd(s):
    return int(s.replace("-", "")) if s else 0


def one(cik):
    from api.services.fundamentals_pit import derive as D, store as S
    from api.services.fundamentals_pit.concepts import PRIMITIVES
    REL = frozenset(t for p in PRIMITIVES.values() for t in p.tags)
    FAM = {tg: frozenset(p.tags) for p in PRIMITIVES.values() for tg in p.tags}
    out = {"cik": cik, "kinds": collections.Counter(), "classes": collections.Counter(), "unexplained": [],
           "truth": collections.Counter(), "wrong": [], "gap_just": collections.Counter(), "gap_unjust": [],
           "H_signals": set(), "H_points": 0, "H_truth": collections.Counter(), "rows": {}}
    try:
        prod = S.connect(PROD, readonly=True); v5 = S.connect(V5DB, readonly=True)
        a4 = {(m, t): (v, pe, me) for m, t, v, pe, me in prod.execute(
            "SELECT metric, t_eff, v, period_end, method FROM series_point WHERE cik=? AND derivation_version=4", (cik,))}
        b5 = {(m, t): (v, pe, me) for m, t, v, pe, me in v5.execute(
            "SELECT metric, t_eff, v, period_end, method FROM series_point WHERE cik=? AND derivation_version=5", (cik,))}
        out["n4"], out["n5"] = len(a4), len(b5)
        pub = dict(prod.execute("SELECT accn, public_at FROM filing WHERE cik=?", (cik,)).fetchall())
        form = dict(prod.execute("SELECT accn, form FROM filing WHERE cik=?", (cik,)).fetchall())
        fs = {(a, t, int(s0), int(e0)) for a, t, s0, e0 in prod.execute(
            "SELECT s.accn, s.tag, s.period_start, s.period_end FROM filing_signal s JOIN filing f ON f.accn=s.accn WHERE f.cik=?", (cik,))}
        fs_checked = {a for (a,) in prod.execute(
            "SELECT c.accn FROM signal_check c JOIN filing f ON f.accn=c.accn WHERE f.cik=?", (cik,))}
        ins = {(a, t, int(s0), int(e0)) for a, t, s0, e0 in v5.execute(
            "SELECT s.accn, s.tag, s.period_start, s.period_end FROM filing_signal s JOIN filing f ON f.accn=s.accn WHERE f.cik=?", (cik,))}
        v5_checked = {a for (a,) in v5.execute(
            "SELECT c.accn FROM signal_check c JOIN filing f ON f.accn=c.accn WHERE f.cik=?", (cik,))}
        only_fs, only_in = fs - ins, ins - fs
        ev5 = [(t, s0, e0, pub.get(a, 1e18)) for a, t, s0, e0 in ins]
        changed = []
        for k in set(a4) | set(b5):
            va, vb = a4.get(k), b5.get(k)
            if va == vb:
                out["kinds"]["identical"] += 1; continue
            if va is None: kind = "new_v5_point"
            elif vb is None: kind = "only_v4_point"
            elif va[2] == "gap" and vb[2] != "gap": kind = "v4gap_to_v5value"
            elif va[2] != "gap" and vb[2] == "gap": kind = "v4value_to_v5gap"
            elif va[1] != vb[1]: kind = "period_changed"
            elif va[2] == vb[2] == "gap": kind = "other"
            else: kind = "value_changed"
            out["kinds"][kind] += 1
            changed.append((k, kind, va, vb))
            out["rows"][k] = {"kind": kind, "va": va, "vb": vb, "classes": [], "truth": None, "detail": None}
        # attribution
        for (metric, t), kind, va, vb in changed:
            lo = dt.datetime.utcfromtimestamp(t).date() - dt.timedelta(days=800)
            win = lambda s: s[1] in REL and pub.get(s[0], 1e18) <= t and d8(s[3]) >= lo
            wf, wi = [s for s in only_fs if win(s)], [s for s in only_in if win(s)]
            cl = set(); hs = []
            for s in wf:
                if any(fs_pairs(s, x) for x in wi):
                    cl.add("exact_span_correction")
                elif s[0] in v5_checked:
                    cl.add("bulk_data_only"); hs.append(s)
                else:
                    cl.add("v5_evidence_missing_for_filing")
            for s in wi:
                if any(fs_pairs(x, s) for x in wf):
                    continue
                if s[0] not in fs_checked:
                    cl.add("scope_expansion_" + ("periodic" if form.get(s[0]) in PERIODIC else "other_form"))
                else:
                    cl.add("filing_instance_only_evidence")
            if not cl:
                cl.add("UNEXPLAINED")
                if len(out["unexplained"]) < 20:
                    out["unexplained"].append([metric, str(dt.datetime.utcfromtimestamp(t).date()), kind, va, vb])
            for c in cl:
                out["classes"][c] += 1
            out["rows"][(metric, t)]["classes"] = sorted(cl)
            if hs:
                out["H_points"] += 1
                out["H_signals"].update("|".join(map(str, s)) for s in hs)
        # ground truth: every changed point where V5 emits a VALUE
        for (metric, t), kind, va, vb in changed:
            if vb is None or vb[2] == "gap":
                continue
            r = D.explain(v5, cik, metric, t, 5, ("massive",))
            bad = []
            for f in r["facts"]:
                if not f.get("period_end") or f.get("reported_value") is None:
                    continue
                tag = f["tag"]
                if "PerShare" in tag or "Shares" in tag:
                    out["truth"]["skipped_per_share_fact"] += 1; continue
                ps, pe = ymd(f.get("period_start")), ymd(f["period_end"])
                chain = prod.execute(
                    "SELECT x.val, fi.public_at FROM fact x JOIN concept c ON c.concept_id=x.concept_id JOIN filing fi ON fi.filing_id=x.filing_id "
                    "WHERE x.cik=? AND c.tag=? AND x.period_start=? AND x.period_end=? ORDER BY fi.public_at", (cik, tag, ps, pe)).fetchall()
                used, upub = float(f["reported_value"]), ts(f["public_at"]) if f.get("public_at") else 0
                later = [p for v, p in chain if p > upub and not close(used, v)]
                if not later:
                    out["truth"]["fact_never_restated"] += 1; continue
                fam = FAM.get(tag, frozenset({tag}))
                cover = [p for tg, s0, e0, p in ev5 if tg in fam and upub < p <= t and ov(s0, e0, ps, pe, 0)]
                if cover or min(later) <= t:
                    bad.append([tag, ps, pe, used, [v for v, p in chain if p > upub][:3], bool(cover), min(later) <= t])
                else:
                    out["truth"]["restated_only_after_t"] += 1
            key = "WRONG" if bad else "sound"
            out["truth"][key] += 1
            out["rows"][(metric, t)]["truth"] = key
            if bad:
                out["rows"][(metric, t)]["detail"] = bad[:3]
            if bad and len(out["wrong"]) < 15:
                out["wrong"].append([metric, str(dt.datetime.utcfromtimestamp(t).date()), kind, va, vb, bad[:3]])
            if any(s for s in out["H_signals"]):
                pass
        # new V5 gaps: justified iff exact v5 evidence (family) public by t covers a fact the V4 value used
        for (metric, t), kind, va, vb in changed:
            if kind != "v4value_to_v5gap":
                continue
            r = D.explain(prod, cik, metric, t, 4, ("massive",))
            just = False
            for f in r["facts"]:
                if not f.get("period_end"):
                    continue
                fam = FAM.get(f["tag"], frozenset({f["tag"]}))
                ps, pe = ymd(f.get("period_start")), ymd(f["period_end"])
                upub = ts(f["public_at"]) if f.get("public_at") else 0
                if any(tg in fam and upub < p <= t and ov(s0, e0, ps, pe, 0) for tg, s0, e0, p in ev5):
                    just = True; break
            out["gap_just"]["justified" if just else "UNJUSTIFIED"] += 1
            out["rows"][(metric, t)]["truth"] = "gap_justified" if just else "GAP_UNJUSTIFIED"
            if not just and len(out["gap_unjust"]) < 10:
                out["gap_unjust"].append([metric, str(dt.datetime.utcfromtimestamp(t).date()), va])
    except Exception:
        out["error"] = traceback.format_exc()[-1200:]
    out["H_signals"] = sorted(out["H_signals"])
    out["rows"] = [[cik, m, t, r["kind"], json.dumps(r["va"]), json.dumps(r["vb"]), ",".join(r["classes"]), r["truth"],
                    json.dumps(r["detail"], default=str) if r["detail"] else None] for (m, t), r in out["rows"].items()]
    return out


if __name__ == "__main__":
    t0 = time.time()
    from api.services.fundamentals_pit import store as S
    prod = S.connect(PROD, readonly=True); v5 = S.connect(V5DB, readonly=True)
    only = os.environ.get("V5CIKS_DIR")
    ciks = sorted(int(f.split(".")[0]) for f in os.listdir(only)) if only else None
    ciks = ciks or sorted({r[0] for r in prod.execute("SELECT DISTINCT cik FROM series_point WHERE derivation_version=4")} |
                  {r[0] for r in v5.execute("SELECT DISTINCT cik FROM series_point WHERE derivation_version=5")})
    agg = {"companies": len(ciks), "n4": 0, "n5": 0, "kinds": collections.Counter(), "classes": collections.Counter(),
           "truth": collections.Counter(), "gap_just": collections.Counter(), "unexplained": [], "wrong": [],
           "gap_unjust": [], "H_points": 0, "H_signals": [], "errors": []}
    import sqlite3
    DDB = f"{OUT}/v4v5_diff.db"
    if os.path.exists(DDB):
        os.remove(DDB)
    dd = sqlite3.connect(DDB)
    dd.execute("CREATE TABLE diff (cik INTEGER, metric TEXT, t_eff INTEGER, day TEXT, kind TEXT, v4 TEXT, v5 TEXT, "
               "classes TEXT, truth TEXT, detail TEXT, PRIMARY KEY (cik, metric, t_eff))")
    dd.execute("CREATE TABLE company (cik INTEGER PRIMARY KEY, n4 INTEGER, n5 INTEGER, identical INTEGER, changed INTEGER, error TEXT)")
    by_metric, by_year, by_cls = collections.defaultdict(collections.Counter), collections.defaultdict(collections.Counter), collections.Counter()
    with ProcessPoolExecutor(6) as ex:
        for i, r in enumerate(ex.map(one, ciks, chunksize=4)):
            if "error" in r:
                agg["errors"].append([r["cik"], r["error"][-300:]])
                dd.execute("INSERT INTO company VALUES (?,?,?,?,?,?)", (r["cik"], None, None, None, None, r["error"][-1000:]))
                continue
            dd.executemany("INSERT INTO diff VALUES (?,?,?,?,?,?,?,?,?,?)",
                           [(c, m, t, dt.datetime.utcfromtimestamp(t).date().isoformat(), k, a, b, cl, tr, de) for c, m, t, k, a, b, cl, tr, de in r["rows"]])
            dd.execute("INSERT INTO company VALUES (?,?,?,?,?,?)", (r["cik"], r["n4"], r["n5"], r["kinds"]["identical"],
                                                                     sum(v for k, v in r["kinds"].items() if k != "identical"), None))
            for c, m, t, k, a, b, cl, tr, de in r["rows"]:
                by_metric[m][k] += 1; by_year[dt.datetime.utcfromtimestamp(t).year][k] += 1; by_cls[(k, cl, tr)] += 1
            agg["n4"] += r["n4"]; agg["n5"] += r["n5"]
            for k in ("kinds", "classes", "truth", "gap_just"):
                agg[k].update(r[k])
            agg["H_points"] += r["H_points"]
            agg["H_signals"] += [f"{r['cik']}|{s}" for s in r["H_signals"]]
            for k, lim in (("unexplained", 200), ("wrong", 200), ("gap_unjust", 200)):
                agg[k] += [[r["cik"]] + x for x in r[k]][:max(0, lim - len(agg[k]))]
            if i % 500 == 0:
                json.dump({"done": i, "of": len(ciks), "at": time.time() - t0}, open(f"{OUT}/compare.progress.json", "w"))
    dd.commit(); dd.close()
    agg["by_metric"] = {m: dict(c) for m, c in sorted(by_metric.items())}
    agg["by_year"] = {y: dict(c) for y, c in sorted(by_year.items())}
    agg["by_kind_class_truth"] = [[k, cl, tr, n] for (k, cl, tr), n in by_cls.most_common()]
    agg["diff_db"] = DDB
    agg["elapsed_s"] = round(time.time() - t0)
    json.dump(agg, open(f"{OUT}/compare.json", "w"), indent=1, default=str)
    print(json.dumps({k: agg[k] for k in ("companies", "n4", "n5", "kinds", "classes", "truth", "gap_just", "H_points", "elapsed_s")}, default=str),
          "H_signals", len(agg["H_signals"]), "errors", len(agg["errors"]), "unexplained_listed", len(agg["unexplained"]), "wrong_listed", len(agg["wrong"]))
