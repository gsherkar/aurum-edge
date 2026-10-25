import { useState } from 'react';
import { useApp } from '../components/AppContext';
import { Async, Card } from '../components/ui';
import { useResource } from '../hooks/useResource';
import { fmtDateTime } from '../lib/format';

export default function Workflow() {
  const { client, refreshKey, refreshAll } = useApp();
  const imports = useResource(() => client.imports(), [client, refreshKey]);
  const [importId, setImportId] = useState('');
  const [triggering, setTriggering] = useState(false);
  const [message, setMessage] = useState<{ kind: 'note' | 'error'; text: string } | null>(null);
  async function submit() {
    if (!importId || triggering) return;
    setTriggering(true);
    setMessage(null);
    try {
      const response = await client.workflow(importId);
      setMessage({
        kind: 'note',
        text: `Workflow submitted for import ${response.import_id}. Task run ID: ${response.task_run_id} (${response.task_slug}). This backend does not expose a workflow-status endpoint, so completion cannot be monitored here.`,
      });
      refreshAll();
    } catch (error) {
      setMessage({ kind: 'error', text: `Could not submit workflow: ${error instanceof Error ? error.message : String(error)}` });
    } finally {
      setTriggering(false);
    }
  }
  return (
    <Card id="workflow" title="Render workflow submission">
      <p className="note">Submit a specific import to the configured Render task. This frontend can report that the task was accepted, but the available backend API does not provide task status or completion polling.</p>
      {message && <p className={message.kind === 'error' ? 'error' : 'note ok'} role="status">{message.text}</p>}
      <Async res={imports}>{(items) => {
        return (
          <div className="upload">
            <label htmlFor="workflow-import">Import to process</label>
            <select id="workflow-import" value={importId} onChange={(event) => setImportId(event.target.value)}>
              <option value="">Select a backend import</option>
              {items.map((item) => (
                <option key={item.import_id} value={item.import_id}>
                  {item.import_id} — {item.source_name} ({item.status}, {fmtDateTime(item.last_updated)})
                </option>
              ))}
            </select>
            <button className="btn primary" onClick={submit} disabled={!importId || triggering} aria-busy={triggering}>
              {triggering ? 'Submitting…' : 'Submit workflow'}
            </button>
            {items.length === 0 && <p className="empty">There are no available imports to submit.</p>}
          </div>
        );
      }}</Async>
    </Card>
  );
}
