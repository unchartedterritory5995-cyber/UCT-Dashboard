// app/src/pages/journal-2-0/a11y/notebookSurfaces.js
//
// THE MANIFEST (wave 8, lane 8A, A1): every file in the Notebook's surface
// population, mapped to exactly ONE of
//   · recipe:      '<surface id>' — an axe rail renders this file as a surface
//                  of its own (`axeSurface('<id>', …)` in an a11y/*.a11y.test.jsx);
//   · coveredBy:   '<surface id>' — the file renders INSIDE a surface that has a
//                  recipe (the id names the recipe that renders it);
//   · OTHER_LANES: { lane, railFile } — another lane owns the file and writes its
//                  axe rail with this harness (railFile is relative to journal-2-0/);
//   · exempt:      '<reason>' — the file renders nothing an assistive technology reads.
//
// ⛔ The POPULATION is derived by `surfaceCoverage.test.js` (it reads the
// directories), never by this file: a new component with no entry here fails
// that rail BY NAME, and an entry whose file is gone fails it too. Paths are
// relative to app/src/pages/journal-2-0/.

export const SURFACES = Object.freeze({
  // ── the tab and the editor ──────────────────────────────────────────────────
  'tabs/NotebookTab.jsx': { recipe: 'tab-list' },
  'components/notebook/NoteEditorPage.jsx': { recipe: 'editor' },
  'components/notebook/NoteGraphView.jsx': { recipe: 'graph-canvas' },
  'components/notebook/FolderSidebar.jsx': { recipe: 'folder-sidebar-edit' },
  'components/notebook/AskPanel.jsx': { recipe: 'ask-panel' },
  'components/notebook/TickerResearchWorkspace.jsx': { recipe: 'ticker-research' },
  'components/notebook/NoteTasksView.jsx': { recipe: 'tasks-view' },
  // Wave 9 lane 9D (D2): the sidebar's Publish-folder confirmation; its rail is
  // a11y/publishFolder.a11y.test.jsx (with the bulk bar's open Export panel, D1).
  'components/notebook/PublishFolderSheet.jsx': { recipe: 'publish-folder-sheet' },

  // ── the list views (rendered by the tab in their own mode) ─────────────────
  'components/notebook/NoteCard.jsx': { recipe: 'note-card-states' },
  'components/notebook/NotesTableView.jsx': { coveredBy: 'tab-table' },
  'components/notebook/NoteBoardView.jsx': { coveredBy: 'tab-board' },
  'components/notebook/NoteCalendarView.jsx': { coveredBy: 'tab-calendar' },
  'components/notebook/NoteTimelineView.jsx': { coveredBy: 'tab-timeline' },
  'components/notebook/BlockedBadge.jsx': { coveredBy: 'note-card-states' },
  'components/notebook/LockedGlyph.jsx': { coveredBy: 'note-card-states' },
  'components/notebook/BulkActionBar.jsx': { recipe: 'bulk-action-bar' },
  'components/notebook/TagSuggestInput.jsx': { coveredBy: 'bulk-action-bar' },
  'components/notebook/SavedViewEditor.jsx': { recipe: 'saved-view-editor' },
  'components/notebook/TemplatePicker.jsx': { recipe: 'template-picker' },
  'components/notebook/MemberTemplates.jsx': { recipe: 'member-templates' },
  // Wave 10 lane DR-C (D-4): the gallery's read-only "preview before you use
  // it" sheet, opened from either template-picker's own cards or from the
  // "Your templates" section it renders inside.
  'components/notebook/TemplatePreview.jsx': { coveredBy: 'template-picker' },
  // Wave 12 lane 12A: the community template gallery (dark behind
  // notebook_template_gallery_enabled, so template-picker never renders it); rail
  // a11y/templateGallery.a11y.test.jsx. The admin review queue it renders
  // (components/admin/TemplateGalleryReviewPanel.jsx) is outside this population and is
  // read by the community-gallery-review recipe.
  'components/notebook/TemplateGallery.jsx': { recipe: 'community-gallery-browse' },
  'components/notebook/GalleryPublishForm.jsx': { recipe: 'gallery-publish-form' },

  // ── the editor's popups, each opened through its own door ──────────────────
  'components/notebook/SlashMenu.jsx': { coveredBy: 'editor-slash' },
  'components/notebook/NoteFindBar.jsx': { coveredBy: 'editor-find' },
  'components/notebook/NoteOutline.jsx': { coveredBy: 'editor-outline' },
  'components/notebook/TextColorMenu.jsx': { coveredBy: 'editor-color' },
  'components/notebook/TableToolbar.jsx': { coveredBy: 'editor-table' },
  'components/notebook/EmojiMenu.jsx': { coveredBy: 'editor-emoji' },
  'components/notebook/NoteLinkMenu.jsx': { coveredBy: 'editor-note-link' },
  'components/notebook/LinkPasteMenu.jsx': { coveredBy: 'editor-link-paste' },
  'components/notebook/WritingHelpPanel.jsx': { coveredBy: 'editor-writing-help' },
  // Wave 11 lane 11A: the voice-note dialog (the editor's /voice, the New note sheet's
  // "Start from audio", a Desk session's Save to Notebook); rail a11y/voiceNote.a11y.test.jsx.
  'components/notebook/VoiceNoteDialog.jsx': { recipe: 'voice-note-dialog' },
  // Wave 11 lane 11B: formula and rollup properties (dark behind notebook_formulas_enabled,
  // so the tab/editor recipes never render them); rail a11y/formulas.a11y.test.jsx.
  'components/notebook/FormulaEditor.jsx': { recipe: 'formula-editor' },
  'components/notebook/RollupEditor.jsx': { recipe: 'rollup-editor' },
  'components/notebook/ComputedValue.jsx': { coveredBy: 'table-computed-columns' },
  'components/notebook/ComputedFilterControl.jsx': { recipe: 'computed-filter-dialog' },
  // Wave 11 lane 11D: the trade-plan canvas (a canvas note's board, its cards and its
  // dialogs); rail a11y/tradeCanvas.a11y.test.jsx.
  'components/notebook/TradeCanvasBoard.jsx': { recipe: 'trade-canvas' },
  'components/notebook/TradeCanvasItem.jsx': { coveredBy: 'trade-canvas' },
  'components/notebook/TradeCanvasDialogs.jsx': { recipe: 'trade-canvas-dialogs' },
  // Wave 13 lane 13I-2: the fingerprint panel under a chart block and the visual playbook sheet
  // (dark behind notebook_ta_fingerprint_enabled / notebook_visual_playbook_enabled, so the
  // editor recipes never render them); rail a11y/visualPlaybook.a11y.test.jsx.
  'components/notebook/FingerprintPanel.jsx': { recipe: 'fingerprint-panel' },
  'components/notebook/VisualPlaybook.jsx': { recipe: 'visual-playbook' },
  'components/notebook/NoteHistoryPanel.jsx': { coveredBy: 'editor-history' },
  'components/notebook/NoteVersionPreview.jsx': { coveredBy: 'editor-history' },
  'components/notebook/WidgetPalette.jsx': { coveredBy: 'editor-palette' },
  'components/notebook/NoteMenuActions.jsx': { coveredBy: 'editor' },
  // Wave 10 lane K2 (D-3): the editor surface opens it, so axe reads the panel's contents.
  'components/notebook/NoteMoreMenu.jsx': { coveredBy: 'editor' },
  'components/notebook/NoteStats.jsx': { coveredBy: 'editor' },
  'components/notebook/NoteTagsField.jsx': { coveredBy: 'editor' },
  'components/notebook/UnsentTrashDialog.jsx': { recipe: 'unsent-trash' },
  // Wave 11 lane 11C: "Ask Notebook to do something" on Research Home, and the AI change
  // sets a note's History lists; rail a11y/aiActions.a11y.test.jsx (request, review, applied).
  'components/notebook/AiActionsPanel.jsx': { recipe: 'ai-actions-review' },
  'components/notebook/AiChangeSetHistory.jsx': { recipe: 'ai-change-set-history' },
  // Wave 13 lane 13C: Reporting soon on Research Home (dark behind
  // notebook_earnings_prep_enabled); rail a11y/earningsPrep.a11y.test.jsx.
  'components/notebook/ReportingSoon.jsx': { recipe: 'reporting-soon' },
  // Wave 14 lane W14-D: the "get started" checklist on Research Home (behind
  // notebook_onboarding_enabled); rail a11y/gettingStarted.a11y.test.jsx.
  'components/notebook/GettingStartedList.jsx': { recipe: 'getting-started-checklist' },
  // its eager gate renders nothing of its own but the list, inside the same recipe
  'components/notebook/GettingStartedChecklist.jsx': { coveredBy: 'getting-started-checklist' },
  // Wave 13 lane 13G-1: research capture (dark behind notebook_transcript_capture_enabled and
  // notebook_passed_setups_enabled); rail a11y/researchCapture.a11y.test.jsx.
  'components/notebook/SaveTranscriptPassage.jsx': { recipe: 'save-transcript-passage' },
  'components/notebook/TranscriptDoors.jsx': { coveredBy: 'ticker-research-transcript' },
  'components/notebook/PassedSetups.jsx': { recipe: 'passed-setups' },
  // Wave 13 lane 13D: "what you wrote then", the resurfacing door's read-only version (dark
  // behind awareness_note_resurface_enabled); rail a11y/resurfaceVersion.a11y.test.jsx.
  'components/notebook/ResurfaceVersionSheet.jsx': { recipe: 'resurface-version' },
  // Wave 13 lane 13J: the active setups board and find more like this (dark behind
  // notebook_setups_board_enabled / notebook_find_similar_enabled, on their own route);
  // rail a11y/setupsBoard.a11y.test.jsx.
  'components/notebook/SetupsBoard.jsx': { recipe: 'setups-board' },
  'components/notebook/BoardCard.jsx': { coveredBy: 'setups-board' },
  'components/notebook/SimilarNames.jsx': { recipe: 'similar-names' },
  // Wave 13 lane 13G-2: the thesis chip (status + distance to stop, on Positions/Holdings/
  // Watchlist rows; dark behind notebook_thesis_chips_enabled); rail a11y/thesisChip.a11y.test.jsx.
  // Its mount points (PositionsTable.jsx, HoldingsList.jsx) live outside this population.
  'components/notebook/ThesisChip.jsx': { recipe: 'thesis-chip-closed' },

  // ── the editor's side sections ─────────────────────────────────────────────
  'components/notebook/PropertiesSection.jsx': { coveredBy: 'editor-thesis' },
  'components/notebook/RelationPropertyValue.jsx': { coveredBy: 'editor-thesis' },
  'components/notebook/NoteSearchPicker.jsx': { coveredBy: 'editor-thesis' },
  'components/notebook/ThesisSection.jsx': { coveredBy: 'editor-thesis' },
  'components/notebook/ThesisReviewSection.jsx': { coveredBy: 'editor-thesis' },
  'components/notebook/NoteBacklinksSection.jsx': { coveredBy: 'editor-thesis' },
  'components/notebook/UnlinkedMentions.jsx': { coveredBy: 'editor-thesis' },
  'components/notebook/NoteVideoHero.jsx': { recipe: 'video-hero' },
  'components/notebook/NoteVideoRails.jsx': { recipe: 'video-rails' },
  'components/notebook/HeroImagePicker.jsx': { recipe: 'hero-image' },
  'components/notebook/DocumentTextStatus.jsx': { recipe: 'document-text-status' },
  'components/notebook/LinkedNotesPanel.jsx': { recipe: 'linked-notes-panel' },

  // ── custom node views, inside a note ───────────────────────────────────────
  'components/notebook/AskInsertView.jsx': { coveredBy: 'editor-nodes' },
  'components/notebook/AskCitationView.jsx': { coveredBy: 'editor-nodes' },
  'components/notebook/ExcerptView.jsx': { coveredBy: 'editor-nodes' },
  'components/notebook/FinancialFactView.jsx': { coveredBy: 'editor-nodes' },
  'components/notebook/NoteLinkView.jsx': { coveredBy: 'editor-nodes' },
  'components/notebook/WidgetEmbedView.jsx': { coveredBy: 'editor-nodes' },
  'components/notebook/AskInsertPicker.jsx': { coveredBy: 'ask-insert-picker' },

  // ── the journal embed renderers ────────────────────────────────────────────
  'components/notebook/AiSearchEmbed.jsx': { recipe: 'embed-ai-search' },
  'components/notebook/AlertsEmbed.jsx': { recipe: 'embed-alerts' },
  'components/notebook/BreadthEmbed.jsx': { recipe: 'embed-breadth' },
  'components/notebook/CalendarEmbed.jsx': { recipe: 'embed-calendar' },
  'components/notebook/ChartEmbed.jsx': { recipe: 'embed-chart' },
  // Wave 13 lane 13H-2: the chart plan panel and "what happened next" replay, dark behind
  // notebook_chart_plan_enabled (so no editor recipe renders them); rail
  // a11y/chartPlan.a11y.test.jsx (states: sized, empty, refused; the replay stepped once).
  'components/notebook/ChartPlanPanel.jsx': { recipe: 'chart-plan-panel' },
  'components/notebook/BarReplay.jsx': { recipe: 'bar-replay' },
  'components/notebook/FundamentalsEmbed.jsx': { recipe: 'embed-fundamentals' },
  'components/notebook/IndexesEmbed.jsx': { recipe: 'embed-indexes' },
  'components/notebook/MarketContextEmbed.jsx': { recipe: 'embed-market-context' },
  'components/notebook/NewsEmbed.jsx': { recipe: 'embed-news' },
  'components/notebook/ScannerEmbed.jsx': { recipe: 'embed-scanner' },
  'components/notebook/ThemesEmbed.jsx': { recipe: 'embed-themes' },
  'components/notebook/WatchlistEmbed.jsx': { recipe: 'embed-watchlist' },
  'components/notebook/FrozenList.jsx': { recipe: 'frozen-list' },
  // G-040 (wave 10, lane CX): the three capture-only kinds.
  'components/notebook/ScreenerEmbed.jsx': { recipe: 'embed-screener' },
  'components/notebook/CotEmbed.jsx': { recipe: 'embed-cot' },
  'components/notebook/ModelBookEmbed.jsx': { recipe: 'embed-model-book' },

  // ── documents ──────────────────────────────────────────────────────────────
  'components/notebook/DocumentPreviewSheet.jsx': { recipe: 'document-preview-pdf' },
  'components/notebook/PdfViewerBoundary.jsx': { coveredBy: 'document-preview-pdf' },
  'components/notebook/PdfDocumentViewer.jsx': { coveredBy: 'document-preview-pdf' },
  'components/notebook/ScannedTextPanel.jsx': { coveredBy: 'document-preview-pdf' },
  'components/notebook/ImageDocumentViewer.jsx': { coveredBy: 'document-preview-image' },
  'components/notebook/TextPagesViewer.jsx': { coveredBy: 'document-preview-docx' },

  // ── capture ────────────────────────────────────────────────────────────────
  'components/notebook/CaptureDialog.jsx': { recipe: 'capture-dialog' },
  'components/notebook/CapturedSourceSheet.jsx': { recipe: 'captured-source' },
  'components/notebook/ShareTargetPage.jsx': { recipe: 'share-target-signed-out' },
  'components/notebook/CaptureConnectPage.jsx': { recipe: 'capture-connect' },
  'components/notebook/CaptureHost.jsx': {
    exempt: 'mounts CaptureDialog (recipe capture-dialog) and a global key listener; it renders no markup or control of its own',
  },
  'components/notebook/NotebookFlagGate.jsx': {
    exempt: 'renders its children or null; no markup or control of its own',
  },

  // ── import / export ────────────────────────────────────────────────────────
  'components/notebook/import/ImportWizard.jsx': { recipe: 'import-wizard' },
  'components/notebook/import/ExportGuide.jsx': { coveredBy: 'import-wizard' },

  // ── Settings cards ─────────────────────────────────────────────────────────
  'components/PersonalApiCard.jsx': { recipe: 'settings-personal-api' },
  'components/InboundEmailCard.jsx': { recipe: 'settings-inbound-email' },
  'components/BrowserCaptureCard.jsx': { recipe: 'settings-browser-capture' },

  // ── other lanes' files (each owner writes its rail with this harness) ──────
  'components/notebook/NoteShareControls.jsx': {
    // 8B had closed when the harness landed; its report asked for these to be
    // added, so 8A wrote the rail in its own directory (no 8B file edited).
    OTHER_LANES: { lane: '8B', railFile: 'a11y/sharing.a11y.test.jsx' },
  },
  'components/notebook/ResearchHome.jsx': {
    OTHER_LANES: { lane: '8C', railFile: 'components/notebook/ResearchHome.a11y.test.jsx' },
  },
  'components/notebook/NoteExportControls.jsx': {
    OTHER_LANES: { lane: '8C', railFile: 'components/notebook/NoteExportControls.a11y.test.jsx' },
  },
  'components/notebook/export/ExportDialog.jsx': {
    OTHER_LANES: { lane: '8C', railFile: 'components/notebook/export/ExportDialog.a11y.test.jsx' },
  },
})

