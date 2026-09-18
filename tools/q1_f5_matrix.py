#!/usr/bin/env python3
"""Q1-F5 — THE SEVEN-FAMILY x SIX-ORDERING TABLE, DRIVEN ON PRODUCTION.

The unit matrix (`offlineWordsSurvive.property.test.jsx`) proves the property
against a fake server. This drives the SAME seven families and the SAME six
orderings through the real product, on the real deployment, in the rig's one
signed-in browser — because a unit proof is not a production reading, and F5's
freeze lifts on the production table, not on the unit one.

⛔⛔ THE DOOR IS FIRED FROM ITS OWN CONTROL OR THE ROW IS INCONCLUSIVE.
A scripted `fetch` is a SECOND-WRITER simulation whose fork is CORRECT; reading
one as a defect in the member's path cost this wave three deploys
(`window_check.REAL_DOOR_JS`). There is no fallback here, deliberately. A door
this rig cannot open produces a row that says so, names what is missing, and
counts as a rig limitation — never a pass and never a finding.

⛔ THE ORDERINGS ARE ARRANGED IN THE DURABLE STORE, NOT ON THE WIRE.
`marker LIVE`, `marker EXPIRED`, `slow PUT (landed, ring populated)` and
`reload mid-flight` differ only in what the `meta` store holds when the drain
runs — exactly the state a real interleaving leaves behind. Writing those two
keys is reproducing an interleaving; it is not bypassing a handler, and the
DOOR itself is still driven through the member's own control every time.

⛔ RESUMABLE BY CONSTRUCTION. The rig may only be used when no Q1 scheduled task
is due within the hour, so the table is built across several short windows. Every
cell is written to the artifact the moment it is measured; `--resume` skips cells
already recorded. A window that ends mid-table loses one cell, never the table.

⛔ SENTINEL-TIMESTAMPED AND ORPHAN-CHECKED. Every note this tool creates carries
the run stamp, is counted before and after, and is removed. A probe that leaks
notes poisons its own next run's counts — and the rig account must never hold
real content (CLAUDE.md, the smoke-account rule).

USAGE
  python tools/q1_f5_matrix.py --profile <rig profile> [--family F] [--ordering O]
                               [--resume] [--out docs/notebook/wave-q1-f5-production-matrix.md]
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import os
import pathlib
import re
import sys
import time

# ⛔ THE OPERATOR CONSOLE ON THIS BOX IS cp1252, and a tool that raises
# UnicodeEncodeError while printing its own progress loses a RIG WINDOW — the
# one resource this programme cannot get more of today. Same bug that made
# tools/flag_ledger_audit.py read as an auth failure for a month (CLAUDE.md).
try:
    # ⛔⛔ LINE-BUFFERED, AND THAT CLAUSE IS NOT COSMETIC.
    #
    # ⚰️ Measured 2026-09-18. A detached run hit its 1800s ceiling and was killed
    # (exit 124). Python had BLOCK-buffered stdout into the redirect file, so the
    # kill discarded everything: raw.txt contained the single word "TIMED OUT".
    # Zero cells, zero swap-waits, zero banner - and I read that emptiness as "it
    # hung at startup" when Chrome's own creation timestamp proved it had started
    # normally 3 seconds in.
    #
    # ⛔ R-RAW says a run with no raw artifact is INCONCLUSIVE. Buffering turns
    # EVERY killed run into exactly that, and a timeout is precisely the run whose
    # trail you most need. The evidence must reach disk as it happens.
    sys.stdout.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)
    sys.stderr.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)
except (AttributeError, ValueError, TypeError):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

REPO = pathlib.Path(__file__).resolve().parents[1]
SENTINEL = "F5-MATRIX"
DEFAULT_OUT = REPO / "docs" / "notebook" / "wave-q1-f5-production-matrix.md"
STATE = REPO / "docs" / "notebook" / "wave-q1-f5-production-matrix.json"


def load_rig():
    """The rig is `window_check`'s, not a second one.

    ⛔ A SECOND SPAWNER IS A SECOND AUTHORITY OVER THE ONE PROFILE. The profile
    is never deleted, never recreated, and teardown kills the browser by marker
    and keeps it — that policy lives in `window_check` and is imported, not
    restated (`lesson_a_second_authority_over_one_value`).
    """
    spec = importlib.util.spec_from_file_location("window_check", REPO / "tools" / "window_check.py")
    m = importlib.util.module_from_spec(spec)
    sys.modules["window_check"] = m
    spec.loader.exec_module(m)
    return m


# ══════════════════════════════════════════════════════════════════════════════
# the seven families
# ══════════════════════════════════════════════════════════════════════════════
# ⛔ SEVEN, AND THE NUMBER IS NOT TYPED ANYWHERE ELSE. `doorEnumeration.test.js`
# derives the roster from the SQL; this table names the same seven and the gate
# fails if they ever disagree. The four metadata doors advance `updated_at` and
# carry no body; the three append doors ADD A NODE, which is the half the unit
# matrix found unreachable (§10.11).
METADATA = ("folder", "ticker", "tags", "hero")
APPEND = ("append_widget_embed", "append_financial_fact", "append_document_excerpt")
FAMILIES = METADATA + APPEND

# What each append family must actually hit for its row to count. A row whose
# run produced no call to this endpoint did not open the door.
ENDPOINT = {
    "append_widget_embed": "/embeds",
    "append_financial_fact": "/facts/",
    "append_document_excerpt": "/excerpts",
}

# ══════════════════════════════════════════════════════════════════════════════
# W1 - THE FOURTH OUTCOME: the door guard DEFERRED
#
# ⛔⛔ D1 CHANGED WHAT AN ABSENT `/embeds` CALL MEANS. `noteHasUnsentWork` is
# live on production and the capture chokepoint now DEFERS while a note has
# unsent work, so the append cells cannot reach the loss path by design. The
# cell's old reading of that was *"the control took the click but produced no
# call to `/embeds` - a label is not a door"*, filed INCONCLUSIVE. That sentence
# is a diagnosis of a BROKEN SELECTOR, and it was published as one; the owner
# corrected it. The door was driven to completion and the guard stopped it.
#
# ⭐ THREE OUTCOMES WHERE THERE WAS ONE, and they are different facts:
#
#   DEFERRED-BY-GUARD  the member SAW the sentence, no `/embeds` call was made,
#                      and the note still has queued work. The mitigation is
#                      working and the member was told.
#   RED                an `/embeds` call happened while work was unsent - the
#                      guard did not hold, which is the defect itself.
#   INCONCLUSIVE       no toast AND no call. A silent nothing: the click may
#                      have missed, the toast may have shipped invisible (this
#                      repo has shipped two of those), or the guard may have
#                      deferred without telling anyone. All three are
#                      unmeasured, and none of them is a pass.
#
# ⛔ THE COPY CONTRACT IS THE EVIDENCE, not a state flag. Two toasts have
# shipped invisible in this repo - one passed `message` where the component
# reads `msg`, one was owned by the branch its own action unmounts - and both
# left every structural assertion green. So this reads RENDERED TEXT.

#: ⛔ DERIVED FROM THE PRODUCT, NEVER RETYPED. A sentence typed into an
#: instrument agrees with itself and says nothing about what a member sees; the
#: constant is exported precisely so its one authority can be read.
def guard_sentence(repo: pathlib.Path = REPO) -> str | None:
    src = repo / "app" / "src" / "pages" / "journal-2-0" / "lib" / "offline" / "noteHasUnsentWork.js"
    try:
        text = src.read_text(encoding="utf-8")
    except OSError:
        return None
    m = re.search(r"STILL_SYNCING_MESSAGE\s*=\s*'([^']+)'", text)
    return m.group(1) if m else None


#: Read what the member can actually see. ⛔ `innerText`, not `textContent`:
#: textContent returns text inside `display:none` subtrees, which is exactly how
#: an invisible toast would read as a visible one.
GUARD_TOAST_JS = """() => {
  const b = document.body
  return {text: b ? (b.innerText || '') : '', had_body: Boolean(b)}
}"""


def toast_in(rendered: str | None, sentence: str | None) -> bool:
    """⛔ Pure, so the verdict can be driven without a browser.

    UNKNOWN IS NOT SEEN: an unreadable page or an underivable sentence answers
    False, which sends the cell to INCONCLUSIVE rather than to a verdict.
    """
    if not rendered or not sentence:
        return False
    return sentence in rendered


#: The verdict's three branches, PURE. `PROCEED` means the door really fired and
#: the ordinary RED/GREEN logic downstream owns the answer.
DEFERRED = "DEFERRED-BY-GUARD"


def judge_append_door(*, endpoint_hits: int, toast_seen: bool, queued_for_note: int):
    """→ (verdict, why) for a decided cell, or (None, reason) to PROCEED."""
    if endpoint_hits:
        return None, "the door's own endpoint was called - the ordinary path decides"
    if toast_seen and queued_for_note >= 1:
        return DEFERRED, (
            "the door was driven to completion and the capture chokepoint DEFERRED: "
            "the member was shown the sentence, no call to the door's endpoint was "
            f"made, and the note still holds {queued_for_note} queued entr(ies). "
            "⭐ This is the MITIGATION working, not a broken selector - and not a "
            "pass either: the writer is only deferred, never fixed.")
    if toast_seen:
        return "INCONCLUSIVE", (
            "the deferral sentence was shown but the store reported NO queued entry, "
            "so the guard deferred a note that had nothing to defer - the cell cannot "
            "tell a mitigation from a false defer")
    return "INCONCLUSIVE", (
        "a SILENT NOTHING: no call to the door's endpoint and no deferral sentence "
        "on screen. The click may have missed, or the toast may have shipped "
        "invisible (two have, in this repo). Nothing was measured.")


# ══════════════════════════════════════════════════════════════════════════════
# the six orderings
# ══════════════════════════════════════════════════════════════════════════════
# Names are BYTE-IDENTICAL to `ORDERINGS` in offlineWordsSurvive.property.test.jsx
# so the production table and the unit table can be read side by side. A rename
# in one and not the other makes two tables that look comparable and are not.
ORDERINGS = (
    "settle-first",
    "drain-first (the editor could NOT report local state)",
    "marker LIVE",
    "marker EXPIRED",
    "slow PUT (landed, ring populated)",
    "reload mid-flight (marker from a dead tab)",
)

# ⛔⛔ ONE CELL IS NOT A MEASUREMENT THIS RIG CAN TAKE, AND THE REASON IS THE
# PRODUCT'S, NOT THE RIG'S. `settle-first` models the door settling its revision
# WITH LOCAL STATE before the drain runs. `settleMetadataRevision` belongs to
# folder, ticker and tags alone; the three appenders call `settleNoteWrite`,
# which records the revision and never settles, because settling needs an editor
# mounted and these doors fire from surfaces that have none. Forcing it would
# measure the fixture, not the product (§10.16), and `f5Freeze.test.js` asserts
# that claim FROM THE SOURCE so this exemption cannot quietly outlive it.
NOT_APPLICABLE = {
    (f, "settle-first"): (
        "the product cannot reach this state — an append door records a landed "
        "revision and never settles with local state (f5Freeze.test.js asserts "
        "it from the source)"
    )
    for f in APPEND
}


def cells(only_family=None, only_ordering=None):
    for f in FAMILIES:
        if only_family and f != only_family:
            continue
        for o in ORDERINGS:
            if only_ordering and only_ordering not in o:
                continue
            yield f, o


# ══════════════════════════════════════════════════════════════════════════════
# arranging an ordering — in the durable store, the way an interleaving leaves it
# ══════════════════════════════════════════════════════════════════════════════
# The `meta` store is keyPath `name`; the two keys that decide a drain's path are
# `inflight:<noteId>` (the in-flight marker) and `landed:<noteId>` (the landed
# ring). Shapes read from inFlight.js — markerFor() and withLanded() — not
# invented here.
ARRANGE_JS = """async ({acct, noteId, ordering, ttl}) => {
  const open = () => new Promise((res, rej) => {
    const r = indexedDB.open('uct_notebook_' + acct);
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  const put = async (db, name, value) => new Promise((res, rej) => {
    const tx = db.transaction('meta', 'readwrite');
    tx.objectStore('meta').put({name, value});
    tx.oncomplete = () => res(true); tx.onerror = () => rej(tx.error);
  });
  const del = async (db, name) => new Promise((res) => {
    const tx = db.transaction('meta', 'readwrite');
    tx.objectStore('meta').delete(name);
    tx.oncomplete = () => res(true); tx.onerror = () => res(false);
  });
  const get = async (db, name) => new Promise((res) => {
    const tx = db.transaction('meta', 'readonly');
    const q = tx.objectStore('meta').get(name);
    q.onsuccess = () => res(q.result ? q.result.value : null); q.onerror = () => res(null);
  });
  let db;
  try { db = await open() } catch (e) { return {ok:false, why:'indexedDB.open failed: ' + e} }
  if (![...db.objectStoreNames].includes('meta')) return {ok:false, why:'no meta store'};

  const marker = 'inflight:' + noteId, landed = 'landed:' + noteId;
  // The note's own durable record carries the baseline every marker must quote.
  const base = await new Promise((res) => {
    const tx = db.transaction('notes', 'readonly');
    const q = tx.objectStore('notes').get(noteId);
    q.onsuccess = () => res(q.result || null); q.onerror = () => res(null);
  });
  const baseUpdatedAt = base && (base.serverUpdatedAt || base.baseUpdatedAt
                                 || (base.note && base.note.updatedAt)) || null;
  const now = Date.now();
  let arranged;
  if (ordering === 'marker LIVE') {
    await put(db, marker, {sessionId: 'this-tab', startedAt: now, baseUpdatedAt});
    arranged = 'inflight marker, this tab, live';
  } else if (ordering === 'marker EXPIRED') {
    await put(db, marker, {sessionId: 'gone', startedAt: now - (ttl + 5000), baseUpdatedAt});
    arranged = 'inflight marker, dead session, aged past the TTL';
  } else if (ordering === 'slow PUT (landed, ring populated)') {
    const ring = (await get(db, landed)) || [];
    await put(db, landed, [baseUpdatedAt, ...ring.filter(r => r !== baseUpdatedAt)].slice(0, 5));
    await put(db, marker, {sessionId: 'gone', startedAt: now - (ttl + 5000), baseUpdatedAt});
    arranged = 'landed ring carries the revision + an expired marker';
  } else if (ordering === 'reload mid-flight (marker from a dead tab)') {
    await put(db, marker, {sessionId: 'previous-tab', startedAt: now, baseUpdatedAt});
    arranged = 'inflight marker from a previous tab';
  } else {
    await del(db, marker);
    arranged = 'no marker (the drain decides from the wire)';
  }
  return {ok: true, arranged, baseUpdatedAt,
          marker: await get(db, marker), ring: await get(db, landed)};
}"""

# What the drain left behind, read from the durable store rather than inferred.
OUTBOX_JS = """async ({acct}) => {
  const open = () => new Promise((res, rej) => {
    const r = indexedDB.open('uct_notebook_' + acct);
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  let db; try { db = await open() } catch { return {err: 'open failed'} }
  const all = (store) => new Promise((res) => {
    if (![...db.objectStoreNames].includes(store)) return res([]);
    const tx = db.transaction(store, 'readonly');
    const q = tx.objectStore(store).getAll();
    q.onsuccess = () => res(q.result || []); q.onerror = () => res([]);
  });
  return {outbox: (await all('outbox')).length, conflicts: (await all('conflicts')).length};
}"""


# ══════════════════════════════════════════════════════════════════════════════
# the three append drivers — each one opens its family's OWN control
# ══════════════════════════════════════════════════════════════════════════════

WIDGET_EMBED_JS = """async () => {
  // ⛔ THE MEMBER'S CONTROL. Every /charts widget renders a "Send to Journal"
  // door; the plain one appends to the note the member is working in
  // (`freshLastNote()` -> localStorage 'uct.jw.lastNote'), which the editor
  // wrote when the probe note was opened. No destination has to be guessed.
  const fire = (el, type) => el.dispatchEvent(
    new MouseEvent(type, {bubbles: true, cancelable: true, view: window}));
  const seen = [];
  // The chooser variant is the one every widget exposes with a stable aria
  // label; the plain variant lives in a widget's own context menu.
  const chooser = document.querySelector('[aria-label="Send to Journal — choose where"]');
  if (!chooser) {
    for (const el of document.querySelectorAll('button,[role=button],[aria-label]')) {
      const t = ((el.getAttribute('aria-label') || '') + ' ' + (el.innerText || '')).trim();
      if (/send to journal/i.test(t)) seen.push(t.slice(0, 60));
    }
    return {ok: false, why: 'no "Send to Journal" control on this page', seen: seen.slice(0, 10)};
  }
  chooser.scrollIntoView({block: 'center'});
  fire(chooser, 'pointerdown'); fire(chooser, 'mousedown'); chooser.click();
  await new Promise(r => setTimeout(r, 1200));
  // Enumerate the chooser's options rather than assuming a position — which
  // destinations exist depends on the member's own recent notes.
  const opts = [...document.querySelectorAll('button,[role=menuitem],[role=option],li')]
    .map(el => ({el, t: (el.innerText || '').trim()}))
    .filter(o => o.t && o.t.length < 90);
  // ONLY "Current note" reaches /embeds. `CAPTURE_TARGETS` (captureTargets.js)
  // routes "New entry" to POST /api/j2/notes and "Notebook inbox" to
  // POST /api/j2/inbox -- neither appends to the note holding the queued work,
  // so picking one would leave an orphan note and measure a different door.
  const target = opts.find(o => /^current note/i.test(o.t));
  if (!target) return {ok: false, why: 'the chooser offered no "Current note" destination',
                       options: opts.map(o => o.t).slice(0, 12)};
  target.el.click();
  return {ok: true, via: 'Send to Journal → ' + target.t.slice(0, 40)};
}"""

FINANCIAL_FACT_JS = """async () => {
  // ⛔ THE MEMBER'S CONTROL: TickerPopup's camera button, whose handler imports
  // captureFinancialFact and POSTs /facts then /facts/{id}/insert. It targets
  // `freshLastNote()` — the probe note, opened moments ago in the editor.
  const btn = [...document.querySelectorAll('button')].find(
    b => /current price to Notebook/i.test(b.getAttribute('aria-label') || ''));
  if (!btn) {
    const open = !!document.querySelector('[role=dialog]');
    return {ok: false, why: 'no "Save price to Notebook" button on the page',
            dialogOpen: open};
  }
  if (btn.disabled) return {ok: false, why: 'the capture button is disabled (a capture is in flight)'};
  btn.scrollIntoView({block: 'center'});
  btn.click();
  return {ok: true, via: 'TickerPopup → ' + (btn.getAttribute('aria-label') || 'save price')};
}"""

UNUSED_EXCERPT_PROBE_JS = """async () => {
  // What the excerpt door needs, reported as a census rather than attempted
  // blind: a document attached to this note, its preview open, and a text
  // selection inside the rendered PDF.
  const docs = await fetch(location.pathname.match(/notebook/) ? '/api/j2/notes' : '/api/j2/notes',
                           {credentials: 'include'}).then(() => null).catch(() => null);
  const previewOpen = !!document.querySelector('[data-uct-doc-preview], .pdfViewer, canvas.pdf-page');
  const saveBtn = [...document.querySelectorAll('button')].find(
    b => /save excerpt/i.test((b.innerText || '') + (b.getAttribute('aria-label') || '')));
  return {previewOpen, saveButton: !!saveBtn,
          why: saveBtn ? null : 'no "Save excerpt" control is on the page'};
}"""



# ==============================================================================
# a one-page PDF with REAL, SELECTABLE TEXT
# ==============================================================================
# DERIVED, NOT SHIPPED. The excerpt driver has to SELECT a known string and then
# prove that exact string came back. A binary checked into the repo would make
# the expected text a second authority over the file's contents; generating it
# means the two cannot disagree.
#
# It must carry a pdfjs TEXT LAYER, not just ink. `PdfDocumentViewer.jsx:378`
# renders `new pdfjsLib.TextLayer(...)` into `.textLayer`, and the door's
# selection handler resolves offsets against those spans -- a scanned image
# would render a page the rig can SEE and cannot SELECT.
def minimal_pdf(line: str) -> bytes:
    content = ("BT /F1 16 Tf 60 700 Td (" + line + ") Tj ET").encode("latin-1", "replace")
    objs = [
        b"<</Type/Catalog/Pages 2 0 R>>",
        b"<</Type/Pages/Kids[3 0 R]/Count 1>>",
        b"<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]"
        b"/Resources<</Font<</F1 4 0 R>>>>/Contents 5 0 R>>",
        b"<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>",
        b"<</Length " + str(len(content)).encode() + b">>streamNLMARK" + content + b"NLMARKendstream",
    ]
    out = bytearray(b"%PDF-1.4NLMARK")
    offsets = []
    for i, body in enumerate(objs, start=1):
        offsets.append(len(out))
        out += str(i).encode() + b" 0 obj" + body + b"endobjNLMARK"
    xref = len(out)
    out += b"xrefNLMARK0 " + str(len(objs) + 1).encode() + b"NLMARK0000000000 65535 f NLMARK"
    for off in offsets:
        out += ("%010d 00000 n NLMARK" % off).encode()
    out += (b"trailer<</Size " + str(len(objs) + 1).encode() + b"/Root 1 0 R>>NLMARKstartxrefNLMARK"
            + str(xref).encode() + b"NLMARK%%EOFNLMARK")
    return bytes(out).replace(b"NLMARK", b"\n")


# A phrase the fixture really contains, so the driver selects something real and
# can prove THAT string came back. Read from the PDF, not invented beside it.
EXCERPT_LINE = "CONDENSED CONSOLIDATED STATEMENTS OF INCOME"

SELECT_AND_SAVE_JS = """async ({want}) => {
  // THE MEMBER'S OWN SELECTION, not a scripted POST. `PdfDocumentViewer`
  // listens for `selectionchange` and resolves the Range's offsets while the
  // Range is still alive; only then does its "Save excerpt" popover exist.
  // Setting a Selection through the Selection API fires that event natively.
  const spans = [...document.querySelectorAll('.textLayer span')]
    .filter(s => (s.textContent || '').trim());
  if (!spans.length) return {ok:false, why:'the pdfjs text layer rendered no spans'};
  const first = want.split(' ')[0];
  const hit = spans.find(s => (s.textContent || '').includes(first))
           || spans.find(s => (s.textContent || '').trim().length > 8) || spans[0];
  const page = hit.closest('[data-pdf-page-number]');
  if (!page) return {ok:false, why:'the text layer is not inside a [data-pdf-page-number] page'};
  const node = hit.firstChild || hit;
  const len = (node.textContent || '').length;
  if (len < 2) return {ok:false, why:'the span carries no selectable text'};
  const range = document.createRange();
  range.setStart(node, 0); range.setEnd(node, len);
  const sel = window.getSelection();
  sel.removeAllRanges(); sel.addRange(range);
  document.dispatchEvent(new Event('selectionchange'));
  await new Promise(r => setTimeout(r, 900));
  const save = [...document.querySelectorAll('button')]
    .find(b => /save excerpt/i.test(b.innerText || ''));
  if (!save) return {ok:false, why:'the selection produced no "Save excerpt" popover',
                     selected: sel.toString().slice(0, 40)};
  save.click();
  return {ok:true, via:'text-layer selection then Save excerpt',
          selected: (node.textContent || '').slice(0, 40)};
}"""

OPEN_PREVIEW_JS = """async () => {
  const chip = document.querySelector('a[data-type="attachmentChip"]');
  if (!chip) return {ok:false, why:'no attachment chip in the note body'};
  chip.scrollIntoView({block:'center'});
  chip.click();
  // ⛔ POLL, DO NOT WAIT A FIXED 3.5s. pdf.js has to fetch its own lazy chunk and
  // the document before it lays out a text layer, and how long that takes is not
  // this rig's to choose. Measured 2026-09-13: the SAME pdf rendered 2 pages /
  // 25 spans on one run and 0 / 0 on the next — a flaky rig limitation that
  // would have been recorded against the DOOR.
  let pages = 0, spans = 0;
  for (let i = 0; i < 40; i++) {
    pages = document.querySelectorAll('[data-pdf-page-number]').length;
    spans = document.querySelectorAll('.textLayer span').length;
    if (pages > 0 && spans > 0) break;
    await new Promise(r => setTimeout(r, 500));
  }
  return {ok: pages > 0 && spans > 0,
          why: 'preview pages=' + pages + ' textLayer spans=' + spans + ' (polled)',
          pages, spans};
}"""


# ==============================================================================
# the hero door has no control until the note has a hero
# ==============================================================================
# `NoteEditorPage.jsx:2188` renders `<HeroImagePicker>` inside
# `note.heroImageUrl ? (...) : null`, and `HeroImagePicker` is the ONLY client
# caller of `POST /api/j2/notes/{id}/hero`. A note with no hero therefore shows
# no picker at all -- which is why all six `hero` cells came back INCONCLUSIVE
# saying "the hero picker is not on the page ... the seed step must have failed"
# about a seed step that did not exist.
#
# HERO_PICKER is a COPY of the selector `window_check._fire_hero_door` queries,
# kept here only so the SETUP can wait for the member's control to render.
# `_hero_picker_drift` asks the door's own source whether the two still agree,
# because a hand-typed copy beside its source is the drift this programme keeps
# paying for.
HERO_PICKER = 'input[type="file"][data-uct-hero-input]'

HERO_READ_JS = """async (id) => {
  // A READ, not a door -- the same posture as SECOND_WRITER_REV_JS. No surface
  // reports `heroImageUrl`, so the server is asked directly. An unreadable
  // answer is reported as unreadable: a layer that could not be READ is not a
  // layer that is EMPTY, and this wave has already scored one of those as a
  // finding.
  const r = await fetch('/api/j2/notes/' + id, {credentials:'include'});
  if (!r.ok) return {readFailed: 'HTTP ' + r.status};
  const t = await r.text();
  try { const j = JSON.parse(t); return {hero: (j.note || {}).heroImageUrl || null} }
  catch { return {readFailed: 'not JSON: ' + t.slice(0, 40)} }
}"""


def _hero_picker_drift(rig):
    """Does `HERO_PICKER` still name the control the DOOR actually queries?

    Returns the reason to refuse, or None when the two agree. A source that
    cannot be read is a reason too -- an unreadable source is not a matching one,
    and an empty result is a failed invocation until proven otherwise.
    """
    import inspect
    fn = getattr(rig, "_fire_hero_door", None)
    if fn is None:
        return ("the rig module exposes no `_fire_hero_door` -- there is no hero door "
                "for this setup to prepare")
    try:
        src = inspect.getsource(fn)
    except (OSError, TypeError) as e:  # noqa: BLE001
        return (f"`window_check._fire_hero_door`'s source could not be read "
                f"({type(e).__name__}), so the setup cannot prove it waits for the same "
                f"control the door will query")
    if HERO_PICKER not in src:
        return (f"`HERO_PICKER` ({HERO_PICKER}) no longer appears in "
                f"`window_check._fire_hero_door` -- the setup and the door disagree about "
                f"which control the member uses, so waiting here would prove nothing")
    return None


def prepare_family(page, family, note_id, stamp, log, rig=None, base=""):
    """Whatever a family's door needs IN PLACE before the offline half starts.

    SETUP IS ONLINE AND IS NOT THE DOOR. Attaching a PDF needs the network, so it
    cannot happen inside the offline window -- and it is not the thing under test.
    The DOOR is the selection and the Save-excerpt click, both driven from the
    member's own controls once the run is back online.
    """
    if family == "hero":
        # ======================================================================
        # THIS IS SETUP, NOT THE DOOR. The sentence directly above -- *"SETUP IS
        # ONLINE AND IS NOT THE DOOR"* -- is this step's whole charter, and the
        # owner ruled on it in those words on 2026-09-14: *"Hero seed via the API
        # -- approved; 'setup is online and is not the door' covers it."*
        #
        # THE POST BELOW IS NOT A SCRIPTED STAND-IN FOR A MEMBER CONTROL, and
        # nobody may later read it as one. It is the excerpt family's PDF upload
        # wearing a different mime type: it happens ONLINE, BEFORE the offline
        # window opens, and it exists only to make the member's own control
        # EXIST. The DOOR is still `rig._fire_hero_door(page)`, which drives the
        # real `input[data-uct-hero-input]`, and it still has no fallback: a door
        # this rig cannot open produces a row that says so.
        # ======================================================================
        seed = getattr(rig, "_hero_seed", None)
        if seed is None:
            return {"ok": False, "rig_limitation": True,
                    "why": ("the rig module exposes no `_hero_seed`, so the note cannot be "
                            "given the hero its picker renders for")}
        drift = _hero_picker_drift(rig)
        if drift:
            return {"ok": False, "rig_limitation": True, "why": drift}
        # ONE IMAGE, ONE AUTHORITY. `window_check._hero_seed` already POSTs a 1x1
        # PNG from the page with `credentials:'include'` -- measured
        # byte-identical to `window_check._HERO_PNG` (69 bytes, equal). Restating
        # either the image or the request here would put a second authority on
        # both, so the rig's own seeder is called rather than a copy of it.
        seeded = seed(page, base, note_id)
        log(f"      hero seed (SETUP, not the door): {seeded}")
        if not (isinstance(seeded, dict) and seeded.get("ok")):
            return {"ok": False, "rig_limitation": True,
                    "why": f"the hero seed POST did not succeed ({seeded})"}

        # AN UNVERIFIED SEED IS THE SAME SIX INCONCLUSIVE CELLS WITH A
        # BETTER-LOOKING LOG. `_hero_seed` reports its own request's status;
        # only the NOTE can say the note now HAS a hero.
        got = page.evaluate(HERO_READ_JS, note_id)
        log(f"      hero after the seed: {got}")
        if not isinstance(got, dict) or got.get("readFailed"):
            return {"ok": False, "rig_limitation": True,
                    "why": (f"the note could not be re-read to confirm the hero seed "
                            f"({(got or {}).get('readFailed')}) -- unread is not unset")}
        if not got.get("hero"):
            return {"ok": False, "rig_limitation": True,
                    "why": ("the hero seed reported success but the note still carries no "
                            "`heroImageUrl` -- the picker cannot render and the door cannot "
                            "be driven")}

        # The editor mounted BEFORE the note had a hero, so the picker is not on
        # the page yet however well the seed went. Re-open the note and WAIT for
        # the member's own control to appear. Poll, do not sleep a fixed span: a
        # page still loading would hand the door an absent picker, and the door
        # would blame the seed for it -- the exact misleading reason this step
        # exists to remove.
        page.goto(f"{base}/journal/notebook?note={note_id}", wait_until="domcontentloaded")
        picker, editor = None, None
        for _ in range(12):
            page.wait_for_timeout(2000)
            picker = page.query_selector(HERO_PICKER)
            editor = page.query_selector(".ProseMirror")
            if picker is not None and editor is not None:
                break
        log(f"      after re-opening the note: picker={picker is not None} "
            f"editor={editor is not None}")
        if picker is None:
            return {"ok": False, "rig_limitation": True,
                    "why": (f"the note carries a hero (`{str(got.get('hero'))[:60]}`) but "
                            f"`{HERO_PICKER}` never rendered after re-opening the editor. "
                            f"This is NOT a failed seed -- the server agrees the note has "
                            f"one (editor mounted: {editor is not None})")}
        return {"ok": True, "hero_seeded": got.get("hero")}

    if family != "append_document_excerpt":
        return {"ok": True}
    # ⛔⛔ A REAL PDF, NOT A SYNTHETIC ONE. Owner ruling 2026-09-13.
    #
    # ⚰️ The first version generated a minimal PDF by hand. It was structurally
    # valid — pypdf read it, the upload succeeded, the server extracted it and
    # marked the document `ready` — and **pdf.js rendered 0 pages and 0 text-layer
    # spans**, so the excerpt door could not be reached at all. The cell reported
    # a rig limitation for a PDF the rig itself had invented.
    #
    # ⭐ Wave P's certification corpus already holds real ones. `native_text.pdf`
    # carries NATIVE TEXT (not a scan), which is what makes pdf.js build the
    # `.textLayer` spans a real selection needs — a scanned page renders something
    # the rig can SEE and cannot SELECT.
    pdf = REPO / "tools" / "wave_p_cert_corpus" / "native_text.pdf"
    if not pdf.exists():
        return {"ok": False, "rig_limitation": True,
                "why": f"the excerpt fixture is missing: {pdf}"}
    try:
        page.set_input_files('input[aria-label="Upload file attachment"]', str(pdf))
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "rig_limitation": True,
                "why": "the editor's own attachment input would not take the file: " + str(e)}
    # ⛔ POLL THE THING THAT ANSWERS THE QUESTION. A flat 9s here was a guess at
    # how long the server takes to process an attachment; the endpoint below can
    # simply be asked. Same 9s ceiling, so a slow server behaves as before.
    for _ in range(18):
        page.wait_for_timeout(500)
        try:
            ready = page.evaluate("""async (id) => {
              try {
                const r = await fetch('/api/j2/notes/' + id + '/documents', {credentials:'include'});
                if (!r.ok) return false;
                const j = await r.json();
                return Array.isArray(j.documents) && j.documents.length > 0;
              } catch { return false; }
            }""", note_id)
        except Exception:                                # noqa: BLE001
            ready = False
        if ready:
            break
    docs = page.evaluate("""async (id) => {
      const r = await fetch('/api/j2/notes/' + id + '/documents', {credentials:'include'});
      if (!r.ok) return {err: r.status};
      const j = await r.json().catch(() => ({documents: []}));
      return {count: (j.documents || []).length,
              status: (j.documents || []).map(d => d.status)};
    }""", note_id)
    log("      attached: " + str(docs))
    if not isinstance(docs, dict) or not docs.get("count"):
        return {"ok": False, "rig_limitation": True,
                "why": "the PDF uploaded but no document row appeared (" + str(docs) + ")"}
    return {"ok": True, "documents": docs}



# ==============================================================================
# navigating to a door's surface WITHOUT letting the drain win first
# ==============================================================================
# THE RACE IS THE WHOLE POINT OF THE CELL, so it must not be lost by accident.
# The append doors live on other surfaces, and a `page.goto` is a DOCUMENT load:
# it needs the network, so it can only happen after the run is back online --
# and by the time the new page has mounted, the drain has usually already sent
# the queued entry. The cell then goes green having measured nothing.
#
# THERE IS NO SERVICE WORKER (CLAUDE.md, measured), so an offline document load
# fails outright. The route change that DOES work offline is the one React Router
# owns: pushState plus a PopStateEvent, with the route's chunk already warmed
# while the run was online. The door is then one click away the instant the
# transport comes back.
FORCE_NAV = {"on": False, "path": "/charts"}

# ⛔⛔ THE CELL THAT DECIDES — navigation with NO door at all.
#
# Every RED so far has changed TWO things at once: it left the note AND fired an
# append door. Four reproductions of a confounded pair is still a confounded
# pair. This removes the door entirely: queue an offline edit, leave the note,
# fire NOTHING, come back, reconnect, drain.
#
# ⭐ If the member's words are gone with no door in the picture, the finding is
# not about append doors at all — it is that a remount with queued work
# overwrites the dirty record and deletes its intent, on the ordinary navigation
# path every member takes.
NO_DOOR = {"on": False, "path": "/charts"}

# ⛔⛔ THE CELL THAT ISOLATES THE VARIABLE — SECOND-WRITER-WHILE-AWAY.
#
# navigate-no-door came back GREEN: leaving the note and returning, with work
# queued and NO door fired, does not cost the member their words. So navigation
# alone is safe and the RED cells differ in something else.
#
# ⭐ The remaining difference is whether THE SERVER'S COPY CHANGED while the
# member was away. This cell changes exactly that and nothing else: same queue,
# same route away, same return, same release — but while the first context is
# away and offline, a SECOND browser context signed in as the same account moves
# note N's folder through the member's own door.
#
# ⛔ It must be a second CONTEXT, not a second tab. Measured 2026-09-13 against a
# throwaway browser on a temp profile: two CDP browser contexts see NOTHING of
# each other's localStorage or IndexedDB. A second tab in the same context shares
# the durable copy and the Web Lock, which is a different experiment entirely.
SECOND_WRITER = {"on": False, "path": "/charts", "door": "folder"}
SPA_RETURN = {"on": False}

WARM_ROUTES = {
    "append_widget_embed": "/charts",
    "append_financial_fact": "/dashboard",
}

SPA_NAV_JS = """async ({path}) => {
  history.pushState({}, '', path);   // path may carry a query string
  window.dispatchEvent(new PopStateEvent('popstate', {state: {}}));
  await new Promise(r => setTimeout(r, 4000));
  // ⛔ REPORT THE WHOLE URL. Reporting only `pathname` hid whether the note
  // query survived the route change — and "the drain never ran" and "the editor
  // never reopened" are different findings.
  return {path: location.pathname, search: location.search,
          editor: !!document.querySelector('.ProseMirror'),
          offline: !navigator.onLine};
}"""


def warm_route(page, family, base, log):
    """Load the door's surface once, ONLINE, so its lazy chunk is cached.

    A cold chunk cannot be fetched during the offline half, and fetching it after
    coming back online is exactly the delay that lets the drain win.
    """
    path = WARM_ROUTES.get(family)
    if not path:
        return {"ok": True, "warmed": None}
    page.goto(base + path, wait_until="domcontentloaded")
    # ⛔ WAIT FOR THE CONDITION, NOT THE CLOCK. This was a flat 9s, fired once per
    # cell - measured 2026-09-18 at ~27% of a 39-cell run's 1318s, spent whether
    # or not the route was ready. The CEILING is unchanged, so nothing that used
    # to pass can now fail; what changes is that a route already warm costs what
    # it actually costs.
    warmed_in = 9000
    try:
        page.wait_for_load_state("networkidle", timeout=9000)
        warmed_in = None
    except Exception:                                    # noqa: BLE001
        # networkidle never arrived inside the old budget - this route streams or
        # polls. Fall back to exactly the previous behaviour rather than guessing.
        pass
    return {"ok": True, "warmed": path, "warm_wait": warmed_in}



def select_with_the_pointer(page, log):
    """Make a REAL pointer selection across a rendered pdf.js text span.

    ⛔⛔ NOT A SCRIPTED RANGE. Owner ruling: *"a real pointer selection over a
    rendered range... no synthetic selection, no scripted fetch."*

    ⚰️ A drag and a double-click both left `getSelection()` EMPTY while the span
    under the cursor reported `user-select: text` and `pointer-events: auto`. So
    this tries the gestures in order of how much a real hand does, and — the part
    that matters — **reports the selection's INTERNALS after each one**
    (`rangeCount`, `isCollapsed`, the anchor and focus nodes) rather than only
    `toString()`. "Empty string" is one observation with several causes: no
    range at all, a collapsed caret, or a range anchored somewhere unexpected.
    """
    spans = page.query_selector_all(".textLayer span")
    best, best_box = None, None
    for sp in spans:
        try:
            box = sp.bounding_box()
            txt = (sp.inner_text() or "").strip()
        except Exception:  # noqa: BLE001
            continue
        if not box or not txt or len(txt) < 6:
            continue
        if box["width"] < 60 or box["height"] < 4:
            continue
        if best_box is None or box["width"] > best_box["width"]:
            best, best_box = sp, box
    if best is None:
        return {"ok": False, "rig_limitation": True,
                "why": f"no pdf.js text span wide enough to drag across "
                       f"({len(spans)} span(s) rendered)"}

    best.scroll_into_view_if_needed()
    page.wait_for_timeout(400)
    box = best.bounding_box() or best_box
    y = box["y"] + box["height"] / 2
    x0, x1 = box["x"] + 2, box["x"] + box["width"] - 2

    probe = """() => {
      const s = window.getSelection();
      const n = (x) => !x ? null : (x.nodeType === 3 ? '#text(' + (x.data||'').slice(0,18) + ')'
                                                     : x.nodeName);
      return {text: s ? s.toString() : null,
              ranges: s ? s.rangeCount : -1,
              collapsed: s ? s.isCollapsed : null,
              anchor: n(s && s.anchorNode), focus: n(s && s.focusNode),
              type: s ? s.type : null};
    }"""

    def attempt(name, fn):
        page.evaluate("() => window.getSelection() && window.getSelection().removeAllRanges()")
        page.wait_for_timeout(200)
        fn()
        page.wait_for_timeout(700)
        st = page.evaluate(probe)
        log(f"      selection after {name}: {st}")
        return st

    # ⭐ TRIPLE-CLICK FIRST. It is the gesture a person uses to take a whole line,
    # and Chromium implements it in the browser rather than leaving it to the
    # page — so it survives synthetic input where a drag's move stream does not.
    st = attempt("triple-click", lambda: page.mouse.click(x0 + 24, y, click_count=3))
    if not (st.get("text") or "").strip():
        st = attempt("double-click", lambda: page.mouse.dblclick(x0 + 24, y))
    if not (st.get("text") or "").strip():
        def slow_drag():
            page.mouse.move(x0, y)
            page.mouse.down()
            for frac in (0.2, 0.4, 0.6, 0.8, 1.0):
                page.mouse.move(x0 + (x1 - x0) * frac, y, steps=3)
                page.wait_for_timeout(140)
            page.mouse.up()
        st = attempt("slow drag", slow_drag)

    got = (st.get("text") or "").strip()
    if not got:
        return {"ok": False, "rig_limitation": True,
                "why": (f"three real pointer gestures (triple-click, double-click, slow drag) "
                        f"across a {int(box['width'])}x{int(box['height'])}px span produced no "
                        f"selection. Last reading: ranges={st.get('ranges')} "
                        f"collapsed={st.get('collapsed')} anchor={st.get('anchor')} "
                        f"focus={st.get('focus')}. CDP-synthesised pointer input does not "
                        f"produce a text selection in this renderer")}

    save = None
    for b in page.query_selector_all("button"):
        try:
            if "save excerpt" in (b.inner_text() or "").strip().lower():
                save = b
                break
        except Exception:  # noqa: BLE001
            continue
    if save is None:
        return {"ok": False,
                "why": f"the selection took ({got[:40]!r}) but produced no "
                       f'"Save excerpt" popover'}
    save.click()
    return {"ok": True, "via": "pointer selection then Save excerpt", "selected": got[:60]}


def drive_append(page, family, base, log):
    """Open ONE append family's door from its own surface. Never a raw fetch."""
    if family == "append_widget_embed":
        # Already on /charts -- the cell navigated there OFFLINE so this click
        # is the first thing that happens once the transport is back.
        return page.evaluate(WIDGET_EMBED_JS)

    if family == "append_financial_fact":
        # Already on /dashboard -- MoversSidebar's tickers are TickerPopup-wrapped.
        opened = page.evaluate("""async () => {
          // TickerPopup stamps `data-testid="ticker-<SYM>"` with role=button on
          // its trigger and `data-testid="chart-modal"` on the open modal, so
          // neither the click target nor the success test has to be guessed from
          // text. MoversSidebar wraps every mover in one.
          const triggers = [...document.querySelectorAll('[data-testid^="ticker-"]')];
          if (!triggers.length) return {ok:false,
            why:'no [data-testid^=ticker-] trigger on this page — MoversSidebar rendered nothing '
                + '(its /api/movers read may not have been in SWR cache for the offline route change)'};
          triggers[0].click();
          await new Promise(r => setTimeout(r, 3000));
          const modal = document.querySelector('[data-testid="chart-modal"]');
          return {ok: !!modal, why: 'clicked ' + (triggers[0].getAttribute('data-testid') || ''),
                  triggers: triggers.length};
        }""")
        log(f"      popup: {opened}")
        if not (isinstance(opened, dict) and opened.get("ok")):
            return {"ok": False, "why": f"could not open a TickerPopup: {opened}"}
        page.wait_for_timeout(1500)
        return page.evaluate(FINANCIAL_FACT_JS)

    if family == "append_document_excerpt":
        # The door lives on the editor page itself -- no navigation. Open the PDF
        # the prepare step attached, select a passage, click Save excerpt.
        opened = page.evaluate(OPEN_PREVIEW_JS)
        log("      preview: " + str(opened))
        if not (isinstance(opened, dict) and opened.get("ok")):
            return {"ok": False, "rig_limitation": True,
                    "why": "the PDF preview would not open: " + str(opened)}
        page.wait_for_timeout(2500)
        return select_with_the_pointer(page, log)

    return {"ok": False, "why": f"no driver for {family}"}


# ══════════════════════════════════════════════════════════════════════════════
# the artifact
# ══════════════════════════════════════════════════════════════════════════════


# ==============================================================================
# THE RIG WINDOW RULE, ENCODED RATHER THAN REMEMBERED
# ==============================================================================
# "Rig only when no Q1 scheduled task is due within the hour" (owner ruling).
# A rule an operator has to remember is a rule that gets skipped on the run that
# matters -- and the cost here is not abstract: the sampler and this tool drive
# THE SAME signed-in profile, so an overlap corrupts whichever one is mid-flight
# and leaves a SKIPPED row or a half-finished cell with no way to tell which.
#
# It REFUSES and names the task, rather than waiting: a run that silently blocks
# for fifty minutes looks identical to a run that hung.
RIG_TASKS = ("UCT-WaveQ1-Observe", "UCT-WaveQ1-Canary", "UCT Wave Q1 Window Check")
WINDOW_MINUTES = 60


# ⛔⛔ A TASK THAT *JUST STARTED* CAN STILL READ `Ready`.
#
# ⚰️ Near miss, 2026-09-14 02:00. The sampler fired at 02:00:01 and this guard
# said CLEAR at 02:00:24 - a 24-second margin. It was right that time (the run
# finished in ~20s and its row landed), but it was right by luck: Windows sets
# `State=Running` a moment AFTER the trigger, so a poll inside that gap sees
# `Ready` for a task that is about to take the profile. That is the same race
# that cost the 10:00 observation row, surviving the fix that was supposed to
# close it - the `Running` check only catches a task already visibly running.
#
# ⭐ So the clock is used as well as the state: a Q1 task that STARTED within
# the cooldown is treated as still holding the profile, whatever the state says.
# Cheap, conservative, and it fails in the safe direction - the cost of waiting
# three minutes is nothing; the cost of being wrong is a hole in the K window.
JUST_RAN_COOLDOWN_SECONDS = 180

# ⛔⛔ THE PRECONDITION BUDGET. Every individual wait in this file is bounded;
# their SUM was not. On 2026-09-15 a cell ran 1802s and produced no verdict at all
# — a 30-minute hang that burned half a rig window AND left the rig browser alive,
# opted in, for the next sampler to mistake for product state.
#
# ⭐ A CLEAN REFUSAL AND A HANG ARE NOT THE SAME FAILURE. The first is an answer
# ("nothing was measured, here is why"); the second is the absence of one. Setup is
# online and is not the door, so it gets a deadline and must say WHICH step ran out.
PRECONDITION_BUDGET_SECONDS = 120

# ══════════════════════════════════════════════════════════════════════════════
# SWAP RESILIENCE — a 502 mid-cell is ANOTHER SESSION'S DEPLOY, not product state
#
# ⚰️ MEASURED 2026-09-18. A P2 run spent 1318s and came back 16 GREEN / 23
# INCONCLUSIVE, and **22 of the 23 were `/api/auth/me` 502**. Master was landing a
# deploy every ~13 minutes while a 2.8b cell takes 12-22, so the rig could not
# hold a stable production long enough to finish. The instrument was RIGHT to
# refuse - it just refused permanently where it could have waited.
#
# ⛔ THE BUDGET IS THE WHOLE SAFETY PROPERTY. Waiting without a bound turns a
# 57-minute window into one hung cell; this programme has already lost a window
# to an unbounded run (exit 124 at 1802s). Six minutes covers a Railway build
# (3-5 min) with a little slack, and NOTHING here waits longer.
SWAP_WAIT_BUDGET_SECONDS = 360

#: ⛔ The second context must WAIT for the control it is about to drive, never
#: sleep at it. Both budgets are >= the blind sleeps they replaced (6000 ms), so
#: the ceiling is unchanged and only the resolution improves.
SECOND_WRITER_MOUNT_MS = 20000
#: How long to let the server revision move after the door fires. Reading too
#: early yields `None -> None`, which the cell reports as "no variable" — a
#: measurement failure dressed as an experimental one.
SECOND_WRITER_REV_BUDGET_S = 20

#: ⛔ The SETUP phase must wait for the editor and for the durable write, never
#: sample at them. Both budgets are >= the blind sleeps they replace.
SETUP_EDITOR_MOUNT_MS = 16000
#: ⭐ A POLL THAT EXITS EARLY COSTS NOTHING TO LENGTHEN. This budget is only ever
#: spent by a cell that is FAILING, so a generous value slows nothing down in the
#: common case and rescues the slow one.
#: ⚰️ Raised 20 -> 45 on 2026-09-18 after `append_document_excerpt` failed twice
#: at 20s with `sentenceOnScreen` True, `dirty` True, ONE queued entry, and
#: `sentenceInDurableCopy` still False — dirty and on-screen together saying the
#: write was COMING while only the budget said otherwise.
#: ⛔ THE STATED REASON WAS WRONG, AND IS CORRECTED HERE RATHER THAN QUIETLY LEFT.
#: The raise was argued as "that family attaches a PDF, so its note is larger and
#: its write systematically slower". On the very next attempt the same cell went
#: GREEN **at the old 20s budget**. So the cause is VARIANCE, not a slow write,
#: and a second run disproved the mechanism within ten minutes of it being
#: written down — the same shape as the withdrawn "hot pod" claim earlier the
#: same day.
#: ⭐ The change still stands, on the argument that survives: a poll that exits
#: early is free, so a wider budget absorbs variance at no cost. That is a
#: different and weaker claim than the one it replaces, and it is the true one.
#: ⛔ This is NOT a licence to keep raising it. If a cell still fails at 45s with
#: dirty=True, the write is not slow — something is blocking it, and that is a
#: finding to chase rather than a number to grow.
SETUP_QUEUED_BUDGET_S = 45
SWAP_POLL_SECONDS = 10
#: How many consecutive healthy readings before a pod is called settled.
SWAP_SETTLE_READINGS = 3
#: ⛔ A pod younger than this is still booting - its first requests can 502 or
#: serve a half-warm cache, which is exactly the state that produced the
#: readings this whole mechanism exists to discard.
SWAP_MIN_UPTIME_SECONDS = 60

#: Read the pod's own health from the PAGE, so it travels the same origin,
#: cookies and CDN path the cell's real requests do. ⛔ A curl from the harness
#: would prove something about the harness's network, not the rig's.
SWAP_PROBE_JS = r"""async () => {
  const out = {t: Date.now()};
  try {
    const r = await fetch('/api/health', {credentials: 'include', cache: 'no-store'});
    out.status = r.status;
    try { const j = await r.json(); out.uptime = j.uptime_seconds; out.wire = j.wire_date; }
    catch { out.uptime = null; }
  } catch (e) { out.status = 0; out.err = String((e && e.name) || e); }
  // ⭐ The BUNDLE HASH is the browser-visible identity of a deploy. It is NOT the
  // git SHA and is never reported as one - the page cannot see a SHA. It changes
  // when a new build is served, which is exactly the question being asked.
  try {
    const html = await (await fetch('/', {cache: 'no-store'})).text();
    const m = html.match(/index-([A-Za-z0-9_-]+)\.js/);
    out.bundle = m ? m[1] : null;
  } catch { out.bundle = null; }
  return out;
}"""


#: ⛔ ONE authority for the auth read. The retry after a swap must use the SAME
#: probe as the first attempt — a second copy would let the two disagree and the
#: cell would resume on a different question than the one it refused on (R-05).
AUTH_PROBE_JS = """async () => {
  try {
    const r = await fetch('/api/auth/me', {credentials:'include'});
    return {status: r.status,
            json: (r.headers.get('content-type') || '').includes('json')};
  } catch (e) { return {status: 0, err: String(e)}; }
}"""


def swap_settled(readings, min_uptime: int = SWAP_MIN_UPTIME_SECONDS,
                 need: int = SWAP_SETTLE_READINGS):
    """Is a single, stable pod serving? → (settled, why)

    ⛔ PURE, so `--self-check` can drive every branch with planted readings and
    no browser. `readings` is oldest-first.

    ⛔ THE FIRST 200 AFTER A 502 IS NOT SETTLED, and that is the entire point.
    A swap serves: old pod 200 (uptime 3000) → 502 → new pod 200 (uptime 3).
    Accepting the first 200 back would measure a pod that is still booting.
    """
    if not readings:
        return False, "no readings at all"
    tail = readings[-need:]
    if len(tail) < need:
        return False, f"only {len(readings)} reading(s); need {need} consecutive"
    if any(r.get("status") != 200 for r in tail):
        bad = [r.get("status") for r in tail]
        return False, f"a non-200 inside the settle window: {bad}"
    ups = [r.get("uptime") for r in tail]
    if any(not isinstance(u, (int, float)) for u in ups):
        return False, f"health answered 200 without a usable uptime: {ups}"
    if ups[-1] < min_uptime:
        return False, f"uptime {ups[-1]}s < {min_uptime}s — the pod is still booting"
    # ⛔ STRICTLY increasing. Equal readings mean the clock did not move between
    # polls, which is indistinguishable from a cached response.
    if any(b <= a for a, b in zip(ups, ups[1:])):
        return False, f"uptime not strictly increasing ({ups}) — another swap in flight"
    bundles = {r.get("bundle") for r in tail if r.get("bundle")}
    if len(bundles) > 1:
        return False, f"the served bundle changed inside the window: {sorted(bundles)}"
    return True, (f"uptime {ups[0]}→{ups[-1]}s strictly monotonic over {need} readings, "
                  f"bundle {sorted(bundles)[0] if bundles else 'unreadable'}")


def wait_for_swap(page, log, budget: int = SWAP_WAIT_BUDGET_SECONDS) -> dict:
    """Poll until ONE pod is stably serving, or the budget runs out.

    → {"settled": bool, "why": str, "events": [...], "waited": float}

    ⛔ Every reading goes into `events` and every event reaches the raw artifact.
    A wait nobody can audit is a wait nobody can distinguish from a hang.
    """
    started = time.time()
    events, settled, why = [], False, "budget exhausted before a pod settled"
    while time.time() - started < budget:
        try:
            r = page.evaluate(SWAP_PROBE_JS)
        except Exception as e:                                  # noqa: BLE001
            r = {"status": 0, "err": f"{type(e).__name__}"}
        r["at"] = time.strftime("%H:%M:%SZ", time.gmtime())
        events.append(r)
        log(f"      swap-wait: status={r.get('status')} uptime={r.get('uptime')} "
            f"bundle={str(r.get('bundle'))[:10]} ({int(time.time() - started)}s)")
        settled, why = swap_settled(events)
        if settled:
            break
        page.wait_for_timeout(SWAP_POLL_SECONDS * 1000)
    return {"settled": settled, "why": why, "events": events,
            "waited": round(time.time() - started, 1)}




def rig_window_refusal(now=None, query=None):
    """The reason to refuse, or None when the window is clear.

    Derived from the SCHEDULER, never from a remembered timetable -- the sampler's
    cadence has already changed once this wave. A task whose next run cannot be
    read is treated as DUE: unknown is not clear.
    """
    import datetime
    import json
    import subprocess
    now = now or datetime.datetime.now()
    if query is None:
        def query():
            ps = (
                "Get-ScheduledTask | Where-Object { $_.TaskName -match 'WaveQ1|Wave Q1' } | "
                "ForEach-Object { $i = $_ | Get-ScheduledTaskInfo; "
                "[pscustomobject]@{name=$_.TaskName; next=$i.NextRunTime; "
                "last=$i.LastRunTime; state=[string]$_.State} } | ConvertTo-Json"
            )
            out = subprocess.run(["powershell", "-NoProfile", "-Command", ps],
                                 capture_output=True, text=True, encoding="utf-8",
                                 errors="replace", timeout=90)
            return out.stdout
    try:
        raw = query()
        data = json.loads(raw) if raw and raw.strip() else []
    except Exception as e:  # noqa: BLE001
        return ("the scheduler could not be read (" + type(e).__name__ + ") -- unknown is "
                "not clear, so the rig stays untouched")
    if isinstance(data, dict):
        data = [data]
    seen = []
    for row in data:
        name = str(row.get("name") or "")
        if name not in RIG_TASKS:
            continue
        # ⛔⛔ A TASK THAT IS RUNNING RIGHT NOW IS THE THING THIS GUARD EXISTS TO
        # AVOID, and the first version could not see it.
        #
        # ⚰️ 2026-09-13, and it cost a sampler run. The guard asked only when the
        # NEXT run is due — and once a task STARTS, its NextRunTime jumps to the
        # following slot. So at 10:05, with the 10:00 sampler still running, the
        # guard read "next run 12:00, 115 minutes away" and said CLEAR. The F5
        # run then took the one profile out from under it; the sampler died
        # mid-import, its task sat in Running for an hour, and the 10:00
        # observation row was never written. The heartbeat read
        # `267009 = SCHED_S_TASK_RUNNING`, which the Sunday gate correctly
        # reports as "the window is UNOBSERVED, not clean".
        #
        # ⭐ "Due soon" and "happening now" are different facts, and the second
        # one is the dangerous one.
        started = row.get("last")
        if started:
            txt_s = str(started)
            stamp_s = None
            if txt_s.startswith("/Date("):
                try:
                    stamp_s = datetime.datetime.fromtimestamp(
                        int(txt_s[6:].split(")")[0].split("+")[0]) / 1000)
                except (ValueError, IndexError):
                    stamp_s = None
            else:
                for fmt in ("%Y-%m-%dT%H:%M:%S", "%m/%d/%Y %I:%M:%S %p", "%Y-%m-%d %H:%M:%S"):
                    try:
                        stamp_s = datetime.datetime.strptime(txt_s.split(".")[0], fmt)
                        break
                    except ValueError:
                        continue
            if stamp_s is not None:
                since = (now - stamp_s).total_seconds()
                if 0 <= since < JUST_RAN_COOLDOWN_SECONDS:
                    return (name + " STARTED " + str(int(since)) + "s ago and may still hold the "
                            "one signed-in profile. A task that just started can still read "
                            "`Ready`, so the state alone is not enough. Wait "
                            + str(int(JUST_RAN_COOLDOWN_SECONDS - since)) + "s.")
        if str(row.get("state") or "").strip().lower() == "running":
            return (name + " is RUNNING RIGHT NOW and holds the one signed-in profile. "
                    "Wait for it to finish — taking the profile from it loses that "
                    "interval's observation row, which is a hole in the K window.")
        nxt = row.get("next")
        if not nxt:
            continue
        txt = str(nxt)
        stamp = None
        if txt.startswith("/Date("):
            try:
                stamp = datetime.datetime.fromtimestamp(int(txt[6:].split(")")[0].split("+")[0]) / 1000)
            except (ValueError, IndexError):
                stamp = None
        else:
            for fmt in ("%Y-%m-%dT%H:%M:%S", "%m/%d/%Y %I:%M:%S %p", "%Y-%m-%d %H:%M:%S"):
                try:
                    stamp = datetime.datetime.strptime(txt.split(".")[0], fmt)
                    break
                except ValueError:
                    continue
        if stamp is None:
            return "cannot read the next run time of " + name + " (" + txt + ") -- unknown is not clear"
        mins = (stamp - now).total_seconds() / 60.0
        seen.append((name, stamp, mins))
    if not seen:
        return ("no Q1 scheduled task was found at all -- that is an instrument answer, not a "
                "clear window; check the task names before running the rig")
    due = [x for x in seen if 0 <= x[2] < WINDOW_MINUTES]
    if due:
        n, st, m = min(due, key=lambda x: x[2])
        return (n + " runs at " + st.strftime("%H:%M") + ", in " + str(int(m)) + " min. "
                "It drives the SAME signed-in profile; wait for it, then re-run.")
    return None



# ==============================================================================
# THE CONTROL THAT SEPARATES THE INSTRUMENT FROM THE PRODUCT
# ==============================================================================
# A RED that cannot tell "the product lost the words" from "the rig never typed
# them" is not a finding -- it is the shape that cost this wave three deploys.
# So before the door is fired, the cell PROVES the sentence is in the durable
# working copy and that the outbox is holding work. If it is not, the cell is
# INCONCLUSIVE and names the rig as the reason.
QUEUED_JS = """async ({acct, noteId, sentence}) => {
  const open = () => new Promise((res, rej) => {
    const r = indexedDB.open('uct_notebook_' + acct);
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  let db; try { db = await open() } catch (e) { return {err: 'open failed: ' + e} }
  const all = (store) => new Promise((res) => {
    if (![...db.objectStoreNames].includes(store)) return res([]);
    const tx = db.transaction(store, 'readonly');
    const q = tx.objectStore(store).getAll();
    q.onsuccess = () => res(q.result || []); q.onerror = () => res([]);
  });
  const one = (store, key) => new Promise((res) => {
    if (![...db.objectStoreNames].includes(store)) return res(null);
    const tx = db.transaction(store, 'readonly');
    const q = tx.objectStore(store).get(key);
    q.onsuccess = () => res(q.result || null); q.onerror = () => res(null);
  });
  const outbox = await all('outbox');
  const mine = outbox.filter(e => e.noteId === noteId);
  const rec = await one('notes', noteId);
  const recText = JSON.stringify(rec || {});
  const queuedText = JSON.stringify(mine);
  // What the EDITOR currently shows, so "typed" and "stored" stay separable.
  const pm = document.querySelector('.ProseMirror');
  const onScreen = pm ? (pm.innerText || '') : null;
  // ⛔ WHY it is still queued is a different question from WHETHER it is, and
  // only the entry's own bookkeeping and the lock state can answer it.
  const entry = mine[0] || null;
  let locks = 'unread', claimable = 'unread';
  try {
    const q = await navigator.locks.query();
    locks = (q.held || []).filter(l => (l.name || '').startsWith('uct.nb.sync')).length
          + '/' + (q.pending || []).filter(l => (l.name || '').startsWith('uct.nb.sync')).length;
    claimable = await Promise.race([
      navigator.locks.request('uct.nb.sync.probe', {ifAvailable: true}, l => !!l),
      new Promise(r => setTimeout(() => r('timeout'), 1500)),
    ]);
  } catch (e) { locks = 'ERR ' + e.name }
  return {
    entryStatus: entry ? (entry.status || null) : null,
    entryAttempts: entry ? (entry.attempts ?? null) : null,
    entryError: entry ? String(entry.lastError || entry.error || '').slice(0, 80) : null,
    entryKeys: entry ? Object.keys(entry).join(',') : null,
    locksHeldPending: locks,
    lockClaimable: claimable,
    onLine: navigator.onLine,
    outboxTotal: outbox.length,
    queuedForThisNote: mine.length,
    sentenceInDurableCopy: recText.includes(sentence),
    sentenceInQueuedEntry: queuedText.includes(sentence),
    sentenceOnScreen: onScreen === null ? null : onScreen.includes(sentence),
    baseUpdatedAt: mine.length ? (mine[0].baseUpdatedAt || null) : null,
    dirty: rec ? !!rec.dirty : null,
  };
}"""


def load_state():
    if STATE.exists():
        try:
            return json.loads(STATE.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return {}
    return {}


def save_state(st):
    STATE.write_text(json.dumps(st, indent=2, sort_keys=True), encoding="utf-8")


def render(st, stamp):
    """The table. ⛔ Every one of the 42 cells prints — a row that was never run
    says `not run`, because a table that silently omits what it could not
    measure is the flattering-direction failure this programme keeps naming."""
    counts = {}
    for f, o in cells():
        v = st.get(f"{f}|{o}", {})
        counts[v.get("verdict", "not run")] = counts.get(v.get("verdict", "not run"), 0) + 1
    lines = [
        "# Q1-F5 — the seven-family x six-ordering table, ON PRODUCTION",
        "",
        f"Generated {stamp} · rig profile `canary-chrome-profile-persistent` · "
        "`https://uctintelligence.com`",
        "",
        "⛔ **Each cell is one full member interleaving**: type online, go offline, type the "
        "sentinel sentence, arrange the ordering in the durable store, come back online, fire the "
        "family's door **from its own control**, let the drain run. GREEN means the member's "
        "offline sentence is in the server's body afterwards — and for an append family, that the "
        "node the door appended is still there too.",
        "",
        "⛔ **INCONCLUSIVE is never a pass and never a finding.** A door this rig could not open "
        "names what was missing. There is no raw-`fetch` fallback: that is a second-writer "
        "simulation whose fork is correct.",
        "",
        "| " + " | ".join(["family"] + [o.split(" (")[0] for o in ORDERINGS]) + " |",
        "|" + "---|" * (len(ORDERINGS) + 1),
    ]
    for f in FAMILIES:
        row = [f"`{f}`"]
        for o in ORDERINGS:
            v = st.get(f"{f}|{o}", {})
            row.append({
                "GREEN": "✅", "RED": "🔴", "INCONCLUSIVE": "⚠️ INCONCL",
                "N/A": "— n/a", "not run": "· not run",
            }.get(v.get("verdict", "not run"), v.get("verdict", "?")))
        lines.append("| " + " | ".join(row) + " |")
    lines += ["", "## Tally", "", "| verdict | cells |", "|---|---|"]
    for k in ("GREEN", "RED", "INCONCLUSIVE", "N/A", "not run"):
        if counts.get(k):
            lines.append(f"| {k} | {counts[k]} |")
    lines += ["", "## Every cell, with its reason", "",
              "| family | ordering | verdict | what was measured |", "|---|---|---|---|"]
    for f, o in cells():
        v = st.get(f"{f}|{o}")
        if not v:
            lines.append(f"| `{f}` | {o} | · not run | — |")
            continue
        lines.append(f"| `{f}` | {o} | **{v['verdict']}** | {v.get('why', '')} |")
    return "\n".join(lines) + "\n"


# ══════════════════════════════════════════════════════════════════════════════
# one cell
# ══════════════════════════════════════════════════════════════════════════════


PURGE_JS = """async ({acct}) => {
  // ⛔ THE RIG'S OWN LITTER STALLS THE NEXT CELL. Each cell deletes the note it
  // made; the outbox entry for that note survives, and a queued write to a
  // DELETED note cannot succeed — it sits at the head of an ordered queue and
  // every later cell's entry waits behind it. Six had accumulated before this
  // was noticed, and the symptom was "the drain never finishes", which reads as
  // a product defect.
  //
  // ⛔ It removes ONLY entries whose note is gone from the server. An entry for
  // a live note is a member's unsent words, and this tool does not touch those.
  const open = () => new Promise((res, rej) => {
    const r = indexedDB.open('uct_notebook_' + acct);
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  let db; try { db = await open() } catch (e) { return {err: String(e)} }
  if (![...db.objectStoreNames].includes('outbox')) return {entries: 0, removed: 0};
  const all = await new Promise((res) => {
    const tx = db.transaction('outbox', 'readonly');
    const q = tx.objectStore('outbox').getAll();
    q.onsuccess = () => res(q.result || []); q.onerror = () => res([]);
  });
  const ids = [...new Set(all.map(e => e.noteId).filter(Boolean))];
  const dead = [];
  for (const id of ids) {
    try {
      const r = await fetch('/api/j2/notes/' + id, {credentials: 'include'});
      if (r.status === 404) dead.push(id);
    } catch { /* unknown is not dead */ }
  }
  let removed = 0;
  for (const e of all) {
    if (!dead.includes(e.noteId)) continue;
    await new Promise((res) => {
      const tx = db.transaction('outbox', 'readwrite');
      tx.objectStore('outbox').delete(e.mutationId);
      tx.oncomplete = () => { removed += 1; res(true) };
      tx.onerror = () => res(false);
    });
  }
  return {entries: all.length, deadNotes: dead.length, removed};
}"""


def _baseline_in(body: str):
    """The `baseUpdatedAt` a request actually carried, read off the wire.

    A CAS write whose baseline is absent and a CAS write whose baseline is stale
    fail the same way from the outside and are different defects.
    """
    import re
    m = re.search(r'"baseUpdatedAt"\s*:\s*("([^"]*)"|null)', body or "")
    if not m:
        return "<absent>"
    return m.group(2) if m.group(2) is not None else None


rig_ref = {}

SECOND_WRITER_ME_JS = """async () => {
  const r = await fetch('/api/auth/me', {credentials:'include'});
  const ct = r.headers.get('content-type') || '';
  // ⛔ `ok` IS NOT PROOF: this app serves an SPA catch-all, so a wrong path comes
  // back 200 text/html. Only JSON counts as an answer.
  return {status: r.status, json: ct.includes('application/json')};
}"""

SECOND_WRITER_REV_JS = """async (id) => {
  // A READ, not a door. The rule against scripted fetches governs how the
  // PRODUCT is driven; the door below is the member's own control. This only
  // asks the server what revision it now holds, which no surface reports.
  const r = await fetch('/api/j2/notes/' + id, {credentials:'include'});
  if (!r.ok) return null;
  const j = await r.json().catch(() => null);
  return j && j.note ? j.note.updatedAt : null;
}"""


def second_writer_door(page, base, note_id, log, door="folder"):
    """A SECOND context, signed in as the same rig account, moves note N's folder
    while the first context is away and offline.

    ⛔⛔ EVERY FAILURE HERE IS INCONCLUSIVE, NEVER GREEN. A second writer that
    wrote nothing leaves the cell with no variable at all, and the run would then
    measure the navigate-no-door case a second time and report it as this one —
    a fixture that cannot distinguish is not a rail. So the revision is read
    before and after, and an unmoved revision refuses the cell.

    ⛔ The session cookie is carried across programmatically and is never printed,
    logged, or written to the table. It is the rig identity, which is the only
    identity this programme is allowed to drive.
    """
    browser = page.context.browser
    if browser is None:
        return {"ok": False, "why": "no Browser handle behind this context - cannot open a second writer"}
    cookies = page.context.cookies()
    if not cookies:
        return {"ok": False, "why": "the rig context carried no cookies - a signed-out second writer changes nothing"}
    ctx2 = browser.new_context()
    try:
        ctx2.add_cookies(cookies)
        p2 = ctx2.new_page()
        p2.goto(base + "/journal/notebook?note=" + note_id, wait_until="domcontentloaded")
        me = p2.evaluate(SECOND_WRITER_ME_JS)
        if not (isinstance(me, dict) and me.get("status") == 200 and me.get("json")):
            return {"ok": False,
                    "why": ("the second context is NOT signed in (/api/auth/me " + str(me) + ") - "
                            "it would have changed nothing and the cell would have read GREEN "
                            "for the wrong reason")}
        # ⛔⛔ WAIT FOR THE CONTROL, DO NOT SLEEP AT IT. `domcontentloaded` fires
        # before React renders, and REAL_DOOR_JS does `document.querySelector("select")`
        # — a SAMPLE. A 6 s sleep therefore reported "no folder <select> on the page"
        # for an editor that mounted at 6.5 s, which reads as a product fact and is
        # not one. Measured cost: 2 of 4 cells in the settle-first chunk.
        if door == "folder":
            try:
                p2.wait_for_selector("select", timeout=SECOND_WRITER_MOUNT_MS,
                                     state="attached")
            except Exception:  # noqa: BLE001
                # ⛔ Fall through deliberately. The DOOR owns the diagnostic and
                # names exactly what was missing; a waiter that invented its own
                # message would hide a real absence behind a timeout.
                pass
        else:
            p2.wait_for_timeout(6000)
        before = p2.evaluate(SECOND_WRITER_REV_JS, note_id)
        if door == "folder":
            res = p2.evaluate(rig_ref["rig"].REAL_DOOR_JS, {"door": "folder", "value": None})
        else:
            # \u26d4 THE APPEND DOOR LIVES ON /charts AND TARGETS "Current note",
            # which resolves from localStorage 'uct.jw.lastNote' - written by the
            # EDITOR when the note is opened. Two contexts share no localStorage,
            # so opening N above is what makes "Current note" mean N here. Without
            # it the chooser offers no such option and the cell would fail for a
            # reason that has nothing to do with the product.
            p2.goto(base + "/charts", wait_until="domcontentloaded")
            # ⛔ Same class: wait for the shell to be interactive rather than
            # sleeping past it. Budget >= the 7000 ms it replaces.
            try:
                p2.wait_for_load_state("networkidle", timeout=SECOND_WRITER_MOUNT_MS)
            except Exception:  # noqa: BLE001
                p2.wait_for_timeout(7000)
            res = drive_append(p2, door, base, log)
        log("      second writer door (" + door + "): " + str(res))
        if not (isinstance(res, dict) and res.get("ok")):
            return {"ok": False,
                    "why": "the second context could not open the folder door: " + str((res or {}).get("why", res))}
        # ⛔⛔ POLL UNTIL IT MOVES, NEVER A FIXED SLEEP. A single read at 6 s
        # returns `None -> None` whenever the write has not landed yet, and the
        # cell then reports "the revision did not move ... this cell has no
        # variable" — a MEASUREMENT failure wearing an EXPERIMENTAL one's clothes.
        # Bounded, so a genuinely unmoved revision still refuses the cell.
        after = None
        _deadline = time.time() + SECOND_WRITER_REV_BUDGET_S
        while time.time() < _deadline:
            after = p2.evaluate(SECOND_WRITER_REV_JS, note_id)
            if after and after != before:
                break
            p2.wait_for_timeout(500)
        if not after or after == before:
            return {"ok": False,
                    "why": ("the second writer fired the folder door but the server's revision did "
                            "not move (" + str(before) + " -> " + str(after) + ") - this cell has no variable")}
        return {"ok": True, "via": "SECOND CONTEXT - folder door (member's own control)",
                "server_before": before, "server_after": after}
    finally:
        try:
            ctx2.close()
        except Exception:  # noqa: BLE001
            log("      (the second context would not close cleanly)")


def run_cell(rig, page, cdp, base, acct, family, ordering, stamp, log):
    rig_ref["rig"] = rig
    from_cell = time.time()
    offline = rig._offliner(cdp)
    sentence = f"{SENTINEL} {family} {ordering.split(' (')[0]} {stamp} the member's offline words"

    # !!!! READ THE WIRE, NOT THE CALL SITE. This wave published "the doors send
    # no baseline" in four artifacts while the wire said
    # `keys=['baseUpdatedAt','ticker']`. A cell that reports the member's words
    # missing must be able to say whether a PUT CARRYING THEM was ever sent, and
    # what the server answered -- otherwise "lost" and "never sent" are one
    # observation, and they have completely different fixes.
    posts: list[dict] = []

    def handler(r):
        if "/api/j2/notes" not in r.url or r.method not in ("POST", "PUT", "DELETE"):
            return
        body = ""
        try:
            body = r.post_data or ""
        except Exception:  # noqa: BLE001
            body = "<unreadable>"
        posts.append({"m": r.method, "u": r.url.split("uctintelligence.com")[-1],
                      "carries_sentence": sentence in body,
                      "body_has_sentence": '"bodyJson"' in body and sentence in body,
                      "base": _baseline_in(body), "status": None, "_req": r})

    def on_response(resp):
        # ⛔ MATCH THE REQUEST OBJECT, NEVER THE URL. Three PUTs go to the SAME
        # path in one cell, so a URL match assigns statuses to whichever entry
        # happens to be unfilled — and the whole question here is whether a
        # particular PUT got 200 or 409. An instrument that can mis-assign the
        # one number the finding turns on is not evidence.
        try:
            if "/api/j2/notes" not in resp.url:
                return
            req = resp.request
            for rec in posts:
                if rec.get("_req") is req:
                    rec["status"] = resp.status
                    return
        except Exception:  # noqa: BLE001
            pass

    page.on("request", handler)
    page.on("response", on_response)

    note_id = None
    _t0 = time.monotonic()

    def _expired(step):
        """⛔ Refuse with the STEP and the elapsed time, never silently."""
        el = time.monotonic() - _t0
        if el < PRECONDITION_BUDGET_SECONDS:
            return None
        return {"verdict": "INCONCLUSIVE",
                "why": (f"the SETUP budget of {PRECONDITION_BUDGET_SECONDS}s ran out at "
                        f"'{step}' after {el:.0f}s — nothing was measured. Setup is online "
                        f"and is not the door; a cell that cannot be set up must REFUSE, not "
                        f"hang. (the 1802s hang, 2026-09-15)")}

    try:
        # ── 0. AUTH. A signed-out rig makes every reading below meaningless, and a
        #    401 here is a different fact from a 502. Ask before spending anything. ──
        swap_events = []
        who = page.evaluate(AUTH_PROBE_JS)
        if not (isinstance(who, dict) and who.get("status") == 200 and who.get("json")):
            # ⛔⛔ A 502 IS NOT A SIGNED-OUT RIG. The first version of this refusal said
            # "the rig is not signed in" for EVERY non-200 — including the 502 it
            # actually hit, which was a deploy swap. Two materially different facts
            # rendering as one sentence is the exact ambiguity class this programme
            # has been closing all week, committed by the check written to close it.
            st = who.get("status") if isinstance(who, dict) else None
            if st in (401, 403):
                cause = ("the rig is SIGNED OUT. A sign-in is a 30-day event, not a "
                         "session event — do NOT create a new profile; a fresh profile "
                         "is a signed-out profile.")
            elif st in (500, 502, 503, 504):
                # ⛔⛔ A DEPLOY SWAP IS WAITED OUT, NOT REPORTED. Another session
                # landing on master 502s this cell for a minute or two; refusing
                # permanently threw away 22 of 23 cells on 2026-09-18. Wait for
                # ONE pod to settle, then ask again ONCE.
                log(f"      /api/auth/me → {st}: a deploy swap. Waiting for a pod to settle "
                    f"(bounded {SWAP_WAIT_BUDGET_SECONDS}s)…")
                sw = wait_for_swap(page, log)
                swap_events.append(sw)
                if sw["settled"]:
                    log(f"      settled after {sw['waited']}s — {sw['why']}; re-asking auth ONCE")
                    who = page.evaluate(AUTH_PROBE_JS)
                    if isinstance(who, dict) and who.get("status") == 200 and who.get("json"):
                        log("      auth is back — resuming the cell")
                        st = 200
                    else:
                        return {"verdict": "INCONCLUSIVE",
                                "why": (f"a deploy swap settled after {sw['waited']}s but "
                                        f"/api/auth/me still answered {who} — swap not "
                                        f"settled for THIS cell. INSTRUMENT fact, not a "
                                        f"product finding. swap events: {len(sw['events'])}")}
                else:
                    return {"verdict": "INCONCLUSIVE",
                            "why": (f"swap not settled: waited {sw['waited']}s of "
                                    f"{SWAP_WAIT_BUDGET_SECONDS}s and {sw['why']}. Another "
                                    f"session is deploying faster than a cell can run. "
                                    f"INSTRUMENT fact, NOT a product finding. "
                                    f"swap events: {len(sw['events'])}")}
                cause = ""  # handled above; flow continues with st == 200
            elif not st:
                cause = "the request never completed — no network, or the page was gone."
            else:
                cause = "an unexpected status; classify it before spending a window."
            if st != 200:
                return {"verdict": "INCONCLUSIVE",
                        "why": (f"/api/auth/me answered {st}, not 200+JSON ({who}) — "
                                f"{cause} This is an INSTRUMENT fact, NOT a product finding.")}
        x = _expired("auth check")
        if x:
            return x
        # ── 1. a probe note, created through the API. SETUP, not the door. ──
        made = page.evaluate("""async ({t}) => {
          const r = await fetch('/api/j2/notes', {method:'POST', credentials:'include',
            headers:{'Content-Type':'application/json'}, body: JSON.stringify({title: t})});
          if (!r.ok) return {err: 'HTTP ' + r.status};
          const j = await r.json().catch(() => ({}));
          return {id: j && j.note && j.note.id};
        }""", {"t": f"{SENTINEL} {family} {stamp}"})
        if not isinstance(made, dict) or not made.get("id"):
            return {"verdict": "INCONCLUSIVE",
                    "why": f"could not create the probe note ({made}) — nothing was measured"}
        note_id = made["id"]

        # ── 2. open it in the editor. This is also what makes it the append
        #      families' destination: NoteEditorPage writes `uct.jw.lastNote`. ──
        page.goto(f"{base}/journal/notebook?note={note_id}", wait_until="domcontentloaded",
                  timeout=45000)
        # ⛔ ONE PROBE IS NOT A VERDICT, here either. The editor is a lazy chunk
        # behind an auth gate; a slow first paint or a pod that has just swapped
        # loses the cell for a reason that has nothing to do with the property
        # under test. Retry the MOUNT before spending the window on it.
        #
        # ⛔⛔ WAIT FOR THE ELEMENT, DO NOT SAMPLE FOR IT. This was
        # `query_selector` inside a 5-second sleep loop - a POINT-IN-TIME check,
        # so an editor that mounted at t=8s went unseen until t=12s and one that
        # mounted at t=34s was never seen at all. Measured 2026-09-18: THREE of
        # six orderings in one folder cell died on "the editor never mounted",
        # on a run where production never swapped (zero swap-waits), so the
        # sampling was losing cells the product was ready to serve.
        #
        # ⭐ `wait_for_selector` polls continuously and returns the instant the
        # node appears. The CEILING is unchanged (~33s across two attempts and a
        # reload), so nothing that used to pass can now fail - what changes is
        # that a mount at any moment inside that ceiling is caught.
        pm = None
        for _try in range(2):
            try:
                pm = page.wait_for_selector(".ProseMirror", timeout=16000, state="attached")
            except Exception:                                # noqa: BLE001
                pm = None
            if pm is not None:
                break
            if _try == 0:
                # ⛔ One reload, and only one: a lazy chunk that failed to fetch
                # will not heal by being asked a third time, and the budget
                # belongs to the measurement.
                page.goto(f"{base}/journal/notebook?note={note_id}",
                          wait_until="domcontentloaded")
        if pm is None:
            return {"verdict": "INCONCLUSIVE",
                    "why": "the editor never mounted for the probe note after 4 tries and a "
                           "reload — nothing was measured"}
        x = _expired("editor mount")
        if x:
            return x
        pm.click()
        page.keyboard.type(f"{SENTINEL} baseline {stamp}.")
        page.wait_for_timeout(5000)

        # -- 2b. anything this family's door needs in place, while ONLINE --
        prep = prepare_family(page, family, note_id, stamp, log, rig=rig, base=base)
        if not prep.get("ok"):
            return {"verdict": "INCONCLUSIVE",
                    "why": f"the `{family}` door could not be set up: {prep.get('why')}"}
        warmed = warm_route(page, family, base, log)
        if warmed.get("warmed"):
            log(f"      warmed {warmed['warmed']}, back to the editor")
            page.goto(f"{base}/journal/notebook?note={note_id}", wait_until="domcontentloaded")
            page.wait_for_timeout(6000)

        # ── 3. offline, and the member types the words the property is about ──
        offline(True)
        page.wait_for_timeout(900)
        probe = page.evaluate(rig.PROBE)
        if not str(probe).startswith("FAILED"):
            return {"verdict": "INCONCLUSIVE",
                    "why": f"CDP did not cut the transport (`{probe}`) — the offline half never happened"}
        # ⛔⛔ WAIT for the editor, never SAMPLE for it. With query_selector a
        # transiently-unmounted editor makes `pm` None, the typing is SKIPPED, and
        # the cell then reports "the rig never got the sentence into a queued outbox
        # entry" — true, and naming the wrong cause: it reads as a STORE problem when
        # the store was never asked to hold anything. Measured 2026-09-18 on `tags`
        # (on screen: None, entries: 0).
        try:
            pm = page.wait_for_selector(".ProseMirror", timeout=SETUP_EDITOR_MOUNT_MS,
                                        state="attached")
        except Exception:  # noqa: BLE001
            pm = None
        if pm is None:
            # ⛔ Say THIS, not "the sentence never reached the store". An editor that
            # never mounted is a different fact with a different fix.
            return {"verdict": "INCONCLUSIVE",
                    "why": (f"the editor never mounted within "
                            f"{SETUP_EDITOR_MOUNT_MS}ms of going offline, so the sentence "
                            f"was never typed — an INSTRUMENT answer, not a finding")}
        pm.click()
        page.keyboard.press("End")
        page.keyboard.type(" " + sentence)

        # ── 3b. THE CONTROL: are the member's words actually queued? ──
        # ⛔⛔ POLL UNTIL IT LANDS, never a single read after a fixed sleep. The
        # durable write is asynchronous, so one read 6s after typing reports a
        # not-yet-flushed write as ABSENT. Measured on `append_document_excerpt`:
        # on screen True, 1 queued entry, and the durable copy simply had not
        # caught up at the instant of the read.
        # ⛔ This does NOT weaken the control — a sentence that never lands still
        # refuses the cell at the end of the budget. It stops refusing cells where
        # the sentence landed a second after the rig happened to look.
        q = None
        _qdeadline = time.time() + SETUP_QUEUED_BUDGET_S
        while time.time() < _qdeadline:
            q = page.evaluate(QUEUED_JS, {"acct": acct, "noteId": note_id,
                                          "sentence": sentence})
            if isinstance(q, dict) and q.get("sentenceInQueuedEntry"):
                break
            if isinstance(q, dict) and q.get("err"):
                break  # a store that cannot be READ is not a store that is EMPTY
            page.wait_for_timeout(500)
        log(f"      queued: {q}")
        if not isinstance(q, dict) or q.get("err"):
            return {"verdict": "INCONCLUSIVE",
                    "why": f"the durable store could not be read ({q}) — nothing was measured"}
        if not q.get("sentenceInQueuedEntry"):
            # ⛔ THE RIG, NOT THE PRODUCT. Without this the cell would report the
            # member's words lost when they were never typed — a product finding
            # manufactured by the instrument, which is this wave's signature error.
            return {"verdict": "INCONCLUSIVE",
                    "why": (f"the rig never got the sentence into a queued outbox entry "
                            f"(on screen: {q.get('sentenceOnScreen')}, in durable copy: "
                            f"{q.get('sentenceInDurableCopy')}, entries for this note: "
                            f"{q.get('queuedForThisNote')}) — an INSTRUMENT answer, not a finding")}
        queued_note = (f"queued {q.get('queuedForThisNote')} entry(s), "
                       f"baseline `{q.get('baseUpdatedAt')}`")

        # ── 4. arrange the ordering in the durable store ──
        arr = page.evaluate(ARRANGE_JS, {"acct": acct, "noteId": note_id,
                                         "ordering": ordering, "ttl": 10000})
        log(f"      arranged: {arr}")
        if not (isinstance(arr, dict) and arr.get("ok")):
            return {"verdict": "INCONCLUSIVE",
                    "why": f"the ordering could not be arranged ({arr}) — the cell models nothing"}

        # ── 5. the door. For an append family the surface change happens
        #      OFFLINE (pushState, warmed chunk), so the click lands the instant
        #      the transport returns and the drain has no head start.
        nav_note = ""
        # ⭐ THE ROUTE CHANGE AS A CONTROLLED VARIABLE, not a property of the
        # family. `folder` is GREEN without it and `append_widget_embed` is RED
        # with it — but those cells differ in TWO ways at once, which settles
        # nothing. Forcing the same offline route change onto a door this rig can
        # drive perfectly isolates it: if folder goes RED with the navigation,
        # the navigation is the cause and the family is irrelevant.
        if FORCE_NAV.get("on") and family not in WARM_ROUTES:
            WARM_ROUTES[family] = FORCE_NAV["path"]
        if family in WARM_ROUTES:
            navd = page.evaluate(SPA_NAV_JS, {"path": WARM_ROUTES[family]})
            nav_note = f" · navigated offline to {navd}"
            log(f"      offline nav: {navd}")
            if not (isinstance(navd, dict) and navd.get("path") == WARM_ROUTES[family]):
                return {"verdict": "INCONCLUSIVE",
                        "why": (f"the offline route change to {WARM_ROUTES[family]} did not take "
                                f"({navd}) — the door was never reachable with work still queued")}
        # ⛔ "DID THE DRAIN WIN?" IS ABOUT A SUCCESSFUL SEND, NOT AN ATTEMPT.
        #
        # ⚰️ This counted every note PUT issued before the door — including the
        # three that failed BECAUSE WE WERE OFFLINE, which is the normal shape of
        # every cell. So the metadata control, whose wire shows the product doing
        # exactly the right thing (409 → rebase → 200 carrying the sentence), was
        # reported INCONCLUSIVE "the drain sent it before the door fired". A guard
        # that fires on the healthy case is worse than no guard: it hides the
        # measurement it was written to protect.
        door_at = len(posts)
        landed_before = [p for p in posts
                         if p.get("carries_sentence") and isinstance(p.get("status"), int)
                         and 200 <= p["status"] < 300]
        # ⛔ THE ORDER IS THE EXPERIMENT. Every other cell reconnects here and
        # then fires its door. Second-writer-while-away must stay OFFLINE while
        # the other device writes — that is what "while away" means — and
        # reconnects only after returning to the note, exactly as ruled:
        # queue offline · navigate away · second writer moves the server ·
        # return · reconnect · drain.
        if not SECOND_WRITER["on"]:
            offline(False)
        before_door = len(landed_before)
        if SECOND_WRITER["on"]:
            res = second_writer_door(page, base, note_id, log,
                                     door=SECOND_WRITER["door"])
        elif NO_DOOR["on"]:
            # ⛔ NOTHING IS FIRED. The navigation already happened above; this
            # cell's whole content is the absence of a door.
            res = {"ok": True, "via": "NO DOOR — navigation only"}
        elif family in METADATA:
            if family == "hero":
                res = rig._fire_hero_door(page)
            else:
                val = f"F5{stamp[-4:]}" if family == "ticker" else f"f5-{stamp[-4:]}"
                res = page.evaluate(rig.REAL_DOOR_JS, {"door": family, "value": val})
        else:
            res = drive_append(page, family, base, log)
        log(f"      door: {res}")
        if SECOND_WRITER["on"] and isinstance(res, dict) and res.get("ok"):
            # the server has moved; the member's transport comes back, and only
            # THEN do they navigate back to the note
            offline(False)
            log("      reconnected (server has moved; now the member returns)")

        if not (isinstance(res, dict) and res.get("ok")):
            why = (res or {}).get("why", res)
            tag = "rig limitation" if (res or {}).get("rig_limitation") else "not opened"
            return {"verdict": "INCONCLUSIVE",
                    "why": f"the `{family}` door was {tag}: {why}"}

        page.wait_for_timeout(5000)

        # For an append family the row only counts if its OWN endpoint was hit.
        if family in APPEND and not (NO_DOOR["on"] or SECOND_WRITER["on"]):
            hit = [p for p in posts if ENDPOINT[family] in p["u"]]
            # ⛔ READ THE TOAST BEFORE JUDGING THE ABSENCE OF A CALL. Since D1
            # the chokepoint defers while a note has unsent work, so "no call"
            # is now THREE different facts and the cell must name which.
            rendered = None
            try:
                got = page.evaluate(GUARD_TOAST_JS)
                rendered = (got or {}).get("text")
            except Exception as e:                       # noqa: BLE001
                log(f"      guard toast: UNREADABLE ({type(e).__name__})")
            expected = guard_sentence()
            if expected is None:
                log("      guard toast: the product's sentence could not be DERIVED "
                    "— treating the toast as unseen rather than guessing it")
            seen = toast_in(rendered, expected)
            q_now = page.evaluate(QUEUED_JS, {"acct": acct, "noteId": note_id,
                                              "sentence": sentence})
            queued_now = (q_now or {}).get("queuedForThisNote") or 0
            log(f"      guard toast seen: {seen} · queued for this note: {queued_now} "
                f"· {ENDPOINT[family]} calls: {len(hit)}")
            verdict, why = judge_append_door(endpoint_hits=len(hit), toast_seen=seen,
                                             queued_for_note=queued_now)
            if verdict is not None:
                return {"verdict": verdict,
                        "why": (f"{why} · door via {res.get('via', 'n/a')} · "
                                f"note calls this cell: {len(posts)} · "
                                f"toast: {'\u201c' + expected + '\u201d' if seen else 'not on screen'}")}

        # ── 5b. WAIT FOR THE DRAIN TO ACTUALLY FINISH ──────────────────
        #
        # ⛔⛔ READING THE SERVER WHILE WORK IS STILL QUEUED MEASURES THE CLOCK,
        # NOT THE PRODUCT. Measured 2026-09-13: three PUTs carrying the member's
        # sentence were still in flight when the cell read the server, the words
        # were absent, and the cell called it RED — a product defect invented by
        # reading too early. (The same run also had the statuses mis-assigned by
        # URL, which dressed those PUTs as 200s. Two instrument faults pointing
        # the same way is how a finding gets published.)
        #
        # ⭐ "Gone" and "late" are different findings, so the cell waits for the
        # queue to empty and says so when it does not.
        # ⭐ THE DRAIN RUNS WHERE THE NOTEBOOK IS MOUNTED. Measured 2026-09-13:
        # after the door fired on /charts the entry was STILL QUEUED 60s later —
        # not a stall, just nothing there to drive it. A member who sends a chart
        # to their journal has that queued edit drained when they go back to the
        # Notebook, so the cell does what the member does.
        # ⭐ HOW THE RUN RETURNS IS THE VARIABLE UNDER TEST.
        #
        # The embed cell differs from the GREEN metadata cell in TWO ways at
        # once: it leaves the Notebook, and it comes BACK through a document
        # load. A document load tears the whole app down and rebuilds it from
        # the server; an SPA route change does not. `--spa-return` changes only
        # the second of those, so a colour change between the two runs names the
        # document load and nothing else.
        # ⛔⛔ ONLY RETURN IF WE LEFT. Caught before this ran, 2026-09-13:
        # this navigation was UNCONDITIONAL, so the excerpt cell — whose whole
        # purpose is to fire an append door WITHOUT leaving the note — would have
        # been remounted anyway, by the instrument. It would have gone RED for
        # the instrument's reason, and the reading would have been "both RED, so
        # the mechanism is wider than unmount": a false widening of a real
        # finding, produced by the tool that was measuring it.
        #
        # ⭐ THE TELL: a step that changes the surface must ask whether IT changed
        # the surface. `family in WARM_ROUTES` is the same predicate that decided
        # to leave, so the two cannot disagree.
        navigated_away = family in WARM_ROUTES
        if navigated_away:
            if SPA_RETURN["on"]:
                back = page.evaluate(SPA_NAV_JS, {"path": f"/journal/notebook?note={note_id}"})
                log(f"      SPA return (no document load): {back}")
            else:
                page.goto(f"{base}/journal/notebook?note={note_id}", wait_until="domcontentloaded")
            page.wait_for_timeout(6000)
        else:
            log("      stayed on the note — no return navigation (this is the variable)")
            page.wait_for_timeout(2000)

        # ⛔⛔ THE EDITOR OWNS ITS OWN NOTE, so the drain SKIPS it (`excludeNoteId`).
        # Measured 2026-09-13: after returning to the note, nothing was sent for
        # 120s — the entry was not stuck, it was simply not the drain's to send,
        # and the editor does not re-save content it did not change. Sitting on
        # the note is therefore a state in which queued words never leave.
        #
        # ⭐ So the cell does what a member does next: it leaves the note. That
        # releases the entry to the drain WITHOUT firing any door, which is the
        # only way this experiment can reach the question it is asking.
        # ⛔ RECONNECT ONLY NOW, and only for this cell. The member came back to a
        # note whose server copy moved while they were away, and only then did the
        # transport return.
        # ⛔⛔ THE EDITOR OWNS ITS OWN NOTE, so the drain SKIPS it (`excludeNoteId`)
        # and sitting on the note is a state in which queued words never leave.
        # Both of these cells therefore do what a member does next — leave —
        # which releases the entry WITHOUT firing any door in this context.
        # ⭐ Identical in both cells, so it cannot be the difference between them.
        if NO_DOOR["on"] or SECOND_WRITER["on"]:
            page.goto(f"{base}/journal/notebook", wait_until="domcontentloaded")
            page.wait_for_timeout(5000)
            log("      released the note (editor closed) so the drain may take the entry")
        # ⛔ WATCH THE STORE, NOT JUST THE CLOCK. "The outbox emptied" has two
        # completely different causes and the same appearance:
        #   SENT       the entry went out and the server took the words
        #   SUPERSEDED the drain DELETED it, because a save this browser landed
        #              later — a TIMESTAMP comparison that never asks whether
        #              that save contains these words (`outboxDrain.js`, the
        #              `isSupersededBaseline` branch)
        # Polling the record's `dirty`/`baseUpdatedAt` alongside the queue catches
        # the transition in the act, so the cell can NAME which one happened.
        drained, waited = False, 0
        trail = []
        for _ in range(48):
            page.wait_for_timeout(2500)
            waited += 2.5
            q2 = page.evaluate(QUEUED_JS, {"acct": acct, "noteId": note_id, "sentence": sentence})
            if isinstance(q2, dict):
                snap = (q2.get("queuedForThisNote"), q2.get("dirty"),
                        str(q2.get("baseUpdatedAt"))[-8:],
                        q2.get("sentenceInDurableCopy"))
                if not trail or trail[-1] != snap:
                    trail.append(snap)
            if isinstance(q2, dict) and q2.get("queuedForThisNote") == 0:
                drained = True
                break
        log(f"      store trail (queued, dirty, base, sentence-in-record): {trail}")
        log(f"      drain: {'emptied' if drained else 'STILL QUEUED'} after {waited}s")
        # The record going CLEAN at a newer baseline while the entry is still
        # queued is the supersede precondition, caught as it happens.
        went_clean = any(t[1] in (0, False) for t in trail[1:]) if len(trail) > 1 else False
        lost_locally = any(t[3] is False for t in trail[1:]) if len(trail) > 1 else False
        if not drained:
            # ⛔ AN INCONCLUSIVE CELL STILL OWES ITS EVIDENCE. The first version
            # returned before computing the wire, so the one run that most needed
            # explaining produced the least. What is queued, what went out, and
            # what the record holds are facts whether or not the drain finished.
            w = " · ".join(f"{q['m']} {q['u'].replace('/api/j2/notes','')[:40] or '/'}"
                           f"{'+SENT' if q.get('carries_sentence') else ''}"
                           f"→{q.get('status')}" for q in posts) or "no note calls"
            log(f"      wire: {w}")
            return {"verdict": "INCONCLUSIVE",
                    "why": (f"the outbox still held this note's entry after {waited}s — the drain "
                            f"had not finished, so the server read would measure the clock rather "
                            f"than the product. Not 'lost'; not yet delivered. "
                            f"⭐ store trail: {trail} · wire: {w}")}

        # ── 6. read the SERVER (the editor is already open on the note) ──
        served = page.evaluate("""async (id) => {
          try {
            const r = await fetch('/api/j2/notes/' + id, {credentials:'include'});
            const t = await r.text();
            if (!r.ok) return {readFailed: 'HTTP ' + r.status};
            try { return {note: JSON.parse(t).note} }
            catch { return {readFailed: 'not JSON: ' + t.slice(0, 40)} }
          } catch (e) { return {readFailed: String((e && e.name) || e)} }
        }""", note_id)
        if not isinstance(served, dict) or served.get("readFailed"):
            # ⛔ A LAYER THAT COULD NOT BE READ IS NOT A LAYER THAT IS EMPTY.
            return {"verdict": "INCONCLUSIVE",
                    "why": (f"the server copy could not be read after the drain "
                            f"({(served or {}).get('readFailed')}). A deploy blip looks exactly "
                            f"like this — re-run; do NOT record it as words that were lost")}

        note = served.get("note") or {}
        body = json.dumps(note.get("bodyJson") or note.get("body") or {})
        survived = sentence in body
        # ⛔ WHEN A MEMBERSHIP TEST SAYS "NO", PRINT THE HAYSTACK. Three separate
        # explanations for this RED were plausible from the outside — smart
        # quotes rewriting the apostrophe, the door landing on a different note,
        # the drain never writing — and none of them is distinguishable from
        # `sentence in body == False`. The body itself separates them in one run.
        if not survived:
            import re as _re
            plain = _re.sub(r'"[a-zA-Z]+":', '', body)
            log(f"      body ({len(body)}B): {plain[:400]}")
            log(f"      looking for: {sentence!r}")
            log(f"      stem 'F5-MATRIX' present: {'F5-MATRIX' in body} · "
                f"'offline words' present: {'offline words' in body}")
        boxes = page.evaluate(OUTBOX_JS, {"acct": acct})

        # Did the door's own node survive the drain? Only an append family has one.
        node_ok, node_note = True, ""
        if family in APPEND and not (NO_DOOR["on"] or SECOND_WRITER["on"]):
            marks = {"append_widget_embed": "widgetEmbed",
                     "append_financial_fact": "financialFact",
                     "append_document_excerpt": "documentExcerpt"}
            node_ok = marks[family].lower() in body.lower()
            node_note = f" · appended node present: **{node_ok}**"

        forks = page.evaluate("""async (s) => {
          const r = await fetch('/api/j2/notes?limit=100', {credentials:'include'});
          if (!r.ok) return -1;
          const j = await r.json().catch(() => ({notes: []}));
          return (j.notes || []).filter(n => (n.title || '').includes('conflicted copy')
                                          && (n.title || '').includes(s)).length;
        }""", SENTINEL)

        carrying = [p for p in posts if p.get("carries_sentence")]
        # ⛔ EVERY CALL, NOT THE FIRST TEN. A truncated wire is how an
        # ordering question gets answered from the half that happened to fit.
        wire = " · ".join(f"{p['m']} {p['u'].replace('/api/j2/notes','')[:46] or '/'}"
                          f"{'+SENT' if p.get('carries_sentence') else ''}"
                          f"{'' if p.get('base') == '<absent>' else '[' + str(p.get('base'))[-8:] + ']'}"
                          f"→{p.get('status')}" for p in posts) or "no note calls"
        log(f"      wire: {wire}")
        log(f"      the door fired after call #{door_at}; "
            f"successful sends carrying the sentence before it: {before_door}")
        # ⛔ "LOST" AND "NEVER SENT" ARE DIFFERENT FINDINGS. If no request ever
        # carried the sentence, the drain did not lose the member's words -- it
        # never offered them, and the defect is upstream of the merge.
        sent_note = (f"{len(carrying)} request(s) carried the sentence"
                     + (f" (last → {carrying[-1].get('status')})" if carrying else
                        " — **the words were never put on the wire**"))
        ok = survived and node_ok and forks == 0 and (boxes or {}).get("conflicts", 0) == 0
        why = (f"offline sentence in the server body: **{survived}**{node_note} · "
               f"{queued_note} · {sent_note} · "
               f"record went CLEAN while queued: **{went_clean}** · "
               f"sentence left the durable record: **{lost_locally}** · "
               f"store trail: {trail} · wire: {wire} · "
               f"forks: {forks} · outbox left: {(boxes or {}).get('outbox')} · "
               f"conflicts: {(boxes or {}).get('conflicts')} · "
               f"door via {res.get('via', 'n/a')} · sends before the door: {before_door}"
               f" · left the note: **{navigated_away}**"
               f"{nav_note} · {int(time.time() - from_cell)}s"
               # ⛔ A CELL THAT SURVIVED A DEPLOY SWAP SAYS SO IN ITS OWN ROW.
               # Otherwise a GREEN taken across somebody else's deploy is
               # indistinguishable from one taken on a quiet box, and the next
               # reader cannot weigh it.
               + (f" · ⚠️ survived {len(swap_events)} deploy swap(s): "
                  + "; ".join(f"waited {e['waited']}s, {e['why']}" for e in swap_events)
                  if swap_events else ""))
        # ⛔ And it is only a spoiled cell if the words LANDED first. A door that
        # fired after a failed attempt still met queued work, which is the case
        # the matrix is about.
        if before_door and ok:
            # THE DRAIN WON, so this cell proves the product is fine in a case it
            # was not asked about. Green here would be a green for the wrong
            # reason -- the one failure mode a matrix cannot afford.
            return {"verdict": "INCONCLUSIVE",
                    "why": ("the drain sent the queued entry BEFORE the door fired "
                            f"({before_door} send(s)) — the door never met queued work, so this "
                            f"cell measured nothing. {why}")}
        out = {"verdict": "GREEN" if ok else "RED", "why": why}
        # ⛔ THE RING IS EVIDENCE, NOT A VERDICT. It is attached beside the
        # verdict and never allowed to change it: an instrument that can move the
        # answer it is measuring is not an instrument.
        try:
            import q1_write_trace as _wt
            got = _wt.read_ring(page)
            if got.get("ring"):
                # ⛔⛔ R-RAW: THE RAW RING HITS DISK BEFORE summarise() IS CALLED.
                # ⚰️ On 2026-09-15 this window produced the decisive ring, `summarise()`
                # surfaced only the dirty flips, and the rest was discarded in the same
                # breath — the one fact the window was spent to obtain was computed,
                # displayed and destroyed. Two days later no raw ring existed anywhere on
                # disk and `sentence_lost_writes` had never been read from a real run.
                # The ORDER is the rule: write, then interpret.
                try:
                    _ev = pathlib.Path(os.environ.get("UCT_EVIDENCE_DIR")
                                       or (REPO / "docs" / "notebook" / "evidence" / "manual"))
                    _ev.mkdir(parents=True, exist_ok=True)
                    _stamp = f"{family}-{str(ordering).split(' ')[0]}-{int(time.time())}"
                    _raw = _ev / f"ring-{_stamp}.json"
                    _raw.write_text(json.dumps(
                        {"family": family, "ordering": ordering, "installed": got.get("installed"),
                         "ring": got["ring"]}, indent=2), encoding="utf-8", newline=chr(10))
                    log(f"      💾 raw ring -> {_raw.name} ({len(got['ring'])} write(s))")
                except OSError as _e:
                    # ⛔ A ring that could not be written is INCONCLUSIVE evidence, and
                    # saying so beats letting the summary stand in for the artifact.
                    log(f"      ⛔ RAW RING NOT WRITTEN ({_e}) — this reading is R-RAW INCONCLUSIVE")
                s = _wt.summarise(got["ring"])
                out["write_trace"] = s
                log(f"      write trace: {s['writes_total']} write(s), "
                    f"{s['notes_writes']} to notes, {s['outbox_writes']} to outbox, "
                    f"{len(s['dirty_flips_true_to_false'])} dirty flip(s) true->false")
                for _w in s.get("sentence_lost_writes", []):
                    log(f"      ⭐ SENTENCE LOST: {_w.get('store')}.{_w.get('method')} "
                        f"rec={_w.get('rec')}")
                    log(f"         stack: {str(_w.get('stack'))}")
                for _w in s["dirty_flips_true_to_false"]:
                    log(f"      ⭐ DIRTY FLIP: {_w.get('store')}.{_w.get('method')} "
                        f"rec={_w.get('rec')}")
                    log(f"         stack: {str(_w.get('stack'))}")
        except Exception as _e:  # noqa: BLE001
            log(f"      (write trace unavailable: {_e})")
        return out

    finally:
        for evt, fn in (("request", handler), ("response", on_response)):
            try:
                page.remove_listener(evt, fn)
            except Exception:  # noqa: BLE001
                pass
        try:
            offline(False)
        except Exception:  # noqa: BLE001
            pass
        # ⛔ EVERY NOTE THIS CELL MADE, REMOVED — including any fork it produced.
        if note_id:
            try:
                left = page.evaluate("""async (s) => {
                  const r = await fetch('/api/j2/notes?limit=200', {credentials:'include'});
                  if (!r.ok) return {err: r.status};
                  const j = await r.json().catch(() => ({notes: []}));
                  const mine = (j.notes || []).filter(n => (n.title || '').includes(s));
                  let gone = 0;
                  for (const n of mine) {
                    const d = await fetch('/api/j2/notes/' + n.id, {method:'DELETE', credentials:'include'});
                    if (d.ok) gone += 1;
                  }
                  return {found: mine.length, deleted: gone};
                }""", SENTINEL)
                log(f"      cleanup: {left}")
            except Exception as e:  # noqa: BLE001
                log(f"      ⛔ cleanup failed ({type(e).__name__}) — orphans may remain")


def _self_check() -> int:
    """⛔ THE FOURTH OUTCOME, DRIVEN WITHOUT A BROWSER, WITH PLANTED DOM.

    `toast_in` and `judge_append_door` are pure for exactly this reason: a
    verdict nobody has watched fail is not a verdict
    (`lesson_gate_that_cannot_fail`).
    """
    fails = []
    real = guard_sentence()
    if not real:
        fails.append("the product's deferral sentence could not be DERIVED from "
                     "noteHasUnsentWork.js — the cell would treat every deferral as "
                     "a silent nothing")
        real = "This note is still syncing"          # keep the rest of the cases runnable

    # planted DOM, in the three shapes a real page can take
    PAGE_WITH_TOAST = f"Notebook\nMy note\n{real}\nOther chrome"
    PAGE_SILENT = "Notebook\nMy note\nOther chrome"

    cases = [
        # (endpoint_hits, page text, queued, expected verdict, why-this-case-exists)
        (0, PAGE_WITH_TOAST, 1, DEFERRED,
         "toast + no call + queued work is the mitigation working"),
        (1, PAGE_SILENT, 1, None,
         "a real call must PROCEED to the ordinary RED/GREEN path, guard or no guard"),
        (0, PAGE_SILENT, 1, "INCONCLUSIVE",
         "a SILENT nothing is not a deferral — it is unmeasured"),
        (0, PAGE_WITH_TOAST, 0, "INCONCLUSIVE",
         "a toast with NOTHING queued cannot be told from a false defer"),
        (0, None, 1, "INCONCLUSIVE",
         "an UNREADABLE page is not an absent toast"),
        (1, PAGE_WITH_TOAST, 1, None,
         "a call PLUS a toast still proceeds — the call is what the cell is about"),
    ]
    for hits, page_text, queued, want, why in cases:
        got, _ = judge_append_door(endpoint_hits=hits,
                                   toast_seen=toast_in(page_text, real),
                                   queued_for_note=queued)
        if got != want:
            fails.append(f"{why}: expected {want!r}, got {got!r}")

    # ── SWAP RESILIENCE, driven with planted readings and no browser ────────
    U = lambda st, up, b='abc': {'status': st, 'uptime': up, 'bundle': b}
    swap_cases = [
        # (readings, expect_settled, why-this-case-exists)
        ([U(200, 120), U(200, 130), U(200, 140)], True,
         'three healthy readings on one stable pod is settled'),
        ([U(200, 3000), U(0, None), U(200, 3)], False,
         '⛔ THE FIRST 200 AFTER A 502 IS NOT SETTLED - the new pod is 3s old'),
        ([U(200, 10), U(200, 20), U(200, 30)], False,
         'a pod under the uptime floor is still booting, however monotonic'),
        ([U(200, 120), U(200, 130), U(200, 5)], False,
         'a RESET inside the window means another swap landed mid-wait'),
        ([U(200, 120), U(200, 130), U(200, 130)], False,
         'equal uptimes are indistinguishable from a cached response'),
        ([U(200, 120), U(502, None), U(200, 140)], False,
         'a non-200 inside the settle window voids it'),
        ([U(200, 120, 'aaa'), U(200, 130, 'aaa'), U(200, 140, 'bbb')], False,
         '⛔ the served BUNDLE changing mid-window is a deploy landing under us'),
        ([U(200, 120), U(200, 130)], False,
         'two readings are not three - the window must be full'),
        ([], False, 'no readings at all cannot be settled'),
        ([{'status': 200, 'uptime': None}, {'status': 200, 'uptime': None},
          {'status': 200, 'uptime': None}], False,
         '200 without a usable uptime is not evidence of a settled pod'),
    ]
    for readings, want, why in swap_cases:
        got, _ = swap_settled(readings)
        if got is not want:
            fails.append(f'SWAP {why}: expected settled={want}, got {got}')

    # ⛔ NON-VACUITY: the settle rule must actually be capable of BOTH answers.
    if not swap_settled([U(200, 120), U(200, 130), U(200, 140)])[0]:
        fails.append('SWAP: the happy path cannot settle — the rule can only say no')
    if swap_settled([U(200, 1), U(200, 2), U(200, 3)])[0]:
        fails.append('SWAP: a freshly-booted pod settled — the uptime floor is inert')

    # ⛔ THE BUDGET IS THE SAFETY PROPERTY. A permanent 502 must end BOUNDED.
    if SWAP_WAIT_BUDGET_SECONDS > 420:
        fails.append(f'SWAP: the wait budget {SWAP_WAIT_BUDGET_SECONDS}s is long enough '
                     'to eat a rig window; this programme has already lost one to an '
                     'unbounded run')

    # ⛔⛔ THE MUTATION CONTROL, run in-process: with toast detection removed the
    # DEFERRED case MUST NOT pass. A cell that answers DEFERRED without reading
    # the copy contract is asserting the member saw something nobody checked.
    blind, _ = judge_append_door(endpoint_hits=0, toast_seen=False, queued_for_note=1)
    if blind == DEFERRED:
        fails.append("MUTATION CONTROL: with the toast unseen the cell still answered "
                     "DEFERRED-BY-GUARD — the copy contract is decorative")

    # ⛔ and the derivation itself must be able to fail
    if toast_in(PAGE_WITH_TOAST, None) or toast_in(None, real):
        fails.append("toast_in must answer False when either half is missing")

    for f in fails:
        print("  \u26d4", f)
    print("self-check:",
          "PASS — the fourth outcome distinguishes a deferral, a real call, a silent "
          "nothing and a false defer, and cannot answer DEFERRED without the toast"
          if not fails else "FAIL")
    return 1 if fails else 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--profile")
    ap.add_argument("--base", default="https://uctintelligence.com")
    ap.add_argument("--family", choices=sorted(FAMILIES))
    ap.add_argument("--ordering")
    ap.add_argument("--resume", action="store_true")
    ap.add_argument("--out", default=str(DEFAULT_OUT))
    ap.add_argument("--render-only", action="store_true")
    ap.add_argument("--trace-writes", action="store_true",
                    help="install the rig-side IndexedDB write trace (evidence only)")
    ap.add_argument("--navigate-no-door", metavar="PATH", nargs="?", const="/charts",
                    help="leave the note and come back WITHOUT firing any door. The "
                         "cell that separates navigation from the append families. "
                         "A CONTROLLED EXPERIMENT, never a table row.")
    ap.add_argument("--second-writer", metavar="PATH", nargs="?", const="/charts",
                    help="queue an offline edit, leave the note, have a SECOND signed-in "
                         "browser context move the note's folder while away, return, "
                         "reconnect, drain. Isolates 'the server moved' from 'we "
                         "navigated'. A CONTROLLED EXPERIMENT, never a table row.")
    ap.add_argument("--second-writer-door", default="folder",
                    choices=["folder", "append_widget_embed"],
                    help="which door the SECOND context fires. `folder` is the settled "
                         "metadata door (that cell is GREEN). `append_widget_embed` is the "
                         "DISCRIMINATING cell: if firing the append door from a second "
                         "context is GREEN, the first context's own handling of the append "
                         "response is the mechanism.")
    ap.add_argument("--spa-return", action="store_true",
                    help="come back to the Notebook by SPA route change instead "
                         "of a document load. A CONTROLLED EXPERIMENT, never a row.")
    ap.add_argument("--force-nav", metavar="PATH",
                    help="apply the offline route change to EVERY family, so the "
                         "navigation can be isolated from the family. Marks the "
                         "cell so it is never mistaken for a plain row.")
    ap.add_argument("--self-check", action="store_true",
                    help="drive the fourth outcome against planted DOM; no browser")
    ap.add_argument("--ignore-window", action="store_true",
                    help="run anyway. Only for a window verified by hand; "
                         "the refusal names the task it is protecting.")
    args = ap.parse_args()
    if getattr(args, "self_check", False):
        return _self_check()

    if args.second_writer:
        SECOND_WRITER["door"] = args.second_writer_door
        SECOND_WRITER["on"] = True
        SECOND_WRITER["path"] = args.second_writer
        WARM_ROUTES.clear()
        for f in list(METADATA) + list(APPEND):
            WARM_ROUTES[f] = args.second_writer
        print(f"⚠️ SECOND-WRITER-WHILE-AWAY: queue offline, leave to "
              f"{args.second_writer}, a SECOND signed-in context moves the folder, return, "
              f"reconnect, drain. CONTROLLED EXPERIMENT, not a table row.")
    if args.navigate_no_door:
        NO_DOOR["on"] = True
        NO_DOOR["path"] = args.navigate_no_door
        WARM_ROUTES.clear()
        for f in list(METADATA) + list(APPEND):
            WARM_ROUTES[f] = args.navigate_no_door
        print(f"⚠️ NAVIGATE-NO-DOOR: leave the note to {args.navigate_no_door} and come "
              f"back, firing NOTHING. CONTROLLED EXPERIMENT, not a table row.")
    if args.spa_return:
        SPA_RETURN["on"] = True
        FORCE_NAV["on"] = FORCE_NAV["on"]  # independent switches
        print("⚠️ SPA RETURN: the run comes back without a document load. "
              "CONTROLLED EXPERIMENT, not a table row.")
    if args.force_nav:
        FORCE_NAV["on"] = True
        FORCE_NAV["path"] = args.force_nav
        print(f"⚠️ FORCED NAVIGATION: every family takes the offline route change to "
              f"{args.force_nav}. This is a CONTROLLED EXPERIMENT, not a table row.")
    stamp = time.strftime("%Y-%m-%dT%H-%M-%SZ", time.gmtime())
    st = load_state()

    # The N/A cells need no rig and are recorded FIRST, so a window that never
    # gets a browser -- and a bare --render-only -- still leaves the table honest
    # about them rather than printing "not run" for a cell nobody will ever run.
    for (f, o), why in NOT_APPLICABLE.items():
        st.setdefault(f"{f}|{o}", {"verdict": "N/A", "why": why})
    save_state(st)

    if args.render_only:
        pathlib.Path(args.out).write_text(render(st, stamp), encoding="utf-8")
        print(f"rendered {args.out}")
        return 0

    rig = load_rig()
    # ⛔ ONE AUTHORITY OVER THE ONE PROFILE. `use_profile(resolve_profile(...))` is
    # window_check's own resolution — CLI beats env beats its default — and it
    # REFUSES a directory name too generic to serve as a kill marker, because the
    # marker is substring-matched against every chrome.exe on this machine and a
    # generic one would match the owner's own browser. Setting PROFILE/MARKER by
    # hand here would be a second authority over exactly that value.
    rig.use_profile(rig.resolve_profile(args.profile))
    print(f"rig profile: {rig.PROFILE}  ·  kill marker: {rig.MARKER}")
    if not rig.PROFILE.exists():
        print("⛔ that profile directory does not exist. A missing profile is NOT an empty "
              "one to fill in — a fresh profile is a SIGNED-OUT profile and nothing on this "
              "machine can sign it back in. Pass --profile pointing at the one rig profile.")
        return 3

    from playwright.sync_api import sync_playwright

    # ⛔ --resume SKIPS A DECIDED READING, NOT AN UNDECIDED ONE. GREEN, RED and
    # N/A are answers; INCONCLUSIVE means the cell measured NOTHING, and banking
    # one would leave a hole in the table wearing a verdict's clothes — the same
    # flattering-direction failure as banking a timeout in a suite baseline. A
    # cell whose limitation is permanent simply says so again, which is the
    # "named rig limitation per row" the table is allowed to carry.
    DECIDED = {"GREEN", "RED", "N/A"}
    todo = [(f, o) for f, o in cells(args.family, args.ordering)
            if not (args.resume and (st.get(f"{f}|{o}") or {}).get("verdict") in DECIDED)
            and (f, o) not in NOT_APPLICABLE]
    print(f"⭐ {len(todo)} cell(s) to run · stamp {stamp}")
    if not todo:
        pathlib.Path(args.out).write_text(render(st, stamp), encoding="utf-8")
        print("nothing to do — table re-rendered")
        return 0

    refusal = None if args.ignore_window else rig_window_refusal()
    if refusal:
        print("STOP -- the rig window is not clear: " + refusal)
        return 5
    print("rig window clear (no Q1 task due within " + str(WINDOW_MINUTES) + " min)")

    proc, endpoint, ver = rig.spawn_rig()
    if ver is None:
        print("⛔ the rig browser never answered on CDP — nothing measured.")
        return 4
    try:
        with sync_playwright() as pw:
            b = pw.chromium.connect_over_cdp(endpoint)
            ctx = b.contexts[0]
            page = ctx.pages[0] if ctx.pages else ctx.new_page()
            # ⭐ RIG-SIDE WRITE TRACE, opt-in. Installed BEFORE any navigation so
            # it is in place ahead of the bundle. Zero product code ships for it.
            if args.trace_writes:
                import q1_write_trace as _wt
                _wt.install(page)
                print("⭐ write trace installed (rig-side, add_init_script)")
            cdp = page.context.new_cdp_session(page)
            cdp.send("Network.enable")
            rig._offliner(cdp)(False)

            # ── AUTH, AND THE THREE ANSWERS IT CAN GIVE ─────────────────
            # ⛔⛔ A 502 IS NOT A SIGNED-OUT RIG, and the first version of this
            # block said it was. Measured 2026-09-13T15:00Z: another session's
            # merge (PR #127) was mid-swap, `/api/auth/me` answered **502**, and
            # this tool printed "SIGN-IN REQUIRED" — which reads as *the rig lost
            # its session*, the one failure that ends an unattended run and the
            # one thing a session must never ask a human to fix casually. A
            # sign-in is a 30-DAY event, not a session event.
            #
            # ⭐ Three answers, kept apart:
            #   200  → signed in, proceed
            #   401  → genuinely signed out. THAT is sign-in required.
            #   else → the API could not answer. INCONCLUSIVE, and retried,
            #          because a Tier-1 deploy blips `/api/*` for about a minute
            #          and the instrument must survive one rather than crash into
            #          it (`docs/runbooks/deploy-windows.md`).
            me = {}
            for attempt in range(6):
                page.goto(args.base + "/journal/notebook", wait_until="domcontentloaded")
                page.wait_for_timeout(6000)
                me = page.evaluate(rig.AUTH_JS) or {}
                # ⛔ NOT `st` — that is the state dict this run appends every cell
                # to, and shadowing it turned the first real measurement into
                # `TypeError: 'int' object does not support item assignment`
                # AFTER the cell had been driven. The reading was taken and
                # thrown away.
                code = me.get("status")
                if code in (200, 401):
                    break
                print(f"   /api/auth/me → {code} · production is not answering "
                      f"(deploy in flight?) — waiting ({attempt + 1}/6)")
                page.wait_for_timeout(20000)

            if me.get("status") == 401:
                ok, detail = rig.reauthenticate(page)
                if ok:
                    page.goto(args.base + "/journal/notebook", wait_until="domcontentloaded")
                    page.wait_for_timeout(5000)
                    me = page.evaluate(rig.AUTH_JS) or {}
                if me.get("status") != 200:
                    print(f"⛔ SIGN-IN REQUIRED — /api/auth/me returned 401 and the rig could "
                          f"not self-heal ({detail}). Nothing measured.")
                    return 2

            if me.get("status") != 200:
                # ⛔ NOT A FINDING AND NOT A SIGN-OUT. Say which, and say that
                # nothing was measured, so the empty table cannot read as a clean one.
                print(f"⛔ INCONCLUSIVE — /api/auth/me never came back "
                      f"({me.get('status')}) after 6 tries. Production was unreachable, "
                      f"which is what a deploy swap looks like. Nothing measured; "
                      f"re-run when `railway deployment list --service web` shows SUCCESS.")
                return 6

            # ── THE RIG IS OPTED OUT BY DEFAULT, AND THAT IS NOT A DETAIL ──
            #
            # !!!! The sampler runs OPTED OUT on purpose -- its outbox is
            # structurally 0, which is what makes its rows readable. So the rig
            # profile carries `uct.j2.offline.enabled = '0'`, the durable layer
            # never engages, and EVERY CELL OF THIS MATRIX WOULD MEASURE A
            # BROWSER THAT HAS NO OUTBOX.
            #
            # * It did. The first real cell reported the member's offline
            # sentence missing from the server -- a RED that read exactly like a
            # product defect. The control said `sentenceOnScreen: True`,
            # `queuedForThisNote: 0`, `dirty: None`: typed, never stored, because
            # the layer this matrix exists to measure was switched off in this
            # browser. Product correct; instrument in the wrong mode.
            #
            # The key is REMOVED rather than set to '1': the server payload says
            # `notebook_offline_default_on: true`, so absence IS opted in, and
            # writing '1' would put a second authority next to the default.
            before_key = page.evaluate(
                "(k) => { try { return localStorage.getItem(k) } catch { return 'ERR' } }",
                rig.FLAG_KEY)
            page.evaluate("(k) => { try { localStorage.removeItem(k) } catch {} }", rig.FLAG_KEY)
            page.goto(args.base + "/journal/notebook", wait_until="domcontentloaded")
            page.wait_for_timeout(5000)
            after_key = page.evaluate(
                "(k) => { try { return localStorage.getItem(k) } catch { return 'ERR' } }",
                rig.FLAG_KEY)
            print(f"opt-in: key was {before_key!r} -> {after_key!r} "
                  f"(None = opted in by the server default)")
            if after_key not in (None, "1"):
                print("STOP -- the rig could not be opted in; every cell would measure a "
                      "browser with no durable layer. Nothing measured.")
                return 7

            acct = me.get("id")
            if not acct:
                # ⛔ A 200 WITH NO ACCOUNT ID IS NOT A SIGNED-IN RIG. The
                # IndexedDB name is `uct_notebook_<accountId>`, so a blank id
                # would open a database nobody owns and every cell would
                # measure an empty store while looking busy.
                print("⛔ INCONCLUSIVE — /api/auth/me returned 200 with no account id. "
                      "Nothing measured.")
                return 6
            purged = page.evaluate(PURGE_JS, {"acct": acct})
            print(f"outbox litter from earlier runs: {purged}")
            print(f"signed in · account {acct} · notebook config: {me.get('nb')}")

            for f, o in todo:
                print(f"\n═══ {f}  ·  {o}")
                try:
                    res = run_cell(rig, page, cdp, args.base, acct, f, o, stamp, print)
                except Exception as e:  # noqa: BLE001
                    res = {"verdict": "INCONCLUSIVE",
                           "why": f"the cell raised {type(e).__name__}: {str(e)[:200]}"}
                print(f"   ⇒ {res['verdict']}  {res['why'][:150]}")
                if (FORCE_NAV["on"] or SPA_RETURN["on"] or NO_DOOR["on"]
                        or SECOND_WRITER["on"]):
                    # ⛔ A FORCED-NAV CELL IS NOT A TABLE CELL. It answers a
                    # different question, and banking it would put an answer to
                    # the wrong question in the artifact the freeze lifts on.
                    print("   (controlled experiment — NOT written to the table)")
                    continue
                st[f"{f}|{o}"] = res
                save_state(st)                     # ⛔ after EVERY cell
                pathlib.Path(args.out).write_text(render(st, stamp), encoding="utf-8")

            # ⛔⛔ RESTORE THE OPT-OUT HERE, INSIDE THE PLAYWRIGHT CONTEXT.
            #
            # ⚰️ It was in the outer `finally`, which runs AFTER
            # `with sync_playwright()` has exited — so every call went to a
            # closed event loop and came back `ERR: Error`. The restore whose
            # whole job is to fail loudly was itself failing, and the only
            # reason it was caught is that it printed its own alarm. The rig was
            # left OPTED IN, which would have handed the next sampler row a
            # non-zero outbox — product state, as the Sunday gate reads it.
            try:
                ok_out, got = rig.opt_out(page)
                print(f"opt-out restored in-session: {got!r} "
                      f"({'ok' if ok_out else 'NOT PROVEN — see the on-disk check below'})")
            except Exception as e:  # noqa: BLE001
                print(f"⛔ opt-out restore raised {type(e).__name__} — see the on-disk check")
    finally:
        # ⛔ THE AUTHORITY IS THE DISK, WITH CHROME DEAD. An in-memory read-back
        # of '0' is truthful about memory and says nothing about the profile the
        # NEXT run opens — measured 2026-09-10, twice: a removal read back as gone
        # in memory and was still on disk on the next open. The in-context restore
        # now happens inside the playwright block; this is its proof.
        rig.teardown()
        try:
            disk = rig.localstorage_on_disk(rig.FLAG_KEY)
            val = (disk or {}).get('value')
            print(f"opt-out ON DISK (browser dead): {val!r} "
                  f"{'the rig IS opted out' if val == '0' else 'THE RIG IS NOT OPTED OUT'}")
            if val != '0':
                # ⛔ RETRY ONCE, DO NOT JUST WARN. `opt_out`'s flush and
                # `teardown`'s SIGKILL race: the in-session read-back says '0'
                # and the newest on-disk append can still be the removal. A
                # warning leaves the next sampler run measuring an opted-in rig,
                # which is the state this whole restore exists to prevent.
                print("   on-disk restore did not stick — respawning once to redo it")
                try:
                    from playwright.sync_api import sync_playwright as _spw
                    _proc, _ep, _ver = rig.spawn_rig()
                    if _ver:
                        with _spw() as _pw:
                            _b = _pw.chromium.connect_over_cdp(_ep)
                            _c = _b.contexts[0]
                            _pg = _c.pages[0] if _c.pages else _c.new_page()
                            _pg.goto(rig.PROD + "/api/health", wait_until="domcontentloaded")
                            _pg.wait_for_timeout(1500)
                            print("   retry opt_out ->", rig.opt_out(_pg))
                    rig.teardown()
                    val = (rig.localstorage_on_disk(rig.FLAG_KEY) or {}).get('value')
                    print(f"   after retry, ON DISK: {val!r}")
                except Exception as e:  # noqa: BLE001
                    print(f"   retry raised {type(e).__name__}")
            if val != '0':
                print('⛔⛔ FIX THIS BEFORE THE NEXT SAMPLER RUN. An opted-in rig '
                      'gives the sampler a non-zero outbox, and the Sunday gate reads that '
                      'as product state rather than as this tool leftovers.')
        except Exception as e:  # noqa: BLE001
            print(f'⛔ could not read the on-disk opt-in key ({type(e).__name__}) — '
                  'unknown is not clear; check it by hand before the next sampler run')

    print(f"\ntable → {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
