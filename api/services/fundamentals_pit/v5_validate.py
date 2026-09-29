"""V5 VALIDATION BEFORE PUBLISH (bounded: only what a batch changed).

Per changed company:
  determinism   a fresh in-memory derivation equals the rows just stored
  invariants    no source public after the point; sources are the company's filings; no period regression; gap rules;
                finite values; no redundant repeats
  PIT guard     B = earliest public_at of anything NEW for the company in this batch (filing, facts, evidence).
                Every served point with t < B must equal the parent version's -- except split-sensitive metrics when the
                company's split rows changed or its split verification flipped (the frozen methodology re-bases per-share
                values on today's split ledger and withholds them company-wide when the ledger fails).
  withholding   every NEW company-wide split-sensitive withholding (or release) is CLASSIFIED with its evidence:
                EXPLAINED iff the company's split ledger changed in this batch, or a split-verification finding's
                window ends on/after the company's earliest newly-known filing (the new filing produced the
                finding). Otherwise UNEXPLAINED -> the company is quarantined (its previous version is kept).
  dates         a NEW point whose period ends after its day is a WARNING (frozen rule; value was public at t)
"""
from __future__ import annotations

import datetime as dt
import json
import math

from . import derive as D, store as S
from .metrics import METRICS
from .series import build_series
from .split_ledger import SPLIT_SENSITIVE_METRICS, verify

HARD = ("NONDETERMINISTIC", "LOOKAHEAD_SOURCE_AFTER_T", "SOURCE_NOT_A_FILING_OF_CIK", "PERIOD_REGRESSED",
        "GAP_WITH_SOURCES", "GAP_AS_FIRST_POINT", "GAP_NOT_NEWER_THAN_PREVIOUS", "NONFINITE_VALUE",
        "REDUNDANT_REPEAT_POINT", "RETROACTIVE_CHANGE", "UNEXPLAINED_WITHHOLDING_CHANGE")


def derive_rows(conn, cik: int) -> set[tuple]:
    """build_company's computation WITHOUT the write: the rows replace_series would store (version 5)."""
    ledger, split_rows, conflict = D.company_ledger(conn, cik)
    kb = D.load_knowledge(conn, cik)
    split_ok = conflict is None and verify(kb, ledger).ok
    metrics = [m for m in METRICS if split_ok or m not in SPLIT_SENSITIVE_METRICS]
    series = build_series(kb, metrics, ledger if split_ok else None)
    out = set()
    for metric, pts in series.items():
        for p in pts:
            accns = sorted({s[3] for s in p.sources if s[3]})
            v = 0.0 if p.method == "gap" else float(p.v)
            out.add((metric, int(p.t_eff.timestamp()), v, S.ymd(p.period_end), p.method, ",".join(accns)))
    return out


def stored_rows(conn, cik: int) -> set[tuple]:
    return set(conn.execute("SELECT metric, t_eff, v, period_end, method, sources FROM series_point "
                            "WHERE cik=? AND derivation_version=5", (cik,)))


def invariants(conn, cik: int, rows: set[tuple]) -> dict:
    fil = dict(conn.execute("SELECT accn, public_at FROM filing WHERE cik=?", (cik,)).fetchall())
    c: dict = {}
    bump = lambda k: c.__setitem__(k, c.get(k, 0) + 1)
    by_metric: dict[str, list] = {}
    for r in rows:
        by_metric.setdefault(r[0], []).append(r)
    for m, pts in by_metric.items():
        prev = None
        for _, t, v, pe, meth, src in sorted(pts, key=lambda r: r[1]):
            accns = [a for a in src.split(",") if a]
            if meth == "gap":
                if accns:
                    bump("GAP_WITH_SOURCES")
                if prev is None:
                    bump("GAP_AS_FIRST_POINT")
                elif pe <= prev[1]:
                    bump("GAP_NOT_NEWER_THAN_PREVIOUS")
            else:
                if not math.isfinite(v):
                    bump("NONFINITE_VALUE")
                for a in accns:
                    if a not in fil:
                        bump("SOURCE_NOT_A_FILING_OF_CIK")
                    elif fil[a] > t:
                        bump("LOOKAHEAD_SOURCE_AFTER_T")
                if prev and prev[2] != "gap" and prev[1] == pe and (prev[0] == v or abs(prev[0] - v) <= 1e-9 * max(1.0, abs(v), abs(prev[0]))):
                    bump("REDUNDANT_REPEAT_POINT")
            if prev and meth != "gap" and pe < prev[1]:
                bump("PERIOD_REGRESSED")
            prev = (v, pe, meth)
    return c


