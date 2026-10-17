/**
 * Today panel: my rules (P4a Task 4).
 *
 * The Notebook's My rules block, read-only: the member's active rules with their version lines, and no edit
 * form. Editing a rule stays in the Notebook and Insights, where the change note and the rule history live.
 *
 * The block reads the selected account itself (useMyRulesSources), so this panel hands it only its settings.
 * With no account it does not mount the block at all: the block's own line for that case ("Your rules show
 * here when one account is selected.") is the Notebook's wording, and Today says the R-P4-9 sentence.
 *
 * The block is loaded through the SAME `lazyLeaf` import the Notebook editor uses, so the chunk is shared.
 * ⛔ lazyLeaf, never lazyChunk: a second chunk failure under lazyChunk reloads the page, which on Today would
 * throw away whatever the member was in the middle of.
 */
import { Component, Suspense } from 'react'
import TileCard from '../../../../../components/TileCard'
import { lazyLeaf } from '../../../lib/lazyChunk'
import styles from './panels.module.css'

// R-P4-9: shown while All Accounts is selected (the rules belong to an account). panels.test.jsx pins it.
// The checklist panel no longer says it: day notes belong to the member, so it shows on All Accounts.
const PICK_AN_ACCOUNT = 'Pick an account to see its rules.'

// The block's own boundary, declared here: NotebookTab.lazyViews.test.js (D-I2) requires a lazyLeaf's file to
// render a boundary around its Suspense, so that a chunk that cannot load costs the member this one line and
// not the route.
class Quiet extends Component {
  constructor(props) { super(props); this.state = { failed: false } }
  static getDerivedStateFromError() { return { failed: true } }
  render() { return this.state.failed ? this.props.fallback : this.props.children }
}

const MyRulesBlock = lazyLeaf(() => import('../../../components/notebook/blocks/MyRulesBlock'))

/** One object for every render: the block is handed its settings, and a new literal each time is a new prop each time. */
const ACTIVE_RULES = Object.freeze({ which: 'active' })

export default function MyRulesPanel({ accountId }) {
  return (
    <TileCard title="My rules" icon="shield">
      {accountId ? (
        <Quiet fallback={<p className={styles.muted}>Your rules aren&apos;t available right now.</p>}>
          <Suspense fallback={<p className={styles.muted}>Loading your rules…</p>}>
            <MyRulesBlock params={ACTIVE_RULES} editable={false} />
          </Suspense>
        </Quiet>
      ) : (
        <p className={styles.muted}>{PICK_AN_ACCOUNT}</p>
      )}
    </TileCard>
  )
}
