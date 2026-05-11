import { useState } from 'react';
import styles from './ScreenshotPopover.module.css';


export default function ScreenshotPopover({ onDownload, onCopy, onShare, onClose }) {
  const [status, setStatus] = useState('');  // 'copied', 'shared', 'copy-failed'

  async function handleCopy() {
    setStatus('copying');
    const ok = await onCopy();
    setStatus(ok ? 'copied' : 'copy-failed');
    setTimeout(() => setStatus(''), 2000);
  }

  function handleShare() {
    onShare();  // expected to copy URL to clipboard internally
    setStatus('shared');
    setTimeout(() => setStatus(''), 2000);
  }

  function handleDownload() {
    onDownload();
    setStatus('downloaded');
    setTimeout(() => setStatus(''), 2000);
  }

  return (
    <div className={styles.popover}>
      <div className={styles.header}>
        <span className={styles.title}>Share Chart</span>
        <button className={styles.close} onClick={onClose} aria-label="Close">×</button>
      </div>

      <div className={styles.actions}>
        <button className={styles.action} onClick={handleDownload}>
          <span className={styles.icon}>⬇</span>
          <span>Download PNG</span>
        </button>
        <button className={styles.action} onClick={handleCopy}>
          <span className={styles.icon}>⎘</span>
          <span>Copy to Clipboard</span>
        </button>
        <button className={styles.action} onClick={handleShare}>
          <span className={styles.icon}>🔗</span>
          <span>Copy Share URL</span>
        </button>
      </div>

      {status === 'copied' && <div className={styles.status}>Image copied ✓</div>}
      {status === 'shared' && <div className={styles.status}>URL copied ✓</div>}
      {status === 'downloaded' && <div className={styles.status}>Downloaded ✓</div>}
      {status === 'copy-failed' && <div className={styles.statusError}>Clipboard unavailable</div>}
      {status === 'copying' && <div className={styles.status}>Working...</div>}
    </div>
  );
}
