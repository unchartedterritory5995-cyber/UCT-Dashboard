"""Market Cap V1 SERVING DOCUMENTS -- the one builder of what a member reads.

The publisher turns an immutable build DB into one document per ticker; the web never opens the 0.5 GB SQLite. The
documents are produced by the dark reader's own `serve.Authority` (series + latest), so the published payload and the
reader the cutover review examined are the same function's output. Nothing here interprets share states: it copies
what the build decided -- daily values, reason-coded gaps (never 0), structure -- verbatim.

DOCUMENT (format 1; content-addressed, so it carries NO build id -- the manifest binds it to a build at serve time):
    {"format": 1, "ticker": "GOOGL", "issuer_id": "cik:1652044", "listing": {"start", "end"}, "company_level": true,
     "points": [["YYYY-MM-DD", company_market_cap_usd], ...],
     "gaps": [{"start", "end", "reason", "n_days"}, ...],
     "structure": [{"start", "end", "classes", "kind", "reason", "components"}, ...],
     "latest": {"date", "company_market_cap", "security_market_cap", "reason"}}

Bytes are canonical (sorted keys, compact) and gzip'd with mtime 0, so the same document always hashes the same.
"""
from __future__ import annotations

import gzip
import hashlib
import io
import json
import sqlite3

DOC_FORMAT = 1


def canonical(doc) -> bytes:
    return json.dumps(doc, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()


def gz(b: bytes) -> bytes:
    buf = io.BytesIO()
    with gzip.GzipFile(fileobj=buf, mode="wb", compresslevel=6, mtime=0) as f:
        f.write(b)
    return buf.getvalue()


def sha(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def norm_ticker(t: str) -> str:
    return t.strip().upper().replace(".", "-")


def tickers(build_db: str) -> list[str]:
    db = sqlite3.connect(f"file:{build_db}?mode=ro", uri=True)
    try:
        return sorted({norm_ticker(t) for (t,) in db.execute("SELECT DISTINCT ticker FROM ticker_map")})
    finally:
        db.close()


def documents(build_db: str, prices_db: str):
    """Yield (normalized_ticker, doc) for every ticker the build maps, via the dark reader (one implementation)."""
    from .serve import Authority
    a = Authority(build_db, prices_db)
    try:
        for t in tickers(build_db):
            s = a.series(t)
            if s is None:
                continue
            lt = a.latest(t) or {}
            yield t, {"format": DOC_FORMAT, "ticker": t, "issuer_id": s["issuer_id"], "listing": s["listing"],
                      "company_level": True, "points": s["points"], "gaps": s["gaps"], "structure": s["structure"],
                      "latest": {"date": lt.get("date"), "company_market_cap": lt.get("company_market_cap"),
                                 "security_market_cap": lt.get("security_market_cap"), "reason": lt.get("reason")}}
    finally:
        a.db.close()
        if a.px is not None:
            a.px.close()


def encode_doc(doc: dict) -> bytes:
    return gz(canonical(doc))


def decode_doc(body: bytes) -> dict:
    doc = json.loads(gzip.decompress(body))
    if not isinstance(doc, dict) or doc.get("format") != DOC_FORMAT:
        raise ValueError("unsupported serving document format")
    return doc


def check_doc(doc: dict) -> list[str]:
    """Structural invariants of a serving document (a publisher refuses to publish a document failing any)."""
    bad = []
    pts = doc.get("points") or []
    days = [p[0] for p in pts]
    if days != sorted(days) or len(set(days)) != len(days):
        bad.append("points not strictly ordered")
    if any((not isinstance(v, (int, float))) or v != v or v <= 0 for _d, v in pts):
        bad.append("non-positive / non-numeric value (missing must be a gap, never 0)")
    for g in doc.get("gaps") or []:
        if not g.get("reason"):
            bad.append("gap without reason")
            break
    gset = [(int(g["start"].replace("-", "")), int(g["end"].replace("-", ""))) for g in doc.get("gaps") or []]
    if gset and pts:
        ints = [int(d.replace("-", "")) for d in days]
        import bisect
        for s, e in gset:
            i = bisect.bisect_left(ints, s)
            if i < len(ints) and ints[i] <= e:
                bad.append("a gap overlaps a valued day")
                break
    return bad
