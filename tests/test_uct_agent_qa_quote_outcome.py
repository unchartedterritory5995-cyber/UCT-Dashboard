"""UCT Agent program, agent-qa: instrument.resolve fixtures for OUTCOME-level quote scoring (MD-1 §4.7).

The REAL server classifier (`instruments.classify`, inside `read_instruments`) over QA's OWN index rows (real US
listings written by agent-qa, not agent-md's symbol-index.json), searched by the REAL `ticker_search_index.search`
(seeded with those rows), so §4.7.5's scan-based checks see the same ranking production uses. For every word in QA's held-out sets (44 + 54) and the
MD-1-phrasings table, in each form the browser can send (upper / lower / cashtag), the classifier's row is stored.
The browser rails (qa/quoteHeldout.test.js, qa/md2Panel.test.jsx) stitch them into resolve envelopes, so the outcome
they score is the one the server would give for that index.

Regenerate:  C:\\UCT\\agent\\.venv\\Scripts\\python.exe -m tests.test_uct_agent_qa_quote_outcome --write
"""
from __future__ import annotations

import contextlib
import json
import re
import sys
import time
from pathlib import Path

from api.services.uct_agent.marketdata import envelope as env
from api.services.uct_agent.marketdata import instruments as ins

REPO = Path(__file__).resolve().parents[1]
SCORES = REPO / "app" / "src" / "agent" / "__fixtures__" / "program" / "scores"
SETS = [SCORES / "quote-heldout.json", SCORES / "quote-heldout-2.json", SCORES / "quote-adversarial-3.json"]
PHRASES = REPO / "docs" / "agent" / "program" / "contracts" / "MD-1-phrasings.md"
OUT = REPO / "app" / "src" / "agent" / "__fixtures__" / "program" / "md2" / "resolve-qa-index.json"
# Set 4 is scored over PRODUCTION rows (agent-lead's and agent-qa's read-only /api/ticker-search probes).
SET4 = SCORES / "quote-adversarial-4.json"
PROBES = [REPO / "app" / "src" / "agent" / "marketdata" / "__fixtures__" / "prod-index-probe.json",
          REPO / "app" / "src" / "agent" / "__fixtures__" / "program" / "md2" / "prod-probe-qa.json"]
PROD_OUT = REPO / "app" / "src" / "agent" / "__fixtures__" / "program" / "md2" / "resolve-prod-union.json"
BUILT_AT = 1793232000.0          # a fixed build time, so the fixture is deterministic

QA_INDEX = [
    ("NVDA", "NVIDIA Corporation", "stock"), ("AMD", "Advanced Micro Devices, Inc.", "stock"),
    ("TSLA", "Tesla, Inc.", "stock"), ("AAPL", "Apple Inc.", "stock"), ("MSFT", "Microsoft Corporation", "stock"),
    ("GOOGL", "Alphabet Inc. Class A", "stock"), ("AMZN", "Amazon.com, Inc.", "stock"), ("META", "Meta Platforms, Inc.", "stock"),
    ("NFLX", "Netflix, Inc.", "stock"), ("PLTR", "Palantir Technologies Inc.", "stock"), ("IT", "Gartner, Inc.", "stock"),
    ("BRK-B", "Berkshire Hathaway Inc. Class B", "stock"), ("S", "SentinelOne, Inc.", "stock"), ("DOW", "Dow Inc.", "stock"),
    ("ALL", "The Allstate Corporation", "stock"), ("KEY", "KeyCorp", "stock"), ("ON", "ON Semiconductor Corporation", "stock"),
    ("GOLD", "Barrick Gold Corporation", "stock"), ("SOL", "Emeren Group Ltd", "stock"), ("LOW", "Lowe's Companies, Inc.", "stock"),
    ("NOW", "ServiceNow, Inc.", "stock"), ("CAN", "Canaan Inc.", "stock"), ("A", "Agilent Technologies, Inc.", "stock"),
    ("SPY", "SPDR S&P 500 ETF Trust", "etf"), ("QQQ", "Invesco QQQ Trust", "etf"), ("BTC", "Grayscale Bitcoin Mini Trust", "etf"),
    ("ETH", "Grayscale Ethereum Mini Trust", "etf"), ("SLV", "iShares Silver Trust", "etf"), ("USO", "United States Oil Fund", "etf"),
    ("GOOG", "Alphabet Inc. Class C", "stock"), ("CAT", "Caterpillar Inc.", "stock"), ("CAR", "Avis Budget Group, Inc.", "stock"),
    ("FUN", "Six Flags Entertainment Corporation", "stock"), ("LINK", "Interlink Electronics, Inc.", "stock"),
    ("GLD", "SPDR Gold Shares", "etf"), ("DIA", "SPDR Dow Jones Industrial Average ETF Trust", "etf"),
    ("IBIT", "iShares Bitcoin Trust ETF", "etf"),
    ("VIX", "CBOE Volatility Index", "index"), ("SPX", "S&P 500 Index", "index"), ("NDX", "Nasdaq-100 Index", "index"),
]


@contextlib.contextmanager
def qa_index(rows=None):
    """Seed the REAL ticker_search_index with QA's rows (restored afterwards); yields the module."""
    from api.services import ticker_search_index as tsi
    rows = QA_INDEX if rows is None else rows
    saved = (tsi._INDEX, tsi._BY_SYM, tsi._BUILT_AT, tsi._LIQ)
    idx = [{"sym": t, "name": n, "name_lc": n.lower(), "type": ty, "exch": "XNAS", "entity_id": None}
           for t, n, ty in sorted(rows)]
    tsi._INDEX, tsi._BY_SYM, tsi._BUILT_AT, tsi._LIQ = idx, {r["sym"]: r for r in idx}, BUILT_AT, {}
    try:
        yield tsi
    finally:
        tsi._INDEX, tsi._BY_SYM, tsi._BUILT_AT, tsi._LIQ = saved


