import { useEffect } from 'react';
import styles from './KeyboardHelpOverlay.module.css';
import { SHORTCUTS } from './keyboardShortcuts';


export default function KeyboardHelpOverlay({ open, onClose }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  // Group shortcuts by prefix for layout
  const groups = {
    'Timeframe': SHORTCUTS.filter(s => s.command.startsWith('tf:')),
    'Drawing tools': SHORTCUTS.filter(s => s.command.startsWith('tool:')),
    'Toggles': SHORTCUTS.filter(s => s.command.startsWith('toggle:')),
    'Replay': SHORTCUTS.filter(s => s.command.startsWith('replay:')),
    'Other': SHORTCUTS.filter(s => !s.command.includes(':')),
  };

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Keyboard shortcuts">
        <div className={styles.header}>
          <h2 className={styles.title}>Keyboard Shortcuts</h2>
          <button className={styles.close} onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className={styles.groups}>
          {Object.entries(groups).map(([groupName, items]) => (
            items.length > 0 && (
              <div key={groupName} className={styles.group}>
                <h3 className={styles.groupTitle}>{groupName}</h3>
                <ul className={styles.list}>
                  {items.map(s => (
                    <li key={s.command} className={styles.item}>
                      <kbd className={styles.kbd}>{s.keys}</kbd>
                      <span className={styles.desc}>{s.description}</span>
                    </li>
                  ))}
                </ul>
                {groupName === 'Timeframe' && (
                  <p className={styles.groupNote}>
                    Press the same key again to step through every timeframe, wrapping around.
                  </p>
                )}
              </div>
            )
          ))}
        </div>
        <div className={styles.footer}>
          <span>Press <kbd className={styles.kbd}>?</kbd> any time to show this</span>
        </div>
      </div>
    </div>
  );
}
