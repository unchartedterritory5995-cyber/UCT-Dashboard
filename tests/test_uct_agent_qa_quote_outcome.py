"""UCT Agent program, agent-qa: instrument.resolve fixtures for OUTCOME-level quote scoring (MD-1 §4.7).

The REAL server classifier (`instruments.classify`, inside `read_instruments`) over QA's OWN index: real US listings
written by agent-qa, not agent-md's symbol-index.json. For every word in QA's held-out sets (44 + 54) and the
MD-1-phrasings table, in each form the browser can send (upper / lower / cashtag), the classifier's row is stored.
The browser rails (qa/quoteHeldout.test.js, qa/md2Panel.test.jsx) stitch them into resolve envelopes, so the outcome
they score is the one the server would give for that index.

Regenerate:  C:\\UCT\\agent\\.venv\\Scripts\\python.exe -m tests.test_uct_agent_qa_quote_outcome --write
"""
from __future__ import annotations

import json
import re
import sys
import time
from pathlib import Path

from api.services.uct_agent.marketdata import envelope as env
from api.services.uct_agent.marketdata import instruments as ins

REPO = Path(__file__).resolve().parents[1]
SCORES = REPO / "app" / "src" / "agent" / "__fixtures__" / "program" / "scores"
SETS = [SCORES / "quote-heldout.json", SCORES / "quote-heldout-2.json"]
PHRASES = REPO / "docs" / "agent" / "program" / "contracts" / "MD-1-phrasings.md"
OUT = REPO / "app" / "src" / "agent" / "__fixtures__" / "program" / "md2" / "resolve-qa-index.json"
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
    ("VIX", "CBOE Volatility Index", "index"), ("SPX", "S&P 500 Index", "index"), ("NDX", "Nasdaq-100 Index", "index"),
]


class QAIndex:
    def ready(self):
        return True

    def status(self):
        return {"built_at": BUILT_AT}

    def search(self, q, limit=20, types=None):
        qs = str(q).upper().replace(".", "-")
        rows = [{"ticker": t, "name": n, "type": ty} for t, n, ty in QA_INDEX if types is None or ty in types]
        exact = [r for r in rows if r["ticker"] == qs]
        prefix = [r for r in rows if r["ticker"].startswith(qs) and r not in exact]
        named = [r for r in rows if str(q).lower() in r["name"].lower() and r not in exact and r not in prefix]
        return (exact + prefix + named)[:limit]


def phrases() -> list[str]:
    out = []
    for f in SETS:
        out += [r["text"] for r in json.loads(f.read_text(encoding="utf-8"))["rows"]]
    for line in PHRASES.read_text(encoding="utf-8").splitlines():
        m = re.match(r"^\|\s*P\d\d\s*\|\s*(.+?)\s*\|", line)
        if m:
            out.append(m.group(1))
    return out


def entries() -> list[dict]:
    seen, out = set(), []
    for p in phrases():
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


def fixture_text() -> str:
    real_index, real_time = ins._index, ins.time
    ins._index = lambda: QAIndex()
    try:
        es = entries()
        shell = ins.read_instruments({"symbols": [{"text": "NVDA", "form": "upper"}]}, {})
        rows = {f"{e['text']}|{e['form']}": ins.classify(e["text"], e["form"], QAIndex()) for e in es}
    finally:
        ins._index = real_index
    shell = {k: v for k, v in shell.items() if k not in ("fetched_at", "params_echo")}
    shell["stale"] = False
    body = {"about": "generated by tests/test_uct_agent_qa_quote_outcome.py — the REAL classifier over QA's own index",
            "index": [{"ticker": t, "name": n, "type": ty} for t, n, ty in QA_INDEX], "shell": shell, "entries": rows}
    return json.dumps(body, indent=1, sort_keys=True) + "\n"


def test_non_vacuity_the_traps_classify_as_the_contract_says():
    ins_index = QAIndex()
    assert ins.classify("BTC", "upper", ins_index)["class"] == "symbol"                    # P32: the ETF, named
    assert ins.classify("btc", "lower", ins_index)["class"] == "symbol_typed_lowercase"   # P31: ask
    assert ins.classify("gold", "lower", ins_index)["candidate"]["symbol"] == "GOLD"      # P33: ask, named
    assert ins.classify("SPX", "upper", ins_index)["class"] == "non_equity"               # P37: limit
    assert ins.classify("nvdia", "lower", ins_index)["class"] == "unknown"                # P36: limit
    assert ins.classify("apple", "lower", ins_index)["class"] == "name_match"             # P35: ask AAPL


def test_the_resolve_fixture_is_current():
    want = fixture_text()
    assert OUT.exists(), "generate: python -m tests.test_uct_agent_qa_quote_outcome --write"
    assert OUT.read_text(encoding="utf-8").replace("\r\n", "\n") == want, "regenerate with --write"


if __name__ == "__main__":
    if "--write" in sys.argv:
        text = fixture_text()
        OUT.parent.mkdir(parents=True, exist_ok=True)
        with open(OUT, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(text)
        print(OUT, len(json.loads(text)["entries"]), "entries")
