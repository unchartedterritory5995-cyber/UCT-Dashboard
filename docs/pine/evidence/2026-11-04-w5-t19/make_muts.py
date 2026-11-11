"""Regenerates muts-py.json and muts-vitest.json (run from the repo root)."""
import json

W = ".github/workflows/master-deploy-gate.yml"
RB = "docs/runbooks/pine-runtime-service.md"
M = []


def m(n, f, o, nw):
    M.append([n, f, o, nw])


m("control:noop-comment", W, "  # ── PINE RUNTIME SERVICE (W5-T19, 2026-11-04)", "  # (control) ── PINE RUNTIME SERVICE (W5-T19, 2026-11-04)")
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
m("step6:drop-own-rail", W, "composition.py tests/test_pine_runtime_deploy_gate.py", "composition.py")
m("step7:renamed", W, "- name: Pine runtime - the image agrees with Dockerfile.web", "- name: Pine runtime - image")
m("step7:drop-dockerfile-test", W, "tests/test_pine_runtime_dockerfile.py -q", "tests/test_pine_runtime_client.py -q")
SN = "      - uses: actions/setup-node@v4\n        with:\n          node-version: '20'\n          cache: npm\n          cache-dependency-path: app/package-lock.json\n\n      - name: Install the app's dependencies (for the Pine runtime bundle)"
m("node:setup-pin-22", W, SN, SN.replace("'20'", "'22'"))
m("node:compare-dropped", W, "test -n \"$want\" && test \"$want\" = \"$have\"", "test -n \"$want\"")
m("node:reads-wrong-file", W, "services/pine_runtime/Dockerfile | head -n 1", "Dockerfile.web | head -n 1")
m("node:step-before-install", W, "      - name: Install the app's dependencies (for the Pine runtime bundle)",
  "      - name: Pine runtime - this runner's Node is the image's Node\n        run: true\n      - name: Install the app's dependencies (for the Pine runtime bundle)")
m("node:second-setup-node", W, "      - name: Pine runtime - the image agrees with Dockerfile.web\n", "      - uses: actions/setup-node@v4\n        with:\n          node-version: '18'\n\n      - name: Pine runtime - the image agrees with Dockerfile.web\n")
m("job:conditional", W, "    name: Pine runtime service rails (section 8)\n", "    name: Pine runtime service rails (section 8)\n    if: always()\n")
m("job:not-in-verdict-needs", W, "needs: [gate, agent-browser, agent-browser-union, pine-runtime]", "needs: [gate, agent-browser, agent-browser-union]")
m("verdict:result-not-tested", W, " && [ \"${{ needs.pine-runtime.result }}\" = success ]; then", "; then")
m("step6:drop-composition", W, " tests/test_pine_runtime_composition.py", "")
m("deps:not-production-set", W, "-m pip install --quiet -r requirements.txt\n          /tmp/prodvenv/bin/python -m pip install --quiet pytest httpx", "-m pip install --quiet pytest httpx")
m("other-job-node-pin-moved", W, "    needs: agent-browser\n    runs-on: ubuntu-latest\n    timeout-minutes: 15\n    steps:\n      - uses: actions/checkout@v4\n      - uses: actions/setup-node@v4\n        with:\n          node-version: '20'", "    needs: agent-browser\n    runs-on: ubuntu-latest\n    timeout-minutes: 15\n    steps:\n      - uses: actions/checkout@v4\n      - uses: actions/setup-node@v4\n        with:\n          node-version: '22'")
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

print(len(M))
