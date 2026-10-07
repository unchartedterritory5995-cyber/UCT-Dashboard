"""Market Cap V1 SEC FILING-METADATA AUTHORITY (owner decision 2026-10-06, Decision 3).

SEC filing metadata is PIT-CRITICAL: a filing's acceptance instant decides the first 16:00 ET close its evidence may
set. It is also MUTABLE upstream. MEASURED 2026-10-06: the SEC's submissions data (nightly bulk AND data.sec.gov)
re-served historical `acceptanceDateTime` values shifted by the Eastern offset (+5 h EST / +4 h EDT):
0001171843-26-000276 (ALP 424B5) is 14:03:41Z in the 2026-09-26 bulk and 19:03:41Z in the 2026-10-06 bulk; its EDGAR
record (ACCEPTANCE-DATETIME 20260115090341, Eastern) = 14:03:41Z -- the ACCEPTED value is the true one. Read through the
CONSERVATIVE rule the shifted value moved ALP / SDEV evidence one session later. So an ordinary refresh never consumes
newly fetched metadata for an accession it already accepted.

STORE  <root>/sec/versions/<id>/   write-once, 0444; manifest.json written last
    filings.jsonl.gz       inputs.db filing rows       (ROOT: all accepted; APPEND: the NEW (cik, accn) rows only)
    pred_filings.jsonl.gz  pred_inputs.db filing rows  (same)
    acceptance.jsonl.gz    acceptance-authority rows   (same, by accession)
    divergence.json        APPEND: every accepted row the fresh fetch disagrees with (kept accepted, never applied)
filing row = [cik, accn, form, filing_date, report_date, accepted, public_at, primary_doc, is_xbrl, is_ixbrl]
acceptance row = [accn, accepted, source, evidence]. Identity = sha256 over the decompressed sorted lines.

APPLY (each refresh) onto the run's freshly assembled inputs.db / pred_inputs.db / acceptance.db:
    accepted (cik, accn)          its SEALED row replaces the fetched one   (a difference = SEC_METADATA_DIVERGENCE)
    accepted, not fetched         the sealed row is kept                    (VANISHED_UPSTREAM divergence)
    new (cik, accn)               appended; its acceptance instant from the EDGAR record (ACCEPTANCE-DATETIME,
                                  Eastern) when fetchable, else the existing CONSERVATIVE rule (late, never early)
A change to accepted metadata is a SEC_METADATA_CORRECTION: candidate + impact + gates + HUMAN approval.
The build reads sec_metadata.json: this identity and the post-root accessions (the current ADR parser reads only
those; accepted accessions keep their accepted reading).
"""
from __future__ import annotations

import gzip
import hashlib
import json
import os
import re
import shutil
import sqlite3
import stat
import tempfile
from datetime import datetime, timezone

FORMAT = 1
KINDS = ("ROOT", "APPEND", "SEC_METADATA_CORRECTION")
FIELDS = ("cik", "accn", "form", "filing_date", "report_date", "accepted", "public_at", "primary_doc", "is_xbrl", "is_ixbrl")
PIT_FIELDS = ("form", "filing_date", "report_date", "accepted", "public_at")
SOURCES = (("filings.jsonl.gz", "inputs.db"), ("pred_filings.jsonl.gz", "pred_inputs.db"))


class SecAuthorityError(RuntimeError):
    pass


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _lines_sha(lines: list[str]) -> str:
    h = hashlib.sha256()
    for ln in lines:
        h.update(ln.encode())
        h.update(b"\n")
    return h.hexdigest()


def _identity(files: dict) -> str:
    return hashlib.sha256("".join(n + _lines_sha(files[n]) for n in sorted(files)).encode()).hexdigest()


def _dump_gz(lines: list[str], path: str) -> str:
    with open(path, "wb") as raw, gzip.GzipFile(fileobj=raw, mode="wb", mtime=0, compresslevel=6) as f:
        for ln in lines:
            f.write(ln.encode() + b"\n")
    return _lines_sha(lines)


def _read_gz(path: str) -> list[str]:
    with gzip.open(path, "rt", encoding="utf-8") as f:
        return [ln.rstrip("\n") for ln in f]


def _code() -> dict:
    import subprocess
    repo = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
    try:
        return {"commit": subprocess.run(["git", "rev-parse", "HEAD"], cwd=repo, capture_output=True, text=True).stdout.strip()}
    except Exception:  # noqa: BLE001
        return {"commit": None}


