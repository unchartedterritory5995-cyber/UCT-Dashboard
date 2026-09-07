/**
 * DockProfile — the Overview tab: a company research flow, not a metric dump.
 *
 *   INTELLIGENCE HEADER   identity · what it does · sector/industry · company facts
 *   THE STORY             why the stock is moving (signature block, gold rail)
 *   FUNDAMENTALS          one system: Valuation · Growth · Price & Performance ·
 *                         Profitability · Financial Health
 *   OWNERSHIP             snapshot → explore
 *
 * The first viewport is DESIGNED, not inherited. Orientation (who/what/why) is
 * paid for in as little vertical space as it can be — company facts ride inline
 * with the identity and the Story defaults to ~60 words — so that Valuation,
 * Growth and Price & Performance all clear the fold at the default panel size.
 * Profitability and Financial Health keep every row, just below it.
 *
 * Hierarchy is carried by typography and spacing rather than cards: one gold
 * section head per major block, muted sub-group labels inside Fundamentals, and
 * emphasis reserved for primary metrics (`p`) so 40 numbers don't shout at once.
 *
 * Business/Story come from the cached AI stock-brief (company_desc + run_story);
 * everything else is real snapshot/statement/ownership data.
 */
import { useEffect, useMemo, useState } from 'react'
import useStockBrief from '../../../hooks/useStockBrief'
import useMobileSWR from '../../../hooks/useMobileSWR'
import useEarningsTable from '../../../hooks/useEarningsTable'
import useOwnership from '../../../hooks/useOwnership'
import CompanyLogo from '../../../components/CompanyLogo'
import { fmtPct, fmtShares, fmtVol, fmtEps, websiteDomain } from '../../../utils/profileFormat'
import styles from './dockPanels.module.css'

const jsonFetcher = (url) => fetch(url).then(r => (r.ok ? r.json() : null))
const num = (v, d = 2) => (v == null || Number.isNaN(Number(v)) ? '—' : Number(v).toFixed(d))
const pctVal = (v, d = 1) => (v == null || Number.isNaN(Number(v)) ? '—' : `${Number(v).toFixed(d)}%`)
const signPct = (v, d = 1) => (v == null || Number.isNaN(Number(v)) ? '—' : `${Number(v) > 0 ? '+' : ''}${Number(v).toFixed(d)}%`)
const str = (v) => (v == null || v === '' ? '—' : v)
const shortShares = (v) => (v == null ? '—' : Math.abs(v) >= 1e9 ? `${(v / 1e9).toFixed(2)}B` : Math.abs(v) >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : `${v}`)
const compactInt = (v) => (v == null ? '—' : v >= 1000 ? `${Math.round(v / 1000)}K` : String(v))
// yfinance ships officer names with an honorific ("Mr. Sanjay Mehrotra"). In a
// compact inline fact that prefix is pure width for zero information.
const personName = (v) => (v == null ? null : String(v).replace(/^(Mr|Mrs|Ms|Dr|Prof)\.?\s+/i, '').trim() || null)

function pctChange(a, b) { return (a == null || b == null || b === 0) ? null : ((a - b) / Math.abs(b)) * 100 }
function parseQ(label) { const s = String(label || ''); const y = s.match(/(\d{4})/); const q = s.match(/Q\s*([1-4])/i); return { year: y ? +y[1] : null, q: q ? +q[1] : null } }
function useGrowth(quarterly) {
  return useMemo(() => {
    const rep = (quarterly || []).filter(q => q.reported && (q.eps_actual != null || q.rev_actual != null))
      .map(q => ({ ...q, ...parseQ(q.label) })).filter(q => q.year && q.q).sort((a, b) => (a.year - b.year) || (a.q - b.q))
    if (!rep.length) return {}
    const byKey = new Map(rep.map(q => [`${q.year}-${q.q}`, q]))
    const latest = rep[rep.length - 1], prev = rep[rep.length - 2], yearAgo = byKey.get(`${latest.year - 1}-${latest.q}`)
    return {
      epsLastQ: latest.eps_actual,
      epsQoQ: pctChange(latest.eps_actual, prev?.eps_actual),
      epsYoY: pctChange(latest.eps_actual, yearAgo?.eps_actual),
      salesYoY: pctChange(latest.rev_actual, yearAgo?.rev_actual),
    }
  }, [quarterly])
}
const sgn = (v) => (v == null ? '' : v >= 0 ? styles.pos : styles.neg)

