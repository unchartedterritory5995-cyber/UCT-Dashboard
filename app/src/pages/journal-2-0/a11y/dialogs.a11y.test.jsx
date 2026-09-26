// app/src/pages/journal-2-0/a11y/dialogs.a11y.test.jsx
//
// A1: the Notebook's dialogs, sheets and standalone pages — the document
// preview for each kind (pdf, image, docx), capture, captured source, the
// import wizard, the template pickers, the saved-view editor, the unsent-trash
// dialog, the bulk action bar, the tasks view, the share-target page and the
// browser-capture connect page. Real components over the fixture network.
//
// ⚠️ The PDF viewer is rendered for real, over a FAKE pdfjs: jsdom has no
// Worker, Canvas2D or ReadableStream-backed PDF engine, so pdfjs-dist cannot
// run here. The fake hands back a document of two pages with a text layer;
// the viewer's own markup (toolbar, page frames, scanned-text control) is what
// axe reads. The painted page itself is covered by the real-browser check.
import { describe, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { Routes, Route } from 'react-router-dom'
import { installFetch, latchWave8Flags, Providers, AUTH, FOLDERS } from './fixtures'
import { axeSurface } from './surface'
import DocumentPreviewSheet from '../components/notebook/DocumentPreviewSheet'
import CaptureDialog from '../components/notebook/CaptureDialog'
import CapturedSourceSheet from '../components/notebook/CapturedSourceSheet'
import ImportWizard from '../components/notebook/import/ImportWizard'
import TemplatePicker from '../components/notebook/TemplatePicker'
import MemberTemplates from '../components/notebook/MemberTemplates'
import SavedViewEditor from '../components/notebook/SavedViewEditor'
import UnsentTrashDialog from '../components/notebook/UnsentTrashDialog'
import BulkActionBar from '../components/notebook/BulkActionBar'
import NoteTasksView from '../components/notebook/NoteTasksView'
import ShareTargetPage from '../components/notebook/ShareTargetPage'
import CaptureConnectPage from '../components/notebook/CaptureConnectPage'
import { captureDestination } from '../lib/capture'
import { SHARE_ROUTE } from '../lib/shareTarget'

vi.mock('../lib/pdfjs', () => {
  class TextLayer {
    constructor({ container }) { this.container = container }
    async render() {
      const span = document.createElement('span')
      span.textContent = 'Management expects margins to normalise.'
      this.container.appendChild(span)
    }
  }
  const page = {
    getViewport: ({ scale = 1 } = {}) => ({ width: 612 * scale, height: 792 * scale, scale }),
    render: () => ({ promise: Promise.resolve(), cancel() {} }),
    getTextContent: async () => ({ items: [{ str: 'Management expects margins to normalise.' }] }),
    cleanup() {},
  }
  return {
    pdfjsLib: { TextLayer },
    loadPdfDocument: async () => ({ numPages: 2, getPage: async () => page, destroy() {} }),
  }
})

const settle = (ms = 30) => act(async () => { await new Promise((r) => setTimeout(r, ms)) })

const PDF = '/api/j2/notes/attachments/u1/n1/file/abc123.pdf'
const IMG = '/api/j2/notes/attachments/u1/n1/inline/0123456789abcdef0123456789abcdef.png'
const DOCX = '/api/j2/notes/attachments/u1/n1/file/fedcba9876543210.docx'
const docRow = (over) => ({
  id: 'd1', attachmentUrl: IMG, name: 'Image', status: 'ready', pageCount: 1, pagesTotal: 1,
  pagesWithText: 1, pagesFromOcr: 1, ocrUnavailable: false, sourceKind: 'attachment', ...over,
})
const DOC_ROUTES = [
  [/^\/api\/j2\/notes\/n1\/documents$/, { documents: [
    docRow({ id: 'd1', attachmentUrl: IMG, name: 'Chart photo' }),
    docRow({ id: 'dx', attachmentUrl: DOCX, name: 'memo.docx', pageCount: 2, pagesTotal: 2, pagesWithText: 2, pagesFromOcr: 0 }),
  ] }],
  [/^\/api\/j2\/notes\/documents\/[^/]+\/pages\/\d+\/text$/, (url) => ({
    documentId: 'dx', pageNumber: Number(/pages\/(\d+)/.exec(url)[1]),
    text: 'Revenue grew 12% on data-centre demand.', available: true, textOrigin: 'native',
  })],
]

describe('document preview, each kind', () => {
  beforeEach(() => { installFetch(DOC_ROUTES); latchWave8Flags(true) })

  axeSurface('document-preview-pdf', async () => {
    render(<Providers><DocumentPreviewSheet open href={PDF} name="report.pdf" documentId="d9" onClose={() => {}} /></Providers>)
    await screen.findByRole('dialog', { name: 'Preview of report.pdf' })
    await settle(60)
  })

  axeSurface('document-preview-image', async () => {
    render(<Providers><DocumentPreviewSheet open href={IMG} name="Chart photo" documentId="d1" onClose={() => {}} /></Providers>)
    await screen.findByTestId('image-document-viewer')
    await settle(60)
  })

  axeSurface('document-preview-docx', async () => {
    render(<Providers><DocumentPreviewSheet open href={DOCX} name="memo.docx" page={1} documentId="dx" onClose={() => {}} /></Providers>)
    await screen.findByTestId('text-pages-viewer')
    await screen.findAllByText(/Revenue grew 12%/)
  })
})

describe('capture', () => {
  beforeEach(() => { installFetch(); latchWave8Flags(true) })

  axeSurface('capture-dialog', async () => {
    render(
      <Providers>
        <CaptureDialog
          open
          onClose={() => {}}
          destination={captureDestination({})}
          recentDestinations={[{ id: 'n1', title: 'NVDA thesis' }, { id: 'n2', title: 'Weekly plan' }]}
        />
      </Providers>,
    )
    await screen.findByRole('dialog')
    await settle()
  })

  axeSurface('captured-source', async () => {
    render(
      <Providers>
        <CapturedSourceSheet
          open
          excerpt={{
            id: 'ex-web', noteId: 'n2', sourceKind: 'web', sourceUrl: 'https://www.reuters.com/markets/nvda',
            sourceTitle: 'Reuters: NVDA', capturedText: 'Gross margin normalizes toward the mid-70s.',
            annotation: 'Too optimistic.', capturedAt: '2026-09-20T15:00:00Z',
          }}
          onClose={() => {}}
          onOpenOwningNote={() => {}}
        />
      </Providers>,
    )
    await screen.findByRole('dialog')
  })

  axeSurface('share-target-signed-out', async () => {
    render(
      <Providers route={`${SHARE_ROUTE}?title=Fed%20holds&text=rates&url=https%3A%2F%2Fwsj.com%2Fx`} auth={{ ...AUTH, user: null, isPaid: false }}>
        <Routes><Route path={SHARE_ROUTE} element={<ShareTargetPage />} /></Routes>
      </Providers>,
    )
    await screen.findByRole('heading', { name: /Sign in to save this/ })
  }, { level: 'page' })

  axeSurface('share-target-free', async () => {
    render(
      <Providers route={`${SHARE_ROUTE}?title=Fed%20holds`} auth={{ ...AUTH, isPaid: false }}>
        <Routes><Route path={SHARE_ROUTE} element={<ShareTargetPage />} /></Routes>
      </Providers>,
    )
    await screen.findByRole('heading', { name: /Notebook is part of a paid plan/ })
  }, { level: 'page' })

  axeSurface('capture-connect', async () => {
    installFetch([[/^\/api\/auth\/me$/, { user: AUTH.user }]])
    const redirect = encodeURIComponent(`https://${'a'.repeat(32)}.chromiumapp.org/`)
    render(
      <Providers route={`/journal/capture-connect?redirect_uri=${redirect}&state=s1`}>
        <Routes><Route path="/journal/capture-connect" element={<CaptureConnectPage />} /></Routes>
      </Providers>,
    )
    await screen.findByRole('heading', { name: /Connect UCT Browser Capture/ })
    await settle()
  }, { level: 'page' })
})

describe('notebook dialogs', () => {
  beforeEach(() => { installFetch(); latchWave8Flags(true) })

  axeSurface('import-wizard', async () => {
    render(<Providers><ImportWizard open onClose={() => {}} onImported={() => {}} /></Providers>)
    await screen.findByRole('dialog')
    // The export guide (import/ExportGuide.jsx) opens inside the wizard: open it
    // and one platform's instructions, so both render in this run.
    fireEvent.click(screen.getByRole('button', { name: /How do I get my export file/ }))
    const firstPlatform = document.querySelector('[aria-expanded="false"]')
    fireEvent.click(firstPlatform)
    await screen.findByText('Format:')
    await settle()
  })

  axeSurface('template-picker', async () => {
    render(<Providers><TemplatePicker onPick={() => {}} onPickMember={() => {}} /></Providers>)
    await screen.findAllByText('Morning prep')
    await settle()
  })

  axeSurface('member-templates', async () => {
    render(<Providers><MemberTemplates onPick={() => {}} /></Providers>)
    await screen.findAllByText('Morning prep')
    await settle()
  })

  axeSurface('saved-view-editor', async () => {
    render(<Providers><SavedViewEditor open onClose={() => {}} onSave={() => {}} /></Providers>)
    await screen.findByRole('dialog')
  })

  axeSurface('unsent-trash', async () => {
    render(<Providers><UnsentTrashDialog what="NVDA thesis" onSendFirst={() => {}} onTrashAnyway={() => {}} onClose={() => {}} /></Providers>)
    await screen.findByRole('dialog')
  })

  axeSurface('bulk-action-bar', async () => {
    render(
      <Providers>
        <BulkActionBar
          count={2} totalInView={3} allSelected={false} onSelectAll={() => {}} onClear={() => {}}
          selectedTags={['semis', 'plan']}
          tagNodes={[{ path: 'semis', key: 'semis', own: 1, total: 1 }, { path: 'plan', key: 'plan', own: 1, total: 1 }]}
          onMove={() => {}} onAddTag={() => {}} onRemoveTag={() => {}} onFavorite={() => {}}
          onUnfavorite={() => {}} onExport={() => {}} onTrash={() => {}} onRestore={() => {}}
          onArchive={() => {}} onUnarchive={() => {}}
        />
      </Providers>,
    )
    await screen.findByText(/2 selected/)
    // the folder picker is fed by the real folders hook
    await screen.findAllByText(FOLDERS[0].name)
    // open the add-tag field too, so its suggestions render
    const add = screen.queryByRole('button', { name: /add a tag/i })
    if (add) fireEvent.click(add)
    await settle()
  })

  axeSurface('tasks-view', async () => {
    render(<Providers><NoteTasksView onOpenTask={() => {}} /></Providers>)
    await screen.findByText('Check the gap fill')
  })
})
