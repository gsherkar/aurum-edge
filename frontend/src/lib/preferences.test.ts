import { beforeEach, describe, expect, it } from 'vitest';
import { loadLocalAlertRules, loadWatchlist, saveLocalAlertRules, saveWatchlist } from './preferences';

describe('browser preferences', () => {
  beforeEach(() => window.localStorage.clear());

  it('persists watchlist symbols without duplicates', () => {
    saveWatchlist(['GOLDM', 'GOLDM', 'GOLDTEN']);
    expect(loadWatchlist()).toEqual({ symbols: ['GOLDM', 'GOLDTEN'], error: null });
  });

  it('persists valid local alert rules', () => {
    const rules = [{ id: 'rule-1', symbol: 'GOLDM', direction: 'above' as const, target: 7000 }];
    saveLocalAlertRules(rules);
    expect(loadLocalAlertRules()).toEqual({ rules, error: null });
  });

  it('rejects invalid saved preference JSON and reports the issue', () => {
    window.localStorage.setItem('aurum-edge.watchlist.v1', '{');
    expect(loadWatchlist()).toMatchObject({ symbols: [], error: expect.any(String) });
  });
});
