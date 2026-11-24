# -*- coding: utf-8 -*-
"""store_held.py - verdict and census rows graded WITH a library store, read by a consumer that may not have it.

WHY (libraries chain, coordinator ruling 2026-11-19). Production's library store serves the allowlist's `promote`
rows, so the committed harness snapshots are graded with that store loaded (`PINE_LIBRARY_STORE`): a script that
imports a promoted version is graded on what members are drawn. Library code is never committed, so CI has no
store. Each row graded with the store therefore records the versions it needed (`storeHeld`, written by
`app/src/components/chart/engine/__tests__/vendorHarness/storeHeld.js`): `<Author>/<Library>/<N>@<sha256>`.

THE RULE. In a run that does not hold a row's pins (a store-less run holds none), that row is STORE-HELD: it is
never counted as lost, as MATCH or as DIVERGE, and every consumer names it ("store-held: <path@sha>, ...") the way
`itNeedsHeld` names a licence-held capture. Every other row is compared as before. This module is the one
authority over the spelling and the rule; the consumers import it.

⭐⭐ HELD INPUTS, TWO KINDS, ONE RULE (coordinator ruling 2026-11-19, Q-FRED-NHDOT). A grade can also depend on a
LOCAL supply record: the bars a capture's other symbols were served from (`uct.harness-supply/v1`), recorded beside a
capture but never committed when they carry a vendor's or a store's bars the owner has not cleared for the public
repository. Such a record is read from the HELD supply directory (`UCT_HARNESS_SUPPLY_HELD`, `ourSide.js`), never from
`tests/fixtures/vendor-supply`, and the row graded with it records it in `supplyHeld`: `supply/<captureId>@<sha256 of
the record's bytes>`. A run carries what it loaded as `libraryStore` and `supplyHeldStore` ([{captureId, sha256}]).
`pins_of`, `store_pins`, `held_from` and `reading` cover both kinds, so every consumer that goes through them names a
supply-held row ("supply-held: supply/<id>@<sha>") exactly as it names a store-held one.
"""
from __future__ import annotations

import json
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SNAPSHOTS = {lane: os.path.join(ROOT, "docs", "pine", "vendor-harness", lane, "verdicts.json")
             for lane in ("production", "runtime-on")}
ALLOWLIST = os.path.join(ROOT, "tools", "pine_library", "promotion_allowlist.json")
FIELD = "storeHeld"
SUPPLY_FIELD = "supplyHeld"
SUPPLY_STORE = "supplyHeldStore"
_PIN = re.compile(r"^([A-Za-z0-9_]+/[A-Za-z0-9_]+/[1-9][0-9]*)@([0-9a-f]{64})$")
#: a capture id (`evidence_engine.ID_RX`'s alphabet, a phase suffix included), behind the `supply/` kind
_SUPPLY_PIN = re.compile(r"^(supply/[a-z0-9][a-z0-9.!-]*)@([0-9a-f]{64})$")
#: e95 (unit 2, ruling F1) -- the THIRD held kind: a hand-added built-in graded on its published source, held locally
#: (`vendorHarness/builtinSource.js`), `source/<STD id>@<sha256>` (`sourceHeld`); a run names what it held in
#: `sourceHeldStore` ([{id, sha256}]). Never committed: it is TradingView's code.
SOURCE_FIELD = "sourceHeld"
SOURCE_STORE = "sourceHeldStore"
_SOURCE_PIN = re.compile(r"^(source/STD;[A-Za-z0-9_%;.!-]+)@([0-9a-f]{64})$")


def parse_pin(pin):
    """`path@sha256` -> (path, sha256), or None for anything else. A supply pin's path is `supply/<captureId>`."""
    m = _PIN.match(str(pin or "")) or _SUPPLY_PIN.match(str(pin or "")) or _SOURCE_PIN.match(str(pin or ""))
    return (m.group(1), m.group(2)) if m else None


def kind_of(pin):
    """'store' (a library version), 'supply' (a local supply record) or None (malformed)."""
    if _SUPPLY_PIN.match(str(pin or "")):
        return "supply"
    if _SOURCE_PIN.match(str(pin or "")):
        return "source"
    return "store" if _PIN.match(str(pin or "")) else None


def pin_of(path, sha256):
    return "%s@%s" % (path, str(sha256).lower())


def supply_pin_of(capture_id, sha256):
    return pin_of("supply/%s" % capture_id, sha256)


def pins_of(row):
    """The row's held pins (sorted): its library versions AND its local supply records; [] for a row graded
    without needing either."""
    if not isinstance(row, dict):
        return []
    out = []
    for field in (FIELD, SUPPLY_FIELD, SOURCE_FIELD):
        v = row.get(field)
        if isinstance(v, list):
            out.extend(v)
    return sorted(out)


