import { useMemo, useState } from 'react';
import { useApp, useReportMode } from '../components/AppContext';
import { Async, Card, Empty, ModeBadge } from '../components/ui';
import { useResource } from '../hooks/useResource';
import { fmtDate, fmtNum, UNAVAILABLE } from '../lib/format';
import type { Contract } from '../api/types';

export default function Contracts() {
  const { client, refreshKey } = useApp();
  const [search, setSearch] = useState('');
  const res = useResource(() => client.contracts(), [client, refreshKey]);
  useReportMode('contracts', res.data?.data_mode);
  return (
    <Card id="contracts" title="Contract details" actions={<ModeBadge mode={res.data?.data_mode} />}>
      <Async res={res} isEmpty={(d) => d.contracts.length === 0} emptyText="No contract metadata available.">{(d) => (
        <ContractsTable contracts={d.contracts} search={search} onSearch={setSearch} />
      )}</Async>
    </Card>
  );
}

function ContractsTable({ contracts, search, onSearch }: {
  contracts: Contract[];
  search: string;
  onSearch: (value: string) => void;
}) {
  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return contracts.filter((contract) =>
      [contract.symbol, contract.expiry, contract.delivery_location]
        .some((value) => value?.toLowerCase().includes(query)),
    );
  }, [contracts, search]);
  return (
    <>
      <label htmlFor="contract-search">Search contracts</label>
      <input id="contract-search" type="search" value={search} onChange={(event) => onSearch(event.target.value)}
        placeholder="Symbol, expiry, or delivery location" />
      {visible.length === 0 ? <Empty>No contracts match “{search}”. Clear the search to see all contracts.</Empty> : (
        <div className="table-wrap"><table>
          <thead><tr><th>Symbol</th><th>Expiry</th><th>Quantity</th><th>Quotation basis</th><th>Purity</th><th>Delivery</th><th>Spec status</th><th>Eligible</th></tr></thead>
          <tbody>{visible.map((c) => (
            <tr key={`${c.symbol}-${c.expiry}`}><td>{c.symbol}</td><td>{fmtDate(c.expiry)}</td>
              <td>{c.quantity == null ? UNAVAILABLE : `${fmtNum(c.quantity, 0)} ${c.quantity_unit ?? ''}`}</td>
              <td>{c.quotation_basis ?? UNAVAILABLE}</td><td>{c.purity == null ? UNAVAILABLE : `${c.purity * 100}%`}</td><td>{c.delivery_location ?? UNAVAILABLE}</td>
              <td><span className={`badge spec-${c.spec_status}`}>{c.spec_status}</span></td><td>{c.eligible == null ? UNAVAILABLE : c.eligible ? 'Yes' : 'No'}</td></tr>))}</tbody>
        </table></div>
      )}
    </>
  );
}
