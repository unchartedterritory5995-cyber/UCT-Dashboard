import styles from '../MultiChart.module.css';
import { LAYOUTS } from './multiChartLayouts';


export default function LayoutPicker({ currentLayout, onChange }) {
  return (
    <div className={styles.layoutPicker}>
      {LAYOUTS.map(l => (
        <button
          key={l.id}
          className={`${styles.layoutBtn} ${currentLayout === l.id ? styles.layoutBtnActive : ''}`}
          onClick={() => onChange(l.id)}
          title={l.label}
        >
          <LayoutIcon rows={l.rows} cols={l.cols} />
          <span className={styles.layoutBtnLabel}>{l.id}</span>
        </button>
      ))}
    </div>
  );
}


function LayoutIcon({ rows, cols }) {
  const size = 18;
  const gap = 1;
  const cellW = (size - gap * (cols - 1)) / cols;
  const cellH = (size - gap * (rows - 1)) / rows;
  const cells = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      cells.push(
        <rect
          key={`${r}-${c}`}
          x={c * (cellW + gap)}
          y={r * (cellH + gap)}
          width={cellW}
          height={cellH}
          fill="currentColor"
          opacity="0.7"
        />
      );
    }
  }
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      {cells}
    </svg>
  );
}
