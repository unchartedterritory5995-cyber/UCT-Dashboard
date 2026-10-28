// Template picker grid — the Notebook's "what kind of note?" surface.
// Rendered inside a Sheet from the toolbar AND inline on the empty-notebook
// state. Families come from the catalog; "Blank note" is always first, and
// the last card points setup-documentation work at My Playbook (which owns
// that artifact — see the templates plan §3).
//
// Wave 10 lane D2 (design finding D-4): a BROWSABLE gallery, the way Notion's and
// Evernote's are. Every built-in card shows the template's name, its one-line
// description and a short preview of the note it makes -- its first lines, taken
// from the template's own STRUCTURE (`templatePreview`, lib/notebookTemplates.js:
// the headings and prompts it writes for everyone, never its no-data scaffold),
// never a second, hand-typed list. Grouped by family, as the catalog declares.
// A card is named by the template's name and described by its "when" line and its
// description only (fix round 1, M-3); the preview is a visual sample and is
// hidden from assistive tech, which already has the description.
// Arrow keys move between cards (Home/End to the ends); Tab still walks every one.
// Picking a card hands `onPick` the catalog's own object, exactly as before.
//
// Wave 10 lane DR-C (design finding D-4, breadth + a real gallery): three
// additions, none of which touch the card's own click/Enter/Space behaviour
// above (so every rail this header already describes stays green byte-for-
// byte on the default, unfiltered view):
//   * a search box + category chips (derived from FAMILIES -- never a typed
//     second list) that filter which family sections and cards render;
//   * a "Preview" action beside each card (own sibling control, never nested
//     inside the card's <button> -- a button in a button is one control to a
//     screen reader) that opens the template's full body READ-ONLY
//     (TemplatePreview.jsx) with a "Use this template" button which calls the
//     exact same `onPick`/`onPickMember` the card itself calls -- creation
//     still goes through ONE door (`createNoteViaApi`, wired by the caller);
//   * the catalog has grown from 9 to 25 built-ins (breadth) -- every test in
//     this file's sibling `.gallery.test.jsx` is derived from `TEMPLATES`, so
//     it covers the new ones without being told their names.
//
// Wave 12 lane 12A: while notebook_template_gallery_enabled is LATCHED on, a "Browse the
// community gallery" door below the chips swaps this dialog's content for
// TemplateGallery.jsx (members' shared templates, reviewed by UCT); its Back button
// returns here with focus on the door. "Make a note from it" there calls the same
// `onPickMember` this picker hands MemberTemplates. Gate off: no door, nothing changes.
//
// Wave 13 lane 13Q-5 (click-budget: Q2, "new note from a template"). Measured
// (docs/notebook/evidence/wave13-13q3/run-remeasure-final/): once a member has
// reached this dialog, finding one named card by Tab alone costs 23+ presses --
// the dialog's OWN card order, not shared chrome. Two additions, neither of
// which touches the card's own click/Enter/Space contract (so every byte of
// the header above this one stays true):
//   * `autoFocusSearch` (opt-in -- the Sheet caller passes it; the inline
//     empty-notebook mount does not, so landing there never steals focus on
//     page load) lands real DOM focus on the search box the instant the
//     dialog opens, via the SAME `autoFocus` convention `Sheet.jsx` already
//     special-cases for a dozen other dialogs (Sheet.autoFocus.test.jsx) --
//     no new focus-timing code, no re-fighting the Q1 background-page finding.
//   * a virtual "active card" the search box itself drives: typing narrows
//     `visibleFamilies`/`MemberTemplates` as before (unchanged), the active
//     index snaps to the first REAL match (never the always-present Blank/
//     Playbook anchors -- marked `data-template-anchor`, the one new attribute
//     this lane adds) whenever the query or category changes, ArrowUp/ArrowDown
//     from the search box move it one card (lane FIN-A11Y narrowed this from
//     all four arrows plus Home/End, which had taken the text caret's keys --
//     see SEARCH_MOVES), and Enter there clicks the active
//     card -- reusing its EXISTING onClick, never a second onPick call site.
//     Real DOM focus never leaves the input, so this is additive: a member who
//     never types still has the full Tab-everywhere path below unchanged, and
//     `data-template-card`'s `tabindex` is never touched (the pinned "no
//     roving tabindex hides one" rail in TemplatePicker.gallery.test.jsx stays
//     green because nothing here sets `tabIndex` on a card).
//   * KNOWN LIMITATION, stated rather than hidden: the active-card highlight
//     (`data-active`) is recomputed in a parent-level effect, so it can lag by
//     one tick behind a member template arriving from MemberTemplates' own
//     async fetch (a child component's state, invisible to this effect's deps).
//     The keyboard FUNCTION never lags -- Enter reads the live DOM at the
//     moment it fires -- only the visual ring can be briefly stale.
//
// Notebook widgets wave 11 (Task 11.16): while `widgetsWaveOn(11)`, the Template library (UCT's official templates,
// library/TemplateLibrarySection.jsx) sits between Blank and "Your templates", loaded on demand. It reads this
// picker's search box and category chips; its cards are not picker cards, so every keyboard rail above holds.
// Wave 11 off: the section's chunk is never asked for and the picker is exactly as before.
// Fix round 1 (review I-2): the section reports how many templates it shows (`onMatches`). While it shows any, the
// "No templates match" line is not drawn, and the search box's live line names the library's count instead of
// "No template matches"; Enter still does nothing there (library cards are not picker cards).
//
// Wave 7 Task 7.4 ("bytes first"): the catalog (lib/notebookTemplates.js, ~64 kB of
// source) is no longer a static import. `FAMILIES`, `templatesByFamily` and
// `templatePreview` come from `loadTemplates()` (lib/templatesLoader.js, one memoised,
// retried import), and NotebookTab mounts this module as its own lazy chunk. Until the
// catalog has arrived the picker renders TemplatePickerSkeleton (the same box, holding
// the tour's gallery-door anchor); everything below the loader is the picker exactly as
// it was, handed the catalog module as a prop.
import { Suspense, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { loadTemplates, loadedTemplates } from '../../lib/templatesLoader'
import TemplatePickerSkeleton from './TemplatePickerSkeleton'
import MemberTemplates from './MemberTemplates'
import TemplatePreview from './TemplatePreview'
import { templateGalleryEnabled } from '../../lib/templateGallery'
import { widgetsWaveOn } from '../../lib/notebookWidgetsFlags'
import lazyChunk from '../../lib/lazyChunk'
import UIcon from '../../../../components/ui/UIcon'
import { useHasCoarsePointer } from '../../../../hooks/useBreakpoint'
import styles from './TemplatePicker.module.css'

// The community gallery (and the admin review panel it carries) is dark behind
// notebook_template_gallery_enabled and reached by one button, so it loads when that button
// is pressed, never with the picker: it was ~25 kB of source in every member's first open.
const TemplateGallery = lazyChunk(() => import('./TemplateGallery'))
// Wave 11 (Task 11.16): the Template library section, asked for only while wave 11 is on.
const TemplateLibrarySection = lazyChunk(() => import('./library/TemplateLibrarySection'))

const CARD = '[data-template-card]'
const MOVES = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }
// ⛔ Lane FIN-A11Y (review R4, I-5): from the SEARCH BOX only Up and Down drive the list.
// Left, Right, Home and End are the text caret's -- taking them meant a member could not
// edit what they had typed. (Between the cards themselves all four arrows still move
// focus: MOVES above, onGalleryKeyDown below.)
const SEARCH_MOVES = { ArrowDown: 1, ArrowUp: -1 }
/** The words a card is known by: its accessible name when it sets one (built-in cards
 *  do), else its first line (Blank, Playbook and member cards lead with their label). */
