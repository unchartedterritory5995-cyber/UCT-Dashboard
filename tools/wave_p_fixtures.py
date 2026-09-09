"""Wave P §37 — the OCR fixture corpus, generated, never harvested.

⛔⛔ NO MEMBER DOCUMENT IS EVER A BENCHMARK FIXTURE. Every page here is drawn
by this file from strings this file owns, so the ground truth is not a
transcription somebody made — it is the input. That is what lets §38's
non-vacuity controls exist at all: a fixture whose "correct answer" was itself
produced by an OCR pass can only ever confirm the engine that made it.

⛔ AND IT USES ONLY WHAT PRODUCTION HAS. Pillow, numpy and pypdf are in
`requirements.txt`; the DejaVu faces are already in the repo for the Desk
thumbnail renderer. ⚠️ THIS BOX ALSO HAS `pypdfium2`, `pytesseract`,
`onnxruntime` and `cv2` INSTALLED BY ANOTHER WORKSTREAM AND NONE OF THEM ARE IN
`requirements.txt` — a fixture built on one of those would be measuring an
instrument production does not own.

WHAT THE CORPUS IS FOR (§9): financial OCR is not prose OCR. The tokens that
decide whether a member is misled are `18.4%` vs `13.4%`, `$1.2B` vs `$1.28`,
`(1,204)` vs `1,204` — so every page carries a NUMERIC LEDGER of exactly those,
recorded beside the page as ground truth.

    python tools/wave_p_fixtures.py --out tools/wave_p_fixtures_out
"""
from __future__ import annotations

import argparse
import io
import json
import pathlib
import random
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
FONT_DIR = ROOT / "api" / "services" / "desk_assets"

# ── The financial tokens that actually matter (§42) ─────────────────────────
# ⛔ These strings are the CONTRACT. A benchmark that scores "close enough"
# prose while getting these wrong has measured the wrong thing.
LEDGER = {
    "revenue": "$12.48 billion",
    "gross_margin": "74.3%",
    "eps": "$3.18",
    "date": "September 8, 2026",
    "shares": "2,461,000",
    "negative": "(1,204)",
    "ticker": "NVDA",
    "ratio": "18.4x",
    "small_pct": "0.7%",
    "big_dollar": "$1,204.56",
}

PAGE_W, PAGE_H = 1700, 2200          # ~200 DPI on US Letter
MARGIN = 140


def _font(size: int, *, bold: bool = False, serif: bool = False):
    from PIL import ImageFont
    name = ("DejaVuSerif-Bold.ttf" if bold else "DejaVuSerif.ttf") if serif \
        else ("DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf")
    return ImageFont.truetype(str(FONT_DIR / name), size)


def _blank():
    from PIL import Image
    return Image.new("L", (PAGE_W, PAGE_H), 255)


def _lines(draw, lines, *, x=MARGIN, y=MARGIN, size=34, leading=1.55,
           bold=False, serif=False, width=None):
    f = _font(size, bold=bold, serif=serif)
    step = int(size * leading)
    for ln in lines:
        draw.text((x, y), ln, font=f, fill=20)
        y += step
    return y


# ── Page builders. Each returns (PIL image, ground-truth text lines) ────────

def page_clean() -> tuple[object, list[str]]:
    """A clean typed financial page — the best case, and the control that says
    the engine works at all before any degradation is applied."""
    from PIL import ImageDraw
    img = _blank()
    d = ImageDraw.Draw(img)
    lines = [
        f"{LEDGER['ticker']} CORPORATION",
        "CONDENSED CONSOLIDATED STATEMENTS OF INCOME",
        f"Quarter ended {LEDGER['date']}",
        "",
        f"Total revenue was {LEDGER['revenue']}, an increase of 22% year over year.",
        f"Gross margin was {LEDGER['gross_margin']} compared with 71.2% a year ago.",
        f"Diluted earnings per share were {LEDGER['eps']}.",
        f"Weighted average shares outstanding: {LEDGER['shares']}.",
        f"Other income (expense), net: {LEDGER['negative']}.",
        f"Net debt to EBITDA stood at {LEDGER['ratio']} at quarter end.",
        f"Restructuring charges represented {LEDGER['small_pct']} of revenue.",
        f"Average selling price per unit rose to {LEDGER['big_dollar']}.",
    ]
    y = _lines(d, lines[:3], size=44, bold=True)
    _lines(d, lines[3:], y=y + 40, size=36)
    return img, lines


