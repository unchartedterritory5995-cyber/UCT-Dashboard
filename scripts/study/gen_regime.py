"""gen_regime — call-the-regime items (spec §6.3 gen_regime; §13.1 B2):

  bottoms   app/src/pages/modelbook/bottomsCatalog.js (9 real major-market
            bottoms with dated signposts): "which signpost fired on this
            date", "which fired first", and the recorded drawdown. Keyed on
            the RECORDED signposts, never on a tier word (B2 e: pre-2026
            dates get no tier).
  wire      wire_archive.market_calls(): one item per archived day that
            carries a recorded exposure word (B2 a), eligible 60 days after
            the date so the outcome is known (§6.2b), carrying tier_scale_id.

Chart items record a `bars` spec (SPY, daily, the item's date) for the
importer to resolve; no bars are embedded. The question never shows the
date of a wire call (hindsight); the reveal does.
"""
from __future__ import annotations

import pathlib
import re
import sys
from datetime import date, timedelta

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

from scripts.study._common import REPO, WIRE_WORDS, make_item, rotate_pick, shuffled_choices, write_segment  # noqa: E402

BOTTOMS = REPO / "app" / "src" / "pages" / "modelbook" / "bottomsCatalog.js"
SOURCE_BOTTOMS = "app/src/pages/modelbook/bottomsCatalog.js#BOTTOMS"
SPY_FIRST_DAY = date(1993, 2, 1)
WIRE_ELIGIBLE_AFTER_DAYS = 60
CHART_WINDOW = 120
CHART_FORWARD = 20
ORDINALS = ("first", "second", "third", "fourth", "fifth", "sixth")


def _str(block: str, key: str):
    m = re.search(rf"\b{key}:\s*'((?:[^'\\]|\\.)*)'", block)
    return m.group(1).replace("\\'", "'") if m else None


def _num(block: str, key: str):
    m = re.search(rf"\b{key}:\s*(-?\d+(?:\.\d+)?)", block)
    return float(m.group(1)) if m else None


def read_signposts(js: str | None = None) -> dict:
    """key → name from BOTTOM_SIGNPOSTS."""
    if js is None:
        js = BOTTOMS.read_text(encoding="utf-8")
    m = re.search(r"export const BOTTOM_SIGNPOSTS = \[(.*?)\n\];?", js, re.S)
    out = {}
    for blk in re.findall(r"\{(.*?)\n  \}", m.group(1), re.S):
        k, n = _str(blk, "key"), _str(blk, "name")
        if k and n:
            out[k] = n
    return out


def read_bottoms(js: str | None = None) -> list[dict]:
    if js is None:
        js = BOTTOMS.read_text(encoding="utf-8")
    m = re.search(r"export const BOTTOMS = \[(.*)\n\];?", js, re.S)
    body = m.group(1)
    out = []
    for blk in re.split(r"\n  \},?\n  \{", body):
        bid = _str(blk, "id")
        if not bid:
            continue
        sp = []
        sm = re.search(r"signposts:\s*\[(.*?)\]", blk, re.S)
        if sm:
            for s in re.findall(r"\{(.*?)\}", sm.group(1), re.S):
                sp.append({"key": _str(s, "key"), "date": _str(s, "date"), "note": _str(s, "note")})
        out.append({"id": bid, "name": _str(blk, "name"), "index": _str(blk, "index"),
                    "chartSym": _str(blk, "chartSym"), "peakDate": _str(blk, "peakDate"),
                    "lowDate": _str(blk, "lowDate"), "drawdownPct": _num(blk, "drawdownPct"),
                    "type": _str(blk, "type"), "signposts": [s for s in sp if s["key"] and s["date"]]})
    return out


def _bars_spec(ymd: str) -> dict | None:
    d = date.fromisoformat(ymd)
    if d < SPY_FIRST_DAY:
        return None
    return {"sym": "SPY", "tf": "D", "asof": ymd, "window": CHART_WINDOW, "forward": CHART_FORWARD}


