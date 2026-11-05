VERDICT: GO-WITH-NOTES @a2f137dc67

Lane: Editor status panel E2 (WAVE-TASKS "Editor status panel"), branch origin/feat/pine-editor-status, tip a2f137dc67.
Own diff: merge-base 6272ed7fa3..a2f137dc67, 7 commits, 15 files (+3414/-8): editorStatus.js, editorStatusGate.js,
PineEditorStatus.jsx/.module.css, PineBox.jsx, BuilderSheet.jsx (+10, the savedRow prop), editor/CodeEditor.jsx,
editor/diagnostics.js, Dockerfile.web, docs/feature_flags.json, the spec, 4 test files.
Reviewer: independent desktop Opus, read-only, 2026-11-05. Engine bump: NO (SCRIPT_ENGINE_VERSION untouched).

## Earlier NO-GO findings (rounds 1-3): all CLOSED
No reviewer file for rounds 1-3 exists on the desktop or the branch (no EVIDENCE.md, no docs/pine/evidence entry);
each item below is checked against the code, from the fix commits' own enumeration.
- R1 build breakers: Dockerfile.web ARG + ENV are two real lines (diff), PineBox goToLine split('\n') compiles
  (62ea96c82e); test_dockerfile_vite_build_args + test_vite_flag_ledger 11/11 on the master merge.
- R1/R3 chart row: PineEditorStatus.jsx:38-45 paneFor is not gated on report.ok; editorStatus.js:842-847 the chart
  row IS pane.ok, never re-asked through evaluability (the AMEX:SPY / bare SPY rails at editorStatus.test.js:623-675).
- R2 withheld only from the chart door: statusItems (editorStatus.js:562-593) reads no report refusal; screener-lane
  refusals ride the Screener/Scans rows (runsOn :888-891). Mutation "report-refusal-as-withheld" KILLED (8 tests).
- R2 each row from its own lane / any yes is a yes: alerts :851-870, screens :875-893. Mutations "alerts-any-yes-off"
  (5) and "alert-tags-ignored" (2) KILLED. pine:function -> builtin (FAMILIES :179).
- R2/R3 saved row never changes a row: savedVersion :685-694 is its own line, only while holdsOwnScript (:665-670).
  Mutations "saved-anytext" (2) and "held-retranslate" (1) KILLED.
- R3 attach route: attachScan :801-812, ast documents and shown scan plot only. Mutation "attach-runtime" KILLED.
- R3 lows: drawsBeyondPlots counts RT5 objects (:609-611); runtime/door undrawn items (:494-550); chartClause
  "nothing to draw on a chart" (:924-928); "Runs fully" only when every row runs (:1007-1010; "headline-notyet" KILLED).

## Full review
- Flag keeps it dark: editorStatusGate.js:9-15 is the one reader, literal '1', fails closed. PineBox computes nothing
  with the flag off (usePineEditorStatus enabled=statusOn -> null; panel guarded; lineMarks undefined; ref undefined).
  Mutations "flag-truthy" and "box-always-on" KILLED; flag-off byte-identical rail pineBoxImportVerdict green.
  Ledger row status dark, UNSET on every service. No secret, no server code, no flag set.
- One authority for reason text: every row reason is the refusing door's or evaluability's sentence, verbatim; the
  panel-written copy is the family table (spec s4), tagSentence and thresholdSentence (both declared PANEL-WRITTEN in
  spec s4), and the two Engine strings from spec s3. No second copy of a constant found.
- Refuse-by-name: unknown guards fall to UNKNOWN_FAMILY ("Not supported yet") with the engine sentence under Details;
  families rail parses spec s4 both ways. Line marks drop out-of-range lines, never clamp ("marks-outofrange" KILLED),
  and stale marks never land ("stale-marks", editor/diagnostics.js lineMarksToDiagnostics, KILLED).