def page_dense() -> tuple[object, list[str]]:
    """A dense filing page with footnotes — small type, tight leading."""
    from PIL import ImageDraw
    img = _blank()
    d = ImageDraw.Draw(img)
    body = [
        "Management's Discussion and Analysis of Financial Condition",
        "",
        f"Revenue for the quarter was {LEDGER['revenue']}. The increase was driven",
        "primarily by data center demand, partially offset by lower gaming volumes.",
        f"Gross margin of {LEDGER['gross_margin']} reflects a favorable product mix.",
        "Operating expenses grew 14% on higher research and development headcount.",
        f"Diluted earnings per share of {LEDGER['eps']} include a one-time charge.",
        "",
        "Liquidity and Capital Resources",
        "",
        "Cash, cash equivalents and marketable securities totaled $31.4 billion.",
        f"Net leverage was {LEDGER['ratio']} on a trailing twelve month basis.",
        "The Company repurchased 4.1 million shares during the period.",
        "",
        "_______________",
        f"(1) Includes {LEDGER['negative']} of other expense, net.",
        f"(2) Restructuring represented {LEDGER['small_pct']} of total revenue.",
        f"(3) Weighted average diluted shares of {LEDGER['shares']}.",
    ]
    _lines(d, body, size=28, leading=1.6, serif=True)
    return img, body


def page_table() -> tuple[object, list[str]]:
    """A table-heavy page. ⛔ THE POINT IS NOT THAT OCR REBUILDS THE TABLE — §27
    forbids claiming that. The point is whether the VALUES survive at all."""
    from PIL import ImageDraw
    img = _blank()
    d = ImageDraw.Draw(img)
    rows = [
        ("Segment", "Q3 2026", "Q3 2025", "Change"),
        ("Data Center", "$9,242", "$6,108", "51%"),
        ("Gaming", "$2,856", "$3,041", "(6%)"),
        ("Professional Viz", "$486", "$379", "28%"),
        ("Automotive", "$329", "$253", "30%"),
        ("Total", "$12,913", "$9,781", "32%"),
    ]
    cols = [MARGIN, MARGIN + 520, MARGIN + 900, MARGIN + 1240]
    y = MARGIN
    d.text((MARGIN, y), "REVENUE BY SEGMENT (in millions)", font=_font(38, bold=True), fill=20)
    y += 110
    truth: list[str] = ["REVENUE BY SEGMENT (in millions)"]
    for i, r in enumerate(rows):
        f = _font(32, bold=(i == 0 or r[0] == "Total"))
        for cx, cell in zip(cols, r):
            d.text((cx, y), cell, font=f, fill=20)
        truth.append(" ".join(r))
        if i == 0 or r[0] == "Total":
            d.line([(MARGIN, y + 46), (PAGE_W - MARGIN, y + 46)], fill=90, width=3)
        y += 92
    return img, truth


def page_two_column() -> tuple[object, list[str]]:
    """Multi-column. Reading order is the thing being measured (§10)."""
    from PIL import ImageDraw
    img = _blank()
    d = ImageDraw.Draw(img)
    left = [
        "OUTLOOK", "",
        "For the fourth quarter the Company",
        "expects revenue of $13.5 billion,",
        "plus or minus two percent.",
        f"GAAP gross margin is expected to be",
        f"{LEDGER['gross_margin']}, plus or minus",
        "fifty basis points.",
    ]
    right = [
        "RISK FACTORS", "",
        "Demand may not materialize at the",
        "levels currently anticipated.",
        f"A {LEDGER['small_pct']} shift in mix would",
        "move gross margin materially.",
        f"Leverage of {LEDGER['ratio']} limits",
        "financial flexibility.",
    ]
    _lines(d, left, x=MARGIN, size=30, width=640)
    _lines(d, right, x=MARGIN + 780, size=30, width=640)
    d.line([(MARGIN + 720, MARGIN), (MARGIN + 720, PAGE_H - MARGIN)], fill=170, width=2)
    return img, left + right


