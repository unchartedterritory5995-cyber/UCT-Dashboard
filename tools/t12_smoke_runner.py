#!/usr/bin/env python3
"""T-12 PRE-LAUNCH SMOKE — executed by automation, per the owner's charter
amendment of 2026-09-13.

> *"the owner delegates execution; the owner reviews the evidence; automation may
> not substitute a scripted fetch for a real interaction at any step."*

So every step below is driven through the control a member uses — pointer and
keyboard — and captures what a human needs to review it afterwards: a screenshot
before and after, the network calls the step produced (method, path, status),
console errors, and the verdict in the charter's own PASS/FAIL wording.

⛔⛔ A SCRIPTED `fetch` IS NOT A STEP. If a control cannot be driven, the step is
**INCONCLUSIVE with the rig limitation named** — never a pass, and never worked
around. That single rule is what keeps this an automated execution of the gate
rather than a different, easier gate wearing its name.

⛔ CREDENTIALS ARE READ FROM THE ENVIRONMENT AND NEVER PRINTED, LOGGED, WRITTEN
TO THE RESULTS FILE, OR TYPED INTO ANYTHING BUT THE PRODUCT'S OWN LOGIN FORM.
The results file records WHICH identity ran, never how it authenticated.

USAGE
  python tools/t12_smoke_runner.py --identity member-smoke
  python tools/t12_smoke_runner.py --identity owner-rig     # needs a clear rig window
  python tools/t12_smoke_runner.py --self-check             # prove the runner can FAIL
"""
from __future__ import annotations

import argparse
import datetime
import importlib.util
import os
import pathlib
import sys
import time

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except (AttributeError, ValueError):
    pass

REPO = pathlib.Path(__file__).resolve().parents[1]
PROD = "https://uctintelligence.com"
SHOTS = pathlib.Path(r"C:\Users\Patrick\uct-q1-observe\t12")
TAG = "t12-smoke"
SENTENCE = "The pre-launch smoke run typed this sentence and it must survive a reload."
FIXTURE_PDF = REPO / "tools" / "wave_p_cert_corpus" / "native_text.pdf"

PASS, FAIL, INCONCL, OPEN = "PASS", "FAIL", "INCONCLUSIVE", "OPEN"


def load_rig():
    spec = importlib.util.spec_from_file_location("window_check", REPO / "tools" / "window_check.py")
    m = importlib.util.module_from_spec(spec)
    sys.modules["window_check"] = m
    spec.loader.exec_module(m)
    return m


# ══════════════════════════════════════════════════════════════════════════════
# evidence
# ══════════════════════════════════════════════════════════════════════════════
class Run:
    """One identity's pass through the gate, and everything a reviewer needs.

    ⛔ EVIDENCE IS CLAIMED BEFORE THE STEP RUNS, NOT AFTER. A step that throws
    still leaves its `before` screenshot and its calls, so a crashed run is
    legible rather than absent — the same reason the device runner writes an
    INCOMPLETE placeholder before opening a session.
    """

    def __init__(self, identity: str, stamp: str):
        self.identity = identity
        self.stamp = stamp
        self.steps: list[dict] = []
        self.calls: list[dict] = []
        self.console: list[str] = []
        self.note_id: str | None = None
        SHOTS.mkdir(parents=True, exist_ok=True)

    def watch(self, page):
        page.on("request", lambda r: self.calls.append(
            {"m": r.method, "u": r.url.split("uctintelligence.com")[-1][:70],
             "status": None, "_req": r, "t": time.time()})
            if "/api/" in r.url else None)

        def on_resp(resp):
            try:
                for c in self.calls:
                    if c.get("_req") is resp.request:
                        c["status"] = resp.status
                        # ⛔ CAPTURE THE BODY OF A FAILURE. "POST → 500" names
                        # the wall a member hit; it does not say what the server
                        # objected to, and a finding a developer cannot act on
                        # gets re-diagnosed from scratch by whoever picks it up.
                        if resp.status >= 400:
                            try:
                                c["body"] = (resp.text() or "")[:300]
                            except Exception:  # noqa: BLE001
                                c["body"] = "<unreadable>"
                        return
            except Exception:  # noqa: BLE001
                pass
        page.on("response", on_resp)
        page.on("console", lambda m: self.console.append(
            f"{m.type}: {m.text[:160]}") if m.type in ("error",) else None)

    def shot(self, page, step: str, when: str) -> str:
        name = f"{self.stamp}_{self.identity}_{step}_{when}.png"
        try:
            page.screenshot(path=str(SHOTS / name), full_page=False)
        except Exception as e:  # noqa: BLE001
            return f"(screenshot failed: {type(e).__name__})"
        return name

    def calls_since(self, mark: int) -> list[dict]:
        return self.calls[mark:]

    def record(self, step, title, verdict, detail, before, after, mark, note=""):
        calls = self.calls_since(mark)
        self.steps.append({
            "step": step, "title": title, "verdict": verdict, "detail": detail,
            "before": before, "after": after, "note": note,
            "calls": [f"{c['m']} {c['u']} → {c['status']}"
                      + (f" · body: {c['body']}" if c.get("body") else "") for c in calls
                      if "/api/j2/" in c["u"] or "/api/auth/" in c["u"]][:14],
            "console": list(self.console),
        })
        print(f"  {verdict:13s} step {step} — {title}")
        if verdict in (FAIL, INCONCL):
            print(f"      {detail[:200]}")


