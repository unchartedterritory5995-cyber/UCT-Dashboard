# Wave Q1 browser-probe results

Raw output of `app/public/q1-probe.html`, one JSON per environment.

## What is here

The five environments `tools/q1_browser_probe_run.py` can drive itself, written
verbatim by the runner — never retyped:

| file | what it is |
|---|---|
| `chromium-fresh.json` | a brand-new Chromium user-data-dir: a first-ever origin |
| `chromium-incognito.json` | Chromium incognito, **with** the `privateContext` control that proves the session really was private |
| `firefox.json` | Firefox 146, disposable profile |
| `firefox-private.json` | Firefox 146 private browsing (`browser.privatebrowsing.autostart`) |
| `webkit.json` | Playwright's WebKit 26 — ⛔ **supporting evidence only, NOT Safari and NOT iOS** |

## What is NOT here, and where it is instead

The rows that needed a real browser a script cannot drive — **Safari on a real
iPhone 15 (iOS 17.5.1) and a real iPhone 17 (Safari 26.6)**, plus Chrome 152 on
the owner's own profile — posted their results to the collection endpoint from
the device itself:

    GET /api/q1-probe-results        (admin-gated, newest 25, on the /data volume)

⛔ **They are deliberately not copied into this directory by hand.** Reading a
certification result off a screen and retyping it is how a matrix acquires a
number nobody measured; the endpoint holds exactly what the device sent. The
summary in `../wave-q1-browser-certification.md` cites those values and names
where to re-read them.

## Re-running

    python tools/q1_browser_probe_run.py --url https://uctintelligence.com/q1-probe.html

Add `--browsers firefox,webkit` to run a subset. For a real device, open
`https://uctintelligence.com/q1-probe.html?send=1&label=<name>` on it and tap
Run once — the page posts its own result.

⛔ Both the page and its route carry a removal condition: they go when this
matrix stops being needed.
