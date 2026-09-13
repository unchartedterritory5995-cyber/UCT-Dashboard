# Wave Q1 — browser certification (§32)

> **STATUS: THE BROWSER MATRIX IS COMPLETE AND GREEN. Q1 IS STILL OFF.**
>
> Every environment §32 names has been measured on a real browser, including
> **Safari on two real iPhones**. Nothing here was inferred from Chrome.
>
> `OFFLINE_DEFAULT_ON` in `app/src/pages/journal-2-0/lib/offline/offlineFlag.js`
> remains **`false`**. Because the code already reached `master` dark, the next
> step is not a merge — it is an activation, and that is the owner's call.
> **This document requests it; it does not take it.**

Measured 2026-09-09 against `https://uctintelligence.com` (production).
Instrument: `app/public/q1-probe.html` (`/q1-probe.html`), driven by
`tools/q1_browser_probe_run.py` for the desktop rows and by hand on
BrowserStack Live for the two iPhones.

- Raw JSON for the five automated rows: `docs/notebook/wave-q1-probe-results/`.
- Raw JSON for the device and owner-profile rows: `GET /api/q1-probe-results`
  (admin-gated, on the production volume, newest 25 kept).
- ⛔ The probe touches only databases named `uct_q1_browser_probe*`; its delete
  helper refuses every other name. No member note was involved in any row.

---

## ⛔ WHAT IS CERTIFYING EVIDENCE, AND WHAT IS NOT

Every row below was measured against **`https://uctintelligence.com`**. That is
what makes it certification.

⚰️ A separate local server on port 8099 was used only for probe shake-out and
debugging, and it turned out to be **untrustworthy**: that port already had a
listener — another workstream's hub sandbox on `0.0.0.0:8099` since 00:02 — and
Windows allowed three more Wave Q binds beside it without an error. Requests to
`127.0.0.1:8099` may have been answered by any of them.

**The matrix is unaffected**, because none of it came from that server. But the
distinction is now enforced in code rather than remembered: a run started with
`--serve` writes `local-<label>.json` (gitignored) and carries
`"certifying": false`, so a shake-out can never overwrite a production artifact
the way it nearly did.

**LOCAL SHAKE-OUT: NON-CERTIFYING. PRODUCTION: CERTIFYING.**

The harness that makes a local or tunnelled run trustworthy at all is described
in `wave-q1-harness-integrity.md`.

## The matrix

| Environment | IDB | persistence | quota / headroom | Web Locks | versionchange (with / without handler) | reload durability | tab-close durability | verdict |
|---|---|---|---|---|---|---|---|---|
| **Safari / iOS 17.5.1** — real iPhone 15 | ✅ open 4 ms, atomic note+outbox write **2 ms** | `persisted()` false; **`persist()` returned false** | **41.2 GB** quota, 47 B used | ✅ present · exclusive · second contender refused · queued waited then granted · `query()` supported · none left held | **0 ms** / **blocked, still stuck at 2,502 ms** | ✅ note, body and outbox all survive | ⚠️ via reload (see note) | **DURABLE_OFFLINE_SUPPORTED** |
| **Safari 26.6 / iOS** — real iPhone 17 (UA reports `OS 18_7`) | ✅ open 6 ms, atomic write **1 ms** | same | **41.2 GB** | ✅ all legs | ✅ / blocked | ✅ | ⚠️ via reload | **DURABLE_OFFLINE_SUPPORTED** |
| **Chrome 152 desktop** — owner's real profile | ✅ open 1.7 ms, atomic write 11.6 ms | ✅ **`persisted()` already true** | 10,790 MB quota, **550 MB used** (the bars store) | ✅ grant delay 0.6 ms | 1.2 ms / blocked 2,993.8 ms | ✅ | ✅ measured directly (tab closed, state read from another tab) | **DURABLE_OFFLINE_SUPPORTED** |
| **Chrome — fresh profile** (throwaway user-data-dir) | ✅ first-ever origin, stores created | false; **`persist()` refused** | 285,690 MB, 0 used | ✅ delay 0.7 ms | 0.8 ms / blocked 2,512.8 ms | ✅ | ⚠️ via reload | **DURABLE_OFFLINE_SUPPORTED** |
| **Chrome — incognito** (`confirmedPrivate: true`) | ✅ within the session | false; refused | **2,095.6 MB** (vs 285 GB on the fresh profile) | ✅ delay 0.4 ms | 0.4 ms / blocked 2,506 ms | ✅ within the session | ⭐ **data did NOT survive the session** — see §28 below | **DURABLE_OFFLINE_SUPPORTED (within the session)** |
| **Firefox 146 desktop** (disposable profile) | ✅ | false; **`persist()` TIMED OUT — a permission prompt with no user gesture** | 10,240 MB | ✅ delay 0 ms | 18 ms / blocked 2,753 ms | ✅ | ⚠️ via reload | **DURABLE_OFFLINE_SUPPORTED** |
| **Firefox 146 private browsing** | ✅ within the session | false; refused | 10,240 MB | ✅ | 15 ms / blocked 2,510 ms | ✅ within the session | ⚠️ no cross-session control taken | **DURABLE_OFFLINE_SUPPORTED (within the session)** |
| _WebKit 26 (Playwright, Windows)_ — supporting only | ✅ | ⛔ **`storage.estimate()` and `persist()` NOT SUPPORTED** | ⛔ unreadable | ✅ delay 15 ms | 30 ms / blocked 2,504 ms | ✅ | — | supporting evidence, **not a Safari row** |

