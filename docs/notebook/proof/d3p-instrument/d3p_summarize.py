"""Lane D3P: read a committed l3_layout_measure.py run.json and print the before/after table.

Reads ONLY the record-only probes (`editor_probe`, `editor_probe_open`, `more_probe`) and the
judge's own at-rest occluder readings (`reading.controls[].rest`), so it is a VIEW over the raw
file -- R-RAW: the run.json is committed before this is run on it.

    python d3p_summarize.py <run.json> [--markdown]
"""
import json
import sys
from pathlib import Path


def label_parts(label: str) -> dict:
    """`orb@844+hintseen+coachpending` -> pass, height, hint state, coach state."""
    base, _, rest = label.partition("@")
    height, *flags = rest.split("+") if rest else ("", )
    return {"pass": base, "h": height, "hint": "seen" if "hintseen" in flags else "shown",
            "coach": "pending" if "coachpending" in flags else "seen"}


def summarize(run: dict) -> list[dict]:
    out = []
    for r in run.get("rows", []):
        if r.get("width") != 390:
            continue
        p = label_parts(r["pass"])
        if r.get("surface") == "editor":
            ep = r.get("editor_probe") or {}
            op = r.get("editor_probe_open") or {}
            row = ep.get("row") or {}
            covered = [f'{c["name"]} <- {c["by"]}' for c in ep.get("controls", []) if c.get("covered")]
            # the judge's own at-rest reading of every control the editor probe calls a toolbar control
            tb = {c["name"] for c in ep.get("controls", [])}
            judge = [f'{c["name"]} <- {(c.get("rest") or {}).get("occ", {}).get("cls")}'
                     for c in (r.get("reading") or {}).get("controls", [])
                     if (c.get("rest") or {}).get("occluded") and c.get("name") in tb]
            out.append({**p, "surface": "editor", "error": r.get("error"),
                        "rows": row.get("rows"), "title_y": (ep.get("title") or {}).get("box", [None, None])[1],
                        "title_on_screen": (ep.get("title") or {}).get("fullyAboveFold"),
                        "body_y": (ep.get("body") or {}).get("line", [None, None])[1],
                        "body_on_screen": (ep.get("body") or {}).get("fullyAboveFold"),
                        "hint": (ep.get("hint") or {}).get("shown"), "coach_card": (ep.get("coach") or {}).get("shown"),
                        "coach_h": ((ep.get("coach") or {}).get("box") or [None, None, None, None])[3],
                        "toolbar_covered": covered, "judge_toolbar_occluded": judge,
                        "open_rows": (op.get("row") or {}).get("rows"), "open_focus": op.get("focus")})
        elif r.get("surface") == "more-menu-open":
            mp = r.get("more_probe") or {}
            items = mp.get("items", [])
            out.append({**p, "surface": "more-menu-open", "error": r.get("error"),
                        "panel": mp.get("box"), "position": mp.get("position"),
                        "items": len(items),
                        "covered": [f'{i["name"]} <- {i["by"]}' for i in items if i.get("covered")],
                        "below_fold": [i["name"] for i in items if i.get("belowFold")]})
    return out


def markdown(rows: list[dict]) -> str:
    ed = [r for r in rows if r["surface"] == "editor"]
    mo = [r for r in rows if r["surface"] == "more-menu-open"]
    lines = ["| pass | h | coach | hint | rows | title y | title on screen | body y | body on screen | toolbar controls covered at rest |",
             "|---|---|---|---|---|---|---|---|---|---|"]
    for r in ed:
        lines.append(f'| {r["pass"]} | {r["h"]} | {r["coach"]} | {r["hint"]} | {r["rows"]} | {r["title_y"]} | '
                     f'{r["title_on_screen"]} | {r["body_y"]} | {r["body_on_screen"]} | '
                     f'{"; ".join(r["toolbar_covered"]) or "none"} |' + (f' ERROR {r["error"]}' if r.get("error") else ""))
    lines += ["", "| pass | h | coach | hint | panel box | position | items | covered at rest | below the fold |",
              "|---|---|---|---|---|---|---|---|---|"]
    for r in mo:
        lines.append(f'| {r["pass"]} | {r["h"]} | {r["coach"]} | {r["hint"]} | {r["panel"]} | {r["position"]} | {r["items"]} | '
                     f'{"; ".join(r["covered"]) or "none"} | {", ".join(r["below_fold"]) or "none"} |'
                     + (f' ERROR {r["error"]}' if r.get("error") else ""))
    return "\n".join(lines)


if __name__ == "__main__":
    run = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    rows = summarize(run)
    print(markdown(rows) if "--markdown" in sys.argv else json.dumps(rows, indent=1, ensure_ascii=False))
