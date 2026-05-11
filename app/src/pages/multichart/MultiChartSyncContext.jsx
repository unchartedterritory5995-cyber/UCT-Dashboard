import { createContext, useContext, useState, useCallback } from 'react';

const MultiChartSyncContext = createContext(null);


export function MultiChartSyncProvider({ children, syncCrosshair, syncTimeRange }) {
  const [crosshair, setCrosshair] = useState(null);  // { time, price } | null
  const [timeRange, setTimeRange] = useState(null);  // { from, to } | null

  // Each chart cell reports its crosshair when it moves; if sync is enabled, all
  // other cells render an external crosshair at that time.
  const reportCrosshair = useCallback((payload) => {
    if (!syncCrosshair) return;
    setCrosshair(payload);
  }, [syncCrosshair]);

  const reportTimeRange = useCallback((payload) => {
    if (!syncTimeRange) return;
    setTimeRange(payload);
  }, [syncTimeRange]);

  const value = {
    crosshair: syncCrosshair ? crosshair : null,
    timeRange: syncTimeRange ? timeRange : null,
    reportCrosshair,
    reportTimeRange,
  };

  return (
    <MultiChartSyncContext.Provider value={value}>
      {children}
    </MultiChartSyncContext.Provider>
  );
}


export function useMultiChartSync() {
  return useContext(MultiChartSyncContext);
}
