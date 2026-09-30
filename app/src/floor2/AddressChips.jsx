// TERM-056 (FB-S2-04) — an address written in a Floor post (L:12, W:abc) becomes an object.
// Owner ruling 2026-09-29: on the Floor it LINKS only when the AUTHOR shared the object
// (a layout with a live share link, a public watchlist, a prebuilt layout); a private one
// renders as the address marked private, never with its name. Resolution happens on the
// server against the author's objects (api/services/address_space.shared_links), so a
// reader can never open, or learn the title of, something the author kept private.
import { Link } from 'react-router-dom'

export default function AddressChips({ links }) {
  if (!Array.isArray(links) || links.length === 0) return null
  return (
    <div className="address-chips" data-testid="address-chips">
      {links.map((l) => (l.shared ? (
        <Link key={l.address} to={l.to} className="address-chip" data-address={l.address}>
          {l.kind_label}: {l.name}
        </Link>
      ) : (
        <span key={l.address} className="address-chip address-chip-private" data-address={l.address}>
          {l.address} · private
        </span>
      )))}
    </div>
  )
}
