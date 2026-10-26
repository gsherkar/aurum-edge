import { useRef, useState } from 'react';
import { useApp, useReportMode } from '../components/AppContext';
import { Async, Card, ModeBadge, Stat } from '../components/ui';
import { useResource } from '../hooks/useResource';
import { fmtDate, fmtDateTime, fmtInt, UNAVAILABLE } from '../lib/format';
import type { UploadResult } from '../api/types';

function Upload() {
  const { client, refreshAll } = useApp();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [hasFile, setHasFile] = useState(false);
  const [dataDate, setDataDate] = useState('');
  const [columnMapping, setColumnMapping] = useState('');
  const [result, setResult] = useState<UploadResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  async function submit() {
    const file = input.current?.files?.[0];
    if (!file || busy) return;
    setBusy(true);
    setErr(null);
    setResult(null);
    try {
      const response = await client.upload(file, {
        dataDate: dataDate || undefined,
        columnMapping: columnMapping.trim() || undefined,
      });
      setResult(response);
      refreshAll();
    } catch (error) {
      setErr(error instanceof Error ? error.message : 'The file could not be imported.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="upload">
      <label htmlFor="market-file">MCX data file (CSV, TXT, XLS, XLSX)</label>
      <input id="market-file" type="file" ref={input} accept=".csv,.txt,.xls,.xlsx"
        onChange={(event) => setHasFile(Boolean(event.currentTarget.files?.length))} />
      <label htmlFor="import-date">Data date (only if file has no date column)</label>
      <input id="import-date" type="date" value={dataDate} onChange={(event) => setDataDate(event.target.value)} />
      <label htmlFor="column-mapping">Column mapping JSON (optional)</label>
      <input id="column-mapping" type="text" value={columnMapping} placeholder='{"symbol":"Symbol","close":"Close"}'
        onChange={(event) => setColumnMapping(event.target.value)} />
      <button className="btn" onClick={submit} disabled={busy || !hasFile}>
        {busy ? 'Uploading…' : 'Import file'}
      </button>
      {err && <p className="error" role="alert">{err}</p>}
      {result && (
        <div className="note" role="status">
          <strong>Import {result.status}</strong> · ID: <code>{result.import_id}</code>
          {result.duplicate_upload && ' · This file was already imported.'}
          {result.summary.valid_rows != null && ` · ${fmtInt(result.summary.valid_rows)} valid rows`}
          {result.task_run_id && ` · Workflow task ${result.task_run_id} submitted`}
          {result.provenance_note && <p>{result.provenance_note}</p>}
        </div>
      )}
    </div>
  );
}

function CreateDemoData() {
  const { client, refreshAll, setDataMode } = useApp();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function create() {
    if (busy) return;
    setBusy(true);
    setMessage('');
    try {
      const result = await client.createDemoData();
      setDataMode('synthetic');
      setMessage(`Synthetic dataset created by the backend (${result.import_id}). These are not live prices.`);
      refreshAll();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not create backend synthetic data.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="upload">
      <button className="btn" onClick={create} disabled={busy}>{busy ? 'Creating…' : 'Create synthetic demo dataset'}</button>
      {message && <p className={message.startsWith('Synthetic dataset') ? 'note warn' : 'error'} role="status">{message}</p>}
    </div>
  );
}

export default function DataStatus() {
  const { client, refreshKey, dataMode, sampleMode } = useApp();
  const res = useResource(() => client.dataStatus(), [client, refreshKey]);
  useReportMode('data', res.data?.data_mode);
  return (
    <Card id="data" title="Data status" actions={<ModeBadge mode={res.data?.data_mode} />}>
      <Async res={res}>{(data) => (
        <>
          {dataMode === 'synthetic' && <p className="note warn">Synthetic backend data selected; values are demonstration data, not live MCX market data.</p>}
          {sampleMode && <p className="note warn">Sample preview data is bundled with the frontend for UI testing. No files are sent or processed in this mode.</p>}
          {data.data_mode === 'unknown' && <p className="note">No observations are available for the selected dataset.</p>}
          <div className="stats">
            <Stat label="Latest data date" value={fmtDate(data.latest_data_date)} />
            <Stat label="Source" value={data.source ?? UNAVAILABLE} />
            <Stat label="Last import" value={fmtDateTime(data.last_import_at)} />
            <Stat label="Validation" value={data.validation_status === 'unknown' ? UNAVAILABLE : data.validation_status}
              tone={data.validation_status === 'valid' ? 'ok' : data.validation_status === 'invalid' ? 'bad' : data.validation_status === 'warnings' ? 'warn' : undefined} />
            <Stat label="Valid records" value={fmtInt(data.records_imported)} />
          </div>
          {data.warnings.length > 0 && <ul className="warn-list">{data.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>}
          {sampleMode
            ? <p className="note">File upload and dataset creation require the backend and are disabled in this preview.</p>
            : data.upload_supported ? <Upload /> : <p className="note">File import is not enabled on this backend.</p>}
          {!sampleMode && <CreateDemoData />}
          <h3>Recent imports</h3>
          {data.imports.length === 0 ? <p className="empty">No file or synthetic-data imports have been recorded.</p> : (
            <div className="table-wrap"><table>
              <thead><tr><th>Import ID</th><th>Source</th><th>Dataset</th><th>Status</th><th>Updated</th><th>Valid rows</th></tr></thead>
              <tbody>{data.imports.map((item) => (
                <tr key={item.import_id}>
                  <td><code>{item.import_id}</code></td><td>{item.source_name}</td><td>{item.data_mode === 'synthetic' ? 'Synthetic' : 'Uploaded historical'}</td>
                  <td>{item.status}</td><td>{fmtDateTime(item.last_updated)}</td><td>{fmtInt(item.summary.valid_rows)}</td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </>
      )}</Async>
    </Card>
  );
}
