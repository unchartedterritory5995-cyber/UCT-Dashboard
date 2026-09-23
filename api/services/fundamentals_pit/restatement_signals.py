"""Restating-filing signals from XBRL DIMENSIONS -- what companyfacts cannot see.

companyfacts is the right base store (every filing's copy of every
NON-dimensional fact), but a restatement disclosed only through dimensions is
invisible to it. MEASURED: CELH's FY2021 10-K (public 2022-03-16) tagged its
restated standalone quarters under `srt:RestatementAxis =
RestatementAdjustmentMember`; the first non-dimensional restated Q3 2021 value
arrived eight months later (the 2022-11-09 10-Q). In between,
Q4 = FY(restated) - 9M(original) mixed two bases (-$3.35M vs a true +$11.9M).

A SIGNAL says: filing F restated concept T for period [start, end]. It opens a
tag-scoped restatement epoch at F's public_at (knowledge.filing_epochs), so
facts of T known BEFORE F that overlap [start, end] are stale for derivation --
the derived value is WITHHELD, never replaced by a guess. A signal never
supplies a value.

VALUE-AWARE: a concept counts as restated only if an adjustment member is
non-zero, or a previously-reported value differs from the reported one.
MEASURED: CELH's same 10-K puts REVENUE on the restatement axis with nothing
changed; without this rule revenue would be withheld for no reason.

Two extractors, one meaning:
  * fs_dataset_signals -- the SEC "Financial Statement Data Sets" (quarterly
    zip, ~100 MB; num.txt carries a `segments` column). BACKFILL + nightly
    reconciliation. MEASURED 2022q1: CELH's 10-K has 82 restatement-axis rows.
  * instance_signals  -- one filing's own XBRL instance (`*_htm.xml`).
    INCREMENTAL ingestion, the moment a filing is disseminated.
"""
from __future__ import annotations

import io
import re
from datetime import date, timedelta

# Axes (FS data sets strip the prefix and the "Axis"/"Member" suffixes; the
# instance keeps them). Any member on these axes marks restated/revised data.
RESTATEMENT_AXES_FS = frozenset({
    "Restatement",                                                          # srt:RestatementAxis
    "ErrorCorrectionsAndPriorPeriodAdjustmentsRestatementByRestatementPeriodAndAmount",
    "RetrospectiveApplicationAndRetrospectiveRestatement",
})
RESTATEMENT_AXES_XML = frozenset({
    "srt:RestatementAxis",
    "us-gaap:ErrorCorrectionsAndPriorPeriodAdjustmentsRestatementByRestatementPeriodAndAmountAxis",
    "us-gaap:RetrospectiveApplicationAndRetrospectiveRestatementAxis",
    "us-gaap:RestatementAxis",                                              # pre-2019 taxonomy
})
KIND = "restatement_axis"
_STD_PREFIX = ("us-gaap", "dei", "srt", "ifrs-full")


def _span(end: date, quarters: int) -> date:
    """Start of a duration of `quarters` fiscal quarters ending at `end` (wide
    by a few days on purpose -- the span is only used for OVERLAP)."""
    return end if quarters <= 0 else end - timedelta(days=92 * quarters - 1)


def _text(fobj):
    if isinstance(fobj, io.TextIOBase) or not hasattr(fobj, "read"):
        return fobj
    return io.TextIOWrapper(fobj, encoding="utf-8", errors="replace")


def _differs(a: float, b: float) -> bool:
    return abs(a - b) > 1e-9 * max(1.0, abs(a), abs(b))


def _restated(plain_val: float | None, members: list[tuple[str, float]]) -> bool:
    """Is this (filing, concept, period) actually restated?"""
    for m, v in members:
        ml = m.lower()
        if "previously" in ml or "asoriginally" in ml or "originallyreported" in ml:
            if plain_val is None or _differs(v, plain_val):
                return True
        elif ("restated" in ml or "asrevised" in ml or "asadjusted" in ml) and "adjustment" not in ml:
            if plain_val is not None and _differs(v, plain_val):
                return True
        elif v != 0:                                     # an adjustment amount
            return True
    return False


def _emit(plain: dict, dims: dict) -> list[tuple]:
    """plain/dims keyed (accn, tag, start_iso, end_iso)."""
    out = {(a, t, s, e, KIND) for (a, t, s, e), members in dims.items()
           if _restated(plain.get((a, t, s, e)), members)}
    return sorted(out)


def fs_dataset_signals(num_txt, only_adsh: set[str] | None = None) -> list[tuple]:
    """Stream an FS data set `num.txt` (binary or text file object, or an
    iterable of lines) and return [(accn, tag, start_iso, end_iso, KIND)] for
    every RESTATED standard-taxonomy concept."""
    f = iter(_text(num_txt))
    header = next(f).rstrip("\n").split("\t")
    ix = {h: i for i, h in enumerate(header)}
    for h in ("adsh", "tag", "version", "ddate", "qtrs", "segments", "value"):
        if h not in ix:
            raise ValueError(f"not an FS data set num.txt: {header}")
    plain: dict[tuple, float] = {}
    dims: dict[tuple, list[tuple[str, float]]] = {}
    for line in f:
        p = line.rstrip("\n").split("\t")
        if len(p) < len(header) - 1:
            continue
        adsh = p[ix["adsh"]]
        if only_adsh is not None and adsh not in only_adsh:
            continue
        prefix = p[ix["version"]].split("/")[0]
        if prefix not in _STD_PREFIX:
            continue                                   # company extension: no candidate tag uses it
        try:
            val = float(p[ix["value"]])
        except ValueError:
            continue
        d = p[ix["ddate"]]
        end = date(int(d[:4]), int(d[4:6]), int(d[6:8]))
        start = _span(end, int(p[ix["qtrs"]] or 0))
        key = (adsh, f"{prefix}:{p[ix['tag']]}", start.isoformat(), end.isoformat())
        seg = p[ix["segments"]]
        if not seg:
            plain[key] = val
            continue
        parts = [x.partition("=") for x in seg.split(";") if x]
        hit = [m for ax, _, m in parts if ax in RESTATEMENT_AXES_FS]
        if hit:
            _collect(dims, key, hit[0], val, multi_axis=len(parts) > 1)
    return _emit(plain, dims)