def page_slide() -> tuple[object, list[str]]:
    """An image-only presentation slide — big type, sparse text, a chart with
    labels. ⛔ §28: labels becoming searchable is NOT chart understanding."""
    from PIL import ImageDraw
    img = _blank()
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, PAGE_W, 260], fill=235)
    d.text((MARGIN, 90), "DATA CENTER MOMENTUM", font=_font(64, bold=True), fill=20)
    truth = ["DATA CENTER MOMENTUM"]
    bars = [("Q1", 320), ("Q2", 480), ("Q3", 760), ("Q4E", 900)]
    base_y = 1500
    for i, (label, h) in enumerate(bars):
        x = MARGIN + i * 340
        d.rectangle([x, base_y - h, x + 220, base_y], fill=120)
        d.text((x + 60, base_y + 30), label, font=_font(36, bold=True), fill=20)
        truth.append(label)
    d.text((MARGIN, base_y + 160),
           f"Revenue reached {LEDGER['revenue']} in the quarter.",
           font=_font(40), fill=20)
    truth.append(f"Revenue reached {LEDGER['revenue']} in the quarter.")
    return img, truth


# ── Degradations ────────────────────────────────────────────────────────────

def degrade_lowres(img, factor: float = 0.34):
    from PIL import Image
    small = img.resize((int(PAGE_W * factor), int(PAGE_H * factor)), Image.LANCZOS)
    return small.resize((PAGE_W, PAGE_H), Image.LANCZOS)


def degrade_skew(img, degrees: float = 2.1):
    from PIL import Image
    # ⛔ BICUBIC, not LANCZOS: `rotate` goes through `transform`, which
    # rejects LANCZOS outright. A skew fixture that never rendered would
    # have removed a whole degradation case from the corpus silently.
    return img.rotate(degrees, resample=Image.Resampling.BICUBIC,
                      fillcolor=255, expand=False)


def degrade_noise(img, amount: float = 0.30, seed: int = 7):
    """Scanner grain. Used for the low-resolution case AND, at a much heavier
    setting, for §41's deliberately unreadable page."""
    import numpy as np
    rng = np.random.default_rng(seed)
    a = np.asarray(img).astype("float32")
    a += rng.normal(0, 255 * amount, a.shape)
    from PIL import Image
    return Image.fromarray(a.clip(0, 255).astype("uint8"), mode="L")


def degrade_unreadable(img):
    """⛔ §41 — a page OCR must FAIL on, so 'some text came out' cannot pass for
    success. Heavy grain plus a near-black wash: a human cannot read it either,
    which is the honest definition of unreadable."""
    from PIL import Image, ImageFilter
    img = degrade_noise(img, amount=0.85, seed=13)
    img = img.filter(ImageFilter.GaussianBlur(radius=6))
    import numpy as np
    a = np.asarray(img).astype("float32") * 0.35 + 40
    return Image.fromarray(a.clip(0, 255).astype("uint8"), mode="L")


# ── PDF assembly ────────────────────────────────────────────────────────────

def _images_to_scanned_pdf(images) -> bytes:
    """An IMAGE-ONLY PDF — exactly what a scanner produces and what UCT
    currently, correctly, reports as `no_text`."""
    buf = io.BytesIO()
    rgb = [im.convert("RGB") for im in images]
    rgb[0].save(buf, format="PDF", save_all=True, append_images=rgb[1:],
                resolution=200.0)
    return buf.getvalue()