def _rows_before(art: dict | None, metric: str, b: int) -> list:
    if not art:
        return []
    return [r for r in (art.get("metrics") or {}).get(metric, []) if r[0] < b]


def pit_guard(parent: dict | None, new: dict, boundary: int | None, *, split_changed: bool) -> dict:
    """Metrics whose history before `boundary` changed, split into allowed (split-sensitive, explained) and not."""
    if parent is None or boundary is None:
        return {"retro_allowed": [], "retro_unexplained": []}
    flip = bool(parent.get("withheld_split_sensitive")) != bool(new.get("withheld_split_sensitive"))
    allowed, bad = [], []
    for m in sorted(set(parent.get("metrics") or {}) | set(new.get("metrics") or {})):
        if _rows_before(parent, m, boundary) != _rows_before(new, m, boundary):
            (allowed if (m in SPLIT_SENSITIVE_METRICS and (split_changed or flip)) else bad).append(m)
    return {"retro_allowed": allowed, "retro_unexplained": bad, "withholding_flip": flip}


def classify_withholding(conn, cik: int, parent: dict | None, new: dict, boundary: int | None,
                         split_changed: bool, new_accns: list | None = None) -> dict | None:
    """None when the withholding status did not change; else the evidence record + EXPLAINED/UNEXPLAINED."""
    if parent is None:
        return None
    was, now_ = bool(parent.get("withheld_split_sensitive")), bool(new.get("withheld_split_sensitive"))
    if was == now_:
        return None
    info = S.build_info(conn, cik, 5) or {"detail": {}}
    ver = (info["detail"] or {}).get("split_verification") or {}
    reasons = ver.get("reasons") or []
    bday = dt.datetime.fromtimestamp(boundary, dt.timezone.utc).date().isoformat() if boundary else None
    triggered_by_new = [r for r in reasons if isinstance(r, (list, tuple)) and len(r) >= 3 and r[0] == "window_disagrees"
                        and bday is not None and str(r[2]) >= bday]
    conflict = [r for r in reasons if isinstance(r, (list, tuple)) and r and r[0] == "ledger_conflict"]
    fam = sorted(m for m in set(parent.get("metrics") or {}) | set(new.get("metrics") or {}) if m in SPLIT_SENSITIVE_METRICS)
    removed = sum(len((parent.get("metrics") or {}).get(m, [])) for m in fam) if now_ else 0
    if now_:
        explained = bool(split_changed or triggered_by_new or (conflict and split_changed))
    else:                                              # released: the new data/ledger made verification pass again
        explained = bool(split_changed or boundary is not None)
    return {"cik": cik, "direction": "withheld" if now_ else "released",
            "classification": "EXPLAINED" if explained else "UNEXPLAINED",
            "rule": "split_ledger.verify: split-sensitive metrics are withheld company-wide while the ledger is unverified "
                    "(derive.build_company, frozen V5 methodology)",
            "triggering_filings": new_accns or [], "boundary": boundary, "split_ledger_changed": split_changed,
            "verification_status": ver.get("status"), "findings": reasons[:6], "findings_from_new_filings": triggered_by_new[:6],
            "affected_metric_families": fam, "previously_served_points_removed": removed}


def new_impossible_dates(new: dict, boundary: int | None) -> list:
    out = []
    for m, pts in (new.get("metrics") or {}).items():
        for t, v, pe, meth in pts:
            if boundary is not None and t < boundary:
                continue
            day = dt.datetime.fromtimestamp(t, dt.timezone.utc).date()
            x = str(pe).replace("-", "")
            pd = dt.date(int(x[:4]), int(x[4:6]), int(x[6:8]))
            if pd > day:
                out.append([m, t, pe])
    return out


def validate_company(conn, cik: int, *, parent: dict | None, new: dict, boundary: int | None,
                     split_changed: bool, new_accns: list | None = None) -> dict:
    rows = stored_rows(conn, cik)
    counts = invariants(conn, cik, rows)
    if derive_rows(conn, cik) != rows:
        counts["NONDETERMINISTIC"] = 1
    guard = pit_guard(parent, new, boundary, split_changed=split_changed)
    if guard["retro_unexplained"]:
        counts["RETROACTIVE_CHANGE"] = len(guard["retro_unexplained"])
    wh = classify_withholding(conn, cik, parent, new, boundary, split_changed, new_accns)
    if wh and wh["classification"] == "UNEXPLAINED":
        counts["UNEXPLAINED_WITHHOLDING_CHANGE"] = 1
    errors = {k: v for k, v in counts.items() if k in HARD and v}
    return {"cik": cik, "ok": not errors, "errors": errors, "guard": guard, "withholding": wh,
            "warnings": {"impossible_dates_new": new_impossible_dates(new, boundary)[:20]}}
