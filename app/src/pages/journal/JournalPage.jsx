// app/src/pages/journal/JournalPage.jsx
//
// Journal 2.0 graduated to THE Journal on 2026-05-11. This file is now a
// thin wrapper that renders the J2 root directly. The original
// JournalPage with its 8 J1 tabs has been retired; its source still
// lives under app/src/pages/journal/ for archive purposes.

import { lazy, Suspense } from 'react'

const JournalTwoRoot = lazy(() => import('../journal-2-0/JournalTwoRoot'))

export default function JournalPage() {
  return (
    <Suspense fallback={<div style={{ padding: 32, color: '#8b92a1' }}>Loading…</div>}>
      <JournalTwoRoot />
    </Suspense>
  )
}
