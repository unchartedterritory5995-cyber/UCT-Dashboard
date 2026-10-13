// The post-trade review block (Notebook P2b, Task 11; spec §P2 item 7, R-P2b-4, R-P2b-5, Review Focus 4).
// params { tradeId }. With no trade it offers the member's closed trades; with one it reads
// GET /api/j2/trader-blocks/review/{tradeId} and shows the trade card, the plan-vs-execution grade (or
// the switch it needs), the tags, and the pre-entry checklist items that were NOT ticked.
// ⛔ Read-only: two GETs, and the only write is the block's own `tradeId` through setParams (one editor
// transaction). The block stores the trade's STABLE ref (`id:` / `ext:`, N15): a j2_trades row id is
// reissued by every broker resync and would turn this block into "no longer in your journal".
// ⛔ A checklist is the member's own discipline record: "not ticked" names only items the member's
// current settings still resolve, through the ONE copy of that logic (lib/blocks/checklistItems) and the
// block read seam, which refuses the legacy settings row when no single account is selected (C-1).
// Every failed or pending read says so in words of its own, and "gone" (a 404) is never "couldn't load".
import useSWR from 'swr'
import { Link } from 'react-router-dom'
import useChecklistSources from '../../../hooks/useChecklistSources'
import { CHECKLIST_ACCOUNT_LINES, checklistItems, uncheckedItems } from '../../../lib/blocks/checklistItems'
import { checkDetail, checkVerdict, px } from '../../../lib/planGradeText'
import { BlockEmpty, BlockError, BlockLoading, BlockNeedsSwitch } from './blockStates'
import styles from './Blocks.module.css'

const TRADES_URL = '/api/j2/trader-blocks/review/trades'
const SWR_OPTIONS = { revalidateOnFocus: false, shouldRetryOnError: false }

/** A non-2xx answer is an error carrying its status, so a 404 can be told from any other failure. */
async function fetcher(url) {
  const res = await fetch(url, { credentials: 'include' })
  if (!res.ok) throw Object.assign(new Error(String(res.status)), { status: res.status })
  return res.json()
}

