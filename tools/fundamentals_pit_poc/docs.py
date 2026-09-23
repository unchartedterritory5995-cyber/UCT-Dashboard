"""Fetch the human-readable filing documents (cached) for independent checks."""
import os, re, html, json, time, urllib.request, gzip
from fetch import UA, CACHE
_last=[0.0]
def raw(url, name):
    p = os.path.join(CACHE, "docs", name); os.makedirs(os.path.dirname(p), exist_ok=True)
    if os.path.exists(p): return open(p, encoding="utf-8", errors="replace").read()
    w = 0.3 - (time.time() - _last[0])
    if w > 0: time.sleep(w)
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Encoding": "gzip"})
    with urllib.request.urlopen(req, timeout=60) as r:
        b = r.read(); b = gzip.decompress(b) if r.headers.get("Content-Encoding") == "gzip" else b
    _last[0] = time.time()
    t = b.decode("utf-8", errors="replace"); open(p, "w", encoding="utf-8").write(t); return t
def text(h):
    h = re.sub(r"(?is)<(script|style).*?</\1>", " ", h)
    h = re.sub(r"(?i)<br\s*/?>|</(p|div|tr|td|th)>", " ", h)
    t = html.unescape(re.sub(r"<[^>]+>", " ", h)).replace("\xa0", " ")
    return re.sub(r"\s+", " ", t)
def index(cik, accn):
    return raw(f"https://www.sec.gov/Archives/edgar/data/{cik}/{accn.replace('-','')}/{accn}-index.htm", f"idx_{accn}.htm")
def doc_of_type(cik, accn, typ):
    idx = index(cik, accn); out = []
    for row in re.findall(r"(?is)<tr.*?</tr>", idx):
        cells = re.findall(r"(?is)<td[^>]*>(.*?)</td>", row)
        if len(cells) >= 4 and re.sub(r"<[^>]+>", "", cells[3]).strip().upper().startswith(typ.upper()):
            m = re.search(r'href="([^"]+)"', cells[2])
            if m:
                href = m.group(1).replace("/ix?doc=", "")
                if href.lower().endswith((".htm", ".html", ".txt")):
                    out.append(text(raw("https://www.sec.gov" + href, f"doc_{accn}_{os.path.basename(href)}")))
    return " || ".join(out) if out else None
def earnings_8k_near(pages, cik, after, before):
    """8-K accessions with item 2.02 filed in [after, before]."""
    out = []
    for p in pages:
        for i, f in enumerate(p["form"]):
            if f == "8-K" and "2.02" in (p.get("items") or [""]*len(p["form"]))[i] and after <= p["filingDate"][i] <= before:
                out.append((p["filingDate"][i], p["accessionNumber"][i]))
    return sorted(out)