const cardName = (el) => (
  el?.getAttribute('aria-label') || el?.firstElementChild?.textContent || el?.textContent || ''
).trim()
const ALL = 'all'
const MEMBER = 'member'

/** The live line when only the Template library matches the search (n >= 1). */
export const libraryMatchWords = (n) => (n === 1
  ? '1 template in the Template library matches. Enter does nothing.'
  : `${n} templates in the Template library match. Enter does nothing.`)

/** The live line on a touch screen (n >= 0): how many templates the search and chip leave, never a key to press. */
// The settle before the touch count is spoken: PoliteStatus.jsx's SETTLE_MS, for the same reason (a live region
// announces a CHANGE, so the text is set once the children have reported, not in the commit before they do).
const TOUCH_SETTLE_MS = 60
// How long the picker waits for "Your templates" and the Template library to answer before it speaks (and shows "No
// templates match") with what it has. Its own number, not borrowed: long enough for an ordinary list request on a
// phone connection to land (so the count is usually complete), short enough that a member who tapped a chip still
// hears the answer to THAT tap, not one many seconds later.
const TOUCH_COUNT_WAIT_MS = 3000
const touchMatchWords = (n) => (n === 1 ? '1 template.' : `${n} templates.`)

/** Case-insensitive substring match over a template's searchable text. */
function templateMatches(tpl, q) {
  if (!q) return true
  const hay = [tpl.label, tpl.description, tpl.when, ...(tpl.tags || [])].join(' ').toLowerCase()
  return hay.includes(q)
}

