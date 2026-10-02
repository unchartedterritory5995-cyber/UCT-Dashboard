"""COV-04 -- measure the filing blackline's section-heading coverage BEFORE the
flag is armed.

Runs the REAL extractor (`api.services.filing_blackline`) over a fixed, diverse
ticker list and reports, per ticker and per section, whether the section was
located in each of the two filings that would be compared:

    found       -- located in both filings (the pair can be diffed)
    not_found   -- the extractor's own reason, per side
    parse_error -- the extractor raised (named, never swallowed)
    unread      -- the ticker never reached the extractor (no CIK in SEC's
                   ticker file, fewer than two filings, a document SEC would
                   not serve); NOT counted in the found-rate denominator, and
                   listed by name so it cannot hide.

SEC is reached ONLY through `fundamentals_pit.sec_client` (declared User-Agent,
one process-wide limiter, bounded backoff). The CIK comes from SEC's own
`company_tickers.json` through the same client -- `edgar.resolve_cik` is not
used here because its bulk tier is not on that client.

This is a LOCAL measurement, never on a request path. Every downloaded document
is cached under a scratch directory (default %TEMP%/uct-blackline-cov), so a
re-measure after a fix reads the SAME bytes and makes no new requests. The
cache directory is refused if it resolves inside the shared data root
(C:\\data or /data), and the census pins are applied before anything under
`api.**` is imported (CLAUDE.md, "C:\\data IS REAL").

    python tools/blackline_coverage.py --label before --out docs/terminal-research/10-roadmap/evidence/2026-10-01-cov04-blackline-coverage
    python tools/blackline_coverage.py --label after  --forms 10-K,10-Q --out ...
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
import time
import traceback

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, REPO)

# ── sandbox FIRST: these paths are captured at module import ────────────────
SANDBOX = os.path.join(tempfile.gettempdir(), "uct-blackline-cov-sandbox")


def _inside_shared_root(path: str) -> bool:
    p = os.path.normcase(os.path.abspath(path))
    for root in (r"C:\data", "/data"):
        r = os.path.normcase(os.path.abspath(root))
        if p == r or p.startswith(r.rstrip("\\/") + os.sep):
            return True
    return False


assert not _inside_shared_root(SANDBOX), SANDBOX
os.makedirs(SANDBOX, exist_ok=True)
import conftest  # noqa: E402

_, _pins, _ = conftest.shared_data_root_census()
for _env, _lit in _pins.items():
    os.environ[_env] = _lit.replace("/data", SANDBOX)
os.environ["DATA_DIR"] = SANDBOX

from api.services import filing_blackline as fb  # noqa: E402
from api.services.fundamentals_pit import sec_client  # noqa: E402

# ── the fixed sample ─────────────────────────────────────────────────────────
# Fixed on 2026-10-01. Change it and the before/after numbers stop being
# comparable: add a NEW list under a new name instead.
COHORTS: dict[str, list[str]] = {
    "megacap": ["AAPL", "MSFT", "AMZN", "GOOGL", "META", "NVDA", "BRK-B", "XOM", "JNJ", "WMT"],
    "bank": ["JPM", "BAC", "WFC", "C", "GS", "USB"],
    "reit": ["O", "PLD", "AMT", "SPG", "EQR"],
    "biotech": ["VRTX", "REGN", "MRNA", "ALNY", "SRPT"],
    "small_cap": ["PLUG", "BOOT", "SHAK", "AAON", "CALM"],
    "foreign_10k_filer": ["ACN", "MDT", "LIN", "CB", "RCL"],
    "recent_ipo": ["CAVA", "KVUE", "CART", "RDDT", "ALAB"],
    "cross_reference_index": ["GE"],
}


def _sections_for(form: str):
    by_form = getattr(fb, "FORM_SECTIONS", None)
    if by_form is not None:
        return by_form[form]
    if form != "10-K":
        raise SystemExit(f"this build of filing_blackline has no {form} sections")
    return fb.SECTIONS


class Fetcher:
    """sec_client reads, cached on disk under the scratch dir by URL."""

    def __init__(self, cache_dir: str):
        if _inside_shared_root(cache_dir):
            raise SystemExit(f"refusing cache dir inside the shared data root: {cache_dir}")
        self.dir = cache_dir
        os.makedirs(cache_dir, exist_ok=True)
        self.network = 0
        self.cached = 0

    def _path(self, url: str) -> str:
        safe = url.split("://", 1)[-1].replace("/", "_").replace(":", "_").replace("?", "_")
        return os.path.join(self.dir, safe[-180:])

    def get(self, url: str) -> bytes:
        p = self._path(url)
        if os.path.exists(p):
            self.cached += 1
            with open(p, "rb") as f:
                return f.read()
        body = sec_client.get_bytes(url, retries=3, timeout=60)
        self.network += 1
        tmp = p + ".part"
        with open(tmp, "wb") as f:
            f.write(body)
        os.replace(tmp, p)
        return body


def _heading_candidates(blocks: list[str], limit: int = 12) -> list[str]:
    """Short blocks that LOOK like an item heading -- the evidence a reader
    needs to see why a section was not located."""
    import re
    rx = re.compile(r"^(part\s+i+\b.*|item\b.*|.*risk\s+factors.*|.*management'?s\s+discussion.*)$", re.I)
    out = [b for b in blocks if len(b) <= 160 and rx.match(b)]
    return out[:limit]


def measure_pair(fetch: Fetcher, cik: str, filings: list[dict], form: str) -> dict:
    newer, older = filings[0], filings[1]
    sides = {}
    for side, f in (("newer", newer), ("older", older)):
        url = fb.document_url(cik, f["accession"], f["primary_document"])
        try:
            doc = fetch.get(url)
        except sec_client.SecError as exc:
            return {"unread": f"{side} {form} {f['accession']} could not be read: {exc}"}
        sides[side] = {"accession": f["accession"], "filing_date": f["filing_date"],
                       "url": url, "bytes": len(doc), "doc": doc}
    out = {"newer": {k: v for k, v in sides["newer"].items() if k != "doc"},
           "older": {k: v for k, v in sides["older"].items() if k != "doc"},
           "sections": {}}
    blocks = {}
    for side in ("newer", "older"):
        try:
            blocks[side] = fb.html_blocks(sides[side]["doc"])
        except Exception as exc:  # noqa: BLE001 -- recorded as parse_error, by name
            blocks[side] = exc
    for spec in _sections_for(form):
        rec = {"state": None, "sides": {}}
        for side in ("newer", "older"):
            b = blocks[side]
            if isinstance(b, Exception):
                rec["sides"][side] = {"state": "parse_error", "error": f"html_blocks: {type(b).__name__}: {b}"}
                continue
            try:
                r = fb.locate_section(b, spec)
            except Exception as exc:  # noqa: BLE001
                rec["sides"][side] = {"state": "parse_error",
                                      "error": f"locate_section: {type(exc).__name__}: {exc}",
                                      "trace": traceback.format_exc(limit=3)}
                continue
            if r["found"]:
                rec["sides"][side] = {"state": "found", "heading": r["heading"],
                                      "paragraphs": len(r["paragraphs"]),
                                      "chars": sum(len(p) for p in r["paragraphs"]),
                                      **({"reference_only": True} if r.get("reference_only") else {}),
                                      **({"reflowed": True} if r.get("fragmented") else {}),
                                      **({"heading_shape": r["heading_shape"]} if r.get("heading_shape") else {})}
            elif r.get("omitted"):
                rec["sides"][side] = {"state": "omitted", "reason": r["reason"]}
            else:
                rec["sides"][side] = {"state": "not_found", "reason": r["reason"],
                                      "candidates": _heading_candidates(b)}
        states = [rec["sides"][s]["state"] for s in ("newer", "older")]
        rec["state"] = ("parse_error" if "parse_error" in states else
                        "found" if states == ["found", "found"] else
                        "omitted" if states == ["omitted", "omitted"] else "not_found")
        out["sections"][spec["key"]] = rec
    return out


def run(tickers: list[tuple[str, str]], forms: list[str], fetch: Fetcher) -> dict:
    tmap = json.loads(fetch.get("https://www.sec.gov/files/company_tickers.json"))
    cik_of = {v["ticker"].upper(): str(v["cik_str"]).zfill(10) for v in tmap.values()}
    rows = []
    for cohort, sym in tickers:
        row = {"ticker": sym, "cohort": cohort, "forms": {}}
        cik = cik_of.get(sym) or cik_of.get(sym.replace("-", "."))
        if not cik:
            row["unread"] = "no CIK for this ticker in SEC's company_tickers.json"
            rows.append(row)
            continue
        row["cik"] = cik
        try:
            sub = json.loads(fetch.get(f"https://data.sec.gov/submissions/CIK{cik}.json"))
        except sec_client.SecError as exc:
            row["unread"] = f"submissions could not be read: {exc}"
            rows.append(row)
            continue
        row["name"] = sub.get("name")
        for form in forms:
            finder = getattr(fb, "find_filings", None)      # slice 2: reads older index pages
            try:
                listing = (finder(sub, form, fetch.get) if finder else fb.list_filings(sub, form=form))
            except sec_client.SecError as exc:
                row["forms"][form] = {"unread": f"older submissions page could not be read: {exc}"}
                continue
            if len(listing["filings"]) < 2:
                where = "the newest index pages" if finder else "the recent block"
                row["forms"][form] = {"unread": f"{len(listing['filings'])} original {form} in {where}"}
                continue
            try:
                row["forms"][form] = measure_pair(fetch, cik, listing["filings"], form)
            except Exception as exc:  # noqa: BLE001
                row["forms"][form] = {"unread": f"measure failed: {type(exc).__name__}: {exc}"}
        rows.append(row)
        print(f"  {sym:6s} " + " ".join(
            f"{form}:" + ",".join(f"{k}={v['state']}" for k, v in (row['forms'].get(form, {}).get('sections') or {}).items())
            if row["forms"].get(form, {}).get("sections") else f"{form}:unread"
            for form in forms), flush=True)
    return {"rows": rows}


def summarise(result: dict, forms: list[str]) -> dict:
    summ = {}
    for form in forms:
        keys = [s["key"] for s in _sections_for(form)]
        per = {}
        for k in keys:
            n = found = nf = pe = om = 0
            ref = both = reflowed = 0
            for row in result["rows"]:
                sec = ((row.get("forms") or {}).get(form) or {}).get("sections", {}).get(k)
                if not sec:
                    continue
                n += 1
                found += sec["state"] == "found"
                nf += sec["state"] == "not_found"
                pe += sec["state"] == "parse_error"
                om += sec["state"] == "omitted"
                ref += any(sec["sides"][s].get("reference_only") for s in ("newer", "older"))
                both += all(sec["sides"][s].get("reference_only") for s in ("newer", "older"))
                reflowed += any(sec["sides"][s].get("reflowed") for s in ("newer", "older"))
            total = len(result["rows"])
            per[k] = {"n": n, "found": found, "not_found": nf, "parse_error": pe, "omitted": om,
                      "resolved_rate": round((found + om) / n, 3) if n else None,
                      "found_rate": round(found / n, 3) if n else None,
                      "tickers": total,
                      "end_to_end_rate": round(found / total, 3) if total else None,
                      "reference_only_pairs": ref, "reference_only_both_sides": both,
                      "found_with_text": found - both, "reflowed_pairs": reflowed}
        unread = [r["ticker"] for r in result["rows"]
                  if r.get("unread") or ((r.get("forms") or {}).get(form) or {}).get("unread")]
        summ[form] = {"sections": per, "unread": unread}
    return summ


def to_markdown(result: dict, summ: dict, forms: list[str], label: str, meta: dict) -> str:
    L = [f"# COV-04 blackline heading coverage: {label}", "",
         f"Measured {meta['measured_at']} with `tools/blackline_coverage.py` at commit `{meta['commit']}`.",
         f"{len(result['rows'])} tickers in {len(COHORTS)} cohorts. SEC requests: {meta['network']} "
         f"over the network, {meta['cached']} from the scratch cache.", "",
         "Found = located in BOTH filings of the pair. `unread` tickers never reached the extractor "
         "and are outside the denominator; they are listed by name.", ""]
    for form in forms:
        L += [f"## {form}", "",
              "| Section | n (pairs read) | found | of which both sides only refer back | omitted by both filings | not_found | parse_error | found rate | found+omitted rate | end-to-end (found / all tickers) | reflowed pairs |",
              "|---|---|---|---|---|---|---|---|---|---|---|"]
        for k, v in summ[form]["sections"].items():
            rate = f"{v['found_rate']:.1%}" if v["found_rate"] is not None else "n/a"
            e2e = f"{v['found']}/{v['tickers']} = {v['end_to_end_rate']:.1%}"
            rr = f"{v['resolved_rate']:.1%}" if v.get("resolved_rate") is not None else "n/a"
            L.append(f"| {k} | {v['n']} | {v['found']} | {v.get('reference_only_both_sides', '-')} | "
                     f"{v.get('omitted', '-')} | {v['not_found']} | "
                     f"{v['parse_error']} | {rate} | {rr} | {e2e} | {v.get('reflowed_pairs', '-')} |")
        L += ["", f"Unread ({len(summ[form]['unread'])}): {', '.join(summ[form]['unread']) or 'none'}", ""]
        L += ["| Ticker | Cohort | " + " | ".join(summ[form]["sections"]) + " |",
              "|---|---|" + "---|" * len(summ[form]["sections"])]
        for row in result["rows"]:
            f = (row.get("forms") or {}).get(form) or {}
            if row.get("unread") or f.get("unread"):
                L.append(f"| {row['ticker']} | {row['cohort']} | " +
                         " | ".join(["unread"] * len(summ[form]["sections"])) + " |")
                continue
            cells = []
            for k in summ[form]["sections"]:
                sec = f["sections"][k]
                if sec["state"] == "found":
                    flag = " (ref only)" if any(sec["sides"][s].get("reference_only") for s in ("newer", "older")) else ""
                    cells.append(f"found {sec['sides']['older']['paragraphs']}->{sec['sides']['newer']['paragraphs']}{flag}")
                else:
                    bad = [s for s in ("newer", "older") if sec["sides"][s]["state"] != "found"]
                    cells.append(f"{sec['state']} ({'/'.join(bad)})")
            L.append(f"| {row['ticker']} | {row['cohort']} | " + " | ".join(cells) + " |")
        L += ["", "### Reasons", ""]
        for row in result["rows"]:
            f = (row.get("forms") or {}).get(form) or {}
            why = row.get("unread") or f.get("unread")
            if why:
                L.append(f"- **{row['ticker']}** unread: {why}")
                continue
            for k, sec in f["sections"].items():
                for s in ("newer", "older"):
                    sd = sec["sides"][s]
                    if sd["state"] not in ("found",):
                        L.append(f"- **{row['ticker']}** {k} {s} ({f[s]['accession']}): {sd['state']}: "
                                 f"{sd.get('reason') or sd.get('error')}")
        L.append("")
    return "\n".join(L)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--label", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--forms", default="10-K")
    ap.add_argument("--cache-dir", default=os.path.join(tempfile.gettempdir(), "uct-blackline-cov"))
    ap.add_argument("--tickers", default="", help="comma list; default the fixed cohort list")
    a = ap.parse_args(argv)
    if _inside_shared_root(a.out):
        raise SystemExit("refusing to write evidence inside the shared data root")
    forms = [f.strip() for f in a.forms.split(",") if f.strip()]
    tickers = [(c, t) for c, ts in COHORTS.items() for t in ts]
    if a.tickers:
        want = {t.strip().upper() for t in a.tickers.split(",")}
        tickers = [(c, t) for c, t in tickers if t in want]
    fetch = Fetcher(a.cache_dir)
    t0 = time.time()
    result = run(tickers, forms, fetch)
    import subprocess
    commit = subprocess.run(["git", "rev-parse", "--short=10", "HEAD"], cwd=REPO,
                            capture_output=True, text=True).stdout.strip()
    meta = {"measured_at": time.strftime("%Y-%m-%d %H:%M:%S %Z"), "commit": commit,
            "network": fetch.network, "cached": fetch.cached, "seconds": round(time.time() - t0, 1),
            "sec_user_agent": os.environ.get("SEC_USER_AGENT", sec_client.DEFAULT_UA),
            "sec_max_rps": sec_client._rps(), "forms": forms}
    summ = summarise(result, forms)
    os.makedirs(a.out, exist_ok=True)
    with open(os.path.join(a.out, f"{a.label}.json"), "w", encoding="utf-8") as f:
        json.dump({"meta": meta, "summary": summ, **result}, f, indent=1)
    with open(os.path.join(a.out, f"{a.label}.md"), "w", encoding="utf-8") as f:
        f.write(to_markdown(result, summ, forms, a.label, meta))
    print(json.dumps({"meta": meta, "summary": summ}, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
