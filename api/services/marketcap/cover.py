"""Structural parser for an XBRL filing's rendered COVER report (R1.htm-style, found via FilingSummary.xml).

The rendered report names every row by concept (`defref_dei_EntityCommonStockSharesOutstanding`) and every
dimensional section by axis member (`defref_us-gaap_StatementClassOfStockAxis=us-gaap_CommonClassBMember`), so
per-class share counts, trading symbols and 12(b) titles are read STRUCTURALLY -- no free-text guessing.
Companyfacts drops every dimensional fact; this is where per-class evidence lives.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date, datetime
from html.parser import HTMLParser

SCALE = {"thousands": 1e3, "millions": 1e6, "billions": 1e9}
COVER_NAMES = re.compile(r"cover|document\s+and\s+entity|entity\s+information|document\s+information", re.I)


class _Table(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.rows: list[dict] = []
        self.in_table = 0
        self.cur = None
        self.cell = None

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "table" and "report" in (a.get("class") or ""):
            self.in_table += 1
        if not self.in_table:
            return
        if tag == "tr":
            self.cur = {"cls": a.get("class") or "", "cells": []}
        elif tag in ("td", "th") and self.cur is not None:
            self.cell = {"tag": tag, "cls": a.get("class") or "", "colspan": int(a.get("colspan") or 1),
                         "rowspan": int(a.get("rowspan") or 1), "text": "", "ref": ""}
        elif tag == "a" and self.cell is not None:
            m = re.search(r"defref_([^']+)'", a.get("onclick") or "")
            if m:
                self.cell["ref"] = m.group(1)
        elif tag == "br" and self.cell is not None:
            self.cell["text"] += " "
        elif tag == "div" and self.cell is not None and self.cell["tag"] == "th":
            self.cell["text"] += "\x1f"

    def handle_endtag(self, tag):
        if not self.in_table:
            return
        if tag in ("td", "th") and self.cell is not None and self.cur is not None:
            parts = [re.sub(r"\s+", " ", x).strip() for x in self.cell["text"].split("\x1f")]
            parts = [x for x in parts if x]
            self.cell["parts"] = parts
            self.cell["text"] = " ".join(parts)
            self.cur["cells"].append(self.cell)
            self.cell = None
        elif tag == "tr" and self.cur is not None:
            self.rows.append(self.cur)
            self.cur = None
        elif tag == "table":
            self.in_table -= 1

    def handle_data(self, data):
        if self.cell is not None:
            self.cell["text"] += data


def _date(s: str) -> date | None:
    s = re.sub(r"\s+", " ", s.replace(".", "")).strip()
    for fmt in ("%b %d, %Y", "%B %d, %Y"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            pass
    return None


UNIT_WORDS = {"shares", "usd ($)", "usd", "pure", "eur (€)", "$"}


def _head(c: dict) -> tuple:
    """A header cell -> (date, member label). Old reports stack `date / member / unit` as divs."""
    parts = c.get("parts") or [c["text"]]
    d = _date(parts[0]) if parts else None
    rest = [x for x in parts[1:] if x.lower() not in UNIT_WORDS and not re.fullmatch(r"[A-Z]{3} \(.*\)", x)]
    return d, (rest[0] if rest else None)


@dataclass
class Cover:
    title: str
    share_scale: float
    columns: list                      # column index -> date | None
    col_members: list = field(default_factory=list)   # column index -> member label (old column layout) | None
    facts: list = field(default_factory=list)   # (member | None, member_label | None, concept, col, text)

    def by_member(self) -> dict:
        out: dict = {}
        for mem, lab, concept, col, text in self.facts:
            d = out.setdefault(mem, {"label": lab, "facts": {}})
            d["facts"].setdefault(concept, []).append((self.columns[col] if col < len(self.columns) else None, text))
        return out


def parse(html: str) -> Cover | None:
    p = _Table()
    p.feed(html)
    rows = p.rows
    if not rows:
        return None
    heads = [r for r in rows if r["cells"] and all(c["tag"] == "th" for c in r["cells"])]
    if not heads:
        return None
    title = heads[0]["cells"][0]["text"]
    m = re.search(r"shares in (thousands|millions|billions)", title, re.I)
    scale = SCALE[m.group(1).lower()] if m else 1.0
    # column dates: walk header row 1; a rowspan-2 th is its own column, others are groups filled from row 2
    cols: list = []
    r1 = heads[0]["cells"][1:]
    r2 = list(heads[1]["cells"]) if len(heads) > 1 else []
    for c in r1:
        if c["rowspan"] >= 2 or not r2:
            cols.extend([_head(c)] * c["colspan"])
        else:
            for _ in range(c["colspan"]):
                cols.append(_head(r2.pop(0)) if r2 else (None, None))
    cols.extend(_head(c) for c in r2)
    cov = Cover(title, scale, [d for d, _m in cols], [m for _d, m in cols])
    member, mlabel = None, None
    for r in rows:
        cells = r["cells"]
        if not cells or cells[0]["tag"] != "td":
            continue
        ref = cells[0]["ref"]
        if "Axis=" in ref:
            member, mlabel = ref.split("Axis=", 1)[1], cells[0]["text"]
            ax = ref.split("Axis=", 1)[0]
            if "StatementClassOfStock" not in ax and "ClassOfStock" not in ax:
                member = f"{ax}={member}"          # a non-class axis (business contact, legal entity...)
            continue
        if not ref:
            continue
        concept = ref.replace("_", ":", 1)
        for i, c in enumerate(cells[1:]):
            t = c["text"].strip()
            if t and t != "\xa0":
                cm = cov.col_members[i] if i < len(cov.col_members) else None
                if cm and member is None:
                    cov.facts.append((f"col:{cm}", cm, concept, i, t))
                else:
                    cov.facts.append((member, mlabel, concept, i, t))
    return cov


def num(text: str) -> float | None:
    t = text.replace(",", "").replace("$", "").strip()
    neg = t.startswith("(") and t.endswith(")")
    t = t.strip("()")
    try:
        v = float(t)
    except ValueError:
        return None
    return -v if neg else v


@dataclass
class ClassRow:
    member: str | None                 # None = the non-dimensional (entity) section
    label: str | None
    shares: list                       # [(as_of, shares)]
    symbols: list                      # trading symbols in this section
    titles: list                       # 12(b) titles in this section


def classes(cov: Cover) -> list[ClassRow]:
    out = []
    for mem, d in cov.by_member().items():
        if mem and "=" in mem:
            continue
        f = d["facts"]
        sh = []
        for dt, t in f.get("dei:EntityCommonStockSharesOutstanding", []):
            v = num(t)
            if v is not None:
                sh.append((dt, v * cov.share_scale))
        sym = [t for _dt, t in f.get("dei:TradingSymbol", [])]
        ttl = [t for _dt, t in f.get("dei:Security12bTitle", [])]
        if sh or sym or ttl:
            out.append(ClassRow(mem, d["label"], sh, sym, ttl))
    return out


def parse_xml(xml: str) -> Cover | None:
    """The pre-2013 rendered report format (`InstanceReport` XML, R<n>.xml)."""
    import xml.etree.ElementTree as ET
    try:
        root = ET.fromstring(xml.encode("utf-8") if isinstance(xml, str) else xml)
    except ET.ParseError:
        return None
    title = (root.findtext("ReportName") or "").strip()
    rnd = (root.findtext("RoundingOption") or "").lower()
    cols, cmem = [], []
    for c in root.iter("Column"):
        labels = [l.get("Label") or "" for l in c.iter("Label")]
        d = next((x for x in (_date(l) for l in labels) if x), None)
        seg = [s.findtext("Label") for s in c.iter("Segment")]
        cols.append(d)
        cmem.append(seg[0].strip() if seg and seg[0] else None)
    # NumericAmount is the unscaled value; RoundingOption only governs display
    cov = Cover(title, 1.0, cols, cmem)
    member = None
    for r in root.iter("Row"):
        if (r.findtext("IsSegmentTitle") or "").lower() == "true":
            member = "seg:" + (r.findtext("Label") or "").strip()
            continue
        concept = (r.findtext("ElementName") or "").replace("_", ":", 1)
        if not concept:
            continue
        for i, cell in enumerate(r.iter("Cell")):
            if (cell.findtext("IsNumeric") or "").lower() == "true":
                t = cell.findtext("NumericAmount") or ""
            else:
                t = (cell.findtext("NonNumbericText") or "").strip()
            if not t:
                continue
            cm = cmem[i] if i < len(cmem) else None
            if cm and member is None:
                cov.facts.append((f"col:{cm}", cm, concept, i, t))
            else:
                cov.facts.append((member, member[4:] if member else None, concept, i, t))
    return cov


def find_cover_files(filing_summary_xml: str) -> list[str]:
    """HtmlFileName (2013+) or XmlFileName (2009-2012) of every cover / DEI report (old filings split the DEI
    into 'Document Information' + 'Entity Information'; the caller merges them)."""
    reps = re.findall(r"<Report[^>]*>(.*?)</Report>", filing_summary_xml, re.S)
    out = []
    for r in reps:
        fn = re.search(r"<(?:Html|Xml)FileName>(.*?)</(?:Html|Xml)FileName>", r)
        sn = re.search(r"<ShortName>(.*?)</ShortName>", r)
        if fn and sn and COVER_NAMES.search(sn.group(1)) and fn.group(1) not in out:
            out.append(fn.group(1))
    return out[:3]


def parse_any(fn: str, body: bytes) -> Cover | None:
    txt = body.decode("utf-8", "replace")
    return parse_xml(txt) if fn.lower().endswith(".xml") else parse(txt)
