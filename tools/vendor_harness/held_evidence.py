# -*- coding: utf-8 -*-
"""held_evidence.py - THE ONE READER OF EVIDENCE FROM LICENCE-HELD CAPTURES (coordinator rulings 2026-11-19).

    python tools/vendor_harness/held_evidence.py --check      # CI: the committed door file is the ledger's derivation
    python tools/vendor_harness/held_evidence.py --write      # re-derive it (after a regrade files new ledger rows)
    from held_evidence import held_rows, held_kills, held_withholds, first_diverging, lane_withholds, LANES

A licence-held capture never enters git: its TEXT stays on the machine that took it. What enters git is its LEDGER ROW
(`docs/pine/vendor-harness/evidence-ledger.jsonl`, `evidence_ledger.make_row`): hashes, ids, per-lane verdicts and
reasons and, since 2026-11-19, each lane's FIRST DIVERGING ITEM (`first`), the document the grade was taken on (`door`)
and the NARROWEST WITHHOLDS that remove exactly what differs (`withholds`). So everything decided by a held capture is
derivable in CI from committed bytes alone, and this module is the one place that reads it.

THE GOVERNING RULE (never take away a correct picture): the NARROWEST withhold that removes exactly the wrong element and
keeps the correct ones. A whole-script kill only when the wrong element cannot be isolated.
  * `held_withholds(lane)`  -> the item-scoped withholds, each named for the door that honours it:
        output        a drawn row by title (a plot, a plotshape family, ...), values wrong;
        outputColour  a drawn row's COLOUR by title, its values right (drawn in the neutral ink, its colour named);
        paint         a `bgcolor` / `barcolor` by kind and line;
        objectFamily  a drawing family (`line`, `label`, `box`, `table`).
    Derived into the door's file `app/src/components/chart/engine/heldWithholds.json` (`--write`, `--check`).
  * `held_kills(lane)`      -> a whole script, only where a DRAWN difference could not be isolated.
  * the host lane's known-divergence list (`host_divergence.py`) takes the production lane's kills from here; the runtime
    kill list (`api/data/pine_runtime_killlist.json`, the libchain agent's) takes the runtime-on lane's.

THE RULES.
  * Licence-held rows only (`licence == "held"`): a committed capture is the committed snapshot's to decide.
  * Per capture and lane, the NEWEST row carrying a verdict for that lane: the highest `scriptEngineVersion`, then the
    latest `gradedAtUTC` (a row graded later on an OLDER engine never overrides one graded on a newer).
  * ⭐⭐ STALENESS IS ASYMMETRIC (coordinator ruling 2026-11-19). CREATING an action needs current-engine evidence: a
    stale row never creates a withhold or a kill (`--write` refuses a NEW action whose evidence is below the current
    engine, `evidence_ledger.engine_version`, the one reader of SCRIPT_ENGINE_VERSION). LIFTING an action needs
    current-engine evidence too: an action SURVIVES an engine bump until a regrade at the new engine shows that element
    no longer differs. Dropping an action on a bump could silently bring back a wrong picture; keeping it only delays a
    correct one, and that delay is disclosed. So the derivation reads the newest row of each capture, whatever its
    engine, and only `--write` asks whether a NEW action is current.
  * `kind` (`first_diverging`, the ONE classifier, also `host_divergence.py`'s for committed captures):
      drawn         our side DRAWS something that differs (a plot, a paint, an object);
      withheld      every difference is an element our side withholds BY NAME: an honest gap, never acted on;
      unpositioned  a disclosed partial whose drawn records agree on every field the capture holds but whose place (x)
                    no capture witnessed (`objects:partial-unpositioned`): keeps a host listing, never lifts one.
Nothing returned or written carries source text: ids, hashes, verdicts, reasons and the items that differ.
"""
from __future__ import annotations

import argparse
import json
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import evidence_ledger as el  # noqa: E402 -- the ledger row, its lanes and the engine reader: one authority

