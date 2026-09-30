"""The economic-series registry: load, look up, and VALIDATE `registry/series.json`.

`series.json` is hand-edited from Phase 1 on (the one-shot importer that built it
from the Phase 0 catalog is `tools/econ/import_catalog.py`, kept for provenance).
`validate_registry()` is the gate every edit passes: it returns a list of error
strings (empty = valid) and implements every rail in PHASE1-DESIGN.md
"Registry entry". The econ service asserts it at import time; the tests run it
over the committed file and over hand-built bad entries (negative controls).

Entries are plain dicts with the design-doc keys. Treat them as READ-ONLY: the
cached registry is shared by every caller in the process.

units.scale is ALWAYS the multiplier from the stored value to the base unit
(USD, persons, barrels, cubic feet, count): 'Millions USD' -> 1e6, 'Thousands of
jobs' -> 1e3, 'Billion cubic feet' -> 1e9. Formatters pick the display from fmt.
"""
from __future__ import annotations

import builtins
import json
import re
import threading
from pathlib import Path
from typing import Any, Iterable, Optional

from . import licensing
from .model import (Clearance, Frequency, LicenseClass, PitClass, Presentation, Role,
                    SchedulePrecision, SeriesStatus, WeekAnchor, canonical_id, parse_canonical)

_builtin_all = builtins.all

REGISTRY_DIR = Path(__file__).with_name("registry")
SERIES_PATH = REGISTRY_DIR / "series.json"
ATTRIBUTIONS_PATH = REGISTRY_DIR / "attributions.json"

# Adapter names a registry entry may name. A new provider family adds its name
# here AND its module under adapters/ (adapters.base.register) in the same edit.
KNOWN_ADAPTERS = frozenset({
    "bls", "bea", "census", "fed_ddp", "fed_policy", "nyfed", "nyfed_esms", "fiscaldata", "eia",
    "dol", "fhfa", "treasury_curve", "treasury_tic", "derived", "regional_fed_file", "freddie",
    "proprietary",
})
# Adapters that can never back an enabled series (no licensed ingestion path).
NEVER_ENABLED_ADAPTERS = frozenset({"proprietary"})

FMTS = frozenset({"num0", "num1", "num2", "num3", "pct1", "pct2", "pp2", "bps0", "usd_compact",
                  "k_persons", "mbbl", "bcf", "usd3"})
SEASONAL = frozenset({"SA", "NSA", "SAAR", "NSA-based", "SA-based", "mixed"})
REVISION_TYPES = frozenset({"none", "minor_routine", "annual_benchmark", "comprehensive",
                            "seasonal_factor_revision"})
# Ops derive.py computes. Anything else may exist on a non-enabled entry only.
SUPPORTED_OPS = frozenset({"yoy_pct", "mom_pct", "pct_change", "diff", "spread", "ratio_pct", "ratio",
                           "sub", "sma", "sum"})
SUPPORTED_TRANSFORMS = frozenset({"eop_q"})
LAG_KINDS = frozenset({"period_end_plus_days", "period_start_plus_days", "business_days_after",
                       "derived", "unknown"})
_TIME_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
REQUIRED_KEYS = ("symbol", "name", "short_name", "description", "category", "subcategory", "country",
                 "role", "status", "cohort", "source", "frequency", "week_anchor", "units",
                 "seasonal_adjustment", "history_start", "release", "revision", "pit", "derivation",
                 "licensing", "aliases", "synonyms", "presentation", "catalog_row")

_lock = threading.Lock()
_cache: dict[str, Any] = {}


# ------------------------------------------------------------------ loading

def _read_json(path: Path):
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def load_registry(*, reload: bool = False) -> list[dict]:
    """The registry entries (cached per process). Read-only by convention."""
    with _lock:
        if reload or "entries" not in _cache:
            entries = _read_json(SERIES_PATH)
            if not isinstance(entries, list):
                raise ValueError(f"{SERIES_PATH} must hold a JSON list")
            _cache["entries"] = entries
            _cache["by_symbol"] = {e["symbol"]: e for e in entries if isinstance(e, dict) and "symbol" in e}
        return _cache["entries"]