def _native_text_pdf(pages_lines) -> bytes:
    """A REAL text-layer PDF for the §39 control. Built by hand rather than
    with a reportlab-class dependency production does not have: a minimal
    PDF with one content stream per page and a base-14 font is enough for
    pypdf to extract text from, which is the only thing the control needs.
    """
    def esc(s: str) -> str:
        return s.replace("\\", r"\\").replace("(", r"\(").replace(")", r"\)")

    objs: list[bytes] = []

    def add(b: bytes) -> int:
        objs.append(b)
        return len(objs)

    font_id = add(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    page_ids: list[int] = []
    content_ids: list[int] = []
    for lines in pages_lines:
        parts = ["BT", "/F1 12 Tf", "14 TL", "72 720 Td"]
        for ln in lines:
            parts.append(f"({esc(ln)}) Tj")
            parts.append("T*")
        parts.append("ET")
        stream = "\n".join(parts).encode("latin-1", "replace")
        content_ids.append(add(b"<< /Length %d >>\nstream\n%s\nendstream"
                               % (len(stream), stream)))
    pages_id = len(objs) + len(pages_lines) + 1
    for cid in content_ids:
        page_ids.append(add(
            b"<< /Type /Page /Parent %d 0 R /MediaBox [0 0 612 792] "
            b"/Resources << /Font << /F1 %d 0 R >> >> /Contents %d 0 R >>"
            % (pages_id, font_id, cid)))
    kids = b" ".join(b"%d 0 R" % p for p in page_ids)
    real_pages_id = add(b"<< /Type /Pages /Count %d /Kids [%s] >>"
                        % (len(page_ids), kids))
    assert real_pages_id == pages_id, "page-tree id drifted from the /Parent refs"
    catalog_id = add(b"<< /Type /Catalog /Pages %d 0 R >>" % real_pages_id)

    out = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for i, body in enumerate(objs, start=1):
        offsets.append(len(out))
        out += b"%d 0 obj\n" % i + body + b"\nendobj\n"
    xref_at = len(out)
    out += b"xref\n0 %d\n" % (len(objs) + 1)
    out += b"0000000000 65535 f \n"
    for off in offsets[1:]:
        out += b"%010d 00000 n \n" % off
    out += (b"trailer\n<< /Size %d /Root %d 0 R >>\nstartxref\n%d\n%%%%EOF\n"
            % (len(objs) + 1, catalog_id, xref_at))
    return bytes(out)


def build(out_dir: pathlib.Path) -> dict:
    out_dir.mkdir(parents=True, exist_ok=True)
    manifest: dict = {"ledger": LEDGER, "fixtures": {}}

    clean_img, clean_txt = page_clean()
    dense_img, dense_txt = page_dense()
    table_img, table_txt = page_table()
    col_img, col_txt = page_two_column()
    slide_img, slide_txt = page_slide()

    cases = [
        ("clean", clean_img, clean_txt, "clean typed scan"),
        ("lowres", degrade_noise(degrade_lowres(clean_img), 0.06), clean_txt,
         "low-resolution scan with grain"),
        ("skew", degrade_skew(clean_img), clean_txt, "2.1 degree skew"),
        ("dense", dense_img, dense_txt, "dense filing page with footnotes"),
        ("table", table_img, table_txt, "table-heavy page"),
        ("twocol", col_img, col_txt, "two-column layout"),
        ("slide", slide_img, slide_txt, "image-only presentation slide"),
    ]

    # One single-page scanned PDF per case — so a per-case score is a page
    # score, with no cross-page averaging to hide behind.
    for key, img, truth, desc in cases:
        pdf = _images_to_scanned_pdf([img])
        (out_dir / f"scan_{key}.pdf").write_bytes(pdf)
        img.save(out_dir / f"scan_{key}.png")
        manifest["fixtures"][f"scan_{key}"] = {
            "kind": "scanned_pdf", "pages": 1, "description": desc,
            "truth": {"1": truth},
            "expect_native_text": False,
        }

    # §41 · a multi-page scan with ONE deliberately unreadable page.
    unreadable = degrade_unreadable(clean_img)
    pdf = _images_to_scanned_pdf([clean_img, unreadable, table_img])
    (out_dir / "scan_failed_page.pdf").write_bytes(pdf)
    manifest["fixtures"]["scan_failed_page"] = {
        "kind": "scanned_pdf", "pages": 3,
        "description": "3 scanned pages; page 2 is unreadable by construction",
        "truth": {"1": clean_txt, "2": [], "3": table_txt},
        "unreadable_pages": [2],
        "expect_native_text": False,
    }

    # §39 · the native-text control. Must NEVER be sent through OCR.
    native = _native_text_pdf([clean_txt, dense_txt])
    (out_dir / "native_text.pdf").write_bytes(native)
    manifest["fixtures"]["native_text"] = {
        "kind": "native_pdf", "pages": 2,
        "description": "a real text-layer PDF — the no-OCR control",
        "truth": {"1": clean_txt, "2": dense_txt},
        "expect_native_text": True,
    }

    # §40 · the mixed control: native / scanned / native in ONE document.
    # ⛔ Built by MERGING a native PDF and a scanned PDF with pypdf, because a
    # mixed document is exactly what neither single-path fixture can catch.
    from pypdf import PdfReader, PdfWriter
    w = PdfWriter()
    n = PdfReader(io.BytesIO(_native_text_pdf([clean_txt])))
    s = PdfReader(io.BytesIO(_images_to_scanned_pdf([table_img])))
    n2 = PdfReader(io.BytesIO(_native_text_pdf([dense_txt])))
    w.add_page(n.pages[0])
    w.add_page(s.pages[0])
    w.add_page(n2.pages[0])
    buf = io.BytesIO()
    w.write(buf)
    (out_dir / "mixed.pdf").write_bytes(buf.getvalue())
    manifest["fixtures"]["mixed"] = {
        "kind": "mixed_pdf", "pages": 3,
        "description": "page 1 native, page 2 scanned, page 3 native",
        "truth": {"1": clean_txt, "2": table_txt, "3": dense_txt},
        "native_pages": [1, 3], "scanned_pages": [2],
        "expect_native_text": True,
    }

    (out_dir / "manifest.json").write_text(
        json.dumps(manifest, indent=2), encoding="utf-8")
    return manifest


# ── §10 · THE HOLDOUT CORPUS ────────────────────────────────────────────────
#
# ⛔⛔ WHY A SECOND CORPUS EXISTS. The seven pages above have now INFLUENCED
# configuration decisions — a `max_side_len` correction was found on them and a
# character-gap threshold was swept against them. A set that has shaped the
# thing it measures cannot also be the evidence for choosing between engines
# (`lesson_an_acceptance_number_is_a_forecast_until_derived`).
#
# So this builds an independent set: different company, different figures,
# different faces, different sizes, different degradation parameters. It is
# meant to be run ONCE, for the decision, and never tuned against.

H_LEDGER = {
    "revenue": "$7.93 billion",
    "gross_margin": "52.6%",
    "eps": "$1.07",
    "date": "March 31, 2027",
    "shares": "1,617,400",
    "negative": "(3,082)",
    "ticker": "AMD",
    "ratio": "9.6x",
    "small_pct": "0.3%",
    "big_dollar": "$986.41",
}


def h_page_report():
    """Clean, but SERIF where the tuned corpus used sans, and a size apart."""
    from PIL import ImageDraw
    img = _blank()
    d = ImageDraw.Draw(img)
    L = H_LEDGER
    lines = [
        f"{L['ticker']} INC.",
        "SELECTED QUARTERLY FINANCIAL DATA",
        f"Three months ended {L['date']}",
        "",
        f"Net revenue of {L['revenue']} increased 9% from the prior-year period.",
        f"Non-GAAP gross margin was {L['gross_margin']}, up 180 basis points.",
        f"Diluted earnings per share were {L['eps']} on a non-GAAP basis.",
        f"Diluted shares used in the computation: {L['shares']}.",
        f"Other expense, net was {L['negative']} for the quarter.",
        f"Net leverage finished the period at {L['ratio']} trailing EBITDA.",
        f"Litigation accruals were {L['small_pct']} of net revenue.",
        f"Backlog per design win averaged {L['big_dollar']}.",
    ]
    y = _lines(d, lines[:3], size=46, bold=True, serif=True)
    _lines(d, lines[3:], y=y + 36, size=32, serif=True)
    return img, lines


def h_page_notes():
    """Dense notes-to-accounts page: small sans, tight, parenthetical negatives."""
    from PIL import ImageDraw
    img = _blank()
    d = ImageDraw.Draw(img)
    L = H_LEDGER
    body = [
        "NOTES TO CONDENSED CONSOLIDATED FINANCIAL STATEMENTS",
        "",
        "Note 4 — Revenue Recognition",
        f"Net revenue for the quarter was {L['revenue']}, of which 61% was",
        "recognised at a point in time and the remainder over time.",
        f"Deferred revenue movements contributed {L['negative']} to the period.",
        "",
        "Note 7 — Income Taxes",
        f"The effective tax rate was 13.4% compared with {L['small_pct']} a year",
        "earlier, reflecting a discrete benefit from a prior-year settlement.",
        "",
        "Note 9 — Earnings Per Share",
        f"Diluted earnings per share of {L['eps']} were computed using",
        f"{L['shares']} weighted average diluted shares.",
        "",
        "________________",
        f"(a) Net leverage of {L['ratio']} excludes finance lease obligations.",
        f"(b) Amounts in parentheses, such as {L['negative']}, denote reductions.",
        f"(c) Percentages such as {L['gross_margin']} are computed on net revenue.",
    ]
    _lines(d, body, size=26, leading=1.65)
    return img, body


def h_page_balance():
    """A different table shape: a balance sheet with a negatives column."""
    from PIL import ImageDraw
    img = _blank()
    d = ImageDraw.Draw(img)
    rows = [
        ("Line item", "Mar 2027", "Dec 2026", "Change"),
        ("Cash and equivalents", "$5,118", "$4,835", "6%"),
        ("Accounts receivable", "$6,240", "$6,901", "(10%)"),
        ("Inventories", "$4,772", "$4,410", "8%"),
        ("Goodwill", "$24,203", "$24,203", "0%"),
        ("Total assets", "$69,215", "$67,885", "2%"),
    ]
    cols = [MARGIN, MARGIN + 620, MARGIN + 980, MARGIN + 1300]
    y = MARGIN
    d.text((MARGIN, y), "CONDENSED BALANCE SHEET (in millions)",
           font=_font(36, bold=True, serif=True), fill=20)
    y += 120
    truth = ["CONDENSED BALANCE SHEET (in millions)"]
    for i, r in enumerate(rows):
        f = _font(30, bold=(i == 0 or r[0].startswith("Total")), serif=True)
        for cx, cell in zip(cols, r):
            d.text((cx, y), cell, font=f, fill=20)
        truth.append(" ".join(r))
        if i == 0 or r[0].startswith("Total"):
            d.line([(MARGIN, y + 44), (PAGE_W - MARGIN, y + 44)], fill=90, width=3)
        y += 98
    return img, truth


def h_page_columns():
    """Two columns, narrower gutter than the tuned corpus."""
    from PIL import ImageDraw
    img = _blank()
    d = ImageDraw.Draw(img)
    L = H_LEDGER
    left = [
        "GUIDANCE", "",
        "Second quarter revenue is",
        f"expected to be {L['revenue']},",
        "plus or minus $300 million.",
        f"Non-GAAP gross margin of",
        f"{L['gross_margin']} is anticipated.",
        f"Operating expenses of {L['big_dollar']}",
        "million are planned.",
    ]
    right = [
        "SENSITIVITIES", "",
        "A one point change in mix",
        "moves gross margin by",
        f"roughly {L['small_pct']} of revenue.",
        f"Leverage of {L['ratio']} constrains",
        "buyback capacity.",
        f"A {L['negative']} swing in other",
        "expense would offset upside.",
    ]
    _lines(d, left, x=MARGIN, size=28)
    _lines(d, right, x=MARGIN + 830, size=28)
    d.line([(MARGIN + 770, MARGIN), (MARGIN + 770, PAGE_H - MARGIN)],
           fill=175, width=2)
    return img, left + right


def h_page_deck():
    """An image-only slide with a different layout and a labelled axis."""
    from PIL import ImageDraw
    img = _blank()
    d = ImageDraw.Draw(img)
    L = H_LEDGER
    d.text((MARGIN, 150), "CLIENT SEGMENT RECOVERY",
           font=_font(58, bold=True), fill=20)
    truth = ["CLIENT SEGMENT RECOVERY"]
    pts = [("FY25", 210), ("FY26", 430), ("FY27E", 690)]
    base = 1450
    for i, (lab, h) in enumerate(pts):
        x = MARGIN + i * 420
        d.rectangle([x, base - h, x + 260, base], outline=60, width=4)
        d.text((x + 70, base + 34), lab, font=_font(34, bold=True), fill=20)
        truth.append(lab)
    d.text((MARGIN, base + 170),
           f"Net revenue of {L['revenue']} at a {L['gross_margin']} gross margin.",
           font=_font(36), fill=20)
    truth.append(f"Net revenue of {L['revenue']} at a {L['gross_margin']} gross margin.")
    return img, truth


def build_holdout(out_dir: pathlib.Path) -> dict:
    """⛔ RUN ONCE, FOR THE DECISION. Never tune against this."""
    out_dir.mkdir(parents=True, exist_ok=True)
    manifest: dict = {"ledger": H_LEDGER, "fixtures": {}, "holdout": True}

    report, report_t = h_page_report()
    notes, notes_t = h_page_notes()
    balance, balance_t = h_page_balance()
    cols, cols_t = h_page_columns()
    deck, deck_t = h_page_deck()

    # Degradations use DIFFERENT parameters from the tuned corpus, so a setting
    # that happened to suit 2.1 degrees or a 0.34 downsample gets no free ride.
    cases = [
        ("clean", report, report_t, "clean serif quarterly page"),
        ("lowres", degrade_noise(degrade_lowres(report, 0.28), 0.045), report_t,
         "heavier downsample, lighter grain"),
        ("skew", degrade_skew(report, -1.4), report_t, "-1.4 degree skew"),
        ("notes", notes, notes_t, "dense notes page with parenthetical negatives"),
        ("balance", balance, balance_t, "balance-sheet table"),
        ("columns", cols, cols_t, "two columns, narrow gutter"),
        ("deck", deck, deck_t, "image-only slide"),
    ]
    for key, img, truth, desc in cases:
        (out_dir / f"scan_{key}.pdf").write_bytes(_images_to_scanned_pdf([img]))
        manifest["fixtures"][f"scan_{key}"] = {
            "kind": "scanned_pdf", "pages": 1, "description": desc,
            "truth": {"1": truth}, "expect_native_text": False}

    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2),
                                           encoding="utf-8")
    return manifest


