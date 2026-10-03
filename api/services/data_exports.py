"""Member data exports -- CSV and Excel for the screener, watchlists, the option
chain, the news list and chart bars (TERMINAL-NEXT FT-041 / FT-042 / FT-043).

THE THREE RULES THIS MODULE EXISTS TO KEEP.

1. ⛔ NO NEW REDISTRIBUTION. An export is the page the member is already
   allowed to see, as a file. Every builder below reads the SAME function the
   page's own route reads (`query.run_scan`, `watchlist_service.get_watchlist`,
   `polygon_options.get_chain`, `engine.get_news`, `bars.serve_bars`) and
   writes only the columns that route already serves to that member. No
   builder reaches a vendor the page does not, and none adds a field: the news
   export carries headline / source / time / link / tickers and never an
   article body, because the news list never shows one.

2. ⛔ METERED PER MEMBER. `EXPORT_DAILY_CAP` exports per member per ET day
   (default 25 -- the Market Chameleon number), durable in auth.db through
   `daily_counters` so a deploy does not reset it, plus a per-minute burst
   limit in the route. A refused export charges nothing; a failed build gives
   its charge back.

3. ⛔ DARK UNTIL ARMED. `DATA_EXPORTS_ENABLED` (default off, read per request).
   Off, every export route answers 404 and nothing is counted.

The Excel writer is a minimal hand-built SpreadsheetML package (one sheet,
inline strings, numeric cells as numbers) so no dependency is added. Every
string cell that a spreadsheet would read as a formula (`= + - @`, tab, CR) is
prefixed with an apostrophe in BOTH formats: a vendor headline is untrusted
text, and a CSV that runs `=HYPERLINK(...)` on open is a CSV injection.
"""
from __future__ import annotations

import csv
import io
import os
import re
import zipfile
from datetime import datetime, timezone
from typing import Any, Iterable, Sequence
from xml.sax.saxutils import escape

from api.services import daily_counters

FLAG = "DATA_EXPORTS_ENABLED"
CAP_ENV = "EXPORT_DAILY_CAP"
DEFAULT_DAILY_CAP = 25
SCOPE = "data_export"
#: The screener page itself pages to at most this many rows (`exportCsv.js`
#: `max=5000`), so the server export stops at the same ceiling.
SCREENER_MAX_ROWS = 5000
SCREENER_PAGE = 500
#: Bars: the chart route allows 60,000; an export file is bounded lower so one
#: request cannot hold a 60k-row workbook in memory on the web pod.
BARS_MAX = 20000
FORMATS = ("csv", "xlsx")

CAP_SENTENCE = ("You've reached today's export limit ({cap} files). "
                "It resets at midnight ET.")


def is_enabled() -> bool:
    return os.environ.get(FLAG, "0").strip() == "1"


def daily_cap() -> int:
    raw = os.environ.get(CAP_ENV)
    if raw is None:
        return DEFAULT_DAILY_CAP
    try:
        v = int(str(raw).strip())
    except (TypeError, ValueError):
        return DEFAULT_DAILY_CAP
    return v if v >= 0 else DEFAULT_DAILY_CAP


def _et_day() -> str:
    from api.services.journal_two.calendar import et_today
    return et_today()


# ── metering ────────────────────────────────────────────────────────────────

def take(user_id) -> bool:
    """Charge one export to the member for today (ET). False = over the cap,
    nothing counted. A counter store that cannot be read admits (fails open,
    `daily_counters`' own contract)."""
    charge = daily_counters.Charge(SCOPE, str(user_id), 1, daily_cap())
    return daily_counters.take(_et_day(), [charge]) is None


def give_back(user_id) -> None:
    """Return the charge of an export that failed to build."""
    daily_counters.give_back(_et_day(), [daily_counters.Charge(SCOPE, str(user_id), 1, None)])


def quota(user_id) -> dict:
    used = int(daily_counters.value(_et_day(), SCOPE, str(user_id)))
    cap = daily_cap()
    return {"used": used, "cap": cap, "remaining": max(0, cap - used),
            "resets": "midnight ET", "day": _et_day()}


