"""One-off transform: the artifact version of the review page -> the local page that saves to disk through server.py.

    python make_local_page.py <artifact index.html> <out index.html>

Kept in the repo so the local page can be regenerated from the artifact source. Pure text surgery on named anchors.
"""
import sys

src = open(sys.argv[1], encoding="utf-8").read()


def cut(text, start_marker, end_marker, replacement):
    i = text.index(start_marker)
    j = text.index(end_marker, i)
    return text[:i] + replacement + text[j:]


def sub(text, old, new, count=1):
    assert old in text, old[:60]
    return text.replace(old, new, count)


# ── a real HTML document (the artifact host used to supply this) ──
src = sub(src, '<meta name="claude:viewport-fit-sides" content="cover">\n', "")
src = "<!doctype html>\n<html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\n" + src
src = sub(src, "</style>\n\n<div class=\"app\">", "</style>\n</head><body>\n<div class=\"app\">")
src = sub(src, "* { box-sizing: border-box; }", "* { box-sizing: border-box; }\n[hidden] { display: none !important; }")
src = src.rstrip() + "\n</body></html>\n"

# ── a banner for "not saved" and one line saying where the work lives ──
src = sub(src, "  <aside class=\"side\"",
          "  <div class=\"banner\" id=\"saveBanner\" hidden style=\"grid-column:1/-1;border-color:var(--bad);color:var(--bad)\"></div>\n"
          "  <div class=\"eyebrow\" id=\"fileLine\" style=\"grid-column:1/-1\"></div>\n\n  <aside class=\"side\"")

# ── saving ──
new_save = '''  // ── saving: every pick goes to the local server, which writes it to a file on this computer ───────────────────
  var QKEY = 'libreview.queue';
  S.queue = lsGet(QKEY, []); S.flushing = false; S.fails = 0;
  function renderSaveBanner() {
    var el = $('saveBanner'); if (!el) return;
    if (S.queue.length && S.fails > 0) {
      el.hidden = false;
      el.textContent = 'NOT SAVED YET: ' + S.queue.length + ' pick(s) are waiting because the review program is not answering. Do not close this tab. If the black window was closed, double-click Start Library Review again, then come back to this tab. This page keeps trying every few seconds.';
    } else { el.hidden = true; }
  }
  function persist(slug, q, r) {
    var item = { id: q.id, unit: slug, key: q.key, v: r.v, note: r.note || '', q: String(q.q || '').slice(0, 160) };
    S.queue = S.queue.filter(function (x) { return x.id !== item.id; }); S.queue.push(item); lsSet(QKEY, S.queue);
    setStatus('Saving…'); flush();
  }
  function flush() {
    if (S.flushing) return;
    if (!S.queue.length) { renderSaveBanner(); return; }
    S.flushing = true; var item = S.queue[0];
    fetch('api/verdict', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(item) })
      .then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.json(); })
      .then(function (j) {
        S.queue = S.queue.filter(function (x) { return x !== item; }); lsSet(QKEY, S.queue);
        S.flushing = false; S.fails = 0;
        if (S.queue.length) flush(); else { setStatus('Saved to your disk (' + j.lines + ' lines)'); renderSaveBanner(); }
      })
      .catch(function () {
        S.flushing = false; S.fails++;
        setStatus('NOT SAVED yet. Retrying…', true); renderSaveBanner();
        setTimeout(flush, 3000);
      });
  }
  var stateTimer = null;
  function postState(slug, key) {
    clearTimeout(stateTimer);
    stateTimer = setTimeout(function () {
      fetch('api/state', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug: slug, key: key }) }).catch(function () {});
    }, 800);
  }
  window.addEventListener('beforeunload', function (e) { if (S.queue.length) { e.preventDefault(); e.returnValue = ''; } });

'''
src = cut(src, "  function writeReview(slug) {", "  function setVerdict(v, noteOnly) {", new_save)
src = sub(src, "writeReview(slug);", "persist(slug, q, next);")
src = cut(src, "  function subscribeReviews() {", "  // ── what is visible in the current unit", "")

