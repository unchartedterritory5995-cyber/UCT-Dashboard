// app/src/pages/journal-2-0/a11y/simplifyMenus.a11y.test.jsx
//
// Go-live wave 1, fix round 1 (item 2): three surfaces the Notebook simplification added, each through 8A's axe
// harness OPEN, with its rows drawn (a closed menu is one button and proves nothing):
//   * note-format-menu      -- the note's "Aa" (More formatting) menu, its first view and its Font list;
//   * saved-views-menu-group -- the View menu's "Saved views" group, with views, inside the open menu;
//   * notebook-ai-panel     -- the notes list's AI section: the notebook-wide question panel open and, with its switch
//                              on, "Or tell Notebook what to change";
//   * today-home-notes      -- the Daily brief's "Needs review" and "Notes on your open positions", with rows.
// Each recipe proves its state rendered before axe runs.
import { describe, beforeEach, afterEach, expect } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { installFetch, Providers } from './fixtures'
import { axeSurface } from './surface'
import { __resetNotebookFlags, latchNotebookFlags } from '../lib/offline/notebookFlags'
import NoteFormatMenu, { MORE_FORMATTING } from '../components/notebook/NoteFormatMenu'
import SavedViewsMenuGroup from '../components/notebook/SavedViewsMenuGroup'
import NotebookAiPanel from '../components/notebook/NotebookAiPanel'
import { MenuRows, useMenuButton } from '../components/notebook/NewNoteMenu'
import HomeNotes from '../components/notebook/TodayHomeNotes'
import todayStyles from '../components/notebook/TodayHome.module.css'

const VIEWS = [
  { id: 'v1', name: 'Active theses', viewType: 'list' },
  { id: 'v2', name: 'Watching', viewType: 'board' },
]

function ViewMenu() {
  const menu = useMenuButton()
  return (
    <main>
      <button {...menu.triggerProps} type="button" className="btn btn-secondary btn-sm">View: List</button>
      {menu.open && (
        <div {...menu.menuProps} aria-label="View">
          <MenuRows menu={menu} items={[{ key: 'list', label: 'List', checked: true, run: () => {} },
            { key: 'table', label: 'Table', checked: false, run: () => {} }]} />
          <SavedViewsMenuGroup menu={menu} views={VIEWS} activeViewId="v1" onSelectView={() => {}}
            onRenameView={() => {}} onDeleteView={() => {}} />
        </div>
      )}
    </main>
  )
}

describe('the simplification\'s own menus and panel, open', () => {
  beforeEach(() => { __resetNotebookFlags() })
  afterEach(() => { __resetNotebookFlags() })

  axeSurface('note-format-menu', async () => {
    const { container } = render(
      <main>
        <NoteFormatMenu editor={null} format={{}} fontSizes={[14, 16, 20]} onColor={() => {}} onAttach={() => {}}
          buttonClassName="btn" />
      </main>,
    )
    fireEvent.click(screen.getByRole('button', { name: MORE_FORMATTING }))
    const menu = screen.getByRole('menu', { name: MORE_FORMATTING })
    expect(within(menu).getAllByRole('menuitem').map((el) => el.textContent.trim()))
      .toEqual(expect.arrayContaining(['Font', 'Size', 'Quote', 'Code', 'Attach a file', 'Divider']))
    return { root: container }
  })

  axeSurface('note-format-menu:font-list', async () => {
    const { container } = render(
      <main>
        <NoteFormatMenu editor={null} format={{}} fontSizes={[14, 16, 20]} onColor={() => {}} onAttach={() => {}}
          buttonClassName="btn" />
      </main>,
    )
    fireEvent.click(screen.getByRole('button', { name: MORE_FORMATTING }))
    fireEvent.click(within(screen.getByRole('menu', { name: MORE_FORMATTING })).getByRole('menuitem', { name: 'Font' }))
    expect(within(screen.getByRole('menu', { name: MORE_FORMATTING })).getAllByRole('menuitemradio').length).toBeGreaterThan(1)
    return { root: container }
  })

  axeSurface('saved-views-menu-group', async () => {
    const { container } = render(<ViewMenu />)
    fireEvent.click(screen.getByRole('button', { name: 'View: List' }))
    const group = within(screen.getByRole('menu', { name: 'View' })).getByRole('group', { name: 'Saved views' })
    expect(within(group).getByRole('menuitemradio', { name: 'Active theses' })).toBeTruthy()
    expect(within(group).getAllByRole('menuitem').length).toBeGreaterThan(0)   // Rename / Delete on each row
    return { root: container }
  })

  axeSurface('notebook-ai-panel', async () => {
    latchNotebookFlags({ notebook_ai_actions_enabled: true })
    installFetch()
    const { container } = render(
      <Providers route="/journal/notebook?view=all">
        <main><NotebookAiPanel id="notebook-ai-panel" onOpenNote={() => {}} onClose={() => {}} /></main>
      </Providers>,
    )
    const section = screen.getByRole('region', { name: 'Ask your Notebook' })
    expect(await within(section).findByRole('textbox')).toBeTruthy()
    expect(await within(section).findByText(/tell Notebook what to change/i)).toBeTruthy()
    return { root: container }
  })

  axeSurface('today-home-notes', async () => {
    installFetch([[/^\/api\/j2\/notebook\/home$/, {
      continueWorking: [], favorites: [], activeTheses: [],
      needsReview: [{ id: 'r1', title: 'NVDA thesis', ticker: 'NVDA', reviewReasons: [{ code: 'review_due', text: 'review due today' }] }],
      openPositionResearch: [{ id: 'p1', title: 'CRWD plan', ticker: 'CRWD' }],
    }]])
    const { container } = render(
      <Providers><main><HomeNotes ready onOpenNote={() => {}} styles={todayStyles} /></main></Providers>,
    )
    expect(await screen.findByRole('heading', { name: 'Needs review' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Notes on your open positions' })).toBeTruthy()
    expect(screen.getByText('review due today')).toBeTruthy()
    return { root: container }
  })
})