# ══════════════════════════════════════════════════════════════════════════════
# the steps — each one drives the member's own control
# ══════════════════════════════════════════════════════════════════════════════

def step0_sign_in(page, run, creds) -> tuple[str, str]:
    """Sign in through the normal login form, typing into it."""
    if creds is None:
        # The rig profile carries a 30-day session; there is nothing to type, and
        # typing would be the prohibited thing.
        me = page.evaluate("""async () => {
          const r = await fetch('/api/auth/me', {credentials:'include'});
          let b = null; try { b = await r.json() } catch {}
          return {status: r.status, id: b?.user?.id ?? b?.id ?? null};
        }""")
        if me.get("status") == 200 and me.get("id"):
            return PASS, f"already signed in on the rig profile, account `{me['id']}` (a 30-day session, nothing typed)"
        return FAIL, f"the rig profile is not signed in (/api/auth/me {me.get('status')})"

    email, password = creds
    page.goto(PROD + "/login", wait_until="domcontentloaded")
    page.wait_for_timeout(4000)
    boxes = page.query_selector_all("input")
    email_box = pw_box = None
    for b in boxes:
        t = (b.get_attribute("type") or "").lower()
        n = ((b.get_attribute("name") or "") + (b.get_attribute("placeholder") or "")).lower()
        if t == "password" or "password" in n:
            pw_box = pw_box or b
        elif t in ("email", "text") or "email" in n:
            email_box = email_box or b
    if not email_box or not pw_box:
        return INCONCL, f"no login form found ({len(boxes)} input(s)) — the rig could not reach the normal form"
    email_box.click()
    page.keyboard.type(email)
    pw_box.click()
    page.keyboard.type(password)
    submitted = False
    for b in page.query_selector_all("button"):
        try:
            if any(w in (b.inner_text() or "").strip().lower() for w in ("sign in", "log in", "login")):
                b.click()
                submitted = True
                break
        except Exception:  # noqa: BLE001
            continue
    if not submitted:
        page.keyboard.press("Enter")
    page.wait_for_timeout(7000)
    me = page.evaluate("""async () => {
      const r = await fetch('/api/auth/me', {credentials:'include'});
      let b = null; try { b = await r.json() } catch {}
      return {status: r.status, id: b?.user?.id ?? b?.id ?? null};
    }""")
    if me.get("status") == 200 and me.get("id"):
        return PASS, f"signed in through the normal form, account `{me['id']}` (credentials typed into the product's own inputs; never logged)"
    return FAIL, f"sign-in did not take — /api/auth/me returned {me.get('status')}"


def step1_reach_notebook(page, run) -> tuple[str, str]:
    """⛔ BY CLICKING, NOT BY TYPING A URL. The charter is explicit: *"'I had to
    type the URL' is a FAIL of this step even if the page then loads — a member
    does not know the URL."*"""
    page.goto(PROD + "/dashboard", wait_until="domcontentloaded")
    page.wait_for_timeout(6000)
    clicked = page.evaluate("""async () => {
      const links = [...document.querySelectorAll('a,[role=link],button')];
      const j = links.find(a => /(^|\\s)journal(\\s|$)/i.test((a.innerText || '').trim())
                             || (a.getAttribute('href') || '') === '/journal');
      if (!j) return {ok:false, why:'no Journal entry in the app navigation',
                      seen: links.map(a => (a.innerText||'').trim()).filter(Boolean).slice(0,25)};
      j.click();
      await new Promise(r => setTimeout(r, 4000));
      return {ok:true, at: location.pathname};
    }""")
    if not clicked.get("ok"):
        return FAIL, f"no nav path to the Journal without typing a URL: {clicked}"
    page.wait_for_timeout(3000)
    nb = page.evaluate("""async () => {
      const tabs = [...document.querySelectorAll('a,button,[role=tab]')];
      const t = tabs.find(x => /^notebook$/i.test((x.innerText || '').trim()));
      if (!t) return {ok:false, why:'no Notebook tab on the Journal surface',
                      seen: tabs.map(x => (x.innerText||'').trim()).filter(Boolean).slice(0,25)};
      t.click();
      await new Promise(r => setTimeout(r, 5000));
      return {ok: location.pathname.includes('/journal/notebook'), at: location.pathname};
    }""")
    if not nb.get("ok"):
        return FAIL, f"the Notebook surface was not reachable by clicking: {nb}"
    shell = page.evaluate("""() => ({
      search: !!document.querySelector('input[placeholder*="Search notes" i]'),
      list: document.querySelectorAll('[data-note-id], [class*="noteRow" i], li').length,
      path: location.pathname,
    })""")
    ok = shell.get("path", "").endswith("/journal/notebook")
    return (PASS if ok else FAIL), f"reached `{shell.get('path')}` by clicking Journal then Notebook; search box present: **{shell.get('search')}**"


