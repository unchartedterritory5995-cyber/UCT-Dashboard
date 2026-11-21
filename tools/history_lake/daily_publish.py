"""Step 5 of the deep daily rebuild (2026-11-18): publish the checked series the servers serve.

Uploads one gzipped series per ticker on the serve list to the bars bucket under `daily-rebuild/v<N>/`, then
the manifest LAST (the servers read only what the manifest names, so a half-finished upload is never served):

    daily-rebuild/v<N>/<SYM>.json.gz   {"sym", "end", "bars": [[ISO, o, h, l, c, v], ...]}
    daily-rebuild/manifest.json        {"version": N, "end": ISO, "built_at": ..., "symbols": [...]}

The serve list (`D:/uct-history/daily-v1/serve_list.json`) is every ticker whose rebuild agrees with an
independent vendor at least as well as the served series, changes a bar, and loses no more than a year of
depth (daily_check.py). `--stage test` names only `--test` in the manifest (the rest are uploaded, not served):
the rollout widens by publishing the manifest again, with no deploy.

  python tools/history_lake/daily_publish.py --version 1 --stage test --test ASB,BCPC,MNST,BALL
  python tools/history_lake/daily_publish.py --version 1 --stage all
Republish corrected series for symbols already listed (their served history_rev rises, nobody else's moves):
  python tools/history_lake/daily_publish.py --version <live+1> --stage all --expect-moved ONB,TMP --dry
  python tools/history_lake/daily_publish.py --version <live+1> --stage all --expect-moved ONB,TMP
A same-version re-upload cannot do it: the epoch (rev x 1e7) would not rise, and a pod never re-fetches a v<rev> file
it already holds.
Credentials: DATA_SYNC_* in the environment (the same as the history lake publish).
"""
from __future__ import annotations

import argparse
import gzip
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from tools.history_lake.publish import s3_client_from_env  # noqa: E402

PREFIX = "daily-rebuild/"


def payload_body(rec: dict) -> bytes:
    bars = rec["bars"]
    body = {"sym": rec["sym"], "end": bars[-1][0] if bars else None, "bars": bars}
    return json.dumps(body, separators=(",", ":")).encode("utf-8")


def payload(rec: dict) -> bytes:
    return gzip.compress(payload_body(rec), 6)


def plan(prev: dict | None, version: int, names, hashes: dict) -> dict:
    """revs / retired / hashes for a manifest (U5): a ticker whose series bytes equal the previous manifest's keeps its
    rev (its file stays at v<rev>, its epoch does not move); new, re-listed, changed and newly retired tickers get
    `version`. Versions only rise. Derived from the previous manifest, never typed."""
    prev = prev or {}
    pv = int(prev.get("version") or 0)
    if version <= pv:
        raise SystemExit(f"refused: version {version} is not above the published v{pv} (versions only rise)")
    names = sorted({str(s).upper() for s in names})
    p_syms = {str(s).upper() for s in (prev.get("symbols") or ())}
    p_ret = {str(s).upper() for s in (prev.get("retired") or ())}
    p_revs = {str(k).upper(): int(v) for k, v in (prev.get("revs") or {}).items()}
    p_hash = prev.get("hashes") or {}
    retired = sorted((p_syms | p_ret) - set(names))
    revs = {}
    for s in names:
        same = s in p_syms and hashes.get(s) is not None and hashes.get(s) == p_hash.get(s)
        revs[s] = int(p_revs.get(s) or pv) if same else version
    for s in retired:
        revs[s] = int(p_revs.get(s) or pv) if s in p_ret else version
    return {"symbols": names, "retired": retired, "revs": revs, "hashes": {s: hashes[s] for s in names if s in hashes}}


def read_manifest(client, bucket):
    """The published manifest, or None when there is none yet. ⛔ ONLY a missing key means "first publish": any other
    error raises. Read as "first", a transient error would plan every symbol as new and forget the retired list (whose
    terms would then fall to 0, and browsers would keep the old copies)."""
    try:
        return json.loads(client.get_object(Bucket=bucket, Key=f"{PREFIX}manifest.json")["Body"].read())
    except Exception as e:  # noqa: BLE001
        if "NoSuchKey" in type(e).__name__ or "NoSuchKey" in str(e) or "404" in str(e) or "Not Found" in str(e):
            return None
        raise


