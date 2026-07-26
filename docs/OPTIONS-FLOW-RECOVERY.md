# Options Flow — recovering from a stale-buffer clobber

**If the "Options Flow guard" check went red, start here.**

## What happened

`app/src/pages/OptionsFlow.jsx` is edited through the GitHub web UI. If the browser
tab was opened before someone else's change landed, saving writes the *old* file
back over the new one. It looks like a normal commit and the page keeps working —
it just quietly loses whatever changed in between.

It happened twice on 2026-07-25:

| Commit | Diff | Effect |
|---|---|---|
| `7669b7e6` | 31 add / 60 del | reverted 4 load-path fixes |
| `57480200` | **1,606 add / 56 del** | re-inlined the whole compute layer, dropped the imports, reverted the 4 fixes again |

Neither broke the page. That is the danger: the only symptom is that Options Flow
goes back to freezing for ~2 seconds on every visit.

## Recover in three steps

### 1. Find the last good commit

```bash
git log --oneline -- app/src/pages/OptionsFlow.jsx | head -20
```
The last good one is the newest commit **before** the clobber whose message is not
`Update OptionsFlow.jsx`. Verify it:

```bash
git show <sha>:app/src/pages/OptionsFlow.jsx | grep -c "optionsFlow/flowWorkerClient"   # want 1
```

### 2. ⚠️ Rescue the new work in the clobbering commit FIRST

A stale-buffer save is usually *mostly* old code plus a few genuinely new lines —
and those new lines are real work that must not be thrown away. Both times, the
clobbering commit contained something worth keeping (a heavy-BLOCK direction
strip; a Search-flicker cache). **List what is genuinely new before restoring
anything:**

```bash
python - <<'PY'
import subprocess
run = lambda a: subprocess.run(a, capture_output=True, text=True,
                               encoding='utf-8', errors='replace').stdout
CLOBBER = '<sha of the bad commit>'
GOOD    = '<sha of the last good commit>'
pre  = set(l.rstrip('\r') for l in run(['git','show',GOOD+':app/src/pages/OptionsFlow.jsx']).split('\n'))
diff = run(['git','show',CLOBBER,'--','app/src/pages/OptionsFlow.jsx'])
added = [l[1:].rstrip('\r') for l in diff.split('\n')
         if l.startswith('+') and not l.startswith('+++')]
new = [l for l in added if l.strip() and l not in pre]
print("added:", len(added), " GENUINELY NEW:", len(new))
for l in new: print("  ", l[:130])
PY
```

Anything printed under `GENUINELY NEW` is work that only exists in the clobbering
commit. Copy it somewhere before step 3.

### 3. Restore, then re-apply the rescued lines

```bash
git checkout <last-good-sha> -- app/src/pages/OptionsFlow.jsx
# paste the rescued lines back in by hand
cd app && npx vitest run src/pages/optionsFlow/     # guard must go green
npm run build                                       # must succeed
```

Then commit, saying explicitly in the message which commit you restored over and
which lines you carried forward.

## Check it worked

```bash
cd app && npx vitest run src/pages/optionsFlow/
```

All of these must pass — each one maps to a specific regression:

| Guard | What it stops |
|---|---|
| imports the compute layer | the 1,500-line re-inline |
| routes through the worker client | parse + aggregate back on the main thread (~1.9s freeze) |
| no `parsedRows` in component state | ~1,027ms of structured clone to get rows out of the worker |
| `shouldFetchVersion` present | every alt-tab re-crunching the dataset |
| `baseFetchUrl` present | Cloudflare serving a stale refresh |
| `Promise.all(weeks)` present | the ER calendar racing the load into a second aggregation |
| `getErCache`/`setErCache` present | a re-entry aggregating twice |
| compute layer has no `window`/`fetch` | the worker throwing at runtime |
| `THEME_LOOKUP` populated inside flowCompute | the worker silently losing every theme |

Then confirm on the live page: the header should read
`<date> · N confirmed of M trades`, and the console `[perf]` lines should say
**`worker`**, not `MAIN THREAD`.

## Preventing it

- **Refresh the GitHub file page immediately before editing.** If it changed since
  your tab opened, GitHub warns you — redo the edit on the fresh copy rather than
  committing over it.
- **Edit the flow logic in `app/src/pages/optionsFlow/flowCompute.js`**, not
  `OptionsFlow.jsx`. It is not in that file any more, and `flowCompute.js` has
  never been hit by one of these saves.
- For anything larger than a one-liner, pull the repo and edit locally.
