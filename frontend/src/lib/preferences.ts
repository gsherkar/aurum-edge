const WATCHLIST_KEY = 'aurum-edge.watchlist.v1';
const ALERT_RULES_KEY = 'aurum-edge.local-alert-rules.v1';

export interface LocalAlertRule {
  id: string;
  symbol: string;
  direction: 'above' | 'below';
  target: number;
}

function readArray<T>(key: string, isItem: (value: unknown) => value is T): { values: T[]; error: string | null } {
  try {
    const stored = window.localStorage.getItem(key);
    if (!stored) return { values: [], error: null };
    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed)) throw new Error('Saved preference data has an invalid format.');
    return { values: parsed.filter(isItem), error: null };
  } catch (error) {
    return {
      values: [],
      error: error instanceof Error ? error.message : 'Could not read saved preferences.',
    };
  }
}

export function loadWatchlist(): { symbols: string[]; error: string | null } {
  const result = readArray<string>(WATCHLIST_KEY, (value): value is string =>
    typeof value === 'string' && /^[A-Z0-9._-]{1,32}$/.test(value),
  );
  return { symbols: result.values, error: result.error };
}

export function saveWatchlist(symbols: string[]): void {
  window.localStorage.setItem(WATCHLIST_KEY, JSON.stringify([...new Set(symbols)]));
}

function isLocalAlertRule(value: unknown): value is LocalAlertRule {
  if (!value || typeof value !== 'object') return false;
  const rule = value as Partial<LocalAlertRule>;
  return typeof rule.id === 'string'
    && typeof rule.symbol === 'string'
    && /^[A-Z0-9._-]{1,32}$/.test(rule.symbol)
    && (rule.direction === 'above' || rule.direction === 'below')
    && typeof rule.target === 'number'
    && Number.isFinite(rule.target)
    && rule.target > 0;
}

export function loadLocalAlertRules(): { rules: LocalAlertRule[]; error: string | null } {
  const result = readArray<LocalAlertRule>(ALERT_RULES_KEY, isLocalAlertRule);
  return { rules: result.values, error: result.error };
}

export function saveLocalAlertRules(rules: LocalAlertRule[]): void {
  window.localStorage.setItem(ALERT_RULES_KEY, JSON.stringify(rules));
}
