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
  'components/notebook/NoteHistoryPanel.jsx': { coveredBy: 'editor-history' },
  'components/notebook/NoteVersionPreview.jsx': { coveredBy: 'editor-history' },
  'components/notebook/WidgetPalette.jsx': { coveredBy: 'editor-palette' },
  'components/notebook/NoteMenuActions.jsx': { coveredBy: 'editor' },
  'components/notebook/NoteStats.jsx': { coveredBy: 'editor' },
  'components/notebook/NoteTagsField.jsx': { coveredBy: 'editor' },
  'components/notebook/UnsentTrashDialog.jsx': { recipe: 'unsent-trash' },

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
  'components/notebook/FundamentalsEmbed.jsx': { recipe: 'embed-fundamentals' },
  'components/notebook/IndexesEmbed.jsx': { recipe: 'embed-indexes' },
  'components/notebook/MarketContextEmbed.jsx': { recipe: 'embed-market-context' },
  'components/notebook/NewsEmbed.jsx': { recipe: 'embed-news' },
  'components/notebook/ScannerEmbed.jsx': { recipe: 'embed-scanner' },
  'components/notebook/ThemesEmbed.jsx': { recipe: 'embed-themes' },
  'components/notebook/WatchlistEmbed.jsx': { recipe: 'embed-watchlist' },
  'components/notebook/FrozenList.jsx': { recipe: 'frozen-list' },

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
