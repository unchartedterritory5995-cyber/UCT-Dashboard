"""Market Cap V1 REFERENCE / SPLIT EVIDENCE AUTHORITY (owner decision 2026-10-06, Decision 2).

The Massive reference (ticker details, split history, ticker events) is a MUTABLE historical source: since M3's pull of
2026-09-30 it changed ECL's 2003-06-09 split 1:3 -> 1:2 and dropped the records of NTRBW / GFAIW / COLAR / COLAU / COLA
(warrants / rights / units read as a second common class without them). An ordinary refresh therefore never consumes the
newest reference history: it consumes a SEALED, VERSIONED reference whose accepted historical interpretation only
changes through an explicit, human-approved REFERENCE_HISTORICAL_CORRECTION.

STORE  <root>/reference/versions/<id>/   write-once, 0444; manifest.json written last
    ref.jsonl         the complete reference (one sorted line per ticker) -- the build input, byte for byte
    divergence.json   APPEND: every upstream disagreement with accepted history (kept accepted; never applied)
    diff.json         CORRECTION: the exact proposed change
    APPROVAL.json     CORRECTION only (human, Market Cap gates PASS)

MERGE (APPEND) of a fresh pull N into the accepted parent A (as of A's pull date):
    ticker absent from A          ADDED                (a new listing / newly carried symbol)
    N has no record for it        A kept               VANISHED_UPSTREAM divergence
    details                       CURRENT-STATE fields (active, delisted_utc, cik, name, figis, exchange, share fields,
                                  market cap, currency) follow N; HISTORICAL fields (type, list_date, market, locale)
                                  keep A (a change is a divergence)
    splits / ticker events        A's are immutable; N's executed / dated AFTER A's pull date and not in A are appended;
                                  any other disagreement (changed ratio, missing, an old split newly listed) is a
                                  divergence: kept accepted, offered as a correction candidate
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import stat
import tempfile
from datetime import datetime, timezone

FORMAT = 1
KINDS = ("ROOT", "APPEND", "REFERENCE_HISTORICAL_CORRECTION")
CURRENT_FIELDS = ("active", "delisted_utc", "cik", "name", "composite_figi", "share_class_figi", "primary_exchange",
                  "share_class_shares_outstanding", "weighted_shares_outstanding", "market_cap", "currency_name", "ticker")
HISTORICAL_FIELDS = ("type", "list_date", "market", "locale")


class ReferenceAuthorityError(RuntimeError):
    pass


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def sha(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def load(path: str) -> dict:
    out = {}
    for line in open(path, encoding="utf-8"):
        r = json.loads(line)
        out[r[0]] = r
    return out


def dump(rows: dict, path: str) -> None:
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        for t in sorted(rows):
            f.write(json.dumps(rows[t]) + "\n")


def _has(r) -> bool:
    return bool(r and isinstance(r[1], dict) and any(v is not None for v in r[1].values()))


def _code() -> dict:
    import subprocess
    repo = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
    try:
        return {"commit": subprocess.run(["git", "rev-parse", "HEAD"], cwd=repo, capture_output=True, text=True).stdout.strip()}
    except Exception:  # noqa: BLE001
        return {"commit": None}


class Store:
    def __init__(self, root: str):
        self.root = os.path.join(root, "reference")
        self.vdir = os.path.join(self.root, "versions")

    def path(self, vid: str, name: str) -> str:
        if not vid or any(x in vid for x in ("/", "\\", "..")):
            raise ReferenceAuthorityError(f"bad reference version id {vid!r}")
        return os.path.join(self.vdir, vid, name)

    def exists(self, vid: str) -> bool:
        return os.path.exists(self.path(vid, "manifest.json"))

    def manifest(self, vid: str) -> dict:
        p = self.path(vid, "manifest.json")
        if not os.path.exists(p):
            raise ReferenceAuthorityError(f"reference version {vid} has no manifest")
        m = json.load(open(p))
        if m.get("format") != FORMAT or m.get("version_id") != vid or m.get("kind") not in KINDS:
            raise ReferenceAuthorityError(f"reference manifest {vid} is malformed")
        for name, s in (m.get("files") or {}).items():
            if not os.path.exists(self.path(vid, name)) or sha(self.path(vid, name)) != s:
                raise ReferenceAuthorityError(f"reference version {vid}: {name} does not match its sealed sha256")
        if m["kind"] == "REFERENCE_HISTORICAL_CORRECTION" and not os.path.exists(self.path(vid, "APPROVAL.json")):
            m["_unapproved"] = True
        return m

    def usable(self, vid: str) -> dict:
        m = self.manifest(vid)
        if m.get("_unapproved"):
            raise ReferenceAuthorityError(f"{vid} is an UNAPPROVED reference correction: never a build input")
        return m

    def write_once(self, vid: str, name: str, src: str | None = None, body: bytes | None = None) -> None:
        p = self.path(vid, name)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        if os.path.exists(p):
            raise ReferenceAuthorityError(f"write-once: {vid}/{name} exists")
        fd, tmp = tempfile.mkstemp(dir=os.path.dirname(p), prefix=".tmp-")
        os.close(fd)
        try:
            if src is not None:
                with open(src, "rb") as a, open(tmp, "wb") as b:
                    b.write(a.read())
            else:
                open(tmp, "wb").write(body)
            os.link(tmp, p)
        finally:
            os.unlink(tmp)
        os.chmod(p, stat.S_IREAD | stat.S_IRGRP | stat.S_IROTH)

    def clear_incomplete(self, vid: str) -> None:
        d = os.path.join(self.vdir, vid)
        if os.path.isdir(d) and not os.path.exists(os.path.join(d, "manifest.json")):
            for f in os.listdir(d):
                os.chmod(os.path.join(d, f), stat.S_IWRITE | stat.S_IREAD)
                os.remove(os.path.join(d, f))
            os.rmdir(d)

    def seal(self, vid: str, m: dict) -> dict:
        self.write_once(vid, "manifest.json", body=json.dumps(m, indent=1, sort_keys=True, default=str).encode())
        return m


def seal_root(store: Store, src: str, *, expect_sha256: str, as_of: str, provenance: dict) -> dict:
    s = sha(src)
    if s != expect_sha256:
        raise ReferenceAuthorityError(f"root source sha {s} != accepted {expect_sha256}: refusing an approximation")
    vid = f"REF-ROOT-{s[:16]}"
    if store.exists(vid):
        return store.manifest(vid)
    store.clear_incomplete(vid)
    store.write_once(vid, "ref.jsonl", src=src)
    rows = load(src)
    return store.seal(vid, {"format": FORMAT, "version_id": vid, "kind": "ROOT", "parent": None, "as_of": as_of,
                            "created_at": now_iso(), "files": {"ref.jsonl": s}, "tickers": len(rows),
                            "provenance": provenance, "code": _code()})


def _split_key(x) -> tuple:
    return (x[0], float(x[1]) if x[1] is not None else None, float(x[2]) if x[2] is not None else None)


def _ev_date(e) -> str:
    return str((e or {}).get("date") or "")


def merge(accepted: dict, pulled: dict, as_of: str) -> tuple[dict, dict]:
    """(merged reference, report). `as_of`: the accepted version's pull date (YYYY-MM-DD)."""
    out, rep = {}, {"added": [], "vanished_upstream": [], "current_state_updates": 0, "new_splits": [], "new_events": 0,
                    "divergences": []}
    for t in sorted(set(accepted) | set(pulled)):
        a, n = accepted.get(t), pulled.get(t)
        if a is None:
            out[t] = n
            rep["added"].append(t)
            continue
        if not _has(n):
            out[t] = a
            if _has(a):
                rep["vanished_upstream"].append(t)
            continue
        det = dict(a[1] or {})
        for k in CURRENT_FIELDS:
            if (n[1] or {}).get(k) != det.get(k):
                det[k] = (n[1] or {}).get(k)
                rep["current_state_updates"] += 1
        for k in HISTORICAL_FIELDS:
            if (n[1] or {}).get(k) != det.get(k) and _has(a):
                rep["divergences"].append({"ticker": t, "field": k, "accepted": det.get(k), "upstream": (n[1] or {}).get(k)})
        sa = [list(x) for x in (a[2] or [])]
        akeys = {_split_key(x) for x in sa}
        adates = {x[0] for x in sa}
        for x in n[2] or []:
            k_ = _split_key(x)
            if k_ in akeys:
                continue
            if x[0] and x[0] > as_of and x[0] not in adates:
                sa.append(list(x))
                rep["new_splits"].append([t] + list(x))
            else:
                rep["divergences"].append({"ticker": t, "field": "split", "accepted": [y for y in sa if y[0] == x[0]],
                                           "upstream": list(x)})
        nkeys = {_split_key(x) for x in (n[2] or [])}
        for x in a[2] or []:
            if _split_key(x) not in nkeys:
                rep["divergences"].append({"ticker": t, "field": "split_missing_upstream", "accepted": list(x)})
        ea = list(a[3] or [])
        ekeys = {json.dumps(e, sort_keys=True) for e in ea}
        for e in n[3] or []:
            j = json.dumps(e, sort_keys=True)
            if j in ekeys:
                continue
            if _ev_date(e) > as_of:
                ea.append(e)
                rep["new_events"] += 1
            else:
                rep["divergences"].append({"ticker": t, "field": "event", "upstream": e})
        out[t] = [t, det, sorted(sa, key=lambda x: (x[0] or "", str(x[1]), str(x[2]))),
                  sorted(ea, key=lambda e: (_ev_date(e), json.dumps(e, sort_keys=True)))]
    return out, rep


