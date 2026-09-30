p = r"C:\Users\blake\AppData\Local\Temp\claude\C--Users-blake\a891b6dc-9789-4365-aaf4-71c949c3a82c\scratchpad\capture.mjs"
s = open(r"C:\w\econint\app\src\econHarness\captureScenarios.mjs", encoding="utf-8").read()
old = "const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../docs/economic-data/harness', SUB)"
assert old in s
s = s.replace(old, "const OUT = 'C:/w/econint/docs/economic-data/integration/harness'")
old2 = "  const nav = await evaluate('window.__econ.navTest()')"
assert old2 in s
s = s.replace(old2, old2 + """
  const types = await evaluate(`(() => { const E = window.__econ; const b = E.binder.bindings();
    const econ = b.map((x) => ({ instanceId: x.instanceId, poolKey: x.poolKey,
      types: [x.series, ...(x.runSeries || [])].map((s) => s.seriesType()), lineType: x.series.options().lineType ?? null }));
    const own = new Set(b.flatMap((x) => [x.series, ...(x.runSeries || [])]));
    const all = E.chart.panes().flatMap((p, i) => p.getSeries().map((s) => ({ pane: i, type: s.seriesType(), econ: own.has(s), title: s.options().title || '' })));
    return { econ, all, legendDom: document.getElementById('legend').innerText } })()`)""")
assert "summary[sc] = { audit, nav }" in s
s = s.replace("summary[sc] = { audit, nav }", "summary[sc] = { audit, nav, types }")
open(p, "w", encoding="utf-8").write(s)
print("ok")
