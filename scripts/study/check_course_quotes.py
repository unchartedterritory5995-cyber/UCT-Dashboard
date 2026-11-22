"""Is every course fact's quote really on its cited page? (docs/study/courses/README.md §3, §6.1)

  python -m scripts.study.check_course_quotes docs/study/courses/F1/F1.03.json [...]
  python -m scripts.study.check_course_quotes --all

For each fact: fetch the source URL (a plain, honest client name; cached for a day under the system temp folder),
turn the page into words (HTML via BeautifulSoup, PDF via pypdf when installed), and look for the quote's words in
order. Comparison ignores case, punctuation and spacing, so a curly apostrophe or a line break never fails a real
quote, while a reworded quote always does.

Statuses: `found`; `MISSING` (the page was read and the quote is not on it: fix the quote or the fact);
`unreachable` (the site refused this client: the checker must confirm the quote with its own browser fetch, and
says so in verify). Exit 1 when anything is MISSING.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import pathlib
import re
import sys
import tempfile
import time
import urllib.request

from scripts.study import courses_lib as cl

UA = "Mozilla/5.0 (compatible; UCT-Study-SourceCheck/1.0)"
CACHE = pathlib.Path(tempfile.gettempdir()) / "uct_study_quote_cache"
TTL_S = 24 * 3600


def words(text: str) -> str:
    t = (text or "").lower().replace("’", "'").replace("‘", "'")
    t = re.sub(r"[‐-―]", "-", t)
    return " ".join(re.findall(r"[a-z0-9]+", t))


def _cached(url: str) -> tuple[int, bytes, str] | None:
    p = CACHE / (hashlib.sha1(url.encode("utf-8")).hexdigest() + ".json")
    if p.exists() and time.time() - p.stat().st_mtime < TTL_S:
        d = json.loads(p.read_text(encoding="utf-8"))
        return d["status"], bytes.fromhex(d["body"]), d["ctype"]
    return None


def fetch(url: str) -> tuple[int, bytes, str]:
    hit = _cached(url)
    if hit:
        return hit
    try:
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "text/html,application/pdf,*/*"})
        with urllib.request.urlopen(req, timeout=30) as r:
            status, body, ctype = r.status, r.read(), r.headers.get("Content-Type", "")
    except urllib.error.HTTPError as e:
        status, body, ctype = e.code, b"", ""
    except Exception:  # noqa: BLE001 (timeouts, TLS, DNS: all "unreachable")
        status, body, ctype = 0, b"", ""
    CACHE.mkdir(parents=True, exist_ok=True)
    (CACHE / (hashlib.sha1(url.encode("utf-8")).hexdigest() + ".json")).write_text(
        json.dumps({"status": status, "body": body.hex(), "ctype": ctype}), encoding="utf-8")
    return status, body, ctype


def page_words(body: bytes, ctype: str, url: str) -> str | None:
    if "pdf" in ctype.lower() or url.lower().endswith(".pdf") or body[:5] == b"%PDF-":
        try:
            from pypdf import PdfReader  # optional
        except ImportError:
            return None
        reader = PdfReader(io.BytesIO(body))
        return words(" ".join((pg.extract_text() or "") for pg in reader.pages))
    from bs4 import BeautifulSoup
    soup = BeautifulSoup(body, "html.parser")
    for tag in soup(["script", "style", "noscript"]):
        tag.decompose()
    return words(soup.get_text(" "))


def check_doc(doc: dict) -> list[dict]:
    sources = {s["id"]: s for s in doc.get("sources") or []}
    out = []
    pages: dict[str, str | None] = {}
    for f in doc.get("facts") or []:
        src = sources.get(f.get("source")) or {}
        url = src.get("url") or ""
        row = {"fact": f.get("id"), "source": f.get("source"), "url": url}
        if src.get("tier") == 3 or not url.startswith("https://"):
            row["status"] = "house"            # the owner's own material in this repo: checked by the owner
            out.append(row)
            continue
        if url not in pages:
            status, body, ctype = fetch(url)
            pages[url] = page_words(body, ctype, url) if status == 200 and body else None
            row["http"] = status
        text = pages[url]
        if text is None:
            row["status"] = "unreachable"
        else:
            row["status"] = "found" if words(f.get("quote") or "") in text else "MISSING"
        out.append(row)
    return out


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("files", nargs="*")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--json", action="store_true", help="print one JSON object per file")
    a = ap.parse_args(argv)
    paths = cl.unit_files() if a.all or not a.files else [pathlib.Path(f).resolve() for f in a.files]
    missing = 0
    for p in paths:
        rows = check_doc(cl.load_unit(p))
        missing += sum(1 for r in rows if r["status"] == "MISSING")
        if a.json:
            print(json.dumps({"file": str(p), "facts": rows}))
            continue
        counts = {s: sum(1 for r in rows if r["status"] == s) for s in ("found", "MISSING", "unreachable", "house")}
        print(f"{p.name}: {counts}")
        for r in rows:
            if r["status"] != "found":
                print(f"   {r['status']:11s} {r['fact']} ({r['source']}) {r['url']}")
    return 1 if missing else 0


if __name__ == "__main__":
    sys.exit(main())
