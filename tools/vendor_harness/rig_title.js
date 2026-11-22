// tools/vendor_harness/rig_title.js
//
// THE SCRIPT-TITLE CONTROL OF TRADINGVIEW'S PINE EDITOR, as one function expression the batch driver
// evaluates in the page (`batch_capture.py::TITLE_JS` is this file's text). Returns the element's
// CENTRE for a real (CDP) pointer click, or `{ok: false, why}`.
//
// A CAPTURE RUN NEVER CLICKS ANYTHING IT CANNOT NAME (coordinator ruling 2026-11-16). On 2026-11-16
// TradingView's editor moved the script title into an `H2`; the old finder did not look at headings,
// and its fallback (`/script/i` over every button above the editor) chose the "Publish script" button,
// which the driver then clicked on the owner's account (the publish dialog opened; nothing was
// published). So this finder is an ALLOW-LIST of what a title element may be, never a deny-list over
// what it may not:
//   * an `H2` (or an element with `role="heading"`), visible, above the editor, inside the panel that
//     also holds the add/update control;
//   * whose own text is a script name: non-empty and naming no action (publish, share, save, delete,
//     copy, rename, version, open, report, alert, add to chart, update on chart);
//   * exactly one such element, or nothing is chosen.
// `sel` (the driver's `--title-selector`) narrows the search; the element it names must pass the same
// test. There is no other fallback.
(sel) => {
  const own = (el) => [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join(' ').trim();
  const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && el.offsetParent !== null };
  const centre = (el) => { const r = el.getBoundingClientRect(); return { ok: true, x: r.left + r.width / 2, y: r.top + r.height / 2, text: own(el) } };
  const ACTION = /publish|share|save|delete|remove|copy|rename|version|open|report|alert|add to chart|update on chart/i;
  const heading = (el) => !!el && (el.tagName === 'H2' || el.getAttribute('role') === 'heading');
  const isTitle = (el) => heading(el) && vis(el) && !!own(el) && !ACTION.test(own(el));
  if (sel) {
    const el = document.querySelector(sel);
    return isTitle(el) ? { ...centre(el), how: 'selector' }
      : { ok: false, why: `selector ${sel} matched no visible script-title heading` };
  }
  const ed = [...document.querySelectorAll('.monaco-editor')].find(vis);
  if (!ed) return { ok: false, why: 'no editor' };
  let box = ed.parentElement;
  const holdsAction = (n) => [...n.querySelectorAll('*')].some((e) => ['Add to chart', 'Update on chart'].includes(own(e)));
  while (box && !holdsAction(box)) box = box.parentElement;
  if (!box) return { ok: false, why: 'no panel holds both the editor and an add/update control' };
  const top = ed.getBoundingClientRect().top;
  const cands = [...box.querySelectorAll('h2,[role="heading"]')]
    .filter((el) => isTitle(el) && el.getBoundingClientRect().bottom <= top + 2);
  if (cands.length !== 1) {
    return { ok: false, why: `expected one script-title heading above the editor, found ${cands.length}`, candidates: cands.map(own) };
  }
  return { ...centre(cands[0]), how: 'heading' };
}
