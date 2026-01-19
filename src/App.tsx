import { useEffect, useMemo, useRef, useState } from 'react';
import Plotly from 'plotly.js-dist-min';
import {
  CanonicalRow,
  ChartConfig,
  ChartLabels,
  ChartType,
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
const THEME_KEY = 'data-workbench-theme';
const DUNE_KEY_PREFIX = 'data-workbench-dune';

const defaultWatermark: WatermarkConfig = {
  src: null,
  opacity: 0.18,
  scale: 1,
  position: 'center',
};

const defaultChartLabels: ChartLabels = {
  title: '',
  xLabel: '',
  yLabel: '',
};

const defaultChartConfig: ChartConfig = {
  type: 'line',
  line: { smooth: false, markers: true, dash: 'solid' },
  area: { stacked: false, opacity: 0.6 },
  bar: { stacked: false, orientation: 'v' },
  scatter: { markerSize: 8 },
  treemap: { labelField: '', valueField: '', groupField: '' },
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

const getStoredTheme = () => {
  const stored = localStorage.getItem(THEME_KEY);
  if (stored === 'light' || stored === 'dark' || stored === 'system') {
    return stored;
  }
  return 'system';
};

const resolveTheme = (setting: string) => {
  if (setting === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return setting === 'dark' ? 'dark' : 'light';
};

const getStoredDuneKey = (queryId: string) =>
  localStorage.getItem(`${DUNE_KEY_PREFIX}:${queryId}`);

const removeStoredDuneKey = (queryId: string) =>
  localStorage.removeItem(`${DUNE_KEY_PREFIX}:${queryId}`);

const App = () => {
  const [sources, setSources] = useState<DataSource[]>(() => loadSources());
  const [activeSourceId, setActiveSourceId] = useState<string | null>(null);
  const [rawRows, setRawRows] = useState<Record<string, unknown>[]>([]);
  const [normalization, setNormalization] = useState<NormalizationConfig>(() =>
    defaultNormalization([])
  );
  const [canonicalRows, setCanonicalRows] = useState<CanonicalRow[]>([]);
  const [themeSetting, setThemeSetting] = useState<'light' | 'dark' | 'system'>(() =>
    getStoredTheme()
  );
  const [theme, setTheme] = useState<'light' | 'dark'>(() => resolveTheme(getStoredTheme()));
  const [watermark, setWatermark] = useState<WatermarkConfig>(defaultWatermark);
  const [timeRange, setTimeRange] = useState<[number, number] | null>(null);
  const [visibleSeries, setVisibleSeries] = useState<Record<string, boolean>>({});
  const [executionResult, setExecutionResult] = useState<ExecutionResult | null>(null);
  const [adapterType, setAdapterType] = useState<SourceType>('csv');
  const [chartLabels, setChartLabels] = useState<ChartLabels>(defaultChartLabels);
  const [chartConfig, setChartConfig] = useState<ChartConfig>(defaultChartConfig);
  const [showApiKey, setShowApiKey] = useState(false);

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

  const [csvUrl, setCsvUrl] = useState('');
  const [duneConfig, setDuneConfig] = useState({
    queryId: '',
    apiKey: '',
    datasetName: '',
    rememberKey: false,
  });

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

  const datasetName = useMemo(() => {
    if (!activeSource) return '';
    return (activeSource.config.datasetName as string) || '';
  }, [activeSource]);

  const resolvedTitle = chartLabels.title || datasetName || 'Untitled chart';
  const resolvedXLabel = chartLabels.xLabel || normalization.timeField || 'Time';
  const resolvedYLabel = useMemo(() => {
    if (chartLabels.yLabel) return chartLabels.yLabel;
    const activeKeys = seriesKeys.filter((key) => visibleSeries[key]);
    return activeKeys.length === 1 ? activeKeys[0] : 'Value';
  }, [chartLabels.yLabel, seriesKeys, visibleSeries]);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const updateTheme = () => setTheme(resolveTheme(themeSetting));
    updateTheme();
    media.addEventListener('change', updateTheme);
    return () => media.removeEventListener('change', updateTheme);
  }, [themeSetting]);

  useEffect(() => {
    localStorage.setItem(THEME_KEY, themeSetting);
  }, [themeSetting]);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    document.body.className =
      theme === 'dark' ? 'bg-slate-900 text-slate-100' : 'bg-slate-100 text-slate-900';
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
    if (!activeSource) return;
    const config = activeSource.config;
    if (config.httpConfig) setHttpConfig(config.httpConfig as typeof httpConfig);
    if (config.csvUrl) setCsvUrl(config.csvUrl as string);
    if (config.duneConfig) {
      const stored = config.duneConfig as typeof duneConfig;
      const storedKey = stored.queryId ? getStoredDuneKey(stored.queryId) : null;
      setDuneConfig({
        ...stored,
        apiKey: stored.rememberKey && storedKey ? storedKey : '',
      });
    }
    if (config.chartLabels) setChartLabels(config.chartLabels as ChartLabels);
    if (config.chartConfig) setChartConfig(config.chartConfig as ChartConfig);
  }, [activeSource]);

  useEffect(() => {
    if (duneConfig.rememberKey && duneConfig.queryId && duneConfig.apiKey) {
      localStorage.setItem(`${DUNE_KEY_PREFIX}:${duneConfig.queryId}`, duneConfig.apiKey);
    }
    if (!duneConfig.rememberKey && duneConfig.queryId) {
      removeStoredDuneKey(duneConfig.queryId);
    }
  }, [duneConfig]);

  useEffect(() => {
    if (!plotRef.current) return;
    const visibleKeys = seriesKeys.filter((key) => visibleSeries[key]);
    const isTreemap = chartConfig.type === 'treemap';
    const showRangeSlider = !isTreemap;

    const traces: Plotly.Data[] = [];

    if (isTreemap) {
      const { labelField, valueField, groupField } = chartConfig.treemap;
      if (labelField && valueField) {
        const labels: string[] = [];
        const parents: string[] = [];
        const values: number[] = [];
        const groupTotals: Record<string, number> = {};

        filteredRows.forEach((row) => {
          const meta = row.meta ?? {};
          const label = String(meta[labelField] ?? '');
          const rawValue = meta[valueField] ?? row.series[valueField];
          const value = Number(rawValue);
          if (!label || Number.isNaN(value)) return;
          labels.push(label);
          const parent = groupField ? String(meta[groupField] ?? '') : '';
          parents.push(parent);
          values.push(value);
          if (parent) {
            groupTotals[parent] = (groupTotals[parent] || 0) + value;
          }
        });

        if (groupField) {
          Object.entries(groupTotals).forEach(([group, total]) => {
            labels.push(group);
            parents.push('');
            values.push(total);
          });
        }

        traces.push({
          type: 'treemap',
          labels,
          parents,
          values,
          textinfo: 'label+value',
        });
      }
    } else {
      visibleKeys.forEach((key, index) => {
        const xValues = filteredRows.map((row) => row.timestamp);
        const yValues = filteredRows.map((row) => row.series[key] ?? null);
        const baseTrace = {
          name: key,
          marker: { color: seriesColorPalette[index % seriesColorPalette.length] },
        };

        if (chartConfig.type === 'line') {
          traces.push({
            ...baseTrace,
            type: 'scatter',
            mode: chartConfig.line.markers ? 'lines+markers' : 'lines',
            x: xValues,
            y: yValues,
            line: {
              color: seriesColorPalette[index % seriesColorPalette.length],
              shape: chartConfig.line.smooth ? 'spline' : 'linear',
              dash: chartConfig.line.dash,
            },
          });
        }

        if (chartConfig.type === 'area') {
          traces.push({
            ...baseTrace,
            type: 'scatter',
            mode: 'lines',
            x: xValues,
            y: yValues,
            fill: chartConfig.area.stacked && index > 0 ? 'tonexty' : 'tozeroy',
            stackgroup: chartConfig.area.stacked ? 'stack' : undefined,
            line: {
              color: seriesColorPalette[index % seriesColorPalette.length],
            },
            opacity: chartConfig.area.opacity,
          });
        }

        if (chartConfig.type === 'bar') {
          traces.push({
            ...baseTrace,
            type: 'bar',
            orientation: chartConfig.bar.orientation,
            x: chartConfig.bar.orientation === 'h' ? yValues : xValues,
            y: chartConfig.bar.orientation === 'h' ? xValues : yValues,
          });
        }

        if (chartConfig.type === 'scatter') {
          traces.push({
            ...baseTrace,
            type: 'scatter',
            mode: 'markers',
            x: xValues,
            y: yValues,
            marker: {
              size: chartConfig.scatter.markerSize,
              color: seriesColorPalette[index % seriesColorPalette.length],
            },
          });
        }
      });
    }

    const position = WatermarkPositions[watermark.position];
    const surface = theme === 'dark' ? '#0f172a' : '#ffffff';
    const text = theme === 'dark' ? '#e2e8f0' : '#0f172a';
    const grid = theme === 'dark' ? '#1e293b' : '#e2e8f0';

    const layout: Partial<Plotly.Layout> = {
      autosize: true,
      paper_bgcolor: surface,
      plot_bgcolor: surface,
      font: { color: text },
      title: { text: resolvedTitle, font: { color: text } },
      margin: { l: 50, r: 30, t: 50, b: 50 },
      barmode: chartConfig.type === 'bar' && chartConfig.bar.stacked ? 'stack' : undefined,
      xaxis: {
        title: { text: resolvedXLabel },
        rangeslider: { visible: showRangeSlider },
        range: timeRange ? [new Date(timeRange[0]), new Date(timeRange[1])] : undefined,
        color: text,
        gridcolor: grid,
        zerolinecolor: grid,
      },
      yaxis: {
        title: { text: resolvedYLabel },
        color: text,
        gridcolor: grid,
        zerolinecolor: grid,
      },
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

    if (isTreemap) {
      layout.xaxis = undefined;
      layout.yaxis = undefined;
    }

    try {
      Plotly.react(plotRef.current, traces, layout as Plotly.Layout, {
        responsive: true,
      });
    } catch (error) {
      setExecutionResult({
        code: 1,
        stdout: '',
        stderr: `Chart render error: ${(error as Error).message}`,
      });
    }
  }, [
    chartConfig,
    filteredRows,
    normalization.timeField,
    resolvedTitle,
    resolvedXLabel,
    resolvedYLabel,
    seriesKeys,
    theme,
    timeRange,
    visibleSeries,
    watermark,
  ]);

  const persistActiveSourceConfig = (updates: Record<string, unknown>) => {
    if (!activeSource) return;
    const updatedSources = sources.map((source) => {
      if (source.id !== activeSource.id) return source;
      return {
        ...source,
        config: { ...source.config, ...updates },
      };
    });
    setSources(updatedSources);
    saveSources(updatedSources);
  };

  const handleCsvUpload = async (file: File) => {
    const text = await file.text();
    const rows = parseCsv(text);
    if (!rows.length) {
      setExecutionResult({ code: 1, stdout: '', stderr: 'CSV file is empty.' });
      return;
    }
    setRawRows(rows);
    setNormalization(defaultNormalization(rows));
    setExecutionResult(null);
  };

  const addSource = () => {
    const name = `Source ${sources.length + 1}`;
    const datasetNameValue = adapterType === 'dune' ? duneConfig.datasetName : '';
    const newSource: DataSource = {
      id: crypto.randomUUID(),
      name,
      type: adapterType,
      config: {
        httpConfig,
        csvUrl,
        duneConfig: {
          ...duneConfig,
          apiKey: '',
        },
        datasetName: datasetNameValue,
        chartLabels,
        chartConfig,
      },
      createdAt: new Date().toISOString(),
    };
    const updated = [newSource, ...sources];
    setSources(updated);
    saveSources(updated);
    setActiveSourceId(newSource.id);
  };

  const parseCsvResponse = (csvText: string) => {
    const rows = parseCsv(csvText);
    if (!rows.length) {
      setExecutionResult({ code: 1, stdout: '', stderr: 'CSV response is empty.' });
      return;
    }
    setRawRows(rows);
    setNormalization(defaultNormalization(rows));
    setExecutionResult(null);
  };

  const runCsvUrlFetch = async () => {
    if (!csvUrl) {
      setExecutionResult({ code: 1, stdout: '', stderr: 'CSV URL is required.' });
      return;
    }
    try {
      const response = await fetch(csvUrl);
      if (!response.ok) {
        setExecutionResult({
          code: response.status,
          stdout: '',
          stderr: `CSV fetch failed with ${response.status}.`,
        });
        return;
      }
      const text = await response.text();
      parseCsvResponse(text);
      persistActiveSourceConfig({ csvUrl });
    } catch {
      setExecutionResult({
        code: 1,
        stdout: '',
        stderr: 'Network error fetching CSV URL. Check CORS and connectivity.',
      });
    }
  };

  const runHttpAdapter = async () => {
    if (!httpConfig.url) {
      setExecutionResult({ code: 1, stdout: '', stderr: 'HTTP URL is required.' });
      return;
    }
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

    try {
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
        if (!response.ok) {
          setExecutionResult({
            code: response.status,
            stdout: '',
            stderr: `HTTP adapter failed with ${response.status}.`,
          });
          return;
        }
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
    } catch {
      setExecutionResult({
        code: 1,
        stdout: '',
        stderr: 'Network error running HTTP adapter. Check CORS and connectivity.',
      });
      return;
    }

    setRawRows(rows);
    setNormalization(defaultNormalization(rows));
    setExecutionResult(null);
    persistActiveSourceConfig({ httpConfig });
  };

  const runDuneFetch = async () => {
    if (!duneConfig.queryId || !duneConfig.apiKey) {
      setExecutionResult({
        code: 1,
        stdout: '',
        stderr: 'Dune Query ID and API key are required.',
      });
      return;
    }
    const url = `https://api.dune.com/api/v1/query/${duneConfig.queryId}/results/csv?api_key=${duneConfig.apiKey}`;
    try {
      const response = await fetch(url);
      if (response.status === 401 || response.status === 403) {
        setExecutionResult({
          code: response.status,
          stdout: '',
          stderr: 'Authentication failed. Check your Dune API key.',
        });
        return;
      }
      if (response.status === 404) {
        setExecutionResult({
          code: response.status,
          stdout: '',
          stderr: 'Query not found. Check the Dune Query ID.',
        });
        return;
      }
      if (!response.ok) {
        setExecutionResult({
          code: response.status,
          stdout: '',
          stderr: `Dune request failed with ${response.status}.`,
        });
        return;
      }
      const text = await response.text();
      parseCsvResponse(text);
      setExecutionResult(null);
      persistActiveSourceConfig({
        duneConfig: { ...duneConfig, apiKey: '' },
        datasetName: duneConfig.datasetName,
      });
    } catch {
      setExecutionResult({
        code: 1,
        stdout: '',
        stderr: 'Network error fetching Dune CSV. Check CORS and connectivity.',
      });
    }
  };

  const handleExportPng = async () => {
    if (!plotRef.current) return;
    const currentLayout = plotRef.current.layout as Plotly.Layout | undefined;
    const previousRangeSlider = currentLayout?.xaxis?.rangeslider?.visible ?? true;
    try {
      await Plotly.relayout(plotRef.current, {
        'xaxis.rangeslider.visible': false,
      });
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
    } finally {
      await Plotly.relayout(plotRef.current, {
        'xaxis.rangeslider.visible': previousRangeSlider,
      });
    }
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
    parseCsvResponse(text);
  };

  const handleLabelChange = (field: keyof ChartLabels, value: string) => {
    const updated = { ...chartLabels, [field]: value };
    setChartLabels(updated);
    persistActiveSourceConfig({ chartLabels: updated });
  };

  const handleChartConfigChange = (updates: Partial<ChartConfig>) => {
    const updated = { ...chartConfig, ...updates };
    setChartConfig(updated);
    persistActiveSourceConfig({ chartConfig: updated });
  };

  const forgetDuneKey = () => {
    if (!duneConfig.queryId) return;
    removeStoredDuneKey(duneConfig.queryId);
    setDuneConfig((prev) => ({ ...prev, apiKey: '' }));
  };

  const columns = rawRows.length ? Object.keys(rawRows[0]) : [];

  const treemapAvailable = chartConfig.type === 'treemap';
  const treemapReady =
    treemapAvailable && chartConfig.treemap.labelField && chartConfig.treemap.valueField;

  return (
    <div className="min-h-screen p-6">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Data Visualization Workbench</h1>
          <p className="text-sm text-slate-500 dark:text-slate-300">
            Connect data sources, normalize time series, and export interactive charts.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            className="rounded-md border border-slate-200 px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-900"
            value={themeSetting}
            onChange={(event) =>
              setThemeSetting(event.target.value as 'light' | 'dark' | 'system')
            }
          >
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
          <span className="text-xs text-slate-500">Theme</span>
        </div>
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
            {activeSource?.type === 'dune' && duneConfig.queryId && (
              <button
                className="mt-3 w-full rounded-md border border-amber-300 px-3 py-2 text-xs text-amber-600"
                onClick={forgetDuneKey}
              >
                Forget stored API key
              </button>
            )}
            <div className="mt-4 border-t pt-4">
              <h3 className="text-sm font-semibold">Add Source</h3>
              <div className="mt-2 flex flex-wrap gap-2">
                {(['csv', 'csv-url', 'http', 'dune'] as SourceType[]).map((type) => (
                  <button
                    key={type}
                    className={`rounded-full px-3 py-1 text-xs font-medium ${
                      adapterType === type
                        ? 'bg-sky-500 text-white'
                        : 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-200'
                    }`}
                    onClick={() => setAdapterType(type)}
                  >
                    {type === 'csv-url' ? 'CSV URL' : type.toUpperCase()}
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
              Choose a source type and click Run to load data.
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
                </div>
                <button
                  className="mt-2 rounded-md bg-slate-900 px-2 py-1 text-xs text-white dark:bg-slate-100 dark:text-slate-900"
                  onClick={applySample}
                >
                  Load sample/sample.csv
                </button>
              </div>

              <div className="border-t border-slate-200 pt-4 dark:border-slate-700">
                <h3 className="font-medium">CSV URL</h3>
                <input
                  className="mt-2 w-full rounded-md border border-slate-200 px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-900"
                  placeholder="https://example.com/data.csv"
                  value={csvUrl}
                  onChange={(event) => setCsvUrl(event.target.value)}
                />
                <button
                  className="mt-2 w-full rounded-md bg-slate-700 px-2 py-2 text-sm font-semibold text-white"
                  onClick={runCsvUrlFetch}
                >
                  Fetch CSV URL
                </button>
              </div>

              <div className="border-t border-slate-200 pt-4 dark:border-slate-700">
                <h3 className="font-medium">Dune CSV</h3>
                <input
                  className="mt-2 w-full rounded-md border border-slate-200 px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-900"
                  placeholder="Query ID"
                  value={duneConfig.queryId}
                  onChange={(event) =>
                    setDuneConfig((prev) => ({ ...prev, queryId: event.target.value }))
                  }
                />
                <div className="mt-2 flex gap-2">
                  <input
                    className="flex-1 rounded-md border border-slate-200 px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-900"
                    placeholder="API Key"
                    type={showApiKey ? 'text' : 'password'}
                    value={duneConfig.apiKey}
                    onChange={(event) =>
                      setDuneConfig((prev) => ({ ...prev, apiKey: event.target.value }))
                    }
                  />
                  <button
                    className="rounded-md border border-slate-200 px-2 py-1 text-xs dark:border-slate-700"
                    onClick={() => setShowApiKey((prev) => !prev)}
                  >
                    {showApiKey ? 'Hide' : 'Show'}
                  </button>
                </div>
                <input
                  className="mt-2 w-full rounded-md border border-slate-200 px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-900"
                  placeholder="Dataset name (optional)"
                  value={duneConfig.datasetName}
                  onChange={(event) =>
                    setDuneConfig((prev) => ({ ...prev, datasetName: event.target.value }))
                  }
                />
                <label className="mt-2 flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={duneConfig.rememberKey}
                    onChange={(event) =>
                      setDuneConfig((prev) => ({
                        ...prev,
                        rememberKey: event.target.checked,
                      }))
                    }
                  />
                  Remember API key on this device
                </label>
                <button
                  className="mt-2 w-full rounded-md bg-emerald-500 px-2 py-2 text-sm font-semibold text-white"
                  onClick={runDuneFetch}
                >
                  Run Dune CSV
                </button>
                <button
                  className="mt-2 w-full rounded-md border border-slate-200 px-2 py-1 text-xs dark:border-slate-700"
                  onClick={() => {
                    const formula =
                      '=IMPORTDATA("https://api.dune.com/api/v1/query/{QUERY_ID}/results/csv?api_key=PASTE_YOUR_API_KEY")';
                    navigator.clipboard.writeText(formula);
                  }}
                >
                  Copy Google Sheets formula
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
            </div>

            {executionResult && (
              <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3 text-xs dark:border-slate-700 dark:bg-slate-900">
                <p className="font-semibold">Status</p>
                <pre className="mt-2 whitespace-pre-wrap text-slate-600 dark:text-slate-200">
                  {executionResult.stderr || executionResult.stdout}
                </pre>
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
            {chartConfig.type === 'treemap' && !treemapReady && (
              <div className="mt-4 rounded-md border border-dashed border-slate-300 p-4 text-sm text-slate-500">
                Select label and value fields in the Chart Settings panel to render the treemap.
              </div>
            )}
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
              <h3 className="text-sm font-semibold">Chart Settings</h3>
              <div className="mt-2 space-y-2 text-xs">
                <input
                  className="w-full rounded-md border border-slate-200 px-2 py-1 dark:border-slate-700 dark:bg-slate-900"
                  placeholder="Chart title"
                  value={chartLabels.title}
                  onChange={(event) => handleLabelChange('title', event.target.value)}
                />
                <input
                  className="w-full rounded-md border border-slate-200 px-2 py-1 dark:border-slate-700 dark:bg-slate-900"
                  placeholder="X axis label"
                  value={chartLabels.xLabel}
                  onChange={(event) => handleLabelChange('xLabel', event.target.value)}
                />
                <input
                  className="w-full rounded-md border border-slate-200 px-2 py-1 dark:border-slate-700 dark:bg-slate-900"
                  placeholder="Y axis label"
                  value={chartLabels.yLabel}
                  onChange={(event) => handleLabelChange('yLabel', event.target.value)}
                />
                <label className="text-xs text-slate-500">
                  Defaults: {resolvedTitle} • {resolvedXLabel} • {resolvedYLabel}
                </label>
              </div>
              <div className="mt-4 space-y-2 text-xs">
                <label className="block text-xs font-semibold">Chart Type</label>
                <select
                  className="w-full rounded-md border border-slate-200 px-2 py-1 dark:border-slate-700 dark:bg-slate-900"
                  value={chartConfig.type}
                  onChange={(event) =>
                    handleChartConfigChange({ type: event.target.value as ChartType })
                  }
                >
                  {['line', 'area', 'bar', 'scatter', 'treemap'].map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </div>
              {chartConfig.type === 'line' && (
                <div className="mt-3 space-y-2 text-xs">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={chartConfig.line.smooth}
                      onChange={(event) =>
                        handleChartConfigChange({
                          line: { ...chartConfig.line, smooth: event.target.checked },
                        })
                      }
                    />
                    Smooth lines
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={chartConfig.line.markers}
                      onChange={(event) =>
                        handleChartConfigChange({
                          line: { ...chartConfig.line, markers: event.target.checked },
                        })
                      }
                    />
                    Markers
                  </label>
                  <select
                    className="w-full rounded-md border border-slate-200 px-2 py-1 dark:border-slate-700 dark:bg-slate-900"
                    value={chartConfig.line.dash}
                    onChange={(event) =>
                      handleChartConfigChange({
                        line: {
                          ...chartConfig.line,
                          dash: event.target.value as ChartConfig['line']['dash'],
                        },
                      })
                    }
                  >
                    <option value="solid">Solid</option>
                    <option value="dash">Dash</option>
                    <option value="dot">Dot</option>
                  </select>
                </div>
              )}
              {chartConfig.type === 'area' && (
                <div className="mt-3 space-y-2 text-xs">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={chartConfig.area.stacked}
                      onChange={(event) =>
                        handleChartConfigChange({
                          area: { ...chartConfig.area, stacked: event.target.checked },
                        })
                      }
                    />
                    Stacked area
                  </label>
                  <label className="block">Opacity</label>
                  <input
                    type="range"
                    min={0.1}
                    max={1}
                    step={0.05}
                    value={chartConfig.area.opacity}
                    onChange={(event) =>
                      handleChartConfigChange({
                        area: { ...chartConfig.area, opacity: Number(event.target.value) },
                      })
                    }
                    className="w-full"
                  />
                </div>
              )}
              {chartConfig.type === 'bar' && (
                <div className="mt-3 space-y-2 text-xs">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={chartConfig.bar.stacked}
                      onChange={(event) =>
                        handleChartConfigChange({
                          bar: { ...chartConfig.bar, stacked: event.target.checked },
                        })
                      }
                    />
                    Stacked bars
                  </label>
                  <label className="block">Orientation</label>
                  <select
                    className="w-full rounded-md border border-slate-200 px-2 py-1 dark:border-slate-700 dark:bg-slate-900"
                    value={chartConfig.bar.orientation}
                    onChange={(event) =>
                      handleChartConfigChange({
                        bar: {
                          ...chartConfig.bar,
                          orientation: event.target.value as ChartConfig['bar']['orientation'],
                        },
                      })
                    }
                  >
                    <option value="v">Vertical</option>
                    <option value="h">Horizontal</option>
                  </select>
                </div>
              )}
              {chartConfig.type === 'scatter' && (
                <div className="mt-3 space-y-2 text-xs">
                  <label className="block">Marker size</label>
                  <input
                    type="range"
                    min={4}
                    max={20}
                    step={1}
                    value={chartConfig.scatter.markerSize}
                    onChange={(event) =>
                      handleChartConfigChange({
                        scatter: {
                          ...chartConfig.scatter,
                          markerSize: Number(event.target.value),
                        },
                      })
                    }
                    className="w-full"
                  />
                </div>
              )}
              {chartConfig.type === 'treemap' && (
                <div className="mt-3 space-y-2 text-xs">
                  <label className="block">Label field</label>
                  <select
                    className="w-full rounded-md border border-slate-200 px-2 py-1 dark:border-slate-700 dark:bg-slate-900"
                    value={chartConfig.treemap.labelField}
                    onChange={(event) =>
                      handleChartConfigChange({
                        treemap: {
                          ...chartConfig.treemap,
                          labelField: event.target.value,
                        },
                      })
                    }
                  >
                    <option value="">Select field</option>
                    {columns.map((col) => (
                      <option key={col} value={col}>
                        {col}
                      </option>
                    ))}
                  </select>
                  <label className="block">Value field</label>
                  <select
                    className="w-full rounded-md border border-slate-200 px-2 py-1 dark:border-slate-700 dark:bg-slate-900"
                    value={chartConfig.treemap.valueField}
                    onChange={(event) =>
                      handleChartConfigChange({
                        treemap: {
                          ...chartConfig.treemap,
                          valueField: event.target.value,
                        },
                      })
                    }
                  >
                    <option value="">Select field</option>
                    {columns.map((col) => (
                      <option key={col} value={col}>
                        {col}
                      </option>
                    ))}
                  </select>
                  <label className="block">Group field (optional)</label>
                  <select
                    className="w-full rounded-md border border-slate-200 px-2 py-1 dark:border-slate-700 dark:bg-slate-900"
                    value={chartConfig.treemap.groupField}
                    onChange={(event) =>
                      handleChartConfigChange({
                        treemap: {
                          ...chartConfig.treemap,
                          groupField: event.target.value,
                        },
                      })
                    }
                  >
                    <option value="">None</option>
                    {columns.map((col) => (
                      <option key={col} value={col}>
                        {col}
                      </option>
                    ))}
                  </select>
                </div>
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
