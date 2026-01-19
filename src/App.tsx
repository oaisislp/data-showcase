import { useEffect, useMemo, useRef, useState } from 'react';
import Plotly from 'plotly.js-dist-min';
import {
  CanonicalRow,
  DataSource,
  ExecutionResult,
  NormalizationConfig,
  SourceType,
  WatermarkConfig,
} from './types';
import {
  detectNumericFields,
  detectTimeField,
  extractJsonRows,
  normalizeRows,
  parseCsv,
  summaryStats,
  toCsv,
} from './utils/data';

const STORAGE_KEY = 'data-workbench-sources';

const defaultWatermark: WatermarkConfig = {
  src: null,
  opacity: 0.18,
  scale: 1,
  position: 'center',
};

const defaultNormalization = (rows: Record<string, unknown>[]): NormalizationConfig => {
  const timeField = detectTimeField(rows);
  return {
    timeField,
    numericFields: detectNumericFields(rows, timeField),
    renameMap: {},
    unitsMap: {},
  };
};

const loadSources = (): DataSource[] => {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) return [];
  try {
    return JSON.parse(stored) as DataSource[];
  } catch {
    return [];
  }
};

const saveSources = (sources: DataSource[]) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sources));
};

const formatDate = (value: Date | null) => (value ? value.toISOString() : '--');

const seriesColorPalette = ['#38bdf8', '#f97316', '#10b981', '#a855f7', '#e11d48'];

const WatermarkPositions = {
  center: { x: 0.5, y: 0.5 },
  'top-left': { x: 0.1, y: 0.9 },
  'top-right': { x: 0.9, y: 0.9 },
  'bottom-left': { x: 0.1, y: 0.1 },
  'bottom-right': { x: 0.9, y: 0.1 },
};

