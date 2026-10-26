import { describe, expect, it } from 'vitest';
import { createSampleFetch } from './sampleData';

describe('sample preview fixtures', () => {
  it('returns deterministic synthetic data with a sample-only source label', async () => {
    const sampleFetch = createSampleFetch();
    const first = await (await sampleFetch('/api/v1/market/observations?data_mode=synthetic')).json();
    const second = await (await sampleFetch('/api/v1/market/observations?data_mode=synthetic')).json();
    expect(first).toEqual(second);
    expect(first).toHaveLength(40);
    expect(first[0]).toMatchObject({
      data_mode: 'synthetic',
      source_name: 'Static frontend sample',
      import_id: 'frontend-sample-only',
    });

    const contracts = await (await sampleFetch('/api/v1/contracts?data_mode=synthetic')).json();
    expect(contracts.every((contract: { verification_status: string }) => contract.verification_status === 'demo-only'))
      .toBe(true);
    expect(contracts.map((contract: { symbol: string }) => contract.symbol)).toEqual([
      'DEMO_GOLD_100G', 'DEMO_GOLD_10G', 'DEMO_GOLD_8G', 'DEMO_GOLD_1G',
    ]);
    expect(contracts.map((contract: { contract_quantity: number; quotation_unit: string }) =>
      [contract.contract_quantity, contract.quotation_unit])).toEqual([
      [100, '100g'], [10, '10g'], [8, '8g'], [1, '1g'],
    ]);
    expect(first.map((row: { symbol: string }) => row.symbol).filter((symbol: string, index: number, all: string[]) =>
      all.indexOf(symbol) === index)).toEqual(contracts.map((contract: { symbol: string }) => contract.symbol));
  });

  it('does not simulate backend mutations in sample preview', async () => {
    const sampleFetch = createSampleFetch();
    const response = await sampleFetch('/api/v1/data/demo', { method: 'POST' });
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      detail: 'Sample preview does not perform backend operations.',
    });

    const nonGet = await sampleFetch('/api/v1/market/summary', { method: 'POST' });
    expect(nonGet.status).toBe(503);
  });

  it('applies requested date bounds to static backtest diagnostics', async () => {
    const response = await createSampleFetch()('/api/v1/analysis/backtest?start_date=2025-01-13');
    const body = await response.json();
    expect(body.days_evaluated).toBe(2);
    expect(body.daily_results.map((day: { data_date: string }) => day.data_date))
      .toEqual(['2025-01-13', '2025-01-14']);
    expect(body.trading_performance_claimed).toBe(false);
  });
});