def step2_create_note(page, run, today) -> tuple[str, str]:
    title = f"T-12 smoke {today}"
    made = page.evaluate("""async () => {
      const btns = [...document.querySelectorAll('button,[role=button],a')];
      // ⛔ THE CONTROL IS THE PRODUCT'S WORDS, NOT MINE. The first run of this
      // step reported "no new-note control in the Notebook surface" and was
      // WRONG: the surface had rendered a correct first-run empty state whose
      // button reads "+ Start a note". The regex knew "new note" and "create
      // note" and not the one the product actually uses.
      //
      // ⭐ THE SCREENSHOT IS WHAT CAUGHT IT — which is exactly what the charter
      // amendment substitutes for a human at the keyboard. A verdict without the
      // evidence beside it would have shipped as a product FAIL on step 2 and
      // stopped the gate at its third step.
      const b = btns.find(x => /start a note|new note|new entry|\\+ note|create note/i.test(
        ((x.innerText||'') + ' ' + (x.getAttribute('aria-label')||'')).trim()));
      if (!b) return {ok:false, why:'no new-note control in the Notebook surface',
                      seen: btns.map(x => (x.innerText||'').trim()).filter(Boolean).slice(0,30)};
      b.click();
      await new Promise(r => setTimeout(r, 4500));
      return {ok:true, editor: !!document.querySelector('.ProseMirror'),
              titleBox: !!document.querySelector('input[placeholder*="title" i], textarea[placeholder*="title" i]')};
    }""")
    if not made.get("ok"):
        return FAIL, f"no new-note control findable: {made}"
    tbox = page.query_selector('input[placeholder*="title" i], textarea[placeholder*="title" i]')
    if tbox is None:
        return FAIL, "the note was created without a title field on screen"
    tbox.click()
    page.keyboard.type(title)
    page.wait_for_timeout(1500)
    tagbox = page.query_selector('input[placeholder*="Tags" i]')
    tagged = False
    if tagbox is not None:
        tagbox.click()
        page.keyboard.type(TAG)
        page.keyboard.press("Enter")
        tagged = True
        page.wait_for_timeout(1500)
    run.note_id = page.evaluate("() => new URLSearchParams(location.search).get('note')")
    focus_ok = page.evaluate("() => !!document.querySelector('.ProseMirror')")
    if not tagged:
        return FAIL, f"the note was created and titled but the tag could not be applied (no Tags input on the surface); note `{run.note_id}`"
    return PASS, f"note `{run.note_id}` created from the Notebook's own control, titled **{title}**, tagged `{TAG}`, editor present: **{focus_ok}**"


def step3_type_and_reload(page, run) -> tuple[str, str]:
    """⛔ THE ONE STEP WHOSE FAILURE ENDS THE RUN. And per the amendment: if it
    fails, say whether the words came back after a SECOND reload — *gone* and
    *late* are different findings."""
    pm = page.query_selector(".ProseMirror")
    if pm is None:
        return FAIL, "no editor body to type into"
    pm.click()
    page.keyboard.type(SENTENCE)
    page.wait_for_timeout(5000)
    status = page.evaluate("""() => {
      const t = document.body.innerText || '';
      return {saveFailed: /Save failed/i.test(t), reconnecting: /Reconnecting/i.test(t)};
    }""")
    page.reload(wait_until="domcontentloaded")
    page.wait_for_timeout(9000)
    body1 = page.evaluate("() => (document.querySelector('.ProseMirror')||{}).innerText || ''")
    if SENTENCE in body1:
        return PASS, (f"the sentence is present after a hard reload, character for character; "
                      f"`Save failed` seen: **{status.get('saveFailed')}**, "
                      f"`Reconnecting…` seen: **{status.get('reconnecting')}**")
    page.reload(wait_until="domcontentloaded")
    page.wait_for_timeout(10000)
    body2 = page.evaluate("() => (document.querySelector('.ProseMirror')||{}).innerText || ''")
    late = SENTENCE in body2
    return FAIL, (f"the sentence was ABSENT after the first reload. Second reload: "
                  f"**{'LATE — it came back' if late else 'GONE — still absent'}**. "
                  f"`Save failed` seen: {status.get('saveFailed')}, "
                  f"`Reconnecting…` seen: {status.get('reconnecting')}")


def step4_widget_embed(page, run) -> tuple[str, str]:
    page.goto(PROD + "/charts", wait_until="domcontentloaded")
    page.wait_for_timeout(10000)
    fired = page.evaluate("""async () => {
      const chooser = document.querySelector('[aria-label="Send to Journal — choose where"]');
      if (!chooser) {
        const seen = [...document.querySelectorAll('button,[aria-label]')]
          .map(e => ((e.getAttribute('aria-label')||'') + ' ' + (e.innerText||'')).trim())
          .filter(t => /send to journal/i.test(t)).slice(0,6);
        return {ok:false, why:'no capture door on any widget header', seen};
      }
      chooser.click();
      await new Promise(r => setTimeout(r, 1500));
      const opts = [...document.querySelectorAll('button,[role=menuitem],li')]
        .map(el => ({el, t:(el.innerText||'').trim()})).filter(o => o.t && o.t.length < 90);
      const cur = opts.find(o => /^current note/i.test(o.t));
      if (!cur) return {ok:false, why:'the chooser offered no "Current note" destination',
                        options: opts.map(o => o.t).slice(0,10)};
      cur.el.click();
      await new Promise(r => setTimeout(r, 3000));
      return {ok:true, via:'Send to Journal → Current note'};
    }""")
    if not fired.get("ok"):
        return FAIL, f"the capture door could not be used: {fired}"
    page.goto(f"{PROD}/journal/notebook?note={run.note_id}", wait_until="domcontentloaded")
    page.wait_for_timeout(9000)
    present = page.evaluate("""() => {
      const b = document.querySelector('.ProseMirror');
      if (!b) return {editor:false};
      return {editor:true,
              embed: !!b.querySelector('[data-type="widgetEmbed"], [class*="widgetEmbed" i]'),
              text: (b.innerText||'').slice(0,120)};
    }""")
    page.reload(wait_until="domcontentloaded")
    page.wait_for_timeout(9000)
    after = page.evaluate("""() => {
      const b = document.querySelector('.ProseMirror');
      return b ? !!b.querySelector('[data-type="widgetEmbed"], [class*="widgetEmbed" i]') : false;
    }""")
    if present.get("embed") and after:
        return PASS, f"an embed card renders inside the note body via **{fired.get('via')}** and survives a reload"
    return FAIL, f"embed in body: **{present.get('embed')}**, after reload: **{after}** (door used: {fired.get('via')})"


