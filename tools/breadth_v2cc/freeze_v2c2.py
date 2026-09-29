"""Freeze the FINAL V2c2 artifact — the 09-23 procedure (validation/archive_frozen.py + a 0444 freeze
ledger), applied to v20260924f. Refuses, before touching anything, unless every precondition holds.

  1. the original's sha256 + size are exactly the validated identity; no WAL; no process holds it
  2. the mm21 explanation exists and classifies EVERY non-exact golden4 cell as a benign tie
  3. copy → *_VALIDATED_FROZEN_2026-09-29.db, 0444, hash-equal to the original
  4. gzip-6 → R2 `breadth_ohlc/archive/…NOT_FOR_CUTOVER…` (the archive prefix only, asserted), read the
     object back, check the gz sha AND decompress it and check the plain sha
  5. write the freeze ledger (0444) — nothing else. No pointer, no serving, no production write.
argv: CORRECTION_COMMIT VALIDATION_COMMIT [--dry-run]"""
import glob, gzip, hashlib, io, json, os, shutil, sqlite3, sys, time
sys.path.insert(0, "/app")

TAG = "v20260924f"
FIN = "/data/_audit/v2cc/final"
ORIG = FIN + "/breadth_v2c2div_FINAL_%s.db" % TAG
FROZEN = FIN + "/breadth_v2c2div_FINAL_%s_VALIDATED_FROZEN_2026-09-29.db" % TAG
SHA, BYTES = "5670fdc0d3deeb9ed1d7eb13da794457d395d3ad007255a8a685769aeefb904e", 88072192
VAL = "/data/_audit/validation/v2c_final"
EXPLAIN = VAL + "/mismatch21/mm21_explain_%s.json" % TAG
LEDGER_OUT = "/data/_audit/validation/v2c2_freeze_ledger_2026-09-29.json"
CORR_COMMIT, VAL_COMMIT = sys.argv[1], sys.argv[2]
DRY = "--dry-run" in sys.argv