# ── §21 · THE USABILITY-GATE CORPUS ─────────────────────────────────────────
#
# ⚰️ WHY THIS EXISTS. P1 treated any non-empty OCR result as usable text. The
# Tesseract benchmark disproved that: on a page unreadable by construction it
# emitted 258 characters of noise. Stored, that page would count toward
# `document_complete`, put garbage into Search, and offer garbage as evidence.
#
# ⛔ A THIRD CORPUS, SEPARATE FROM BOTH THE TUNED SET AND THE SELECTION
# HOLDOUT. The tuned set shaped configuration and the holdout decided the
# engine; reusing either to build AND score a predicate would repeat exactly
# the mistake the holdout was created to avoid.
#
# ⛔ AND IT IS SPLIT INTO A DESIGN HALF AND A CONTROL HALF. The predicate is
# designed against `_design` pages and scored on `_control` pages it has never
# seen (§21).


def _gate_noise(img, *, amount, blur, darken, seed):
    from PIL import Image, ImageFilter
    import numpy as np
    out = degrade_noise(img, amount=amount, seed=seed)
    if blur:
        out = out.filter(ImageFilter.GaussianBlur(radius=blur))
    a = np.asarray(out).astype("float32") * darken + (255 * (1 - darken) * 0.35)
    return Image.fromarray(a.clip(0, 255).astype("uint8"), mode="L")