def store_pins(store):
    """{pin} a run holds: its `libraryStore` ([{path, sha256}]) and, for a run document, its `supplyHeldStore`
    ([{captureId, sha256}]); a bare `libraryStore` list gives its library pins alone."""
    supply = []
    source = []
    if isinstance(store, dict):
        supply = store.get(SUPPLY_STORE) or []
        source = store.get(SOURCE_STORE) or []
        store = store.get("libraryStore")
    out = {pin_of(e["path"], e["sha256"]) for e in (store or [])
           if isinstance(e, dict) and isinstance(e.get("path"), str) and isinstance(e.get("sha256"), str)}
    out |= {supply_pin_of(e["captureId"], e["sha256"]) for e in supply
            if isinstance(e, dict) and isinstance(e.get("captureId"), str) and isinstance(e.get("sha256"), str)}
    out |= {pin_of("source/%s" % e["id"], e["sha256"]) for e in source
            if isinstance(e, dict) and isinstance(e.get("id"), str) and isinstance(e.get("sha256"), str)}
    return out


def held_from(row, loaded):
    """The row's pins the run does NOT hold (`loaded`: a set of path@sha); [] when the run can grade it."""
    return [p for p in pins_of(row) if p not in loaded]


def reading(pins):
    """The name a consumer gives a held row: "store-held: …" for library versions, "supply-held: …" for local supply
    records, both when it needs both (a store-only row reads exactly as it always did)."""
    store = [p for p in pins if kind_of(p) not in ("supply", "source")]
    supply = [p for p in pins if kind_of(p) == "supply"]
    source = [p for p in pins if kind_of(p) == "source"]
    parts = (["store-held: " + ", ".join(store)] if store else []) + (["supply-held: " + ", ".join(supply)] if supply else [])
    parts += ["source-held: " + ", ".join(source)] if source else []
    return "; ".join(parts) if parts else "store-held: "


def promoted_store(allowlist=ALLOWLIST):
    """[{path, sha256}] of the allowlist's `promote` rows, sorted: the store production serves."""
    doc = json.load(open(allowlist, encoding="utf-8"))
    return sorted(({"path": r["path"], "sha256": str(r["sha256"]).lower()} for r in doc.get("promote") or []),
                  key=lambda e: e["path"])


def compare(snapshot, run):
    """Compare a run's verdicts with a snapshot's, store-held rows by name.

    Returns {"lost": [id], "toDiverge": [id], "moved": [(id, was, now)], "storeHeld": {id: reading}}:
      * a snapshot row the run does not hold the pins for is STORE-HELD, never lost / moved / DIVERGE;
      * `lost`: a snapshot MATCH the run grades otherwise; `toDiverge`: a snapshot MATCH the run grades DIVERGE;
      * `moved`: every other verdict change, both ways.
    A run that holds a row's pins (the same store loaded) compares that row as any other."""
    loaded = store_pins(run)
    was = {r["id"]: r for r in (snapshot or {}).get("results") or []}
    now = {r["id"]: r for r in (run or {}).get("results") or []}
    out = {"lost": [], "toDiverge": [], "moved": [], "storeHeld": {}}
    for cid in sorted(set(was) | set(now)):
        held = held_from(was.get(cid), loaded) or held_from(now.get(cid), loaded)
        if held:
            out["storeHeld"][cid] = reading(held)
            continue
        a, b = (was.get(cid) or {}).get("verdict"), (now.get(cid) or {}).get("verdict")
        if a == b:
            continue
        if a == "MATCH" and b == "DIVERGE":
            out["toDiverge"].append(cid)
        if a == "MATCH":
            out["lost"].append(cid)
        out["moved"].append((cid, a, b))
    return out


def snapshot_store_problems(doc, promoted):
    """Why a committed snapshot was not graded with production's store, or with rows that do not say so."""
    out = []
    want = store_pins(promoted)
    have = store_pins(doc)
    have_library = {p for p in have if kind_of(p) == "store"}
    if have_library != want:
        out.append("graded with store %s, production serves %s" % (sorted(have_library), sorted(want)))
    for r in (doc or {}).get("results") or []:
        bad = [p for p in pins_of(r) if p not in have]
        if bad:
            out.append("%s needs %s, which the snapshot's store does not hold" % (r.get("id"), bad))
        for field, kind in ((FIELD, "store"), (SUPPLY_FIELD, "supply")):
            if r.get(field) is not None and not all(kind_of(p) == kind for p in r.get(field) or [None]):
                out.append("%s has a malformed %s %r" % (r.get("id"), field, r.get(field)))
        # a supply pin names THIS row's own record: a row never claims another capture's supply
        for p in r.get(SUPPLY_FIELD) or []:
            got = parse_pin(p)
            if got and got[0] != "supply/%s" % r.get("id"):
                out.append("%s claims another capture's supply record %s" % (r.get("id"), p))
    return out