const App = () => {
  const [sources, setSources] = useState<DataSource[]>(() => loadSources());
  const [activeSourceId, setActiveSourceId] = useState<string | null>(null);
  const [rawRows, setRawRows] = useState<Record<string, unknown>[]>([]);
  const [normalization, setNormalization] = useState<NormalizationConfig>(() =>
    defaultNormalization([])
  );
  const [canonicalRows, setCanonicalRows] = useState<CanonicalRow[]>([]);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [watermark, setWatermark] = useState<WatermarkConfig>(defaultWatermark);
  const [timeRange, setTimeRange] = useState<[number, number] | null>(null);
  const [visibleSeries, setVisibleSeries] = useState<Record<string, boolean>>({});
  const [executionResult, setExecutionResult] = useState<ExecutionResult | null>(null);
  const [adapterType, setAdapterType] = useState<SourceType>('csv');

  const [httpConfig, setHttpConfig] = useState({
    url: '',
    method: 'GET',
    headers: '{\n  "Content-Type": "application/json"\n}',
    body: '',
    jsonPath: '$',
    pagination: {
      mode: 'none',
      pageParam: 'page',
      startPage: 1,
      pageSize: 100,
      cursorParam: 'cursor',
      cursorPath: '$.next_cursor',
      maxPages: 5,
    },
  });

  const [shellCommand, setShellCommand] = useState('curl -s https://example.com/data.csv');
  const [pythonCode, setPythonCode] = useState(
    "import pandas as pd\n\n# Return a DataFrame or print CSV/JSON\nprint('timestamp,value')\nprint('2024-01-01,10')"
  );
  const [nodeCode, setNodeCode] = useState(
    "const data = [{ timestamp: '2024-01-01', value: 42 }];\nconsole.log(JSON.stringify(data));"
  );

  const plotRef = useRef<HTMLDivElement | null>(null);

  const activeSource = sources.find((source) => source.id === activeSourceId) ?? null;

  const stats = useMemo(() => summaryStats(canonicalRows), [canonicalRows]);

  const seriesKeys = useMemo(() => {
    const keys = new Set<string>();
    canonicalRows.forEach((row) => {
      Object.keys(row.series).forEach((key) => keys.add(key));
    });
    return Array.from(keys);
  }, [canonicalRows]);

  const filteredRows = useMemo(() => {
    if (!timeRange) return canonicalRows;
    return canonicalRows.filter((row) => {
      const ts = row.timestamp.getTime();
      return ts >= timeRange[0] && ts <= timeRange[1];
    });
  }, [canonicalRows, timeRange]);

  useEffect(() => {
    const themeClass = theme === 'dark' ? 'dark' : '';
    document.documentElement.classList.toggle('dark', theme === 'dark');
    document.body.className =
      theme === 'dark'
        ? 'bg-slate-900 text-slate-100'
        : 'bg-slate-100 text-slate-900';
    return () => {
      document.documentElement.classList.remove(themeClass);
    };
  }, [theme]);

  useEffect(() => {
    if (!rawRows.length) {
      setCanonicalRows([]);
      return;
    }
    const normalized = normalizeRows(rawRows, normalization);
    setCanonicalRows(normalized);
    const derivedSeries: Record<string, boolean> = {};
    normalization.numericFields.forEach((field) => {
      const renamed = normalization.renameMap[field] || field;
      derivedSeries[renamed] = true;
    });
    setVisibleSeries((prev) => ({ ...derivedSeries, ...prev }));
  }, [rawRows, normalization]);

  useEffect(() => {
    if (!canonicalRows.length) {
      setTimeRange(null);
      return;
    }
    const times = canonicalRows.map((row) => row.timestamp.getTime());
    const min = Math.min(...times);
    const max = Math.max(...times);
    setTimeRange([min, max]);
  }, [canonicalRows]);

  useEffect(() => {
    if (!plotRef.current) return;
    const visibleKeys = seriesKeys.filter((key) => visibleSeries[key]);
    const traces = visibleKeys.map((key, index) => ({
      x: filteredRows.map((row) => row.timestamp),
      y: filteredRows.map((row) => row.series[key] ?? null),
      mode: 'lines+markers',
      name: key,
      line: { color: seriesColorPalette[index % seriesColorPalette.length] },
    }));

    const position = WatermarkPositions[watermark.position];
    const layout = {
      autosize: true,
      paper_bgcolor: theme === 'dark' ? '#0f172a' : '#ffffff',
      plot_bgcolor: theme === 'dark' ? '#0f172a' : '#ffffff',
      font: { color: theme === 'dark' ? '#e2e8f0' : '#0f172a' },
      xaxis: {
        title: normalization.timeField || 'timestamp',
        rangeslider: { visible: true },
        range: timeRange ? [new Date(timeRange[0]), new Date(timeRange[1])] : undefined,
      },
      yaxis: { title: 'value' },
      margin: { l: 50, r: 30, t: 30, b: 50 },
      images: watermark.src
        ? [
            {
              source: watermark.src,
              xref: 'paper',
              yref: 'paper',
              x: position.x,
              y: position.y,
              sizex: 0.3 * watermark.scale,
              sizey: 0.3 * watermark.scale,
              xanchor: 'center',
              yanchor: 'middle',
              opacity: watermark.opacity,
              layer: 'above',
            },
          ]
        : [],
    };

    Plotly.react(plotRef.current, traces, layout as Plotly.Layout, {
      responsive: true,
    });
  }, [filteredRows, normalization.timeField, seriesKeys, theme, timeRange, visibleSeries, watermark]);

  const handleCsvUpload = async (file: File) => {
    const text = await file.text();
    const rows = parseCsv(text);
    setRawRows(rows);
    setNormalization(defaultNormalization(rows));
    setExecutionResult(null);
  };

  const handleOpenCsv = async () => {
    if (!window.dataWorkbench?.openFile) return;
    const filePath = await window.dataWorkbench.openFile();
    if (!filePath) return;
    const response = await fetch(`file://${filePath}`);
    const text = await response.text();
    const rows = parseCsv(text);
    setRawRows(rows);
    setNormalization(defaultNormalization(rows));
  };

  const addSource = () => {
    const name = `Source ${sources.length + 1}`;
    const newSource: DataSource = {
      id: crypto.randomUUID(),
      name,
      type: adapterType,
      config: {
        httpConfig,
        shellCommand,
        pythonCode,
        nodeCode,
      },
      createdAt: new Date().toISOString(),
    };
    const updated = [newSource, ...sources];
    setSources(updated);
    saveSources(updated);
    setActiveSourceId(newSource.id);
  };

  const runHttpAdapter = async () => {
    let headers = {};
    try {
      headers = httpConfig.headers ? JSON.parse(httpConfig.headers) : {};
    } catch (error) {
      setExecutionResult({
        code: 1,
        stdout: '',
        stderr: `Invalid headers JSON: ${(error as Error).message}`,
      });
      return;
    }
    let page = httpConfig.pagination.startPage;
    let cursor: string | null = null;
    const rows: Record<string, unknown>[] = [];

    for (let i = 0; i < httpConfig.pagination.maxPages; i += 1) {
      const url = new URL(httpConfig.url);
      if (httpConfig.pagination.mode === 'page') {
        url.searchParams.set(httpConfig.pagination.pageParam, String(page));
        url.searchParams.set('limit', String(httpConfig.pagination.pageSize));
      }
      if (httpConfig.pagination.mode === 'cursor' && cursor) {
        url.searchParams.set(httpConfig.pagination.cursorParam, cursor);
      }

      const response = await fetch(url.toString(), {
        method: httpConfig.method,
        headers,
        body: httpConfig.method !== 'GET' ? httpConfig.body : undefined,
      });
      const json = await response.json();
      const extracted = extractJsonRows(json, httpConfig.jsonPath);
      rows.push(...extracted);

      if (httpConfig.pagination.mode === 'page') {
        page += 1;
      }
      if (httpConfig.pagination.mode === 'cursor') {
        const nextCursor = extractJsonRows(json, httpConfig.pagination.cursorPath)[0] as
          | string
          | undefined;
        cursor = nextCursor ?? null;
        if (!cursor) break;
      }
      if (httpConfig.pagination.mode === 'none') {
        break;
      }
    }

    setRawRows(rows);
    setNormalization(defaultNormalization(rows));
    setExecutionResult(null);
  };

  const handleScriptRun = async (type: 'shell' | 'python' | 'node') => {
    const api = window.dataWorkbench;
    if (!api) {
      setExecutionResult({ code: 1, stdout: '', stderr: 'Local runner unavailable.' });
      return;
    }

    let result: ExecutionResult;
    if (type === 'shell') {
      result = await api.runShell(shellCommand);
    } else if (type === 'python') {
      result = await api.runPython(pythonCode);
    } else {
      result = await api.runNode(nodeCode);
    }

    setExecutionResult(result);
    const output = result.stdout.trim();
    if (!output) return;
    try {
      const json = JSON.parse(output);
      const rows = extractJsonRows(json, '$');
      setRawRows(rows);
      setNormalization(defaultNormalization(rows));
    } catch {
      const rows = parseCsv(output);
      setRawRows(rows);
      setNormalization(defaultNormalization(rows));
    }
  };

  const handleExportPng = async () => {
    if (!plotRef.current) return;
    const dataUrl = await Plotly.toImage(plotRef.current, {
      format: 'png',
      width: 1200,
      height: 700,
      scale: 2,
    });
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = 'chart.png';
    link.click();
  };

  const handleDownloadCsv = () => {
    const keys = seriesKeys.filter((key) => visibleSeries[key]);
    const csv = toCsv(filteredRows, keys);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'filtered-data.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  const updateNormalizationField = (field: keyof NormalizationConfig, value: string) => {
    setNormalization((prev) => ({ ...prev, [field]: value }));
  };

  const toggleNumericField = (field: string) => {
    setNormalization((prev) => {
      const exists = prev.numericFields.includes(field);
      return {
        ...prev,
        numericFields: exists
          ? prev.numericFields.filter((item) => item !== field)
          : [...prev.numericFields, field],
      };
    });
  };

  const updateRename = (field: string, value: string) => {
    setNormalization((prev) => ({
      ...prev,
      renameMap: { ...prev.renameMap, [field]: value },
    }));
  };

  const updateUnits = (field: string, value: string) => {
    setNormalization((prev) => ({
      ...prev,
      unitsMap: { ...prev.unitsMap, [field]: value },
    }));
  };

  const applySample = async () => {
    const response = await fetch('/sample/sample.csv');
    const text = await response.text();
    const rows = parseCsv(text);
    setRawRows(rows);
    setNormalization(defaultNormalization(rows));
  };

  const columns = rawRows.length ? Object.keys(rawRows[0]) : [];

  return (
    <div className="min-h-screen p-6">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Data Visualization Workbench</h1>
          <p className="text-sm text-slate-500 dark:text-slate-300">
            Connect data sources, normalize time series, and export interactive charts.
          </p>
        </div>
        <button
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow dark:bg-slate-100 dark:text-slate-900"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        >
          Toggle {theme === 'dark' ? 'Light' : 'Dark'} Mode
        </button>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <section className="lg:col-span-3">
          <div className="rounded-xl bg-white p-4 shadow dark:bg-slate-800">
            <h2 className="text-lg font-semibold">Data Sources</h2>
            <div className="mt-3 space-y-2 text-sm">
              {sources.length === 0 && (
                <p className="text-slate-500">No saved sources yet.</p>
              )}
              {sources.map((source) => (
                <button
                  key={source.id}
                  className={`w-full rounded-md border px-3 py-2 text-left transition ${
                    source.id === activeSourceId
                      ? 'border-sky-500 bg-sky-50 text-sky-700 dark:bg-slate-700 dark:text-sky-200'
                      : 'border-slate-200 hover:border-sky-300 dark:border-slate-700'
                  }`}
                  onClick={() => setActiveSourceId(source.id)}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{source.name}</span>
                    <span className="text-xs uppercase text-slate-400">{source.type}</span>
                  </div>
                  <p className="text-xs text-slate-500">
                    Saved {new Date(source.createdAt).toLocaleString()}
                  </p>
                </button>
              ))}
            </div>
            <div className="mt-4 border-t pt-4">
              <h3 className="text-sm font-semibold">Add Source</h3>
              <div className="mt-2 flex flex-wrap gap-2">
                {(['csv', 'http', 'shell', 'python', 'node'] as SourceType[]).map((type) => (
                  <button
                    key={type}
                    className={`rounded-full px-3 py-1 text-xs font-medium ${
                      adapterType === type
                        ? 'bg-sky-500 text-white'
                        : 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-200'
                    }`}
                    onClick={() => setAdapterType(type)}
                  >
                    {type.toUpperCase()}
                  </button>
                ))}
              </div>
              <button
                className="mt-3 w-full rounded-md bg-sky-600 px-3 py-2 text-sm font-semibold text-white"
                onClick={addSource}
              >
                Save Source Preset
              </button>
            </div>
          </div>

          <div className="mt-6 rounded-xl bg-white p-4 shadow dark:bg-slate-800">
            <h2 className="text-lg font-semibold">Data Source Wizard</h2>
            <p className="mt-1 text-xs text-slate-500">
              Choose a source type and click Run. Scripts never auto-run.
            </p>

            <div className="mt-3 space-y-4 text-sm">
              <div>
                <h3 className="font-medium">CSV Upload</h3>
                <div className="mt-2 flex gap-2">
                  <input
                    type="file"
                    accept=".csv"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) handleCsvUpload(file);
                    }}
                  />
                  <button
                    className="rounded-md border border-slate-200 px-2 py-1 text-xs dark:border-slate-700"
                    onClick={handleOpenCsv}
                  >
                    Open CSV
                  </button>
                </div>
                <button
                  className="mt-2 rounded-md bg-slate-900 px-2 py-1 text-xs text-white dark:bg-slate-100 dark:text-slate-900"
                  onClick={applySample}
                >
                  Load sample/sample.csv
                </button>
              </div>

              <div className="border-t border-slate-200 pt-4 dark:border-slate-700">
                <h3 className="font-medium">HTTP API Adapter</h3>
                <input
                  className="mt-2 w-full rounded-md border border-slate-200 px-2 py-1 dark:border-slate-700 dark:bg-slate-900"
                  placeholder="https://api.example.com/data"
                  value={httpConfig.url}
                  onChange={(event) =>
                    setHttpConfig((prev) => ({ ...prev, url: event.target.value }))
                  }
                />
                <div className="mt-2 flex gap-2">
                  <select
                    className="rounded-md border border-slate-200 px-2 py-1 dark:border-slate-700 dark:bg-slate-900"
                    value={httpConfig.method}
                    onChange={(event) =>
                      setHttpConfig((prev) => ({ ...prev, method: event.target.value }))
                    }
                  >
                    {['GET', 'POST', 'PUT'].map((method) => (
                      <option key={method}>{method}</option>
                    ))}
                  </select>
                  <input
                    className="flex-1 rounded-md border border-slate-200 px-2 py-1 dark:border-slate-700 dark:bg-slate-900"
                    placeholder="JSONPath (e.g. $.data[*])"
                    value={httpConfig.jsonPath}
                    onChange={(event) =>
                      setHttpConfig((prev) => ({ ...prev, jsonPath: event.target.value }))
                    }
                  />
                </div>
                <textarea
                  className="mt-2 w-full rounded-md border border-slate-200 px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-900"
                  rows={3}
                  value={httpConfig.headers}
                  onChange={(event) =>
                    setHttpConfig((prev) => ({ ...prev, headers: event.target.value }))
                  }
                />
                <textarea
                  className="mt-2 w-full rounded-md border border-slate-200 px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-900"
                  rows={2}
                  value={httpConfig.body}
                  onChange={(event) =>
                    setHttpConfig((prev) => ({ ...prev, body: event.target.value }))
                  }
                />
                <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                  <select
                    className="rounded-md border border-slate-200 px-2 py-1 dark:border-slate-700 dark:bg-slate-900"
                    value={httpConfig.pagination.mode}
                    onChange={(event) =>
                      setHttpConfig((prev) => ({
                        ...prev,
                        pagination: { ...prev.pagination, mode: event.target.value },
                      }))
                    }
                  >
                    <option value="none">No pagination</option>
                    <option value="page">Page-based</option>
                    <option value="cursor">Cursor-based</option>
                  </select>
                  <input
                    className="rounded-md border border-slate-200 px-2 py-1 dark:border-slate-700 dark:bg-slate-900"
                    placeholder="Max pages"
                    type="number"
                    value={httpConfig.pagination.maxPages}
                    onChange={(event) =>
                      setHttpConfig((prev) => ({
                        ...prev,
                        pagination: {
                          ...prev.pagination,
                          maxPages: Number(event.target.value),
                        },
                      }))
                    }
                  />
                  <input
                    className="rounded-md border border-slate-200 px-2 py-1 dark:border-slate-700 dark:bg-slate-900"
                    placeholder="Page param"
                    value={httpConfig.pagination.pageParam}
                    onChange={(event) =>
                      setHttpConfig((prev) => ({
                        ...prev,
                        pagination: { ...prev.pagination, pageParam: event.target.value },
                      }))
                    }
                  />
                  <input
                    className="rounded-md border border-slate-200 px-2 py-1 dark:border-slate-700 dark:bg-slate-900"
                    placeholder="Cursor path"
                    value={httpConfig.pagination.cursorPath}
                    onChange={(event) =>
                      setHttpConfig((prev) => ({
                        ...prev,
                        pagination: { ...prev.pagination, cursorPath: event.target.value },
                      }))
                    }
                  />
                </div>
                <button
                  className="mt-2 w-full rounded-md bg-sky-500 px-2 py-2 text-sm font-semibold text-white"
                  onClick={runHttpAdapter}
                >
                  Run HTTP Adapter
                </button>
              </div>

              <div className="border-t border-slate-200 pt-4 dark:border-slate-700">
                <h3 className="font-medium">Shell Adapter</h3>
                <textarea
                  className="mt-2 w-full rounded-md border border-slate-200 px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-900"
                  rows={2}
                  value={shellCommand}
                  onChange={(event) => setShellCommand(event.target.value)}
                />
                <button
                  className="mt-2 w-full rounded-md bg-amber-500 px-2 py-2 text-sm font-semibold text-white"
                  onClick={() => handleScriptRun('shell')}
                >
                  Run Shell Command
                </button>
              </div>

              <div className="border-t border-slate-200 pt-4 dark:border-slate-700">
                <h3 className="font-medium">Python Adapter</h3>
                <textarea
                  className="mt-2 w-full rounded-md border border-slate-200 px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-900"
                  rows={4}
                  value={pythonCode}
                  onChange={(event) => setPythonCode(event.target.value)}
                />
                <button
                  className="mt-2 w-full rounded-md bg-emerald-500 px-2 py-2 text-sm font-semibold text-white"
                  onClick={() => handleScriptRun('python')}
                >
                  Run Python Snippet
                </button>
              </div>

              <div className="border-t border-slate-200 pt-4 dark:border-slate-700">
                <h3 className="font-medium">Node Adapter</h3>
                <textarea
                  className="mt-2 w-full rounded-md border border-slate-200 px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-900"
                  rows={4}
                  value={nodeCode}
                  onChange={(event) => setNodeCode(event.target.value)}
                />
                <button
                  className="mt-2 w-full rounded-md bg-indigo-500 px-2 py-2 text-sm font-semibold text-white"
                  onClick={() => handleScriptRun('node')}
                >
                  Run Node Snippet
                </button>
              </div>
            </div>

            {executionResult && (
              <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3 text-xs dark:border-slate-700 dark:bg-slate-900">
                <p className="font-semibold">Execution Output</p>
                <pre className="mt-2 whitespace-pre-wrap">{executionResult.stdout}</pre>
                {executionResult.stderr && (
                  <pre className="mt-2 whitespace-pre-wrap text-red-500">
                    {executionResult.stderr}
                  </pre>
                )}
              </div>
            )}
          </div>
        </section>

        <section className="lg:col-span-6">
          <div className="rounded-xl bg-white p-4 shadow dark:bg-slate-800">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">Chart</h2>
                <p className="text-xs text-slate-500">
                  {stats.rowCount} rows • {formatDate(stats.start)} → {formatDate(stats.end)}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  className="rounded-md border border-slate-200 px-3 py-2 text-xs dark:border-slate-700"
                  onClick={handleExportPng}
                >
                  Export PNG
                </button>
                <button
                  className="rounded-md bg-slate-900 px-3 py-2 text-xs text-white dark:bg-slate-100 dark:text-slate-900"
                  onClick={handleDownloadCsv}
                >
                  Download CSV
                </button>
              </div>
            </div>
            <div className="mt-4 h-[500px]" ref={plotRef} />
            {!canonicalRows.length && (
              <div className="mt-4 rounded-md border border-dashed border-slate-300 p-4 text-center text-sm text-slate-500">
                Load a data source to preview the chart.
              </div>
            )}
          </div>
        </section>

        <section className="lg:col-span-3">
          <div className="rounded-xl bg-white p-4 shadow dark:bg-slate-800">
            <h2 className="text-lg font-semibold">Controls</h2>

            <div className="mt-3">
              <h3 className="text-sm font-semibold">Time Range</h3>
              {timeRange ? (
                <div className="mt-2 space-y-2 text-xs">
                  <input
                    type="range"
                    min={stats.start?.getTime() ?? 0}
                    max={stats.end?.getTime() ?? 0}
                    value={timeRange[0]}
                    onChange={(event) =>
                      setTimeRange((current) => {
                        if (!current) return current;
                        const newStart = Number(event.target.value);
                        const end = current[1];
                        return newStart <= end ? [newStart, end] : [end, newStart];
                      })
                    }
                    className="w-full"
                  />
                  <input
                    type="range"
                    min={stats.start?.getTime() ?? 0}
                    max={stats.end?.getTime() ?? 0}
                    value={timeRange[1]}
                    onChange={(event) =>
                      setTimeRange((current) => {
                        if (!current) return current;
                        const start = current[0];
                        const newEnd = Number(event.target.value);
                        return start <= newEnd ? [start, newEnd] : [newEnd, start];
                      })
                    }
                    className="w-full"
                  />
                  <div className="flex justify-between">
                    <span>{new Date(timeRange[0]).toLocaleString()}</span>
                    <span>{new Date(timeRange[1]).toLocaleString()}</span>
                  </div>
                </div>
              ) : (
                <p className="mt-2 text-xs text-slate-500">No time range available.</p>
              )}
            </div>

            <div className="mt-4 border-t border-slate-200 pt-4 dark:border-slate-700">
              <h3 className="text-sm font-semibold">Watermark</h3>
              <input
                className="mt-2 w-full text-xs"
                type="file"
                accept="image/png,image/jpeg,image/svg+xml"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  const reader = new FileReader();
                  reader.onload = () =>
                    setWatermark((prev) => ({ ...prev, src: reader.result as string }));
                  reader.readAsDataURL(file);
                }}
              />
              <label className="mt-2 block text-xs">Opacity</label>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={watermark.opacity}
                onChange={(event) =>
                  setWatermark((prev) => ({
                    ...prev,
                    opacity: Number(event.target.value),
                  }))
                }
                className="w-full"
              />
              <label className="mt-2 block text-xs">Scale</label>
              <input
                type="range"
                min={0.5}
                max={2}
                step={0.05}
                value={watermark.scale}
                onChange={(event) =>
                  setWatermark((prev) => ({
                    ...prev,
                    scale: Number(event.target.value),
                  }))
                }
                className="w-full"
              />
              <label className="mt-2 block text-xs">Position</label>
              <select
                className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-900"
                value={watermark.position}
                onChange={(event) =>
                  setWatermark((prev) => ({
                    ...prev,
                    position: event.target.value as WatermarkConfig['position'],
                  }))
                }
              >
                {Object.keys(WatermarkPositions).map((key) => (
                  <option key={key} value={key}>
                    {key}
                  </option>
                ))}
              </select>
            </div>

            <div className="mt-4 border-t border-slate-200 pt-4 dark:border-slate-700">
              <h3 className="text-sm font-semibold">Series Visibility</h3>
              <div className="mt-2 space-y-2 text-xs">
                {seriesKeys.length === 0 && <p className="text-slate-500">No series yet.</p>}
                {seriesKeys.map((key) => (
                  <label key={key} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={visibleSeries[key] ?? true}
                      onChange={() =>
                        setVisibleSeries((prev) => ({ ...prev, [key]: !prev[key] }))
                      }
                    />
                    {key}
                  </label>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-6 rounded-xl bg-white p-4 shadow dark:bg-slate-800">
            <h2 className="text-lg font-semibold">Normalization</h2>
            <p className="mt-1 text-xs text-slate-500">
              Map time field, series, and units. ISO8601/epoch timestamps supported.
            </p>
            {columns.length === 0 ? (
              <p className="mt-3 text-xs text-slate-500">No data loaded.</p>
            ) : (
              <div className="mt-3 space-y-3 text-xs">
                <label className="block">
                  Time field
                  <select
                    className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1 dark:border-slate-700 dark:bg-slate-900"
                    value={normalization.timeField}
                    onChange={(event) =>
                      updateNormalizationField('timeField', event.target.value)
                    }
                  >
                    {columns.map((col) => (
                      <option key={col} value={col}>
                        {col}
                      </option>
                    ))}
                  </select>
                </label>

                <div>
                  <p className="font-semibold">Numeric series</p>
                  <div className="mt-2 space-y-2">
                    {columns
                      .filter((col) => col !== normalization.timeField)
                      .map((col) => (
                        <div key={col} className="grid grid-cols-[auto,1fr] gap-2">
                          <label className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={normalization.numericFields.includes(col)}
                              onChange={() => toggleNumericField(col)}
                            />
                            {col}
                          </label>
                          <div className="flex gap-2">
                            <input
                              className="w-full rounded-md border border-slate-200 px-2 py-1 dark:border-slate-700 dark:bg-slate-900"
                              placeholder="Rename"
                              value={normalization.renameMap[col] ?? ''}
                              onChange={(event) => updateRename(col, event.target.value)}
                            />
                            <input
                              className="w-24 rounded-md border border-slate-200 px-2 py-1 dark:border-slate-700 dark:bg-slate-900"
                              placeholder="Units"
                              value={normalization.unitsMap[col] ?? ''}
                              onChange={(event) => updateUnits(col, event.target.value)}
                            />
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="mt-6 rounded-xl bg-white p-4 shadow dark:bg-slate-800">
            <h2 className="text-lg font-semibold">Preview</h2>
            <p className="text-xs text-slate-500">First 5 rows from current data source.</p>
            <div className="mt-3 overflow-auto text-xs">
              {rawRows.length === 0 ? (
                <p className="text-slate-500">No data loaded.</p>
              ) : (
                <table className="min-w-full border border-slate-200 dark:border-slate-700">
                  <thead className="bg-slate-100 text-left dark:bg-slate-900">
                    <tr>
                      {columns.map((col) => (
                        <th key={col} className="px-2 py-1 font-semibold">
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rawRows.slice(0, 5).map((row, index) => (
                      <tr key={index} className="border-t border-slate-200 dark:border-slate-700">
                        {columns.map((col) => (
                          <td key={col} className="px-2 py-1">
                            {String(row[col] ?? '')}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};

export default App;
