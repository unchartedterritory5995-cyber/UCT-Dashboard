// app/src/pages/journal-2-0/a11y/notebookTab.a11y.test.jsx
//
// A1: the Notebook tab in every view mode, at PAGE level, with the three wave-8
// payload flags both all-on and all-off (seam S8-1). Real children throughout —
// FolderSidebar, NoteCard, the table/board/calendar/timeline/graph/tasks views —
// with only the network faked (fixtures.jsx). Each recipe asserts the view it
// is about actually rendered before axe runs, so an empty or wrong screen can
// never pass as a clean one.
import { describe, beforeEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import { installFetch, latchWave8Flags, Providers } from './fixtures'
import { axeSurface } from './surface'
import NotebookTab from '../tabs/NotebookTab'
import { chooseView, currentView } from '../tabs/__tests__/toolbarDoors'

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)) })

async function renderTab(route = '/journal/notebook?view=all') {
  render(<Providers route={route}><NotebookTab /></Providers>)
  // The folder tree is real and fed by the fixtures: it must show a folder.
  await screen.findAllByText('Theses')
}

async function listMode() {
  await renderTab()
  await screen.findAllByText('Weekly plan')
  expect(document.querySelectorAll('article, [data-note-card], [class*="card"]').length).toBeGreaterThan(0)
  await settle()
}

// S11 (audit 2026-11-05): the seven view toggles are ONE labelled View menu now.
async function switchTo(label) {
  chooseView(label.replace(/ view$/, ''))
  await settle()
}

for (const flagsOn of [false, true]) {
  describe(`NotebookTab view modes (wave-8 flags ${flagsOn ? 'ON' : 'OFF'})`, () => {
    beforeEach(() => { installFetch(); latchWave8Flags(flagsOn) })

    axeSurface(`tab-home${flagsOn ? '' : ':flags-off'}`, async () => {
      await renderTab('/journal/notebook')
      await waitFor(() => expect(screen.queryByRole('button', { name: /^View:/ })).toBeNull())
      await settle()
    }, { level: 'page' })

    axeSurface(`tab-list${flagsOn ? '' : ':flags-off'}`, async () => {
      await listMode()
      expect(currentView()).toBe('List')
    }, { level: 'page' })

    axeSurface(`tab-table${flagsOn ? '' : ':flags-off'}`, async () => {
      await listMode()
      await switchTo('Table view')
      await screen.findByRole('table')
    }, { level: 'page' })

    axeSurface(`tab-board${flagsOn ? '' : ':flags-off'}`, async () => {
      await listMode()
      await switchTo('Board view')
      await screen.findAllByText('Watching')
    }, { level: 'page' })

    axeSurface(`tab-calendar${flagsOn ? '' : ':flags-off'}`, async () => {
      await listMode()
      await switchTo('Calendar view')
      await screen.findByText(/Unscheduled/i)
    }, { level: 'page' })

    axeSurface(`tab-timeline${flagsOn ? '' : ':flags-off'}`, async () => {
      await listMode()
      await switchTo('Timeline view')
      await screen.findByRole('group', { name: 'Zoom' })
    }, { level: 'page' })

    axeSurface(`tab-graph${flagsOn ? '' : ':flags-off'}`, async () => {
      await listMode()
      await switchTo('Graph view')
      await waitFor(() => expect(document.querySelector('canvas')).not.toBeNull())
      await settle()
    }, { level: 'page' })

    axeSurface(`tab-tasks${flagsOn ? '' : ':flags-off'}`, async () => {
      await renderTab('/journal/notebook?view=tasks')
      await screen.findByText('Check the gap fill')
    }, { level: 'page' })

    axeSurface(`tab-trash${flagsOn ? '' : ':flags-off'}`, async () => {
      await renderTab('/journal/notebook?folder=__trash__')
      await screen.findAllByText('Trash')
      await settle()
    }, { level: 'page' })

    axeSurface(`tab-note-open${flagsOn ? '' : ':flags-off'}`, async () => {
      await renderTab('/journal/notebook?note=n1')
      await screen.findByPlaceholderText('Title')
      await waitFor(() => { if (!document.querySelector('.ProseMirror')) throw new Error('editor not mounted') })
      await settle()
    }, { level: 'page' })
  })
}