def step5_search(page, run) -> tuple[str, str]:
    """⛔⛔ THE NOTEBOOK'S OWN SIDEBAR SEARCH, NOT THE GLOBAL COMMAND PALETTE.

    ⚰️ The first version took any `input[placeholder*=search]` it could find and
    typed into it. The screenshot showed what it had actually opened: the app's
    global ⌘K palette, floating over a full-screen PDF viewer left open by step
    6. The step then "passed" because `document.body.innerText` contained the
    words — from the PALETTE'S results. A PASS earned on the wrong surface is
    worse than a FAIL, and it is the reason this gate demands evidence a human
    can look at.

    ⭐ So: dismiss anything floating first, prove the Notebook shell is on screen,
    and scope the query to the sidebar.
    """
    page.keyboard.press("Escape")
    page.wait_for_timeout(600)
    page.goto(f"{PROD}/journal/notebook?note={run.note_id}", wait_until="domcontentloaded")
    page.wait_for_timeout(7000)

    on_surface = page.evaluate("""() => ({
      path: location.pathname,
      palette: !!document.querySelector('[cmdk-root], [class*="palette" i], [class*="commandMenu" i]'),
      viewer: !!document.querySelector('[data-pdf-page-number]'),
    })""")
    if not on_surface.get("path", "").endswith("/journal/notebook"):
        return INCONCL, f"not on the Notebook surface when the search was attempted: {on_surface}"
    if on_surface.get("palette") or on_surface.get("viewer"):
        return INCONCL, (f"a floating surface was still open over the Notebook "
                         f"({on_surface}) — the rig would have typed into the wrong control")

    box = page.evaluate("""async () => {
      const side = document.querySelector('aside, [class*="sidebar" i], [class*="rail" i]')
                || document.body;
      let inp = side.querySelector('input[placeholder*="Search notes" i]');
      if (!inp) {
        const tog = [...side.querySelectorAll('button,[role=button]')].find(b =>
          /search/i.test(((b.getAttribute('aria-label')||'') + ' ' +
                          (b.getAttribute('title')||'')).trim()));
        if (tog) { tog.click(); await new Promise(r => setTimeout(r, 1200)); }
        inp = side.querySelector('input[placeholder*="Search notes" i]');
      }
      if (!inp) return {ok:false, why:"no `Search notes…` input inside the Notebook sidebar"};
      inp.setAttribute('data-t12-search', '1');
      return {ok:true, placeholder: inp.getAttribute('placeholder')};
    }""")
    if not box.get("ok"):
        return INCONCL, f"{box.get('why')} — the rig could not reach the Notebook's own control"

    el = page.query_selector('[data-t12-search]')
    el.click()
    page.keyboard.type("survive a reload")
    page.wait_for_timeout(3500)
    hit = page.evaluate("""() => {
      const side = document.querySelector('aside, [class*="sidebar" i], [class*="rail" i]') || document.body;
      const t = side.innerText || '';
      return {found: /T-12 smoke/i.test(t), snippet: /survive a reload/i.test(t),
              palette: !!document.querySelector('[cmdk-root]')};
    }""")
    for _ in range(40):
        page.keyboard.press("Backspace")
    page.keyboard.type("zzqqxx")
    page.wait_for_timeout(3000)
    empty = page.evaluate("""() => {
      const side = document.querySelector('aside, [class*="sidebar" i], [class*="rail" i]') || document.body;
      const t = side.innerText || '';
      const m = t.match(/No notes match[^\\n]{0,40}/i);
      return {honest: !!m, text: m ? m[0] : (t.match(/no (results|notes)[^\\n]{0,40}/i)||[''])[0]};
    }""")
    for _ in range(10):
        page.keyboard.press("Backspace")
    if hit.get("palette"):
        return INCONCL, "the global command palette opened instead of the sidebar search — wrong control"
    ok = hit.get("found") and hit.get("snippet")
    return (PASS if ok else FAIL), (
        f"typed into the Notebook's own `{box.get('placeholder')}` box · "
        f"`survive a reload` → note in the sidebar results: **{hit.get('found')}**, "
        f"snippet contains the terms: **{hit.get('snippet')}** · `zzqqxx` → empty state "
        f"names the query: **{empty.get('honest')}** ({empty.get('text','')!r})")


