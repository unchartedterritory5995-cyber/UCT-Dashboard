// Tour `meaning-search` (wave 14, W14-B1). Data only: see ./index.js for the contract.
// Screen: the Notebook with its sidebar showing (desktop and tablet; on a phone the
// sidebar is hidden while a note is open). `search-count` exists only while a search
// has results, so a tour opened with an empty search box shows steps 1 and 3.
const step = (id, anchor, file) => Object.freeze({ id, anchor, file })
const SIDEBAR = 'components/notebook/FolderSidebar.jsx'

export const STEPS = Object.freeze([
  step('search', 'search', SIDEBAR),
  step('count', 'search-count', SIDEBAR),
  step('related', 'search', SIDEBAR),
])

export const COPY = Object.freeze({
  search: {
    title: 'Search by meaning',
    body: 'Search still finds notes that use your words. It also lists notes about the same idea written in other words.',
  },
  count: {
    title: 'Matches, then related',
    body: 'The count says how many notes matched your words and how many are related. Related notes come after the matches.',
  },
  related: {
    title: 'Why a note is listed',
    body: 'A related note is marked Related by meaning, because none of your words are in it. A note you just wrote can take about 15 minutes to be found this way.',
  },
})