⛔ **The WebKit row does not count as Safari, and it proved why.** Playwright's
WebKit reports no Storage Manager at all — while both real iPhones report a
41.2 GB quota through the same API. A build of the engine on a desktop OS is not
the browser members use, and had it been allowed to stand in for Safari it would
have written a false limitation into this table.

---

## The gate that could have stopped Wave Q1

§6: *"If Safari/iOS lacks Web Locks or otherwise cannot safely drain the outbox:
STOP."*

**It does not.** On a real iPhone 15 running iOS 17.5.1, `navigator.locks`:

- is present, and `locks.query()` works
- granted an exclusive lock
- **refused a second contender while it was held**
- made a queued contender **wait**, then granted it on release
- left nothing held afterwards

That is the whole single-leader contract, measured on the device. The same on
the iPhone 17. Safari tabs will not be READ-ONLY FOR SYNC, and the outbox drains
there like anywhere else.

---

## Findings worth keeping

**1 · `persist()` is refused nearly everywhere — and Q1 already assumed that.**
Safari says no on both iPhones. A fresh Chrome profile says no. Firefox does not
answer at all without a user gesture (its prompt never settles; the probe bounds
it and reports the timeout rather than hanging). The only environment where
persistence is granted is the owner's own Chrome profile, where it was granted
long ago through ordinary use. ⛔ Nothing in Q1 depends on
`navigator.storage.persist() === true`, which §19 required and this measurement
vindicates.

**2 · The `barsIDB` epitaph is settled on every engine.** With the
`onversionchange` handler `notebookDb` installs from version 1, a v2 upgrade
lands in 0–30 ms. Without it, the upgrade is blocked and still stuck when the
probe gives up — 2,502 ms on iOS, 2,993.8 ms on Chrome, 2,753 ms on Firefox,
2,504 ms on WebKit. Same result on seven environments: **the deadlock was never
the version bump.**

**3 · IndexedDB on iOS is fast.** Open 4–6 ms, and the atomic note+outbox
transaction 1–2 ms — quicker than the owner's Chrome profile (11.6 ms), which
carries 550 MB of chart bars. The ~200 ms coalescing window is comfortable on
every platform measured, and §21's instruction not to fork the debounce per
browser holds: one number still fits all of them.

**4 · Quota is not the constraint for Q1.** 41.2 GB on iOS, 10.2 GB free on the
owner's Chrome profile, 2.1 GB even in incognito — against note bodies measured
in kilobytes. (§18: this informs Q4's attachment budget; it is not a Q1
pass/fail, and the 500 MB attachment target was NOT certified here.)