# ── cell safety + writers ───────────────────────────────────────────────────

_FORMULA_LEAD = ("=", "+", "-", "@", "\t", "\r")


def safe_cell(v: Any) -> Any:
    """A number stays a number. A string a spreadsheet would evaluate is made
    literal with a leading apostrophe. None is an empty cell, never "None"."""
    if v is None:
        return ""
    if isinstance(v, bool):
        return "TRUE" if v else "FALSE"
    if isinstance(v, (int, float)):
        return v
    if isinstance(v, (list, tuple)):
        v = ", ".join(str(x) for x in v)
    s = str(v)
    if s.startswith(_FORMULA_LEAD):
        return "'" + s
    return s


def to_csv(columns: Sequence[str], rows: Iterable[dict]) -> bytes:
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\r\n")
    w.writerow([safe_cell(c) for c in columns])
    for r in rows:
        w.writerow([safe_cell(r.get(c)) for c in columns])
    # BOM so Excel opens UTF-8 (ticker names, publisher names) correctly.
    return ("﻿" + buf.getvalue()).encode("utf-8")


def _col_letter(i: int) -> str:
    s = ""
    i += 1
    while i:
        i, r = divmod(i - 1, 26)
        s = chr(65 + r) + s
    return s


_XML_BAD = re.compile("[\x00-\x08\x0b\x0c\x0e-\x1f]")


def _xlsx_cell(ref: str, v: Any) -> str:
    v = safe_cell(v)
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        if v != v or v in (float("inf"), float("-inf")):  # NaN / inf: no number
            return f'<c r="{ref}"/>'
        return f'<c r="{ref}"><v>{v!r}</v></c>' if isinstance(v, float) else f'<c r="{ref}"><v>{v}</v></c>'
    if v == "":
        return f'<c r="{ref}"/>'
    text = escape(_XML_BAD.sub("", str(v)))
    return f'<c r="{ref}" t="inlineStr"><is><t xml:space="preserve">{text}</t></is></c>'


def to_xlsx(columns: Sequence[str], rows: Iterable[dict], sheet: str = "Export") -> bytes:
    lines = []
    all_rows = [list(columns)] + [[r.get(c) for c in columns] for r in rows]
    for ri, vals in enumerate(all_rows, start=1):
        cells = "".join(_xlsx_cell(f"{_col_letter(ci)}{ri}", v) for ci, v in enumerate(vals))
        lines.append(f'<row r="{ri}">{cells}</row>')
    sheet_xml = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                 '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
                 f'<sheetData>{"".join(lines)}</sheetData></worksheet>')
    name = escape(re.sub(r"[\[\]:*?/\\]", "", sheet)[:31] or "Export")
    files = {
        "[Content_Types].xml": (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
            '<Default Extension="xml" ContentType="application/xml"/>'
            '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
            '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
            '</Types>'),
        "_rels/.rels": (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
            '</Relationships>'),
        "xl/workbook.xml": (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
            'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
            f'<sheets><sheet name="{name}" sheetId="1" r:id="rId1"/></sheets></workbook>'),
        "xl/_rels/workbook.xml.rels": (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
            '</Relationships>'),
        "xl/worksheets/sheet1.xml": sheet_xml,
    }
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for path, body in files.items():
            z.writestr(path, body)
    return out.getvalue()


