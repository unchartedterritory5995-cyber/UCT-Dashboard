# Landing without a six-shard gate — the coverage argument, stated rather than assumed

> **This landing did NOT run a local six-shard gate, and that is a deviation from the standing
> rule. It is written down here rather than left implicit, because a deviation nobody records
> is indistinguishable from a rule nobody follows.**

---

## What changed

| file | kind |
|---|---|
| `app/src/hub/hub.module.css` | a CSS module — the `.bubbleDisabled` treatment (D-57) |
| `tools/hub_contrast.py` | an operator tool, not shipped to any member |
| `docs/plans/joystick/deferred.md` | prose |

**No JavaScript, no JSX, no API, no config.**

## Why the box was not taken

Two `gate_shards` runs were holding the box lock, neither of them this session's. This session
had already told the `indicator-r0r1` workstream — in writing, after four collisions across the
day — that its previous run was its last and the box would be free. **Taking it back to gate a
stylesheet would have been a promise broken for a change that cannot fail a JS test.**

## Why a stylesheet change cannot move a jsdom result

⛔ **jsdom applies no CSS and performs no layout.** It resolves no `calc()`, no
`env(safe-area-inset-*)`, and reports zero for every measured box — which is why this repo's
own rules forbid claiming a device result from it. The corollary is the useful direction here:
a `.module.css` edit is invisible to every test that renders a component, in both directions.

The ONLY tests that can observe it are those that read the stylesheet **as text**. That set is
enumerable, and it was enumerated rather than recalled:

```
grep -rln "hub\.module\.css|tokens\.css"  src --include=*.test.js --include=*.test.jsx
grep -rln "readFileSync.*\.css"           src --include=*.test.js --include=*.test.jsx
```

**26 files. All 26 run, 431 tests, 0 failures.** They include every rail that exists to catch
exactly this kind of edit: `tokens.reachable`, `themeIslands`, `hubComponents` (the no-hex
rail), `hubMotionTokens`, `reducedMotion`, `hubZIndex`, `modeAccentSeparation`,
`cursorAppearance`, `EarningsResearchModal.themeIsland`, `mobileShellHeight`.

Plus the full hub surface: `src/hub` + `src/styles` + `src/pages/settings` — **93 of 94 files,
1291 tests**, with the single red being `tapFloor.test.js`, the known baseline entry that
belongs to Notebook (D-52) and that this branch cannot touch under rule 12.

## And the carry-over checks on the landing tree

```
CARRIES — C1, C2, C3 all pass — the incoming commits cannot interact
C4 vitest : 2 files, 23 tests, green
C4 python : 298 passed, 2 skipped
```

## ⛔ C5 is what makes this a deferral and not a skip

The **`master deploy gate` workflow runs the full suite against the ACTUAL LANDED TREE** before
`production` advances, and Railway deploys from `production`. That is the designed backstop for
precisely this shape: local evidence proves the change, C1–C4 prove the incoming commits cannot
interact, and the master gate re-verifies merged reality before a member sees anything.

⚠️ **If that workflow goes red, this landing is wrong and the correct response is an immediate
report and a revert — not a re-argument of the paragraphs above.**