def published_hashes(prev: dict | None, client, bucket, names) -> tuple[dict, list]:
    """(hashes, failed): sha256 of the PUBLISHED payload body of every symbol `names` shares with the previous manifest
    whose hash that manifest does not carry (v1 predates `hashes`, U5c). The body is the bytes `payload_body` produces,
    so an unchanged series hashes identically (measured on ASB BCPC MNST BALL FDX 2026-11-21) and keeps its rev."""
    import hashlib
    prev = prev or {}
    pv = int(prev.get("version") or 0)
    p_syms = {str(s).upper() for s in (prev.get("symbols") or ())}
    p_hash = {str(k).upper() for k in (prev.get("hashes") or {})}
    p_revs = {str(k).upper(): int(v) for k, v in (prev.get("revs") or {}).items()}
    got, failed = {}, []
    for s in sorted((p_syms & {str(n).upper() for n in names}) - p_hash):
        try:
            body = client.get_object(Bucket=bucket, Key=f"{PREFIX}v{int(p_revs.get(s) or pv)}/{s}.json.gz")["Body"].read()
            try:
                body = gzip.decompress(body)
            except OSError:
                pass                                          # a client that already decoded ContentEncoding: gzip
            got[s] = hashlib.sha256(body).hexdigest()
        except Exception:  # noqa: BLE001 - reported; a real publish refuses
            failed.append(s)
    return got, failed


def moved(prev: dict | None, p: dict, version: int) -> dict:
    """Exactly which symbols this publish gives a new rev (their history_rev rises), by reason."""
    prev = prev or {}
    p_syms = {str(s).upper() for s in (prev.get("symbols") or ())}
    p_ret = {str(s).upper() for s in (prev.get("retired") or ())}
    new = sorted(s for s, r in p["revs"].items() if r == version)
    listed = set(p["symbols"])
    return {"new_rev": len(new), "kept": len(p["revs"]) - len(new),
            "changed": [s for s in new if s in listed and s in p_syms],
            "added": [s for s in new if s in listed and s not in p_syms and s not in p_ret],
            "relisted": [s for s in new if s in listed and s in p_ret],
            "retired_now": [s for s in new if s not in listed]}


def bar_diff(old_bars: list | None, new_bars: list) -> dict:
    """What a republish changes in one series: bars by date, published vs local."""
    old = {b[0]: b for b in (old_bars or ())}
    new = {b[0]: b for b in new_bars}
    changed = sorted(d for d in new if d in old and old[d] != new[d])
    worst = 0.0
    for d in changed:
        if old[d][4] and new[d][4]:
            worst = max(worst, abs(new[d][4] / old[d][4] - 1))       # relative to what members were served
    return {"published": len(old), "local": len(new), "changed": len(changed),
            "added": len(set(new) - set(old)), "removed": len(set(old) - set(new)),
            "first": changed[0] if changed else None, "last": changed[-1] if changed else None,
            "max_close_change": round(worst, 6)}


def mover_detail(prev: dict | None, p: dict, version: int, report: dict, recs: dict, client, bucket) -> dict:
    """Per listed symbol this publish gives a new rev: its old and new rev (history_rev epoch = rev x 1e7) and what
    changes in its bars against the PUBLISHED payload (read from the bucket, the bytes the pods hold)."""
    prev = prev or {}
    pv = int(prev.get("version") or 0)
    p_revs = {str(k).upper(): int(v) for k, v in (prev.get("revs") or {}).items()}
    p_syms = {str(s).upper() for s in (prev.get("symbols") or ())}
    out = {}
    for s in sorted(set(report["changed"]) | set(report["added"]) | set(report["relisted"])):
        old_rev = int(p_revs.get(s) or pv) if s in p_syms else None
        old_bars = None
        if old_rev is not None:
            try:
                body = client.get_object(Bucket=bucket, Key=f"{PREFIX}v{old_rev}/{s}.json.gz")["Body"].read()
                try:
                    body = gzip.decompress(body)
                except OSError:
                    pass                                      # a client that already decoded ContentEncoding: gzip
                old_bars = json.loads(body)["bars"]
            except Exception:  # noqa: BLE001 - named, never guessed (a real publish refuses: hash_unreadable)
                out[s] = {"old_rev": old_rev, "new_rev": p["revs"][s], "bars": None, "published_unreadable": True}
                print(f"  {s} rev {old_rev} -> {p['revs'][s]} | published payload UNREADABLE", flush=True)
                continue
        out[s] = {"old_rev": old_rev, "new_rev": p["revs"][s], "bars": bar_diff(old_bars, recs[s]["bars"])}
        b = out[s]["bars"]
        print(f"  {s} rev {old_rev if old_rev is not None else '-'} -> {p['revs'][s]} | bars published {b['published']} "
              f"local {b['local']}: changed {b['changed']} ({b['first']}..{b['last']}), added {b['added']}, "
              f"removed {b['removed']}, max |close change| {b['max_close_change']:.4%}", flush=True)
    return out


