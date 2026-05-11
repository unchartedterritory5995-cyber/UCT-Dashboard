import { useCallback } from 'react';
import StockChart from '../../components/StockChart';
import SymbolSearch from '../../components/chart/SymbolSearch';
import { useMultiChartSync } from './MultiChartSyncContext';
import styles from '../MultiChart.module.css';


const TFS = ['1', '5', '15', '30', '60', 'D', 'W', 'M'];
const TF_LABELS = { '1': '1m', '5': '5m', '15': '15m', '30': '30m', '60': '1h', D: 'D', W: 'W', M: 'M' };


export default function MultiChartCell({ cell, onChange, onRemove, canRemove }) {
  const sync = useMultiChartSync();

  const handleSymbolChange = useCallback((sym) => {
    onChange({ ...cell, sym });
  }, [cell, onChange]);

  const handleTfChange = useCallback((tf) => {
    onChange({ ...cell, tf });
  }, [cell, onChange]);

  const handleCrosshairMove = useCallback((payload) => {
    sync?.reportCrosshair(payload);
  }, [sync]);

  const handleTimeRangeChange = useCallback((payload) => {
    sync?.reportTimeRange(payload);
  }, [sync]);

  return (
    <div className={styles.cell}>
      <div className={styles.cellHeader}>
        <SymbolSearch
          sym={cell.sym}
          onSymbolChange={handleSymbolChange}
          className={styles.cellSymbol}
        />
        <select
          value={cell.tf}
          onChange={(e) => handleTfChange(e.target.value)}
          className={styles.cellTfSelect}
        >
          {TFS.map(tf => (
            <option key={tf} value={tf}>{TF_LABELS[tf]}</option>
          ))}
        </select>
        {canRemove && (
          <button
            onClick={onRemove}
            className={styles.cellRemove}
            title="Remove cell"
            aria-label="Remove cell"
          >
            ×
          </button>
        )}
      </div>
      <div className={styles.cellChart}>
        <StockChart
          sym={cell.sym}
          tf={cell.tf}
          onSymbolChange={handleSymbolChange}
          onTfChange={handleTfChange}
          onCrosshairMove={handleCrosshairMove}
          onTimeRangeChange={handleTimeRangeChange}
          externalCrosshair={sync?.crosshair}
          externalTimeRange={sync?.timeRange}
        />
      </div>
    </div>
  );
}