def _gate_near_blank(seed=3):
    """A near-blank page with a few scanner artifacts — the case where an
    engine returns two or three accidental glyphs."""
    from PIL import Image, ImageDraw
    import numpy as np
    rng = np.random.default_rng(seed)
    img = Image.new("L", (PAGE_W, PAGE_H), 250)
    d = ImageDraw.Draw(img)
    for _ in range(14):
        x, y = rng.integers(100, PAGE_W - 100), rng.integers(100, PAGE_H - 100)
        d.ellipse([x, y, x + rng.integers(3, 11), y + rng.integers(3, 11)], fill=60)
    for _ in range(3):
        y = int(rng.integers(200, PAGE_H - 200))
        d.line([(80, y), (PAGE_W - 80, y + int(rng.integers(-6, 6)))], fill=150, width=2)
    return img


def _gate_scribbles(seed=11):
    """Random line noise — structure without language."""
    from PIL import Image, ImageDraw
    import numpy as np
    rng = np.random.default_rng(seed)
    img = Image.new("L", (PAGE_W, PAGE_H), 248)
    d = ImageDraw.Draw(img)
    for _ in range(240):
        x0, y0 = rng.integers(60, PAGE_W - 60), rng.integers(60, PAGE_H - 60)
        d.line([(x0, y0), (x0 + rng.integers(-90, 90), y0 + rng.integers(-30, 30))],
               fill=int(rng.integers(20, 120)), width=int(rng.integers(1, 4)))
    return img


