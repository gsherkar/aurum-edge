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

  it('ignores malformed stored watchlist and alert-rule entries without discarding valid entries', () => {
    window.localStorage.setItem('aurum-edge.watchlist.v1', JSON.stringify(['GOLDM', 'invalid symbol', 7]));
    window.localStorage.setItem('aurum-edge.local-alert-rules.v1', JSON.stringify([
      { id: 'rule-1', symbol: 'GOLDM', direction: 'above', target: 7000 },
      { id: 'bad-rule', symbol: 'GOLDM', direction: 'sideways', target: -1 },
    ]));
    expect(loadWatchlist()).toEqual({ symbols: ['GOLDM'], error: null });
    expect(loadLocalAlertRules()).toEqual({
      rules: [{ id: 'rule-1', symbol: 'GOLDM', direction: 'above', target: 7000 }],
      error: null,
    });
  });
});