class Store:
    def __init__(self, root: str):
        self.root = os.path.join(root, "sec")
        self.vdir = os.path.join(self.root, "versions")
        self.headers = os.path.join(self.root, "edgar_headers")      # persistent EDGAR-record cache (<accn>.txt)

    def path(self, vid: str, name: str) -> str:
        if not vid or any(x in vid for x in ("/", "\\", "..")):
            raise SecAuthorityError(f"bad SEC metadata version id {vid!r}")
        return os.path.join(self.vdir, vid, name)

    def exists(self, vid: str) -> bool:
        return os.path.exists(self.path(vid, "manifest.json"))

    def manifest(self, vid: str, verify: bool = True) -> dict:
        p = self.path(vid, "manifest.json")
        if not os.path.exists(p):
            raise SecAuthorityError(f"SEC metadata version {vid} has no manifest")
        m = json.load(open(p))
        if m.get("format") != FORMAT or m.get("version_id") != vid or m.get("kind") not in KINDS:
            raise SecAuthorityError(f"SEC metadata manifest {vid} is malformed")
        if verify:
            for name, s in (m.get("content_sha256") or {}).items():
                if _lines_sha(_read_gz(self.path(vid, name))) != s:
                    raise SecAuthorityError(f"SEC metadata version {vid}: {name} does not match its sealed content")
        if m["kind"] == "SEC_METADATA_CORRECTION" and not os.path.exists(self.path(vid, "APPROVAL.json")):
            m["_unapproved"] = True
        return m

    def write_once(self, vid: str, name: str, src: str | None = None, body: bytes | None = None) -> None:
        p = self.path(vid, name)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        if os.path.exists(p):
            raise SecAuthorityError(f"write-once: {vid}/{name} exists")
        fd, tmp = tempfile.mkstemp(dir=os.path.dirname(p), prefix=".tmp-")
        os.close(fd)
        try:
            if src is not None:
                shutil.copyfile(src, tmp)
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


def _write_version(store: Store, vid: str, files: dict) -> dict:
    store.clear_incomplete(vid)
    tmpd = tempfile.mkdtemp()
    out = {}
    try:
        for name, lines in files.items():
            out[name] = _dump_gz(lines, os.path.join(tmpd, name))
            store.write_once(vid, name, src=os.path.join(tmpd, name))
    finally:
        shutil.rmtree(tmpd, ignore_errors=True)
    return out


def _filing_lines(db: sqlite3.Connection) -> list[str]:
    return sorted(json.dumps(list(r)) for r in db.execute(f"SELECT {','.join(FIELDS)} FROM filing"))


def _acc_lines(db: sqlite3.Connection) -> list[str]:
    return sorted(json.dumps(list(r)) for r in db.execute("SELECT accn, accepted, source, evidence FROM acceptance"))


def seal_root(store: Store, data_dir: str, *, as_of: str, provenance: dict) -> dict:
    """ROOT = the accepted authority's own filing metadata (its inputs.db, pred_inputs.db, acceptance.db)."""
    files = {}
    for name, dbn in SOURCES:
        p = os.path.join(data_dir, dbn)
        if os.path.exists(p):
            c = sqlite3.connect(f"file:{p}?mode=ro", uri=True)
            files[name] = _filing_lines(c)
            c.close()
    a = sqlite3.connect(f"file:{os.path.join(data_dir, 'acceptance.db')}?mode=ro", uri=True)
    files["acceptance.jsonl.gz"] = _acc_lines(a)
    a.close()
    vid = f"SEC-ROOT-{_identity(files)[:16]}"
    if store.exists(vid):
        return store.manifest(vid, verify=False)
    shas = _write_version(store, vid, files)
    return store.seal(vid, {"format": FORMAT, "version_id": vid, "kind": "ROOT", "parent": None, "as_of": as_of,
                            "created_at": now_iso(), "content_sha256": shas,
                            "rows": {n: len(v) for n, v in files.items()}, "provenance": provenance, "code": _code()})


def lineage(store: Store, vid: str) -> list[str]:
    out = []
    while vid:
        out.append(vid)
        vid = store.manifest(vid, verify=False).get("parent")
    return out[::-1]


