# Wave 13 lane 13H-4 — mutation proof

Targets: `app/src/components/StockChart.jsx`'s `annotationsEditable`-branch MobileDrawBar
swap (M1, M2) and `app/src/pages/journal-2-0/components/notebook/ChartEmbed.jsx`'s second
AND-gate on `mobileDrawBar` (M3).

Test files: `app/src/components/StockChart.annotationsMobileDrawBar.test.jsx` (M1, M2),
`app/src/pages/journal-2-0/components/notebook/ChartEmbed.mobileDrawBar.test.jsx` (M3).

Method: capture the file's bytes, apply ONE textual mutation, run the test file, record
the result, restore by writing back the captured original bytes (never `git checkout --`),
verify the restored file's sha256 matches the pre-mutation capture before moving to the
next mutation. Script: `w13h4_mutate.py` (session scratchpad, lane-unique name); raw
results: `raw-results.json` in this directory.

StockChart.jsx baseline sha256 (before M1, after M1-restore, before M2, after M2-restore):
`05db055514064d924b5bc46bec111cab61398461ac5b5f19b838e50793c518ec`.
ChartEmbed.jsx baseline sha256 (before M3, after M3-restore):
`6e56377e3fff744b76f5f9157fabf56475afe1c7316fce0befbc8ec9006ff23f`.

## M1 — drop the `mobileDrawBar` gate on MobileDrawBar's own render

```
{annotationsEditable && mobileDrawBar && (
            <MobileDrawBar
                      ↓
{annotationsEditable && (            // MUTATED M1
            <MobileDrawBar
```

Result: **killed** — `opt-out (default): no MobileDrawBar, and the ChartToolbar host is
not hidden` fails, because MobileDrawBar now renders even with `mobileDrawBar` unset:

```
expect(screen.queryByTestId('mobile-draw-bar')).toBeNull()
AssertionError: expected <div …> to be null
```

## M2 — drop `hiddenHost` on the annotationsEditable `ChartToolbar`

```
hideCountdown
              hiddenHost={mobileDrawBar}
            />
                      ↓
hideCountdown        // MUTATED M2 -- hiddenHost line removed
            />
```

Result: **killed** — `opt-in: mobileDrawBar swaps in MobileDrawBar and hides the
ChartToolbar host` fails: the desktop toolbar is never hidden, so no element in the embed
carries `style="display: none"`:

```
expect(container.querySelector('[style*="display: none"]')).toBeTruthy()
AssertionError: expected null to be truthy
```

## M3 — drop the second `annotate` AND-gate in ChartEmbed.jsx

```
mobileDrawBar: !!annotate && !!mobileDrawBar,
                      ↓
mobileDrawBar: !!mobileDrawBar,          // MUTATED M3 -- annotate dropped
```

Result: **killed** — `NOT drawing: mobileDrawBar can never reach StockChart true, even if
a stale caller still passes it` fails: a read-only chart (`annotate={false}`) with a stale
`mobileDrawBar` prop now reaches StockChart as `true`:

```
expect(panes[0].stockChartProps.mobileDrawBar).toBe(false)
- Expected: false
+ Received: true
```

## Restore verification

After every mutation the file was restored by writing back the captured original bytes
(never `git checkout --`) and its sha256 was re-checked against the baseline before the
next mutation ran. All three restores verified (`restored_sha == baseline_sha`). A final
`python tools/check_repo_hygiene.py` over the restored tree reports clean.

## A line-ending near-miss, caught before any of this ran

Before the mutation script could be trusted, the four shared files this lane edits
(`StockChart.jsx`, `ChartEmbed.jsx`, `widgetEmbedCore.js`, `tools/notebook_w13h2_walk.py`)
were found to have been silently rewritten to **uniform CRLF** on disk by the editing tool
mid-lane, while their committed HEAD blobs are uniformly LF (`git cat-file blob` on each:
`CR == CRLF == LF` on disk, `CR 0` at HEAD) — the exact R-2 hazard CLAUDE.md's "Write a
file with the line endings GIT ALREADY STORES" section warns about, and the reason the
mutation script's own string-match assertions failed on the first attempt (the real file
held `\r\n` where the script's "old" string — written against the LF original — held
only `\n`). `WidgetEmbedView.jsx`, edited with the same Edit tool in the same session,
was unaffected (stayed LF throughout) — the cause was not chased further since it did not
block the fix, but the asymmetry is recorded here rather than assumed away.

Fixed by a direct, lossless `b.replace(b"\r\n", b"\n")` on each affected file (verified
first that `CR == CRLF == LF` with no stray bare CR and no `CRCRLF` — the uniform,
reversible case, not the corrupted double-translation one) and confirmed with
`python tools/check_repo_hygiene.py` (clean) and `git diff --stat` (47 insertions / 1
deletion across the two StockChart.jsx + ChartEmbed.jsx hunks — matching the actual
intended edit, not a whole-file rewrite). Caught before any commit; recorded here because
the mutation proof above is only meaningful against a file whose bytes are what they
appear to be.