def append(store: Store, parent: str, pulled_path: str, *, pulled_at: str, provenance: dict | None = None) -> dict:
    pm = store.usable(parent)
    merged, rep = merge(load(store.path(parent, "ref.jsonl")), load(pulled_path), pm["as_of"])
    tmpd = tempfile.mkdtemp(dir=store.root if os.path.isdir(store.root) else None)
    try:
        rp = os.path.join(tmpd, "ref.jsonl")
        dump(merged, rp)
        s = sha(rp)
        if s == pm["files"]["ref.jsonl"]:
            return {**pm, "unchanged": True}
        vid = f"REF-APPEND-{pulled_at[:10].replace('-', '')}-{s[:12]}"
        if store.exists(vid):
            return {**store.manifest(vid), "reused": True}
        store.clear_incomplete(vid)
        store.write_once(vid, "ref.jsonl", src=rp)
        dv = json.dumps(rep["divergences"], indent=1, default=str).encode()
        store.write_once(vid, "divergence.json", body=dv)
    finally:
        import shutil
        shutil.rmtree(tmpd, ignore_errors=True)
    m = {"format": FORMAT, "version_id": vid, "kind": "APPEND", "parent": parent, "as_of": pulled_at[:10],
         "created_at": now_iso(), "files": {"ref.jsonl": s, "divergence.json": hashlib.sha256(dv).hexdigest()},
         "tickers": len(merged), "pulled_sha256": sha(pulled_path),
         "merge": {"added": len(rep["added"]), "added_tickers": rep["added"][:50],
                   "vanished_upstream": rep["vanished_upstream"][:200], "n_vanished_upstream": len(rep["vanished_upstream"]),
                   "current_state_updates": rep["current_state_updates"], "new_splits": rep["new_splits"],
                   "new_events": rep["new_events"], "divergences": len(rep["divergences"])},
         "provenance": provenance or {}, "code": _code()}
    return store.seal(vid, m)