**5 · ⚠️ Private browsing is not distinguishable from a normal profile by
capability test, and that is a product statement.** In Chromium incognito the
probe found IndexedDB available, writes durable, reload durable — and then the
control proved the data did **not** survive the session. §28 asks the product to
identify the case *from capability behaviour*; the honest finding is that it
**cannot**. `persisted()` is false and `persist()` is refused in incognito, but
both are equally false on a brand-new ordinary profile, so neither separates
them. The only visible difference is a quota heuristic (2.1 GB vs 285 GB), and
§28 forbids fingerprinting.

The consequence, stated plainly: **in a private window, "Saved on this device —
not yet synced to UCT" is true when it is shown and stops being true when the
window closes.** That is the browser mode behaving as designed, not a defect in
the wording — but it is the one place where our sentence outlives the fact.
Options, for the owner to rule on rather than for me to choose:
   (a) accept it — private browsing users are told the same thing every site
       tells them, and the server copy is unaffected;
   (b) soften the sentence wherever `persisted()` is false to "Saved in this
       browser", which is true in every case measured above;
   (c) treat a refused `persist()` as a reason to keep the note in the outbox
       more aggressively (sync sooner, hold less).
   ⛔ Not recommended: detecting private mode. It is fingerprinting, §28 forbids
   it, and it breaks the moment a browser changes its heuristics.

---

## Cleanup (§22)

- Both production certification notes removed through the canonical Notebook
  lifecycle (`DELETE /api/j2/notes/{id}` → 200 → soft-delete to Trash, the
  normal retention path). Neither is listed any more; the notebook is back to
  the 32 notes it held before this work began.
  - `d508bc73155d464bb4258cb48cea4eb4` — the certification test note
  - `44d796d671904fb5b143ba7f7b72329d` — the `(conflicted copy)` it produced
- The owner's per-account Notebook database is **empty on all four stores**
  (`notes` 0, `outbox` 0, `conflicts` 0, `meta` 0). ⛔ No unsynced state, no
  outbox residue, no conflict residue.
- Every probe database created by every run reported `deleted`, and the
  cross-session `carryover` marker was removed from the owner's browser too.
  The only Notebook-related database left on that profile is the empty
  per-account one.
- ⛔ Nothing else was touched: no other note, no preference, no `localStorage`
  key, and the origin's storage was never cleared.

## Inherited red, routed not fixed (§23)

`app/src/components/screener/reachable.test.js` fails on **19 modules** under
`app/src/pages/community/**`, `app/src/floor2/`, `app/src/hub/contracts.js`,
`app/src/lib/chatStreamManager.js`, `app/src/pages/charts/widgets/DockFundamentals.jsx`
and `app/src/pages/optionsFlow/flowBootstrap.js` — orphaned when `/community`
was pointed at `CommunityRedesign`. **Not Wave Q's, not touched, not claimed as
green.** It belongs to the workstream that made that swap.

---

## What Q1 asks for now

The matrix is complete. Per §29, that means Q1 certification **may close** — and
that the next step is an activation, not a merge, because the code is already on
`master` and inert.

**Recommended controlled activation sequence, for approval:**

1. Flip `OFFLINE_DEFAULT_ON` to `true` in one commit that changes nothing else,
   so the revert is one line.
2. Verify on the deployed artifact that a keystroke now reaches IndexedDB —
   the same check that proves it dark today, run in the opposite direction.
3. Watch for one week: `(conflicted copy)` notes created (should stay near zero
   for single-device members), and any `permanent: true` outbox entries (an
   entry that can never send is the shape worth knowing about early).
4. Rollback is `localStorage['uct.j2.offline.enabled'] = '0'` for one browser,
   or the one-line flip for everyone. No data is destroyed either way: a durable
   copy left behind by a switched-off feature is inert, and the server holds
   every synced note regardless.

⛔ **Until that approval, the flag stays false and every deploy re-proves it**
(`NoteEditorPage.durable.test.jsx` → *"the §32 certification gate — DARK BY
DEFAULT"*, with its control).
