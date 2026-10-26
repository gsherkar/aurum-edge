import type { ConsensusContract, HistorySeries } from '../api/types';

export type ChartRange = '1D' | '1W' | '1M' | '3M' | '6M' | '1Y' | 'ALL';

const RANGE_DAYS: Record<Exclude<ChartRange, 'ALL'>, number> = {
  '1D': 0,
  '1W': 7,
  '1M': 30,
  '3M': 90,
  '6M': 180,
  '1Y': 365,
};

export function sortByAbsZ<T extends Pick<ConsensusContract, 'zscore'>>(contracts: readonly T[]): T[] {
  return [...contracts].sort((a, b) => {
    const aScore = a.zscore == null || !Number.isFinite(a.zscore) ? -1 : Math.abs(a.zscore);
    const bScore = b.zscore == null || !Number.isFinite(b.zscore) ? -1 : Math.abs(b.zscore);
    return bScore - aScore;
  });
}

export function dateBounds(series: readonly HistorySeries[]): { min: string | undefined; max: string | undefined } {
  const dates = series.flatMap((item) => item.points.map((point) => point.date).filter(Boolean)).sort();
  return { min: dates[0], max: dates[dates.length - 1] };
}

export function rangeStartDate(latestDate: string | undefined, range: ChartRange): string | undefined {
  if (!latestDate || range === 'ALL') return undefined;
  const date = new Date(`${latestDate}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return undefined;
  date.setUTCDate(date.getUTCDate() - RANGE_DAYS[range]);
  return date.toISOString().slice(0, 10);
}

export function buildPriceTraces(
  series: readonly HistorySeries[],
  selectedSymbols: readonly string[],
  start?: string,
  end?: string,
): { name: string; x: string[]; y: (number | null)[] }[] {
  const selected = new Set(selectedSymbols);
  return series
    .filter((item) => selected.has(item.symbol))
    .map((item) => {
      const points = item.points
        .filter((point) => (!start || point.date >= start) && (!end || point.date <= end))
        .slice()
        .sort((a, b) => a.date.localeCompare(b.date));
      return {
        name: item.symbol,
        x: points.map((point) => point.date),
        y: points.map((point) => point.normalized_price),
      };
    });
}

export function countMissing(traces: readonly { y: readonly (number | null)[] }[]): number {
  return traces.reduce((count, trace) => count + trace.y.filter((value) => value == null).length, 0);
}