/** "Oct 2" in New York, or null for a date that cannot be read. */
function shortDay(iso) {
  const d = new Date(iso)
  if (!iso || Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' })
}

const rText = (r) => (typeof r === 'number' && Number.isFinite(r) ? `${r > 0 ? '+' : ''}${r.toFixed(2)}R` : null)
const tagText = (list) => (Array.isArray(list) ? list.filter((t) => typeof t === 'string' && t).map((t) => t.replace(/_/g, ' ')) : [])

const PLAN_CHECKS = [['entry', 'Entry'], ['stop', 'Stop'], ['size', 'Size'], ['target', 'Target']]
// The statuses that carry no checks, in the trade page's own sentences (components/trade/PlanGradeCard.jsx).
const PLAN_LINES = {
  unplanned: 'No plan for this trade was written before entry.',
  member_none: 'You marked this trade as having no plan.',
  needs_pick: "More than one plan could be this trade's. Pick the one you traded on the trade's page.",
}

function TradePicker({ setParams }) {
  const { data, error, isLoading, mutate } = useSWR(TRADES_URL, fetcher, SWR_OPTIONS)
  if (isLoading) return <BlockLoading />
  if (error) return <BlockError onRetry={() => mutate()} />
  const trades = (Array.isArray(data?.trades) ? data.trades : []).filter((t) => t?.tradeRef || t?.id)
  if (!trades.length) return <BlockEmpty title="You have no closed trades to review yet." />
  return (
    <label className={styles.row}>
      <span>Trade to review</span>
      <select aria-label="Trade to review" className={styles.tap} value="" onChange={(e) => setParams({ tradeId: e.target.value })}>
        <option value="" disabled>Pick a trade</option>
        {trades.map((t) => {
          const key = t.tradeRef || t.id
          const closed = shortDay(t.exitDate)
          return <option key={key} value={key}>{[t.symbol, closed && `closed ${closed}`, t.result].filter(Boolean).join(' · ')}</option>
        })}
      </select>
    </label>
  )
}

function PlanGrade({ grade }) {
  if (!grade) return null
  if (grade.needs) return <BlockNeedsSwitch what={grade.needs} />
  if (grade.status !== 'planned') return PLAN_LINES[grade.status] ? <p className={styles.muted}>{PLAN_LINES[grade.status]}</p> : null
  const checks = grade.checks || {}
  return (
    <div className={styles.empty}>
      <p className={styles.emptyTitle}>Plan vs execution</p>
      <ul className={styles.list} aria-label="Plan checks">
        {PLAN_CHECKS.map(([key, label]) => (
          <li key={key}>{`${label}: ${checkVerdict(key, checks[key]).word}. ${checkDetail(key, checks[key], grade.plan || {})}`}</li>
        ))}
      </ul>
    </div>
  )
}

function Tags({ tags }) {
  const mistakes = tagText(tags?.mistakes)
  const emotions = tagText(tags?.emotions)
  if (!mistakes.length && !emotions.length) return <p className={styles.muted}>No tags yet. Add them on the trade's page.</p>
  return (
    <>
      {mistakes.length > 0 && <p>{`Mistakes: ${mistakes.join(', ')}`}</p>}
      {emotions.length > 0 && <p>{`Emotions: ${emotions.join(', ')}`}</p>}
    </>
  )
}

/** The items of the trade's setup checklist that were not ticked before entry. */
function Unticked({ preEntry, settings, settingsState }) {
  if (!preEntry) return <p className={styles.muted}>No pre-entry checklist was recorded for this trade.</p>
  if (settingsState === 'loading') return <p className={styles.muted}>Loading your checklist…</p>
  if (settingsState === 'error') return <p className={styles.muted}>Your checklist couldn't load, so the items not ticked aren't listed here.</p>
  if (Object.hasOwn(CHECKLIST_ACCOUNT_LINES, settingsState)) return <p className={styles.muted}>{CHECKLIST_ACCOUNT_LINES[settingsState]}</p>
  const items = checklistItems({ settings, rules: [], setup: preEntry.setup, includeRules: 'no' })
  if (!items.length) return null
  const missed = uncheckedItems(items, preEntry.checkedRuleIds)
  return (
    <p>{missed.length
      ? `Not ticked before entry: ${missed.map((i) => i.label).join(', ')}`
      : `All ${items.length} checklist items were ticked before entry.`}
    </p>
  )
}

function TradeReview({ tradeId, setParams, editable }) {
  const { data, error, isLoading, mutate } = useSWR(`/api/j2/trader-blocks/review/${encodeURIComponent(tradeId)}`, fetcher, SWR_OPTIONS)
  const { settings, settingsState } = useChecklistSources({ wantRules: false })
  if (isLoading) return <BlockLoading />
  if (error?.status === 404) {
    return (
      <BlockEmpty title="This trade is no longer in your journal.">
        {editable && (
          <button type="button" className={`btn btn-ghost ${styles.tap}`} onClick={() => setParams({ tradeId: '' })}>
            Pick another trade
          </button>
        )}
      </BlockEmpty>
    )
  }
  if (error || !data?.trade) return <BlockError onRetry={() => mutate()} />
  const t = data.trade
  const closed = shortDay(t.exitDate)
  const numbers = [`Entry ${px(t.entryPrice)} → exit ${px(t.exitPrice)}`, rText(t.rMultiple), closed && `closed ${closed}`].filter(Boolean)
  return (
    <div className={styles.empty}>
      <p className={styles.emptyTitle}>{[t.symbol, t.side, t.result].filter(Boolean).join(' · ')}</p>
      <p className={styles.muted}>{numbers.join(' · ')}</p>
      <PlanGrade grade={data.planGrade} />
      <Tags tags={data.tags} />
      <Unticked preEntry={data.preEntry} settings={settings} settingsState={settingsState} />
      <Link className={`btn btn-ghost ${styles.tap}`} to={`/journal-2-0/trade/${encodeURIComponent(t.id)}`}>Open the trade</Link>
    </div>
  )
}

export default function TradeReviewBlock({ params, setParams, editable }) {
  const tradeId = typeof params?.tradeId === 'string' ? params.tradeId : ''
  if (tradeId) return <TradeReview tradeId={tradeId} setParams={setParams} editable={editable} />
  if (!editable) return <p className={styles.muted}>No trade linked yet.</p>
  return <TradePicker setParams={setParams} />
}
