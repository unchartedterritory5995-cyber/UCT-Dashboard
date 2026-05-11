import { useState, useEffect } from 'react';
import styles from './CountdownTimer.module.css';


export function computeRemainingSec(barStartSec, tfSeconds, nowSec) {
  if (!barStartSec || !tfSeconds) return null;
  const elapsed = nowSec - barStartSec;
  const remaining = tfSeconds - elapsed;
  return Math.max(0, Math.floor(remaining));
}


function formatRemaining(sec) {
  if (sec == null) return '';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}


/**
 * Renders countdown to next bar close. Only renders if barStartTime + tfSeconds
 * provided and we're within the bar.
 */
export default function CountdownTimer({ barStartTime, tfSeconds, label = 'to close' }) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    if (!barStartTime || !tfSeconds) return;
    const id = setInterval(() => {
      setNow(Math.floor(Date.now() / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [barStartTime, tfSeconds]);

  const remaining = computeRemainingSec(barStartTime, tfSeconds, now);
  if (remaining === null) return null;

  return (
    <div className={styles.countdown}>
      <span className={styles.value}>{formatRemaining(remaining)}</span>
      <span className={styles.label}>{label}</span>
    </div>
  );
}
