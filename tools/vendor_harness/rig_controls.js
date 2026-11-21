// tools/vendor_harness/rig_controls.js
//
// THE ONE CONTROL A CAPTURE STEP CLICKS, FOUND INSIDE ITS OWN CONTAINER, as one function expression the batch
// driver evaluates in the page (`batch_capture.py::MENU_ITEM_JS` and `ADD_JS` embed this file's text). Returns
// `{ok: true, el, x, y, rect}` for exactly one visible control whose own text is `a.text`, or `{ok: false, found,
// why}` (and `STOP: true` when it found several, or one that something else covers): nothing is clicked then.
//
// ⚰️ WHY (patrick-54's review, coordinator ruling 2026-11-21). The menu rows and `Add to chart` were searched by own
// text over the WHOLE page and the first hit was taken; one attempt on the rig clicked an unrelated "Save" behind a
// modal. Own-text matches are not unique on this page: "Save" has 4 (three zero-height layout-header titles and the
// editor's button), and a second `.monaco-editor` sits in the overlay root. So each control is looked for only
// inside its container, by STABLE structure (an id and ARIA roles, never TradingView's hashed class names, which
// change between builds), and exactly one or nothing:
//   * `within: 'menu'`  — a `[role="menuitem"]` row inside an open `[role="menu"]` (the script-title menu and its
//     `Create new` submenu, recorded on the rig 2026-11-21 04:10Z: `D:/uct-rig-facts/dom_facts_2026-11-21.json`);
//     `a.rightOf` (the parent row's rect) keeps a submenu row to the right of the row that opened it.
//   * `within: 'editor'` — inside `#pine-editor-dialog`, the Pine editor dialog that holds the editor and its own
//     `Add to chart` button (the same recording).
// And the control must be what a pointer at its centre would hit (`document.elementFromPoint`): a control another
// element covers (a modal, a popup) is never chosen, because a real click there lands on the cover.
(a) => {
  const own = (el) => [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join(' ').trim();
  const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !el.disabled };
  let pool, owner;
  if (a.within === 'menu') {
    const rows = [...document.querySelectorAll('[role="menu"] [role="menuitem"]')];
    pool = rows.flatMap((row) => [row, ...row.querySelectorAll('*')]);
    owner = (el) => el.closest('[role="menuitem"]');
  } else if (a.within === 'editor') {
    const dialog = document.getElementById('pine-editor-dialog');
    if (!dialog) return { ok: false, found: 0, why: 'no #pine-editor-dialog on the page' };
    pool = [...dialog.querySelectorAll('button, a, [role="button"], div, span')];
    owner = (el) => el.closest('button, a, [role="button"]') || el;
  } else {
    return { ok: false, found: 0, why: `no container named ${JSON.stringify(a.within)}` };
  }
  let hits = [...new Set(pool)].filter((el) => own(el) === a.text && vis(el));
  if (a.rightOf) hits = hits.filter((el) => el.getBoundingClientRect().left >= a.rightOf.right - 8);
  const where = a.within === 'menu' ? 'an open menu' : '#pine-editor-dialog';
  if (hits.length === 0) return { ok: false, found: 0, why: `no visible ${JSON.stringify(a.text)} in ${where}` };
  if (hits.length > 1) {
    return { ok: false, STOP: true, found: hits.length,
             why: `${hits.length} visible ${JSON.stringify(a.text)} in ${where}: exactly one, or nothing is clicked` };
  }
  const el = hits[0];
  const r = el.getBoundingClientRect();
  const x = r.left + r.width / 2;
  const y = r.top + r.height / 2;
  const top = document.elementFromPoint(x, y);
  const mine = owner(el);
  if (!top || !(top === el || el.contains(top) || (mine && (top === mine || mine.contains(top))))) {
    return { ok: false, STOP: true, found: 1, covered: true,
             why: `${JSON.stringify(a.text)} in ${where} is covered at its centre by another element: nothing is clicked` };
  }
  return { ok: true, el, x, y, rect: { left: r.left, right: r.right, top: r.top, bottom: r.bottom } };
}
