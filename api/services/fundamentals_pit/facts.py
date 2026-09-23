"""Raw XBRL facts from data.sec.gov/api/xbrl/companyfacts/CIK##########.json.

MEASURED: companyfacts keeps EVERY filing's copy of a period, keyed by `accn`.
AAPL FY2019 revenue appears three times -- in the FY2019, FY2020 and FY2021
10-Ks -- so a later restatement does not erase the original. That is what makes
point-in-time reconstruction possible from this one document.

⛔ `fy` / `fp` on a fact describe the FILING that carried it, NOT the fact's own
period: the FY2021 10-K reports FY2019 revenue with fy=2021, fp=FY. Period
identity therefore comes ONLY from (start, end). Never key on fy/fp.

companyfacts carries only NON-dimensional facts (no segment/axis members), so a
fact is the entity-wide total for its concept, unit and period.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date


@dataclass(frozen=True)
class Fact:
    taxonomy: str            # 'us-gaap' | 'dei' | 'ifrs-full' | 'srt' | company prefix
    concept: str
    unit: str                # 'USD', 'USD/shares', 'shares', ...
    start: date | None       # None for an instant (balance sheet, share count)
    end: date
    val: float
    accn: str
    form: str
    filed: date
    fy: int | None           # the FILING's fiscal year (see module doc)
    fp: str | None           # the FILING's fiscal period
    frame: str | None

    @property
    def tag(self) -> str:
        return f"{self.taxonomy}:{self.concept}"

    @property
    def is_instant(self) -> bool:
        return self.start is None

    @property
    def days(self) -> int | None:
        return None if self.start is None else (self.end - self.start).days + 1

    @property
    def period_key(self) -> tuple:
        return (self.tag, self.unit, self.start, self.end)


def parse_companyfacts(doc: dict, tags: set[str] | None = None) -> list[Fact]:
    """Every fact (optionally only `tags`, 'taxonomy:Concept'), deduplicated on
    the full identity (period, value, accession). The same accession can list a
    fact twice when it appears in two statements; that is one fact."""
    out: list[Fact] = []
    seen: set[tuple] = set()
    for taxonomy, concepts in (doc.get("facts") or {}).items():
        for concept, body in concepts.items():
            tag = f"{taxonomy}:{concept}"
            if tags is not None and tag not in tags:
                continue
            for unit, rows in (body.get("units") or {}).items():
                for r in rows:
                    start = date.fromisoformat(r["start"]) if r.get("start") else None
                    ident = (tag, unit, start, r["end"], r["val"], r["accn"])
                    if ident in seen:
                        continue
                    seen.add(ident)
                    out.append(Fact(
                        taxonomy=taxonomy, concept=concept, unit=unit,
                        start=start, end=date.fromisoformat(r["end"]),
                        val=float(r["val"]), accn=r["accn"], form=r.get("form") or "",
                        filed=date.fromisoformat(r["filed"]),
                        fy=r.get("fy"), fp=r.get("fp"), frame=r.get("frame"),
                    ))
    return out
