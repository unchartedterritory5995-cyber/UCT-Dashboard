/**
 * Notebook surface — its own top-level Journal route (/journal/notebook).
 * Renders the existing NotebookTab directly; the old Calendar|Notebook segment
 * pill is gone now that Calendar and Notebook are separate primary nav tabs.
 */

import NotebookTab from '../tabs/NotebookTab'

export default function NotebookSurface() {
  return <NotebookTab />
}