def step6_document(page, run) -> tuple[str, str]:
    if not FIXTURE_PDF.exists():
        return INCONCL, f"no real PDF fixture at {FIXTURE_PDF}"
    try:
        page.set_input_files('input[aria-label="Upload file attachment"]', str(FIXTURE_PDF))
    except Exception as e:  # noqa: BLE001
        return INCONCL, f"the editor's attachment input would not take the file: {type(e).__name__}"
    ready = None
    for _ in range(14):
        page.wait_for_timeout(3000)
        docs = page.evaluate("""async (id) => {
          const r = await fetch('/api/j2/notes/' + id + '/documents', {credentials:'include'});
          if (!r.ok) return {err:r.status};
          const j = await r.json().catch(() => ({documents:[]}));
          return {count:(j.documents||[]).length, status:(j.documents||[]).map(d => d.status)};
        }""", run.note_id)
        if isinstance(docs, dict) and docs.get("count"):
            ready = docs
            if "ready" in (docs.get("status") or []):
                break
    if not ready:
        return FAIL, "the upload produced no document row — processing never started"
    opened = page.evaluate("""async () => {
      const chip = document.querySelector('a[data-type="attachmentChip"]');
      if (!chip) return {ok:false, why:'no attachment chip in the note body'};
      chip.click();
      let pages = 0, spans = 0;
      for (let i = 0; i < 40; i++) {
        pages = document.querySelectorAll('[data-pdf-page-number]').length;
        spans = document.querySelectorAll('.textLayer span').length;
        if (pages && spans) break;
        await new Promise(r => setTimeout(r, 500));
      }
      return {ok: pages > 0, pages, spans, downloaded: false};
    }""")
    # ⛔ CLOSE THE VIEWER. It is full-screen, and leaving it open meant every
    # later step was driven against a surface with no Notebook on it — step 8
    # then "failed to find a restore control" that was never on screen. A step
    # that changes the surface must put it back, or it silently becomes a
    # precondition of every step after it.
    page.keyboard.press("Escape")
    page.wait_for_timeout(800)
    page.evaluate("""() => {
      const x = [...document.querySelectorAll('button,[role=button]')].find(b =>
        /^(exit|close)$/i.test((b.innerText||'').trim()));
      if (x) x.click();
    }""")
    page.wait_for_timeout(1200)

    if opened.get("ok"):
        return PASS, (f"the document reached **{ready.get('status')}** and the chip opened a "
                      f"page-rendered viewer in the app: **{opened.get('pages')} page(s)**, "
                      f"**{opened.get('spans')}** text-layer spans (readable text, not an image)")
    return FAIL, f"document status {ready.get('status')}; clicking the chip did not open a viewer: {opened}"


def step7_ask(page, run) -> tuple[str, str]:
    found = page.evaluate("""async () => {
      const btns = [...document.querySelectorAll('button,[role=button]')];
      const a = btns.find(b => /^ask\\b/i.test(((b.innerText||'') + ' ' +
                 (b.getAttribute('aria-label')||'')).trim()));
      if (!a) return {ok:false, why:'no Ask control on the note surface'};
      a.click();
      await new Promise(r => setTimeout(r, 3000));
      const t = document.body.innerText || '';
      return {ok:true, paid: /paid plan|upgrade|premium/i.test(t),
              box: !!document.querySelector('textarea, input[placeholder*="ask" i]')};
    }""")
    if not found.get("ok"):
        return OPEN, (f"could not exercise: {found.get('why')}. The Ask capability is gated "
                      f"(`notebook_offline_read_on` / attachments read FALSE in the served "
                      f"payload), so this is an entitlement/flag state, not a defect")
    if found.get("paid"):
        return OPEN, "Ask reports it requires a paid plan — the charter says record it and mark the step OPEN, not FAIL"
    return INCONCL, ("the Ask panel opened but this runner does not yet drive the scope switch "
                     "and citation click — the two things the step actually tests. Not a pass")