def prod_rows() -> list[tuple]:
    """Every stock/ETF/index row in the production probes, as ONE index (production holds them all at once)."""
    keep = set(ins.EQUITY_TYPES) | set(ins.NON_EQUITY_TYPES)
    rows = {}
    for p in PROBES:
        for k, tok in json.loads(p.read_text(encoding="utf-8")).items():
            if k == "_meta" or not isinstance(tok, dict):
                continue
            for rs in tok.values():
                for r in rs if isinstance(rs, list) else []:
                    if r.get("type") in keep and r.get("ticker"):
                        rows[r["ticker"]] = (r["ticker"], r.get("name") or "", r["type"])
    return sorted(rows.values())


def phrases(sets=None) -> list[str]:
    out = []
    if sets is not None:
        for f in sets:
            out += [r["text"] for r in json.loads(f.read_text(encoding="utf-8"))["rows"]]
        return out
    for f in SETS:
        out += [r["text"] for r in json.loads(f.read_text(encoding="utf-8"))["rows"]]
    for line in PHRASES.read_text(encoding="utf-8").splitlines():
        m = re.match(r"^\|\s*P\d\d\s*\|\s*(.+?)\s*\|", line)
        if m:
            out.append(m.group(1))
    return out


def entries(sets=None) -> list[dict]:
    seen, out = set(), []
    for p in phrases(sets):
        for raw in re.split(r"[\s,;/]+", p):
            w = raw.strip("?!.'\"():").replace("'s", "")
            w = w.split("'")[0]
            if not w or not re.match(r"^\$?[A-Za-z][A-Za-z0-9.\-]{0,11}$", w):
                continue
            base = w.lstrip("$")
            for text, form in ((base.upper(), "upper"), (base.lower(), "lower"), ("$" + base.lower(), "cashtag"),
                               ("$" + base.upper(), "cashtag"), ("$" + base, "cashtag")):
                if (text, form) not in seen:
                    seen.add((text, form))
                    out.append({"text": text, "form": form})
    return out


def fixture_text(prod: bool = False) -> str:
    index_rows = prod_rows() if prod else QA_INDEX
    with qa_index(index_rows) as tsi:
        es = entries([SET4] if prod else None)
        shell = ins.read_instruments({"symbols": [{"text": "NVDA", "form": "upper"}]}, {})
        rows = {f"{e['text']}|{e['form']}": ins.classify(e["text"], e["form"], tsi) for e in es}
    shell = {k: v for k, v in shell.items() if k not in ("fetched_at", "params_echo")}
    shell["stale"] = False
    if prod:
        body = {"about": "generated by tests/test_uct_agent_qa_quote_outcome.py: the REAL classifier over PRODUCTION rows "
                         "(the two read-only probes as one index), for set 4", "index_rows": len(index_rows),
                "shell": shell, "entries": rows}
    else:
        body = {"about": "generated by tests/test_uct_agent_qa_quote_outcome.py — the REAL classifier over QA's own index",
                "index": [{"ticker": t, "name": n, "type": ty} for t, n, ty in QA_INDEX], "shell": shell, "entries": rows}
    return json.dumps(body, indent=1, sort_keys=True) + "\n"


def test_non_vacuity_the_traps_classify_as_the_contract_says():
    with qa_index() as idx:
        assert ins.classify("BTC", "upper", idx)["class"] == "symbol"                    # P32: the ETF, named
        assert ins.classify("btc", "lower", idx)["class"] == "symbol_typed_lowercase"   # P31: ask
        assert ins.classify("gold", "lower", idx)["candidate"]["symbol"] == "GOLD"      # P33: ask
        assert ins.classify("SPX", "upper", idx)["class"] == "non_equity"               # P37: limit
        assert ins.classify("nvdia", "lower", idx)["class"] == "unknown"                # P36: limit
        assert ins.classify("apple", "lower", idx)["class"] == "name_match"             # P35: ask AAPL
        assert ins.classify("nvda", "lower", idx)["class"] == "symbol"                  # §4.7.5: confirmed
        assert ins.classify("sol", "lower", idx)["class"] == "symbol_typed_lowercase"   # §4.7.5: Emeren is not "sol"


def test_the_resolve_fixture_is_current():
    want = fixture_text()
    assert OUT.exists(), "generate: python -m tests.test_uct_agent_qa_quote_outcome --write"
    assert OUT.read_text(encoding="utf-8").replace("\r\n", "\n") == want, "regenerate with --write"


def test_the_production_union_fixture_is_current():
    want = fixture_text(prod=True)
    assert PROD_OUT.exists(), "generate: python -m tests.test_uct_agent_qa_quote_outcome --write"
    assert PROD_OUT.read_text(encoding="utf-8").replace("\r\n", "\n") == want, "regenerate with --write"
    assert json.loads(want)["index_rows"] > 1000                     # non-vacuity: production-sized


if __name__ == "__main__":
    if "--write" in sys.argv:
        for path, text in ((OUT, fixture_text()), (PROD_OUT, fixture_text(prod=True))):
            path.parent.mkdir(parents=True, exist_ok=True)
            with open(path, "w", encoding="utf-8", newline="\n") as fh:
                fh.write(text)
            print(path, len(json.loads(text)["entries"]), "entries")
