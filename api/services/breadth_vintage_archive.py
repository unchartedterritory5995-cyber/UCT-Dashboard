"""Exchange owner-vintage ARCHIVE ACKNOWLEDGEMENT — the one protocol the archiver writes and the
US V2 producer's prune guard reads.

⛔⛔ THE INVARIANT: NO PRODUCER VINTAGE MAY BE PRUNED BEFORE ITS EXCHANGE ARCHIVE COPY HAS BEEN DURABLY
VERIFIED. Exchange Breadth V1 computes each session from the vintage the US V2 producer published it
from (its "owner"); the producer keeps only its newest `KEEP_VINTAGES`, and every retry builds a new
vintage, so archiving "often enough" is not a guarantee — p202609292209 was lost exactly that way. The
producer therefore asks THIS module before it deletes anything, and an answer other than a fully
re-verified acknowledgement means NO PRUNE.

The protocol reuses the archive's existing convention — `<archive>/<tag>/` (a 0444 copy) and
`<archive>/<tag>.SHA256SUMS` (`sha256sum` format, every archived file) — and adds ONE file:

    <archive>/<tag>.ARCHIVED.json   (0444, written last, atomically)

which binds the exact tag, the SHA256SUMS identity, the REQUIRED file listing (the bytes the exchange
compute reads: `inputs_<tag>/**` and `grouped_<tag>/**`), the vintage's input-manifest / reference
identity, and when and by what it was verified.

⛔ MARKER EXISTENCE PROVES NOTHING. `verify()` re-proves the whole contract every time it is asked:
the SUMS file hashes to what the ack says; every archived file re-hashes to its SUMS line; the required
listing recomputes to the ack's digest; and — when the producer's copy is still present — every required
source file is listed and byte-identical. Any failure is a refusal with a reason, never a pass.

Logs and scratch (`vintage.log`, `compute.log`, `work/`) are archived when present but are NOT required:
the producer may still be appending to them after the vintage is READY, and the exchange compute never
reads them.
"""
from __future__ import annotations

import hashlib
import json
import os
import stat
import time
from typing import Optional

PROTOCOL = "exch-vintage-archive-ack/1"
ACK_SUFFIX = ".ARCHIVED.json"
SUMS_SUFFIX = ".SHA256SUMS"
_ACK_KEYS = {"protocol", "tag", "complete", "archive", "required", "source", "inputs", "verified_at", "archiver"}


class AckRefused(Exception):
    """Why a vintage is NOT proven archived. `reason` is a stable code; `detail` is evidence."""

    def __init__(self, reason: str, detail=None):
        super().__init__("%s %s" % (reason, json.dumps(detail, default=str)[:600] if detail is not None else ""))
        self.reason, self.detail = reason, detail


def sha_file(p: str) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def ack_path(archive_dir: str, tag: str) -> str:
    return os.path.join(archive_dir, tag + ACK_SUFFIX)


def sums_path(archive_dir: str, tag: str) -> str:
    return os.path.join(archive_dir, tag + SUMS_SUFFIX)


def is_required(rel: str, tag: str) -> bool:
    """The bytes the exchange compute reads. `rel` is a SUMS path (`./inputs_<tag>/...`)."""
    return rel.startswith("./inputs_%s/" % tag) or rel.startswith("./grouped_%s/" % tag)


def parse_sums(path: str) -> dict:
    """{rel: sha256}. Strict: a malformed or duplicated line refuses (a SUMS file is evidence)."""
    out: dict = {}
    try:
        with open(path, encoding="utf-8") as f:
            lines = f.read().split("\n")
    except OSError as e:
        raise AckRefused("SUMS_MISSING", {"path": path, "error": type(e).__name__})
    if lines and lines[-1] == "":
        lines.pop()
    for i, line in enumerate(lines):
        h, sep, rel = line.partition("  ")
        if not sep or len(h) != 64 or any(c not in "0123456789abcdef" for c in h) or not rel.startswith("./") \
                or ".." in rel.split("/") or rel in out:
            raise AckRefused("SUMS_MALFORMED", {"line": i + 1})
        out[rel] = h
    if not out:
        raise AckRefused("SUMS_MALFORMED", {"empty": True})
    return out