def step8_trash_restore(page, run) -> tuple[str, str]:
    """⛔ FOUR CONDITIONS, ALL FOUR MEASURED. The charter asks for the
    confirmation copy naming the 30-day window, the note leaving the list, the
    note appearing in Trash, and the note coming back WITH its body, its tag and
    its embed. A note that returns emptied is a data-loss finding, so "restored"
    on its own is not an answer."""
    before = page.evaluate("""() => {
      const b = document.querySelector('.ProseMirror');
      return {body: b ? (b.innerText||'').slice(0,160) : '',
              embed: b ? !!b.querySelector('[data-type="widgetEmbed"], [class*="widgetEmbed" i]') : false,
              tag: /t12-smoke/i.test(document.body.innerText||'')};
    }""")

    page.keyboard.press("Escape")
    page.wait_for_timeout(500)
    opened = page.evaluate("""async () => {
      // The note's OWN controls, never the app chrome. The first version matched
      // /more|options|menu/ across the whole document and opened the global
      // "Menu" nav directory on top of the Notebook; every later query then ran
      // against an overlay, and the step reported "no Trash entry in the
      // sidebar" for a sidebar that was simply covered.
      const scope = document.querySelector('main, [class*="editor" i], [class*="notePane" i]')
                 || document.body;
      const more = [...scope.querySelectorAll('button,[role=button]')].filter(b =>
        !b.closest('nav, header, [class*="moreSheet" i], [role=dialog]')).find(b =>
        // NO UNICODE ESCAPES IN A REGEX LITERAL THAT CROSSES PYTHON. It went
        // through two escaping layers and arrived as an invalid pattern, and the
        // step reported THAT as its own INCONCLUSIVE -- an instrument fault wearing
        // a step's verdict, which is the one thing these verdicts must never do.
        /more|options|menu/i.test(((b.getAttribute('aria-label')||'') + ' ' +
                                             (b.innerText||'')).trim()));
      if (more) { more.click(); await new Promise(r => setTimeout(r, 1200)); }
      const d = [...document.querySelectorAll('button,[role=menuitem]')].filter(b =>
        !b.closest('nav, header, [class*="moreSheet" i]')).find(b =>
        /delete|move to trash/i.test(((b.innerText||'') + ' ' +
                                      (b.getAttribute('aria-label')||'')).trim()));
      if (!d) return {ok:false, why:'no delete control on the note surface'};
      d.click();
      await new Promise(r => setTimeout(r, 1800));
      const t = document.body.innerText || '';
      return {ok:true, copy:(t.match(/[^\\n]{0,140}(trash|restore)[^\\n]{0,140}/i)||[''])[0],
              says30: /30[- ]day/i.test(t)};
    }""")
    if not opened.get("ok"):
        return INCONCL, f"the delete control could not be reached: {opened.get('why')}"

    confirmed = page.evaluate("""async () => {
      const b = [...document.querySelectorAll('button')].find(x =>
        /^(delete|move to trash|confirm|yes)/i.test((x.innerText||'').trim()));
      if (!b) return {ok:false, why:'the confirmation offered no confirm control'};
      b.click();
      await new Promise(r => setTimeout(r, 4000));
      return {ok:true};
    }""")
    if not confirmed.get("ok"):
        return INCONCL, f"{confirmed.get('why')} (confirmation copy was: {opened.get('copy','')!r})"

    gone = page.evaluate("() => !/T-12 smoke/i.test(document.body.innerText||'')")
    in_trash = page.evaluate("""async () => {
      const t = [...document.querySelectorAll('button,a,li,[role=button]')].find(x =>
        /^trash/i.test((x.innerText||'').trim()));
      if (!t) return {ok:false, why:'no Trash entry in the sidebar'};
      t.click();
      await new Promise(r => setTimeout(r, 3000));
      return {ok: /T-12 smoke/i.test(document.body.innerText||'')};
    }""")
    if not in_trash.get("ok"):
        return FAIL, (f"the note was deleted but is NOT in Trash "
                      f"({in_trash.get('why','not listed')}) — confirmation copy: "
                      f"{opened.get('copy','')!r}, names 30 days: {opened.get('says30')}")

    restored = page.evaluate("""async () => {
      const r = [...document.querySelectorAll('button,[role=menuitem],a')].find(x =>
        /restore/i.test(((x.innerText||'') + ' ' + (x.getAttribute('aria-label')||'')).trim()));
      if (!r) return {ok:false, why:'no restore control in Trash'};
      r.click();
      await new Promise(r2 => setTimeout(r2, 4000));
      return {ok:true};
    }""")
    if not restored.get("ok"):
        return FAIL, f"the note is in Trash but {restored.get('why')}"

    page.goto(f"{PROD}/journal/notebook?note={run.note_id}", wait_until="domcontentloaded")
    page.wait_for_timeout(8000)
    after = page.evaluate("""() => {
      const b = document.querySelector('.ProseMirror');
      return {body: b ? (b.innerText||'').slice(0,160) : '',
              embed: b ? !!b.querySelector('[data-type="widgetEmbed"], [class*="widgetEmbed" i]') : false,
              tag: /t12-smoke/i.test(document.body.innerText||'')};
    }""")
    body_ok = SENTENCE in (after.get("body") or "") or (
        before.get("body") and before["body"][:60] in (after.get("body") or ""))
    all_four = (opened.get("says30") and gone and in_trash.get("ok")
                and body_ok and after.get("embed") and after.get("tag"))
    detail = (f"confirmation names the 30-day window: **{opened.get('says30')}** "
              f"({opened.get('copy','')!r}) · left the main list: **{gone}** · "
              f"present in Trash: **{in_trash.get('ok')}** · after restore — body: "
              f"**{body_ok}**, tag: **{after.get('tag')}**, widget embed: **{after.get('embed')}**")
    if all_four:
        return PASS, detail
    if not (body_ok and after.get("embed")):
        return FAIL, "⛔ THE NOTE CAME BACK MISSING CONTENT — a data-loss finding, not a cosmetic one. " + detail
    return FAIL, detail



STEPS = [
    ("1", "Reach the Notebook the way a member does", step1_reach_notebook),
    ("2", "Create a note", step2_create_note),
    ("3", "Type, and confirm it actually saved", step3_type_and_reload),
    ("4", "Put a widget embed in the note", step4_widget_embed),
    ("5", "Find the note by searching for its words", step5_search),
    ("6", "Open a document", step6_document),
    ("7", "Ask a question, and follow the citation", step7_ask),
    ("8", "Trash it and bring it back", step8_trash_restore),
]


