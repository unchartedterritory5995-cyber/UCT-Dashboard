/**
 * Wave B find-in-note bar. Scoped strictly to the current note's editor
 * (`editor` prop) — never a global/page-wide find. See noteFindExtension.js
 * for the decoration layer this drives; this component is pure UI plumbing.
 *
 * Wave 5 adds REPLACE and MATCH CASE:
 *  - the ▾ toggle (or opening with Ctrl+H / Cmd+Option+F, `initialReplace`)
 *    shows a second row: "Replace with", Replace, Replace all;
 *  - Enter in the replace field replaces the active match and moves on;
 *    Ctrl/Cmd+Enter replaces all — ONE undo step;
 *  - "Aa" toggles case-sensitive matching (aria-pressed);
 *  - how many were replaced is said in the live count region, in words.
 * A read-only editor gets no replace row at all.
 */
import { useEffect, useRef, useState } from 'react'
import UIcon from '../../../../components/ui/UIcon'
import styles from './NoteFindBar.module.css'

export default function NoteFindBar({ editor, onClose, initialReplace = false }) {
  const [term, setTerm] = useState('')
  const [matchCount, setMatchCount] = useState(0)
  const [activeIndex, setActiveIndex] = useState(-1)
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [showReplace, setShowReplace] = useState(Boolean(initialReplace))
  const [replacement, setReplacement] = useState('')
  const [notice, setNotice] = useState('')
  const inputRef = useRef(null)
  const canReplace = Boolean(editor?.isEditable)

  useEffect(() => { inputRef.current?.focus() }, [])
  // Opening with the replace shortcut while the bar is already open.
  useEffect(() => { if (initialReplace) setShowReplace(true) }, [initialReplace])

  const scrollToActive = () => {
    // rAF: wait for the decoration DOM to actually update before scrolling.
    // `isDestroyed` guards a note-switch/unmount racing this callback --
    // `editor.view` THROWS once destroyed (not merely undefined), so a bare
    // `editor?.view` optional-chain does not protect against it.
    requestAnimationFrame(() => {
      if (!editor || editor.isDestroyed) return
      const el = editor.view.dom.querySelector('.uct-find-match-active')
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    })
  }

  const syncFromStorage = () => {
    if (!editor) return
    setMatchCount(editor.storage.noteFind.matches.length)
    setActiveIndex(editor.storage.noteFind.activeIndex)
  }

  const runSearch = (value, sensitive) => {
    if (!editor) return
    editor.commands.noteFindSet(value, { caseSensitive: sensitive })
    syncFromStorage()
    scrollToActive()
  }

  const onChange = (e) => {
    const value = e.target.value
    setTerm(value)
    setNotice('')
    runSearch(value, caseSensitive)
  }

  const toggleCase = () => {
    const next = !caseSensitive
    setCaseSensitive(next)
    setNotice('')
    runSearch(term, next)
  }

  const goNext = () => {
    if (!editor) return
    editor.commands.noteFindNext()
    syncFromStorage()
    scrollToActive()
  }

  const goPrev = () => {
    if (!editor) return
    editor.commands.noteFindPrev()
    syncFromStorage()
    scrollToActive()
  }

  const replaceOne = () => {
    if (!editor || !canReplace) return
    const replaced = editor.commands.noteFindReplace(replacement)
    syncFromStorage()
    // A refused replace re-found the matches (the note changed underneath);
    // the bar now shows which one Replace will write over next.
    setNotice(replaced ? '' : 'The note changed — showing the next match')
    scrollToActive()
  }

  const replaceAll = () => {
    if (!editor || !canReplace) return
    const ok = editor.commands.noteFindReplaceAll(replacement)
    const n = ok ? editor.storage.noteFind.lastReplaced : 0
    syncFromStorage()
    setNotice(n === 1 ? 'Replaced 1 match' : `Replaced ${n} matches`)
  }

  const handleClose = () => {
    editor?.commands.noteFindClear()
    onClose?.()
  }

  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      handleClose()
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (e.shiftKey) goPrev()
      else goNext()
    }
  }

  const onReplaceKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      handleClose()
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (e.metaKey || e.ctrlKey) replaceAll()
      else replaceOne()
    }
  }

  const countText = notice || (term ? `${matchCount > 0 ? activeIndex + 1 : 0}/${matchCount}` : '')

  return (
    <div className={styles.bar} role="search" aria-label="Find in note">
      <div className={styles.row}>
        {canReplace ? (
          <button
            type="button"
            className={styles.navBtn}
            onClick={() => setShowReplace((s) => !s)}
            aria-expanded={showReplace}
            aria-label={showReplace ? 'Hide replace' : 'Show replace'}
            title={showReplace ? 'Hide replace' : 'Replace (Ctrl+H)'}
          >
            <UIcon name={showReplace ? 'chevronDown' : 'chevronRight'} size={13} gold={false} />
          </button>
        ) : (
          <UIcon name="search" size={14} gold={false} />
        )}
        <input
          ref={inputRef}
          className={styles.input}
          type="text"
          role="searchbox"
          value={term}
          onChange={onChange}
          onKeyDown={onKeyDown}
          placeholder="Find in note"
          aria-label="Find in note"
          autoComplete="off"
          spellCheck={false}
        />
        <button
          type="button"
          className={`${styles.navBtn} ${styles.caseBtn} ${caseSensitive ? styles.caseBtnOn : ''}`}
          onClick={toggleCase}
          aria-pressed={caseSensitive}
          aria-label="Match case"
          title="Match case"
        >
          Aa
        </button>
        <span className={styles.count} aria-live="polite">{countText}</span>
        <button
          type="button"
          className={styles.navBtn}
          onClick={goPrev}
          disabled={matchCount === 0}
          aria-label="Previous match"
          title="Previous match (Shift+Enter)"
        >
          <UIcon name="chevronUp" size={13} gold={false} />
        </button>
        <button
          type="button"
          className={styles.navBtn}
          onClick={goNext}
          disabled={matchCount === 0}
          aria-label="Next match"
          title="Next match (Enter)"
        >
          <UIcon name="chevronDown" size={13} gold={false} />
        </button>
        <button
          type="button"
          className={styles.closeBtn}
          onClick={handleClose}
          aria-label="Close find"
          title="Close (Esc)"
        >
          <UIcon name="x" size={13} gold={false} />
        </button>
      </div>
      {canReplace && showReplace && (
        <div className={styles.row}>
          <span className={styles.rowIndent} aria-hidden="true" />
          <input
            className={styles.input}
            type="text"
            value={replacement}
            onChange={(e) => { setReplacement(e.target.value); setNotice('') }}
            onKeyDown={onReplaceKeyDown}
            placeholder="Replace with"
            aria-label="Replace with"
            autoComplete="off"
            spellCheck={false}
          />
          <button
            type="button"
            className={styles.textBtn}
            onClick={replaceOne}
            disabled={matchCount === 0}
            title="Replace this match (Enter)"
          >
            Replace
          </button>
          <button
            type="button"
            className={styles.textBtn}
            onClick={replaceAll}
            disabled={matchCount === 0}
            title="Replace every match — one undo (Ctrl/Cmd+Enter)"
          >
            Replace all
          </button>
        </div>
      )}
    </div>
  )
}
