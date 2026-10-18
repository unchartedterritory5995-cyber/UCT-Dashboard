"""A0 — the escape census's outbound payload encodes without recursion.

The census hands node a 4,000-deep corpus tree. `json.dumps` raised `RecursionError`
on Windows builds of CPython 3.12 (a compiled-in C-recursion budget), so the census
could only run on Linux. `_dumps_iterative` must be byte-identical to `json.dumps`
and must never be the thing that limits depth.
"""
from __future__ import annotations

import json
import random

from tools import ast_conformance as ac


def _random_value(rng: random.Random, depth: int = 0):
    roll = rng.random()
    if depth > 6 or roll < 0.3:
        return rng.choice([0, 1, -2.5, 0.1, 1e-9, 10 ** 20, "", 'q"uote', "snow☃",
                           True, False, None])
    if roll < 0.65:
        return [_random_value(rng, depth + 1) for _ in range(rng.randint(0, 4))]
    return {f"k{rng.randint(0, 9)}é": _random_value(rng, depth + 1)
            for _ in range(rng.randint(0, 4))}


def test_the_iterative_encoder_is_byte_identical_to_json_dumps():
    rng = random.Random(20261013)
    for _ in range(2000):
        value = _random_value(rng)
        assert ac._dumps_iterative(value) == json.dumps(value)


def test_the_iterative_encoder_has_no_depth_limit_of_its_own():
    value: dict = {"type": "series", "name": "close"}
    for _ in range(6000):
        value = {"type": "op", "name": "+", "args": [value, {"type": "num", "value": 1}]}
    text = ac._dumps_iterative(value)
    assert text.startswith('{"type": "op"') and text.count('"op"') == 6000