/** Arrow / Home / End move focus between the gallery's cards (enabled ones only). */
function onGalleryKeyDown(e) {
  const from = e.target.closest?.(CARD)
  if (!from) return
  const cards = [...e.currentTarget.querySelectorAll(CARD)].filter((c) => !c.disabled)
  const at = cards.indexOf(from)
  if (at < 0) return
  let to = null
  if (e.key in MOVES) to = cards[Math.min(cards.length - 1, Math.max(0, at + MOVES[e.key]))]
  else if (e.key === 'Home') to = cards[0]
  else if (e.key === 'End') to = cards[cards.length - 1]
  if (!to) return
  e.preventDefault()
  to.focus()
}

// Task 7.4: what the picker shows when the catalog could not load (the retry included). Blank note, the
// member's own templates and the Playbook pointer still work, and a status line says why the rest is missing.
const NO_CATALOG = Object.freeze({
  FAMILIES: Object.freeze([]),
  templatesByFamily: () => [],
  templatePreview: () => [],
})

/** The catalog module as soon as it is here: synchronously when it already arrived, else after the load. */
function useTemplateCatalog() {
  const [catalog, setCatalog] = useState(loadedTemplates)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    if (catalog) return undefined
    let alive = true
    loadTemplates().then(
      (mod) => { if (alive) setCatalog(mod) },
      () => { if (alive) setFailed(true) },
    )
    return () => { alive = false }
  }, [catalog])
  return { catalog, failed }
}

export default function TemplatePicker(props) {
  const { catalog, failed } = useTemplateCatalog()
  if (catalog) return <TemplatePickerBody {...props} catalog={catalog} />
  if (failed) return <TemplatePickerBody {...props} catalog={NO_CATALOG} catalogFailed />
  return <TemplatePickerSkeleton />
}