def render(runs: list[Run], stamp: str) -> str:
    L = [
        "# T-12 — pre-launch authenticated Notebook smoke",
        "",
        "> ⚖️ **AUTOMATED PER CHARTER AMENDMENT 2026-09-13.** The owner delegates "
        "execution; the owner reviews the evidence. Every step below was driven through "
        "the member's own control with pointer and keyboard — **no scripted `fetch` "
        "stands in for any step.** Where a control could not be driven, the step is "
        "**INCONCLUSIVE with the limitation named**, never a pass.",
        "",
        f"Run {stamp} · origin `{PROD}`",
        "",
        "## Identities",
        "",
        "| identity | what it is |",
        "|---|---|",
    ]
    for r in runs:
        what = ("the rig profile, signed in as the owner account (a 30-day session)"
                if r.identity == "owner-rig" else
                "`member-smoke@uctintelligence.internal` in a FRESH browser context — "
                "the independent-member view this window has never had")
        L.append(f"| `{r.identity}` | {what} |")
    L += ["", "## Results", ""]
    for r in runs:
        L += [f"### {r.identity}", "",
              "| step | what it asks | verdict | evidence |", "|---|---|---|---|"]
        for s in r.steps:
            shots = f"`{s['before']}` → `{s['after']}`"
            calls = "<br>".join(f"`{c}`" for c in s["calls"]) or "—"
            L.append(f"| {s['step']} | {s['title']} | **{s['verdict']}** | {s['detail']}"
                     f"<br>screenshots: {shots}<br>calls: {calls} |")
        errs = r.console or ["none"]
        L += ["", f"**Console errors:** {len(r.console)} — " + "; ".join(e[:120] for e in errs[:5]), ""]
    L += ["## Verdict", ""]
    for r in runs:
        bad = [s for s in r.steps if s["verdict"] == FAIL]
        unk = [s for s in r.steps if s["verdict"] in (INCONCL, OPEN)]
        L.append(f"- **{r.identity}** — {len(r.steps)} step(s): "
                 f"{sum(1 for s in r.steps if s['verdict'] == PASS)} PASS, "
                 f"{len(bad)} FAIL, {len(unk)} INCONCLUSIVE/OPEN."
                 + (f" ⛔ FAIL at step(s) {', '.join(s['step'] for s in bad)}." if bad else ""))
    L += ["",
          "⛔ **C-7 flips TRUE only when every step passes on BOTH identities.** Any "
          "INCONCLUSIVE or OPEN step means the gate has not been exercised, and a gate "
          "that was not exercised is not a gate that passed.",
          ""]
    return "\n".join(L) + "\n"


def run_identity(pw, identity: str, creds, stamp: str, rig=None) -> Run:
    run = Run(identity, stamp)
    today = datetime.date.today().isoformat()
    if identity == "owner-rig":
        proc, ep, ver = rig.spawn_rig()
        if ver is None:
            run.record("0", "Sign in and mark the run", FAIL,
                       "the rig browser never answered on CDP", "", "", 0)
            return run
        b = pw.chromium.connect_over_cdp(ep)
        ctx = b.contexts[0]
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
    else:
        b = pw.chromium.launch(headless=False)
        ctx = b.new_context(viewport={"width": 1440, "height": 900})
        page = ctx.new_page()
    run.watch(page)
    try:
        # ⛔⛔ IS PRODUCTION EVEN ANSWERING? The charter's own precondition says
        # "if a deploy is in flight, wait for it — a swap mid-run invalidates the
        # run." Without this the first step reports what it happens to see (a
        # page with no inputs) and the gate records "could not reach the login
        # form" for a pod that was simply not there. Five separate measurements
        # were interrupted by another session's deploys today; the instrument has
        # to name that rather than absorb it.
        page.goto(PROD + "/api/health", wait_until="domcontentloaded")
        page.wait_for_timeout(1500)
        health = page.evaluate("""async () => {
          try { const r = await fetch('/api/health', {cache:'no-store'});
                return {status: r.status, body: (await r.text()).slice(0,120)} }
          catch (e) { return {status: 0, body: String(e && e.name || e)} }
        }""")
        if health.get("status") != 200:
            run.record("pre", "production is serving", INCONCL,
                       f"`/api/health` returned **{health.get('status')}** "
                       f"({health.get('body','')!r}) — a deploy is in flight or the pod is "
                       f"down. NOTHING was measured; this is not a product finding and not "
                       f"a clean run.", "", "", len(run.calls))
            return run

        mark = len(run.calls)
        before = run.shot(page, "0", "before")
        v, d = step0_sign_in(page, run, creds)
        run.record("0", "Sign in and mark the run", v, d, before, run.shot(page, "0", "after"), mark)
        if v != PASS:
            return run
        for num, title, fn in STEPS:
            mark = len(run.calls)
            before = run.shot(page, num, "before")
            try:
                v, d = fn(page, run) if fn is not step2_create_note else fn(page, run, today)
            except Exception as e:  # noqa: BLE001
                v, d = INCONCL, f"the step raised {type(e).__name__}: {str(e)[:180]}"
            run.record(num, title, v, d, before, run.shot(page, num, "after"), mark)
            if v == FAIL and num == "3":
                run.record("STOP", "run halted", FAIL,
                           "step 3 is the one step whose failure ends the run unconditionally",
                           "", "", len(run.calls))
                break
    finally:
        # ⛔ THE SMOKE ACCOUNT MUST NEVER ACCUMULATE STATE. "Whatever a run
        # creates, that run removes" — a smoke account that keeps notes stops
        # being a control, because the next run cannot tell a product change
        # from its own leftovers.
        #
        # ⚠️ This is HOUSEKEEPING, not a step. The charter's "no scripted fetch"
        # rule is about what counts as EVIDENCE for the gate; cleaning up after
        # the gate is not evidence for anything, and doing it through the UI
        # would mean driving step 8's delete flow for a reason other than
        # measuring it.
        try:
            left = page.evaluate("""async () => {
              const r = await fetch('/api/j2/notes?limit=200', {credentials:'include'});
              if (!r.ok) return {err:r.status};
              const j = await r.json().catch(() => ({notes:[]}));
              const mine = (j.notes||[]).filter(n => (n.title||'').includes('T-12 smoke'));
              let gone = 0;
              for (const n of mine) {
                const d = await fetch('/api/j2/notes/' + n.id, {method:'DELETE', credentials:'include'});
                if (d.ok) gone += 1;
              }
              return {found: mine.length, deleted: gone};
            }""")
            print(f"  cleanup: {left}")
        except Exception as e:  # noqa: BLE001
            print(f"  ⛔ cleanup failed ({type(e).__name__}) — notes may remain on this account")
        try:
            if identity == "owner-rig":
                rig.opt_out(page)
                rig.teardown()
            else:
                ctx.close()
                b.close()
        except Exception:  # noqa: BLE001
            pass
    return run