def main(argv=None, client=None, bucket=None):
    import os
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default="D:/uct-history")
    ap.add_argument("--version", type=int, required=True)
    ap.add_argument("--stage", choices=("test", "all"), required=True)
    ap.add_argument("--test", default="")
    ap.add_argument("--skip-upload", action="store_true", help="manifest only (the series are already up)")
    ap.add_argument("--dry", action="store_true", help="print exactly which symbols get a new rev; write nothing")
    ap.add_argument("--allow-retire", default="", help="EXACTLY the symbols this publish may retire (comma list)")
    ap.add_argument("--expect-moved", default=None,
                    help="EXACTLY the listed symbols this publish may give a new rev (changed, added or re-listed; "
                         "comma list): refused unless the plan moves exactly these")
    a = ap.parse_args(argv)
    root = Path(a.root) / "daily-v1"
    serve = json.loads((root / "serve_list.json").read_text(encoding="utf-8"))
    if client is None:
        bucket = os.environ["DATA_SYNC_BUCKET"]
        client = s3_client_from_env()
    s3 = client
    import hashlib
    vp = f"{PREFIX}v{a.version}/"
    prev = read_manifest(s3, bucket)
    names = serve if a.stage == "all" else [s for s in a.test.split(",") if s in serve]
    recs = {sym: json.loads((root / "joined" / f"{sym}.json").read_text(encoding="utf-8")) for sym in serve}
    hashes = {sym: hashlib.sha256(payload_body(recs[sym])).hexdigest() for sym in names}
    # ⭐ U5c: a previous manifest without `hashes` (the live v1) would make every symbol read as changed and re-epoch all
    # of them; derive the missing hashes from what was PUBLISHED. A symbol that cannot be read is refused, never
    # silently re-epoched.
    derived, failed = published_hashes(prev, s3, bucket, names)
    if derived:
        prev = {**prev, "hashes": {**derived, **(prev.get("hashes") or {})}}
    p = plan(prev, a.version, names, hashes)
    report = {**moved(prev, p, a.version), "hash_derived": len(derived), "hash_unreadable": failed}
    # ⛔ FAIL CLOSED ON RETIREMENT (2026-11-21): a symbol the previous manifest served and this one does not
    # leaves rebuild serving (back to the stored series, its history_rev re-epoched). The live dry run that day
    # found a serve list 15 symbols behind the live manifest: a v2 from it would have retired them silently.
    # Refused unless --allow-retire names EXACTLY those symbols (the revert drill names its own).
    allowed = {x.strip().upper() for x in (a.allow_retire or "").split(",") if x.strip()}
    retiring = set(report["retired_now"])
    report["retire_refused"] = None if retiring == allowed else (
        f"refused: this plan retires {sorted(retiring)} but --allow-retire names {sorted(allowed)} "
        "(they must match exactly)")
    # ⛔ FAIL CLOSED ON WHAT MOVES (2026-11-21): republishing a corrected series for a symbol the manifest already
    # serves (TMP, ONB pre-floor fixes) must raise THAT symbol's history_rev and no other. Any other joined/ file that
    # drifted from its published bytes would be re-epoched and published with it; the dry run shows it, this refuses it.
    report["moved_refused"] = None
    if a.expect_moved is not None:
        want = {x.strip().upper() for x in a.expect_moved.split(",") if x.strip()}
        moving = set(report["changed"]) | set(report["added"]) | set(report["relisted"])
        if moving != want:
            report["moved_refused"] = (f"refused: this plan moves {sorted(moving)} but --expect-moved names "
                                       f"{sorted(want)} (they must match exactly)")
    print("plan", json.dumps(report), flush=True)
    report["detail"] = mover_detail(prev, p, a.version, report, recs, s3, bucket)
    if a.dry:
        return report
    if report["retire_refused"]:
        raise SystemExit(report["retire_refused"])
    if report["moved_refused"]:
        raise SystemExit(report["moved_refused"])
    if failed:
        raise SystemExit(f"refused: the published payload of {len(failed)} listed symbols could not be read "
                         f"({failed[:8]}); they would re-epoch. Re-run, or retire them deliberately.")
    end = None
    t0 = time.time()
    for k, sym in enumerate(serve):
        rec = recs[sym]
        if rec["bars"]:
            end = max(end or "", rec["bars"][-1][0])
        # Only a ticker whose rev is this version uploads: an unchanged one is already at v<rev>.
        if not a.skip_upload and p["revs"].get(sym) == a.version:
            s3.put_object(Bucket=bucket, Key=f"{vp}{sym}.json.gz", Body=payload(rec),
                          ContentType="application/json", ContentEncoding="gzip")
        if k % 100 == 0:
            print(f"{k}/{len(serve)} {sym} {time.time() - t0:.0f}s", flush=True)
    manifest = {"version": a.version, "end": end, "built_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "stage": a.stage, **p}
    s3.put_object(Bucket=bucket, Key=f"{PREFIX}manifest.json", Body=json.dumps(manifest).encode("utf-8"),
                  ContentType="application/json", CacheControl="no-store")
    print("manifest", {k: (v if k not in ("symbols", "revs", "hashes", "retired") else len(v)) for k, v in manifest.items()},
          "serving", names[:12])
    return report


if __name__ == "__main__":
    main()
    sys.exit(0)