// Wave 6: `onPickMember` adds "Your templates" (the member's own, saved from
// their notes) right after Blank — the templates a member made are the ones
// they reach for first. Absent, the picker is exactly the built-in catalog.
// `onLandNote(note)` (11.20 walk D1): the host's door for a note the Template library's Use already made -- the same
// close-and-open a member template's pick ends in. Absent, the library's Use navigates to the note as before.
function TemplatePickerBody({ onPick, onPickMember, onLandNote, busy = false, autoFocusSearch = false, kindSection, catalog, catalogFailed = false }) {
  const { FAMILIES, templatesByFamily, templatePreview } = catalog
  const navigate = useNavigate()
  // A picker can be on screen twice (the empty notebook and the New-note sheet),
  // so the label ids are per instance.
  const uid = useId()
  const wrapRef = useRef(null)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState(ALL)
  // A touch screen (VoiceOver, TalkBack) has no Up, Down or Enter to press: the search box's key hint is not drawn
  // there, and the live line says how many templates are left instead of what Enter would open.
  // A coarse pointer, not a narrow width: an iPad with a keyboard attached still reads as coarse, and there the
  // keys keep working (the handlers are unchanged); only the spoken hint is gone.
  const coarse = useHasCoarsePointer()
  const [touchSaid, setTouchSaid] = useState('')       // the touch live line, set once its count has settled
  const [filtered, setFiltered] = useState(false)      // false until the member first searches or picks a chip
  // The search-box-driven virtual focus (13Q-5): which `data-template-card`
  // Enter would pick right now. Painted via `data-active`, never via real
  // DOM focus -- the input keeps it.
  const [activeIdx, setActiveIdx] = useState(0)
  const [searchFocused, setSearchFocused] = useState(false)
  // I-5: what the search box points assistive technology at (aria-activedescendant), and
  // the name said in the polite status. Read from the live DOM by the paint effect below,
  // because member templates are a child component's cards.
  const [activeCard, setActiveCard] = useState(null)   // { id, name } | null
  const [targetName, setTargetName] = useState(null)   // the Enter target, focused or not
  const cardSeq = useRef(0)

  const visibleCards = () => (wrapRef.current
    ? [...wrapRef.current.querySelectorAll(CARD)].filter((c) => !c.disabled)
    : [])
  // The previewed template: { label, subtitle, body, onUse } | null. A built-in
  // preview is synchronous (the catalog already holds the body); a member
  // preview fetches the full record first (see MemberTemplates.jsx) and is
  // opened by that component through `onPreviewMember` below.
  const [preview, setPreview] = useState(null)
  const galleryOn = templateGalleryEnabled()
  const [community, setCommunity] = useState(false)
  const [backToDoor, setBackToDoor] = useState(false)
  const doorRef = useRef(null)
  useEffect(() => {
    if (backToDoor && !community) {
      doorRef.current?.focus()
      setBackToDoor(false)
    }
  }, [backToDoor, community])

  const q = query.trim().toLowerCase()
  const showFamily = (famKey) => category === ALL || category === famKey
  const visibleFamilies = useMemo(
    () => FAMILIES
      .filter((f) => showFamily(f.key))
      .map((f) => ({ ...f, items: templatesByFamily(f.key).filter((t) => templateMatches(t, q)) }))
      .filter((f) => f.items.length > 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [q, category, catalog],
  )
  const showMemberSection = Boolean(onPickMember) && (category === ALL || category === MEMBER)
  // Wave 11 (Task 11.16 fix round 1, I-2): what the Template library section shows right now (0 while it is off).
  const libraryOn = widgetsWaveOn(11)
  // `known` is false while the library's list is still being asked for (it reports 0 then, which is not an answer).
  const [libraryShown, setLibraryShown] = useState({ n: 0, known: false })
  const onLibraryMatches = useCallback((n, known = true) => {
    setLibraryShown((prev) => (prev.n === n && prev.known === known ? prev : { n, known }))
  }, [])
  const libraryCount = libraryOn ? libraryShown.n : 0
  const libraryKnown = !libraryOn || libraryShown.known
  // How many of the member's own templates "Your templates" shows (MemberTemplates' `onMatches`): null while their
  // list is loading, 0 while the section is not drawn.
  const [memberShown, setMemberShown] = useState(null)
  const memberCount = showMemberSection ? (memberShown || 0) : 0
  const memberKnown = !showMemberSection || memberShown !== null
  const builtInCount = visibleFamilies.reduce((n, f) => n + f.items.length, 0)
  const allKnown = memberKnown && libraryKnown
  // ⛔ BOUNDED: a request that never answers must not keep the picker silent for good. TOUCH_COUNT_WAIT_MS after the
  // first filter with an addend still unknown, `gaveUp` lets the touch line speak what IS known (and keep doing so; a
  // late answer changes the number, which is spoken again), and lets "No templates match" stop waiting for "Your
  // templates". Runs on every pointer: the status it unblocks is shown on desktop too.
  const [gaveUp, setGaveUp] = useState(false)
  useEffect(() => {
    if (!filtered || allKnown || gaveUp) return undefined
    const t = setTimeout(() => setGaveUp(true), TOUCH_COUNT_WAIT_MS)
    return () => clearTimeout(t)
  }, [filtered, allKnown, gaveUp])
  // N3: the "No templates match" status counts every section's matches, so it never sits beside the member's own,
  // and waits for "Your templates" to answer (a list still loading is not "none": it would show, then vanish) -- but
  // only up to the wait above, or a hung list would leave a zero-match search with nothing said at all.
  const noBuiltInMatches = !catalogFailed && visibleFamilies.length === 0 && category !== MEMBER && libraryCount === 0
    && memberCount === 0 && (memberKnown || gaveUp)

  // The touch live line: built-in + the member's own + the Template library's, DERIVED from what each section says it
  // shows (never a DOM count: that went stale when the member's list loaded, and missed a card being renamed). Said
  // only once every addend is known for this filter, and after a short settle (PoliteStatus's), so the one commit in
  // which a child has not yet reported the new filter's number is never spoken. Only once the member has filtered,
  // so opening the picker announces nothing over the dialog's own name.
  // Bounded by `gaveUp` above.
  const touchTotal = builtInCount + memberCount + libraryCount
  const touchReady = coarse && filtered && (allKnown || gaveUp)
  useEffect(() => {
    if (!touchReady) return undefined
    const t = setTimeout(() => setTouchSaid(touchTotal ? touchMatchWords(touchTotal) : ''), TOUCH_SETTLE_MS)
    return () => clearTimeout(t)
  }, [touchReady, touchTotal])

  // 13Q-5: a query or a category change re-aims the search box's "Enter picks
  // this" target. Never at Blank/Playbook (`data-template-anchor`, always
  // visible, never filtered) -- a member who just typed "thesis" and pressed
  // Enter must get the thesis card, not the blank page it would read as index 0.
  // ⛔ A query that matches NO real template sets `activeIdx` to -1 (nothing),
  // never falling back to Blank -- Enter on "zzzznosuchtemplate" must do
  // nothing, not silently create a blank note (the same status message
  // `noBuiltInMatches` already shows explains why there is nothing to pick).
  useEffect(() => {
    const list = visibleCards()
    if (!q) { setActiveIdx(list.length ? 0 : -1); return }
    setActiveIdx(list.findIndex((el) => !el.hasAttribute('data-template-anchor')))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, category])

  // Paints the ring on whichever card Enter would pick, only while the search
  // box itself holds real focus (a card that already has real focus paints its
  // own :focus-visible ring -- this is for the one moment nothing does).
  useEffect(() => {
    const list = visibleCards()
    list.forEach((el, i) => {
      if (searchFocused && i === activeIdx) el.setAttribute('data-active', 'true')
      else el.removeAttribute('data-active')
    })
    const el = activeIdx >= 0 ? list[activeIdx] : null
    if (el && !el.id) { cardSeq.current += 1; el.id = `${uid}card${cardSeq.current}` }
    const name = el ? cardName(el) : null
    setTargetName((prev) => (prev === name ? prev : name))
    const next = el && searchFocused ? { id: el.id, name } : null
    setActiveCard((prev) => (prev?.id === next?.id && prev?.name === next?.name ? prev : next))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIdx, searchFocused, q, category])

  function onSearchKeyDown(e) {
    if (e.key in SEARCH_MOVES) {
      const list = visibleCards()
      if (!list.length) return
      e.preventDefault()
      setActiveIdx((i) => Math.min(list.length - 1, Math.max(0, i + SEARCH_MOVES[e.key])))
    } else if (e.key === 'Enter') {
      const list = visibleCards()
      // activeIdx is -1 when the query matches no real template -- nothing to
      // click, and the member's own query decided that, not an index clamp.
      if (!list.length || activeIdx < 0 || activeIdx >= list.length) return
      e.preventDefault()
      // Reuses the card's OWN onClick -- never a second onPick call site, so
      // "every card hands onPick the catalog's own template object" (the
      // gallery rail) covers this path too, for free.
      list[activeIdx]?.click()
    }
  }

  const openBuiltInPreview = (tpl) => setPreview({
    label: tpl.label,
    subtitle: tpl.when,
    body: tpl.build({}),
    onUse: () => { setPreview(null); onPick(tpl) },
  })

  const closePreview = () => setPreview(null)

  if (galleryOn && community) {
    return (
      <div className={styles.wrap}>
        <Suspense fallback={<p role="status">Loading the community gallery…</p>}>
          <TemplateGallery
            onBack={() => { setCommunity(false); setBackToDoor(true) }}
            onUseNow={onPickMember}
            busy={busy}
          />
        </Suspense>
      </div>
    )
  }

  return (
    // The keys are handled for the card buttons inside (see onGalleryKeyDown).
    <div className={styles.wrap} ref={wrapRef} id={`${uid}cards`} onKeyDown={onGalleryKeyDown} data-template-gallery="">
      {kindSection}
      <div className={styles.toolbar}>
        <div className={styles.searchField}>
          <UIcon name="search" size={14} gold={false} className={styles.searchIcon} />
          <input
            type="search"
            className={styles.searchInput}
            value={query}
            onChange={(e) => { setFiltered(true); setQuery(e.target.value) }}
            onKeyDown={onSearchKeyDown}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            placeholder="Search templates…"
            aria-label="Search templates"
            aria-autocomplete="list"
            aria-controls={`${uid}cards`}
            aria-activedescendant={activeCard?.id}
            aria-describedby={coarse ? undefined : `${uid}keys`}
            autoFocus={autoFocusSearch}
          />
          {!coarse && (
            <span id={`${uid}keys`} className="sr-only">
              Up and Down choose a template. Enter opens it.
            </span>
          )}
          {/* Always mounted, so a change of text is announced (a status that mounts with
              its text is often skipped). Says what Enter will do right now. A live
              region, not role="status": the "no matches" message below is the one
              status this dialog has. */}
          <span className="sr-only" aria-live="polite" data-template-search-status="">
            {coarse
              // 0 says nothing here: the "No templates match" status below is drawn then, and speaks for it.
              ? touchSaid
              : targetName
                ? `Enter opens ${targetName}.`
                : (q ? (libraryCount > 0 ? libraryMatchWords(libraryCount) : 'No template matches. Enter does nothing.') : '')}
          </span>
          {query && (
            <button
              type="button"
              className={styles.searchClear}
              onClick={() => { setFiltered(true); setQuery('') }}
              aria-label="Clear search"
            >
              <UIcon name="x" size={12} gold={false} />
            </button>
          )}
        </div>
        <div className={styles.chipRow} role="group" aria-label="Filter templates by category">
          <button
            type="button"
            className={`${styles.chip} ${category === ALL ? styles.chipActive : ''}`}
            aria-pressed={category === ALL}
            onClick={() => { setFiltered(true); setCategory(ALL) }}
          >
            All
          </button>
          {FAMILIES.map((fam) => (
            <button
              key={fam.key}
              type="button"
              className={`${styles.chip} ${category === fam.key ? styles.chipActive : ''}`}
              aria-pressed={category === fam.key}
              onClick={() => { setFiltered(true); setCategory(fam.key) }}
            >
              {fam.label}
            </button>
          ))}
          {onPickMember && (
            <button
              type="button"
              className={`${styles.chip} ${category === MEMBER ? styles.chipActive : ''}`}
              aria-pressed={category === MEMBER}
              onClick={() => { setFiltered(true); setCategory(MEMBER) }}
            >
              Your templates
            </button>
          )}
        </div>
        {galleryOn && (
          <button
            type="button"
            ref={doorRef}
            className={styles.galleryDoor}
            onClick={() => setCommunity(true)}
            data-community-gallery-door=""
            data-tour="template-gallery-door"
          >
            <UIcon name="community" size={14} gold={false} />
            <span>Browse the community gallery</span>
          </button>
        )}
      </div>

      <button
        type="button"
        className={`${styles.card} ${styles.blankCard}`}
        onClick={() => onPick(null)}
        disabled={busy}
        data-template-card=""
        data-template-anchor=""
      >
        <span className={styles.cardLabel}>Blank note</span>
        <span className={styles.cardDesc}>An empty page — structure it your way.</span>
      </button>

      {libraryOn && (
        <Suspense fallback={null}>
          <TemplateLibrarySection query={q} category={category} busy={busy} navigate={navigate}
            onMatches={onLibraryMatches} landNote={onLandNote} />
        </Suspense>
      )}

      {showMemberSection && (
        <MemberTemplates
          onPick={onPickMember}
          busy={busy}
          query={q}
          onPreview={(p) => setPreview(p)}
          onMatches={setMemberShown}
        />
      )}

      {catalogFailed && (
        <p className={styles.emptyFilter} role="status" data-template-catalog-failed="">
          The templates could not load. Reload the page to try again; a blank note still works.
        </p>
      )}

      {noBuiltInMatches && (
        <p className={styles.emptyFilter} role="status">
          {q ? `No templates match “${query.trim()}”.` : 'No templates in this category.'}
        </p>
      )}

      {visibleFamilies.map((fam) => (
        <section key={fam.key} className={styles.family}>
          {/* Wave 8 (8A): each family's cards are a group named by its label. The label is an h3, a peer of the
              Template library's and "Your templates"' h3 (the picker's top level), so heading navigation reaches
              every family; `.famLabel` resets the heading's margin and weight, so it looks exactly as the div did. */}
          <h3 className={styles.famLabel} id={`${uid}-family-${fam.key}`}>{fam.label}</h3>
          <div className={styles.grid} role="group" aria-labelledby={`${uid}-family-${fam.key}`}>
            {fam.items.map((tpl) => {
              const id = `${uid}-tpl-${tpl.key}`
              const lines = templatePreview(tpl)
              return (
                <div key={tpl.key} className={styles.cardWrap}>
                  <button
                    type="button"
                    className={styles.card}
                    onClick={() => onPick(tpl)}
                    disabled={busy}
                    data-template-card=""
                    data-template-key={tpl.key}
                    aria-label={tpl.label}
                    aria-describedby={`${id}-when ${id}-desc`}
                  >
                    <span className={styles.cardWhen} id={`${id}-when`}>{tpl.when}</span>
                    <span className={styles.cardLabel}>{tpl.label}</span>
                    <span className={styles.cardDesc} id={`${id}-desc`}>{tpl.description}</span>
                    {lines.length > 0 && (
                      <span className={styles.cardPreview} aria-hidden="true" data-template-preview="">
                        {lines.map((line, i) => (
                          <span
                            // a preview's lines are fixed for a given template: the index is its identity
                            key={i}
                            className={`${styles.previewLine} ${styles[`preview_${line.kind}`] || ''}`}
                          >
                            {line.kind === 'bullet' ? `• ${line.text}` : line.text}
                          </span>
                        ))}
                      </span>
                    )}
                  </button>
                  {/* A sibling control, never nested in the card's own <button>
                      (a button in a button is one control to a screen reader). */}
                  <div className={styles.cardActions}>
                    <button
                      type="button"
                      className={styles.miniBtn}
                      onClick={() => openBuiltInPreview(tpl)}
                      disabled={busy}
                      aria-label={`Preview ${tpl.label}`}
                    >
                      <UIcon name="eye" size={13} gold={false} /> Preview
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      ))}

      <button
        type="button"
        className={`${styles.card} ${styles.pointerCard}`}
        onClick={() => navigate('/model-book?view=builder')}
        disabled={busy}
        data-template-card=""
        data-template-anchor=""
      >
        <span className={styles.cardLabel}>Documenting a setup?</span>
        <span className={styles.cardDesc}>
          Build it in My Playbook — annotated charts, entry criteria, linked notes. →
        </span>
      </button>

      <TemplatePreview
        open={Boolean(preview)}
        onClose={closePreview}
        title={preview?.label}
        subtitle={preview?.subtitle}
        body={preview?.body}
        onUse={preview?.onUse}
        busy={busy}
        loading={Boolean(preview?.loading)}
        loadError={preview?.loadError || null}
      />
    </div>
  )
}
