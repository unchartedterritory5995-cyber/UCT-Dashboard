/**
 * P4a: the page layouts switch, read from the latched auth payload. It gates the Customize button
 * on Today and the trade page and reading a saved layout. With it off both pages render their fixed
 * layout; a layout already saved stays stored and unread.
 */
import { notebookFlag } from './offline/notebookFlags'

export const PAGE_LAYOUTS_FLAG = 'journal_page_layouts_enabled'
export const pageLayoutsEnabled = () => notebookFlag(PAGE_LAYOUTS_FLAG) === true