def _is_adjustment(member: str) -> bool:
    ml = member.lower()
    return not ("previously" in ml or "asoriginally" in ml or "originallyreported" in ml
                or (("restated" in ml or "asrevised" in ml or "asadjusted" in ml) and "adjustment" not in ml))


def _collect(dims: dict, key: tuple, member: str, val: float, multi_axis: bool) -> None:
    """Single-axis rows are compared against the plain value. A row with a
    SECOND axis (CELH adds its own "standalone quarter / year-to-date basis"
    axis) has no plain counterpart, so it only counts as a non-zero
    ADJUSTMENT -- never through a previously-reported comparison."""
    if multi_axis and not _is_adjustment(member):
        return
    dims.setdefault(key, []).append((member, val))


def fs_dataset_accepted(sub_txt) -> dict[str, tuple[int, str, str]]:
    """adsh -> (cik, form, accepted 'YYYY-MM-DD HH:MM:SS.0' Eastern) from an FS
    data set sub.txt: an INDEPENDENT acceptance-time source for reconciliation
    (minute precision; the submissions JSON carries seconds)."""
    f = iter(_text(sub_txt))
    header = next(f).rstrip("\n").split("\t")
    ix = {h: i for i, h in enumerate(header)}
    out = {}
    for line in f:
        p = line.rstrip("\n").split("\t")
        if len(p) >= len(header) - 1:
            out[p[ix["adsh"]]] = (int(p[ix["cik"]]), p[ix["form"]], p[ix["accepted"]])
    return out


# ── the filing's own instance (incremental path) ────────────────────────────
_CTX = re.compile(r"<(?:xbrli:)?context\b[^>]*\bid=\"([^\"]+)\"[^>]*>(.*?)</(?:xbrli:)?context>", re.S)
_MEM = re.compile(r"<xbrldi:explicitMember[^>]*\bdimension=\"([^\"]+)\"[^>]*>([^<]+)<")
_TYPED = re.compile(r"<xbrldi:typedMember")
_START = re.compile(r"<(?:xbrli:)?startDate>(\d{4}-\d{2}-\d{2})<")
_END = re.compile(r"<(?:xbrli:)?endDate>(\d{4}-\d{2}-\d{2})<")
_INSTANT = re.compile(r"<(?:xbrli:)?instant>(\d{4}-\d{2}-\d{2})<")
_FACTV = re.compile(r"<([A-Za-z][\w\-]*):([A-Za-z]\w*)\b([^>]*)>([^<]*)</\1:\2>")
_CREF = re.compile(r"\bcontextRef=\"([^\"]+)\"")


def instance_signals(accn: str, instance_xml: str) -> list[tuple]:
    """[(accn, tag, start_iso, end_iso, KIND)] for every standard-taxonomy
    concept the filing RESTATED (value-aware, as fs_dataset_signals)."""
    plain_ctx: dict[str, tuple[str, str]] = {}
    axis_ctx: dict[str, tuple] = {}
    for cid, body in _CTX.findall(instance_xml):
        s = _START.search(body) or _INSTANT.search(body)
        e = _END.search(body) or _INSTANT.search(body)
        if not (s and e):
            continue
        mems = _MEM.findall(body)
        typed = bool(_TYPED.search(body))
        if not mems and not typed:
            plain_ctx[cid] = (s.group(1), e.group(1))
            continue
        hit = [m for d, m in mems if d in RESTATEMENT_AXES_XML]
        if hit:
            member = hit[0].strip().split(":")[-1]
            member = member[:-6] if member.endswith("Member") else member
            axis_ctx[cid] = (s.group(1), e.group(1), member, len(mems) > 1 or typed)
    if not axis_ctx:
        return []
    plain: dict[tuple, float] = {}
    dims: dict[tuple, list[tuple[str, float]]] = {}
    for prefix, concept, attrs, text in _FACTV.findall(instance_xml):
        if prefix not in _STD_PREFIX:
            continue
        m = _CREF.search(attrs)
        if not m:
            continue
        try:
            val = float(text.strip())
        except ValueError:
            continue
        cref = m.group(1)
        tag = f"{prefix}:{concept}"
        if cref in plain_ctx:
            s, e = plain_ctx[cref]
            plain[(accn, tag, s, e)] = val
        elif cref in axis_ctx:
            s, e, mem, multi = axis_ctx[cref]
            _collect(dims, (accn, tag, s, e), mem, val, multi_axis=multi)
    return _emit(plain, dims)


def restated_span(instance_xml: str) -> tuple[date, date] | None:
    """(earliest start, latest end) over restated concepts, or None.
    Whole-filing diagnostics; ingestion uses the tag-scoped signals."""
    sig = instance_signals("_", instance_xml)
    if not sig:
        return None
    return (min(date.fromisoformat(s[2]) for s in sig), max(date.fromisoformat(s[3]) for s in sig))
