import '@src/NewTab.css';
import '@src/NewTab.scss';
import { useMemo, useState } from 'react';

type HarEntry = {
  startedDateTime?: string;
  request?: {
    method?: string;
    url?: string;
  };
  response?: {
    status?: number;
    content?: {
      text?: string;
      mimeType?: string;
    };
  };
};

type HarLog = {
  log?: {
    entries?: HarEntry[];
  };
};

type Snapshot = {
  id: string;
  label: string;
  source: 'har' | 'json';
  timestamp?: string;
  url?: string;
  fields: Record<string, unknown>;
  raw: Record<string, unknown>;
};

type TimelineRow = {
  id: string;
  timestamp: string;
  method: string;
  url: string;
  status: number;
  fieldSummary: string[];
  flags: string[];
  snapshots: Snapshot[];
};

const SIGNAL_FIELDS = [
  'bid',
  'ask',
  'mark',
  'last',
  'liquidationPrice',
  'marginPercent',
  'leverage',
  'fees',
  'price',
  'risk',
  'priceSource',
  'source',
  'orderType',
  'type',
];

const SAFE_FIELD_SET = new Set(SIGNAL_FIELDS);

const parseJsonSafe = (text: string | undefined): Record<string, unknown> | null => {
  if (!text) return null;
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
};

const collectSnapshots = (value: unknown, baseLabel: string, source: Snapshot['source']): Snapshot[] => {
  const snapshots: Snapshot[] = [];
  const visit = (node: unknown, path: string[]) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach((item, index) => visit(item, [...path, `[${index}]`]));
      return;
    }
    const record = node as Record<string, unknown>;
    const keys = Object.keys(record);
    const hasSignal = keys.some((key) => SAFE_FIELD_SET.has(key));
    if (hasSignal) {
      const fields: Record<string, unknown> = {};
      keys.forEach((key) => {
        if (SAFE_FIELD_SET.has(key)) {
          fields[key] = record[key];
        }
      });
      snapshots.push({
        id: `${source}-${baseLabel}-${path.join('.') || 'root'}-${snapshots.length}`,
        label: `${baseLabel}${path.length ? ` • ${path.join('.')}` : ''}`,
        source,
        fields,
        raw: record,
      });
    }
    keys.forEach((key) => visit(record[key], [...path, key]));
  };
  visit(value, []);
  return snapshots;
};

const toDisplayValue = (value: unknown) => {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'number') return value.toLocaleString();
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return `[${value.length} items]`;
  return 'Object';
};

const formatTimestamp = (timestamp?: string) => {
  if (!timestamp) return 'Unknown';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp;
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
};

const buildFlags = (snapshot: Snapshot, previous?: Snapshot) => {
  const flags: string[] = [];
  const priceSource = snapshot.fields.priceSource ?? snapshot.fields.source;
  const alternateSource = snapshot.fields.source ?? snapshot.fields.priceSource;
  if (priceSource && alternateSource && priceSource !== alternateSource) {
    flags.push('Price source mismatch');
  }
  const liquidationPrice = snapshot.fields.liquidationPrice;
  const markPrice = snapshot.fields.mark ?? snapshot.fields.last ?? snapshot.fields.price;
  if (typeof liquidationPrice === 'number' && typeof markPrice === 'number') {
    const ratio = liquidationPrice === 0 ? 0 : Math.abs(liquidationPrice - markPrice) / liquidationPrice;
    if (ratio > 0.2) {
      flags.push('Liquidation mismatch');
    }
  }
  const orderType = snapshot.fields.orderType ?? snapshot.fields.type;
  const previousOrderType = previous?.fields.orderType ?? previous?.fields.type;
  if (orderType && previousOrderType && orderType !== previousOrderType) {
    flags.push('Order type mismatch');
  }
  const previousSource = previous?.fields.priceSource ?? previous?.fields.source;
  if (priceSource && previousSource && priceSource !== previousSource) {
    flags.push('Price source mismatch');
  }
  const previousLiquidation = previous?.fields.liquidationPrice;
  if (typeof previousLiquidation === 'number' && typeof liquidationPrice === 'number') {
    const ratio = previousLiquidation === 0 ? 0 : Math.abs(previousLiquidation - liquidationPrice) / previousLiquidation;
    if (ratio > 0.2) {
      flags.push('Liquidation mismatch');
    }
  }
  return [...new Set(flags)];
};

