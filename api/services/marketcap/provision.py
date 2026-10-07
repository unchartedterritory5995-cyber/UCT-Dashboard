"""Market Cap V1 worker PROVISIONING (owner decision 2026-10-06): the durable state the accepted refresh lifecycle reads,
moved byte-for-byte from the accepted local authority to the worker's persistent volume through the PRIVATE bucket.

    push  (where the accepted state lives; credentials from the service environment via `railway run`)
        python -m api.services.marketcap.provision push --inventory INV.json --prefix marketcap_pit/provision/<id>
    pull  (on the worker)
        python -m api.services.marketcap.provision pull --prefix marketcap_pit/provision/<id> --root /data/marketcap_v1
    verify (on the worker, any time)
        python -m api.services.marketcap.provision verify --root /data/marketcap_v1

INVENTORY = [{"src", "dst" (absolute, under the root), "purpose", "bytes", "sha256", "identity"}] -- exactly the
objects the lifecycle reads (enumerated from refresh.py, not a directory dump). `identity` BYTE: the file is the sealed
object; LEDGER: the refresh ledger, rebuilt from the accepted run's own rows (a logical identity, its rows' digest).
Every object is uploaded write-once under the prefix with its sha256, downloaded, re-hashed, SQLite files
`quick_check`ed, and installed read-only. Nothing is overwritten: an existing destination must already hold the same
bytes. The inventory itself is stored with the copy (PROVISIONED.json) so `verify` re-proves it later.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sqlite3
import stat
import sys
import tempfile


def _sha(p: str) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 22), b""):
            h.update(b)
    return h.hexdigest()


def _target():
    from .publication import R2Target
    return R2Target()


def _key(prefix: str, sha: str) -> str:
    return f"{prefix.rstrip('/')}/objects/{sha}"


def push(inventory: str, prefix: str) -> dict:
    inv = json.load(open(inventory))
    t = _target()
    up = skip = 0
    for it in inv["items"]:
        if _sha(it["src"]) != it["sha256"] or os.path.getsize(it["src"]) != it["bytes"]:
            raise SystemExit(f"source changed since the inventory: {it['src']}")
        k = _key(prefix, it["sha256"])
        if t.exists(k):
            skip += 1
            continue
        t.put_new_file(k, it["src"])
        up += 1
    body = json.dumps({k: v for k, v in inv.items()}, indent=1, sort_keys=True).encode()
    ik = f"{prefix.rstrip('/')}/inventory.json"
    if t.exists(ik):
        if t.get(ik) != body:
            raise SystemExit(f"{ik} exists with different content")
    else:
        t.put_new(ik, body)
    return {"uploaded": up, "already_present": skip, "objects": len(inv["items"]), "inventory_sha256": hashlib.sha256(body).hexdigest()}


def _quick_check(p: str) -> str:
    c = sqlite3.connect(f"file:{p}?mode=ro", uri=True)
    try:
        return c.execute("PRAGMA quick_check").fetchone()[0]
    finally:
        c.close()


def _is_sqlite(p: str) -> bool:
    with open(p, "rb") as f:
        return f.read(16) == b"SQLite format 3\x00"


def pull(prefix: str, root: str) -> dict:
    t = _target()
    inv = json.loads(t.get(f"{prefix.rstrip('/')}/inventory.json"))
    done = existing = 0
    for it in inv["items"]:
        dst = it["dst"]
        if not dst.startswith(root.rstrip("/") + "/"):
            raise SystemExit(f"destination outside the root: {dst}")
        if os.path.exists(dst):
            if _sha(dst) != it["sha256"]:
                raise SystemExit(f"destination exists with DIFFERENT bytes (refusing to overwrite): {dst}")
            existing += 1
            continue
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=os.path.dirname(dst), prefix=".prov-")
        os.close(fd)
        try:
            with t.open_read(_key(prefix, it["sha256"])) as src, open(tmp, "wb") as out:
                for b in iter(lambda: src.read(1 << 22), b""):
                    out.write(b)
            if os.path.getsize(tmp) != it["bytes"] or _sha(tmp) != it["sha256"]:
                raise SystemExit(f"downloaded bytes do not match the inventory: {dst}")
            if _is_sqlite(tmp) and _quick_check(tmp) != "ok":
                raise SystemExit(f"quick_check failed: {dst}")
            os.replace(tmp, dst)
        finally:
            if os.path.exists(tmp):
                os.remove(tmp)
        # sealed objects are read-only; the refresh's own ledger / config must stay writable (it appends runs)
        os.chmod(dst, (stat.S_IREAD | stat.S_IWRITE | stat.S_IRGRP | stat.S_IROTH) if it.get("identity") in MUTABLE
                 else (stat.S_IREAD | stat.S_IRGRP | stat.S_IROTH))
        done += 1
    rec = os.path.join(root, "PROVISIONED.json")
    body = json.dumps({"prefix": prefix, **inv}, indent=1, sort_keys=True)
    if os.path.exists(rec) and open(rec).read() != body:
        raise SystemExit("PROVISIONED.json exists with a different inventory")
    open(rec, "w").write(body)
    return {"installed": done, "already_present": existing, "objects": len(inv["items"]), **verify(root)}


MUTABLE = ("LEDGER", "CONFIG")     # installed exactly, then owned by the refresh (it appends runs to its ledger)


def verify(root: str) -> dict:
    """Every SEALED object byte-identical and quick_check ok; the ledger / config only checked to exist (they are the
    refresh's own state after installation)."""
    inv = json.load(open(os.path.join(root, "PROVISIONED.json")))
    bad, sq = [], 0
    for it in inv["items"]:
        p = it["dst"]
        if it.get("identity") in MUTABLE:
            if not os.path.exists(p):
                bad.append(p)
            continue
        if not os.path.exists(p) or os.path.getsize(p) != it["bytes"] or _sha(p) != it["sha256"]:
            bad.append(p)
        elif _is_sqlite(p):
            sq += 1
            if _quick_check(p) != "ok":
                bad.append(p + " (quick_check)")
    return {"verified": len(inv["items"]) - len(bad), "sqlite_quick_check_ok": sq, "bad": bad,
            "sealed": sum(1 for i in inv["items"] if i.get("identity") not in MUTABLE),
            "bytes": sum(i["bytes"] for i in inv["items"])}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Market Cap worker provisioning")
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("push")
    s.add_argument("--inventory", required=True)
    s.add_argument("--prefix", required=True)
    s = sub.add_parser("pull")
    s.add_argument("--prefix", required=True)
    s.add_argument("--root", required=True)
    s = sub.add_parser("verify")
    s.add_argument("--root", required=True)
    a = ap.parse_args(argv)
    if a.cmd == "push":
        r = push(a.inventory, a.prefix)
    elif a.cmd == "pull":
        r = pull(a.prefix, a.root)
    else:
        r = verify(a.root)
    print(json.dumps(r, indent=1))
    return 0 if not r.get("bad") else 2


if __name__ == "__main__":
    sys.exit(main())