def resolved(store: Store, vid: str) -> tuple[dict, dict, set]:
    """({file name: {(cik, accn): row}}, acceptance {accn: row}, post-root accessions) of version `vid`."""
    fil = {n: {} for n, _ in SOURCES}
    acc, post = {}, set()
    for v in lineage(store, vid):
        m = store.manifest(v)
        if m.get("_unapproved"):
            raise SecAuthorityError(f"{v} is an UNAPPROVED SEC metadata correction: never a build input")
        for name, _db in SOURCES:
            if name not in (m.get("content_sha256") or {}):
                continue
            for ln in _read_gz(store.path(v, name)):
                r = json.loads(ln)
                fil[name][(r[0], r[1])] = r
                if m["kind"] == "APPEND":
                    post.add(r[1])
        for ln in _read_gz(store.path(v, "acceptance.jsonl.gz")):
            r = json.loads(ln)
            acc[r[0]] = r
    return fil, acc, post


def _edgar_accepted(store: Store, cik: int, accn: str, fetch) -> str | None:
    """The EDGAR record's ACCEPTANCE-DATETIME (Eastern 'YYYYMMDDHHMMSS'), cached in the store."""
    p = os.path.join(store.headers, accn + ".txt")
    if os.path.exists(p):
        v = open(p).read().strip()
        return v if len(v) == 14 else None
    if fetch is None:
        return None
    try:
        n = accn.replace("-", "")
        b = fetch(f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/{n}/{accn}-index-headers.html", 20000)
    except Exception:  # noqa: BLE001 -- unfetchable: the CONSERVATIVE rule applies (late, never early)
        return None
    m = re.search(r"ACCEPTANCE-DATETIME(?:&gt;|>)\s*(\d{14})", (b or b"").decode("latin1"))
    os.makedirs(store.headers, exist_ok=True)
    open(p, "w").write(m.group(1) if m else "")
    return m.group(1) if m else None


def apply(store: Store, parent: str, data_dir: str, *, fetched_at: str, fetch=None, provenance: dict | None = None) -> dict:
    """The run's inputs.db / pred_inputs.db / acceptance.db := the SEALED metadata of `parent` for every accepted
    accession + the new ones (EDGAR-record acceptance); seals the APPEND; writes sec_metadata.json."""
    from .acceptance import eastern_to_utc
    fil, acc, _post = resolved(store, parent)
    div, new_files, new_all = [], {}, []
    for name, dbn in SOURCES:
        p = os.path.join(data_dir, dbn)
        if not os.path.exists(p):
            continue
        _own(p)
        db = sqlite3.connect(p)
        has_issuer = db.execute("SELECT 1 FROM sqlite_master WHERE name='issuer'").fetchone()
        uni = {r[0] for r in db.execute("SELECT cik FROM issuer")} if has_issuer else None
        fetched = {(r[0], r[1]): list(r) for r in db.execute(f"SELECT {','.join(FIELDS)} FROM filing")}
        sealed = fil[name]
        new_rows = []
        for k, r in fetched.items():
            sr = sealed.get(k)
            if sr is None:
                new_rows.append(r)
                continue
            diffs = {f: [sr[i], r[i]] for i, f in enumerate(FIELDS) if f in PIT_FIELDS and sr[i] != r[i]}
            if diffs:
                div.append({"kind": "SEC_METADATA_DIVERGENCE", "source": dbn, "cik": k[0], "accn": k[1], "fields": diffs})
        keep = []
        for k, sr in sealed.items():
            if k in fetched or uni is None or k[0] in uni:
                keep.append(sr)
                if k not in fetched:
                    div.append({"kind": "VANISHED_UPSTREAM", "source": dbn, "cik": k[0], "accn": k[1]})
        db.execute("DELETE FROM filing")
        db.executemany(f"INSERT INTO filing VALUES({','.join('?' * len(FIELDS))})", keep + new_rows)
        db.commit()
        db.close()
        new_files[name] = sorted(json.dumps(r) for r in new_rows)
        new_all += new_rows
    _own(os.path.join(data_dir, "acceptance.db"))
    ad = sqlite3.connect(os.path.join(data_dir, "acceptance.db"))
    for row in acc.values():
        ad.execute("INSERT OR REPLACE INTO acceptance VALUES(?,?,?,?)", row)
    new_acc, seen, by_src = [], set(acc), {}
    for r in sorted(new_all, key=lambda x: (x[1], x[0])):
        if r[1] in seen:
            continue
        seen.add(r[1])
        raw = _edgar_accepted(store, r[0], r[1], fetch)
        if raw:
            row = [r[1], eastern_to_utc(raw).isoformat(), "EDGAR_HEADER", raw]
            ad.execute("INSERT OR REPLACE INTO acceptance VALUES(?,?,?,?)", row)
            new_acc.append(row)
            by_src["EDGAR_HEADER"] = by_src.get("EDGAR_HEADER", 0) + 1
        else:
            by_src["CONSERVATIVE"] = by_src.get("CONSERVATIVE", 0) + 1
    ad.commit()
    ad.close()
    new_files["acceptance.jsonl.gz"] = sorted(json.dumps(r) for r in new_acc)
    report = {"accepted_rows": {n: len(v) for n, v in fil.items()}, "new_rows": {n: len(v) for n, v in new_files.items()},
              "divergences": len(div), "new_acceptance_by_source": by_src, "divergence_kinds": _kinds(div)}
    if not any(new_files.values()):
        vid = parent
    else:
        vid = f"SEC-APPEND-{fetched_at[:10].replace('-', '')}-{_identity(new_files)[:12]}"
        if not store.exists(vid):
            shas = _write_version(store, vid, new_files)
            store.write_once(vid, "divergence.json", body=json.dumps(div, indent=1, default=str).encode())
            store.seal(vid, {"format": FORMAT, "version_id": vid, "kind": "APPEND", "parent": parent,
                             "as_of": fetched_at[:10], "fetched_at": fetched_at, "created_at": now_iso(),
                             "content_sha256": shas, "rows": {n: len(v) for n, v in new_files.items()}, "report": report,
                             "provenance": provenance or {}, "code": _code()})
    ident = write_identity(store, vid, os.path.join(data_dir, "sec_metadata.json"))
    return {**ident, "report": report, "divergence_sample": div[:50]}


def _kinds(div: list) -> dict:
    out: dict = {}
    for d in div:
        k = d["kind"]
        if k == "SEC_METADATA_DIVERGENCE":
            k += ":" + "+".join(sorted(d["fields"]))
        out[k] = out.get(k, 0) + 1
    return out


def materialize(store: Store, vid: str, data_dir: str) -> dict:
    """A data dir's filing / acceptance tables := version `vid` exactly (full derivation, rollback, pinned
    reproduction); writes sec_metadata.json."""
    fil, acc, post = resolved(store, vid)
    for name, dbn in SOURCES:
        p = os.path.join(data_dir, dbn)
        if not os.path.exists(p) or not fil[name]:
            continue
        _rewrite(p, "filing", FIELDS, list(fil[name].values()))
    _rewrite(os.path.join(data_dir, "acceptance.db"), "acceptance", ("accn", "accepted", "source", "evidence"), list(acc.values()))
    return write_identity(store, vid, os.path.join(data_dir, "sec_metadata.json"), post)


def _own(path: str) -> None:
    """⛔ never write through a hard link: a run's data files may be links to another run's (correction-impact)."""
    if os.stat(path).st_nlink > 1:
        tmp = path + ".unlink"
        shutil.copyfile(path, tmp)
        os.remove(path)
        os.replace(tmp, path)


def _rewrite(path: str, table: str, cols: tuple, rows: list) -> None:
    _own(path)
    db = sqlite3.connect(path)
    db.execute(f"DELETE FROM {table}")
    db.executemany(f"INSERT INTO {table} VALUES({','.join('?' * len(cols))})", rows)
    db.commit()
    db.close()


def write_identity(store: Store, vid: str, out_json: str, post: set | None = None) -> dict:
    if post is None:
        post = resolved(store, vid)[2]
    m = store.manifest(vid, verify=False)
    ident = {"sec_version": vid, "kind": m["kind"], "parent": m.get("parent"), "lineage": lineage(store, vid),
             "post_root_accessions": sorted(post)}
    if os.path.exists(out_json):
        os.remove(out_json)
    with open(out_json, "w", encoding="utf-8", newline="\n") as f:
        json.dump(ident, f, sort_keys=True, separators=(",", ":"))
    return {k: v for k, v in ident.items() if k != "post_root_accessions"} | {"post_root_accessions": len(post),
                                                                              "sha256": _file_sha(out_json)}


def _file_sha(p: str) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def main(argv=None) -> int:
    import argparse
    ap = argparse.ArgumentParser(description="Market Cap SEC filing-metadata authority (operator CLI)")
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("seal-root")
    s.add_argument("--root", required=True)
    s.add_argument("--data", required=True)
    s.add_argument("--as-of", required=True)
    s.add_argument("--provenance", default="{}")
    s = sub.add_parser("show")
    s.add_argument("--root", required=True)
    s.add_argument("--version", required=True)
    a = ap.parse_args(argv)
    st = Store(a.root)
    if a.cmd == "seal-root":
        r = seal_root(st, a.data, as_of=a.as_of, provenance=json.loads(a.provenance))
    else:
        r = st.manifest(a.version)
    print(json.dumps(r, indent=1, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
