// app/src/components/admin/adminFetcher.js
//
// TERM-033: the admin health panels' fetcher.
//
// Every panel here used to read through
//     fetch(u).then(r => (r.ok ? r.json() : null)).catch(() => null)
// so a 500 or a dropped connection rendered as em-dashes and "No data yet" / "no data",
// which an admin reads as "the monitor has nothing to report". A health panel is the one
// surface where "the read failed" is itself the finding. The fetcher now THROWS
// (sectionFetcher), SWR keeps the last good answer through a failed poll, and a failure
// with nothing to stand on is named by <PanelReadError>.
import { sectionFetcher } from '../research/sections/sectionFetch'

/** SWR fetcher for an admin read: resolves with the payload or throws. */
export const adminFetcher = (url) => sectionFetcher(url)