def propose_correction(store: Store, parent: str, proposed_path: str, *, tickers: list, reason: str) -> dict:
    """A REFERENCE_HISTORICAL_CORRECTION candidate: the parent with `tickers`' records replaced by the proposed ones.
    Never a build input until approved (by a human, after its dark Market Cap impact run PASSED the gates)."""
    store.usable(parent)
    base = load(store.path(parent, "ref.jsonl"))
    prop = load(proposed_path)
    diff = []
    for t in sorted(tickers):
        if t not in prop:
            raise ReferenceAuthorityError(f"proposed reference has no record for {t}")
        diff.append({"ticker": t, "accepted": base.get(t), "proposed": prop[t]})
        base[t] = prop[t]
    tmpd = tempfile.mkdtemp()
    try:
        rp = os.path.join(tmpd, "ref.jsonl")
        dump(base, rp)
        s = sha(rp)
        vid = f"REF-CORRECTION-{s[:16]}"
        if store.exists(vid):
            return store.manifest(vid)
        store.clear_incomplete(vid)
        store.write_once(vid, "ref.jsonl", src=rp)
        db = json.dumps(diff, indent=1, default=str).encode()
        store.write_once(vid, "diff.json", body=db)
    finally:
        import shutil
        shutil.rmtree(tmpd, ignore_errors=True)
    pm = store.manifest(parent)
    return store.seal(vid, {"format": FORMAT, "version_id": vid, "kind": "REFERENCE_HISTORICAL_CORRECTION",
                            "parent": parent, "as_of": pm["as_of"], "created_at": now_iso(),
                            "files": {"ref.jsonl": s, "diff.json": hashlib.sha256(db).hexdigest()},
                            "tickers": len(base), "corrected_tickers": sorted(tickers), "reason": reason,
                            "status": "CANDIDATE", "provenance": {"proposed_sha256": sha(proposed_path)}, "code": _code()})


