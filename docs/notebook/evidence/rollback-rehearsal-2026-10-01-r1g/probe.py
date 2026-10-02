"""Rollback rehearsal probe, lane R1g (2026-10-01): lane R1f's probe plus the two doors L14 moves.

Everything R1f's probe measures (`../rollback-rehearsal-2026-09-30-r1f/probe.py`, itself a chain
back through R1e/R1d/R1c/R1: the never-revert set, every earlier landing's door including L7's
Find-in-note floor, L12's sort door, L10's template door and L13's analyst-consensus-capture door)
is measured unchanged, by importing that file. Added:

  * L14 PX item 2 (ruling 149): a LOCKED note refuses all three append doors with 423 --
    `POST /api/j2/notes/{id}/embeds`, `POST /api/j2/notes/{id}/facts/{fact_id}/insert`,
    `POST /api/j2/notes/{id}/excerpts`. At the tip the note's own `locked` flag (set via
    `PATCH /api/j2/notes/{id}/lock`) makes all three answer 423; reverted (through `L14`, i.e.
    at L13's own tip and below), none of the three checks the lock at all and each answers 200 --
    a locked note silently takes the capture, the exact pre-fix behaviour ruling 149 names.

  * L14 PX item 1: `App.jsx`'s `INTRO_SKIP_PREFIXES` -- a stranger opening `/share/n/:token` or
    `/p/:slug` never sees the ~9s brand film. Checked against the REAL BOOTED BUNDLE (app/dist, as
    served) in a signed-out browser context (never the member's authenticated one): at the tip the
    `div[role="dialog"][aria-label="Welcome"]` IntroAnimation never mounts on those two routes;
    reverted, it does (same selector `tools/notebook_perf_harness.py::_INTRO_DIALOG_SEL` already
    uses to find and dismiss it). A signed-out, unauthenticated `/dashboard` load is the control --
    it proves the instrument can SEE the intro when nothing skips it, on all three steps. R1f's
    probe pattern never greps a built JS file's text (no probe in this chain does -- confirmed by
    reading every one back to R1's own), so this is "checked" in the sense the pattern supports:
    the actual served bundle's behaviour in a real browser, not its minified source text.

    python probe.py --base http://127.0.0.1:<port> --integrity-log <log> --out <dir> \
        --mode seed|check --fixtures <fixtures.json> --label <step>
Prints one JSON object and writes <out>/probe.json. Exit 0 always: the caller compares steps.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve()
REPO = HERE.parents[4]
R1F = HERE.parents[1] / "rollback-rehearsal-2026-09-30-r1f" / "probe.py"


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


r1f = _load("r1f_probe", R1F)
r1e = r1f.r1e
r1d = r1f.r1d
r1c = r1f.r1c
r1 = r1f.r1

# Same shape as test_notes.py's own EMBED_ATTRS fixture (api/services/journal_two/test_notes.py) --
# a real widgetEmbed the append door accepts, not a guessed shape.
EMBED_ATTRS = {
    "v": 1, "widgetId": "chart", "params": {"symbol": "TSLA", "tf": "15"},
    "capturedAt": "2026-08-12T14:00:00Z", "mode": "snapshot",
    "searchText": "[chart: TSLA 15m]",
}

# A minimal, real, pypdf-built one-page PDF -- same recipe as
# api/services/journal_two/pdf_fixtures.py::make_pdf, inlined so this probe has no import
# dependency on a test-only module (pdf_fixtures.py is not shipped and its path is not stable
# across every tree this probe boots).
def _make_pdf(text: str) -> bytes:
    import io
    from pypdf import PdfWriter
    from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject
    w = PdfWriter()
    font = DictionaryObject({
        NameObject("/Type"): NameObject("/Font"),
        NameObject("/Subtype"): NameObject("/Type1"),
        NameObject("/BaseFont"): NameObject("/Helvetica"),
    })
    font_ref = w._add_object(font)
    page = w.add_blank_page(width=612, height=792)
    stream_bytes = f"BT /F1 24 Tf 72 700 Td ({text}) Tj ET".encode("latin-1")
    content = DecodedStreamObject()
    content.set_data(stream_bytes)
    content_ref = w._add_object(content)
    page[NameObject("/Contents")] = content_ref
    page[NameObject("/Resources")] = DictionaryObject({
        NameObject("/Font"): DictionaryObject({NameObject("/F1"): font_ref}),
    })
    buf = io.BytesIO()
    w.write(buf)
    return buf.getvalue()


def l14_locked_append_doors(member, base):
    """A locked note refuses all three append doors with 423 at the tip; reverted (L14 gone),
    none of the three checks the lock and each takes the capture with 200."""
    res = {}
    nid = None
    try:
        rn = member.post(base + "/api/j2/notes", data={"title": "r1g L14 locked-append door"})
        res["create_note_status"] = rn.status
        note = r1._note_of(r1._json(rn)) if rn.status in (200, 201) else {}
        nid = note.get("id")
        res["note_id"] = nid
        if not nid:
            res["error"] = "note creation failed"
            return res

        # A fact, for the /facts/{id}/insert door.
        rf = member.post(base + f"/api/j2/notes/{nid}/facts", data={
            "ticker": "NVDA", "factType": "price", "value": 1.0,
        })
        fact = (r1._json(rf) or {}).get("fact") if rf.status == 200 else None
        res["create_fact_status"] = rf.status

        # A real PDF document, for the /excerpts door (create_excerpt re-verifies the document
        # row belongs to this user; a fake documentId 400s before the lock check is ever reached).
        pdf_bytes = _make_pdf("r1g excerpt source text")
        ra = member.post(base + f"/api/j2/notes/{nid}/attachments",
                         multipart={"file": {"name": "r1g.pdf", "mimeType": "application/pdf",
                                             "buffer": pdf_bytes}})
        res["upload_attachment_status"] = ra.status
        doc_id = None
        if ra.status == 200:
            docs = r1._json(member.get(base + f"/api/j2/notes/{nid}/documents")) or {}
            att_url = (r1._json(ra) or {}).get("url")
            for d in docs.get("documents") or []:
                if d.get("attachmentUrl") == att_url:
                    doc_id = d.get("id")
                    break
        res["document_id_resolved"] = doc_id is not None

        # Lock it.
        rl = member.patch(base + f"/api/j2/notes/{nid}/lock", data={"locked": True})
        res["lock_status"] = rl.status
        res["locked_true"] = bool((r1._json(rl) or {}).get("note", {}).get("locked") is True)

        # 1. embeds
        re_ = member.post(base + f"/api/j2/notes/{nid}/embeds", data={"attrs": EMBED_ATTRS})
        res["embeds_status"] = re_.status
        res["embeds_refused"] = re_.status == 423

        # 2. facts/{id}/insert
        if fact and fact.get("id"):
            ri = member.post(base + f"/api/j2/notes/{nid}/facts/{fact['id']}/insert")
            res["facts_insert_status"] = ri.status
            res["facts_insert_refused"] = ri.status == 423
        else:
            res["facts_insert_status"] = None
            res["facts_insert_refused"] = None

        # 3. excerpts
        if doc_id:
            rx = member.post(base + f"/api/j2/notes/{nid}/excerpts", data={
                "documentId": doc_id, "pageNumber": 1,
                "capturedText": "r1g excerpt source text",
            })
            res["excerpts_status"] = rx.status
            res["excerpts_refused"] = rx.status == 423
        else:
            res["excerpts_status"] = None
            res["excerpts_refused"] = None

        res["all_three_refused"] = bool(
            res.get("embeds_refused") and res.get("facts_insert_refused") and res.get("excerpts_refused"))
        res["any_refused"] = bool(
            res.get("embeds_refused") or res.get("facts_insert_refused") or res.get("excerpts_refused"))
    except Exception as e:  # noqa: BLE001
        res["error"] = f"{type(e).__name__}: {e}"[:300]
    finally:
        if nid:
            # unlock first -- a trash of a locked note is a different door this probe is not
            # exercising, and leaving the fixture locked would make the NEXT probe's own trash
            # (if ever reused) ambiguous about which refusal fired.
            try:
                member.patch(base + f"/api/j2/notes/{nid}/lock", data={"locked": False})
            except Exception:  # noqa: BLE001
                pass
            r1._trash(member, base, nid)
    return res


_INTRO_DIALOG_SEL = 'div[role="dialog"][aria-label="Welcome"]'


def _intro_shown(browser, url) -> dict:
    """A FRESH, never-provisioned context -- no member cookie, no admin cookie -- so this is a
    genuine signed-out stranger's first load, the exact case ruling PX item 1 is about."""
    ctx = browser.new_context()
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)[:300]))
    out = {"url": url}
    try:
        page.goto(url, wait_until="domcontentloaded", timeout=20000)
        dialog = page.locator(_INTRO_DIALOG_SEL)
        try:
            dialog.first.wait_for(state="visible", timeout=4000)
            out["intro_shown"] = True
        except Exception:  # noqa: BLE001 -- did not appear within the window
            out["intro_shown"] = False
        out["page_errors"] = errors
    except Exception as e:  # noqa: BLE001
        out["error"] = f"{type(e).__name__}: {e}"[:300]
    finally:
        ctx.close()
    return out


