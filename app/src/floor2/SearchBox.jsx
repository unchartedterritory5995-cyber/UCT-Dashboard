import { IconSearch } from './icons'

// Plain search input — filters the feed as you type (no dropdown).
export default function SearchBox({ query, setQuery }) {
  return (
    <div className="search-wrap">
      <div className="search">
        <IconSearch size={17} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') e.target.blur() }}
          placeholder="Search questions, conversations, $TICKERS…"
        />
        {query
          ? <button className="act-btn" style={{ height: 26, padding: '0 8px' }} onClick={() => setQuery('')}>Clear</button>
          : <kbd>/</kbd>}
      </div>
    </div>
  )
}
