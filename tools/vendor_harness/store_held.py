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
_PIN = re.compile(r"^([A-Za-z0-9_]+/[A-Za-z0-9_]+/[1-9][0-9]*)@([0-9a-f]{64})$")


def parse_pin(pin):
    """`path@sha256` -> (path, sha256), or None for anything else."""
    m = _PIN.match(str(pin or ""))
    return (m.group(1), m.group(2)) if m else None


def pin_of(path, sha256):
    return "%s@%s" % (path, str(sha256).lower())


def pins_of(row):
    """The row's store pins (sorted), [] for a row graded without needing the store."""
    v = (row or {}).get(FIELD) if isinstance(row, dict) else None
    return sorted(v) if isinstance(v, list) else []


def store_pins(store):
    """{path@sha} of a `libraryStore` list ([{path, sha256}]), or of a run document carrying one."""
    if isinstance(store, dict):
        store = store.get("libraryStore")
    return {pin_of(e["path"], e["sha256"]) for e in (store or [])
            if isinstance(e, dict) and isinstance(e.get("path"), str) and isinstance(e.get("sha256"), str)}


def held_from(row, loaded):
    """The row's pins the run does NOT hold (`loaded`: a set of path@sha); [] when the run can grade it."""
    return [p for p in pins_of(row) if p not in loaded]


def reading(pins):
    """The name a consumer gives a store-held row."""
    return "store-held: " + ", ".join(pins)


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
    if have != want:
        out.append("graded with store %s, production serves %s" % (sorted(have), sorted(want)))
    for r in (doc or {}).get("results") or []:
        bad = [p for p in pins_of(r) if p not in have]
        if bad:
            out.append("%s needs %s, which the snapshot's store does not hold" % (r.get("id"), bad))
        if r.get(FIELD) is not None and not all(parse_pin(p) for p in r.get(FIELD) or [None]):
            out.append("%s has a malformed %s %r" % (r.get("id"), FIELD, r.get(FIELD)))
    return out
