import '@src/NewTab.css';
import '@src/NewTab.scss';
import { useMemo, useState } from 'react';

type MonitorEntry = {
  id: string;
  name: string;
  url: string;
  expectedPrice?: number;
  currentPrice?: number;
  expectedOrderType?: string;
  currentOrderType?: string;
  expectedPriceSource?: string;
  currentPriceSource?: string;
  expectedLiquidation?: number;
  currentLiquidation?: number;
  lastChecked: string;
};

type AlertResult = {
  id: string;
  alerts: string[];
};

type ScreenshotItem = {
  id: string;
  name: string;
  url: string;
};

const SEARCH_ENGINES = [
  { label: 'Google', value: 'https://www.google.com/search?q=' },
  { label: 'DuckDuckGo', value: 'https://duckduckgo.com/?q=' },
  { label: 'Bing', value: 'https://www.bing.com/search?q=' },
];

const percentDiff = (baseline?: number, current?: number) => {
  if (baseline === undefined || current === undefined || baseline === 0) return null;
  return Math.abs(current - baseline) / Math.abs(baseline);
};

const buildAlerts = (entry: MonitorEntry): string[] => {
  const alerts: string[] = [];
  const priceMismatch = percentDiff(entry.expectedPrice, entry.currentPrice);
  if (priceMismatch !== null && priceMismatch > 0.2) {
    alerts.push('Price mismatch');
  }
  const liquidationMismatch = percentDiff(entry.expectedLiquidation, entry.currentLiquidation);
  if (liquidationMismatch !== null && liquidationMismatch > 0.2) {
    alerts.push('Liquidation mismatch');
  }
  if (
    entry.expectedOrderType &&
    entry.currentOrderType &&
    entry.expectedOrderType.toLowerCase() !== entry.currentOrderType.toLowerCase()
  ) {
    alerts.push('Order type mismatch');
  }
  if (
    entry.expectedPriceSource &&
    entry.currentPriceSource &&
    entry.expectedPriceSource.toLowerCase() !== entry.currentPriceSource.toLowerCase()
  ) {
    alerts.push('Price source mismatch');
  }
  return alerts;
};

const formatNumber = (value?: number) => {
  if (value === undefined) return '—';
  return value.toLocaleString();
};