def bottom_items(bottoms: list[dict], names: dict) -> list[dict]:
    out = []
    all_names = list(names.values())
    dds = sorted({f"{b['drawdownPct']:g}%" for b in bottoms if b.get("drawdownPct") is not None})
    for b in bottoms:
        ref = f"{SOURCE_BOTTOMS}#{b['id']}"
        base_reveal = {"bottom": b["name"], "index": b["index"], "peak_date": b["peakDate"],
                       "low_date": b["lowDate"], "drawdown_pct": b["drawdownPct"], "type": b["type"],
                       "signposts": [{"key": s["key"], "name": names.get(s["key"]), "date": s["date"],
                                      "quote": s["note"]} for s in b["signposts"]],
                       "source": ref}
        # the signpost SEQUENCE, keyed on the recorded order (B2 e): the
        # question names the ordinal, never the date (no cutoff stated); the
        # chart, when SPY has bars for it, is cut at that signpost's date.
        # Two signposts recorded on the SAME date are a tie: one item, the
        # first-listed as the key and the other accepted (a member who names
        # either is right). Ordinals count distinct dates.
        by_date: dict = {}
        for s in b["signposts"]:
            by_date.setdefault(s["date"], []).append(s)
        for idx, (day, group) in enumerate(sorted(by_date.items())):
            group = [g for g in group if names.get(g["key"])]
            if not group or idx >= len(ORDINALS):
                continue
            s = group[0]
            nm = names.get(s["key"])
            co_fired = [names[g["key"]] for g in group[1:]]
            d = rotate_pick([n for n in all_names if n not in co_fired], 3, ref + day + s["key"], exclude=nm)
            spec = _bars_spec(day)
            extra = {"sym": "SPY", "asof": day, "adjustment_basis": "split-adjusted"}
            if spec:
                extra["bars"] = spec
            out.append(make_item(
                type="regime", skill_id="regime.call", module="M3",
                q=f"{b['name']}: which signpost fired {ORDINALS[idx]}?", answer=nm, accept=co_fired or None,
                choices=shuffled_choices(nm, d, ref + day),
                prompt_extra=dict({"subject": f"{b['id']} signpost {idx + 1}"},
                                  **({"chart": {"window_bars": CHART_WINDOW, "tf": "D"}} if spec else {})),
                reveal=dict(base_reveal, quote=s["note"], signpost=nm, date=day, ordinal=idx + 1,
                            co_fired=[{"name": names[g["key"]], "quote": g["note"]} for g in group[1:]]),
                source_kind="bottoms", source_ref=ref + "#" + s["key"] + "#" + day, difficulty=3, **extra))
        if b.get("drawdownPct") is not None:
            key = f"{b['drawdownPct']:g}%"
            d = rotate_pick(dds, 3, ref + "dd", exclude=key)
            out.append(make_item(
                type="recall", skill_id="regime.call", module="M3",
                q=f"{b['name']}: how far did the {b['index']} fall from the {b['peakDate']} peak to the {b['lowDate']} low?",
                answer=key, choices=shuffled_choices(key, d, ref + "dd"), prompt_extra={"subject": f"{b['id']} drawdown"},
                reveal=base_reveal, source_kind="bottoms", source_ref=ref + "#drawdown", difficulty=2))
    return out


def wire_items(calls: list[dict] | None = None, *, today: date | None = None) -> list[dict]:
    if calls is None:
        from api.services import wire_archive
        calls = wire_archive.market_calls()
    today = today or date.today()
    out = []
    for c in calls:
        tier = c.get("exposure_tier")
        if not tier or tier not in WIRE_WORDS:
            continue
        d = date.fromisoformat(c["date"])
        if d > today - timedelta(days=WIRE_ELIGIBLE_AFTER_DAYS):
            continue
        ref = f"wire_archive:{c['date']}"
        out.append(make_item(
            type="regime", skill_id="regime.dial", module="M1",
            q="The Wire's call for this day: which exposure word did the firm use?",
            answer=tier, choices=list(WIRE_WORDS), prompt_extra={"chart": {"window_bars": CHART_WINDOW, "tf": "D"}},
            reveal={"date": c["date"], "exposure_tier": tier, "exposure_score": c.get("exposure_score"),
                    "tier_scale_id": c.get("tier_scale_id"), "source": ref},
            source_kind="wire", source_ref=ref, difficulty=3, sym="SPY", asof=c["date"],
            adjustment_basis="split-adjusted", tier_scale_id=c.get("tier_scale_id"),
            bars=_bars_spec(c["date"])))
    return out


def generate() -> dict[str, list[dict]]:
    js = BOTTOMS.read_text(encoding="utf-8")
    out = {"regime.bottoms": bottom_items(read_bottoms(js), read_signposts(js))}
    try:
        out["regime.wire"] = wire_items()
    except Exception as e:  # noqa: BLE001 -- no archive on this box is a count of 0, not a crash
        print(f"regime.wire: archive unreadable ({e}); 0 items")
        out["regime.wire"] = []
    return out


def main() -> int:
    for name, items in generate().items():
        path = write_segment(name, items)
        print(f"{name}: {len(items)} items -> {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