def l14_intro_skip_public_routes(browser, base):
    """INTRO_SKIP_PREFIXES: no intro on /share/n/:token or /p/:slug, checked against the real
    served bundle in a signed-out context. A signed-out /dashboard load is the control -- it
    proves THIS instrument can see the intro when nothing skips it (so an "absent" reading on
    the two public routes is a fact about the route, not about a browser that can never show
    it)."""
    out = {
        "share_note": _intro_shown(browser, base + "/share/n/r1g-intro-skip-token"),
        "published_note": _intro_shown(browser, base + "/p/r1g-intro-skip-slug"),
        "control_dashboard_signed_out": _intro_shown(browser, base + "/dashboard"),
    }
    out["skip_working"] = (
        out["share_note"].get("intro_shown") is False and out["published_note"].get("intro_shown") is False)
    out["control_saw_intro"] = out["control_dashboard_signed_out"].get("intro_shown") is True
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", required=True)
    ap.add_argument("--integrity-log", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--mode", choices=("seed", "check"), required=True)
    ap.add_argument("--fixtures", required=True)
    ap.add_argument("--label", required=True)
    a = ap.parse_args()
    base = a.base.rstrip("/")
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    sid = _load("sid", REPO / "scripts" / "sandbox_identity.py")
    ver = sid.verify(base, a.integrity_log)
    res: dict = {"label": a.label, "mode": a.mode, "identity": ver.sentence, "proven": ver.ok}
    if not ver.ok:
        print(json.dumps(res, indent=2))
        (out / "probe.json").write_text(json.dumps(res, indent=2), encoding="utf-8")
        return 0
    perf = _load("perf", REPO / "tools" / "notebook_perf_harness.py")
    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        admin = pw.request.new_context()
        ctx = browser.new_context(viewport={"width": 1440, "height": 900})
        perf._provision(admin, ctx.request, base, member=r1.MEMBER)
        member = ctx.request
        fx_path = Path(a.fixtures)
        if a.mode == "seed":
            fx = {}
            for key, (title, body) in r1.FIXTURE_BODIES.items():
                r = member.post(base + "/api/j2/notes", data={"title": title, "bodyJson": body})
                fx[key] = r1._note_of(r1._json(r)).get("id") if r.status in (200, 201) else None
                res[f"seed_{key}_status"] = r.status
            fx_path.write_text(json.dumps(fx, indent=2), encoding="utf-8")
        fx = json.loads(fx_path.read_text(encoding="utf-8"))
        res["fixtures"] = fx
        res["landings"] = r1.landing_probes(member, admin, base, fx)
        res["L7_find_input_floor"] = r1d.l7_find_input_floor(ctx, base, perf, fx["n0"], out)
        res["L12_sort_updated_asc"] = r1e.l12_sort_updated_asc(member, base)
        res["L10_template_gallery"] = r1e.l10_template_gallery_count(ctx, base, perf, out)
        res["L13_analyst_consensus_capture"] = r1f.l13_analyst_consensus_capture(member, base)
        res["L14_locked_append_doors"] = l14_locked_append_doors(member, base)
        res["L14_intro_skip_public_routes"] = l14_intro_skip_public_routes(browser, base)
        res["dom"] = r1.dom_probes(ctx, base, perf, out)
        res["editor"] = {k: r1.editor_probe(ctx, member, base, perf, k, fx[k], a.label, out)
                         for k in ("n2", "n1", "n0") if fx.get(k)}
        ctx.close()
        admin.dispose()
        browser.close()
    print(json.dumps(res, indent=2))
    (out / "probe.json").write_text(json.dumps(res, indent=2), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