def sha(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def holders(p):
    rp, out = os.path.realpath(p), []
    for fd in glob.glob("/proc/[0-9]*/fd/*"):
        try:
            if os.path.realpath(fd) == rp:
                out.append(fd.split("/")[2])
        except OSError:
            pass
    return sorted(set(out))


def refuse(msg):
    print(json.dumps({"REFUSED": msg}))
    sys.exit(2)


# ── 1. identity ───────────────────────────────────────────────────────────────
s0, n0 = sha(ORIG), os.path.getsize(ORIG)
if (s0, n0) != (SHA, BYTES):
    refuse("original changed: %s %d" % (s0, n0))
wal = ORIG + "-wal"
if os.path.exists(wal) and os.path.getsize(wal):
    refuse("non-empty WAL")
if holders(ORIG):
    refuse("artifact held open by pids %s" % holders(ORIG))
lock = FIN + "/v2c2_final.lock"
if os.path.exists(lock):
    pid = open(lock).read().strip()
    if pid and os.path.exists("/proc/%s" % pid) and "final_grind" in open("/proc/%s/cmdline" % pid, "rb").read().decode(errors="replace"):
        refuse("final grind pid %s alive" % pid)
if os.path.exists(FROZEN) or os.path.exists(LEDGER_OUT):
    refuse("frozen copy or ledger already exists")

# ── 2. every non-exact oracle cell explained ─────────────────────────────────
ex = json.load(open(EXPLAIN))
cls = ex["summary"]["classes"]
if ex["summary"]["cells"] != 21 or cls != {"EXPLAINED — NUMERIC/EMA TIE": 21}:
    refuse("mismatch explanation not clean: %s" % cls)

c = sqlite3.connect("file:%s?mode=ro&immutable=1" % ORIG, uri=True)
q = lambda s, *a: c.execute(s, a).fetchall()
integrity = q("PRAGMA integrity_check")[0][0]
ck = dict(q("SELECT status, COUNT(*) FROM pass_checkpoint GROUP BY status"))
rows = q("SELECT COUNT(*) FROM breadth_daily_ohlc")[0][0]
by_u = dict(q("SELECT universe, COUNT(*) FROM breadth_daily_ohlc GROUP BY universe"))
by_src = dict(q("SELECT source, COUNT(*) FROM breadth_daily_ohlc GROUP BY source"))
rng = {u: list(q("SELECT MIN(date), MAX(date) FROM breadth_daily_ohlc WHERE universe=?", u)[0]) for u in by_u}
dmin, dmax = q("SELECT MIN(date), MAX(date) FROM breadth_daily_ohlc")[0]
meta = dict(q("SELECT key, value FROM pass_meta"))
c.close()
if integrity != "ok" or ck != {"done": 4712, "missing_source": 175} or rows != 611018 or dmax != "2026-09-24":
    refuse("census moved: %s %s %s %s" % (integrity, ck, rows, dmax))
if DRY:
    print(json.dumps({"DRY_RUN_OK": True, "sha": s0, "bytes": n0, "checkpoints": ck, "rows": rows, "range": [dmin, dmax]}))
    sys.exit(0)

# ── 3. frozen copy ───────────────────────────────────────────────────────────
shutil.copyfile(ORIG, FROZEN)
os.chmod(FROZEN, 0o444)
fz = sha(FROZEN)
if fz != SHA:
    refuse("frozen copy hash %s != %s" % (fz, SHA))

# ── 4. R2 archive (the 09-23 archive_frozen.py, same client, same prefix) ─────
from api.services import breadth_ohlc_sync as bos
cl, bk = bos._client(), bos._bucket()
assert cl and bk, "no R2 creds"
TS = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
KEY = ("breadth_ohlc/archive/breadth_v2c2div_FINAL_%s_VALIDATED_FROZEN_NOT_FOR_CUTOVER_"
       "2008-01-02_2026-09-24_2026-09-29_%s.db.gz" % (TAG, TS))
assert KEY.startswith("breadth_ohlc/archive/") and "NOT_FOR_CUTOVER" in KEY, KEY
GZ = "/tmp/v2c2_frozen.db.gz"
with open(FROZEN, "rb") as fi, gzip.open(GZ, "wb", compresslevel=6) as fo:
    shutil.copyfileobj(fi, fo, 1 << 20)
gz_bytes, gz_sha = os.path.getsize(GZ), sha(GZ)
with open(GZ, "rb") as f:
    put = cl.put_object(Bucket=bk, Key=KEY, Body=f)
head = cl.head_object(Bucket=bk, Key=KEY)
r = cl.get_object(Bucket=bk, Key=KEY)
blob = r["Body"].read()
rb_sha, rb_n = hashlib.sha256(blob).hexdigest(), len(blob)
plain = gzip.decompress(blob)
rb_plain_sha, rb_plain_n = hashlib.sha256(plain).hexdigest(), len(plain)
del blob, plain
os.remove(GZ)
verified = rb_sha == gz_sha and rb_n == gz_bytes and rb_plain_sha == SHA and rb_plain_n == BYTES
if not verified:
    refuse("R2 read-back mismatch: %s %d %s %d" % (rb_sha, rb_n, rb_plain_sha, rb_plain_n))


# ── 5. ledger ────────────────────────────────────────────────────────────────
def ev(p, pick=None):
    d = json.load(open(p))
    return {"path": p, "sha256": sha(p), **({"result": pick(d)} if pick else {})}


LEDG = json.load(open(FIN + "/LEDGER_%s.json" % TAG))
g4 = sorted(glob.glob(VAL + "/out/golden4_final_%s_c*.json" % TAG))
tot = {"sessions": 0, "cells": 0, "exact": 0, "mismatch": 0, "bucket_agreement": 0, "withheld_agreement": 0, "universe_sessions": 0}
for p in g4:
    s = json.load(open(p))["summary"]
    for k in ("sessions", "cells", "bucket_agreement", "withheld_agreement", "universe_sessions"):
        tot[k] += s[k]
    tot["exact"] += s["classes"].get("exact", 0)
    tot["mismatch"] += sum(v for k, v in s["classes"].items() if k != "exact")
L = {
    "record": "Breadth V2c2 (dividend basis) FINAL v20260924f — validated, frozen, archived. NOT FOR CUTOVER.",
    "recorded_at_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    "ARTIFACT_ENDS": "2026-09-24 — the frozen historical artifact ends at 2026-09-24 (last session).",
    "LIVE_HANDOFF_REQUIREMENT": (
        "The eventual cutover design MUST define how authoritative Breadth continues from 2026-09-25 onward. "
        "Live sessions must never overwrite or silently mutate frozen historical V2c2 values. The known live-store "
        "incident (self-heal recompute sessions 04-06, 05-26, 06-22..07-24; collapsed Aug 12-20 + 09-02) and the "
        "PIT-ledger-rejected sessions (2026-03-24, 2026-08-31, 2026-09-23) must be addressed explicitly in cutover design."),
    "CUTOVER_REVIEW_ITEMS": [
        "universe membership is re-resolved on every run/leg (methodology unchanged here; review at cutover)",
        "merge + serving must carry intraday_recon_1m_body (14,536 rows): master's _TRUSTED_SOURCES lacks it; "
        "local merge design breadth/v2c2-merge-design 34ad18e20 includes it (unpushed)",
        "live-data handoff from 2026-09-25 (above)",
        "V1 vs V2 shadow comparison, serving/API switch, rollback plan, production acceptance"],
    "PRODUCTION": "PRODUCTION UNTOUCHED / NO POINTER CHANGED / NO MERGE / NO SERVING CHANGE / NO CUTOVER",
    "artifact": {
        "original": {"path": ORIG, "bytes": n0, "sha256": s0, "mtime_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(os.path.getmtime(ORIG)))},
        "frozen": {"path": FROZEN, "bytes": os.path.getsize(FROZEN), "sha256": fz, "mode": oct(os.stat(FROZEN).st_mode & 0o777),
                   "hash_equal_to_original": fz == s0},
        "integrity_check": integrity, "checkpoints": ck, "sessions_done": ck.get("done"), "missing_source": ck.get("missing_source"),
        "failed": ck.get("failed", 0), "rows": rows, "by_universe": by_u, "by_source": by_src, "date_range": [dmin, dmax],
        "universe_ranges": rng},
    "run_identity": {
        "tag": TAG, "methodology": meta.get("methodology"), "dividend_basis": LEDG["pins"]["dividend_basis_version"],
        "guard_version": meta.get("guard_version"), "identity_rule": meta.get("identity_rule"),
        "canonical_uct_start": LEDG["pins"]["canonical_uct_start"], "path_rule": meta.get("path_rule"),
        "ema": meta.get("ema"), "price_basis": meta.get("price_basis"),
        "settings_pins_commit": LEDG["pins"]["pinned_at_commit"], "modules_md5_lf": LEDG["pins"]["modules_md5_lf"],
        "registries": LEDG["pins"]["registries"], "input_manifest_sha256": LEDG["manifest_sha256"],
        "pit_ledger_sha256": meta.get("launch_pit_ledger_sha256"), "dividend_input_key": meta.get("dividend_input_key"),
        "guard_input_key": meta.get("guard_input_key"), "grouped_dir": meta.get("grouped_dir"),
        "grouped_vintage_window": meta.get("grouped_vintage_window"), "artifact_pass_meta_code_commit": meta.get("code_commit"),
        "legs": {k: meta[k] for k in sorted(meta) if k.startswith("leg")}},
    "code": {
        "correction_branch": "breadth/v2c-correction", "correction_commit": CORR_COMMIT,
        "validation_branch": "breadth/v2c-validation", "validation_commit": VAL_COMMIT,
        "oracle_ran_at": "6e13c7eff (golden4); mismatch explanation tools mm21_* added on top",
        "runner_code_dirs": {"correction": LEDG["code_md5_dir"]}},
    "repair": {"what": "2016-08-24 transient S3 failure + 9 ratio-dependent sessions (08-25..09-07) re-run by --resume on 2026-09-28",
               "acceptance": ev("/data/_audit/v2cc/repair_v20260924f/08_repair_acceptance.json",
                                lambda d: {"problems": d["problems"], "changed_outside_closure_ohlc": d["changed_outside_closure_ohlc"],
                                           "changed_checkpoint": d["changed_checkpoint"]})},
    "validation": {
        "census": ev(VAL + "/out/v2c2_census_20260928T124647Z.json",
                     lambda d: {"integrity": d["integrity_check"], "checkpoints": d["checkpoints"], "rows": d["rows"],
                                "invariant_violations": d["invariant_violations"]}),
        "guard_oracle": ev(VAL + "/out/guard_oracle_v20260924f.json",
                           lambda d: {"boundaries_identical_to_correction_table": d["boundaries_identical_to_correction_table"]}),
        "dividend_oracle": ev(VAL + "/out/dividend_oracle_v20260924f.json",
                              lambda d: {"identical_to_correction_applied": d["identical_to_correction_applied"],
                                         "identical_to_correction_withheld": d["identical_to_correction_withheld"],
                                         "applied_events": d["applied_events"], "withheld_events": d["withheld_events"]}),
        "calendar_geometry": ev(VAL + "/out/calendar_geometry_final_v20260924f.json",
                                lambda d: {"missing_source": d["phase3_summary"]["missing_source"],
                                           "all_are_rule_holidays": d["phase3_summary"]["all_are_rule_holidays"],
                                           "rule_early_closes_not_flagged": d["rule_early_closes_not_flagged"],
                                           "flagged_early_not_rule": d["flagged_early_not_rule"]}),
        "uct_pit": ev("/data/_audit/v2cc/repair_v20260924f/13_uct_check.json",
                      lambda d: {"artifact_uct_sessions": d["artifact_uct_sessions"], "artifact_equals_ledger": d["artifact_equals_ledger"],
                                 "rows_on_rejected": d["rows_on_rejected"], "rows_before_live_from": d["rows_before_live_from"]})},
    "independent_oracle": {
        "tool": "golden4 (oracle3, breadth/v2c-validation)", "chunks": [ev(p) for p in g4], "totals": tot,
        "mismatch_explanation": ev(EXPLAIN, lambda d: d["summary"]),
        "classification": "all 21 non-exact cells EXPLAINED — NUMERIC/EMA TIE (see mismatch_explanation)"},
    "r2": {"bucket": bk, "key": KEY, "compression": "gzip level 6", "gz_bytes": gz_bytes, "gz_sha256": gz_sha,
           "etag": head.get("ETag"), "version_id": head.get("VersionId") or put.get("VersionId"),
           "readback_gz_sha256": rb_sha, "readback_uncompressed_sha256": rb_plain_sha,
           "readback_uncompressed_bytes": rb_plain_n, "readback_verified": verified,
           "archived_at_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())},
    "current_sha_recheck": {"original": sha(ORIG), "frozen": sha(FROZEN)},
}
with open(LEDGER_OUT, "x") as f:
    json.dump(L, f, indent=1, ensure_ascii=False)
os.chmod(LEDGER_OUT, 0o444)
print(json.dumps({"ledger": LEDGER_OUT, "ledger_sha256": sha(LEDGER_OUT), "frozen": FROZEN, "sha256": fz,
                  "r2_key": KEY, "etag": L["r2"]["etag"], "version_id": L["r2"]["version_id"], "gz_sha256": gz_sha,
                  "readback_verified": verified, "recheck": L["current_sha_recheck"]}, indent=1))