- Mobile/a11y per spec s8: touch (useIsTouch, <=1024) collapses to headline + Details (aria-haspopup="dialog") opening
  mobile/Sheet; tap targets var(--tap-min) below 1025 (css :94-105); Line N buttons carry aria-label; text badges
  [OK]/[~]/[--]; headline role="status". Touch focus-return after Sheet close handled (PineEditorStatus.jsx:232-252).
  Mutation "touch-inline" KILLED.
- Mutation check (mine, scratch copy, restored by copy with sha check, worktree clean after): 15/15 KILLED
  (chart-partial, shown-hidden, saved-anytext, stale-marks, flag-truthy, attach-runtime, box-always-on,
  marks-outofrange, door-top-any, alert-tags-ignored, held-retranslate, touch-inline, report-refusal-as-withheld,
  alerts-any-yes-off, headline-notyet). Log: _resume-2026-11-01/runs/EDITOR-E2/mutations.log.
- Tests (Node 20.20.2): lane files at tip 106/106 (claim matches). On a scratch merge of origin/master + tip
  (commit-tree only, never pushed): lane files + pineBoxImportVerdict + editor/diagnostics + editor/CodeEditor 172/172.

## Merge hazards
- `git merge-tree --write-tree origin/master a2f137dc67` -> c0a4e46383, no conflicts (master is 1260 commits ahead;
  master's memberPaneDefinition/BuilderSheet line-identity changes do not break the lane: 172/172 above).
- W5-T18 (d85b35af49) merges with E2 textually clean (merge-tree 6ac57357d2), but overlaps semantically: see N1.

## Notes (non-blocking)
N1 (Medium, merge order) TWO "RUNS ON" AUTHORITIES FOR A RUNTIME ROW. W5-T18 mounts RunsOnLine
  (BuilderSheet.jsx:2667-2672 on d85b35af49) beside the repaint notice, from the server's T17 `server_lanes`; E2's
  panel (PineBox, under the editor) answers Alerts/Screener/Scans for a runtime document from the browser's
  evaluability, which refuses every runtime document (rail editorStatus.test.js:334 "the alert lane refuses it in its own words";
  attachScan :803 ast-only), and prints "Engine: runtime (runs bar by bar, chart only)" (PineEditorStatus.jsx:139-141).
  Failing scenario: flag on, server stage on, a saved runtime row the server runs on alerts. T18 reads
  "Runs on: chart, alerts"; E2 reads Alerts [--] with the browser's runtime sentence and "chart only". Merge W5-T17
  then W5-T18 first (both reviewed GO-WITH-NOTES; E2 is parked until W2/W3). E2's re-entry must then (a) answer the
  three server rows for a runtime document from savedRow.server_lanes (T17's stamp; fail closed as RunsOnLine does)
  instead of evaluability, (b) drop "chart only" from the runtime Engine string or derive it from those rows, and
  (c) make one surface: render RunsOnLine only while VITE_PINE_EDITOR_STATUS is off, or fold it into the panel.
  Harmless today (both dark: PINE_RUNTIME_SAVE_ENABLED / PINE_RUNTIME_STAGE / VITE_PINE_EDITOR_STATUS off).
N2 (Low) Flag on, every 250 ms settle runs a second full translation (paneFor -> memberPaneDefinition, possibly the
  runtime lane build) on top of PasteBox's own inspect (PineEditorStatus.jsx:205). Not measured; measure on a
  large script before the owner flips the flag.
N3 (Low, a11y) The role="status" headline (PineEditorStatus.jsx:264) switches to "Checking your script..." on every
  edit pause, so a screen reader announces it each time before the verdict. Consider keeping the live region on the
  verdict only (or aria-busy while checking).
N4 (Low, spec drift) Spec s5 says the "(the server re-checks when you save or arm it)" note is added when the answer
  is supported with final:false; the code adds it to every OK server row (editorStatus.js:860, :880). Conservative;
  align spec or code.
N5 (process) The lane has no EVIDENCE.md (files list, mutation list, final-tip); its claims live only in commit
  messages. Add one at re-entry; final-tip has not run on this tip on the desktop.
