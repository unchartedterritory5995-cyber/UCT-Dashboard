// components/notebook/SetupsBox.jsx -- Research Home's Active setups box (P0.5, owner decision,
// 2026-10-11). The board's one door used to be a bare link at the very bottom of the page; it is now
// a box straight under the Notices box that says how many plans are open and links to the board.
//
// ⛔ A link and one read, never the board page: Research Home is on the Notebook's first-open path
// and the board carries charts. The only things shared with the page are the URL and the path
// (lib/setupsBoardLink.js, one authority for each).
//
// The count comes from the board's own read. Examples are not the member's setups, so they are not
// counted (the server marks `example`; the client never infers it). A read that fails (a 500, a
// dropped connection, a body that is not JSON) resolves to null and the box says only "Active
// setups" with its link: the door must not vanish, and the start screen must not show an error,
// because a count could not be read. The key carries a tag so this entry is NOT the board page's
// bare-URL entry: that page's fetcher throws on a failure and this one answers null, and one answer
// under one key would hand the page the other's shape.
//
// Renders nothing at all while notebook_setups_board_enabled is off (the page is then the page it
// was; ResearchHome.setupsDoor.test.jsx compares the two renders) and nothing is fetched. Research
// Home renders it only in the states a member who has notes can land on.
import { useId } from 'react'
import useSWR from 'swr'
import { Link } from 'react-router-dom'
import { BOARD_URL, SETUPS_BOARD_PATH, setupsBoardEnabled } from '../../lib/setupsBoardLink'
import styles from './SetupsBox.module.css'

const SWR_ONCE = Object.freeze({ revalidateOnFocus: false, shouldRetryOnError: false })

const getBoardJson = async (url) => {
  try {
    const r = await fetch(url, { credentials: 'include' })
    return r.ok ? await r.json() : null
  } catch {
    return null
  }
}

/** The box's one line. No count while unknown or unreadable: none is better than a wrong one. */
function lineFor(board) {
  const open = Array.isArray(board?.cards) ? board.cards.filter((c) => !c.example).length : null
  if (open == null) return 'Active setups'
  return open === 0 ? 'Active setups · none open' : `Active setups · ${open} open`
}

export default function SetupsBox() {
  const on = setupsBoardEnabled()
  const descId = useId()
  const { data } = useSWR(on ? [BOARD_URL, 'open-count'] : null, ([url]) => getBoardJson(url), SWR_ONCE)
  if (!on) return null
  return (
    <div className={styles.box} data-tour="home-setups" data-export-exclude>
      <span className={styles.count}>{lineFor(data)}</span>
      <Link className={`btn btn-ghost ${styles.setupsLink}`} to={SETUPS_BOARD_PATH} aria-describedby={descId}>
        Open the setups board
      </Link>
      {/* The old link's title sentence, now read as the link's description. */}
      <span id={descId} className={styles.srOnly}>Your open chart plans, closest to their entry first</span>
    </div>
  )
}
