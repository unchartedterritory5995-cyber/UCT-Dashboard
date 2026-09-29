"""Wave 10 lane WH -- the ONE observed production pass for scorecard clause 12a
("writing help with provenance").

Owed per `docs/notebook/parity-scorecard.md` section 12: "the panel is live with
provenance railed, and autofill is built (G-165); no output has been observed in
a browser: no sandbox holds a model key. Owed: a pass as bench@ on production,
where the gate is armed." This script is that pass.

PRECONDITIONS
  * Target URL: https://uctintelligence.com (production). `--base` exists only
    to re-point this at a sandbox for a DRY RUN of the script itself -- a
    sandbox run does NOT satisfy clause 12a (no sandbox holds a model key) and
    the record's `base` field says so.
  * Account: bench@uctintelligence.internal -- the MEMBER synthetic account
    (CLAUDE.md "A second synthetic account -- bench@uctintelligence.internal,
    MEMBER role"). Credentials come from BENCH_EMAIL / BENCH_PASSWORD in the
    operator's environment (HKCU\\Environment, User scope) -- this script never
    prints, logs, or writes them anywhere; the record states only the signed-in
    email and its domain.
  * Gate: NOTEBOOK_WRITING_HELP_ENABLED armed on web since 2026-09-26 08:13Z
    (docs/feature_flags.json). This script does not arm anything and does not
    read Railway -- it only drives the product and reads what it shows.
  * ONE real model call is spent on production per run of this script. Never
    loop it; never retry on a refusal (a refusal is reported, not retried).
  * Its OWN Playwright browser context -- never the owner's Chrome, never the
    Chrome extension. The sign-in idiom is `tools/hub_nav_smoke.py`'s: POST the
    login through `context.request` so the session cookie lands in a context
    this script owns and closes; no password ever reaches a form field.
  * Cleanup: whatever this run creates, this run trashes, through the
    product's OWN "Delete" door (More note actions -> Delete -> confirm), which
    calls `DELETE /api/j2/notes/{id}` -- a soft delete, per CLAUDE.md's rule for
    bench@ ("whatever a run creates, that run removes"). The account holds no
    leftover state after a clean run.

Usage
-----
    python tools/notebook_wh_writing_help_prod_check.py \\
        --out docs/notebook/proof/wh-2026-09-29

Exit codes:
    0  PASS          every step measured: signed in as bench@, output observed,
                      provenance read from the panel's own DOM, insert-on-accept
                      confirmed by the landed document, cleanup confirmed.
    1  FAILED         the account check failed, or the product returned a
                      refusal / error at any step. Reported in the record, never
                      worked around and never retried.
    2  INCONCLUSIVE   a step could not be measured for a reason that is not a
                      product fact (Playwright unavailable, a timeout with no
                      signal either way). Not a verdict on the product.
"""
from __future__ import annotations

import argparse
import json
import os
import pathlib
import sys
import time
import urllib.parse
from datetime import datetime, timezone

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:  # noqa: BLE001
        pass

PROD = "https://uctintelligence.com"
BENCH_DOMAIN = "uctintelligence.internal"
BENCH_LOCAL_PART = "bench"
NOTE_TITLE_PREFIX = "WH provenance check"
NOTE_TEXT = (
    "Sat on my hands through the first thirty minutes even though the setup "
    "looked clean, because the open was choppy and I wanted to see how price "
    "held the premarket range before risking any size."
)
# "tighten this" in the task brief is an example, not a literal action name --
# WRITING_HELP_CHOICES (app/src/pages/journal-2-0/lib/writingHelpStream.js) has
# no "tighten" entry; "Rewrite shorter" is the closest real product action.
CHOICE_LABEL = "Rewrite shorter"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class Rec:
    """Accumulates the raw record and writes it after every step (R-RAW: the
    raw evidence exists on disk before any interpretation)."""

    def __init__(self, out_dir: pathlib.Path, base: str):
        self.out_dir = out_dir
        self.path = out_dir / "run.json"
        self.data: dict = {
            "tool": "notebook_wh_writing_help_prod_check",
            "clause": "12a — writing help with provenance",
            "base": base,
            "started_utc": _now(),
            "steps": [],
            "verdict": None,
            "reason": None,
        }
        self.dump()

    def dump(self):
        self.out_dir.mkdir(parents=True, exist_ok=True)
        with open(self.path, "w", encoding="utf-8", newline="\n") as fh:
            json.dump(self.data, fh, indent=2, ensure_ascii=False)

    def step(self, name: str, **facts):
        row = {"at": _now(), "name": name, **facts}
        self.data["steps"].append(row)
        self.dump()
        print(f"  [{name}] " + ", ".join(f"{k}={v!r}" for k, v in facts.items() if k != "screenshot"))
        return row

    def finish(self, verdict: str, reason: str | None = None):
        self.data["verdict"] = verdict
        self.data["reason"] = reason
        self.data["finished_utc"] = _now()
        self.dump()


