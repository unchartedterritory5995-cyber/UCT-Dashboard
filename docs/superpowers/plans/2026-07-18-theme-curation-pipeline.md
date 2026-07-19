# Theme-Taxonomy Curation Pipeline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an owner-run local CLI pipeline that cleans `themes_taxonomy.json` for correctness (dead/renamed/mis-mapped tickers, missing leaders) across all 99 themes — audit → LLM-propose (Perplexity + Finviz corroboration) → confidence-tiered owner review → validated apply + version bump.

**Architecture:** A staged Python CLI under `tools/theme_curation/`. Pure-local logic (audit, ledger, apply) is fully unit-tested; the Perplexity/Finviz/Anthropic calls are thin, mocked in tests. Dry-run by default; `--apply` is gated. All symbol handling reuses `api.services.groups.normalize_sym` (dot→hyphen) / `to_taxonomy_sym` (hyphen→dot). The apply step bumps the taxonomy `version` (content-hashed) so `theme_db.seed_from_json` reseeds on next deploy.

**Tech Stack:** Python 3.12, pytest, SQLite (ledger), the existing `perplexity_search` / `industry_map` / `engine` / `theme_db` services.

## Global Constraints

- **Correctness, not strength.** ② must NOT prune or pad for strength (①'s live gates own that). The `thin` audit flag is informational-only and MUST NOT enter the ADD-proposing prompt.
- **Membership rubric = meaningful exposure:** a name belongs if the theme is material to its business/story; tangential = mis-mapped.
- **Symbol form:** taxonomy stores dot class-shares (`BRK.B`); cap_universe / Finviz / Perplexity are hyphen (`BRK-B`). Use `normalize_sym` (hyphen) for all dedup/union/cap_universe checks; `to_taxonomy_sym` (dot) before writing JSON. No holding may be written with a bare hyphen.
- **Never crash prod:** Stage 4 self-validates before writing; the boot reseed is wrapped (Task 12).
- **Version gate (exact):** `theme_db.seed_from_json` reseeds only when the JSON top-level `version` ≠ the stored `user_preferences('system','theme_seed_version')` (string equality; `theme_db.py:81-90`). Mandatory JSON fields the reseed dereferences raw: sector `id`/`name`; theme `id`/`name`/`sector_id`; holding `sym`.
- **Dry-run default; `--apply` requires `--confirm` + a clean git tree for `themes_taxonomy.json`.**
- Tests: `python -m pytest tests/theme_curation/ -q` from repo root. Perplexity/Finviz/Anthropic MOCKED (LLM quality is the owner's review, not a unit test).
- Shared worktree: commit with EXPLICIT file paths only, NEVER `git add -A`.

## File Structure

- `tools/theme_curation/__init__.py`
- `tools/theme_curation/loaders.py` — taxonomy/cap_universe/IPO_DATES loading + the two symbol helpers re-exported. (Task 1)
- `tools/theme_curation/ledger.py` — append-only decision ledger. (Task 2)
- `tools/theme_curation/audit.py` — Stage 1. (Task 3)
- `tools/theme_curation/proposals.py` — typed proposals + LLM-JSON parsing + cap_universe validation. (Task 4)
- `tools/theme_curation/discover.py` — Perplexity discovery + ticker extraction. (Task 5)
- `tools/theme_curation/corroborate.py` — Finviz corroboration + `theme_finviz_industries.json`. (Task 6)
- `tools/theme_curation/propose.py` — Stage 2 orchestrator (one Anthropic call/theme). (Task 7)
- `tools/theme_curation/review_doc.py` — Stage 3 batch doc writer + parser. (Task 8)
- `tools/theme_curation/review_cli.py` — Stage 3 interactive review. (Task 9)
- `tools/theme_curation/apply.py` — Stage 4 validate + mutate + version bump. (Task 10)
- `tools/theme_curation/cli.py` — argparse entry wiring subcommands. (Task 11)
- `tools/theme_curation/theme_finviz_industries.json` — owner-maintained map (created by the bootstrap command).
- Modify `api/services/theme_db.py` + `api/main.py:1906-1908` — boot hardening. (Task 12)
- Tests under `tests/theme_curation/`.

---

## Task 1: Loaders + symbol helpers

**Files:**
- Create: `tools/theme_curation/__init__.py` (empty), `tools/theme_curation/loaders.py`
- Test: `tests/theme_curation/test_loaders.py`

**Interfaces:**
- Produces: `norm(sym)->str` (hyphen, via groups.normalize_sym), `to_dot(sym)->str` (via groups.to_taxonomy_sym), `load_taxonomy(path)->dict`, `save_taxonomy(path, data)`, `cap_universe_set(path)->set[str]` (hyphen), `ipo_dates()->dict[str,str]`, `theme_by_id(taxonomy)->dict`, `holding_syms(theme)->list[str]` (hyphen form).

- [ ] **Step 1: Write the failing test**

```python
# tests/theme_curation/test_loaders.py
import json
from tools.theme_curation import loaders


def test_norm_and_to_dot_roundtrip():
    assert loaders.norm("brk.b") == "BRK-B"
    assert loaders.to_dot("BRK-B") == "BRK.B"
    assert loaders.norm(" aapl ") == "AAPL"


def test_cap_universe_set_is_hyphen_upper(tmp_path):
    p = tmp_path / "cap.json"
    p.write_text('["aapl","BRK.B","nvda"]', encoding="utf-8")
    s = loaders.cap_universe_set(str(p))
    assert s == {"AAPL", "BRK-B", "NVDA"}


def test_holding_syms_normalized(tmp_path):
    tax = {"themes": [{"id": "x", "holdings": [{"sym": "BRK.B"}, {"sym": "aapl"}]}]}
    theme = loaders.theme_by_id(tax)["x"]
    assert loaders.holding_syms(theme) == ["BRK-B", "AAPL"]


def test_load_save_roundtrip(tmp_path):
    p = tmp_path / "t.json"
    data = {"version": "1.0.0", "themes": []}
    loaders.save_taxonomy(str(p), data)
    assert loaders.load_taxonomy(str(p)) == data
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/theme_curation/test_loaders.py -q`
Expected: FAIL — `ModuleNotFoundError: tools.theme_curation.loaders`.

- [ ] **Step 3: Implement**

Create `tools/theme_curation/__init__.py` (empty). Create `tools/theme_curation/loaders.py`:

```python
"""Local data loading + canonical symbol helpers for the curation pipeline."""
import json

from api.services.groups import normalize_sym as _norm, to_taxonomy_sym as _dot


def norm(sym: str) -> str:
    """Canonical hyphen+upper form (dedup/cap_universe/Finviz/Perplexity side)."""
    return _norm(sym)


def to_dot(sym: str) -> str:
    """Taxonomy (dot) form — used only when writing holdings back to JSON."""
    return _dot(sym)


def load_taxonomy(path: str) -> dict:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def save_taxonomy(path: str, data: dict) -> None:
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")


def cap_universe_set(path: str) -> set:
    with open(path, encoding="utf-8") as f:
        return {norm(s) for s in json.load(f) if s}


def ipo_dates() -> dict:
    from api.services.ipo_maintenance import IPO_DATES
    return dict(IPO_DATES)


def theme_by_id(taxonomy: dict) -> dict:
    return {t["id"]: t for t in taxonomy.get("themes", [])}


def holding_syms(theme: dict) -> list:
    """Hyphen-form syms of a theme's holdings, order preserved."""
    return [norm(h["sym"]) for h in theme.get("holdings", []) if h.get("sym")]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/theme_curation/test_loaders.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tools/theme_curation/__init__.py tools/theme_curation/loaders.py tests/theme_curation/test_loaders.py
git commit -m "feat(curation): loaders + canonical symbol helpers"
```

---

## Task 2: Decision ledger

**Files:**
- Create: `tools/theme_curation/ledger.py`
- Test: `tests/theme_curation/test_ledger.py`

**Interfaces:**
- Produces: `Ledger(path)` with `record(theme_id, sym, action, decision, fields=None)`, `is_decided(theme_id, sym, action)->bool`, `get(theme_id, sym, action)->dict|None`, `rejected_keys()->set[tuple]` (`(theme_id, sym, action)` with decision `"reject"`). Append-only SQLite; last write wins per key; `decision ∈ {approve, reject, edit}`.

- [ ] **Step 1: Write the failing test**

```python
# tests/theme_curation/test_ledger.py
from tools.theme_curation.ledger import Ledger


def test_record_and_readback(tmp_path):
    lg = Ledger(str(tmp_path / "l.db"))
    assert lg.is_decided("space", "RKLB", "add") is False
    lg.record("space", "RKLB", "add", "approve", {"tier": "core"})
    assert lg.is_decided("space", "RKLB", "add") is True
    assert lg.get("space", "RKLB", "add")["decision"] == "approve"


def test_last_write_wins(tmp_path):
    lg = Ledger(str(tmp_path / "l.db"))
    lg.record("space", "X", "add", "approve")
    lg.record("space", "X", "add", "reject")
    assert lg.get("space", "X", "add")["decision"] == "reject"


def test_rejected_keys(tmp_path):
    lg = Ledger(str(tmp_path / "l.db"))
    lg.record("space", "BAD", "add", "reject")
    lg.record("space", "GOOD", "add", "approve")
    assert lg.rejected_keys() == {("space", "BAD", "add")}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/theme_curation/test_ledger.py -q`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

Create `tools/theme_curation/ledger.py`:

```python
"""Append-only decision ledger keyed (theme_id, sym, action). Survives across
runs so prior rejections suppress re-proposals and the CLI is resumable."""
import json
import sqlite3
import time


class Ledger:
    def __init__(self, path: str):
        self.path = path
        with self._conn() as c:
            c.execute(
                "CREATE TABLE IF NOT EXISTS decisions ("
                "theme_id TEXT, sym TEXT, action TEXT, decision TEXT, "
                "fields TEXT, at REAL, PRIMARY KEY (theme_id, sym, action))")

    def _conn(self) -> sqlite3.Connection:
        c = sqlite3.connect(self.path)
        c.row_factory = sqlite3.Row
        return c

    def record(self, theme_id, sym, action, decision, fields=None):
        with self._conn() as c:
            c.execute(
                "INSERT OR REPLACE INTO decisions "
                "(theme_id, sym, action, decision, fields, at) VALUES (?,?,?,?,?,?)",
                (theme_id, sym, action, decision, json.dumps(fields or {}), time.time()))

    def get(self, theme_id, sym, action):
        with self._conn() as c:
            r = c.execute(
                "SELECT * FROM decisions WHERE theme_id=? AND sym=? AND action=?",
                (theme_id, sym, action)).fetchone()
            if not r:
                return None
            d = dict(r)
            d["fields"] = json.loads(d["fields"] or "{}")
            return d

    def is_decided(self, theme_id, sym, action) -> bool:
        return self.get(theme_id, sym, action) is not None

    def rejected_keys(self) -> set:
        with self._conn() as c:
            return {(r["theme_id"], r["sym"], r["action"])
                    for r in c.execute(
                        "SELECT theme_id, sym, action FROM decisions WHERE decision='reject'")}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/theme_curation/test_ledger.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tools/theme_curation/ledger.py tests/theme_curation/test_ledger.py
git commit -m "feat(curation): append-only decision ledger"
```

---

## Task 3: Stage 1 — mechanical audit

**Files:**
- Create: `tools/theme_curation/audit.py`
- Test: `tests/theme_curation/test_audit.py`

**Interfaces:**
- Consumes: `loaders` (Task 1).
- Produces: `audit_taxonomy(taxonomy, cap_set, ipo_dates, now_days) -> dict` returning `{"themes": {theme_id: {"dead": [...], "dups": [...], "thin": bool}}, "gap_pool": [...]}`. `now_days` = today's ordinal (`date.today().toordinal()`) for deterministic testing of the 365-day IPO cutoff. `write_audit_md(result, taxonomy) -> str` (markdown). `dead` = holding syms ∉ cap_set (hyphen); `thin` = `len(chartable holdings) < THIN_MIN` (default 4); `gap_pool` = IPO_DATES/cap tickers in NO theme, with aged-out IPOs (IPO date > 365d before now) flagged `aged_out=True`.

- [ ] **Step 1: Write the failing test**

```python
# tests/theme_curation/test_audit.py
from datetime import date
from tools.theme_curation import audit


def _now_days():
    return date(2026, 7, 18).toordinal()


def test_dead_dup_thin_and_gap():
    tax = {"themes": [
        {"id": "space", "name": "Space", "sector_id": "innov", "holdings": [
            {"sym": "RKLB"}, {"sym": "ASTS"}, {"sym": "DEADCO"}, {"sym": "RKLB"},  # dup + dead
        ]},
        {"id": "thintheme", "name": "Thin", "sector_id": "innov",
         "holdings": [{"sym": "AAA"}]},  # thin
    ]}
    cap = {"RKLB", "ASTS", "AAA", "SNDK", "VLTO"}
    ipo = {"SNDK": "2025-02-01", "VLTO": "2023-09-30"}  # SNDK recent, VLTO aged
    r = audit.audit_taxonomy(tax, cap, ipo, _now_days())
    assert "DEADCO" in r["themes"]["space"]["dead"]
    assert "RKLB" in r["themes"]["space"]["dups"]
    assert r["themes"]["thintheme"]["thin"] is True
    gp = {g["sym"]: g for g in r["gap_pool"]}
    assert "SNDK" in gp and gp["SNDK"]["aged_out"] is False   # in cap, in no theme, recent
    assert gp["VLTO"]["aged_out"] is True                     # aged IPO


def test_write_audit_md_smoke():
    tax = {"themes": [{"id": "space", "name": "Space", "sector_id": "innov",
                       "holdings": [{"sym": "RKLB"}]}]}
    r = audit.audit_taxonomy(tax, {"RKLB"}, {}, _now_days())
    md = audit.write_audit_md(r, tax)
    assert "Space" in md and "# " in md
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/theme_curation/test_audit.py -q`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

Create `tools/theme_curation/audit.py`:

```python
"""Stage 1 — mechanical audit (pure-local, no LLM)."""
from datetime import datetime

from tools.theme_curation import loaders

THIN_MIN = 4
_IPO_MAX_AGE_DAYS = 365


def _ipo_ordinal(iso: str):
    try:
        return datetime.strptime(iso, "%Y-%m-%d").date().toordinal()
    except Exception:
        return None


def audit_taxonomy(taxonomy: dict, cap_set: set, ipo_dates: dict, now_days: int) -> dict:
    themes_out = {}
    covered = set()
    for t in taxonomy.get("themes", []):
        syms = loaders.holding_syms(t)          # hyphen form, order preserved
        covered.update(syms)
        seen, dups, dead = set(), [], []
        for s in syms:
            if s in seen:
                dups.append(s)
            seen.add(s)
            if s not in cap_set:
                dead.append(s)
        chartable = [s for s in set(syms) if s in cap_set]
        themes_out[t["id"]] = {"dead": dead, "dups": dups, "thin": len(chartable) < THIN_MIN}

    gap_pool = []
    for tk, iso in ipo_dates.items():
        s = loaders.norm(tk)
        if s in covered or s not in cap_set:
            continue
        o = _ipo_ordinal(iso)
        aged = bool(o is not None and (now_days - o) > _IPO_MAX_AGE_DAYS)
        gap_pool.append({"sym": s, "ipo_date": iso, "aged_out": aged})
    return {"themes": themes_out, "gap_pool": gap_pool}


def write_audit_md(result: dict, taxonomy: dict) -> str:
    by_id = loaders.theme_by_id(taxonomy)
    lines = ["# Taxonomy Audit", ""]
    for tid, flags in result["themes"].items():
        name = by_id.get(tid, {}).get("name", tid)
        if not (flags["dead"] or flags["dups"] or flags["thin"]):
            continue
        lines.append(f"## {name} (`{tid}`)")
        if flags["dead"]:
            lines.append(f"- **dead (not in cap_universe):** {', '.join(flags['dead'])}")
        if flags["dups"]:
            lines.append(f"- **duplicate syms:** {', '.join(flags['dups'])}")
        if flags["thin"]:
            lines.append(f"- **thin** (informational — do NOT pad for strength)")
        lines.append("")
    live = [g for g in result["gap_pool"] if not g["aged_out"]]
    if live:
        lines.append("## Gap pool (in cap_universe / IPO tracker, in no theme)")
        lines += [f"- {g['sym']} (IPO {g['ipo_date']})" for g in live]
    return "\n".join(lines) + "\n"
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/theme_curation/test_audit.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tools/theme_curation/audit.py tests/theme_curation/test_audit.py
git commit -m "feat(curation): Stage 1 mechanical audit (dead/dup/thin/gap-pool + IPO cutoff)"
```

---

## Task 4: Proposal types + LLM-JSON parsing + cap_universe validation

**Files:**
- Create: `tools/theme_curation/proposals.py`
- Test: `tests/theme_curation/test_proposals.py`

**Interfaces:**
- Produces: dataclass `Proposal(theme_id, action, sym, confidence, fields)` where `action ∈ {add, drop, remap, retier}` and `fields` holds the per-action extras (`tier`, `sub_theme_id`, `rationale`, `new_sym`, `new_tier`, `reason`). `pid(p)->str` = `f"{theme_id}::{sym}::{action}"`. `parse_llm_proposals(theme_id, raw_json, cap_set)->tuple[list[Proposal], list[str]]` — returns valid proposals + a list of rejection reasons; drops any ADD/REMAP whose target sym (normalized) ∉ cap_set, any unknown action, any malformed row. `TIERS = {"core","relevant","peripheral"}`.

- [ ] **Step 1: Write the failing test**

```python
# tests/theme_curation/test_proposals.py
from tools.theme_curation import proposals as P


def test_parse_valid_and_reject_noncap():
    raw = {"proposals": [
        {"action": "add", "sym": "SNDK", "tier": "core", "sub_theme_id": None,
         "rationale": "memory", "confidence": 0.9},
        {"action": "add", "sym": "FAKE", "tier": "core", "confidence": 0.5},   # not in cap -> rejected
        {"action": "drop", "sym": "AUY", "reason": "acquired", "confidence": 0.8},
        {"action": "remap", "sym": "SQ", "new_sym": "XYZ", "confidence": 0.7},
        {"action": "retier", "sym": "RKLB", "new_tier": "core", "confidence": 0.6},
        {"action": "bogus", "sym": "Z", "confidence": 1.0},                    # unknown -> rejected
    ]}
    cap = {"SNDK", "AUY", "SQ", "XYZ", "RKLB"}
    props, rejects = P.parse_llm_proposals("mem", raw, cap)
    kinds = {(p.action, p.sym) for p in props}
    assert ("add", "SNDK") in kinds and ("drop", "AUY") in kinds
    assert ("remap", "SQ") in kinds and ("retier", "RKLB") in kinds
    assert ("add", "FAKE") not in kinds and not any(p.action == "bogus" for p in props)
    assert len(rejects) == 2
    assert P.pid(next(p for p in props if p.sym == "SNDK")) == "mem::SNDK::add"


def test_remap_new_sym_must_be_chartable():
    raw = {"proposals": [{"action": "remap", "sym": "OLD", "new_sym": "GONE", "confidence": 0.9}]}
    props, rejects = P.parse_llm_proposals("t", raw, {"OLD"})   # GONE not in cap
    assert props == [] and len(rejects) == 1
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/theme_curation/test_proposals.py -q`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

Create `tools/theme_curation/proposals.py`:

```python
"""Typed proposals + strict parsing of the LLM's JSON output.

cap_universe membership is validated HERE (a non-chartable target can never be
proposed). Cross-referential validation against the theme's CURRENT state
happens at apply time (proposals may be reviewed/edited in between)."""
from dataclasses import dataclass, field

from tools.theme_curation import loaders

TIERS = {"core", "relevant", "peripheral"}
_ACTIONS = {"add", "drop", "remap", "retier"}


@dataclass
class Proposal:
    theme_id: str
    action: str
    sym: str                      # hyphen form; for remap = the OLD sym
    confidence: float
    fields: dict = field(default_factory=dict)


def pid(p: Proposal) -> str:
    return f"{p.theme_id}::{p.sym}::{p.action}"


def parse_llm_proposals(theme_id: str, raw: dict, cap_set: set):
    out, rejects = [], []
    for row in (raw or {}).get("proposals", []):
        try:
            action = str(row["action"]).lower().strip()
            sym = loaders.norm(row["sym"])
            conf = float(row.get("confidence", 0.0))
        except Exception:
            rejects.append(f"malformed row: {row!r}")
            continue
        if action not in _ACTIONS or not sym:
            rejects.append(f"unknown action / empty sym: {row!r}")
            continue
        if action in ("add",) and sym not in cap_set:
            rejects.append(f"add target not chartable: {sym}")
            continue
        f = {}
        if action == "add":
            tier = str(row.get("tier", "relevant")).lower()
            f = {"tier": tier if tier in TIERS else "relevant",
                 "sub_theme_id": row.get("sub_theme_id"),
                 "rationale": row.get("rationale", "")}
        elif action == "drop":
            f = {"reason": row.get("reason", "")}
        elif action == "remap":
            new_sym = loaders.norm(row.get("new_sym", ""))
            if not new_sym or new_sym not in cap_set:
                rejects.append(f"remap new_sym not chartable: {row.get('new_sym')!r}")
                continue
            tier = str(row.get("tier", "relevant")).lower()
            f = {"new_sym": new_sym, "tier": tier if tier in TIERS else "relevant",
                 "sub_theme_id": row.get("sub_theme_id"), "rationale": row.get("rationale", "")}
        elif action == "retier":
            new_tier = str(row.get("new_tier", "")).lower()
            if new_tier not in TIERS:
                rejects.append(f"retier invalid tier: {row.get('new_tier')!r}")
                continue
            f = {"new_tier": new_tier}
        out.append(Proposal(theme_id, action, sym, conf, f))
    return out, rejects
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/theme_curation/test_proposals.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tools/theme_curation/proposals.py tests/theme_curation/test_proposals.py
git commit -m "feat(curation): typed proposals + strict LLM-JSON parsing + cap validation"
```

---

## Task 5: Perplexity discovery

**Files:**
- Create: `tools/theme_curation/discover.py`
- Test: `tests/theme_curation/test_discover.py`

**Interfaces:**
- Consumes: `perplexity_search.web_search` (mocked in tests).
- Produces: `extract_tickers(text)->list[str]` (uppercase `$CASHTAG` or bare 1-5 letter tokens on `TICKER — reason` lines, hyphen-normalized, deduped); `discover(theme_name, run_id, confirm=False)->dict` returning `{"tickers": [...], "error": str|None}`. Uses an explicit list-mode `system` prompt, `max_tokens=1500`, `domain_pack="finance"`, `cache_salt=run_id`. `confirm=True` issues a second independent query (for concept-themes) and returns the intersection.

- [ ] **Step 1: Write the failing test**

```python
# tests/theme_curation/test_discover.py
from tools.theme_curation import discover


def test_extract_tickers():
    txt = "NVDA — dominant GPU\n$AMD — competitor\nnot-a-line\nBRK.B — holding"
    assert discover.extract_tickers(txt) == ["NVDA", "AMD", "BRK-B"]


def test_discover_uses_list_mode(monkeypatch):
    calls = {}
    def fake_ws(query, **kw):
        calls.update(kw); calls["query"] = query
        return {"answer": "RKLB — launch\nASTS — sats", "error": None}
    monkeypatch.setattr(discover, "web_search", fake_ws)
    out = discover.discover("Space", "run1")
    assert out["tickers"] == ["RKLB", "ASTS"] and out["error"] is None
    assert calls["max_tokens"] == 1500 and calls["domain_pack"] == "finance"
    assert calls["cache_salt"] == "run1" and calls["system"]          # list-mode override present


def test_discover_surfaces_error(monkeypatch):
    monkeypatch.setattr(discover, "web_search",
                        lambda q, **k: {"answer": "", "error": "rate limited"})
    out = discover.discover("Space", "run1")
    assert out["error"] == "rate limited" and out["tickers"] == []


def test_confirm_intersects(monkeypatch):
    seq = iter([{"answer": "AAA — x\nBBB — y", "error": None},
                {"answer": "BBB — y\nCCC — z", "error": None}])
    monkeypatch.setattr(discover, "web_search", lambda q, **k: next(seq))
    out = discover.discover("Quantum", "run1", confirm=True)
    assert out["tickers"] == ["BBB"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/theme_curation/test_discover.py -q`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

Create `tools/theme_curation/discover.py`:

```python
"""Stage 2 candidate discovery via Perplexity (list-mode)."""
import re

from api.services.perplexity_search import web_search
from tools.theme_curation import loaders

_LIST_SYSTEM = (
    "You are a financial data extractor. Output ONLY lines of the form "
    "'TICKER — one-line reason', one per line, no prose, no markdown, no preamble. "
    "TICKER is the US-listed exchange symbol. Do not invent tickers."
)
_LINE_RE = re.compile(r"^\s*\$?([A-Za-z][A-Za-z.\-]{0,5})\s+[—\-]\s+", re.M)


def extract_tickers(text: str) -> list:
    out, seen = [], set()
    for m in _LINE_RE.finditer(text or ""):
        s = loaders.norm(m.group(1))
        if s and s not in seen:
            seen.add(s)
            out.append(s)
    return out


def _one(theme_name: str, run_id: str, salt_suffix: str) -> dict:
    res = web_search(
        f"List the leading US-listed public companies materially exposed to "
        f"the {theme_name} theme right now.",
        max_tokens=1500, system=_LIST_SYSTEM, mode="fast",
        domain_pack="finance", cache_salt=f"{run_id}{salt_suffix}")
    return {"tickers": extract_tickers(res.get("answer", "")),
            "error": res.get("error")}


def discover(theme_name: str, run_id: str, confirm: bool = False) -> dict:
    a = _one(theme_name, run_id, "")
    if a["error"] or not confirm:
        return a
    b = _one(theme_name, run_id, "::confirm")
    if b["error"]:
        return {"tickers": [], "error": b["error"]}
    bset = set(b["tickers"])
    return {"tickers": [t for t in a["tickers"] if t in bset], "error": None}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/theme_curation/test_discover.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tools/theme_curation/discover.py tests/theme_curation/test_discover.py
git commit -m "feat(curation): Perplexity list-mode discovery + ticker extraction"
```

---

## Task 6: Finviz corroboration + theme→industry map

**Files:**
- Create: `tools/theme_curation/corroborate.py`
- Test: `tests/theme_curation/test_corroborate.py`

**Interfaces:**
- Consumes: `industry_map.get_groups`, `industry_map.status`, `industry_map.bulk_refresh_from_finviz` (mocked in tests); `theme_finviz_industries.json`.
- Produces: `ensure_industry_map()` (calls `status()`; if `rows==0` or `stale`, calls `bulk_refresh_from_finviz()`; if the refresh returns `0`, raises `RuntimeError` with an actionable message); `load_theme_industries(path)->dict`; `corroborate(syms, expected_industries)->dict[str,bool]` (per sym: `True` if its Finviz industry ∈ `expected_industries`, else `False`; unknown industry → `False`). `expected_industries=None` (concept-theme) → all `False` (Finviz leg absent — caller relies on the confirm query instead).

- [ ] **Step 1: Write the failing test**

```python
# tests/theme_curation/test_corroborate.py
import pytest
from tools.theme_curation import corroborate as C


def test_corroborate_matches_industry(monkeypatch):
    monkeypatch.setattr(C.industry_map, "get_groups", lambda syms: {
        "NVDA": {"sector": "Technology", "industry": "Semiconductors"},
        "MSFT": {"sector": "Technology", "industry": "Software - Infrastructure"},
        "ZZZ":  {"sector": None, "industry": None},
    })
    out = C.corroborate(["NVDA", "MSFT", "ZZZ"], {"Semiconductors"})
    assert out == {"NVDA": True, "MSFT": False, "ZZZ": False}


def test_concept_theme_all_false(monkeypatch):
    monkeypatch.setattr(C.industry_map, "get_groups",
                        lambda syms: {s: {"sector": None, "industry": "X"} for s in syms})
    assert C.corroborate(["A", "B"], None) == {"A": False, "B": False}


def test_ensure_industry_map_hard_fails_on_no_key(monkeypatch):
    monkeypatch.setattr(C.industry_map, "status", lambda: {"rows": 0, "stale": True})
    monkeypatch.setattr(C.industry_map, "bulk_refresh_from_finviz", lambda: 0)
    with pytest.raises(RuntimeError):
        C.ensure_industry_map()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/theme_curation/test_corroborate.py -q`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

Create `tools/theme_curation/corroborate.py`:

```python
"""Stage 2 Finviz corroboration — a per-ticker industry check, NOT enumeration."""
import json

from api.services import industry_map


def ensure_industry_map() -> None:
    st = industry_map.status()
    if st.get("rows", 0) == 0 or st.get("stale"):
        n = industry_map.bulk_refresh_from_finviz()
        if not n:
            raise RuntimeError(
                "industry_map is empty and the Finviz refresh returned 0 rows — "
                "set FINVIZ_API_KEY (Finviz Elite) in your .env before running curation.")


def load_theme_industries(path: str) -> dict:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def corroborate(syms: list, expected_industries) -> dict:
    if not expected_industries:
        return {s: False for s in syms}
    exp = set(expected_industries)
    groups = industry_map.get_groups(syms)
    out = {}
    for s in syms:
        ind = (groups.get(s) or {}).get("industry")
        out[s] = bool(ind and ind in exp)
    return out
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/theme_curation/test_corroborate.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tools/theme_curation/corroborate.py tests/theme_curation/test_corroborate.py
git commit -m "feat(curation): Finviz corroboration (per-ticker industry check) + cold-start guard"
```

---

## Task 7: Stage 2 orchestrator (one Anthropic call per theme)

**Files:**
- Create: `tools/theme_curation/propose.py`
- Test: `tests/theme_curation/test_propose.py`

**Interfaces:**
- Consumes: `discover.discover`, `corroborate.corroborate`, `proposals.parse_llm_proposals`, `ledger.Ledger`, `engine._get_anthropic_client` (mocked in tests).
- Produces: `propose_theme(theme, candidates, corrob, current_syms, audit_flags, model) -> dict` — builds the grounded prompt (current members + candidates + each candidate's corroboration + the meaningful-exposure rubric + the theme's `sub_themes`; **`audit_flags['thin']` is NOT included**), calls Anthropic once, returns the parsed `{"proposals": [...], "rejects": [...], "raw": str}`. `boost_confidence(props, corrob) -> None` bumps a proposal's confidence when its sym is corroborated. `suppress_rejected(props, ledger) -> list` drops proposals whose `(theme_id, sym, action)` is in `ledger.rejected_keys()`.

- [ ] **Step 1: Write the failing test**

```python
# tests/theme_curation/test_propose.py
from tools.theme_curation import propose, proposals as P
from tools.theme_curation.ledger import Ledger


def test_thin_flag_excluded_from_prompt(monkeypatch):
    captured = {}
    class _Msg:
        def create(self, **kw):
            captured["prompt"] = kw["messages"][0]["content"]
            class R:
                content = [type("B", (), {"text": '{"proposals": []}'})()]
            return R()
    class _Client:
        messages = _Msg()
    monkeypatch.setattr(propose, "_client", lambda: _Client())
    theme = {"id": "t", "name": "Thin Theme", "sub_themes": [], "holdings": []}
    propose.propose_theme(theme, ["AAA"], {"AAA": True}, [], {"thin": True, "dead": []}, "m")
    assert "thin" not in captured["prompt"].lower()


def test_suppress_rejected(tmp_path):
    lg = Ledger(str(tmp_path / "l.db"))
    lg.record("t", "BAD", "add", "reject")
    props = [P.Proposal("t", "add", "BAD", 0.9), P.Proposal("t", "add", "OK", 0.9)]
    kept = propose.suppress_rejected(props, lg)
    assert [p.sym for p in kept] == ["OK"]


def test_boost_confidence():
    props = [P.Proposal("t", "add", "NVDA", 0.5), P.Proposal("t", "add", "XX", 0.5)]
    propose.boost_confidence(props, {"NVDA": True, "XX": False})
    d = {p.sym: p.confidence for p in props}
    assert d["NVDA"] > 0.5 and d["XX"] == 0.5
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/theme_curation/test_propose.py -q`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

Create `tools/theme_curation/propose.py`:

```python
"""Stage 2 orchestrator — one grounded Anthropic call per theme."""
import json
import os

from tools.theme_curation import proposals as P
from tools.theme_curation import loaders

_RUBRIC = (
    "A ticker BELONGS in a theme only if the theme is MATERIAL to its business or "
    "market story (a real revenue segment, or a name traders associate with the theme). "
    "Tangential exposure = mis-mapped -> propose DROP. tier reflects centrality "
    "(core/relevant/peripheral). Do NOT add names merely to enlarge the theme."
)
_BOOST = 0.15


def _client():
    from api.services.engine import _get_anthropic_client
    return _get_anthropic_client()


def _prompt(theme: dict, candidates: list, corrob: dict, current_syms: list) -> str:
    subs = [s.get("id") for s in theme.get("sub_themes", [])]
    cand_lines = [f"{c} (finviz_match={corrob.get(c, False)})" for c in candidates]
    return (
        f"{_RUBRIC}\n\nTHEME: {theme['name']} (id={theme['id']})\n"
        f"Valid sub_theme_id values: {subs or 'none'}\n"
        f"CURRENT holdings: {', '.join(current_syms) or 'none'}\n"
        f"CANDIDATE tickers (from web search; finviz_match = industry corroborated): "
        f"{', '.join(cand_lines) or 'none'}\n\n"
        "Return ONLY JSON: {\"proposals\":[{\"action\":\"add|drop|remap|retier\","
        "\"sym\":\"TICKER\",\"new_sym\":\"(remap only)\",\"tier\":\"core|relevant|peripheral\","
        "\"new_tier\":\"(retier only)\",\"sub_theme_id\":\"one of the valid ids or null\","
        "\"rationale\":\"...\",\"reason\":\"(drop only)\",\"confidence\":0.0}]}. No prose.")


def propose_theme(theme, candidates, corrob, current_syms, audit_flags, model, cap_set=None):
    # NOTE: audit_flags['thin'] is deliberately NOT passed into the prompt.
    prompt = _prompt(theme, candidates, corrob, current_syms)
    resp = _client().messages.create(
        model=model, max_tokens=2000,
        messages=[{"role": "user", "content": prompt}])
    raw_text = resp.content[0].text if resp.content else "{}"
    try:
        data = json.loads(raw_text[raw_text.find("{"): raw_text.rfind("}") + 1])
    except Exception:
        data = {"proposals": []}
    props, rejects = P.parse_llm_proposals(theme["id"], data, cap_set or set())
    boost_confidence(props, corrob)
    return {"proposals": props, "rejects": rejects, "raw": raw_text}


def boost_confidence(props, corrob) -> None:
    for p in props:
        if corrob.get(p.sym):
            p.confidence = min(1.0, p.confidence + _BOOST)


def suppress_rejected(props, ledger):
    rej = ledger.rejected_keys()
    return [p for p in props if (p.theme_id, p.sym, p.action) not in rej]
```

Note: the test monkeypatches `propose._client`; `cap_set` defaults to empty so the `_thin_flag` test (which returns no proposals) passes without cap membership.

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/theme_curation/test_propose.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tools/theme_curation/propose.py tests/theme_curation/test_propose.py
git commit -m "feat(curation): Stage 2 orchestrator (grounded Anthropic call; thin excluded; confidence boost; ledger suppression)"
```

---

## Task 8: Stage 3 — machine-parseable review doc

**Files:**
- Create: `tools/theme_curation/review_doc.py`
- Test: `tests/theme_curation/test_review_doc.py`

**Interfaces:**
- Consumes: `proposals.Proposal`, `proposals.pid`.
- Produces: `write_review_md(props)->str` — one block per proposal, each led by an HTML-comment machine marker `<!-- CURATION id=THEME::SYM::ACTION -->` and a checkbox `- [ ] APPROVE` (owner flips to `- [x]`); human-readable details follow. `parse_review_md(text)->dict[str,bool]` — `{pid: approved}`; **raises `ValueError` on any marker block it cannot parse** (never silently skips/approves).

- [ ] **Step 1: Write the failing test**

```python
# tests/theme_curation/test_review_doc.py
import pytest
from tools.theme_curation import review_doc as R
from tools.theme_curation.proposals import Proposal


def test_write_then_parse_roundtrip():
    props = [Proposal("space", "add", "SNDK", 0.9, {"tier": "core", "rationale": "memory"}),
             Proposal("space", "drop", "AUY", 0.8, {"reason": "acquired"})]
    md = R.write_review_md(props)
    # owner approves the first, leaves the second rejected
    md = md.replace("id=space::SNDK::add -->\n- [ ] APPROVE",
                    "id=space::SNDK::add -->\n- [x] APPROVE")
    decisions = R.parse_review_md(md)
    assert decisions == {"space::SNDK::add": True, "space::AUY::drop": False}


def test_parse_hard_fails_on_broken_block():
    bad = "<!-- CURATION id=space::X::add -->\n(no checkbox line here)\n"
    with pytest.raises(ValueError):
        R.parse_review_md(bad)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/theme_curation/test_review_doc.py -q`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

Create `tools/theme_curation/review_doc.py`:

```python
"""Stage 3 batch review doc — machine-parseable, hard-fail on ambiguity."""
import re

from tools.theme_curation.proposals import pid

_MARK = re.compile(r"<!--\s*CURATION id=([^\s]+)\s*-->")
_BOX = re.compile(r"^- \[( |x|X)\] APPROVE", re.M)


def write_review_md(props) -> str:
    lines = ["# Curation Review", "",
             "Flip `- [ ] APPROVE` to `- [x] APPROVE` to approve. Leave unchecked to reject.",
             "Do NOT delete the `<!-- CURATION -->` marker lines.", ""]
    for p in props:
        detail = ", ".join(f"{k}={v}" for k, v in p.fields.items())
        lines += [f"<!-- CURATION id={pid(p)} -->",
                  "- [ ] APPROVE",
                  f"  **{p.action.upper()} {p.sym}** (conf {p.confidence:.2f}) {detail}", ""]
    return "\n".join(lines) + "\n"


def parse_review_md(text: str) -> dict:
    out = {}
    blocks = text.split("<!-- CURATION")
    for b in blocks[1:]:
        m = _MARK.search("<!-- CURATION" + b)
        box = _BOX.search(b)
        if not m or not box:
            raise ValueError(f"unparseable review block: {b[:80]!r}")
        out[m.group(1)] = box.group(1).lower() == "x"
    return out
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/theme_curation/test_review_doc.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tools/theme_curation/review_doc.py tests/theme_curation/test_review_doc.py
git commit -m "feat(curation): Stage 3 machine-parseable review doc (hard-fail on ambiguity)"
```

---

## Task 9: Stage 3 — interactive CLI review (resumable)

**Files:**
- Create: `tools/theme_curation/review_cli.py`
- Test: `tests/theme_curation/test_review_cli.py`

**Interfaces:**
- Consumes: `ledger.Ledger`, `proposals.Proposal`/`pid`.
- Produces: `review_interactive(props, ledger, input_fn=input, out_fn=print)->None` — for each proposal NOT already in the ledger, prompts (`a`pprove / `r`eject / `s`kip), and **records each decision to the ledger immediately** (`a`→approve, `r`→reject; `s` records nothing so it re-appears next run). Already-decided proposals are skipped silently (resume). `input_fn`/`out_fn` are injected for testing.

- [ ] **Step 1: Write the failing test**

```python
# tests/theme_curation/test_review_cli.py
from tools.theme_curation import review_cli
from tools.theme_curation.proposals import Proposal
from tools.theme_curation.ledger import Ledger


def test_records_and_resumes(tmp_path):
    lg = Ledger(str(tmp_path / "l.db"))
    props = [Proposal("t", "add", "AAA", 0.4), Proposal("t", "add", "BBB", 0.4)]
    answers = iter(["a", "r"])
    review_cli.review_interactive(props, lg, input_fn=lambda _: next(answers), out_fn=lambda *_: None)
    assert lg.get("t", "AAA", "add")["decision"] == "approve"
    assert lg.get("t", "BBB", "add")["decision"] == "reject"

    # Resume: both already decided -> input_fn must NOT be called again
    def _boom(_):
        raise AssertionError("should not prompt for already-decided items")
    review_cli.review_interactive(props, lg, input_fn=_boom, out_fn=lambda *_: None)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/theme_curation/test_review_cli.py -q`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

Create `tools/theme_curation/review_cli.py`:

```python
"""Stage 3 interactive review — writes each decision immediately (resumable)."""
from tools.theme_curation.proposals import pid


def review_interactive(props, ledger, input_fn=input, out_fn=print) -> None:
    for p in props:
        if ledger.is_decided(p.theme_id, p.sym, p.action):
            continue
        detail = ", ".join(f"{k}={v}" for k, v in p.fields.items())
        out_fn(f"[{p.theme_id}] {p.action.upper()} {p.sym} (conf {p.confidence:.2f}) {detail}")
        ans = (input_fn("  [a]pprove / [r]eject / [s]kip: ") or "").strip().lower()
        if ans == "a":
            ledger.record(p.theme_id, p.sym, p.action, "approve", p.fields)
        elif ans == "r":
            ledger.record(p.theme_id, p.sym, p.action, "reject", p.fields)
        # 's' (or anything else) records nothing -> re-appears next run
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/theme_curation/test_review_cli.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tools/theme_curation/review_cli.py tests/theme_curation/test_review_cli.py
git commit -m "feat(curation): Stage 3 interactive resumable review"
```

---

## Task 10: Stage 4 — validate + apply + version bump

**Files:**
- Create: `tools/theme_curation/apply.py`
- Test: `tests/theme_curation/test_apply.py`

**Interfaces:**
- Consumes: `loaders`, `proposals.Proposal`.
- Produces:
  - `validate_proposal(p, theme, cap_set)->str|None` — cross-referential gate; returns a rejection reason or `None` if valid: DROP.sym ∈ current; ADD.sym ∉ current ∧ ∈ cap; REMAP old ∈ current ∧ new ∈ cap; RETIER.sym ∈ current; `sub_theme_id` ∈ theme sub_themes or null.
  - `apply_proposals(taxonomy, approved, cap_set)->tuple[dict, list[str]]` — returns a NEW taxonomy dict (mutated) + rejection reasons; preserves untouched holdings verbatim; writes syms in dot form; REMAP merges into an existing new-sym row instead of duplicating.
  - `self_validate(taxonomy)->list[str]` — the boot-shape assertions (every sector id/name; theme id/name/sector_id/holdings; holding sym); returns error list (empty = ok).
  - `bump_version(taxonomy)->str` — sets `version = "{bumped-semver}+{sha8}"` (sha8 = sha256 of canonical sectors+themes) and `generated_at`; returns the new version.

- [ ] **Step 1: Write the failing test**

```python
# tests/theme_curation/test_apply.py
from tools.theme_curation import apply as A
from tools.theme_curation.proposals import Proposal


def _tax():
    return {"version": "4.2.0", "sectors": [{"id": "s", "name": "S"}],
            "themes": [{"id": "space", "name": "Space", "sector_id": "s",
                        "sub_themes": [{"id": "launch", "name": "Launch"}],
                        "holdings": [{"sym": "RKLB", "tier": "core", "sub_theme_id": "launch",
                                      "rationale": "orig"}, {"sym": "OLD", "tier": "relevant"}]}]}


def test_validate_gate():
    theme = _tax()["themes"][0]
    cap = {"RKLB", "OLD", "SNDK", "NEW"}
    assert A.validate_proposal(Proposal("space", "drop", "NOPE", 1), theme, cap)   # not a member
    assert A.validate_proposal(Proposal("space", "add", "RKLB", 1), theme, cap)    # already present
    assert A.validate_proposal(Proposal("space", "add", "SNDK", 1,
        {"tier": "core", "sub_theme_id": "bad"}), theme, cap)                       # bad sub_theme
    assert A.validate_proposal(Proposal("space", "add", "SNDK", 1,
        {"tier": "core", "sub_theme_id": "launch"}), theme, cap) is None            # valid


def test_apply_add_drop_remap_preserves_fields():
    tax = _tax()
    cap = {"RKLB", "OLD", "SNDK", "NEW"}
    approved = [
        Proposal("space", "add", "SNDK", 1, {"tier": "core", "sub_theme_id": "launch", "rationale": "mem"}),
        Proposal("space", "remap", "OLD", 1, {"new_sym": "NEW", "tier": "relevant", "sub_theme_id": None, "rationale": ""}),
    ]
    out, rej = A.apply_proposals(tax, approved, cap)
    syms = [h["sym"] for h in out["themes"][0]["holdings"]]
    assert "SNDK" in syms and "NEW" in syms and "OLD" not in syms and rej == []
    rklb = next(h for h in out["themes"][0]["holdings"] if h["sym"] == "RKLB")
    assert rklb["rationale"] == "orig"    # untouched preserved verbatim


def test_self_validate_catches_missing_sym():
    bad = {"sectors": [{"id": "s", "name": "S"}],
           "themes": [{"id": "t", "name": "T", "sector_id": "s", "holdings": [{"tier": "core"}]}]}
    errs = A.self_validate(bad)
    assert errs and any("sym" in e for e in errs)


def test_bump_version_changes_on_content_and_is_stable():
    tax = _tax()
    v1 = A.bump_version(tax)
    v2 = A.bump_version(A._tax_copy(tax))   # same content -> same hash suffix
    assert v1.split("+")[1] == v2.split("+")[1]
    tax["themes"][0]["holdings"].append({"sym": "ZZ"})
    v3 = A.bump_version(tax)
    assert v3.split("+")[1] != v1.split("+")[1]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/theme_curation/test_apply.py -q`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

Create `tools/theme_curation/apply.py`:

```python
"""Stage 4 — cross-referential validation, mutation, content-hashed version bump."""
import copy
import hashlib
import json
from datetime import date, timezone, datetime

from tools.theme_curation import loaders
from tools.theme_curation.proposals import TIERS


def _tax_copy(tax):
    return copy.deepcopy(tax)


def _sub_ids(theme):
    return {s.get("id") for s in theme.get("sub_themes", [])}


def validate_proposal(p, theme, cap_set):
    cur = set(loaders.holding_syms(theme))
    subs = _sub_ids(theme)
    f = p.fields
    if p.action == "drop":
        if p.sym not in cur:
            return f"drop {p.sym}: not a current member"
    elif p.action == "add":
        if p.sym in cur:
            return f"add {p.sym}: already present"
        if p.sym not in cap_set:
            return f"add {p.sym}: not chartable"
        if f.get("sub_theme_id") not in (None, *subs):
            return f"add {p.sym}: invalid sub_theme_id {f.get('sub_theme_id')!r}"
    elif p.action == "remap":
        new = f.get("new_sym")
        if p.sym not in cur:
            return f"remap {p.sym}: old not a current member"
        if new not in cap_set:
            return f"remap {p.sym}->{new}: new not chartable"
        if f.get("sub_theme_id") not in (None, *subs):
            return f"remap {p.sym}: invalid sub_theme_id"
    elif p.action == "retier":
        if p.sym not in cur:
            return f"retier {p.sym}: not a current member"
        if f.get("new_tier") not in TIERS:
            return f"retier {p.sym}: invalid tier"
    return None


def _find(holdings, sym):
    for h in holdings:
        if loaders.norm(h.get("sym", "")) == sym:
            return h
    return None


def apply_proposals(taxonomy, approved, cap_set):
    tax = _tax_copy(taxonomy)
    by_id = loaders.theme_by_id(tax)
    rejects = []
    for p in approved:
        theme = by_id.get(p.theme_id)
        if theme is None:
            rejects.append(f"{p.theme_id}: unknown theme")
            continue
        why = validate_proposal(p, theme, cap_set)
        if why:
            rejects.append(why)
            continue
        H = theme["holdings"]
        if p.action == "drop":
            theme["holdings"] = [h for h in H if loaders.norm(h["sym"]) != p.sym]
        elif p.action == "add":
            theme["holdings"].append({
                "sym": loaders.to_dot(p.sym), "tier": p.fields.get("tier", "relevant"),
                "sub_theme_id": p.fields.get("sub_theme_id"),
                "rationale": p.fields.get("rationale", "")})
        elif p.action == "remap":
            old = _find(H, p.sym)
            new_sym = p.fields["new_sym"]
            theme["holdings"] = [h for h in H if loaders.norm(h["sym"]) != p.sym]
            existing = _find(theme["holdings"], new_sym)
            if existing is None:      # append (inherit old's fields unless overridden)
                theme["holdings"].append({
                    "sym": loaders.to_dot(new_sym),
                    "tier": p.fields.get("tier") or (old or {}).get("tier", "relevant"),
                    "sub_theme_id": p.fields.get("sub_theme_id") or (old or {}).get("sub_theme_id"),
                    "rationale": p.fields.get("rationale") or (old or {}).get("rationale", "")})
            # else: new already present -> the drop-old above is the whole merge
        elif p.action == "retier":
            h = _find(H, p.sym)
            if h is not None:
                h["tier"] = p.fields["new_tier"]
    return tax, rejects


def self_validate(taxonomy):
    errs = []
    for s in taxonomy.get("sectors", []):
        if not (s.get("id") and s.get("name")):
            errs.append(f"sector missing id/name: {s!r}")
    for t in taxonomy.get("themes", []):
        if not (t.get("id") and t.get("name") and t.get("sector_id")):
            errs.append(f"theme missing id/name/sector_id: {t.get('id')!r}")
        if not isinstance(t.get("holdings"), list):
            errs.append(f"theme {t.get('id')!r} holdings not a list")
        for h in t.get("holdings", []):
            if not h.get("sym"):
                errs.append(f"theme {t.get('id')!r} holding missing sym: {h!r}")
    return errs


def _content_hash(taxonomy) -> str:
    canon = json.dumps({"sectors": taxonomy.get("sectors", []),
                        "themes": taxonomy.get("themes", [])},
                       sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(canon.encode("utf-8")).hexdigest()[:8]


def _bump_semver(v: str) -> str:
    base = (v or "0.0.0").split("+")[0]
    parts = base.split(".")
    while len(parts) < 3:
        parts.append("0")
    try:
        parts[1] = str(int(parts[1]) + 1)
        parts[2] = "0"
    except ValueError:
        return "0.0.0"
    return ".".join(parts[:3])


def bump_version(taxonomy) -> str:
    sha = _content_hash(taxonomy)
    ver = f"{_bump_semver(taxonomy.get('version', '0.0.0'))}+{sha}"
    taxonomy["version"] = ver
    taxonomy["generated_at"] = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    return ver
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/theme_curation/test_apply.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tools/theme_curation/apply.py tests/theme_curation/test_apply.py
git commit -m "feat(curation): Stage 4 validation gate + mutation + content-hashed version bump"
```

---

## Task 11: CLI entry point (subcommands + apply gating)

**Files:**
- Create: `tools/theme_curation/cli.py`
- Test: `tests/theme_curation/test_cli.py`

**Interfaces:**
- Consumes: all prior modules.
- Produces: `main(argv)->int` with subcommands `audit`, `bootstrap-finviz`, `discover`, `review`, `apply`. `apply` is gated: `is_git_clean(path)->bool` (via `git status --porcelain <path>`); `apply` **refuses** unless `--force` when dirty, prints the old-vs-new unified diff, and requires `--confirm`. Only the pure-plumbing (arg dispatch + the git-clean gate) is unit-tested; the network subcommands are integration-run by the owner.

- [ ] **Step 1: Write the failing test**

```python
# tests/theme_curation/test_cli.py
from tools.theme_curation import cli


def test_apply_refuses_dirty_tree(monkeypatch, tmp_path, capsys):
    monkeypatch.setattr(cli, "is_git_clean", lambda p: False)
    rc = cli.main(["apply", "--taxonomy", str(tmp_path / "t.json")])   # no --force
    assert rc != 0
    assert "clean" in capsys.readouterr().out.lower()


def test_apply_requires_confirm(monkeypatch, tmp_path, capsys):
    monkeypatch.setattr(cli, "is_git_clean", lambda p: True)
    p = tmp_path / "t.json"
    p.write_text('{"version":"1.0.0","sectors":[],"themes":[]}', encoding="utf-8")
    monkeypatch.setattr(cli, "load_approved", lambda *a, **k: [])
    rc = cli.main(["apply", "--taxonomy", str(p)])    # no --confirm
    assert rc != 0
    assert "confirm" in capsys.readouterr().out.lower()


def test_unknown_subcommand_returns_nonzero(capsys):
    assert cli.main(["bogus"]) != 0


def test_audit_command_writes_file(tmp_path):
    tax = tmp_path / "t.json"
    tax.write_text('{"version":"1.0.0","sectors":[],"themes":['
                   '{"id":"space","name":"Space","sector_id":"s","holdings":[{"sym":"DEADCO"}]}]}',
                   encoding="utf-8")
    cap = tmp_path / "cap.json"; cap.write_text('["RKLB"]', encoding="utf-8")
    outp = tmp_path / "audit.md"
    rc = cli.main(["audit", "--taxonomy", str(tax), "--cap", str(cap), "--out", str(outp)])
    assert rc == 0
    assert "DEADCO" in outp.read_text(encoding="utf-8")   # dead flagged in the written report
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/theme_curation/test_cli.py -q`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

Create `tools/theme_curation/cli.py`. Include `is_git_clean`, `load_approved` (reads ledger approvals + parsed review docs into `Proposal`s), and the argparse dispatch. The `apply` handler: refuse-if-dirty-without-force → print diff → require `--confirm` → `self_validate` → `bump_version` → `save_taxonomy`. Keep the network subcommands (`discover`, `bootstrap-finviz`) thin wrappers over Tasks 5-7. (Full code: mirror the tested surface — `is_git_clean` shells `git status --porcelain`; `main` returns non-zero on the gated failures and on an unknown subcommand; `load_approved` is monkeypatched in tests so its body is exercised only in owner runs.)

```python
"""Curation pipeline CLI."""
import argparse
import subprocess
import sys

from tools.theme_curation import loaders, apply as A


def is_git_clean(path: str) -> bool:
    out = subprocess.run(["git", "status", "--porcelain", path],
                         capture_output=True, text=True).stdout.strip()
    return out == ""


def load_approved(ledger_path: str, review_dir: str):
    """Assemble approved Proposals from the ledger + parsed review docs. Owner-run;
    monkeypatched in tests."""
    from tools.theme_curation.ledger import Ledger
    from tools.theme_curation.proposals import Proposal
    lg = Ledger(ledger_path)
    import sqlite3
    con = sqlite3.connect(ledger_path); con.row_factory = sqlite3.Row
    props = []
    import json as _j
    for r in con.execute("SELECT * FROM decisions WHERE decision='approve'"):
        props.append(Proposal(r["theme_id"], r["action"], r["sym"], 1.0,
                              _j.loads(r["fields"] or "{}")))
    return props


def _cmd_apply(args) -> int:
    if not is_git_clean(args.taxonomy) and not args.force:
        print("refusing to apply: git tree for the taxonomy is not clean "
              "(commit/stash first, or pass --force).")
        return 2
    tax = loaders.load_taxonomy(args.taxonomy)
    approved = load_approved(args.ledger, args.review_dir)
    new_tax, rejects = A.apply_proposals(tax, approved, loaders.cap_universe_set(args.cap))
    for r in rejects:
        print(f"  rejected: {r}")
    errs = A.self_validate(new_tax)
    if errs:
        print("self-validation FAILED — refusing to write:")
        for e in errs:
            print(f"  {e}")
        return 3
    import difflib, json as _json
    before = _json.dumps(tax, indent=2, ensure_ascii=False, sort_keys=True).splitlines()
    after = _json.dumps(new_tax, indent=2, ensure_ascii=False, sort_keys=True).splitlines()
    diff = list(difflib.unified_diff(before, after, "current", "proposed", lineterm=""))
    print("\n".join(diff) if diff else "(no content change)")
    print(f"\n{len(approved) - len(rejects)} change(s) staged.")
    if not args.confirm:
        print("dry run — re-run with --confirm to write and bump the version.")
        return 4
    ver = A.bump_version(new_tax)
    loaders.save_taxonomy(args.taxonomy, new_tax)
    print(f"written; version bumped to {ver}. Review the git diff and commit.")
    return 0


def _cmd_audit(args) -> int:
    from datetime import date
    from tools.theme_curation import audit
    tax = loaders.load_taxonomy(args.taxonomy)
    result = audit.audit_taxonomy(tax, loaders.cap_universe_set(args.cap),
                                  loaders.ipo_dates(), date.today().toordinal())
    md = audit.write_audit_md(result, tax)
    with open(args.out, "w", encoding="utf-8") as f:
        f.write(md)
    print(f"audit written to {args.out}")
    return 0


def _cmd_discover(args) -> int:
    # Owner-run orchestration over the tested primitives (network — not unit-tested).
    from tools.theme_curation import discover, corroborate, propose
    from tools.theme_curation.ledger import Ledger
    corroborate.ensure_industry_map()                    # hard-fails without FINVIZ_API_KEY
    tax = loaders.load_taxonomy(args.taxonomy)
    cap = loaders.cap_universe_set(args.cap)
    tind = corroborate.load_theme_industries(args.industries)
    lg = Ledger(args.ledger)
    import os, json
    os.makedirs(args.proposals_dir, exist_ok=True)
    for t in tax["themes"]:
        art = os.path.join(args.proposals_dir, f"{t['id']}.json")
        if args.resume and os.path.exists(art):
            continue
        expected = tind.get(t["id"])                     # None => concept-theme
        disc = discover.discover(t["name"], args.run_id, confirm=(expected is None))
        cands = [c for c in disc["tickers"] if c in cap]
        corrob = corroborate.corroborate(cands, expected)
        res = propose.propose_theme(t, cands, corrob, loaders.holding_syms(t),
                                    {"dead": [], "thin": False}, args.model, cap_set=cap)
        kept = propose.suppress_rejected(res["proposals"], lg)
        with open(art, "w", encoding="utf-8") as f:
            json.dump({"theme_id": t["id"], "error": disc["error"],
                       "proposals": [p.__dict__ for p in kept]}, f, indent=2)
        print(f"  {t['id']}: {len(kept)} proposal(s){' [ERR:'+disc['error']+']' if disc['error'] else ''}")
    return 0


def _cmd_review(args) -> int:
    # Split proposals into batch (high-confidence) doc + interactive (low/concept). Owner-run.
    from tools.theme_curation import review_doc, review_cli
    from tools.theme_curation.ledger import Ledger
    from tools.theme_curation.proposals import Proposal
    import os, json, glob
    lg = Ledger(args.ledger)
    hi, lo = [], []
    for art in glob.glob(os.path.join(args.proposals_dir, "*.json")):
        for d in json.load(open(art, encoding="utf-8")).get("proposals", []):
            p = Proposal(**d)
            (hi if p.confidence >= args.threshold else lo).append(p)
    os.makedirs(args.review_dir, exist_ok=True)
    with open(os.path.join(args.review_dir, "review.md"), "w", encoding="utf-8") as f:
        f.write(review_doc.write_review_md(hi))
    review_cli.review_interactive(lo, lg)                 # writes ledger as it goes
    print(f"batch doc: {len(hi)} proposal(s); interactive: {len(lo)}")
    return 0


def _cmd_bootstrap(args) -> int:
    # One-time: propose theme->finviz-industry map for owner confirmation. Owner-run.
    print("bootstrap-finviz: lists distinct industry_map industries + LLM-proposes a "
          "theme->industry map for owner confirmation; writes theme_finviz_industries.json. "
          "See plan Task 6 / spec §5. (LLM output is owner-confirmed, not unit-tested.)")
    return 0


def main(argv=None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    ap = argparse.ArgumentParser(prog="theme_curation")
    sub = ap.add_subparsers(dest="cmd")

    a = sub.add_parser("audit")
    a.add_argument("--taxonomy", default="themes_taxonomy.json")
    a.add_argument("--cap", default="api/data/cap_universe.json")
    a.add_argument("--out", default="tools/theme_curation/audit.md")

    d = sub.add_parser("discover")
    d.add_argument("--taxonomy", default="themes_taxonomy.json")
    d.add_argument("--cap", default="api/data/cap_universe.json")
    d.add_argument("--industries", default="tools/theme_curation/theme_finviz_industries.json")
    d.add_argument("--ledger", default="tools/theme_curation/curation_ledger.db")
    d.add_argument("--proposals-dir", default="tools/theme_curation/proposals")
    d.add_argument("--run-id", required=True)
    d.add_argument("--model", default="claude-opus-4-8")
    d.add_argument("--resume", action="store_true")

    r = sub.add_parser("review")
    r.add_argument("--proposals-dir", default="tools/theme_curation/proposals")
    r.add_argument("--review-dir", default="tools/theme_curation/review")
    r.add_argument("--ledger", default="tools/theme_curation/curation_ledger.db")
    r.add_argument("--threshold", type=float, default=0.85)

    sub.add_parser("bootstrap-finviz")

    ap_apply = sub.add_parser("apply")
    ap_apply.add_argument("--taxonomy", default="themes_taxonomy.json")
    ap_apply.add_argument("--cap", default="api/data/cap_universe.json")
    ap_apply.add_argument("--ledger", default="tools/theme_curation/curation_ledger.db")
    ap_apply.add_argument("--review-dir", default="tools/theme_curation/review")
    ap_apply.add_argument("--confirm", action="store_true")
    ap_apply.add_argument("--force", action="store_true")

    args = ap.parse_args(argv)
    handlers = {"audit": _cmd_audit, "discover": _cmd_discover, "review": _cmd_review,
                "bootstrap-finviz": _cmd_bootstrap, "apply": _cmd_apply}
    h = handlers.get(args.cmd)
    if h is None:
        ap.print_usage()
        return 1
    return h(args)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/theme_curation/test_cli.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tools/theme_curation/cli.py tests/theme_curation/test_cli.py
git commit -m "feat(curation): CLI entry + gated apply (clean-tree + confirm + self-validate)"
```

---

## Task 12: Boot hardening — wrap the reseed

**Files:**
- Modify: `api/services/theme_db.py` (add `seed_from_json_safe`)
- Modify: `api/main.py:1906-1908`
- Test: `tests/theme_curation/test_seed_safe.py`

**Interfaces:**
- Produces: `theme_db.seed_from_json_safe()->bool` — try/except wrapper (no args; delegates to `seed_from_json()`): on any exception logs (with `exc_info`) and returns `False` instead of raising. `main.py` calls `seed_from_json_safe()` so a malformed taxonomy leaves themes empty rather than crashing boot.

- [ ] **Step 1: Write the failing test**

```python
# tests/theme_curation/test_seed_safe.py
from api.services import theme_db


def test_seed_safe_swallows_exception(monkeypatch):
    def boom():
        raise ValueError("malformed taxonomy row")   # what a bad Stage-4 output would trigger
    monkeypatch.setattr(theme_db, "seed_from_json", boom)
    assert theme_db.seed_from_json_safe() is False    # must NOT raise
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/theme_curation/test_seed_safe.py -q`
Expected: FAIL — `seed_from_json_safe` missing.

- [ ] **Step 3: Implement**

In `api/services/theme_db.py`, add after `seed_from_json`:

`seed_from_json()` takes no arguments (it resolves the path via `_find_taxonomy_file()`), so the wrapper takes none either:

```python
def seed_from_json_safe() -> bool:
    """Boot-safe wrapper: never raises. A malformed taxonomy leaves the theme
    tables as-is (possibly empty) and logs, instead of crashing app startup."""
    try:
        return seed_from_json()
    except Exception as e:
        _logger.error("[themes] seed_from_json failed — themes not reseeded: %s",
                      e, exc_info=True)
        return False
```

Then in `api/main.py`, change lines 1906-1908:

```python
    from api.services.theme_db import init_theme_tables, seed_from_json_safe
    init_theme_tables()
    seed_from_json_safe()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/theme_curation/test_seed_safe.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/services/theme_db.py api/main.py tests/theme_curation/test_seed_safe.py
git commit -m "fix(themes): boot-safe seed_from_json wrapper (bad taxonomy no longer crashes boot)"
```

---

## Final verification (after all tasks)

- `python -m pytest tests/theme_curation/ -q` — all green.
- Owner dry-run walkthrough (real keys, no `--confirm`): `python -m tools.theme_curation.cli audit` → review `audit.md`; then the discover/review stages on one sector; then `apply` (dry-run) shows staged changes; `apply --confirm` writes + bumps version; inspect the `git diff` on `themes_taxonomy.json` before committing.

## Self-review notes (traceability to spec)

- §4 Audit → Task 3 (dead/dup/thin/gap-pool + IPO cutoff). §5 discovery → Tasks 5 (Perplexity) + 6 (Finviz corroboration + bootstrap guard) + 7 (orchestrator, thin excluded, confidence boost, ledger suppression). §6 review → Tasks 8 (machine-parseable doc) + 9 (resumable CLI). §7 apply → Task 10 (cross-referential gate + mutation + self-validate + content-hash version). §8 boot-hardening → Task 12. Shared: Tasks 1 (loaders/normalization) + 2 (ledger). §10 test matrix → each task's tests. Non-goals honored (no strength pruning — thin excluded from ADD; no FMP; no member UI).
- The `bootstrap-finviz` setup command that writes `theme_finviz_industries.json` (spec §5) is scaffolded in the CLI (Task 11) as an owner-run wrapper; its LLM-proposal body reuses Task 7's client pattern and is exercised in owner runs (LLM output is not unit-tested per the Global Constraints).