def build_gate_corpus(out_dir: pathlib.Path) -> dict:
    out_dir.mkdir(parents=True, exist_ok=True)
    manifest: dict = {"fixtures": {}, "gate_corpus": True}

    clean, clean_t = page_clean()
    dense, dense_t = page_dense()
    table, table_t = page_table()
    slide, slide_t = page_slide()
    cols, cols_t = page_two_column()

    # GOOD — pages a member must NEVER be told are unreadable. Deliberately
    # includes the number-heavy, ticker-heavy, table-fragment cases §19 warns
    # a naive prose test would reject.
    good = [
        ("good_clean_design", clean, "clean prose scan", "design"),
        ("good_dense_design", dense, "dense financial page", "design"),
        ("good_table_design", table, "table, mostly numbers", "design"),
        ("good_lowres_design", degrade_noise(degrade_lowres(clean), 0.06),
         "low-resolution but readable", "design"),
        ("good_slide_control", slide, "sparse slide, very few words", "control"),
        ("good_twocol_control", cols, "two columns", "control"),
        ("good_skew_control", degrade_skew(clean, 2.1), "skewed but readable", "control"),
    ]
    # BAD — pages that must be rejected. An engine will still emit SOMETHING
    # for each of these, which is the whole point.
    bad = [
        ("bad_noise_design", _gate_noise(clean, amount=0.85, blur=6, darken=0.35, seed=13),
         "heavy grain + blur + wash", "design"),
        ("bad_blur_design", _gate_noise(dense, amount=0.15, blur=11, darken=0.8, seed=5),
         "extreme blur", "design"),
        ("bad_nearblank_design", _gate_near_blank(), "near-blank with artifacts", "design"),
        ("bad_scribbles_control", _gate_scribbles(), "random line noise", "control"),
        ("bad_noise2_control", _gate_noise(table, amount=0.9, blur=5, darken=0.4, seed=29),
         "heavy grain over a table", "control"),
        ("bad_blur2_control", _gate_noise(cols, amount=0.2, blur=13, darken=0.75, seed=41),
         "extreme blur, two columns", "control"),
    ]

    for key, img, desc, split in good + bad:
        (out_dir / f"{key}.pdf").write_bytes(_images_to_scanned_pdf([img]))
        manifest["fixtures"][key] = {
            "kind": "scanned_pdf", "pages": 1, "description": desc,
            "expect_usable": key.startswith("good_"), "split": split,
            "truth": {"1": []},
        }

    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2),
                                           encoding="utf-8")
    return manifest


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=None)
    ap.add_argument("--holdout", action="store_true",
                    help="build the INDEPENDENT holdout corpus (§10) instead")
    ap.add_argument("--gate", action="store_true",
                    help="build the usability-gate corpus (§21) instead")
    args = ap.parse_args()
    default = ("wave_p_gate_out" if args.gate else
               "wave_p_holdout_out" if args.holdout else "wave_p_fixtures_out")
    out = pathlib.Path(args.out or (ROOT / "tools" / default))
    m = (build_gate_corpus(out) if args.gate else
         build_holdout(out) if args.holdout else build(out))
    args.out = str(out)
    total = 0
    for k, v in m["fixtures"].items():
        total += v["pages"]
        print(f"  {k:<20} {v['kind']:<14} {v['pages']}p  {v['description']}")
    print(f"{len(m['fixtures'])} fixtures, {total} pages -> {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