def shot(page, out_dir: pathlib.Path, name: str) -> str:
    fn = f"{name}.png"
    try:
        page.screenshot(path=str(out_dir / fn), full_page=False)
        return fn
    except Exception as e:  # noqa: BLE001
        return f"(screenshot failed: {type(e).__name__}: {e})"


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--base", default=PROD, help="target origin (default: production)")
    ap.add_argument("--out", required=True, help="evidence directory (created if absent)")
    args = ap.parse_args(argv)

    base = args.base.rstrip("/")
    out_dir = pathlib.Path(args.out)
    rec = Rec(out_dir, base)

    try:
        from playwright.sync_api import sync_playwright
    except Exception as e:  # noqa: BLE001
        rec.step("playwright_import", ok=False, error=f"{type(e).__name__}: {e}")
        rec.finish("INCONCLUSIVE", "playwright unavailable")
        return 2

    email = os.environ.get("BENCH_EMAIL")
    pw = os.environ.get("BENCH_PASSWORD")
    if not email or not pw:
        rec.step("credentials", ok=False, error="BENCH_EMAIL / BENCH_PASSWORD not set")
        rec.finish("INCONCLUSIVE", "no bench credentials in environment")
        return 2

    note_id = None
    with sync_playwright() as pw_:
        browser = pw_.chromium.launch(headless=True)
        ctx = browser.new_context(viewport={"width": 1280, "height": 900})
        exit_code = 1
        try:
            # ── 1. sign in as bench@, through the product's own login door ──
            resp = ctx.request.post(
                f"{base}/api/auth/login",
                data=json.dumps({"email": email, "password": pw}),
                headers={"Content-Type": "application/json"},
            )
            if not resp.ok:
                rec.step("login", ok=False, http_status=resp.status)
                rec.finish("FAILED", f"login HTTP {resp.status}")
                return 1
            rec.step("login", ok=True, http_status=resp.status)

            # ── 2. ACCOUNT CHECK — before acting, assert exactly who this is ──
            me_resp = ctx.request.get(f"{base}/api/auth/me")
            me = me_resp.json() if me_resp.ok else {}
            me_user = me.get("user") or {}
            me_email = str(me_user.get("email") or "")
            local_part, _, domain = me_email.partition("@")
            account_ok = (
                me_resp.ok
                and domain == BENCH_DOMAIN
                and local_part == BENCH_LOCAL_PART
            )
            rec.step(
                "account_check",
                ok=account_ok, http_status=me_resp.status, email=me_email,
                domain=domain, role=me_user.get("role"), paid_equiv=me.get("paid_equiv"),
            )
            if not account_ok:
                rec.finish("FAILED", f"account check failed: signed in as {me_email!r}, expected bench@{BENCH_DOMAIN}")
                return 1

            page = ctx.new_page()
            page.on("pageerror", lambda e: rec.step("pageerror", text=str(e)[:300]))

            # ── 3. create the note through the product's own API ──
            run_tag = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
            title = f"{NOTE_TITLE_PREFIX} {run_tag}"
            create_resp = ctx.request.post(
                f"{base}/api/j2/notes",
                data=json.dumps({
                    "title": title,
                    "bodyJson": {"type": "doc", "content": [
                        {"type": "paragraph", "content": [{"type": "text", "text": NOTE_TEXT}]},
                    ]},
                }),
                headers={"Content-Type": "application/json"},
            )
            if not create_resp.ok:
                rec.step("create_note", ok=False, http_status=create_resp.status)
                rec.finish("FAILED", f"create note HTTP {create_resp.status}")
                return 1
            note_id = create_resp.json()["note"]["id"]
            rec.step("create_note", ok=True, note_id=note_id, title=title)

            # ── 4. open it in the real editor ──
            page.goto(f"{base}/journal/notebook?note={note_id}", wait_until="domcontentloaded", timeout=45000)
            page.wait_for_selector(".ProseMirror", timeout=30000)
            page.wait_for_timeout(800)
            s1 = shot(page, out_dir, "01-note-open")
            rec.step("note_open", ok=True, screenshot=s1)

            # ── 5. open Writing help ──
            wh_btn = page.get_by_role("button", name="Writing help")
            wh_btn.wait_for(state="visible", timeout=15000)
            wh_btn.click()
            dialog = page.get_by_role("dialog", name="Writing help")
            dialog.wait_for(state="visible", timeout=10000)
            s2 = shot(page, out_dir, "02-panel-open")
            rec.step("panel_open", ok=True, screenshot=s2)

            # ── 6. ask for one action ──
            choice_btn = dialog.get_by_role("button", name=CHOICE_LABEL, exact=True)
            choice_btn.wait_for(state="visible", timeout=10000)
            choice_btn.click()
            write_btn = dialog.get_by_role("button", name="Write it", exact=True)
            write_btn.wait_for(state="visible", timeout=10000)
            rec.step("action_requested", ok=True, choice=CHOICE_LABEL)
            write_btn.click()

            # ── 7. wait for the real model call to land (ready) or refuse (error) ──
            accept_btn = dialog.get_by_role("button", name="Accept", exact=True)
            error_el = dialog.locator('[role="alert"]')
            deadline = time.time() + 90
            outcome = None
            while time.time() < deadline:
                if accept_btn.count() and accept_btn.is_visible():
                    outcome = "ready"
                    break
                if error_el.count() and error_el.is_visible():
                    outcome = "error"
                    break
                page.wait_for_timeout(500)
            s3 = shot(page, out_dir, "03-draft-result")
            if outcome == "error":
                error_text = error_el.inner_text()
                rec.step("draft_result", ok=False, outcome="error", error_text=error_text, screenshot=s3)
                rec.finish("FAILED", f"product refused: {error_text}")
                return 1
            if outcome != "ready":
                rec.step("draft_result", ok=False, outcome="timeout", screenshot=s3)
                rec.finish("INCONCLUSIVE", "no ready/error state within 90s")
                return 2

            # ── 8. record the OUTPUT and its PROVENANCE, from the panel's own DOM ──
            preview = dialog.locator('[role="region"][aria-label="Draft preview"]')
            output_text = preview.inner_text().strip()
            fine_print = dialog.locator("p", has_text="Nothing is added to your note").inner_text()
            dialog_html = dialog.inner_html()
            rec.step(
                "output_observed", ok=True,
                output_chars=len(output_text),
                output_excerpt=output_text[:200],
                provenance_fine_print=fine_print,
                screenshot=s3,
            )
            (out_dir / "panel-output.txt").write_text(output_text, encoding="utf-8", newline="\n")
            (out_dir / "panel-dom.html").write_text(dialog_html, encoding="utf-8", newline="\n")

            # ── 9. confirm the insert door: Accept only inserts on click ──
            before_html = page.locator(".ProseMirror").inner_html()
            ask_inserts_before = page.locator('[data-type="ask-insert"]').count()
            accept_btn.click()
            dialog.wait_for(state="hidden", timeout=15000)
            page.wait_for_timeout(800)
            after_html = page.locator(".ProseMirror").inner_html()
            landed = before_html != after_html
            rec.step(
                "accept_clicked", ok=True,
                document_changed_by_accept=landed,
                ask_inserts_before=ask_inserts_before,
            )
            if not landed:
                rec.finish("FAILED", "Accept produced no document change")
                return 1

            ask_block = page.locator('[data-type="ask-insert"]').last
            ask_block.wait_for(state="visible", timeout=10000)
            block_text = ask_block.inner_text()
            block_aria_label = ask_block.get_attribute("aria-label")
            block_html = ask_block.inner_html()
            s4 = shot(page, out_dir, "04-accepted")
            rec.step(
                "insert_confirmed", ok=True,
                block_aria_label=block_aria_label,
                block_text_excerpt=block_text[:300],
                screenshot=s4,
            )
            (out_dir / "inserted-block.html").write_text(block_html, encoding="utf-8", newline="\n")
            provenance = {
                "output_excerpt": output_text[:400],
                "fine_print": fine_print,
                "block_aria_label": block_aria_label,
                "block_text": block_text,
                "choice_requested": CHOICE_LABEL,
            }
            with open(out_dir / "provenance-dom.json", "w", encoding="utf-8", newline="\n") as fh:
                json.dump(provenance, fh, indent=2, ensure_ascii=False)

            # ── 10. cleanup: trash the note through the product's own Delete ──
            more_btn = page.get_by_role("button", name="More note actions")
            more_btn.wait_for(state="visible", timeout=10000)
            more_btn.click()
            delete_btn = page.get_by_role("button", name="Delete", exact=True)
            delete_btn.wait_for(state="visible", timeout=10000)
            delete_btn.click()
            confirm_dialog = page.get_by_role("dialog", name="Delete this note?")
            confirm_dialog.wait_for(state="visible", timeout=10000)
            confirm_btn = confirm_dialog.get_by_role("button", name="Delete", exact=True)
            confirm_btn.wait_for(state="visible", timeout=10000)
            confirm_btn.click()
            page.wait_for_timeout(1500)
            s5 = shot(page, out_dir, "05-after-delete")
            rec.step("delete_clicked", ok=True, screenshot=s5)

            # ── 11. confirm gone from the live list, present only in trash ──
            q = urllib.parse.quote(title)
            live_resp = ctx.request.get(f"{base}/api/j2/notes?q={q}&deleted=false&limit=50")
            live_ids = [n["id"] for n in live_resp.json().get("notes", [])] if live_resp.ok else None
            trash_resp = ctx.request.get(f"{base}/api/j2/notes?q={q}&deleted=true&limit=50")
            trash_ids = [n["id"] for n in trash_resp.json().get("notes", [])] if trash_resp.ok else None
            gone_from_list = live_ids is not None and note_id not in live_ids
            in_trash = trash_ids is not None and note_id in trash_ids
            rec.step(
                "cleanup_confirmed",
                ok=gone_from_list and in_trash,
                gone_from_live_list=gone_from_list, in_trash=in_trash,
                live_http_status=live_resp.status, trash_http_status=trash_resp.status,
            )
            if not (gone_from_list and in_trash):
                rec.finish("FAILED", "cleanup could not be confirmed by API read-back")
                return 1

            page.close()
            ctx.close()
            browser.close()
            rec.finish("PASS")
            exit_code = 0
            return 0
        finally:
            if exit_code != 0 and note_id and ctx is not None:
                # Best-effort: if anything above failed after the note was created,
                # still try to leave no state, through the same product DELETE.
                try:
                    ctx.request.delete(f"{base}/api/j2/notes/{note_id}")
                    rec.step("best_effort_cleanup", ok=True, note_id=note_id)
                except Exception as e:  # noqa: BLE001
                    rec.step("best_effort_cleanup", ok=False, error=f"{type(e).__name__}: {e}")
            try:
                if ctx is not None:
                    ctx.close()
            except Exception:  # noqa: BLE001
                pass
            try:
                if browser is not None:
                    browser.close()
            except Exception:  # noqa: BLE001
                pass


if __name__ == "__main__":
    raise SystemExit(main())
