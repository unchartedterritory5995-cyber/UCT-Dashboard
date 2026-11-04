"""Regenerates muts-py.json and muts-vitest.json (run from the repo root)."""
import json

W = ".github/workflows/master-deploy-gate.yml"
RB = "docs/runbooks/pine-runtime-service.md"
M = []


def m(n, f, o, nw):
    M.append([n, f, o, nw])


m("control:noop-comment", W, "      # ── PINE RUNTIME SERVICE (W5-T19, 2026-11-04)", "      # (control) ── PINE RUNTIME SERVICE (W5-T19, 2026-11-04)")
m("step2:drop-hp4-control", W, "          node tools/pine_runtime_host_parity.mjs --host node --mutation-control\n", "")
m("step2:drop-check", W, "          node tools/pine_runtime_host_parity.mjs --host node --check\n", "")
m("step2:add-chromium-half", W, "          node tools/pine_runtime_host_parity.mjs --host node --mutation-control\n",
  "          node tools/pine_runtime_host_parity.mjs --host node --mutation-control\n          python tools/pine_runtime_host_parity.py --dist app/dist\n")
m("step1:drop-import", W, "          node -e \"import('./dist-server/pine-runtime.mjs').then(() => console.log('bundle imports'))\"\n", "")
m("step1:wrong-working-dir", W, "        working-directory: app\n        run: |\n          node scripts/build-pine-runtime.mjs", "        run: |\n          node scripts/build-pine-runtime.mjs")
m("step1:continue-on-error", W, "      - name: Pine runtime - the server bundle builds and imports under bare Node\n",
  "      - name: Pine runtime - the server bundle builds and imports under bare Node\n        continue-on-error: true\n")
m("step5:conditional", W, "      - name: Pine runtime - service unit rails\n", "      - name: Pine runtime - service unit rails\n        if: always()\n")
m("step5:dir-not-glob", W, "node --test services/pine_runtime/test/*.test.mjs", "node --test services/pine_runtime/")
m("step3:swallowed", W, "tests/test_pine_runtime_engine_identity.py -q -p no:cacheprovider\n", "tests/test_pine_runtime_engine_identity.py -q -p no:cacheprovider || true\n")
m("step3:wrong-python", W, "run: /tmp/prodvenv/bin/python -m pytest tests/test_pine_runtime_engine_identity.py", "run: python -m pytest tests/test_pine_runtime_engine_identity.py")
m("step6:drop-codec-file", W, " tests/test_pine_runtime_codec.py", "")
m("step6:drop-own-rail", W, "codec.py tests/test_pine_runtime_deploy_gate.py", "codec.py")
m("step7:renamed", W, "- name: Pine runtime - the image agrees with Dockerfile.web", "- name: Pine runtime - image")
m("step7:drop-dockerfile-test", W, "tests/test_pine_runtime_dockerfile.py -q", "tests/test_pine_runtime_client.py -q")
m("node:setup-pin-22", W, "          node-version: '20'", "          node-version: '22'")
m("node:compare-dropped", W, "test -n \"$want\" && test \"$want\" = \"$have\"", "test -n \"$want\"")
m("node:reads-wrong-file", W, "services/pine_runtime/Dockerfile | head -n 1", "Dockerfile.web | head -n 1")
m("node:step-before-install", W, "      - name: Install the app's dependencies (for the UCT Agent browser tests)",
  "      - name: Pine runtime - this runner's Node is the image's Node\n        run: true\n      - name: Install the app's dependencies (for the UCT Agent browser tests)")
m("node:second-setup-node", W, "      - name: Explain a failure\n", "      - uses: actions/setup-node@v4\n        with:\n          node-version: '18'\n\n      - name: Explain a failure\n")
m("order:step7-before-step6", W, "      - name: Pine runtime - client, codec and composition rails",
  "      - name: Pine runtime - the image agrees with Dockerfile.web\n        run: /tmp/prodvenv/bin/python -m pytest tests/test_pine_runtime_dockerfile.py -q\n      - name: Pine runtime - client, codec and composition rails")
m("step4:dropped", W, "        run: node tools/pine_runtime_closure.mjs --check\n", "        run: node --version\n")
m("step4:no-check-flag", W, "run: node tools/pine_runtime_closure.mjs --check", "run: node tools/pine_runtime_closure.mjs")
m("step4:renamed", W, "- name: Pine runtime - the closure stays host-neutral", "- name: Pine runtime - closure")
m("step4:moved-after-step5", W, "      - name: Pine runtime - service unit rails", "      - name: Pine runtime - the closure stays host-neutral\n        run: node tools/pine_runtime_closure.mjs --check\n      - name: Pine runtime - service unit rails")
m("runbook:drop-a-watch-path", RB, "`app/package*.json`, ", "")
m("runbook:drop-never-built", RB, "The image has never been built.", "The image is fine.")
m("runbook:drop-columnDigest", RB, "`runtime/columnDigest.js`", "`runtime/x.js`")
m("deploywindows:drop-pointer", "docs/runbooks/deploy-windows.md", "Runbook and gate: `docs/runbooks/pine-runtime-service.md`.", "Runbook and gate: elsewhere.")
json.dump(M, open("docs/pine/evidence/2026-11-04-w5-t19/muts-py.json", "w"), indent=1)

V = []
P = "../tools/pine_runtime_host_parity.mjs"


def v(n, o, nw):
    V.append([n, P, o, nw])


v("control:noop-comment", "// W5-T19: HP-1 on a V8 other", "// (control) W5-T19: HP-1 on a V8 other")
v("v8:always-moved", "const v8Moved = Boolean(v8Was && v8Now && v8Was !== v8Now)", "const v8Moved = true")
v("v8:compare-dropped", "const v8Moved = Boolean(v8Was && v8Now && v8Was !== v8Now)", "const v8Moved = Boolean(v8Was && v8Now)")
v("v8:missing-counts-as-moved", "const v8Moved = Boolean(v8Was && v8Now && v8Was !== v8Now)", "const v8Moved = !(v8Was && v8Now && v8Was === v8Now)")
v("v8:unlisted-reported", "if (ro.has(name) && ds.every((d) => d.field === 'digest')) {\n        reportedLines", "if (ds.every((d) => d.field === 'digest')) {\n        reportedLines")
v("v8:any-field-reported", "if (ro.has(name) && ds.every((d) => d.field === 'digest')) {\n        reportedLines", "if (ro.has(name)) {\n        reportedLines")
v("v8:report-line-not-emitted", "  lines.push(...reportedLines)\n", "")
v("v8:report-line-loses-recorded-v8", "digest differs from the one recorded on V8 ${v8Was}; this run is V8 ${v8Now}; ${ro.get(name)}", "digest differs; ${ro.get(name)}")
v("v8:report-line-loses-reason", "this run is V8 ${v8Now}; ${ro.get(name)}`)", "this run is V8 ${v8Now}`)")
v("v8:diffs-not-narrowed", "    diffs = keep\n", "")
v("summary:rep-not-subtracted", "${n - rep}/${n} cases equal", "${n}/${n} cases equal")
v("summary:no-reported-suffix", "${rep ? `; ${rep} REPORTED, not gated (V8 differs from the recording V8)` : ''}", "")
v("summary:code-2-as-red", "return r.code === 2 ? 'HP-1 INCONCLUSIVE' : 'HP-1 RED'", "return 'HP-1 RED'")
json.dump(V, open("docs/pine/evidence/2026-11-04-w5-t19/muts-vitest.json", "w"), indent=1)
print(len(M), len(V))
