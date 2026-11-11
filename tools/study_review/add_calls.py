"""Adds Claude's first-pass calls to static/index.html (idempotent). python add_calls.py static/index.html"""
import sys

path = sys.argv[1]
src = open(path, encoding="utf-8").read()
if "acceptCall" in src:
    print("already patched")
    sys.exit(0)


def sub(text, old, new):
    assert old in text, old[:70]
    return text.replace(old, new, 1)


# styles
src = sub(src, "@media (max-width: 899px) {", """.call { margin: 0; padding: 8px 12px; border-radius: 10px; border: 1px solid var(--line); background: var(--panel2); font-size: 15px; display: flex; gap: 8px 12px; flex-wrap: wrap; align-items: center; max-width: 80ch; }
.call b { font: 700 12px var(--mono); letter-spacing: .06em; text-transform: uppercase; color: var(--mute); }
.call.look { border-color: var(--warn); } .call.confirm { border-color: var(--info); } .call.keep { border-color: var(--good); }
.call .why2 { flex: 1 1 260px; min-width: 0; color: var(--fg); }
.call button { min-height: 36px; border-radius: 8px; border: 1px solid var(--line); background: var(--panel); cursor: pointer; font: 700 13px var(--mono); padding: 0 12px; }
.call button:hover { border-color: var(--gold); }
.bulk { min-height: 40px; border-radius: 10px; border: 1px solid var(--good); background: var(--panel2); cursor: pointer; font: 700 13px var(--mono); padding: 0 14px; justify-self: start; }
.bulk[data-armed=true] { background: var(--good); color: #04140b; }
@media (max-width: 899px) {""")

# state
src = sub(src, "S.queue = lsGet(QKEY, []);", "S.calls = {}; S.queue = lsGet(QKEY, []);")

# filters: three new chips
src = sub(src, "      if (f === 'revised') return !!(q.check && q.check.revised);",
          "      if (f === 'revised') return !!(q.check && q.check.revised);\n"
          "      if (f === 'look') return !!(S.calls[q.id] && S.calls[q.id].c === 'look');\n"
          "      if (f === 'confirm') return !!(S.calls[q.id] && S.calls[q.id].c === 'confirm');\n"
          "      if (f === 'clean') return !!(S.calls[q.id] && S.calls[q.id].c === 'keep');")
src = sub(src, "['tell', 'Length tell'], ['revised', 'Revised']];",
          "['look', 'Claude: look'], ['confirm', 'Claude: confirm rule'], ['clean', 'Claude: clean keep'], ['tell', 'Length tell'], ['revised', 'Revised']];")

# the call line under the question's meta row
src = sub(src, "    html += questionBody(q);\n", """    var cl = S.calls[q.id];
    if (cl) {
      var label = cl.c === 'look' ? 'Look: I propose ' + cl.p.toUpperCase() : cl.c === 'confirm' ? 'Keep, but confirm the rule' : 'Keep';
      var cur = rec(u.slug, q.id), done = cur && cur.v === cl.p;
      html += '<p class="call ' + cl.c + '"><b>Claude\\'s call</b><span><strong>' + esc(label) + '.</strong></span><span class="why2">' + esc(cl.r) + '</span>' +
        (done ? '<span class="chip good">accepted</span>' : '<button type="button" id="acceptCall">Accept (Enter)</button>') + '</p>';
    }
    html += questionBody(q);
""")
src = sub(src, "    renderVerdictState();\n    $('pos').textContent",
          "    renderVerdictState();\n    var ac = $('acceptCall'); if (ac) ac.onclick = acceptCall;\n    $('pos').textContent")

# accept one call (records YOUR verdict, because you pressed accept)
src = sub(src, "  // ── navigation ", """  function acceptCall() {
    var u = S.cur, q = u && visible()[S.qi], cl = q && S.calls[q.id]; if (!cl) return;
    var cur = rec(u.slug, q.id);
    if (cur && cur.v === cl.p) { step(1); return; }
    if (cl.p !== 'keep' && !$('vnote').value) $('vnote').value = "Accepted Claude's call: " + cl.r;
    setVerdict(cl.p);
    var ac = $('acceptCall'); if (ac) renderQuestion();
  }
  var bulkArmed = false;
  function acceptClean() {
    var u = S.cur; if (!u) return;
    var todo = u.data.questions.filter(function (q) { var c = S.calls[q.id], r = rec(u.slug, q.id); return c && c.c === 'keep' && (!r || !r.v); });
    if (!todo.length) return;
    var btn = $('bulkBtn');
    if (!bulkArmed) { bulkArmed = true; btn.setAttribute('data-armed', 'true'); btn.textContent = 'Click again to record ' + todo.length + ' keeps as yours'; setTimeout(function () { bulkArmed = false; renderUnitHead(); }, 6000); return; }
    bulkArmed = false;
    if (!S.reviews[u.slug]) S.reviews[u.slug] = { unit: u.slug, items: {} };
    todo.forEach(function (q) {
      var r = { v: 'keep', note: '', at: new Date().toISOString(), key: q.key };
      S.reviews[u.slug].items[q.id] = r; persist(u.slug, q, r);
    });
    renderUnitList(); renderTotals(); renderUnitHead(); renderQuestion();
  }

  // ── navigation """)

# bulk button in the unit head
src = sub(src, "' cut</div>' + conf + walks;", "' cut</div>' + bulk + conf + walks;")
src = sub(src, "    var conf = d.conflicts", """    var cleanLeft = d.questions.filter(function (q) { var c = S.calls[q.id], r = rec(u.slug, q.id); return c && c.c === 'keep' && (!r || !r.v); }).length;
    var bulk = cleanLeft ? '<button class="bulk" id="bulkBtn" type="button">Accept Claude\\'s ' + cleanLeft + ' clean keeps in this unit</button>' : '';
    var conf = d.conflicts""")
src = sub(src, "  function renderFilters() {", "  function wireBulk() { var b = $('bulkBtn'); if (b) b.onclick = acceptClean; }\n  function renderFilters() {")
src = sub(src, "renderUnitList(); renderUnitHead(); renderFilters(); renderQuestion(); window.scrollTo(0, 0);",
          "renderUnitList(); renderUnitHead(); wireBulk(); renderFilters(); renderQuestion(); window.scrollTo(0, 0);")
# keep the bulk button wired whenever the head redraws
src = sub(src, "  function renderUnitHead() {", "  function renderUnitHead() { setTimeout(wireBulk, 0);")

# Enter accepts
src = sub(src, "    else if (e.key === 'a' || e.key === 'A') {", "    else if (e.key === 'Enter') { acceptCall(); e.preventDefault(); }\n    else if (e.key === 'a' || e.key === 'A') {")

# load calls at boot
src = sub(src, "      fetch('api/verdicts').then(function (r) { return r.json(); })\n",
          "      fetch('api/verdicts').then(function (r) { return r.json(); }),\n      fetch('data/calls.json').then(function (r) { return r.ok ? r.json() : {}; }).catch(function () { return {}; })\n")
src = sub(src, "      var idx = res[0], v = res[1];", "      var idx = res[0], v = res[1]; S.calls = res[2] || {};")
open(path, "w", encoding="utf-8", newline="\n").write(src)
print("patched", path)
