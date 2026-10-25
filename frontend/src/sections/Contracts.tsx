import { useApp, useReportMode } from '../components/AppContext';
import { Async, Card, ModeBadge } from '../components/ui';
import { useResource } from '../hooks/useResource';
import { fmtDate, fmtNum, UNAVAILABLE } from '../lib/format';

export default function Contracts() {
  const { client, refreshKey } = useApp();
  const res = useResource(() => client.contracts(), [client, refreshKey]);
  useReportMode('contracts', res.data?.data_mode);
  return (
    <Card id="contracts" title="Contract details" actions={<ModeBadge mode={res.data?.data_mode} />}>
      <Async res={res} isEmpty={(d) => d.contracts.length === 0} emptyText="No contract metadata available.">{(d) => (
        <div className="table-wrap"><table>
          <thead><tr><th>Symbol</th><th>Expiry</th><th>Quantity</th><th>Quotation basis</th><th>Purity</th><th>Delivery</th><th>Spec status</th><th>Eligible</th></tr></thead>
          <tbody>{d.contracts.map((c) => (
            <tr key={`${c.symbol}-${c.expiry}`}><td>{c.symbol}</td><td>{fmtDate(c.expiry)}</td>
              <td>{c.quantity == null ? UNAVAILABLE : `${fmtNum(c.quantity, 0)} ${c.quantity_unit ?? ''}`}</td>
              <td>{c.quotation_basis ?? UNAVAILABLE}</td><td>{c.purity == null ? UNAVAILABLE : `${c.purity * 100}%`}</td><td>{c.delivery_location ?? UNAVAILABLE}</td>
              <td><span className={`badge spec-${c.spec_status}`}>{c.spec_status}</span></td><td>{c.eligible == null ? UNAVAILABLE : c.eligible ? 'Yes' : 'No'}</td></tr>))}</tbody>
        </table></div>
      )}</Async>
    </Card>
  );
}