def load_attributions(*, reload: bool = False) -> dict:
    with _lock:
        if reload or "attributions" not in _cache:
            data = _read_json(ATTRIBUTIONS_PATH)
            _cache["attributions"] = {k: v for k, v in data.items() if not k.startswith("_")}
        return _cache["attributions"]


def _by_symbol() -> dict[str, dict]:
    load_registry()
    return _cache["by_symbol"]


def _symbol_of(symbol_or_canonical: str) -> Optional[str]:
    if not isinstance(symbol_or_canonical, str):
        return None
    s = symbol_or_canonical.strip()
    if ":" in s:
        return parse_canonical(s)
    return s.upper() or None


def get(symbol_or_canonical: str) -> Optional[dict]:
    """Entry for 'USCPI' | 'ECON:USCPI' | 'econ:uscpi', else None."""
    sym = _symbol_of(symbol_or_canonical)
    return _by_symbol().get(sym) if sym else None


def canonical(symbol: str) -> Optional[str]:
    """'USCPI' -> 'ECON:USCPI' when the registry knows it, else None."""
    e = get(symbol)
    return canonical_id(e["symbol"]) if e else None


def all() -> list[dict]:  # noqa: A001 -- the contract names it all()
    return list(load_registry())


def enabled() -> list[dict]:
    return [e for e in load_registry() if e.get("status") == SeriesStatus.ENABLED.value]


def cohort() -> list[dict]:
    return [e for e in load_registry() if e.get("cohort") is True]


# ─── staleness: how long a published value stays the CURRENT value ───────────
# Measured from AVAILABILITY (the point's `t`), not from period end: a value is
# valid until the next release is expected, plus grace. Defaults per frequency,
# checked against every enabled series' consecutive first-availability gaps in
# the local DB (2026-09-29): outside funding lapses / agency outages the max is
# D 8 d (holiday weekends), W 12.6 d (EIA Christmas-2025 schedule; the 2022/2023
# WPSR outages are 14.0 d and SHOULD break), M 33 d, Q 98 d.
# None = unlimited (a policy target holds until replaced).
MAX_AGE_DAYS = {"D": 10, "W": 13, "M": 45, "Q": 120, "A": 400, "IRREG": None}


def max_age_days(entry: dict) -> Optional[int]:
    """Days a value stays current after its availability (`t`). Registry override:
    `presentation.max_age_days` (a positive number, or null = unlimited)."""
    pres = entry.get("presentation") if isinstance(entry.get("presentation"), dict) else {}
    for src in (pres, entry):                    # top-level `max_age_days` = legacy spelling
        if "max_age_days" in src:
            v = src["max_age_days"]
            return None if v is None else int(v) if float(v).is_integer() else v
    return MAX_AGE_DAYS.get(str(entry.get("frequency") or "").upper(), None)


def members_for_search() -> list[dict]:
    """What a member can discover: enabled MEMBER series (support series are inputs only)."""
    return [e for e in enabled() if e.get("role") == Role.MEMBER.value]


def search_view() -> list[dict]:
    """Rows for Phase 2 search (the Add Indicator econ tab / symbol search).

    Discovery only -- no licensing internals, adapter params or keys."""
    rows = []
    for e in members_for_search():
        rows.append({
            "symbol": e["symbol"],
            "id": canonical_id(e["symbol"]),
            "name": e["name"],
            "short_name": e["short_name"],
            "category": e["category"],
            "subcategory": e["subcategory"],
            "frequency": e["frequency"],
            "week_anchor": e["week_anchor"],
            "units": {"display": e["units"]["display"], "fmt": e["units"]["fmt"], "scale": e["units"]["scale"]},
            "seasonal_adjustment": e["seasonal_adjustment"],
            "presentation": e["presentation"],
            "agency": e["source"]["agency"],
            "aliases": list(e["aliases"]),
            "synonyms": list(e["synonyms"]),
            "history_start": e["history_start"],
        })
    return rows


# ------------------------------------------------------------------ equity collisions

