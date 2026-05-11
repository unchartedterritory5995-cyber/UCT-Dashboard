import { describe, it, expect } from 'vitest';
import { chartStateToUrl, urlToChartState } from './chartScreenshot';


describe('chartStateToUrl / urlToChartState', () => {
  it('encodes and decodes a basic chart state', () => {
    const state = {
      sym: 'AAPL',
      tf: 'D',
      chartType: 'candles',
      heikinAshi: false,
      logScale: false,
      indicators: { rsi: { enabled: true, period: 14 } },
      comparisonSymbols: [{ sym: 'QQQ', color: '#60a5fa', enabled: true }],
    };
    const url = chartStateToUrl(state);
    expect(typeof url).toBe('string');
    expect(url.length).toBeGreaterThan(0);
    const decoded = urlToChartState(url);
    expect(decoded).toEqual(state);
  });

  it('returns empty string for null state', () => {
    expect(chartStateToUrl(null)).toBe('');
    expect(chartStateToUrl(undefined)).toBe('');
  });

  it('returns null for invalid base64', () => {
    expect(urlToChartState('not-valid-base64-!@#$')).toBe(null);
  });

  it('returns null for valid base64 that is not valid JSON', () => {
    const garbage = btoa('not json');
    expect(urlToChartState(garbage)).toBe(null);
  });

  it('handles empty object', () => {
    const url = chartStateToUrl({});
    expect(urlToChartState(url)).toEqual({});
  });

  it('URL-safe encoding (no +/= chars)', () => {
    const state = { sym: 'AAPL', tf: 'D' };
    const url = chartStateToUrl(state);
    expect(url.includes('+')).toBe(false);
    expect(url.includes('/')).toBe(false);
    expect(url.includes('=')).toBe(false);
  });

  it('roundtrips with all 8 timeframes', () => {
    for (const tf of ['1', '5', '15', '30', '60', 'D', 'W', 'M']) {
      const state = { sym: 'AAPL', tf };
      expect(urlToChartState(chartStateToUrl(state)).tf).toBe(tf);
    }
  });

  it('preserves array order in comparisonSymbols', () => {
    const state = {
      comparisonSymbols: [
        { sym: 'QQQ', color: '#60a5fa', enabled: true },
        { sym: 'SPY', color: '#f472b6', enabled: false },
        { sym: 'IWM', color: '#34d399', enabled: true },
      ],
    };
    const decoded = urlToChartState(chartStateToUrl(state));
    expect(decoded.comparisonSymbols.map(c => c.sym)).toEqual(['QQQ', 'SPY', 'IWM']);
  });
});
