"""The device store's mirror of the server's price grain (app/src/data/deviceStore/price.js) — the SERVER half.

The server stores a bar price as `round(float(value), PRICE_DP)` (api/services/bars_fetch.py::_px). The device
store rounds the universe minute frames' raw vendor prices the same way, so a device-painted bar is bit-identical
to the one /api/bars serves. The cases both sides are held to live in
app/src/data/deviceStore/__fixtures__/server_price.json, GENERATED from `_px` itself:

    python tests/test_device_store_server_price.py --write

This file proves the fixture still IS the server's rounding (a change to `_px`, to PRICE_DP, or a move to
Decimal quantize turns it red by name), and that the JS constant names the same number of decimals.
price.test.js proves the JS mirror answers every case bit for bit.
"""

import json
import math
import os
import random
import re
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FIXTURE = os.path.join(REPO, "app", "src", "data", "deviceStore", "__fixtures__", "server_price.json")
PRICE_JS = os.path.join(REPO, "app", "src", "data", "deviceStore", "price.js")

# The six sub-penny stream prices measured on 2026-11-20 against /api/bars (stream -> served).
MEASURED = [
    (11.356196, 11.3562),   # F 12:27 high
    (5.565822, 5.5658),     # MARA 11:52 high
    (5.453962, 5.454),      # MARA 12:58 low
    (21.974304, 21.9743),   # SMCI 12:49 close
    (61.113935, 61.1139),   # XLE 11:33 open and low
    (81.210387, 81.2104),   # TLT 11:39 open
]


def _cases():
    """Every input the fixture holds, in a fixed order (deterministic: the same file every time)."""
    xs = [x for x, _ in MEASURED]
    # EXACT ties at 4 decimals: a double whose fractional part is j/32 with j odd (x * 2 * 10^4 is odd).
    ties = [base + j / 32 for base in (0, 1, 5, 21, 61, 81, 100, 999, 12345, 654321) for j in range(1, 32, 2)]
    xs += ties
    # the nearest doubles on either side of every tie: one rounds down, one up, whatever the float product says
    xs += [math.nextafter(t, math.inf) for t in ties] + [math.nextafter(t, -math.inf) for t in ties]
    # near halves that are NOT exact ties (their binary value sits a hair above or below)
    xs += [0.00005, 0.00015, 1.00005, 2.00015, 5.55555, 1234.56785, 0.12345, 9.99995, 99.99995, 2.675, 1.0000500000000001]
    # already on the grain, integers, large and tiny
    xs += [5.5658, 0.0001, 123.4567, 1.0, 42.0, 1e9, 700000.123456, 450000000000.12345, 2 ** 52 / 1e4 + 0.123,
           2 ** 52 - 0.5, float(2 ** 52), 1e15 + 0.125, 1e16, 1e-5, 4.9e-5, 5e-5, 5.0000001e-5, 1e-300, 5e-324]
    rnd = random.Random(20261120)
    xs += [round(rnd.uniform(0.0001, 3000), 6) for _ in range(400)]           # vendor-looking prices
    xs += [rnd.uniform(0, 1000) for _ in range(200)]                           # arbitrary doubles
    xs += [round(rnd.uniform(0.0001, 1), 7) for _ in range(100)]               # sub-dollar names
    xs += [-x for x in xs[:6] + ties[:16]] + [0.0, -0.0]
    return xs


def _server():
    from api.services import bars_fetch
    return bars_fetch


def _load():
    with open(FIXTURE, encoding="utf-8") as fh:
        return json.load(fh)


def test_the_fixture_is_the_servers_rounding_bit_for_bit():
    bf = _server()
    fx = _load()
    assert fx["dp"] == bf.PRICE_DP, "PRICE_DP moved: regenerate the fixture, then update price.js PRICE_DP"
    wrong = []
    for x, want in fx["cases"]:
        got = bf._px(x)
        if got.hex() != float(want).hex():
            wrong.append((x, want, got))
    assert not wrong, f"{len(wrong)} fixture cases are no longer what the server stores, e.g. {wrong[:3]}"


def test_the_fixture_holds_the_cases_that_distinguish():
    """Without exact ties and the measured prices the JS rail could pass a naive mirror."""
    fx = _load()
    xs = {x for x, _ in fx["cases"]}
    for x, _ in MEASURED:
        assert x in xs
    assert 0.03125 in xs and 21.21875 in xs and math.nextafter(0.03125, 0) in xs
    # Two wrong mirrors, each caught by name: rounding the FLOAT PRODUCT (even with ties to even, it lands on the
    # wrong side when the product's own rounding crosses a half) and breaking ties UPWARD (Math.round, toFixed).
    product = sum(1 for x, want in fx["cases"] if round(x * 10 ** 4) / 10 ** 4 != want)
    half_up = sum(1 for x, want in fx["cases"] if x > 0 and math.floor(x * 10 ** 4 + 0.5) / 10 ** 4 != want)
    assert product > 0 and half_up > 0, (product, half_up)


def test_the_measured_stream_prices_round_to_what_api_bars_served():
    bf = _server()
    for x, served in MEASURED:
        assert bf._px(x) == served, (x, served)


def test_the_js_mirror_names_the_same_number_of_decimals():
    js = open(PRICE_JS, encoding="utf-8").read()
    m = re.search(r"export const PRICE_DP = (\d+)", js)
    assert m and int(m.group(1)) == _server().PRICE_DP


def test_specials_round_to_themselves():
    bf = _server()
    assert math.isnan(bf._px(float("nan")))
    assert bf._px(float("inf")) == float("inf") and bf._px(float("-inf")) == float("-inf")


if __name__ == "__main__" and "--write" in sys.argv:
    sys.path.insert(0, REPO)
    bf = _server()
    out = {
        "_readme": "GENERATED by tests/test_device_store_server_price.py --write from api/services/bars_fetch.py::_px. "
                   "Each case is [input, what the server stores]. Do not edit by hand.",
        "dp": bf.PRICE_DP,
        "cases": [[x, bf._px(x)] for x in _cases()],
    }
    os.makedirs(os.path.dirname(FIXTURE), exist_ok=True)
    tmp = FIXTURE + ".tmp"
    with open(tmp, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(out, fh, separators=(",", ":"))
        fh.write("\n")
    os.replace(tmp, FIXTURE)
    print(f"wrote {len(out['cases'])} cases to {FIXTURE}")
