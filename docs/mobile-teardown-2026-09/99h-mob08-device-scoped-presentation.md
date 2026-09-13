# MOB-08 — presentation[deviceClass]

Shipped 2026-09-08 on `fix/mobile-legend-legacy-state`. The last unbuilt item in
the best-in-class mobile program, and the one the certification called "the one
place a careless refactor produces a blank board".

> **MOB-08 = SHIPPED**
> **DEVICE_SCOPED_PRESENTATION = PASS** (real hardware, iPhone 17 Pro / iOS 26.6)

---

## 1 · The defect, which was already in the codebase with a comment admitting it

`multichart_state.mode` (`'workspace' | 'grid'`) was ONE shared preference. So:

- a desktop user who entered Multi Chart made the **phone** open in grid mode —
  `ChartsWorkspace.jsx` said so out loud: *"grid mode persists from desktop, and
  without an exit control a phone user is TRAPPED in it"*;
- and the phone's escape hatch wrote `mode: 'workspace'` back to that same key,
  **destroying the desktop's grid mode**.

Bleed in both directions, with a UI workaround standing in for a scope fix. The
multi-chart grid is documented as *"desktop-only by design, and the phone is
explicitly protected from inheriting it"*. It was not protected. Now it is.

## 2 · The persistence schema addition

Additive, inside the record that already exists. **No new record, no parallel
mobile workspace.**

```jsonc
{
  "mode": "grid",                       // legacy shared key — RETAINED as a
                                        // desktop-only compatibility mirror
  "presentation": {                     // ← the whole addition
    "desktop": { "mode": "grid" },
    "mobile":  { "mode": "workspace" }
  },
  "layout": "2x2", "cells": [ … ], "group": null, "syncCrosshair": false
}
```

## 3 · Device-class vocabulary — **`desktop` | `mobile`**

The smallest set that maps to a real difference: the product has exactly two
chart shells, and `mode` differs between those two and **not** between phone and
tablet. A third class today would be a taxonomy with nothing behind it.

⛔ **Derived from the SHELL, not the user agent and not the pointer.**
`deviceClassOf(isMobile)` reads `ChartsWorkspace`'s existing `isMobile` — a
single MQL, deliberately one authority — so there is no second opinion about
what a device is. It is **not** `pointer: coarse`: that is a hit-target and
hover question. The program keeps four concepts apart (viewport/shell · pointer
semantics · touch hardware · presentation policy) and this collapses none of
them.

⭐ A future field that genuinely differs phone-vs-tablet extends the list, and
`normalisePresentation` **preserves unknown classes** precisely so that day
costs no data.

## 4 · Fields scoped — exactly one

| field | why it differs by device | owner | read | write | fallback |
|---|---|---|---|---|---|
| `mode` | the multi-chart grid is desktop-only by design | `useMultiChartState` | `readScopedField` | `writeScopedField` | desktop → legacy; mobile → product default |

**Desktop behaviour:** unchanged. A legacy blob still resolves through the old
top-level `mode`, and desktop writes keep mirroring it.
**Mobile behaviour:** never inherits the shared value; absent its own branch it
gets `'workspace'`.

### Deliberately left SHARED — and this is the discipline, not an oversight

`layout` (grid shape) · `cells` (which symbol, timeframe and chart type per
cell) · `group` · `groupsMode` · `syncCrosshair` · `syncTimeRange` · the whole
`charts_workspace_layout` widget arrangement · indicators · drawings · alerts.

⭐ **The line is "what am I looking at" vs "how does this device frame it".**
Which charts and which symbols are the BOARD — shared, unchanged, one source of
truth. Whether *this* device renders that board as a desktop grid is a property
of the device. Nothing was moved merely because it felt cleaner.

## 5 · Precedence, stated once

```
presentation[deviceClass].mode          — this device's own answer
  → the legacy shared `mode`            — ONLY for classes in legacyFallbackFor
  → the product default 'workspace'
```

⛔ **The fallback list is the load-bearing column.** A field is scoped precisely
because the shared value is *wrong* for some class, so that class must not fall
back to it — falling back would faithfully reproduce the bug. `legacyFallbackFor`
is `['desktop']`.

**The legacy key's status: read-only compatibility fallback, with ONE writer.**
Desktop mirrors its value there so a rollback to pre-MOB-08 code still finds a
correct grid mode; the phone never writes it, which is what stops the phone
clobbering the desktop. It is a mirror of a derived value, not a second
authority — and it is railed as such.

## 6 · API merge behaviour, and where the risk actually was

`POST /api/auth/preferences` takes `{key, value}` and stores the value whole —
there is no server-side deep merge, so the client is responsible for not
dropping fields. The danger was **not** in the API:

