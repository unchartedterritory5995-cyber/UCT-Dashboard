// The daily prep pack's movers block (Notebook P2b, Task 10; spec §P2 item 6): the member's own names
// by the size of the move, from the cached quotes, frozen at capture. A change the server could not
// prove is "change unavailable", never 0.0%. The server reads at most MOVERS_SCAN_MAX of the member's
// names (positions first) and says so in `scanned` and `total`: when it read fewer than they hold the
// block says so under the list. An older frozen snapshot without the two keys says nothing.
import PrepCapture from './PrepCapture'
import styles from './Blocks.module.css'

const price = (i) => Number(i.price).toFixed(2)
const line = (i) => {
  if (typeof i.changePct !== 'number' || !Number.isFinite(i.changePct)) return `${i.symbol} at ${price(i)} (change unavailable)`
  return `${i.symbol} ${i.changePct < 0 ? '−' : '+'}${Math.abs(i.changePct).toFixed(1)}% at ${price(i)}`
}
const isCount = (v) => typeof v === 'number' && Number.isFinite(v)

export default function PrepMoversBlock(props) {
  return (
    <PrepCapture part="movers" {...props}>
      {(s) => (
        <>
          <ul className={styles.list} aria-label="Moves among your names">
            {(s.items || []).map((i) => <li key={i.symbol}>{line(i)}</li>)}
          </ul>
          {isCount(s.scanned) && isCount(s.total) && s.scanned < s.total && (
            <p className={styles.muted}>{`Among ${s.scanned} of your ${s.total} names.`}</p>
          )}
          {s.unquoted > 0 && <p className={styles.muted}>{`${s.unquoted} of your names had no quote.`}</p>}
        </>
      )}
    </PrepCapture>
  )
}