/** Other lanes' surfaces OUTSIDE the derived population, listed so the
 *  controller can check each owner's rail exists before the gate. */
export const OTHER_LANES_OUTSIDE_POPULATION = Object.freeze({
  'SharedNotePage.jsx': { lane: '8B', railFile: 'a11y/sharing.a11y.test.jsx' },
  'PublishedPage.jsx': { lane: '8B', railFile: 'a11y/sharing.a11y.test.jsx' },
  'components/SharingCard.jsx': { lane: '8B', railFile: 'a11y/sharing.a11y.test.jsx' },
  'components/notebook/onboarding/NotebookTour.jsx': { lane: '8C', railFile: 'components/notebook/onboarding/NotebookTour.a11y.test.jsx' },
  '../Support.jsx': { lane: '8C', railFile: '../Support.a11y.test.jsx' },
})

/** Wave 13: surfaces OUTSIDE the derived Notebook population (they live on the Journal side:
 *  the trade page, Insights, the Trade Journal table) that carry an axe recipe of their own.
 *  Each maps to `{ recipe: '<surface id>', railFile }`; the owning lane's rail asserts that every
 *  entry's file exists and its recipe is registered (`axeSurface('<id>'`) in a rail file, so an
 *  entry here can never be decorative. Paths are relative to app/src/pages/journal-2-0/. */