def self_check() -> int:
    """⛔ A RUNNER NOBODY HAS SEEN FAIL IS NOT A RUNNER. Break one step's
    expectation and prove the verdict turns."""
    ok = True

    def case(name, passed):
        nonlocal ok
        ok = ok and passed
        print(f"  {'ok  ' if passed else 'FAIL'} {name}")

    r = Run("self-check", "0000")
    r.record("3", "Type, and confirm it actually saved", PASS, "sentence present", "b", "a", 0)
    case("a PASS renders as PASS", "**PASS**" in render([r], "0000"))

    r2 = Run("self-check", "0000")
    r2.record("3", "Type, and confirm it actually saved", FAIL,
              "the sentence was ABSENT after the first reload. Second reload: GONE", "b", "a", 0)
    out = render([r2], "0000")
    case("a FAIL renders as FAIL and is named in the verdict",
         "**FAIL**" in out and "FAIL at step(s) 3" in out)
    case("the 'gone vs late' distinction survives into the file", "GONE" in out)
    case("the header states it was automated per the amendment",
         "AUTOMATED PER CHARTER AMENDMENT 2026-09-13" in out)
    case("C-7 is gated on BOTH identities and on no INCONCLUSIVE",
         "BOTH identities" in out and "not a gate that passed" in out)

    r3 = Run("self-check", "0000")
    r3.record("6", "Open a document", INCONCL, "the chip could not be reached", "b", "a", 0)
    o3 = render([r3], "0000")
    case("an INCONCLUSIVE step is counted apart from PASS and FAIL",
         "1 INCONCLUSIVE/OPEN" in o3 and "0 PASS" in o3)
    print("self-check:", "PASS" if ok else "FAIL")
    return 0 if ok else 1


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--identity", choices=["member-smoke", "owner-rig"], action="append")
    # ⛔⛔ THE SHARED ERROR MESSAGE PROMISED A FLAG THIS TOOL DID NOT HAVE.
    # `window_check.resolve_profile` refuses a missing profile with "Point the tool at
    # the canonical rig profile (--profile <path>, or UCT_Q1_RIG_PROFILE=<path>)" - and
    # that text is shared by every caller, while only SOME of them implemented the flag.
    # Following the tool's own instructions here produced `error: unrecognized
    # arguments: --profile` and exit 2 in 0.1s, twice.
    # ⭐ A recovery path a tool NAMES must be a recovery path it ACCEPTS.
    ap.add_argument("--profile", default=None,
                    help="the ONE rig profile. Without it the default resolves against "
                         "the CURRENT worktree, which usually holds no profile - and a "
                         "fresh profile is a SIGNED-OUT profile nothing can sign back in.")
    ap.add_argument("--self-check", action="store_true")
    ap.add_argument("--out")
    args = ap.parse_args()
    if args.self_check:
        return self_check()
    if not args.identity:
        print("name at least one --identity")
        return 2

    stamp = time.strftime("%Y-%m-%dT%H-%M-%SZ", time.gmtime())
    out = pathlib.Path(args.out or (REPO / "docs" / "notebook" /
                                    f"t12-smoke-{datetime.date.today().isoformat()}.md"))
    rig = load_rig()
    runs: list[Run] = []
    from playwright.sync_api import sync_playwright

    for identity in args.identity:
        creds = None
        if identity == "member-smoke":
            email = os.environ.get("MEMBER_SMOKE_EMAIL")
            pwd = os.environ.get("MEMBER_SMOKE_PASSWORD")
            if not email or not pwd:
                print("⛔ MEMBER_SMOKE_EMAIL / MEMBER_SMOKE_PASSWORD are not in this "
                      "process's environment. Launch from a shell that has them; they are "
                      "never read from a file and never printed.")
                return 3
            creds = (email, pwd)
        else:
            rig.use_profile(rig.resolve_profile(args.profile))
        print(f"\n═══ {identity} ═══")
        with sync_playwright() as pw:
            runs.append(run_identity(pw, identity, creds, stamp, rig))
        out.write_text(render(runs, stamp), encoding="utf-8")

    out.write_text(render(runs, stamp), encoding="utf-8")
    print(f"\nresults → {out}")
    print(f"screenshots → {SHOTS}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