REPO = HERE.parents[1]
LANES = el.LANES                                      # ("production", "runtime-on"), exactly
LEDGER = el.LEDGER
DOOR_FILE = REPO / "app" / "src" / "components" / "chart" / "engine" / "heldWithholds.json"
DOOR_SCHEMA = "uct.held-withholds/v1"
UNPOSITIONED = "objects:partial-unpositioned"         # compare.mjs OBJECTS_PARTIAL_UNPOSITIONED_GUARD
KINDS = ("drawn", "withheld", "unpositioned")
DOORS = ("host", "runtime")
SCOPES = ("output", "outputColour", "paint", "objectFamily")
#: the grader's v1 object-family names -> the engine's
_FAMILY = {"lines": "line", "labels": "label", "boxes": "box", "tables": "table", "tableCells": "table",
           "line": "line", "label": "label", "box": "box", "table": "table", "linefill": "linefill"}
_ITEM_MAX = 300


def current_engine() -> int:
    """SCRIPT_ENGINE_VERSION, by `evidence_ledger.engine_version` (refuses rather than guess)."""
    v = el.engine_version()
    if not isinstance(v, int):
        raise RuntimeError("SCRIPT_ENGINE_VERSION could not be read; no held evidence is current")
    return v


def first_diverging(r: dict) -> tuple:
    """(kind, sentence) of the first item a harness verdict `r` grades DIVERGE, for a DIVERGE verdict: `drawn` when our
    side drew something that differs, `withheld` when every diverging item is a drawing our side withholds by name
    (TradingView holds objects, ours carries none). For a non-DIVERGE verdict graded `objects:partial-unpositioned`:
    (`unpositioned`, its sentence). Otherwise (None, None)."""
    if r.get("verdict") != "DIVERGE":
        o1 = r.get("objects") or {}
        if UNPOSITIONED in str(o1.get("withheld") or "").split(","):
            return "unpositioned", ("a disclosed partial whose drawn objects agree with TradingView's on every field "
                                    "this capture holds, but where they sit on the chart (x) is not in this capture")
        return None, None
    for p in r.get("plots") or []:
        if p.get("verdict") == "DIVERGE":
            return "drawn", f"plot `{p.get('title')}`: {p.get('reason')}"
    o2 = r.get("objectsV2") or {}
    o1 = r.get("objects") or {}
    if o2.get("verdict") == "DIVERGE" or o1.get("verdict") == "DIVERGE":
        first = o2.get("first") or {}
        if o2.get("pairedNothing") is True or (not first and "withheld by name" in str(o1.get("reason"))):
            return "withheld", str(o1.get("reason") or o2.get("reason") or "").split(" — ")[0]
        if first:
            return "drawn", (f"{first.get('family')} {first.get('field')} of {first.get('where')}: "
                             f"TradingView {json.dumps(first.get('vendor'))}, ours {json.dumps(first.get('ours'))}")
        return "drawn", str(o1.get("reason") or o2.get("reason"))
    for k, v in r.items():
        if isinstance(v, dict) and v.get("verdict") == "DIVERGE":
            return "drawn", f"{k}: {v.get('reason')}"
    return "drawn", str(r.get("reason"))


def _colour_only(stats: dict) -> bool:
    """A plot whose VALUES agree on every compared bar and whose colour does not: its colour is the wrong element."""
    st = stats or {}
    return (st.get("colorMismatches") or 0) > 0 and not any(
        (st.get(k) or 0) for k in ("valueMismatches", "naMismatches", "vendorRowsMissing"))


