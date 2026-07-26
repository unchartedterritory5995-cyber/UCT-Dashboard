# Options Flow — what changed, and the one thing you need to do differently

Hey Ravi — I spent Saturday night making the Options Flow page load fast. It was
taking 3–8 seconds **every single time** anyone opened it. It's a lot quicker now.

I had to touch `OptionsFlow.jsx`, which I know is your file. Here's everything,
plainly.

---

## 1. The one thing that changes your workflow

**The flow logic has moved to a new file.**

| What | Where it is now |
|---|---|
| `processFlowData` | `app/src/pages/optionsFlow/flowCompute.js` |
| `buildCharts`, `consistencyTable`, `detectPatterns`, `gradeCluster` | same file |
| `parseCSV`, sector/theme maps, `THEMES_DEF` | same file |

**So: if you're changing how a trade is classified, sided, graded, or charted,
edit `flowCompute.js`. That code is no longer in `OptionsFlow.jsx` at all.**

`OptionsFlow.jsx` is still everything else — the UI, the tabs, the tables, the
filters. It just imports the maths from the new file now.

Nothing was rewritten. It was moved by a script that checked the moved text was
**character-for-character identical** to what came out. Your logic is exactly as
you wrote it.

### Why it moved
Parsing and crunching 96,178 rows takes about 1.9 seconds, and it was freezing
the whole page while it ran. In its own file it can run on a background thread
instead, so the page stays responsive. That's the only reason.

### One rule for the new file
`flowCompute.js` must stay pure — **no `window`, no `document`, no `fetch`, no
React hooks.** A background thread doesn't have those. There's a test that fails
if any sneak in, so you'll find out immediately rather than in production.

---

## 2. Heads up — a save of yours got rolled back, and I put it back

Your commit `7669b7e6 "Update OptionsFlow.jsx"` (Sat 9:35pm) looks like it was
saved from a browser tab that had been open a while, so it was based on an older
copy of the file. It came in as **31 lines added, 60 removed** and it undid four
fixes I'd pushed earlier that evening.

**I've restored all four, and I kept your new work.** Your heavy-BLOCK change —

```js
if (t.D && t.Ty === "BLK" && t.P >= HEAVY_BLOCK_PREMIUM) { t.D = null; t.heavyBlock = true; }
```

— is live and is now in `flowCompute.js`. Nothing of yours was lost. (It's also
why the header went from "863 confirmed" to "862" — that's your change doing
exactly what it should, one big block print no longer counting directionally.)

**To avoid this happening again:** when you edit through the GitHub website,
refresh the page right before you start typing. If the file changed since you
opened the tab, GitHub will warn you — and the safest move is to redo the edit on
the fresh copy rather than committing over it. Same applies to me; I'll keep an
eye out too.

---

## 3. What I actually fixed (short version)

The page was doing the same work twice, every visit:

- It downloaded the same 12.4 MB of flow data **twice** — once as the main load
  and once as a "live delta". On the default 1-day view those two requests are
  *the same day*, so the second one was pure waste. Then it parsed and crunched
  all of it twice too.
- Alt-tabbing back to the app re-downloaded and re-crunched everything, **even
  after hours**, freezing the page for over a second each time. (The "version"
  the page checks is just a 60-second clock tick, so it changed on every focus
  whether or not any new trades had arrived.)
- Leaving the page and coming back threw everything away and started over.

Now: one download, one crunch, results kept in memory so coming back is instant,
and no pointless refreshes when the market's closed.

**Sidebar click → data on screen went from ~9.5 seconds to ~2.5 seconds**, and
coming back to the page is faster still with no network at all.

---

## 4. New files, so nothing surprises you

```
app/src/pages/optionsFlow/
  flowCompute.js          ← YOUR LOGIC LIVES HERE NOW
  flowCompute.test.js     ← guards it against accidental changes
  flowLoadPolicy.js       ← when to fetch/refresh (loading only, no flow logic)
  flowWorkerClient.js     ← background-thread plumbing (not switched on yet)
  flow.worker.js          ← ditto
  __fixtures__/flow-sample.csv  ← real 7/24 data the tests run against
```

The last two aren't switched on yet — that's the next step, and it won't change
any classification logic when it is.

---

## 5. If something looks wrong

The tests pin the confirmed-trade count, the direction of every confirmed trade,
and that the same input always gives the same output. Run them with:

```
cd app && npx vitest run src/pages/optionsFlow/
```

If a number on the page looks off to you — confirmed counts, bull/bear lean,
grading — tell me and I'll dig in. I changed *when* the data is loaded and
*where* the code lives, not *what* it decides. If a number moved, it's either
your BLOCK change or a bug, and I want to know which.
