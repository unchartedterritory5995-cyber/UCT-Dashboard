"""FT-053: the computed key levels for one ticker, as files other platforms import.

  pine         A TradingView Pine Script v5 indicator: one `hline` per level, labelled with our
               vocabulary's words. Paste into the Pine Editor and add to the chart.
  thinkscript  A ThinkorSwim thinkScript study: one `plot` per level, with a bubble label.
  csv          `price,label` rows (plus the ticker, the level id and when it was computed) for any
               platform that imports a level list.

The numbers are the SAME answer `positioning.levels` serves the positioning panel (one cached
build), so a file can never disagree with the screen it was downloaded from. Licensing for
exporting computed levels is cleared by D-011.

⛔ STRIKE LEVELS ONLY. The implied moves are a distance, not a price, so they are written as the
   two prices spot +/- the move (labelled as such), never as a bare number on the price axis.
⛔ A LEVEL WITH NO VALUE IS LEFT OUT AND NAMED in a comment line, never written as 0.
⛔ Labels are our vocabulary's words (`positioning_vocab.label_of`); a label is sanitised to
   letters, digits, spaces and a few marks before it is put inside a script string.
"""
from __future__ import annotations

import csv
import io
import re
from typing import Optional

FORMATS = {
    "pine": ("text/plain; charset=utf-8", "pine", "TradingView Pine Script (paste into the Pine Editor)"),
    "thinkscript": ("text/plain; charset=utf-8", "ts", "ThinkorSwim thinkScript study (Studies > Create)"),
    "csv": ("text/csv; charset=utf-8", "csv", "CSV of price,label"),
}
_COLORS = {"call_wall": "red", "put_wall": "green", "zero_gamma": "orange",
           "absolute_gamma_strike": "purple", "key_delta_strike": "blue", "max_pain": "gray",
           "implied_move_1d": "teal", "implied_move_5d": "teal"}
_TOS_COLORS = {"red": "RED", "green": "GREEN", "orange": "ORANGE", "purple": "MAGENTA",
               "blue": "CYAN", "gray": "GRAY", "teal": "YELLOW"}


def _clean(text: str) -> str:
    return re.sub(r"[^A-Za-z0-9 .:+/()%-]", "", str(text or ""))[:60]


def rows_of(levels: dict) -> tuple:
    """([{id, label, price}], [skipped labels]) from a `positioning.levels` answer."""
    spot = levels.get("spot")
    out, skipped = [], []
    for lv in levels.get("levels") or []:
        v = lv.get("value")
        if v is None:
            skipped.append(lv.get("label") or lv.get("id"))
            continue
        if lv.get("unit") == "$ move":
            if not spot:
                skipped.append(lv.get("label"))
                continue
            out.append({"id": lv["id"], "label": f"{lv['label']} up", "price": round(spot + v, 2)})
            out.append({"id": lv["id"], "label": f"{lv['label']} down", "price": round(spot - v, 2)})
        else:
            out.append({"id": lv["id"], "label": lv["label"], "price": round(float(v), 2)})
    return out, skipped


def _header(sym: str, levels: dict, skipped: list, mark: str) -> list:
    lines = [f"{mark} UCT key levels for {sym}, computed {levels.get('computed_at') or 'now'} "
             f"from the {levels.get('dte') or 'month'} options window (spot {levels.get('spot')})."]
    if skipped:
        lines.append(f"{mark} Not computable today, left out: {', '.join(_clean(s) for s in skipped)}.")
    return lines


def render(fmt: str, sym: str, levels: dict) -> str:
    if fmt not in FORMATS:
        raise ValueError(f"format must be one of {', '.join(FORMATS)}")
    rows, skipped = rows_of(levels)
    if fmt == "csv":
        buf = io.StringIO()
        w = csv.writer(buf, lineterminator="\n")
        w.writerow(["price", "label", "ticker", "level_id", "computed_at"])
        for r in rows:
            w.writerow([f"{r['price']:.2f}", r["label"], sym, r["id"], levels.get("computed_at") or ""])
        return buf.getvalue()
    if fmt == "pine":
        lines = ["//@version=5", *_header(sym, levels, skipped, "//"),
                 f'indicator("UCT levels {_clean(sym)}", overlay=true)']
        for r in rows:
            lines.append(f'hline({r["price"]:.2f}, "{_clean(r["label"])}", '
                         f'color=color.{_COLORS.get(r["id"], "gray")}, linestyle=hline.style_dashed)')
        return "\n".join(lines) + "\n"
    lines = [*_header(sym, levels, skipped, "#")]
    for i, r in enumerate(rows):
        name = f"L{i + 1}_{re.sub(r'[^A-Za-z0-9]', '', r['label'])[:24]}"
        color = _TOS_COLORS.get(_COLORS.get(r["id"], "gray"), "GRAY")
        lines += [f"plot {name} = {r['price']:.2f};",
                  f"{name}.SetDefaultColor(Color.{color});",
                  f"{name}.SetStyle(Curve.SHORT_DASH);",
                  f'AddChartBubble(IsNaN(close[-1]) and !IsNaN(close), {r["price"]:.2f}, '
                  f'"{_clean(r["label"])}", Color.{color});']
    return "\n".join(lines) + "\n"


def filename(fmt: str, sym: str, levels: dict) -> str:
    day = (levels.get("computed_at") or "")[:10] or "today"
    return f"uct-levels-{sym}-{day}.{FORMATS[fmt][1]}"


def manifest(sym: str, levels: Optional[dict] = None) -> dict:
    return {"symbol": sym, "formats": [{"id": k, "label": v[2], "extension": v[1]} for k, v in FORMATS.items()],
            "label": "computed", "levels_counted": len(rows_of(levels)[0]) if levels else None,
            "note": ("The levels are the positioning panel's own, rebuilt at most once a minute. "
                     "Import the file into TradingView (Pine Editor) or ThinkorSwim (Studies > "
                     "Create); the CSV is price,label for anything else.")}
