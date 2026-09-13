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
import pathlib
import sys
import time

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


EXCERPT_LINE = "F5 MATRIX EXCERPT SOURCE PASSAGE ALPHA BRAVO CHARLIE DELTA"

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
  await new Promise(r => setTimeout(r, 3500));
  const pages = document.querySelectorAll('[data-pdf-page-number]').length;
  const spans = document.querySelectorAll('.textLayer span').length;
  return {ok: pages > 0, why: 'preview pages=' + pages + ' textLayer spans=' + spans,
          pages, spans};
}"""


def prepare_family(page, family, note_id, stamp, log):
    """Whatever a family's door needs IN PLACE before the offline half starts.

    SETUP IS ONLINE AND IS NOT THE DOOR. Attaching a PDF needs the network, so it
    cannot happen inside the offline window -- and it is not the thing under test.
    The DOOR is the selection and the Save-excerpt click, both driven from the
    member's own controls once the run is back online.
    """
    if family != "append_document_excerpt":
        return {"ok": True}
    import tempfile
    pdf = pathlib.Path(tempfile.gettempdir()) / ("f5-excerpt-" + stamp + ".pdf")
    pdf.write_bytes(minimal_pdf(EXCERPT_LINE))
    try:
        page.set_input_files('input[aria-label="Upload file attachment"]', str(pdf))
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "rig_limitation": True,
                "why": "the editor's own attachment input would not take the file: " + str(e)}
    page.wait_for_timeout(9000)
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
WARM_ROUTES = {
    "append_widget_embed": "/charts",
    "append_financial_fact": "/dashboard",
}

SPA_NAV_JS = """async ({path}) => {
  history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate', {state: {}}));
  await new Promise(r => setTimeout(r, 4000));
  return {path: location.pathname, offline: !navigator.onLine};
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
    page.wait_for_timeout(9000)
    return {"ok": True, "warmed": path}


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
        return page.evaluate(SELECT_AND_SAVE_JS, {"want": EXCERPT_LINE})

    return {"ok": False, "why": f"no driver for {family}"}


# ══════════════════════════════════════════════════════════════════════════════
# the artifact
# ══════════════════════════════════════════════════════════════════════════════

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

def run_cell(rig, page, cdp, base, acct, family, ordering, stamp, log):
    from_cell = time.time()
    offline = rig._offliner(cdp)
    sentence = f"{SENTINEL} {family} {ordering.split(' (')[0]} {stamp} the member's offline words"

    posts: list[dict] = []
    handler = lambda r: posts.append({"m": r.method, "u": r.url}) \
        if "/api/j2/notes" in r.url and r.method in ("POST", "PUT", "DELETE") else None
    page.on("request", handler)

    note_id = None
    try:
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
        page.goto(f"{base}/journal/notebook?note={note_id}", wait_until="domcontentloaded")
        page.wait_for_timeout(7000)
        pm = page.query_selector(".ProseMirror")
        if pm is None:
            return {"verdict": "INCONCLUSIVE",
                    "why": "the editor never mounted for the probe note — nothing was measured"}
        pm.click()
        page.keyboard.type(f"{SENTINEL} baseline {stamp}.")
        page.wait_for_timeout(5000)

        # -- 2b. anything this family's door needs in place, while ONLINE --
        prep = prepare_family(page, family, note_id, stamp, log)
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
        pm = page.query_selector(".ProseMirror")
        if pm:
            pm.click()
            page.keyboard.press("End")
            page.keyboard.type(" " + sentence)
        page.wait_for_timeout(6000)

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
        if family in WARM_ROUTES:
            navd = page.evaluate(SPA_NAV_JS, {"path": WARM_ROUTES[family]})
            nav_note = f" · navigated offline to {navd}"
            log(f"      offline nav: {navd}")
            if not (isinstance(navd, dict) and navd.get("path") == WARM_ROUTES[family]):
                return {"verdict": "INCONCLUSIVE",
                        "why": (f"the offline route change to {WARM_ROUTES[family]} did not take "
                                f"({navd}) — the door was never reachable with work still queued")}
        sent_before = len([p for p in posts if note_id in p["u"]])
        offline(False)
        before_door = sent_before
        if family in METADATA:
            if family == "hero":
                res = rig._fire_hero_door(page)
            else:
                val = f"F5{stamp[-4:]}" if family == "ticker" else f"f5-{stamp[-4:]}"
                res = page.evaluate(rig.REAL_DOOR_JS, {"door": family, "value": val})
        else:
            res = drive_append(page, family, base, log)
        log(f"      door: {res}")

        if not (isinstance(res, dict) and res.get("ok")):
            why = (res or {}).get("why", res)
            tag = "rig limitation" if (res or {}).get("rig_limitation") else "not opened"
            return {"verdict": "INCONCLUSIVE",
                    "why": f"the `{family}` door was {tag}: {why}"}

        page.wait_for_timeout(5000)

        # For an append family the row only counts if its OWN endpoint was hit.
        if family in APPEND:
            hit = [p for p in posts if ENDPOINT[family] in p["u"]]
            if not hit:
                return {"verdict": "INCONCLUSIVE",
                        "why": (f"the control took the click but produced no call to "
                                f"`{ENDPOINT[family]}` — a label is not a door. "
                                f"note calls this cell: {len(posts)}")}

        # ── 6. let the drain run, then read the SERVER ──
        # Back to the note: the drain leader lives on whichever tab holds the
        # lock, and reopening the editor is also what a member would do.
        page.goto(f"{base}/journal/notebook?note={note_id}", wait_until="domcontentloaded")
        page.wait_for_timeout(11000)
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
        boxes = page.evaluate(OUTBOX_JS, {"acct": acct})

        # Did the door's own node survive the drain? Only an append family has one.
        node_ok, node_note = True, ""
        if family in APPEND:
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

        ok = survived and node_ok and forks == 0 and (boxes or {}).get("conflicts", 0) == 0
        why = (f"offline sentence in the server body: **{survived}**{node_note} · "
               f"forks: {forks} · outbox left: {(boxes or {}).get('outbox')} · "
               f"conflicts: {(boxes or {}).get('conflicts')} · "
               f"door via {res.get('via', 'n/a')} · sends before the door: {before_door}"
               f"{nav_note} · {int(time.time() - from_cell)}s")
        if before_door and ok:
            # THE DRAIN WON, so this cell proves the product is fine in a case it
            # was not asked about. Green here would be a green for the wrong
            # reason -- the one failure mode a matrix cannot afford.
            return {"verdict": "INCONCLUSIVE",
                    "why": ("the drain sent the queued entry BEFORE the door fired "
                            f"({before_door} send(s)) — the door never met queued work, so this "
                            f"cell measured nothing. {why}")}
        return {"verdict": "GREEN" if ok else "RED", "why": why}

    finally:
        try:
            page.remove_listener("request", handler)
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


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--profile")
    ap.add_argument("--base", default="https://uctintelligence.com")
    ap.add_argument("--family", choices=sorted(FAMILIES))
    ap.add_argument("--ordering")
    ap.add_argument("--resume", action="store_true")
    ap.add_argument("--out", default=str(DEFAULT_OUT))
    ap.add_argument("--render-only", action="store_true")
    args = ap.parse_args()

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

    todo = [(f, o) for f, o in cells(args.family, args.ordering)
            if not (args.resume and st.get(f"{f}|{o}")) and (f, o) not in NOT_APPLICABLE]
    print(f"⭐ {len(todo)} cell(s) to run · stamp {stamp}")
    if not todo:
        pathlib.Path(args.out).write_text(render(st, stamp), encoding="utf-8")
        print("nothing to do — table re-rendered")
        return 0

    proc, endpoint, ver = rig.spawn_rig()
    if ver is None:
        print("⛔ the rig browser never answered on CDP — nothing measured.")
        return 4
    try:
        with sync_playwright() as pw:
            b = pw.chromium.connect_over_cdp(endpoint)
            ctx = b.contexts[0]
            page = ctx.pages[0] if ctx.pages else ctx.new_page()
            cdp = page.context.new_cdp_session(page)
            cdp.send("Network.enable")
            rig._offliner(cdp)(False)

            page.goto(args.base + "/journal/notebook", wait_until="domcontentloaded")
            page.wait_for_timeout(6000)
            me = page.evaluate(rig.AUTH_JS)
            if me.get("status") != 200:
                ok, detail = rig.reauthenticate(page)
                if ok:
                    page.goto(args.base + "/journal/notebook", wait_until="domcontentloaded")
                    page.wait_for_timeout(5000)
                    me = page.evaluate(rig.AUTH_JS)
                if me.get("status") != 200:
                    print(f"⛔ SIGN-IN REQUIRED ({me.get('status')}) — nothing measured. {detail if not ok else ''}")
                    return 2
            acct = me.get("id")
            print(f"signed in · account {acct} · notebook config: {me.get('nb')}")

            for f, o in todo:
                print(f"\n═══ {f}  ·  {o}")
                try:
                    res = run_cell(rig, page, cdp, args.base, acct, f, o, stamp, print)
                except Exception as e:  # noqa: BLE001
                    res = {"verdict": "INCONCLUSIVE",
                           "why": f"the cell raised {type(e).__name__}: {str(e)[:200]}"}
                print(f"   ⇒ {res['verdict']}  {res['why'][:150]}")
                st[f"{f}|{o}"] = res
                save_state(st)                     # ⛔ after EVERY cell
                pathlib.Path(args.out).write_text(render(st, stamp), encoding="utf-8")
    finally:
        rig.teardown()

    print(f"\ntable → {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