def listing_sha256(entries: dict) -> str:
    """Digest of a {rel: sha} listing in SUMS line format, sorted (order-independent identity)."""
    return hashlib.sha256("".join("%s  %s\n" % (entries[r], r) for r in sorted(entries)).encode()).hexdigest()


def _walk(root: str) -> dict:
    """{rel: abs} for every regular file under `root` (rel in SUMS form)."""
    out = {}
    for dp, _dn, fns in os.walk(root):
        for fn in fns:
            ap = os.path.join(dp, fn)
            out["./" + os.path.relpath(ap, root).replace(os.sep, "/")] = ap
    return out


def _source_required(source_dir: str, tag: str) -> dict:
    return {r: p for r, p in _walk(source_dir).items() if is_required(r, tag)}


def _verify_archive_files(archive_dir: str, tag: str, sums: dict) -> tuple:
    """Every SUMS line re-hashed against the archive copy. Returns (files, bytes)."""
    root = os.path.join(archive_dir, tag)
    if not os.path.isdir(root):
        raise AckRefused("ARCHIVE_DIR_MISSING", {"tag": tag})
    n = b = 0
    for rel, h in sorted(sums.items()):
        p = os.path.join(root, rel[2:])
        if not os.path.isfile(p):
            raise AckRefused("ARCHIVE_FILE_MISSING", {"tag": tag, "file": rel})
        if sha_file(p) != h:
            raise AckRefused("ARCHIVE_FILE_CORRUPT", {"tag": tag, "file": rel})
        n += 1
        b += os.path.getsize(p)
    return n, b


def _verify_source(source_dir: str, tag: str, required: dict) -> int:
    """Every REQUIRED file of the producer's copy is listed and byte-identical. Returns bytes."""
    src = _source_required(source_dir, tag)
    missing = sorted(set(src) - set(required))
    if missing:
        raise AckRefused("SOURCE_NOT_ARCHIVED", {"tag": tag, "files": missing[:5], "n": len(missing)})
    gone = sorted(set(required) - set(src))
    if gone:
        # the producer copy is already damaged; the archive may be the good copy, but an operator decides
        raise AckRefused("SOURCE_INCOMPLETE", {"tag": tag, "files": gone[:5], "n": len(gone)})
    b = 0
    for rel, p in sorted(src.items()):
        if sha_file(p) != required[rel]:
            raise AckRefused("SOURCE_MISMATCH", {"tag": tag, "file": rel})
        b += os.path.getsize(p)
    return b


def _inputs_identity(archive_dir: str, tag: str) -> dict:
    ip = os.path.join(archive_dir, tag, "inputs_" + tag)
    out = {}
    for k, fn in (("input_manifest_sha256", "INPUT_MANIFEST.json"), ("reference_sha256", "pit_reference.json"),
                  ("grouped_vintage_manifest_sha256", "grouped_vintage_manifest.json")):
        p = os.path.join(ip, fn)
        out[k] = sha_file(p) if os.path.isfile(p) else None
    if not out["input_manifest_sha256"]:
        raise AckRefused("REQUIRED_INPUT_MANIFEST_MISSING", {"tag": tag})
    return out


