/**
 * Calendar surface — its own top-level Journal route (/journal/calendar).
 * Renders the existing CalendarTab directly; the old Calendar|Notebook segment
 * pill is gone now that Calendar and Notebook are separate primary nav tabs.
 */

import CalendarTab from '../tabs/CalendarTab'

export default function CalendarSurface() {
  return <CalendarTab />
}