⛔ **`gridLayouts.sanitizeState` is an ALLOW-LIST.** Every key it does not name
is dropped. A `presentation` key added without touching it would have been
silently erased on every hydrate: the scoped state would never survive a round
trip, and each device's save would wipe the other's branch. The feature would
have looked correct in memory and lost everything on reload. That is the entire
blank-board risk of this item, and it lives in one line — `presentation:
normalisePresentation(raw.presentation)` — which is mutation-checked.

`writeScopedField` is additive and surgical: every other class, every unknown
class, every unknown field inside a known class, and every unrelated top-level
key is carried through untouched.

## 7 · Backward compatibility

| case | behaviour |
|---|---|
| A · no `presentation` at all | desktop reads legacy; **mobile does NOT inherit it** |
| B · present, missing this class | falls through precedence to default |
| C · legacy fields still present | untouched, still read by desktop |
| D · unknown future class (`watch`) | **preserved** through writes and round trips |
| E · malformed `presentation` (string, number, array, null branch) | degrades to `{}` / safe default, **never throws** |
| F · current blob with scoped presentation | both branches survive a reload |

⭐ **Runtime normalisation, no bulk migration.** Nothing rewrites a stored
workspace on read. An old blob is interpreted correctly and only ever gains the
new key when that device actually changes its own presentation.

## 8 · Tests and mutation checks

**16 new cases** (`devicePresentation.test.js`) covering the matrix above plus
the exact shipped bleed (`a phone exiting grid must not clear the desktop`), the
single-mirror-writer rule, and "an unknown field is not a licence to write one".

**Regressions:** `pages/charts` + `testing/device` **640/640** · `components/chart`
**7,246 passing** with only the three known pre-existing failures (ImportBox
CRLF, manifestProse `_session`, pine.blindCorpus) — no new ones.

**Mutation-checked** (byte snapshot + `os.replace`, restored byte-identical):

| mutation | result |
|---|---|
| `sanitizeState` drops `presentation` (the allow-list trap) | **RED** |
| mobile allowed to inherit the shared legacy mode | **RED** |
| the phone becomes the legacy-key writer | **RED** |
| a write REPLACES `presentation` instead of merging | **RED** |
| a malformed branch is kept instead of dropped | **RED** |

⚰️ That last one was **GREEN on the first pass** — the rail asserted the sibling
survived but never that the bad branch was gone, so a mutation carrying garbage
through passed it. Tightened, then red. A rail that cannot distinguish is not a
rail.

## 9 · Real-device evidence

**iPhone 17 Pro / iOS 26.6**, authenticated, via the Route-B harness:

```
UCT R1 · 402×714 · portrait · 12.1s
PASS 17 · FAIL 0 · BLOCKED 0 / 17 · ROUNDTRIP PASS · MOB08 PASS · DONE
  … 
P T1 seed a DESKTOP-in-grid record (the shipped defect)
P T1 the PHONE does not inherit the desktop grid        → inGrid=false canvas=1
P T1 and the phone did not touch the DESKTOP's branch   → desktop.mode=grid legacy=grid
cleanup: layout deleted · multichart_state restored · marker removed
```

⭐ **This is the discriminating assertion the MOB-08 gate's asterisk was about:**
one record, two device classes, two different answers — seeded with a
desktop-in-grid state that reproduces the shipped defect, so a regression cannot
pass it quietly. Isolated sandbox throughout; no real board touched.

⚠️ **A device was spent on nothing, and it is a measurable fact worth keeping:**
an iPhone 13 consumed its entire 60-second session on `Booting … Optimizing for
performance` and never reached Safari. **The cap includes boot.** Prefer recent
hardware; budget for a wasted device.

## 10 · Two instrument defects found by local validation, not by the device

Both were mine, both the same family, both caught before hardware:

1. `rot-baseline` used `settle()` alone and went red after the MOB-08 steps
   reloaded the iframe — **`settle` proves a value STOPPED MOVING, which a blank
   mid-remount frame satisfies perfectly.** Readiness is `until`; stability is
   `settle`. Three Tier-3 steps had the same shape and were fixed with it.
2. The harness minted a fresh password per run, so a second `--validate` against
   a live sandbox could not log in. Now it reuses the staged (gitignored)
   credential, and never the negative control's.

## 11 · What this does NOT change

No flow verdict moves. MOB-08 is a persistence-scope fix; F19 (save/restore a
workspace) was already UCT_AHEAD and its evidence is unchanged. The 20-flow
distribution stands at **UCT_AHEAD 11 · PARITY 7 · TRADINGVIEW_AHEAD 0 ·
DIFFERENT_MODEL 1 · PARTIAL 1**.