# ── export / copy ──
new_copy = '''  function allLines() {
    var lines = [];
    S.units.forEach(function (u) {
      var r = S.reviews[u.slug]; if (!r || !r.items) return;
      Object.keys(r.items).forEach(function (id) {
        var x = r.items[id]; if (!x.v && !x.note) return;
        lines.push(JSON.stringify({ unit: u.unit, key: x.key, item: id, verdict: x.v, note: x.note, at: x.at }));
      });
    });
    return lines;
  }
  function downloadBackup() {
    var text = allLines().join(String.fromCharCode(10)) + String.fromCharCode(10);
    var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    a.download = 'library-review-backup-' + new Date().toISOString().slice(0, 10) + '.jsonl';
    document.body.appendChild(a); a.click(); a.remove(); setStatus('Backup file downloaded');
  }
  function copyAll() {
    var text = allLines().join(String.fromCharCode(10));
    var done = function () { setStatus(allLines().length + ' verdicts copied'); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () { showText(text); });
    else showText(text);
  }
'''
src = cut(src, "  function copyAll() {", "  function showText(text) {", new_copy)
src = sub(src, "'<button class=\"linkbtn\" id=\"copyAll\" type=\"button\">Copy all</button>';",
          "'<button class=\"linkbtn\" id=\"dlBackup\" type=\"button\">Download backup</button> <button class=\"linkbtn\" id=\"copyAll\" type=\"button\">Copy all</button>';")
src = sub(src, "$('copyAll').onclick = copyAll;", "$('copyAll').onclick = copyAll; $('dlBackup').onclick = downloadBackup;")

# ── remember where you stopped, on disk too ──
src = sub(src, "lsSet('libreview.at', { slug: u.slug, key: q.key });", "lsSet('libreview.at', { slug: u.slug, key: q.key }); postState(u.slug, q.key);")

# ── start and boot ──
new_start = '''  function start(index, serverState) {
    S.index = index;
    S.units = index.units.map(function (u) { return Object.assign({}, u, { slug: u.slug }); });
    S.units.forEach(function (u) { S.bySlug[u.slug] = u; });
    S.filter = lsGet('libreview.filter', 'all'); S.showAnswer = lsGet('libreview.showAnswer', true);
    renderUnitList(); renderTotals();
    var h = parseHash(), at = serverState && S.bySlug[serverState.slug] ? serverState : lsGet('libreview.at', null);
    var first = h || (at && S.bySlug[at.slug] ? { slug: at.slug, key: at.key } : { slug: S.units[0].slug, key: null });
    buildMain(); go(first.slug, 0, first.key);
  }

'''
src = cut(src, "  function start(index) {", "  $('unitSearch').oninput", new_start)
new_boot = '''  function boot() {
    Promise.all([
      fetch('data/index.json').then(function (r) { return r.json(); }),
      fetch('api/verdicts').then(function (r) { return r.json(); })
    ]).then(function (res) {
      var idx = res[0], v = res[1];
      Object.keys(v.records || {}).forEach(function (id) {
        var r = v.records[id], slug = r.unit; if (!slug) return;
        if (!S.reviews[slug]) S.reviews[slug] = { unit: slug, items: {} };
        S.reviews[slug].items[id] = { v: r.v, note: r.note, at: r.at, key: r.key };
      });
      // picks still waiting in this browser (the server was down) are newer than the file
      S.queue.forEach(function (it) {
        if (!S.reviews[it.unit]) S.reviews[it.unit] = { unit: it.unit, items: {} };
        S.reviews[it.unit].items[it.id] = { v: it.v, note: it.note, at: '', key: it.key };
      });
      $('fileLine').textContent = 'Your work is saved to: ' + v.file + '  (' + (v.lines || 0) + ' lines' + (v.skipped_lines ? ', ' + v.skipped_lines + ' damaged line(s) skipped' : '') + ')';
      start(idx, v.state);
      flush();
    }, function () {
      $('main').innerHTML = '<div class="banner">The review program is not running. Double-click Start Library Review, then reload this page.</div>';
    });
  }
  boot();
})();
'''
src = cut(src, "  function boot() {", "</script>", new_boot)
open(sys.argv[2], "w", encoding="utf-8", newline="\n").write(src)
print("wrote", sys.argv[2], len(src))