def equity_symbols() -> frozenset[str]:
    """Every committed equity/ETF symbol UCT knows (api/data/cap_universe.json +
    prebuilt_etfs.json via api.services.cap_universe). Empty set if unavailable --
    the caller must treat empty as "cannot check", which validate_registry does
    by reporting it."""
    try:
        from api.services import cap_universe
        return frozenset(cap_universe.symbols()) | frozenset(cap_universe.etf_symbols())
    except Exception:  # noqa: BLE001
        return frozenset()


def equity_collisions(entries: Optional[Iterable[dict]] = None,
                      equity: Optional[Iterable[str]] = None) -> list[tuple[str, str]]:
    """[(symbol, status)] for every display symbol that is also a real ticker."""
    entries = list(load_registry() if entries is None else entries)
    eq = frozenset(s.upper() for s in (equity_symbols() if equity is None else equity))
    return [(e.get("symbol"), e.get("status")) for e in entries
            if isinstance(e, dict) and str(e.get("symbol", "")).upper() in eq]


# ------------------------------------------------------------------ validation

def _enum_values(enum) -> frozenset[str]:
    return frozenset(m.value for m in enum)


def _norm_alias(a: str) -> str:
    return re.sub(r"\s+", " ", a.strip().lower())


def _identity_key(e: dict):
    src = e.get("source") or {}
    try:
        params = json.dumps(src.get("params") or {}, sort_keys=True)
    except Exception:  # noqa: BLE001
        params = str(src.get("params"))
    return (src.get("adapter"), src.get("provider_series_id"), params)


