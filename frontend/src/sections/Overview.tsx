import { useApp, useReportMode } from '../components/AppContext';
import { Async, ModeBadge, Stat } from '../components/ui';
import { useResource } from '../hooks/useResource';
import { fmtDate, fmtDateTime, fmtInt, UNAVAILABLE } from '../lib/format';
import { Card } from '../components/ui';

export default function Overview() {
  const { client, refreshKey } = useApp();
  const res = useResource(() => client.overview(), [client, refreshKey]);
  useReportMode('overview', res.data?.data_mode);
  return (
    <Card id="overview" title="Overview" actions={<ModeBadge mode={res.data?.data_mode} />}>
      <Async res={res}>{(o) => (
        <div className="stats">
          <Stat label="Latest observation update" value={fmtDateTime(o.last_updated)} />
          <Stat label="Market data date" value={fmtDate(o.market_data_date)} />
          <Stat label="Data source" value={o.data_source ?? UNAVAILABLE} />
          <Stat label="Freshness" value={o.freshness.status === 'unknown' ? UNAVAILABLE : o.freshness.status}
            hint={o.freshness.age_hours != null ? `${o.freshness.age_hours.toFixed(1)} h old` : undefined}
            tone={o.freshness.status === 'fresh' ? 'ok' : o.freshness.status === 'stale' ? 'warn' : undefined} />
          <Stat label="Eligible contracts" value={fmtInt(o.eligible_contracts)} />
          <Stat label="Latest-date alerts (max 100)" value={fmtInt(o.alert_count)} hint="Statistical deviations; not trade advice" />
          <Stat label="Latest workflow" value="Not exposed by backend" hint="Submission is supported; status polling is not." />
        </div>
      )}</Async>
    </Card>
  );
}
