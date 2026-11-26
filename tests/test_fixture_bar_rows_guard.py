# -*- coding: utf-8 -*-
"""No dump of our data vendor's bars is committed under tests/fixtures (e98, coordinator ruling 2026-11-26).

The store's bars (`GET /api/bars/<ticker>?...`: `{"bars": [{"t", "o", "h", "l", "c", "v"}, ...]}`) are our data
vendor's LICENSED data, and this repo is public. A measurement that needs them (the C41 intraday-store agreement
witness, `storeIntradayAgreement.test.js`) reads them from a LOCAL path outside the repo (`STORE_INTRADAY_LOCAL`).
This rail keeps an accidental commit out: no JSON file under tests/fixtures may hold a list of more than
`MAX_BAR_ROWS` bar-shaped objects (a dict with "o", "h", "l" and "c"), unless it is on the committed baseline
(`tests/fixtures_bar_rows_baseline.json`, the files that predate this rail), and a baselined file may not grow.
The baseline only shrinks: an entry whose file no longer exceeds the limit must be removed.

TradingView captures (`bars.rows`, lists of arrays) are not bar-shaped objects and are not counted here; they are
governed by docs/pine/LICENSING.md.

Cheap by construction: a file is parsed only when its raw text holds more than `MAX_BAR_ROWS` `"o":` keys.
"""
from __future__ import annotations

import json
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FIXTURES = os.path.join(ROOT, "tests", "fixtures")
BASELINE = os.path.join(ROOT, "tests", "fixtures_bar_rows_baseline.json")
#: The most bar-shaped objects one list in a committed fixture may hold (a synthetic pattern fixture is tens to a few
#: hundred bars; the store's 15m history of one ticker is tens of thousands).
MAX_BAR_ROWS = 500
_O_KEY = re.compile(rb'"o"\s*:')
_BAR_KEYS = {"o", "h", "l", "c"}


def max_bar_rows(doc) -> int:
    """The longest list of bar-shaped objects anywhere in `doc`."""
    best = 0
    stack = [doc]
    while stack:
        node = stack.pop()
        if isinstance(node, dict):
            stack.extend(v for v in node.values() if isinstance(v, (dict, list)))
        elif isinstance(node, list):
            if node and all(isinstance(x, dict) and _BAR_KEYS <= x.keys() for x in node[:3]):
                best = max(best, sum(1 for x in node if isinstance(x, dict) and _BAR_KEYS <= x.keys()))
            stack.extend(v for v in node if isinstance(v, (dict, list)))
    return best


def scan(root: str = FIXTURES, limit: int = MAX_BAR_ROWS) -> dict:
    """{repo-relative path: max bar rows} for every JSON file under `root` over `limit`."""
    over = {}
    for dirpath, _dirs, files in os.walk(root):
        for name in files:
            if not name.endswith(".json"):
                continue
            path = os.path.join(dirpath, name)
            with open(path, "rb") as fh:
                raw = fh.read()
            if len(_O_KEY.findall(raw)) <= limit:
                continue
            try:
                doc = json.loads(raw.decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError):
                continue
            n = max_bar_rows(doc)
            if n > limit:
                try:
                    key = os.path.relpath(path, ROOT)
                except ValueError:  # another drive (a test's temporary directory on Windows)
                    key = path
                over[key.replace(os.sep, "/")] = n
    return over


def problems(over: dict, baseline: dict) -> list[str]:
    out = []
    for path, n in sorted(over.items()):
        if path not in baseline:
            out.append(f"{path}: {n} bar rows (> {MAX_BAR_ROWS}). Vendor bars are read from a local path, never committed")
        elif n > baseline[path]:
            out.append(f"{path}: {n} bar rows, grown from the baselined {baseline[path]}")
    for path in sorted(set(baseline) - set(over)):
        out.append(f"{path}: on the baseline but no longer over {MAX_BAR_ROWS} rows; remove it (the baseline only shrinks)")
    return out


def test_no_fixture_holds_a_vendor_bar_dump():
    with open(BASELINE, encoding="utf-8") as fh:
        baseline = json.load(fh)["files"]
    found = problems(scan(), baseline)
    assert not found, "\n".join(found)


def test_no_store_payload_directory():
    store = os.path.join(FIXTURES, "store")
    held = [n for n in os.listdir(store)] if os.path.isdir(store) else []
    assert not held, f"tests/fixtures/store holds {held}: a store payload is read from STORE_INTRADAY_LOCAL, never committed"


def test_control_the_guard_can_fail(tmp_path):
    bars = [{"t": i, "o": 1.0, "h": 2.0, "l": 0.5, "c": 1.5, "v": 10} for i in range(MAX_BAR_ROWS + 1)]
    (tmp_path / "dump.json").write_text(json.dumps({"bars": bars}), encoding="utf-8")
    (tmp_path / "small.json").write_text(json.dumps({"bars": bars[:MAX_BAR_ROWS]}), encoding="utf-8")
    (tmp_path / "rows.json").write_text(json.dumps({"bars": {"rows": [[i, 1, 2, 0.5, 1.5, 10] for i in range(5000)]}}),
                                        encoding="utf-8")
    over = scan(str(tmp_path))
    assert list(over.values()) == [MAX_BAR_ROWS + 1] and len(over) == 1
    assert problems(over, {}) and "dump.json" in problems(over, {})[0]
    # a baselined file that grows, and a stale baseline entry, are both named
    key = next(iter(over))
    assert problems(over, {key: MAX_BAR_ROWS + 1}) == []
    assert "grown" in problems(over, {key: MAX_BAR_ROWS})[0]
    assert "remove it" in problems({}, {key: 600})[0]
