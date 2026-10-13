// The My rules block (Notebook P2b, Task 8; spec §P2 item 2). It lists the selected account's rules,
// each with its version line ("v3 · changed Oct 2"), a "Before entry" switch and an Edit form (the
// words, why, and what changed). ⛔ It writes RULES, never the note: the switch and the form go through
// lib/blocks/rulesApi (the one rule write, named in blockDoors.test.js WRITE_EXCEPTIONS), and nothing
// here calls setParams, so the block's params stay as the note stored them.
// It reads through hooks/useMyRulesSources (data and one re-read; the hooks behind it also write).
// After a write it re-reads the rule list, which the pre-entry checklist reads too, so a rule switched
// to "before entry" here joins every checklist that lists rules.
// ⛔ C-1: with no SPECIFIC account selected there is no rule list, so it says why, never "no rules".
// ⛔ A write's outcome is said in a status line that belongs to the BLOCK, not to the rule's row: a
// rule found dismissed (R-M1-1) leaves the list on the re-read, and its sentence must stay on screen.
import { useEffect, useRef, useState } from 'react'
import Switch from '../../../../../components/ui/Switch'
import useMyRulesSources from '../../../hooks/useMyRulesSources'
import { BLOCK_KINDS } from '../../../lib/journalBlocks'
import { editRule, versionLine } from '../../../lib/blocks/rulesApi'
import { BlockEmpty, BlockError, BlockLoading } from './blockStates'
import styles from './Blocks.module.css'
import css from './MyRulesBlock.module.css'

/** A setting the note never stored reads as the block catalog's default (lib/journalBlocks.js). */
const SETTINGS = BLOCK_KINDS.find((k) => k.id === 'myRules')?.settings || []
function setting(params, key) {
  const s = SETTINGS.find((x) => x.key === key)
  const v = params?.[key]
  return s && s.options.includes(v) ? v : s?.default
}

const ACCOUNT_LINES = Object.freeze({
  'no-account': 'Your rules show here when one account is selected.',
  'no-accounts': 'Your rules show here once you have a Journal account.',
  'accounts-error': "Your accounts couldn't load, so your rules aren't shown.",
})
const EMPTY = 'You have no rules yet. Turn a recurring mistake into a rule from Insights, then it shows here.'

/** The element to focus after the next render: an Edit button or a form's first field, by rule id. */
const focusKey = (kind, id) => `${kind}:${id}`

export default function MyRulesBlock({ params, editable }) {
  const which = setting(params, 'which')
  const { rules, rulesState, refresh, showSaved } = useMyRulesSources({ which })
  const [editing, setEditing] = useState(null)   // { id, label, evidence, note } of the open form
  const [busy, setBusy] = useState(null)         // the id of the rule whose write is in flight
  const [status, setStatus] = useState('')
  const rootRef = useRef(null)
  const focusNext = useRef(null)

  // Focus moves only when this block asked for it (an Edit opened or closed), never on a re-read.
  useEffect(() => {
    const key = focusNext.current
    if (!key || !rootRef.current) return
    focusNext.current = null
    const el = [...rootRef.current.querySelectorAll('[data-focus-key]')].find((n) => n.dataset.focusKey === key)
    el?.focus()
  })

  if (rulesState === 'loading') return <BlockLoading />
  if (rulesState === 'error') return <BlockError onRetry={refresh} />
  if (Object.hasOwn(ACCOUNT_LINES, rulesState)) return <p className={styles.muted}>{ACCOUNT_LINES[rulesState]}</p>

  async function write(rule, patch, onSaved) {
    setStatus('')
    setBusy(rule.id)
    const res = await editRule(rule.id, patch)
    setBusy(null)
    if (res.ok) {
      onSaved?.()
      showSaved(res.rule)   // m6: the saved rule on screen at once, then the re-read
      return
    }
    setStatus(res.error)
    if (res.gone) {
      setEditing((e) => (e?.id === rule.id ? null : e))
      refresh()
    }
  }

  function open(rule) {
    setStatus('')
    setEditing({ id: rule.id, label: rule.label || '', evidence: rule.evidence || '', note: '' })
    focusNext.current = focusKey('field', rule.id)
  }
  function close(rule) {
    setEditing(null)
    focusNext.current = focusKey('edit', rule.id)
  }
  function save(rule) {
    const evidence = editing.evidence.trim() ? editing.evidence : null
    write(rule, { label: editing.label, evidence, changeNote: editing.note.trim() || null }, () => close(rule))
  }
  const draft = (key) => (e) => { const value = e.target.value; setEditing((d) => ({ ...d, [key]: value })) }

  const statusLine = <p role="status" className={`${styles.muted} ${css.status}`}>{status}</p>

  if (!rules.length) {
    return (
      <div ref={rootRef} className={styles.empty}>
        <BlockEmpty title={EMPTY} />
        {statusLine}
      </div>
    )
  }

  return (
    <div ref={rootRef} className={styles.empty}>
      <ul className={css.list}>
        {rules.map((rule) => {
          const dismissed = rule.status === 'dismissed'
          const formOpen = editable && !dismissed && editing?.id === rule.id
          const name = `'${rule.label}'`
          return (
            <li key={rule.id} className={css.item}>
              {formOpen ? (
                <form aria-label={`Edit ${name}`} className={styles.empty}
                  onSubmit={(e) => { e.preventDefault(); save(rule) }}>
                  <label className={css.field}>
                    <span>Rule</span>
                    <input className={styles.tap} data-focus-key={focusKey('field', rule.id)}
                      value={editing.label} onChange={draft('label')} />
                  </label>
                  <label className={css.field}>
                    <span>Why</span>
                    <textarea className={styles.tap} rows={2} value={editing.evidence} onChange={draft('evidence')} />
                  </label>
                  <label className={css.field}>
                    <span>What changed?</span>
                    <input className={styles.tap} value={editing.note} onChange={draft('note')} />
                  </label>
                  <div className={styles.row}>
                    <button type="submit" className={`btn btn-primary ${styles.tap}`} disabled={busy === rule.id}>Save</button>
                    <button type="button" className={`btn btn-ghost ${styles.tap}`} onClick={() => close(rule)}>Cancel</button>
                  </div>
                </form>
              ) : (
                <>
                  <p className={css.label} data-rule-label="">{rule.label}</p>
                  {rule.evidence && <p className={styles.muted}>{rule.evidence}</p>}
                  <p className={styles.muted}>{dismissed ? `Dismissed · ${versionLine(rule)}` : versionLine(rule)}</p>
                  {!dismissed && (
                    <div className={css.controls}>
                      <label className={styles.row}>
                        <Switch checked={rule.beforeEntry === true} aria-label={`Check ${name} before entry`}
                          disabled={!editable || busy === rule.id}
                          onClick={() => write(rule, { beforeEntry: rule.beforeEntry !== true })}
                          className={styles.switch} checkedClassName={styles.switchOn} knobClassName={styles.knob} />
                        <span>Before entry</span>
                      </label>
                      {editable && (
                        <button type="button" className={`btn btn-ghost ${styles.tap}`} aria-label={`Edit ${name}`}
                          data-focus-key={focusKey('edit', rule.id)} onClick={() => open(rule)}>
                          Edit
                        </button>
                      )}
                    </div>
                  )}
                </>
              )}
            </li>
          )
        })}
      </ul>
      {statusLine}
    </div>
  )
}