const NewTab = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const [engine, setEngine] = useState(SEARCH_ENGINES[0].value);
  const [monitorEntries, setMonitorEntries] = useState<MonitorEntry[]>([]);
  const [screenshots, setScreenshots] = useState<ScreenshotItem[]>([]);
  const [formState, setFormState] = useState({
    name: '',
    url: '',
    expectedPrice: '',
    currentPrice: '',
    expectedOrderType: '',
    currentOrderType: '',
    expectedPriceSource: '',
    currentPriceSource: '',
    expectedLiquidation: '',
    currentLiquidation: '',
  });

  const alerts = useMemo<AlertResult[]>(() => {
    return monitorEntries.map((entry) => ({ id: entry.id, alerts: buildAlerts(entry) }));
  }, [monitorEntries]);

  const handleSearch = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const query = searchQuery.trim();
    if (!query) return;
    const url = `${engine}${encodeURIComponent(query)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const handleFormChange = (field: keyof typeof formState, value: string) => {
    setFormState((prev) => ({ ...prev, [field]: value }));
  };

  const parseOptionalNumber = (value: string) => {
    if (!value) return undefined;
    const parsed = Number(value);
    return Number.isNaN(parsed) ? undefined : parsed;
  };

  const addMonitorEntry = () => {
    if (!formState.name || !formState.url) return;
    const entry: MonitorEntry = {
      id: `monitor-${Date.now()}`,
      name: formState.name,
      url: formState.url,
      expectedPrice: parseOptionalNumber(formState.expectedPrice),
      currentPrice: parseOptionalNumber(formState.currentPrice),
      expectedOrderType: formState.expectedOrderType || undefined,
      currentOrderType: formState.currentOrderType || undefined,
      expectedPriceSource: formState.expectedPriceSource || undefined,
      currentPriceSource: formState.currentPriceSource || undefined,
      expectedLiquidation: parseOptionalNumber(formState.expectedLiquidation),
      currentLiquidation: parseOptionalNumber(formState.currentLiquidation),
      lastChecked: new Date().toLocaleString(),
    };
    setMonitorEntries((prev) => [entry, ...prev]);
    setFormState({
      name: '',
      url: '',
      expectedPrice: '',
      currentPrice: '',
      expectedOrderType: '',
      currentOrderType: '',
      expectedPriceSource: '',
      currentPriceSource: '',
      expectedLiquidation: '',
      currentLiquidation: '',
    });
  };

  const removeEntry = (id: string) => {
    setMonitorEntries((prev) => prev.filter((entry) => entry.id !== id));
  };

  const updateEntryCheck = (id: string) => {
    setMonitorEntries((prev) =>
      prev.map((entry) =>
        entry.id === id
          ? {
              ...entry,
              lastChecked: new Date().toLocaleString(),
            }
          : entry,
      ),
    );
  };

  const handleScreenshotUpload = (files: FileList | null) => {
    if (!files) return;
    const next: ScreenshotItem[] = Array.from(files).map((file) => ({
      id: `${file.name}-${file.lastModified}`,
      name: file.name,
      url: URL.createObjectURL(file),
    }));
    setScreenshots((prev) => [...next, ...prev]);
  };

  const exportReport = () => {
    const report = {
      generatedAt: new Date().toISOString(),
      monitorEntries,
      alerts,
      screenshots: screenshots.map((shot) => ({ name: shot.name })),
    };
    const textReport = [
      'Exchange Consistency Monitor Viewer',
      `Generated: ${new Date().toLocaleString()}`,
      '',
      'Monitoring Entries',
      ...monitorEntries.map((entry) => {
        const entryAlerts = alerts.find((item) => item.id === entry.id)?.alerts ?? [];
        return `• ${entry.name} (${entry.url}) | Price ${formatNumber(entry.currentPrice)} | Alerts: ${
          entryAlerts.length ? entryAlerts.join(', ') : 'None'
        }`;
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

    download(JSON.stringify(report, null, 2), 'exchange-monitor-report.json', 'application/json');
    download(textReport, 'exchange-monitor-report.txt', 'text/plain');
  };

  return (
    <div className="browser-shell">
      <header className="browser-top">
        <div className="browser-brand">
          <span className="brand-dot" />
          <div>
            <p>Exchange Consistency Monitor</p>
            <small>Browser-style search with monitoring, screenshots, and alerts.</small>
          </div>
        </div>
        <button className="primary" onClick={exportReport}>
          Export Report
        </button>
      </header>

      <section className="browser-bar">
        <form onSubmit={handleSearch} className="search-form">
          <span className="search-icon">🔍</span>
          <input
            type="text"
            placeholder="Search the web or paste a URL"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
          />
          <select value={engine} onChange={(event) => setEngine(event.target.value)}>
            {SEARCH_ENGINES.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
          <button type="submit">Go</button>
        </form>
      </section>

      <section className="monitoring-grid">
        <div className="panel">
          <h2>Monitoring Setup</h2>
          <p>Track futures pricing, order types, liquidation levels, and price sources.</p>
          <div className="form-grid">
            <label>
              Name
              <input value={formState.name} onChange={(event) => handleFormChange('name', event.target.value)} />
            </label>
            <label>
              URL
              <input value={formState.url} onChange={(event) => handleFormChange('url', event.target.value)} />
            </label>
            <label>
              Expected Price
              <input
                value={formState.expectedPrice}
                onChange={(event) => handleFormChange('expectedPrice', event.target.value)}
                type="number"
              />
            </label>
            <label>
              Current Price
              <input
                value={formState.currentPrice}
                onChange={(event) => handleFormChange('currentPrice', event.target.value)}
                type="number"
              />
            </label>
            <label>
              Expected Order Type
              <input
                value={formState.expectedOrderType}
                onChange={(event) => handleFormChange('expectedOrderType', event.target.value)}
              />
            </label>
            <label>
              Current Order Type
              <input
                value={formState.currentOrderType}
                onChange={(event) => handleFormChange('currentOrderType', event.target.value)}
              />
            </label>
            <label>
              Expected Price Source
              <input
                value={formState.expectedPriceSource}
                onChange={(event) => handleFormChange('expectedPriceSource', event.target.value)}
              />
            </label>
            <label>
              Current Price Source
              <input
                value={formState.currentPriceSource}
                onChange={(event) => handleFormChange('currentPriceSource', event.target.value)}
              />
            </label>
            <label>
              Expected Liquidation
              <input
                value={formState.expectedLiquidation}
                onChange={(event) => handleFormChange('expectedLiquidation', event.target.value)}
                type="number"
              />
            </label>
            <label>
              Current Liquidation
              <input
                value={formState.currentLiquidation}
                onChange={(event) => handleFormChange('currentLiquidation', event.target.value)}
                type="number"
              />
            </label>
          </div>
          <button className="secondary" onClick={addMonitorEntry}>
            Add Monitor Target
          </button>
        </div>

        <div className="panel">
          <h2>Screenshot Vault</h2>
          <p>Upload browser screenshots for compliance evidence.</p>
          <input type="file" accept="image/*" multiple onChange={(event) => handleScreenshotUpload(event.target.files)} />
          <div className="screenshot-grid">
            {screenshots.length === 0 ? (
              <div className="empty">No screenshots uploaded yet.</div>
            ) : (
              screenshots.map((shot) => (
                <figure key={shot.id}>
                  <img src={shot.url} alt={shot.name} />
                  <figcaption>{shot.name}</figcaption>
                </figure>
              ))
            )}
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>Live Monitoring & Alerts</h2>
          <p>Review flags and trigger checks with one tap.</p>
        </div>
        <div className="table">
          <div className="table-row table-head">
            <span>Target</span>
            <span>Prices</span>
            <span>Order Type</span>
            <span>Sources</span>
            <span>Alerts</span>
            <span>Actions</span>
          </div>
          {monitorEntries.length === 0 ? (
            <div className="empty">Add a monitor target to begin tracking.</div>
          ) : (
            monitorEntries.map((entry) => {
              const entryAlerts = alerts.find((item) => item.id === entry.id)?.alerts ?? [];
              return (
                <div key={entry.id} className="table-row">
                  <span>
                    <strong>{entry.name}</strong>
                    <small>{entry.url}</small>
                    <small>Last checked: {entry.lastChecked}</small>
                  </span>
                  <span>
                    Expected {formatNumber(entry.expectedPrice)}
                    <small>Current {formatNumber(entry.currentPrice)}</small>
                  </span>
                  <span>
                    {entry.expectedOrderType ?? '—'}
                    <small>{entry.currentOrderType ?? '—'}</small>
                  </span>
                  <span>
                    {entry.expectedPriceSource ?? '—'}
                    <small>{entry.currentPriceSource ?? '—'}</small>
                  </span>
                  <span>{entryAlerts.length ? entryAlerts.join(', ') : 'No alerts'}</span>
                  <span className="actions">
                    <button onClick={() => updateEntryCheck(entry.id)}>Check Now</button>
                    <button className="ghost" onClick={() => removeEntry(entry.id)}>
                      Remove
                    </button>
                  </span>
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