def build_ack(archive_dir: str, tag: str, source_dir: Optional[str], archiver: dict) -> dict:
    """Prove the archive (and, if present, the producer copy) and return the acknowledgement document.
    `source_dir` None/absent = the producer already pruned it (a pre-protocol archive): the ack then
    records `source.verified = False` honestly."""
    sp = sums_path(archive_dir, tag)
    sums = parse_sums(sp)
    files, nbytes = _verify_archive_files(archive_dir, tag, sums)
    required = {r: h for r, h in sums.items() if is_required(r, tag)}
    if not required:
        raise AckRefused("REQUIRED_EMPTY", {"tag": tag})
    src_present = bool(source_dir) and os.path.isdir(source_dir)
    req_bytes = _verify_source(source_dir, tag, required) if src_present else \
        sum(os.path.getsize(os.path.join(archive_dir, tag, r[2:])) for r in required)
    return {"protocol": PROTOCOL, "tag": tag, "complete": True,
            "archive": {"dir": os.path.join(archive_dir, tag), "sums_sha256": sha_file(sp), "files": files,
                        "bytes": nbytes, "verified": True},
            "required": {"files": len(required), "bytes": req_bytes, "listing_sha256": listing_sha256(required),
                         "rule": "inputs_<tag>/** + grouped_<tag>/**"},
            "source": {"dir": source_dir or None, "verified": src_present},
            "inputs": _inputs_identity(archive_dir, tag),
            "verified_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "archiver": dict(archiver)}


def write_ack(archive_dir: str, ack: dict) -> str:
    """Atomic, durable, read-only: tmp → fsync → rename → fsync(dir). Never rewrites a valid ack."""
    p = ack_path(archive_dir, ack["tag"])
    tmp = p + ".tmp.%d" % os.getpid()
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(ack, f, indent=1, sort_keys=True)
        f.flush()
        os.fsync(f.fileno())
    os.chmod(tmp, stat.S_IRUSR | stat.S_IRGRP | stat.S_IROTH)
    os.replace(tmp, p)
    try:
        fd = os.open(archive_dir, os.O_RDONLY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
    except OSError:
        pass  # Windows / some filesystems cannot fsync a directory; rename is still atomic
    return p


def load_ack(archive_dir: str, tag: str) -> dict:
    p = ack_path(archive_dir, tag)
    if not os.path.exists(p):
        raise AckRefused("ACK_MISSING", {"tag": tag})
    try:
        ack = json.load(open(p, encoding="utf-8"))
    except Exception as e:  # noqa: BLE001
        raise AckRefused("ACK_MALFORMED", {"tag": tag, "error": type(e).__name__})
    if not isinstance(ack, dict) or not _ACK_KEYS <= set(ack) or ack.get("protocol") != PROTOCOL:
        raise AckRefused("ACK_MALFORMED", {"tag": tag, "keys": sorted(ack) if isinstance(ack, dict) else None})
    try:
        ok = (isinstance(ack["archive"]["sums_sha256"], str) and isinstance(ack["required"]["listing_sha256"], str)
              and isinstance(ack["required"]["files"], int))
    except (KeyError, TypeError):
        ok = False
    if not ok:
        raise AckRefused("ACK_MALFORMED", {"tag": tag, "fields": "archive/required"})
    if ack["tag"] != tag:
        raise AckRefused("ACK_TAG_MISMATCH", {"tag": tag, "ack_tag": ack["tag"]})
    if ack.get("complete") is not True or ack["archive"].get("verified") is not True:
        raise AckRefused("ACK_INCOMPLETE", {"tag": tag})
    return ack


def cheap_state(archive_dir: str, tag: str) -> str:
    """Status-page answer WITHOUT re-hashing gigabytes: 'acked' | a refusal reason. Not a prune decision."""
    try:
        ack = load_ack(archive_dir, tag)
        if sha_file(sums_path(archive_dir, tag)) != ack["archive"]["sums_sha256"]:
            return "ACK_SUMS_MISMATCH"
        return "acked"
    except AckRefused as e:
        return e.reason
    except OSError:
        return "SUMS_MISSING"


def verify(archive_dir: str, tag: str, source_dir: Optional[str] = None,
           owned_provenance: Optional[list] = None) -> dict:
    """THE PRUNE PRECONDITION. Returns the verified ack or raises AckRefused. Re-proves everything.

    `owned_provenance`: the producer's canonical provenance for every session this vintage published
    ([{date, input_manifest_sha256, reference_sha256}]) — the archive must hold exactly those inputs."""
    ack = load_ack(archive_dir, tag)
    sp = sums_path(archive_dir, tag)
    if not os.path.exists(sp):
        raise AckRefused("SUMS_MISSING", {"tag": tag})
    if sha_file(sp) != ack["archive"]["sums_sha256"]:
        raise AckRefused("ACK_SUMS_MISMATCH", {"tag": tag})
    sums = parse_sums(sp)
    required = {r: h for r, h in sums.items() if is_required(r, tag)}
    if not required:
        raise AckRefused("REQUIRED_EMPTY", {"tag": tag})
    if listing_sha256(required) != ack["required"]["listing_sha256"] or len(required) != ack["required"]["files"]:
        raise AckRefused("REQUIRED_LISTING_MISMATCH", {"tag": tag})
    _verify_archive_files(archive_dir, tag, sums)
    if source_dir and os.path.isdir(source_dir):
        _verify_source(source_dir, tag, required)
    ident = _inputs_identity(archive_dir, tag)
    if ident["input_manifest_sha256"] != ack["inputs"].get("input_manifest_sha256"):
        raise AckRefused("ACK_INPUTS_MISMATCH", {"tag": tag})
    for p in owned_provenance or ():
        if (p.get("input_manifest_sha256"), p.get("reference_sha256")) != \
                (ident["input_manifest_sha256"], ident["reference_sha256"]):
            raise AckRefused("OWNER_PROVENANCE_MISMATCH", {"tag": tag, "session": p.get("date")})
    return ack


# ── health thresholds (shared by the producer status and the exchange runner status) ─────────────
GIB = 1 << 30
#: Measured 2026-10-05: one vintage = 1.99 GB producer copy + 1.99 GB archive copy; one vintage per
#: trading day in steady state; a retry storm can build MAX_ATTEMPTS (6) per day = ~12 GB/day.
DISK_WARN_FREE_BYTES = int(os.environ.get("BV2_DISK_WARN_FREE_GIB", "20")) * GIB
DISK_CRIT_FREE_BYTES = int(os.environ.get("BV2_DISK_CRIT_FREE_GIB", "10")) * GIB
BLOCKED_CRIT_COUNT = 3
BLOCKED_CRIT_AGE_HOURS = 72


def disk_level(free_bytes: int, blocked: int, oldest_blocked_age_h: Optional[float],
               verification_failures: int) -> tuple:
    """(level, reasons): OK | WARNING | CRITICAL. Disk exhaustion must never be the first alert, so ANY
    prune block is already a WARNING, and a verification failure (evidence integrity) is CRITICAL."""
    crit, warn = [], []
    if free_bytes < DISK_CRIT_FREE_BYTES:
        crit.append("free %.1f GiB < %d GiB" % (free_bytes / GIB, DISK_CRIT_FREE_BYTES // GIB))
    elif free_bytes < DISK_WARN_FREE_BYTES:
        warn.append("free %.1f GiB < %d GiB" % (free_bytes / GIB, DISK_WARN_FREE_BYTES // GIB))
    if verification_failures:
        crit.append("%d archive verification failure(s)" % verification_failures)
    if blocked >= BLOCKED_CRIT_COUNT:
        crit.append("%d vintages prune-blocked" % blocked)
    elif blocked:
        warn.append("%d vintage(s) prune-blocked" % blocked)
    if oldest_blocked_age_h is not None and oldest_blocked_age_h >= BLOCKED_CRIT_AGE_HOURS:
        crit.append("oldest prune-blocked vintage %.0fh old" % oldest_blocked_age_h)
    return ("CRITICAL" if crit else "WARNING" if warn else "OK"), crit + warn


def tree_bytes(root: str) -> int:
    n = 0
    for dp, _dn, fns in os.walk(root):
        for fn in fns:
            try:
                n += os.lstat(os.path.join(dp, fn)).st_size
            except OSError:
                pass
    return n
