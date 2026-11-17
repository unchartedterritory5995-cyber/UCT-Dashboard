"""RS Rating L6b: the frontend's seed manifest and the backend's seed registry are ONE list.

`request.seed(source, symbol, …)` is served from `/api/bars/<SOURCE>:<SYMBOL>` only for a
seed `api/services/pine_seed_store.py::SEEDS` registers. The chart decides, at translation
and at bind, which seeds are registered from `requestWitnesses.json` (its `kind: "seed"`
rows), so the two must hold the same keys: a seed registered here but missing there would
be refused by name although it is served, and a manifest row the registry does not hold
would be fetched and answer nothing. This rail holds them equal, with a control showing
it can fail.
"""
import json
from pathlib import Path

from api.services import pine_seed_store as store

MANIFEST = (Path(__file__).resolve().parents[1]
            / "app" / "src" / "components" / "chart" / "engine" / "requestWitnesses.json")


def _manifest_seeds(doc: dict) -> set:
    rows = doc.get("rows") or {}
    return {k.upper() for k, v in rows.items()
            if not k.startswith("_") and isinstance(v, dict) and v.get("kind") == "seed"}


def _agree(manifest: set, registry: set) -> bool:
    return manifest == registry


def test_the_manifest_lists_exactly_the_registered_seeds():
    doc = json.loads(MANIFEST.read_text(encoding="utf-8"))
    assert _manifest_seeds(doc) == set(store.SEEDS)


def test_each_seed_row_is_served_under_its_own_key():
    doc = json.loads(MANIFEST.read_text(encoding="utf-8"))
    for key, row in (doc.get("rows") or {}).items():
        if isinstance(row, dict) and row.get("kind") == "seed":
            assert row.get("store", "").upper() == key.upper()
            assert store.is_seed_symbol(row["store"])


def test_control_the_agreement_check_can_fail():
    doc = json.loads(MANIFEST.read_text(encoding="utf-8"))
    seeds = _manifest_seeds(doc)
    assert seeds, "the manifest holds no seed row: the rail above would pass vacuously"
    assert not _agree(seeds | {"SEED_NOBODY:NOTHING"}, set(store.SEEDS))
    assert not _agree(seeds - {next(iter(seeds))}, set(store.SEEDS))