def lane_withholds(r: dict) -> list:
    """The NARROWEST withholds a harness verdict `r` asks for: one per element that differs, scoped to exactly it, named
    for the door that drew it (`r["ourDoor"]`). [] for anything but a DRAWN DIVERGE, and [] when any diverging item
    cannot be isolated (a plot with no title, a paint count that differs, an object difference no family names, any
    other item): then the whole script is the narrowest thing that can be held (`held_kills`)."""
    if r.get("verdict") != "DIVERGE" or first_diverging(r)[0] != "drawn":
        return []
    door = r.get("ourDoor")
    if door not in DOORS:
        return []
    out = []
    for p in r.get("plots") or []:
        if p.get("verdict") != "DIVERGE":
            continue
        title = p.get("title")
        if not isinstance(title, str) or not title:
            return []
        scope = "outputColour" if _colour_only(p.get("stats")) else "output"
        out.append({"scope": scope, "title": title, "door": door,
                    "item": f"plot `{title}`: {p.get('reason')}"[:_ITEM_MAX]})
    pg = r.get("paints") or {}
    if pg.get("verdict") == "DIVERGE":
        if pg.get("unpaired"):
            return []
        for row in pg.get("rows") or []:
            if row.get("differs") is not True:
                continue
            if row.get("kind") not in ("bgcolor", "barcolor") or not isinstance(row.get("line"), int):
                return []
            out.append({"scope": "paint", "kind": row["kind"], "line": row["line"], "title": row.get("title"), "door": door,
                        "item": f"{row['kind']} (line {row['line']}){' `' + row['title'] + '`' if row.get('title') else ''}: "
                                f"{row.get('state')}"[:_ITEM_MAX]})
    o1 = r.get("objects") or {}
    o2 = r.get("objectsV2") or {}
    if o1.get("verdict") == "DIVERGE" or o2.get("verdict") == "DIVERGE":
        fams = set()
        for c in o1.get("counts") or []:
            if isinstance(c, dict) and c.get("agree") is False:
                fams.add(_FAMILY.get(c.get("family")))
        for t in o1.get("texts") or []:
            if isinstance(t, dict) and t.get("agree") is False:
                # the grader names a text row `<family> text` (`labels text`, `tableCells text`)
                fams.add(_FAMILY.get(str(t.get("family") or "").split(" ")[0]))
        f2 = (o2.get("first") or {}).get("family") if o2.get("verdict") == "DIVERGE" else None
        if f2:
            fams.add(_FAMILY.get(f2))
        if None in fams or not fams:
            return []
        for f in sorted(fams):
            out.append({"scope": "objectFamily", "family": f, "door": door,
                        "item": f"{f} family: {str(o2.get('reason') or o1.get('reason') or '')}"[:_ITEM_MAX]})
    for k, v in r.items():
        if k in ("plots", "paints", "objects", "objectsV2"):
            continue
        if isinstance(v, dict) and v.get("verdict") == "DIVERGE":
            return []
    return out


def lane_first(r: dict, max_len: int = None):
    """The `first` a ledger lane verdict carries (`evidence_ledger._lane_verdict`): {kind, item}, or None."""
    kind, item = first_diverging(r or {})
    if kind is None:
        return None
    return {"kind": kind, "item": str(item or "")[: (max_len or el.MAX_STRING)]}


def _rows(ledger) -> list:
    out = []
    p = pathlib.Path(ledger)
    if not p.exists():
        return out
    for ln in p.read_text(encoding="utf-8").splitlines():
        ln = ln.strip()
        if not ln:
            continue
        try:
            out.append(json.loads(ln))
        except ValueError:
            continue
    return out


def _kind_of(lv: dict) -> str:
    """A lane verdict's kind: its recorded `first.kind`; a row filed before `first` existed is `withheld` when its
    reason says so and otherwise `drawn` (a DIVERGE), `unpositioned` / None for the rest."""
    first = lv.get("first") if isinstance(lv.get("first"), dict) else None
    if first and first.get("kind") in KINDS:
        return first["kind"]
    if lv.get("verdict") == "DIVERGE":
        return "withheld" if "withheld by name" in str(lv.get("reason")) else "drawn"
    return None