MEDIA = {"csv": "text/csv; charset=utf-8",
         "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}


def render(fmt: str, columns: Sequence[str], rows: list[dict], sheet: str) -> bytes:
    if fmt == "xlsx":
        return to_xlsx(columns, rows, sheet)
    return to_csv(columns, rows)


def filename(stem: str, fmt: str) -> str:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d")
    clean = re.sub(r"[^A-Za-z0-9_.-]+", "_", stem).strip("_") or "export"
    return f"{clean}_{stamp}.{fmt}"


def _columns_of(rows: list[dict], preferred: Sequence[str] = ()) -> list[str]:
    cols = [c for c in preferred if any(c in r for r in rows)]
    for r in rows:
        for k in r:
            if k not in cols:
                cols.append(k)
    return cols


# ── builders: each reads the page's own function, nothing else ──────────────

def screener_rows(spec: dict, user_id, user) -> tuple[list[str], list[dict], str]:
    """Every row the member's screen matches, up to the page's own 5,000 ceiling,
    in the columns the screen displays."""
    from api.services.screener import query as scr_query
    spec = dict(spec or {})
    rows: list[dict] = []
    columns: list[str] = []
    snapshot = ""
    page = 1
    while len(rows) < SCREENER_MAX_ROWS:
        spec.update(page=page, page_size=SCREENER_PAGE)
        res = scr_query.run_scan(spec, user_id=user_id, user=user)
        batch = res.get("rows") or []
        columns = columns or list(res.get("view_columns") or [])
        snapshot = snapshot or (res.get("snapshot_date") or "")
        rows.extend(batch)
        total = res.get("total") or 0
        if not batch or len(rows) >= total or len(batch) < SCREENER_PAGE:
            break
        page += 1
    rows = rows[:SCREENER_MAX_ROWS]
    columns = columns or _columns_of(rows, ("ticker",))
    return columns, rows, f"screen_{snapshot or 'snapshot'}"


def watchlist_rows(wl_id: str, user_id) -> tuple[list[str], list[dict], str] | None:
    """Membership only -- symbol, note, added -- exactly what the list holds."""
    from api.services import watchlist_service
    wl = watchlist_service.get_watchlist(wl_id, user_id)
    if not wl:
        return None
    rows = [{"symbol": i.get("sym"), "notes": i.get("notes") or "",
             "added_at": i.get("added_at") or ""}
            for i in (wl.get("items") or []) if isinstance(i, dict) and i.get("sym")]
    return ["symbol", "notes", "added_at"], rows, f"watchlist_{wl.get('name') or wl_id}"


CHAIN_COLUMNS = ["side", "contract", "expiration", "strike", "bid", "ask", "last",
                 "day_volume", "open_interest", "iv", "delta", "gamma", "theta",
                 "vega", "break_even", "quote_time"]


def chain_rows(sym: str, expiration: str, strikes: int) -> tuple[list[str], list[dict], str]:
    from api.services import polygon_options
    out = polygon_options.get_chain(sym, expiration=expiration, strikes_around_spot=strikes)
    if isinstance(out, dict) and out.get("error"):
        raise RuntimeError(f"Option chain unavailable: {out['error']}")
    rows = []
    for side in ("calls", "puts"):
        for c in out.get(side) or []:
            rows.append({**{k: c.get(k) for k in CHAIN_COLUMNS}, "side": side[:-1]})
    return CHAIN_COLUMNS, rows, f"chain_{sym.upper()}_{out.get('expiration') or 'nearest'}"


NEWS_COLUMNS = ["time", "headline", "source", "category", "tickers", "url"]


def news_rows() -> tuple[list[str], list[dict], str]:
    from api.services.engine import get_news
    items = get_news() or []
    rows = [{k: it.get(k) for k in NEWS_COLUMNS}
            for it in items if isinstance(it, dict) and not it.get("error")]
    return NEWS_COLUMNS, rows, "news"


BAR_PREFERRED = ("time", "t", "open", "o", "high", "h", "low", "l", "close", "c",
                 "volume", "v")


def bars_rows(ticker: str, tf: str, bars: int) -> tuple[list[str], list[dict], str]:
    import json
    from api.routers.bars import serve_bars
    resp = serve_bars(ticker, tf, min(int(bars), BARS_MAX))
    body = resp
    if hasattr(resp, "body"):
        if getattr(resp, "status_code", 200) >= 400:
            raise RuntimeError("Chart data unavailable for this symbol")
        body = json.loads(resp.body)
    data = (body or {}).get("bars") or []
    if isinstance(data, dict):  # a pack keyed by symbol is not a series
        data = []
    rows = [b for b in data if isinstance(b, dict)]
    return _columns_of(rows, BAR_PREFERRED), rows, f"bars_{ticker.upper()}_{tf}"
