"""P0/0P — plant a user-definition row AS PRODUCTION HOLDS ONE FROM BEFORE THE
SERVER'S SAVE ADMISSION GATE (`user_definitions._admit_new_maths`).

Since P0/0P the store REFUSES new maths the browser's Save would refuse: a tree
the table cannot run, an over-budget tree, a `repaints` plot, an unacknowledged
`preview-repaints` plot. Rows like that still EXIST — every one saved before the
gate, and every one whose verdict a later linter/table change moved — and the
DOWNSTREAM doors (alert admission, the catalog, relint, the wire, the parameter
manifest) are defence in depth for exactly those rows. Tests of those doors
plant them through the REAL `save` with only the admission switched off, so the
hash, `rev`, `repaint` column and requirements are byte-for-byte what such a row
carries in production.

⛔ NEVER USE THIS TO TEST THE SAVE DOOR ITSELF — that is
`tests/test_p0_truth_save.py`, which drives the gate ON.
"""
from __future__ import annotations

import contextlib

from api.services import user_definitions as _ud


@contextlib.contextmanager
def admission_gate_off():
    original = _ud._admit_new_maths
    _ud._admit_new_maths = lambda *a, **k: None
    try:
        yield
    finally:
        _ud._admit_new_maths = original


def save_legacy(user_id, def_id, definition, **kwargs) -> dict:
    """`user_definitions.save`, as it behaved before the admission gate."""
    with admission_gate_off():
        return _ud.save(user_id, def_id, definition, **kwargs)
