"""gen_fixtures — `spot` and `family` items from the real-bar detector
fixtures under tests/fixtures/uct_* (spec §6.3 gen_fixtures; §13.3 C15:
fixtures are SEED ONLY, and only UNMODIFIED positive / negative files are
eligible — edge files are reviewer-only).

The label is `expected.fires`. The reveal names the detector and quotes the
fixture's own note verbatim. These are the ONE kind of item that embeds its
bars (`bars_embed`), because the fixture is the record: the bars were frozen
with the label and must never be re-read from bars.db.

Famous charts are allowed (owner decision); the ticker never rides the
prompt and the reveal shows it.
"""
from __future__ import annotations

import glob
import os
import pathlib
import re
import sys
from datetime import datetime, timezone

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

from scripts.study._common import FAMILIES, REPO, load_json, make_item, shuffled_choices, write_segment  # noqa: E402

FIXTURES = REPO / "tests" / "fixtures"
SKILL_MAP = REPO / "docs" / "study" / "skill_map.json"

#: Detector id → (display name, skill_id, family). Capitulation is a climax
#: signal, not a catalog setup: it drills the climax-volume skill and gets
#: no family item.
DETECTORS = {
    "uct_kicker": ("Kicker Candle", "setup.family3.kicker", "Gaps & Catalysts"),
    "uct_hve": ("High Volume Edge", "setup.family3.hve", "Gaps & Catalysts"),
    "uct_gap_support": ("Gap Support", "setup.family3.gap_support", "Gaps & Catalysts"),
    "uct_go_signal": ("Go Signal", "setup.intraday.go_signal", "Intraday"),
    "uct_launch_pad": ("Launchpad", "setup.family1.launchpad", "Bases & Breakouts"),
    "uct_oops_reversal": ("Oops Reversal", "setup.family4.oops", "Reversals & Reclaims"),
    "uct_slingshot": ("Slingshot", "setup.family4.slingshot", "Reversals & Reclaims"),
    "uct_capitulation": ("Capitulation", "scan.volume_climax", None),
}
#: A note that says the bars were touched disqualifies the fixture (C15).
MODIFIED_RE = re.compile(
    r"\b(moved|edited|scaled|set to|shifted|replaced|multiplied|nudged|forced|altered|changed|lowered|"
    r"raised|trimmed|synthetic|fabricated|rewritten|rescaled|spliced|injected|planted|doubled|halved)\b",
    re.I)
NAME_RE = re.compile(r"_([A-Z]{1,5})_(\d{8})\.json$")


def ymd_from_epoch(t) -> int:
    t = int(t)
    if t > 10_000_000_000:
        t //= 1000
    if 19000101 <= t <= 21001231:
        return t
    return int(datetime.fromtimestamp(t, tz=timezone.utc).strftime("%Y%m%d"))


def eligible_fixtures() -> list[dict]:
    """Unmodified positive / negative fixtures, oldest path order."""
    out = []
    for path in sorted(glob.glob(str(FIXTURES / "uct_*" / "*.json"))):
        d = load_json(pathlib.Path(path))
        cat = d.get("category")
        if cat not in ("positive", "negative"):
            continue
        note = str(d.get("note") or "")
        if MODIFIED_RE.search(note):
            continue
        m = NAME_RE.search(os.path.basename(path))
        if not m or not d.get("bars"):
            continue
        detector = os.path.basename(os.path.dirname(path))
        if detector not in DETECTORS:
            continue
        fires = bool((d.get("expected") or {}).get("fires"))
        out.append({"path": os.path.relpath(path, REPO).replace("\\", "/"), "detector": detector,
                    "name": d.get("name"), "category": cat, "note": note, "fires": fires,
                    "sym": m.group(1), "date": m.group(2), "bars": d["bars"]})
    return out


def to_bars(raw: list) -> list[dict]:
    out = []
    for b in raw:
        v = float(b.get("v") or 0)
        out.append({"t": ymd_from_epoch(b["t"]), "o": float(b["o"]), "h": float(b["h"]),
                    "l": float(b["l"]), "c": float(b["c"]), "v": int(v) if v.is_integer() else v})
    return out


def items_for(fx: dict) -> list[dict]:
    name, skill, family = DETECTORS[fx["detector"]]
    bars = to_bars(fx["bars"])
    asof = f"{fx['date'][:4]}-{fx['date'][4:6]}-{fx['date'][6:]}"
    ref = fx["path"]
    embed = {"sym": fx["sym"], "tf": "D", "asof": asof, "bars": bars}
    reveal = {"detector": fx["detector"], "setup": name, "fixture": fx["name"], "fires": fx["fires"],
              "category": fx["category"], "quote": fx["note"], "source": ref,
              "window_bars": len(bars), "note_on_supply": "fixture: seed only (C15)"}
    out = [make_item(
        type="spot", skill_id=skill, q=f"Does the firm's {name} setup fire on the last bar of this chart?",
        answer="yes" if fx["fires"] else "no", choices=["Yes", "No"],
        prompt_extra={"chart": {"window_bars": len(bars), "tf": "D"}},
        reveal=reveal, source_kind="fixture", source_ref=ref, difficulty=3,
        sym=fx["sym"], asof=asof, adjustment_basis="split-adjusted", bars_embed=embed)]
    if fx["fires"] and family:
        d = [f for f in FAMILIES if f != family]
        out.append(make_item(
            type="family", skill_id="setup.placement", q="Which family does this setup belong to?",
            answer=family, choices=shuffled_choices(family, d, ref + "#family"),
            prompt_extra={"chart": {"window_bars": len(bars), "tf": "D"}},
            reveal=dict(reveal, family=family), source_kind="fixture", source_ref=ref + "#family",
            difficulty=2, sym=fx["sym"], asof=asof, adjustment_basis="split-adjusted", bars_embed=embed))
    return out


def generate() -> dict[str, list[dict]]:
    spot: list[dict] = []
    family: list[dict] = []
    for fx in eligible_fixtures():
        for it in items_for(fx):
            (spot if it["type"] == "spot" else family).append(it)
    return {"spot.fixtures": spot, "family.fixtures": family}


def main() -> int:
    for name, items in generate().items():
        path = write_segment(name, items)
        print(f"{name}: {len(items)} items -> {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