def held_rows(lane: str, ledger=LEDGER, engine_floor: int | None = None) -> dict:
    """{sourceSha256: [row]} — per licence-held capture, its NEWEST ledger row with a verdict for `lane` (highest engine,
    then latest grade), whatever its engine (an action survives a bump until a newer regrade lifts it). `engine_floor`,
    when given, keeps only rows graded at that engine or later (a view of what is current, never the derivation).
    Each row: {captureId, scriptKey, symbol, timeframe, verdict, reason, kind, item, door, withholds, engine,
    graderVersion, gradedAtUTC}."""
    if lane not in LANES:
        raise ValueError(f"lane {lane!r} is not one of {list(LANES)}")
    floor = None if engine_floor is None else int(engine_floor)
    latest = {}
    for r in _rows(ledger):
        if r.get("licence") != "held" or not isinstance(r.get("verdicts"), dict):
            continue
        lv = r["verdicts"].get(lane)
        if not isinstance(lv, dict) or lv.get("verdict") is None:
            continue
        eng0 = r.get("scriptEngineVersion")
        key = (eng0 if isinstance(eng0, int) else -1, str(r.get("gradedAtUTC") or ""))
        cid = r.get("captureId")
        if cid not in latest or key >= latest[cid][0]:
            latest[cid] = (key, r, lv)
    out: dict = {}
    for cid, (_k, r, lv) in sorted(latest.items()):
        eng = r.get("scriptEngineVersion")
        if not isinstance(eng, int) or (floor is not None and eng < floor):
            continue
        first = lv.get("first") if isinstance(lv.get("first"), dict) else {}
        out.setdefault(r.get("sourceSha256"), []).append({
            "captureId": cid, "scriptKey": r.get("scriptKey"), "symbol": r.get("symbol"), "timeframe": r.get("timeframe"),
            "verdict": lv.get("verdict"), "reason": lv.get("reason"), "kind": _kind_of(lv), "item": first.get("item"),
            "door": lv.get("door"), "withholds": [w for w in (lv.get("withholds") or []) if isinstance(w, dict)],
            # ⛔ a row filed before the held-evidence grader (no `first`) never ACTS: it was never acted on when it was
            # current, so acting on it now would be a stale row creating an action
            "acts": isinstance(lv.get("first"), dict),
            "engine": eng, "graderVersion": r.get("graderVersion"), "gradedAtUTC": r.get("gradedAtUTC"),
        })
    return out


def held_kills(lane: str, ledger=LEDGER, engine_floor: int | None = None) -> dict:
    """{sourceSha256: {scriptKey, sourceSha256, lane, evidence: [row]}} — every script whose NEWEST held row of some
    capture on `lane` grades DIVERGE with a DRAWN difference NO narrow withhold isolates (each row names its engine; a
    kill survives a bump until a newer regrade lifts it, and a NEW kill needs a current-engine row: the kill list's own
    rail asks `held_kills(lane, engine_floor=current_engine())` before it accepts one). Never a `withheld` or an
    `unpositioned` row, and never a row whose differences each have their own withhold (`held_withholds`)."""
    out = {}
    for sha, rows in held_rows(lane, ledger, engine_floor).items():
        drawn = [x for x in rows if x["verdict"] == "DIVERGE" and x["kind"] == "drawn" and x["acts"] and not x["withholds"]]
        if drawn:
            out[sha] = {"scriptKey": drawn[0]["scriptKey"], "sourceSha256": sha, "lane": lane, "evidence": drawn}
    return out


def _target(w: dict) -> tuple:
    if w.get("scope") == "paint":
        return (w.get("door"), "paint", w.get("kind"), w.get("line"))
    if w.get("scope") == "objectFamily":
        return (w.get("door"), "objectFamily", w.get("family"))
    return (w.get("door"), w.get("scope"), w.get("title"))


def held_withholds(lane: str, ledger=LEDGER, engine_floor: int | None = None) -> dict:
    """{sourceSha256: [withhold]} — the narrow withholds the NEWEST held row of each capture on `lane` asks for, one
    per target, each with the captures that ask for it and the newest engine they were graded on. A withhold is
    {door, scope, title | kind+line | family, why, evidence, engine}."""
    out = {}
    for sha, rows in held_rows(lane, ledger, engine_floor).items():
        by = {}
        for x in rows:
            if x["verdict"] != "DIVERGE" or x["kind"] != "drawn":
                continue
            for w in x["withholds"]:
                if w.get("scope") not in SCOPES or w.get("door") not in DOORS:
                    continue
                e = by.setdefault(_target(w), {**{k: w[k] for k in ("door", "scope", "title", "kind", "line", "family")
                                                   if w.get(k) is not None},
                                               "why": w.get("item"), "evidence": [], "engine": x["engine"]})
                e["evidence"].append(x["captureId"])
                e["engine"] = max(e["engine"], x["engine"])
        if by:
            out[sha] = [by[k] for k in sorted(by, key=lambda t: tuple(str(v) for v in t))]
    return out