def approve(store: Store, vid: str, *, by: str, reason: str, market_cap_gates: str) -> dict:
    m = store.manifest(vid)
    if m["kind"] != "REFERENCE_HISTORICAL_CORRECTION":
        raise ReferenceAuthorityError("only a REFERENCE_HISTORICAL_CORRECTION is approved")
    if market_cap_gates != "PASS":
        raise ReferenceAuthorityError("a correction whose Market Cap release gates did not PASS cannot be approved")
    if not by or by.startswith("refresh:") or by.startswith("scheduler"):
        raise ReferenceAuthorityError("reference corrections are approved by a human, never by a refresh or the scheduler")
    rec = {"version_id": vid, "approved_by": by, "reason": reason, "approved_at": now_iso(), "market_cap_gates": "PASS"}
    store.write_once(vid, "APPROVAL.json", body=json.dumps(rec, indent=1).encode())
    return rec


def materialize(store: Store, vid: str, out: str, *, allow_candidate: bool = False) -> dict:
    """The exact build input of reference version `vid`. `allow_candidate`: ONLY the correction-impact driver may read
    an unapproved correction (to measure it in a dark namespace); a refresh never can."""
    m = store.manifest(vid) if allow_candidate else store.usable(vid)
    with open(store.path(vid, "ref.jsonl"), "rb") as a, open(out, "wb") as b:
        b.write(a.read())
    if sha(out) != m["files"]["ref.jsonl"]:
        raise ReferenceAuthorityError(f"materialized reference {vid} does not match its seal")
    return {"reference_version": vid, "kind": m["kind"], "parent": m.get("parent"), "as_of": m["as_of"],
            "sha256": m["files"]["ref.jsonl"], "tickers": m["tickers"]}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Market Cap reference evidence authority (operator CLI)")
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("seal-root"); s.add_argument("--root", required=True); s.add_argument("--src", required=True)
    s.add_argument("--sha256", required=True); s.add_argument("--as-of", required=True); s.add_argument("--provenance", default="{}")
    s = sub.add_parser("propose-correction"); s.add_argument("--root", required=True); s.add_argument("--parent", required=True)
    s.add_argument("--proposed", required=True); s.add_argument("--tickers", required=True); s.add_argument("--reason", required=True)
    s = sub.add_parser("approve"); s.add_argument("--root", required=True); s.add_argument("--version", required=True)
    s.add_argument("--by", required=True); s.add_argument("--reason", required=True); s.add_argument("--market-cap-gates", required=True)
    s = sub.add_parser("show"); s.add_argument("--root", required=True); s.add_argument("--version", required=True)
    a = ap.parse_args(argv)
    st = Store(a.root)
    if a.cmd == "seal-root":
        r = seal_root(st, a.src, expect_sha256=a.sha256, as_of=a.as_of, provenance=json.loads(a.provenance))
    elif a.cmd == "propose-correction":
        r = propose_correction(st, a.parent, a.proposed, tickers=a.tickers.split(","), reason=a.reason)
    elif a.cmd == "approve":
        r = approve(st, a.version, by=a.by, reason=a.reason, market_cap_gates=a.market_cap_gates)
    else:
        r = st.manifest(a.version)
    print(json.dumps(r, indent=1, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
