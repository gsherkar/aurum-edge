import { describe, expect, it } from 'vitest';
import { buildPriceTraces, rangeStartDate } from './transform';
import type { HistorySeries } from '../api/types';

const series: HistorySeries[] = [{
  symbol: 'GOLDM',
  points: [
    { date: '2025-01-01', normalized_price: 100, raw_price: 1000 },
    { date: '2025-01-08', normalized_price: null, raw_price: null },
    { date: '2025-01-15', normalized_price: 110, raw_price: 1100 },
  ],
}];

describe('historical chart transforms', () => {
  it('filters by range without filling missing observations', () => {
    const traces = buildPriceTraces(series, ['GOLDM'], '2025-01-08', '2025-01-15');
    expect(traces[0].x).toEqual(['2025-01-08', '2025-01-15']);
    expect(traces[0].y).toEqual([null, 110]);
  });

  it('derives a calendar start from the latest returned observation', () => {
    expect(rangeStartDate('2025-01-15', '1W')).toBe('2025-01-08');
    expect(rangeStartDate('2025-01-15', 'ALL')).toBeUndefined();
    expect(rangeStartDate(undefined, '1M')).toBeUndefined();
  });
});