const NewTab = () => {
  const [harFileName, setHarFileName] = useState<string>('');
  const [harEntries, setHarEntries] = useState<TimelineRow[]>([]);
  const [harError, setHarError] = useState<string>('');
  const [referenceSnapshot, setReferenceSnapshot] = useState<Snapshot | null>(null);
  const [referenceError, setReferenceError] = useState<string>('');
  const [beforeId, setBeforeId] = useState<string>('');
  const [afterId, setAfterId] = useState<string>('');

  const snapshotOptions = useMemo(() => {
    const flattened = harEntries.flatMap((entry) => entry.snapshots);
    const list = referenceSnapshot ? [referenceSnapshot, ...flattened] : flattened;
    return list;
  }, [harEntries, referenceSnapshot]);

  const selectedBefore = snapshotOptions.find((snapshot) => snapshot.id === beforeId) ?? null;
  const selectedAfter = snapshotOptions.find((snapshot) => snapshot.id === afterId) ?? null;

  const compareFields = useMemo(() => {
    const keys = new Set<string>();
    [selectedBefore?.fields, selectedAfter?.fields].forEach((fields) => {
      if (!fields) return;
      Object.keys(fields).forEach((key) => keys.add(key));
    });
    return Array.from(keys);
  }, [selectedBefore, selectedAfter]);

  const handleHarUpload = async (file: File | null) => {
    if (!file) return;
    setHarFileName(file.name);
    setHarError('');
    try {
      const text = await file.text();
      const data = JSON.parse(text) as HarLog;
      const entries = data?.log?.entries ?? [];
      const timeline: TimelineRow[] = [];
      let previousSnapshot: Snapshot | undefined;

      entries.forEach((entry, index) => {
        const responseText = entry.response?.content?.text;
        const payload = parseJsonSafe(responseText);
        if (!payload) return;
        const baseLabel = `${entry.request?.method ?? 'GET'} ${entry.request?.url ?? 'Unknown URL'}`;
        const snapshots = collectSnapshots(payload, baseLabel, 'har').map((snapshot) => ({
          ...snapshot,
          timestamp: entry.startedDateTime,
          url: entry.request?.url,
        }));
        if (snapshots.length === 0) return;
        const currentSnapshot = snapshots[0];
        const flags = buildFlags(currentSnapshot, previousSnapshot);
        previousSnapshot = currentSnapshot;
        const fieldSummary = Array.from(
          new Set(snapshots.flatMap((snapshot) => Object.keys(snapshot.fields))),
        ).sort();

        timeline.push({
          id: `entry-${index}`,
          timestamp: formatTimestamp(entry.startedDateTime),
          method: entry.request?.method ?? 'GET',
          url: entry.request?.url ?? 'Unknown URL',
          status: entry.response?.status ?? 0,
          fieldSummary,
          flags,
          snapshots,
        });
      });
      setHarEntries(timeline);
      if (timeline.length) {
        const firstSnapshot = timeline[0].snapshots[0];
        const lastSnapshot = timeline[timeline.length - 1].snapshots[0];
        setBeforeId(firstSnapshot.id);
        setAfterId(lastSnapshot.id);
      }
    } catch (error) {
      setHarError('Unable to parse HAR. Please confirm the file is valid JSON.');
      setHarEntries([]);
    }
  };

  const handleJsonUpload = async (file: File | null) => {
    if (!file) return;
    setReferenceError('');
    try {
      const text = await file.text();
      const data = JSON.parse(text) as Record<string, unknown>;
      const snapshots = collectSnapshots(data, `Reference JSON: ${file.name}`, 'json');
      const snapshot = snapshots[0] ?? {
        id: `json-${file.name}`,
        label: `Reference JSON: ${file.name}`,
        source: 'json',
        fields: {},
        raw: data,
      };
      setReferenceSnapshot(snapshot);
      setBeforeId(snapshot.id);
    } catch (error) {
      setReferenceError('Unable to parse JSON. Please confirm the file is valid.');
      setReferenceSnapshot(null);
    }
  };

  const exportReport = () => {
    const report = {
      generatedAt: new Date().toISOString(),
      harFile: harFileName || null,
      totals: {
        entries: harEntries.length,
        flaggedEntries: harEntries.filter((entry) => entry.flags.length > 0).length,
      },
      timeline: harEntries.map((entry) => ({
        timestamp: entry.timestamp,
        method: entry.method,
        url: entry.url,
        status: entry.status,
        fields: entry.fieldSummary,
        flags: entry.flags,
      })),
      snapshots: snapshotOptions.map((snapshot) => ({
        id: snapshot.id,
        label: snapshot.label,
        source: snapshot.source,
        timestamp: snapshot.timestamp,
        url: snapshot.url,
        fields: snapshot.fields,
      })),
    };

    const textReport = [
      'Exchange Consistency Monitor Viewer Report',
      `Generated: ${new Date().toLocaleString()}`,
      `HAR File: ${harFileName || 'None'}`,
      `Entries: ${harEntries.length}`,
      `Flagged Entries: ${harEntries.filter((entry) => entry.flags.length > 0).length}`,
      '',
      'Timeline',
      ...harEntries.map((entry) => {
        const flags = entry.flags.length ? ` Flags: ${entry.flags.join(', ')}` : '';
        return `• ${entry.timestamp} ${entry.method} ${entry.url} [${entry.status}] Fields: ${entry.fieldSummary.join(', ')}${flags}`;
      }),
      '',
      'Snapshot Compare',
      `Before: ${selectedBefore?.label ?? 'None'}`,
      `After: ${selectedAfter?.label ?? 'None'}`,
      ...compareFields.map((field) => {
        return `- ${field}: ${toDisplayValue(selectedBefore?.fields[field])} → ${toDisplayValue(
          selectedAfter?.fields[field],
        )}`;
      }),
    ].join('\n');

    const download = (content: string, filename: string, type: string) => {
      const blob = new Blob([content], { type });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
    };

    download(JSON.stringify(report, null, 2), 'exchange-consistency-report.json', 'application/json');
    download(textReport, 'exchange-consistency-report.txt', 'text/plain');
  };

  return (
    <div className="ecm-app">
      <header className="ecm-hero">
        <div>
          <p className="ecm-kicker">Exchange Consistency Monitor Viewer</p>
          <h1>HAR-driven pricing consistency analysis</h1>
          <p className="ecm-subtitle">
            Upload a HAR log and optional reference JSON to detect price/risk fields, compare snapshots, and export
            a compliance report.
          </p>
        </div>
        <div className="ecm-actions">
          <button className="ecm-primary" onClick={exportReport} disabled={!harEntries.length}>
            Export Report
          </button>
          <div className="ecm-meta">
            {harEntries.length ? `${harEntries.length} timeline entries` : 'No HAR loaded'}
          </div>
        </div>
      </header>

      <section className="ecm-card">
        <h2>Upload Inputs</h2>
        <div className="ecm-grid">
          <label className="ecm-upload">
            <span>HAR File</span>
            <input
              type="file"
              accept=".har,application/json"
              onChange={(event) => handleHarUpload(event.target.files?.[0] ?? null)}
            />
            <small>{harFileName ? `Loaded: ${harFileName}` : 'Select a HAR file to analyze network entries.'}</small>
            {harError && <div className="ecm-error">{harError}</div>}
          </label>
          <label className="ecm-upload">
            <span>Reference JSON</span>
            <input
              type="file"
              accept="application/json"
              onChange={(event) => handleJsonUpload(event.target.files?.[0] ?? null)}
            />
            <small>Use a baseline JSON snapshot for before/after comparison.</small>
            {referenceError && <div className="ecm-error">{referenceError}</div>}
          </label>
        </div>
      </section>

      <section className="ecm-card">
        <div className="ecm-section-header">
          <h2>Timeline Table</h2>
          <p>Detected responses containing bid/ask/mark/last/liquidation/fees fields.</p>
        </div>
        <div className="ecm-table">
          <div className="ecm-table-row ecm-table-head">
            <span>Timestamp</span>
            <span>Request</span>
            <span>Status</span>
            <span>Fields</span>
            <span>Rules</span>
          </div>
          {harEntries.length === 0 ? (
            <div className="ecm-empty">No entries detected yet.</div>
          ) : (
            harEntries.map((entry) => (
              <div key={entry.id} className="ecm-table-row">
                <span>{entry.timestamp}</span>
                <span>
                  <strong>{entry.method}</strong> {entry.url}
                </span>
                <span>{entry.status}</span>
                <span>{entry.fieldSummary.join(', ') || '—'}</span>
                <span>{entry.flags.length ? entry.flags.join(', ') : '—'}</span>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="ecm-card">
        <div className="ecm-section-header">
          <h2>Before / After Snapshot Compare</h2>
          <p>Select two snapshots to compare key price and risk fields.</p>
        </div>
        <div className="ecm-grid ecm-compare-controls">
          <label>
            <span>Before</span>
            <select value={beforeId} onChange={(event) => setBeforeId(event.target.value)}>
              <option value="">Select snapshot</option>
              {snapshotOptions.map((snapshot) => (
                <option key={snapshot.id} value={snapshot.id}>
                  {snapshot.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>After</span>
            <select value={afterId} onChange={(event) => setAfterId(event.target.value)}>
              <option value="">Select snapshot</option>
              {snapshotOptions.map((snapshot) => (
                <option key={snapshot.id} value={snapshot.id}>
                  {snapshot.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="ecm-compare-table">
          <div className="ecm-table-row ecm-table-head">
            <span>Field</span>
            <span>Before</span>
            <span>After</span>
          </div>
          {compareFields.length === 0 ? (
            <div className="ecm-empty">Select snapshots to see the comparison.</div>
          ) : (
            compareFields.map((field) => {
              const beforeValue = selectedBefore?.fields[field];
              const afterValue = selectedAfter?.fields[field];
              const isDiff = beforeValue !== afterValue;
              return (
                <div key={field} className={`ecm-table-row ${isDiff ? 'is-diff' : ''}`}>
                  <span>{field}</span>
                  <span>{toDisplayValue(beforeValue)}</span>
                  <span>{toDisplayValue(afterValue)}</span>
                </div>
              );
            })
          )}
        </div>
      </section>
    </div>
  );
};

export default NewTab;