export const OUTSIDE_POPULATION_SURFACES = Object.freeze({
  // Wave 13 lane 13A: plan vs execution grading (dark behind notebook_plan_grading_enabled);
  // rail a11y/planGrading.a11y.test.jsx.
  'components/trade/PlanGradeCard.jsx': { recipe: 'plan-grade-card', railFile: 'a11y/planGrading.a11y.test.jsx' },
  'components/insights/DisciplineRecord.jsx': { recipe: 'discipline-record', railFile: 'a11y/planGrading.a11y.test.jsx' },
  // The Unplanned chip lives in the Trade Journal table; the recipe renders the table with it.
  'components/TradesTable.jsx': { recipe: 'trades-table-unplanned', railFile: 'a11y/planGrading.a11y.test.jsx' },
  // Wave 13 lane 13I-2: before and after on the trade page (dark behind
  // notebook_visual_playbook_enabled); rail a11y/visualPlaybook.a11y.test.jsx.
  'components/trade/TradeBeforeAfter.jsx': { recipe: 'trade-before-after', railFile: 'a11y/visualPlaybook.a11y.test.jsx' },
  // Wave 13 lane 13B: My Playbook and its door in Insights > Playbook (dark behind
  // notebook_playbook_enabled); rail a11y/myPlaybook.a11y.test.jsx.
  'components/insights/MyPlaybook.jsx': { recipe: 'my-playbook', railFile: 'a11y/myPlaybook.a11y.test.jsx' },
  'components/insights/PlaybookSection.jsx': { recipe: 'playbook-section-door', railFile: 'a11y/myPlaybook.a11y.test.jsx' },
  // Wave 13 lane 13E-2: the Entry-context card and its "Why did you take it?" prompt, on the
  // position and trade detail pages (dark behind notebook_entry_context_enabled; the dictation
  // button inside WhyPrompt is further gated on notebook_voice_notes_enabled); rail
  // a11y/entryContext.a11y.test.jsx.
  'components/EntryContextCard.jsx': { recipe: 'entry-context-card', railFile: 'a11y/entryContext.a11y.test.jsx' },
  'components/WhyPrompt.jsx': { recipe: 'entry-context-card', railFile: 'a11y/entryContext.a11y.test.jsx' },
  // Wave 14 lane W14-A: the first-run welcome's capability preview (a lazy chunk of
  // ResearchHome, under components/notebook/onboarding/, so outside the derived population);
  // rail a11y/capabilityPreview.a11y.test.jsx (with the first-run-welcome recipe).
  'components/notebook/onboarding/CapabilityPreview.jsx': { recipe: 'capability-preview', railFile: 'a11y/capabilityPreview.a11y.test.jsx' },
  // Wave 14 lane W14-C2: the one-time "new in your Notebook" offer (a lazy chunk behind an
  // eager gate, both under components/notebook/onboarding/); rail a11y/tourOffer.a11y.test.jsx
  // (the card alone, and the real gate offering into a first-run slot).
  'components/notebook/onboarding/TourOfferPrompt.jsx': { recipe: 'tour-offer-prompt', railFile: 'a11y/tourOffer.a11y.test.jsx' },
  'components/notebook/onboarding/TourOfferGate.jsx': { recipe: 'tour-offer-in-slot', railFile: 'a11y/tourOffer.a11y.test.jsx' },
})