def validate_registry(entries: Optional[list] = None, *, attributions: Optional[dict] = None,
                      equity: Optional[Iterable[str]] = None) -> list[str]:
    """Every rail in PHASE1-DESIGN.md "Registry entry". [] = valid.

    `entries` defaults to the committed series.json, `attributions` to
    attributions.json, `equity` to the committed cap universe + ETF list."""
    entries = list(load_registry() if entries is None else entries)
    attributions = load_attributions() if attributions is None else attributions
    eq = frozenset(s.upper() for s in (equity_symbols() if equity is None else equity))
    errs: list[str] = []
    E = errs.append

    statuses, roles = _enum_values(SeriesStatus), _enum_values(Role)
    freqs, anchors = _enum_values(Frequency), _enum_values(WeekAnchor)
    styles, classes = _enum_values(Presentation), _enum_values(LicenseClass)
    clearances, precisions = _enum_values(Clearance), _enum_values(SchedulePrecision)
    pit_classes = _enum_values(PitClass)

    by_sym: dict[str, dict] = {}
    alias_owner: dict[str, str] = {}

    # ---- pass 1: per-entry shape
    for i, e in enumerate(entries):
        if not isinstance(e, dict):
            E(f"entry #{i}: not an object")
            continue
        sym = e.get("symbol")
        tag = sym or f"entry #{i}"
        missing = [k for k in REQUIRED_KEYS if k not in e]
        if missing:
            E(f"{tag}: missing keys {missing}")
            continue
        if not isinstance(sym, str) or not sym:
            E(f"{tag}: symbol must be a non-empty string")
            continue
        if sym in by_sym:
            E(f"{sym}: duplicate symbol")
            continue
        by_sym[sym] = e
        # ECON:<symbol> parses back to the same symbol
        if parse_canonical(canonical_id(sym)) != sym:
            E(f"{sym}: canonical id {canonical_id(sym)!r} does not parse back (symbol shape)")
        # enums
        if e["status"] not in statuses:
            E(f"{sym}: status {e['status']!r} not in {sorted(statuses)}")
        if e["role"] not in roles:
            E(f"{sym}: role {e['role']!r} invalid")
        if not isinstance(e["cohort"], bool):
            E(f"{sym}: cohort must be a bool")
        if e["frequency"] not in freqs:
            E(f"{sym}: frequency {e['frequency']!r} invalid")
        if e["week_anchor"] not in anchors:
            E(f"{sym}: week_anchor {e['week_anchor']!r} invalid")
        if e["frequency"] != Frequency.WEEKLY.value and e["week_anchor"]:
            E(f"{sym}: week_anchor set on a non-weekly series")
        if e["seasonal_adjustment"] not in SEASONAL:
            E(f"{sym}: seasonal_adjustment {e['seasonal_adjustment']!r} invalid")
        if (e.get("presentation") or {}).get("style") not in styles:
            E(f"{sym}: presentation.style invalid")
        if isinstance(e.get("presentation"), dict) and "max_age_days" in e["presentation"]:
            ma = e["presentation"]["max_age_days"]
            if ma is not None and (isinstance(ma, bool) or not isinstance(ma, (int, float)) or not ma > 0):
                E(f"{sym}: presentation.max_age_days must be a positive number or null")
        # units
        u = e["units"] if isinstance(e["units"], dict) else {}
        if u.get("fmt") not in FMTS:
            E(f"{sym}: units.fmt {u.get('fmt')!r} not in {sorted(FMTS)}")
        sc = u.get("scale")
        if isinstance(sc, bool) or not isinstance(sc, (int, float)) or not sc > 0:
            E(f"{sym}: units.scale must be a positive number")
        if not u.get("display"):
            E(f"{sym}: units.display empty")
        # source
        src = e["source"] if isinstance(e["source"], dict) else {}
        adapter = src.get("adapter")
        if adapter not in KNOWN_ADAPTERS:
            E(f"{sym}: adapter {adapter!r} does not exist (known: {sorted(KNOWN_ADAPTERS)})")
        if not isinstance(src.get("verified"), bool):
            E(f"{sym}: source.verified must be a bool")
        if not isinstance(src.get("params"), dict):
            E(f"{sym}: source.params must be an object")
        if src.get("verified") and not str(src.get("verified_evidence") or "").strip():
            E(f"{sym}: source.verified without verified_evidence")
        # revision / pit
        rev = (e["revision"] or {}).get("type")
        if rev not in REVISION_TYPES:
            E(f"{sym}: revision.type {rev!r} invalid")
        bc = (e["pit"] or {}).get("backfill_class")
        if bc not in pit_classes or bc not in ("U", "L"):
            E(f"{sym}: pit.backfill_class {bc!r} must be U or L")
        elif (bc == "U") != (rev == "none"):
            E(f"{sym}: pit.backfill_class {bc} contradicts revision.type {rev} (U only when revision none)")
        # release
        rel = e["release"] if isinstance(e["release"], dict) else {}
        if not rel.get("calendar_key"):
            E(f"{sym}: release.calendar_key empty")
        t = rel.get("typical_time_et")
        if t is not None and not (isinstance(t, str) and _TIME_RE.match(t)):
            E(f"{sym}: release.typical_time_et {t!r} must be HH:MM or null")
        if rel.get("precision_hint") not in precisions:
            E(f"{sym}: release.precision_hint {rel.get('precision_hint')!r} invalid")
        if rel.get("precision_hint") == SchedulePrecision.EXACT.value and t is None:
            E(f"{sym}: precision exact without a typical_time_et")
        lag = rel.get("lag_rule") if isinstance(rel.get("lag_rule"), dict) else {}
        if lag.get("kind") not in LAG_KINDS:
            E(f"{sym}: release.lag_rule.kind {lag.get('kind')!r} invalid")
        elif lag.get("kind") in ("period_end_plus_days", "period_start_plus_days", "business_days_after"):
            d = lag.get("days")
            if isinstance(d, bool) or not isinstance(d, int) or d < 0:
                E(f"{sym}: release.lag_rule.days must be an int >= 0")
            lt = lag.get("time_et")
            if lt is not None and not (isinstance(lt, str) and _TIME_RE.match(lt)):
                E(f"{sym}: release.lag_rule.time_et {lt!r} must be HH:MM or null")
        # licensing enums
        lic = e["licensing"] if isinstance(e["licensing"], dict) else {}
        if lic.get("class") not in classes:
            E(f"{sym}: licensing.class {lic.get('class')!r} invalid")
        if lic.get("clearance") not in clearances:
            E(f"{sym}: licensing.clearance {lic.get('clearance')!r} invalid")
        if lic.get("clearance") == Clearance.PERMISSION_GRANTED.value and not str(lic.get("approval_ref") or "").strip():
            E(f"{sym}: permission_granted without approval_ref")
        if lic.get("class") == LicenseClass.RED.value and e["status"] != SeriesStatus.EXCLUDED.value:
            E(f"{sym}: RED series must be status excluded (is {e['status']})")
        if lic.get("notice_required"):
            key = lic.get("attribution_key")
            if not key or key not in attributions:
                E(f"{sym}: notice_required but attribution_key {key!r} does not resolve in attributions.json")
        for k in lic.get("attribution_keys") or []:
            if k not in attributions:
                E(f"{sym}: attribution_keys entry {k!r} does not resolve in attributions.json")
        # FRED is never a source (owner ruling #10) -- only an excluded record may name it
        if licensing.is_fred_source(e) and e["status"] != SeriesStatus.EXCLUDED.value:
            E(f"{sym}: FRED/ALFRED source on a non-excluded series (FRED is never a production source)")
        # aliases / synonyms normalized
        for field in ("aliases", "synonyms"):
            vals = e[field]
            if not isinstance(vals, list) or not _builtin_all(isinstance(v, str) for v in vals):
                E(f"{sym}: {field} must be a list of strings")
                continue
            for v in vals:
                if v != _norm_alias(v) or not v:
                    E(f"{sym}: {field} value {v!r} not normalized (lower-case, trimmed, single-spaced)")
            if len(set(vals)) != len(vals):
                E(f"{sym}: {field} has duplicates")
        for a in e["aliases"] if isinstance(e["aliases"], list) else []:
            if not isinstance(a, str):
                continue
            owner = alias_owner.get(a)
            if owner and owner != sym:
                E(f"{sym}: alias {a!r} already belongs to {owner} (aliases must be globally unique)")
            else:
                alias_owner[a] = sym

    # an alias may not equal ANOTHER series' symbol (search would resolve it wrongly)
    lower_syms = {s.lower(): s for s in by_sym}
    for a, owner in alias_owner.items():
        other = lower_syms.get(a)
        if other and other != owner:
            E(f"{owner}: alias {a!r} is the symbol of {other}")

    # ---- pass 2: derivations (inputs exist, supported, acyclic)
    graph: dict[str, list[str]] = {}
    for sym, e in by_sym.items():
        d = e["derivation"]
        adapter = (e["source"] or {}).get("adapter")
        if d is None:
            if adapter == "derived":
                E(f"{sym}: adapter 'derived' but derivation is null")
            continue
        if not isinstance(d, dict):
            E(f"{sym}: derivation must be an object or null")
            continue
        if adapter != "derived":
            E(f"{sym}: has a derivation but adapter is {adapter!r} (must be 'derived')")
        op, inputs = d.get("op"), d.get("inputs")
        if not isinstance(inputs, list) or not inputs:
            E(f"{sym}: derivation.inputs must be a non-empty list")
            inputs = []
        if not isinstance(d.get("params", {}), dict):
            E(f"{sym}: derivation.params must be an object")
        v = d.get("version")
        if isinstance(v, bool) or not isinstance(v, int) or v < 1:
            E(f"{sym}: derivation.version must be an int >= 1")
        graph[sym] = [i for i in inputs if isinstance(i, str)]
        for inp in graph[sym]:
            if inp not in by_sym:
                E(f"{sym}: derivation input {inp!r} missing from the registry")
        transforms = (d.get("params") or {}).get("transforms") or {}
        bad_tr = {k: t for k, t in transforms.items() if t not in SUPPORTED_TRANSFORMS} if isinstance(transforms, dict) else {"?": transforms}
        for k in (transforms if isinstance(transforms, dict) else {}):
            if k not in graph[sym]:
                E(f"{sym}: transform names {k!r}, which is not an input")
        if e["status"] == SeriesStatus.ENABLED.value:
            if op not in SUPPORTED_OPS:
                E(f"{sym}: enabled but derivation op {op!r} is not computable by derive.py")
            if bad_tr:
                E(f"{sym}: enabled but input transform(s) {bad_tr} not supported")

    # cycle detection (iterative DFS, reports each cycle once)
    WHITE, GREY, BLACK = 0, 1, 2
    color = {s: WHITE for s in graph}
    reported: set[frozenset] = set()
    for root in graph:
        if color[root] != WHITE:
            continue
        stack = [(root, iter(graph[root]))]
        path = [root]
        color[root] = GREY
        while stack:
            node, it = stack[-1]
            nxt = next(it, None)
            if nxt is None:
                color[node] = BLACK
                stack.pop()
                path.pop()
                continue
            if nxt not in graph:
                continue
            if color[nxt] == GREY:
                cyc = path[path.index(nxt):] + [nxt]
                key = frozenset(cyc)
                if key not in reported:
                    reported.add(key)
                    E(f"{nxt}: circular derivation {' -> '.join(cyc)}")
            elif color[nxt] == WHITE:
                color[nxt] = GREY
                path.append(nxt)
                stack.append((nxt, iter(graph[nxt])))

    # ---- pass 3: production rails on enabled entries
    enabled_ids: dict = {}
    for sym, e in by_sym.items():
        if e["status"] != SeriesStatus.ENABLED.value:
            continue
        src = e["source"] or {}
        ok, why = licensing.production_eligible(e)
        if not ok:
            E(f"{sym}: enabled but not production-eligible: {why}")
        lic = e["licensing"] or {}
        if lic.get("clearance") not in (Clearance.CLEARED.value, Clearance.PERMISSION_GRANTED.value):
            E(f"{sym}: enabled with clearance {lic.get('clearance')!r}")
        if lic.get("class") == LicenseClass.RED.value:
            E(f"{sym}: enabled RED series")
        if not src.get("verified"):
            E(f"{sym}: enabled but source.verified is false")
        if src.get("adapter") in NEVER_ENABLED_ADAPTERS:
            E(f"{sym}: enabled on adapter {src.get('adapter')!r}")
        if e["frequency"] == Frequency.WEEKLY.value and not e["week_anchor"]:
            E(f"{sym}: enabled weekly series without a week_anchor")
        lag_kind = ((e["release"] or {}).get("lag_rule") or {}).get("kind")
        if lag_kind == "unknown":
            E(f"{sym}: enabled without a backfill lag rule")
        if src.get("adapter") != "derived" and lag_kind == "derived":
            E(f"{sym}: lag_rule 'derived' on a non-derived series")
        if (str(e["symbol"]).upper() in eq):
            E(f"{sym}: enabled display symbol collides with a real equity/ETF ticker")
        if e["derivation"]:
            for inp in e["derivation"].get("inputs") or []:
                p = by_sym.get(inp)
                if p is None:
                    continue
                p_ok = p["status"] == SeriesStatus.ENABLED.value or (
                    p["role"] == Role.SUPPORT.value and (p["source"] or {}).get("verified")
                    and licensing.production_eligible(p)[0])
                if not p_ok:
                    E(f"{sym}: enabled derived series has input {inp} that is {p['status']} "
                      f"(inputs must be enabled, or verified support series)")
        else:
            ident = _identity_key(e)
            twins = set(e.get("twins") or [])
            prev = enabled_ids.get(ident)
            if prev and prev not in twins and sym not in set(by_sym[prev].get("twins") or []):
                E(f"{sym}: same (adapter, provider_series_id, params) as enabled {prev} -- declare twins or fix")
            else:
                enabled_ids.setdefault(ident, sym)
    # cohort: every input of a cohort derived series is cohort too
    for sym, e in by_sym.items():
        if e["cohort"] and e["derivation"]:
            for inp in e["derivation"].get("inputs") or []:
                if inp in by_sym and not by_sym[inp]["cohort"]:
                    E(f"{sym}: cohort derived series has non-cohort input {inp}")
    if equity is None and not eq:
        E("equity collision check could not run: no committed cap universe / ETF list found")
    return errs