// lead sentences, cut only on a sentence boundary (never mid-word)
function leadSentences(about, n = 3) {
  if (!about) return null
  const s = String(about).trim()
  const re = /[^.!?]+[.!?]+(\s|$)/g
  let out = '', m, i = 0
  while ((m = re.exec(s)) && i < n) { out += m[0]; i += 1 }
  return (out.trim() || s)
}
/**
 * The Story's default state: WHOLE sentences up to a word budget — never a
 * mid-sentence "…". The generator already leads with the catalyst (see
 * modelbook._desc_messages: "open with the catalyst… not a price statement"),
 * so the first sentences ARE the thesis; the rest is supporting detail and risk,
 * which belongs behind "Full story →". Always keeps at least one sentence, so a
 * single long sentence is never cut.
 */
function leadStory(text, maxWords = 45) {
  if (!text) return { text: null, clipped: false }
  const s = String(text).trim()
  const parts = s.match(/[^.!?]+[.!?]+(\s|$)/g)
  if (!parts) return { text: s, clipped: false }
  let out = '', words = 0
  for (const part of parts) {
    const w = part.trim().split(/\s+/).length
    if (out && words + w > maxWords) break
    out += part
    words += w
  }
  out = out.trim()
  return { text: out || s, clipped: out.length < s.length }
}
function fmtFresh(ts) {
  if (!ts) return null
  const d = typeof ts === 'number' ? new Date(ts * 1000) : new Date(ts)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// ── building blocks ─────────────────────────────────────────────────────────
function Row({ k, v, cls, p }) {
  // Dim is reserved for MISSING data — every real value stays bright. `p` only
  // adds weight, never a colour change (dimming valid data read as disabled).
  const empty = typeof v === 'string' && (v === '—' || v.trim() === '')
  return (
    <div className={styles.mRow}>
      <span className={styles.mKey}>{k}</span>
      <span className={`${styles.mVal}${p ? ' ' + styles.mValP : ''}${empty ? ' ' + styles.mValEmpty : ''} ${cls || ''}`}>{v}</span>
    </div>
  )
}
function Group({ title, children, first }) {
  return (
    <div className={`${styles.mGroup}${first ? ' ' + styles.mGroupFirst : ''}`}>
      <div className={styles.mGroupLabel}>{title}</div>
      <div className={styles.mGrid}>{children}</div>
    </div>
  )
}
// A company fact as INLINE identity metadata. These six answers used to own a
// dedicated 2-column section costing ~197px of prime first-viewport space; as
// wrapped inline pairs they cost ~50px. The value keeps the full value
// brightness — the space came from structure, not from shrinking or dimming.
// Emits its label and value as two SEPARATE grid children (not a wrapper) so
// they land in the parent's aligned label/value columns — see .idFacts.
function IdFact({ label, value }) {
  if (value == null) return null
  return (
    <>
      <span className={styles.idFactK}>{label}</span>
      <span className={styles.idFactV}>{value}</span>
    </>
  )
}

// ── Ownership snapshot (deep list behind one interaction) ───────────────────
function OwnershipSnapshot({ sym, instPct, insiderPct }) {
  const { data } = useOwnership(sym)
  const [open, setOpen] = useState(false)
  const holders = data?.top_holders || []
  const inst = data?.inst_pct ?? instPct
  const buyers = (data?.biggest_buyers || []).slice(0, 3)
  const sellers = (data?.biggest_sellers || []).slice(0, 3)
  const CHIP = { new: 'NEW', added: 'ADD', reduced: 'CUT', sold_out: 'SOLD' }
  if (data?.locked) return null
  if (inst == null && !holders.length) return null

  return (
    <section className={styles.section}>
      <div className={styles.secHead}>Ownership</div>
      <div className={styles.ownLine}>
        {inst != null && <span><b className={styles.ownStat}>{inst > 100 ? '>100' : inst}%</b> institutional</span>}
        {insiderPct != null && <span className={styles.ownSep}><b className={styles.ownStat}>{insiderPct}%</b> insider</span>}
      </div>
      {holders.length > 0 && <div className={styles.ownNames}>{holders.slice(0, 3).map(h => h.holder).join(' · ')}</div>}
      {holders.length > 0 && (
        <button type="button" className={styles.moreLink} onClick={() => setOpen(v => !v)}>
          {open ? 'Hide ownership' : 'Explore ownership →'}
        </button>
      )}
      {open && (
        <div className={styles.ownDeep}>
          {holders.slice(0, 12).map((h, i) => (
            <div key={i} className={styles.ownHolder}>
              <span className={styles.ownHolderName}>{h.holder}</span>
              <span className={styles.ownHolderMeta}>{h.pct_out != null ? `${h.pct_out}%` : shortShares(h.shares)}</span>
              {h.change && h.change !== 'flat' && <span className={`${styles.ownChip} ${(h.change === 'new' || h.change === 'added') ? styles.pos : styles.neg}`}>{CHIP[h.change]}</span>}
            </div>
          ))}
          {(buyers.length > 0 || sellers.length > 0) && (
            <div className={styles.ownFlow}>
              {buyers.length > 0 && (
                <div className={styles.ownFlowCol}>
                  <div className={styles.ownFlowLabel}>Buying</div>
                  {buyers.map((b, i) => <div key={i} className={styles.ownFlowRow}><span className={styles.ownFlowName}>{b.holder}</span><span className={styles.pos}>+{shortShares(b.change_shares)}</span></div>)}
                </div>
              )}
              {sellers.length > 0 && (
                <div className={styles.ownFlowCol}>
                  <div className={styles.ownFlowLabel}>Selling</div>
                  {sellers.map((s, i) => <div key={i} className={styles.ownFlowRow}><span className={styles.ownFlowName}>{s.holder}</span><span className={styles.neg}>−{shortShares(Math.abs(s.change_shares))}</span></div>)}
                </div>
              )}
            </div>
          )}
          {data?.as_of && <div className={styles.ownAsOf}>13F filings · {String(data.as_of).slice(0, 10)}</div>}
        </div>
      )}
    </section>
  )
}

export default function DockProfile({ sym }) {
  const [fastPoll, setFastPoll] = useState(false)
  const { status, company, stats, profile } = useStockBrief(sym || null, { generating: fastPoll })
  useEffect(() => { setFastPoll(status === 'generating') }, [status])

  const { data: full } = useMobileSWR(sym ? `/api/fundamentals-full/${encodeURIComponent(sym)}` : null, jsonFetcher, { refreshInterval: 0, dedupingInterval: 300000, revalidateOnFocus: false })
  const { data: fund } = useMobileSWR(sym ? `/api/fundamentals/${encodeURIComponent(sym)}` : null, jsonFetcher, { refreshInterval: 600000, dedupingInterval: 60000, revalidateOnFocus: false })
  const { data: earn } = useEarningsTable(sym || null)
  const g = useGrowth(earn?.quarterly)

  // Two INDEPENDENT disclosures with different jobs: `More` opens the company
  // PROFILE (fuller description + CEO/listed/HQ/employees/website), while
  // `Full story →` opens the stock NARRATIVE. Never conflate them.
  const [profileOpen, setProfileOpen] = useState(false)
  const [storyOpen, setStoryOpen] = useState(false)

  const f = full || {}
  // A hand-written demo narrative used to sit between the real AI brief and the
  // yfinance description. It rendered with NO marker, so a fallback would have
  // read as generated research. Removed 2026-09-07 with the fabricated
  // valuation averages: the remaining chain is real brief → real filed
  // description → the honest "generated on the live product" note.
  const companyName = company || f.name || null
  const desc = profile?.company_desc || leadSentences(f.about)
  // The expanded profile shows a fuller description — but yfinance's raw
  // longBusinessSummary is a ~240-word filing dump (618px at the default width),
  // which turns `More` into a wall of prospectus text. Cap it on sentence
  // boundaries so the expansion reads as a company profile.
  const aboutLong = (f.about && desc && f.about.length > desc.length + 60) ? f.about : null
  const fullAbout = aboutLong ? leadStory(aboutLong, 80).text : null
  const storyFull = profile?.run_story
  // Default Story = the catalyst plus its supporting driver, whole sentences
  // only. The closing risk/caveat sentence is real research but not part of
  // "why is this moving?", so it waits behind "Full story →".
  const { text: storyShort, clipped: storyClipped } = leadStory(storyFull, 45)
  const fresh = fmtFresh(profile?.generated_at)

  // Real "% off the 52-week high" (needs a last price — added to the snapshot).
  const w52h = f.fifty_two_week_high ?? fund?.week52_high
  const px = f.price ?? null
  const offHigh = (px != null && w52h) ? ((px - w52h) / w52h) * 100 : null
  // `range_pct` is computed from THIS YEAR's bars (low→high on an up year), so it
  // is a YTD span — not a 52-week range. Label it truthfully.
  const rangeLabel = stats?.range_dir === 'down' ? 'YTD High → Low' : 'YTD Low → High'
  // `inception` is the FIRST-TRADE date (fundamentals._inception_iso reads
  // yfinance's firstTradeDateMilliseconds), i.e. the year the stock began
  // trading under its current listing — NOT the year the company was founded.
  // Labelled "Listed" accordingly: Micron listed in 1984 but was founded in
  // 1978, and a relisting legitimately resets this (SNDK → 2025).
  const listedYear = fund?.inception ? String(fund.inception).slice(0, 4) : null
  // `More` only earns its place if there is genuinely something to reveal —
  // a longer description, or at least one company fact.
  const hasProfile = !!(fullAbout || fund?.ceo || f.ceo || listedYear || fund?.hq
    || fund?.employees != null || fund?.website)

  if (!sym) return <div className={styles.emptyState}>No symbol.</div>

  return (
    <div className={styles.profile}>
      {/* ── Intelligence header ── */}
      <header className={styles.ih}>
        {/* Logo + name + classification are ONE identity unit. Sector/industry
            used to sit below the description, where it read as an orphaned line
            between the prose and the Story; as a subtitle under the name it is
            what it actually is — metadata belonging to the company. */}
        <div className={styles.ihTop}>
          <CompanyLogo sym={sym} size={26} name={companyName} round />
          <div className={styles.ihId}>
            <div className={styles.ihName}>{companyName || sym}</div>
            {(f.sector || f.industry) && (
              <div className={styles.ihMeta}>{[f.sector, f.industry].filter(Boolean).join('  ·  ')}</div>
            )}
          </div>
        </div>
        {desc && (
          <p className={styles.ihDesc}>
            {profileOpen && fullAbout ? fullAbout : desc}
            {hasProfile && (
              <button type="button" className={styles.moreInline} onClick={() => setProfileOpen(v => !v)}>
                {profileOpen ? 'Less' : 'More'}
              </button>
            )}
          </p>
        )}
        {/* Company profile — ON DEMAND. These facts are real research, but they
            are not what a chart user needs first, and permanently parked between
            the description and the Story they broke the reading line from "what
            is this company" straight to "why is the stock moving". Behind
            `More` they cost the default view nothing and stay one click away.
            "Next earnings" is deliberately absent — the chart header directly
            beside this panel already shows it. */}
        {profileOpen && (
          <div className={styles.idFacts}>
            <IdFact label="CEO" value={personName(fund?.ceo || f.ceo)} />
            <IdFact label="Listed" value={listedYear} />
            <IdFact label="Headquarters" value={fund?.hq || null} />
            <IdFact label="Employees" value={fund?.employees != null ? compactInt(fund.employees) : null} />
            <IdFact
              label="Website"
              value={fund?.website ? <a className={styles.link} href={fund.website} target="_blank" rel="noreferrer">{websiteDomain(fund.website)} ↗</a> : null}
            />
          </div>
        )}
      </header>

      {/* ── The Story — signature intelligence block ── */}
      <section className={styles.story}>
        <div className={styles.storyHead}>
          <span className={styles.storyTitle}>The Story</span>
          {fresh && <span className={styles.storyFresh}>Updated {fresh}</span>}
        </div>
        {storyFull ? (
          // The control rides INLINE at the end of the prose, like the
          // description's `More`: as its own block it cost ~24px, which cancelled
          // most of what shortening the Story saved.
          <p className={styles.storyBody}>
            {storyOpen ? storyFull : storyShort}
            {storyClipped && (
              <button type="button" className={styles.moreInline} onClick={() => setStoryOpen(v => !v)}>
                {storyOpen ? 'Less' : 'Full story →'}
              </button>
            )}
          </p>
        ) : status === 'generating' ? (
          <div className={styles.generating}><span className={styles.spinner} /> Building the story…</div>
        ) : (
          <p className={styles.storyMuted}>The narrative for this stock is generated on the live product from the year’s performance, earnings and dominant themes.</p>
        )}
      </section>

      {/* ── Fundamentals — one system (layer 2).
             Order is deliberate for a CHARTING product: the user is staring at a
             price chart, so Valuation → Growth → Price & Performance are the
             three groups that earn the first screen. Profitability and Financial
             Health are financial-QUALITY questions — still here in full, just
             below the fold, where a reader who is digging will find them. ── */}
      <section className={`${styles.section} ${styles.layerBreak}`}>
        {/* No "Fundamentals" head: Valuation / Growth / Price & Performance /
            Profitability / Financial Health are self-evidently company metrics,
            and naming the container added a third hierarchy level plus ~30px
            above the panel's most valuable content. The layer divider alone is
            the transition out of the Story, and the gold group titles ARE the
            section headings now. */}
        <Group title="Valuation" first>
          <Row k="Market Cap" v={str(f.market_cap)} p />
          <Row k="Ent. Value" v={str(f.enterprise_value)} />
          <Row k="P/E (ttm)" v={num(f.pe_trailing)} p />
          <Row k="P/E (fwd)" v={num(f.pe_forward ?? fund?.forward_pe)} />
          <Row k="EV / EBITDA" v={num(f.ev_to_ebitda)} p />
          <Row k="PEG" v={num(f.peg)} />
          <Row k="P/S" v={num(f.ps)} />
          <Row k="P/B" v={num(f.pb)} />
          <Row k="EV / Revenue" v={num(f.ev_to_revenue)} />
          <Row k="Div Yield" v={fund?.div_yield != null ? `${num(fund.div_yield)}%` : '—'} />
        </Group>

        <Group title="Growth">
          <Row k="Revenue YoY" v={signPct(f.revenue_growth_pct)} cls={sgn(f.revenue_growth_pct)} p />
          <Row k="Earnings YoY" v={signPct(f.earnings_growth_pct)} cls={sgn(f.earnings_growth_pct)} p />
          <Row k="Q Sales YoY" v={signPct(g.salesYoY)} cls={sgn(g.salesYoY)} />
          <Row k="EPS Last Q" v={g.epsLastQ != null ? fmtEps(g.epsLastQ) : '—'} />
          <Row k="EPS QoQ" v={signPct(g.epsQoQ)} cls={sgn(g.epsQoQ)} />
          <Row k="EPS YoY" v={signPct(g.epsYoY)} cls={sgn(g.epsYoY)} />
        </Group>

        {/* Chart context, as a peer group rather than its own gold-headed section:
            the separate section cost an extra head + margins for the same seven
            rows, and this is exactly the reading order a chart user wants. */}
        <Group title="Price & Performance">
          <Row k="YTD Return" v={stats?.ytd_gain_pct != null ? fmtPct(stats.ytd_gain_pct) : '—'} cls={sgn(stats?.ytd_gain_pct)} p />
          {/* a span, not a return — magnitude stays neutral (green/red is reserved
              for directional change: returns and growth) */}
          <Row k={rangeLabel} v={stats?.range_pct != null ? fmtPct(stats.range_pct) : '—'} />
          <Row k="Off 52W High" v={signPct(offHigh)} cls={sgn(offHigh)} p />
          <Row k="52W High" v={w52h != null ? num(w52h) : '—'} />
          <Row k="52W Low" v={(f.fifty_two_week_low ?? fund?.week52_low) != null ? num(f.fifty_two_week_low ?? fund?.week52_low) : '—'} />
          <Row k="Avg $ Vol" v={fmtVol(stats?.avg_dollar_vol)} />
          <Row k="Beta" v={num(fund?.beta)} />
        </Group>

        <Group title="Profitability">
          <Row k="Gross Margin" v={pctVal(f.gross_margin_pct)} p />
          <Row k="Op. Margin" v={pctVal(f.operating_margin_pct)} p />
          <Row k="Net Margin" v={pctVal(f.profit_margin_pct)} />
          <Row k="ROE" v={pctVal(f.roe_pct)} p />
          <Row k="ROA" v={pctVal(f.roa_pct)} />
          <Row k="EBITDA" v={str(f.ebitda)} />
          <Row k="Free Cash Flow" v={str(f.free_cash_flow)} p />
        </Group>

        <Group title="Financial Health">
          <Row k="Debt / Equity" v={num(f.debt_to_equity)} p />
          <Row k="Current Ratio" v={num(f.current_ratio)} p />
          <Row k="Total Cash" v={str(f.total_cash)} />
          <Row k="Total Debt" v={str(f.total_debt)} />
          <Row k="Float" v={fmtShares(fund?.float_shares)} />
          <Row k="Short Float" v={fund?.short_pct_float != null ? `${num(fund.short_pct_float, 1)}%` : '—'} />
        </Group>
      </section>

      {/* ── Ownership snapshot ── */}
      <OwnershipSnapshot sym={sym} instPct={f.held_pct_institutions ?? fund?.inst_own_pct} insiderPct={f.held_pct_insiders} />
    </div>
  )
}