def door_document(ledger=LEDGER) -> dict:
    """The member door's file: every licence-held script's narrow withholds, both lanes, by source hash. A function of
    the ledger ALONE (CI derives it from committed bytes); each withhold names the newest engine it was graded on."""
    per = {}
    keys = {}
    for lane in LANES:
        for sha, rows in held_rows(lane, ledger).items():
            keys.setdefault(sha, rows[0]["scriptKey"])
        for sha, ws in held_withholds(lane, ledger).items():
            bucket = per.setdefault(sha, {})
            for w in ws:
                e = bucket.setdefault(_target(w), {**{k: v for k, v in w.items() if k not in ("evidence", "engine")},
                                                   "lanes": [], "evidence": [], "engine": w["engine"]})
                e["lanes"] = sorted(set(e["lanes"]) | {lane})
                e["evidence"] = sorted(set(e["evidence"]) | set(w["evidence"]))
                e["engine"] = max(e["engine"], w["engine"])
    scripts = [{"sha256": sha, "scriptKey": keys.get(sha),
                "withholds": [per[sha][k] for k in sorted(per[sha], key=lambda t: tuple(str(v) for v in t))]}
               for sha in sorted(per)]
    return {
        "schema": DOOR_SCHEMA,
        "about": ("DERIVED by tools/vendor_harness/held_evidence.py --write from the committed evidence ledger: the narrow "
                  "withholds licence-held captures ask for, by source hash (never hand-typed; --check is the rail)."),
        "scripts": scripts,
    }


def _dump(doc: dict) -> str:
    return json.dumps(doc, indent=1, ensure_ascii=False, sort_keys=False) + "\n"


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--write", action="store_true", help="re-derive the member door's file from the ledger")
    g.add_argument("--check", action="store_true", help="exit 1 when the committed door file is not the ledger's derivation")
    ap.add_argument("--ledger", default=str(LEDGER))
    ap.add_argument("--out", default=str(DOOR_FILE))
    a = ap.parse_args(argv)
    want = _dump(door_document(a.ledger))
    out = pathlib.Path(a.out)
    if a.write:
        # ⛔ A STALE ROW NEVER CREATES: every withhold the committed file does not hold yet needs evidence graded on
        # the CURRENT engine (one it holds survives a bump; that is the derivation's own rule)
        old = json.loads(out.read_text(encoding="utf-8")) if out.exists() else {"scripts": []}
        had = {(s.get("sha256"), _target(w)) for s in old.get("scripts") or [] for w in s.get("withholds") or []}
        cur = current_engine()
        stale = [(s["sha256"][:12], _target(w), w["engine"]) for s in json.loads(want)["scripts"] for w in s["withholds"]
                 if (s["sha256"], _target(w)) not in had and w["engine"] < cur]
        if stale:
            print(f"[held-evidence] REFUSED: {len(stale)} new withhold(s) rest on rows graded below the current engine "
                  f"{cur} (a stale row never creates an action): {stale[:3]}. Re-grade them at engine {cur} first "
                  "(`evidence_engine.py regrade`).")
            return 2
        out.write_text(want, encoding="utf-8", newline="\n")
        print(f"[held-evidence] wrote {out} ({len(json.loads(want)['scripts'])} scripts)")
        return 0
    have = out.read_text(encoding="utf-8").replace("\r\n", "\n") if out.exists() else None
    if have != want:
        print(f"[held-evidence] {out} is NOT the ledger's derivation: run `python tools/vendor_harness/held_evidence.py "
              "--write` (after `evidence_engine.py regrade` at the current engine) and commit it")
        return 1
    print(f"[held-evidence] {out} is the ledger's derivation")
    return 0


if __name__ == "__main__":
    sys.exit(main())
