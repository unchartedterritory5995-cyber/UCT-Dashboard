# A/B: the second-context door was SAMPLING, and that was the whole failure

**Same cell. Same production. Same rig profile. Only the waiter changed.**

| attempt | evidence dir | code | GREEN | INCONCLUSIVE | seconds |
|---|---|---|---|---|---|
| 1 | `20260918T160322-…` | blind `wait_for_timeout(6000)` | 2 | 2 | 436.6 |
| 2 | `20260918T161040-…` | blind `wait_for_timeout(6000)` | 3 | 1 | 392.2 |
| 3 | `20260918T161713-…` | **`wait_for_selector`** | **4** | **0** | 428.7 |

⭐ **Attempts 1 and 2 are the control, and they differ from each other with NO code
change** — `folder` was INCONCLUSIVE in attempt 1 and GREEN in attempt 2. A cell
whose verdict moves while the code is fixed is reading a RACE, and that is what
separated "the instrument is losing cells" from "the product is failing". Without
that variance the 2 of 4 could have been filed as a product fact.

## The mechanism

`second_writer_door` navigated with `wait_until="domcontentloaded"` — which fires
**before React renders** — then slept a flat 6 s, then fired a door whose first act
is:

```js
const sel = document.querySelector('select');
if (!sel) return {ok:false, why:'no folder <select> on the page'};
```

A `querySelector` is a SAMPLE. An editor mounting at 6.5 s therefore produced
*"no folder `<select>` on the page"* — a sentence that reads like a product fact
and is a statement about when the rig happened to look.

## Cost before the fix, on this one cause

- the 3301 s monolithic run: **4 of 12** INCONCLUSIVE
- chunk `settle-first` attempt 1: **2 of 4**
- chunk `settle-first` attempt 2: **1 of 4**

## Why the duration did not change

428.7 s against 436.6 s and 392.2 s — the waiter is not *faster*, it is *correct*.
It returns the instant the control exists instead of at a fixed 6 s, which on a
fast mount is quicker and on a slow mount is the difference between a verdict and
an INCONCLUSIVE. ⛔ Every budget is **>= the sleep it replaced**, so nothing that
used to pass could start failing.

## The class

This is the third sighting in this programme, and CLAUDE.md predicted the location
verbatim: *"Grep for `wait_for_timeout(` beside a `query_selector` and you will
find the rest."* The first sighting took the `ticker` cell from GREEN 3 /
INCONCLUSIVE 3 in 748 s to **GREEN 6 / 0 in 211 s**.

⚠️ **Not claimed:** that every remaining INCONCLUSIVE in 2.8b has this cause. The
other five chunks have not run under the fix yet, and the append families carry
separate, named rig limitations.
