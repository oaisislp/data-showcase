import Papa from 'papaparse';
import { JSONPath } from 'jsonpath-plus';
import { CanonicalRow, NormalizationConfig } from '../types';

export const parseCsv = (csvText: string): Record<string, string>[] => {
  const result = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
  });
  return result.data.filter((row) => Object.keys(row).length > 0);
};

export const detectTimeField = (rows: Record<string, unknown>[]) => {
  if (!rows.length) return '';
  const keys = Object.keys(rows[0]);
  const timeByName = keys.find((key) => key.toLowerCase().includes('time'));
  if (timeByName) return timeByName;
  return (
    keys.find((key) => {
      const sample = rows[0][key];
      return parseTimestamp(sample) !== null;
    }) ?? ''
  );
};

export const detectNumericFields = (
  rows: Record<string, unknown>[],
  timeField: string
) => {
  if (!rows.length) return [];
  return Object.keys(rows[0]).filter((key) => {
    if (key === timeField) return false;
    const sample = rows[0][key];
    return typeof sample === 'number' || !Number.isNaN(Number(sample));
  });
};

export const parseTimestamp = (value: unknown): Date | null => {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'number') {
    const ms = value > 10_000_000_000 ? value : value * 1000;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const asNumber = Number(trimmed);
    if (!Number.isNaN(asNumber)) {
      return parseTimestamp(asNumber);
    }
    const date = new Date(trimmed);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
};

export const normalizeRows = (
  rows: Record<string, unknown>[],
  config: NormalizationConfig
): CanonicalRow[] => {
  return rows
    .map((row) => {
      const timestamp = parseTimestamp(row[config.timeField]);
      if (!timestamp) return null;
      const series: Record<string, number> = {};
      config.numericFields.forEach((field) => {
        const raw = row[field];
        const numeric = typeof raw === 'number' ? raw : Number(raw);
        if (!Number.isNaN(numeric)) {
          const name = config.renameMap[field] || field;
          series[name] = numeric;
        }
      });
      return {
        timestamp,
        series,
        meta: row,
      };
    })
    .filter(Boolean) as CanonicalRow[];
};

export const extractJsonRows = (
  json: unknown,
  jsonPath: string
): Record<string, unknown>[] => {
  if (!jsonPath) {
    return Array.isArray(json) ? (json as Record<string, unknown>[]) : [];
  }
  const matches = JSONPath({ path: jsonPath, json });
  const rows = matches.flatMap((match) => {
    if (Array.isArray(match)) return match;
    return match;
  });
  return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
};

export const toCsv = (rows: CanonicalRow[], seriesKeys: string[]) => {
  const header = ['timestamp', ...seriesKeys];
  const lines = [header.join(',')];
  rows.forEach((row) => {
    const values = [row.timestamp.toISOString()];
    seriesKeys.forEach((key) => {
      const value = row.series[key];
      values.push(value === undefined ? '' : String(value));
    });
    lines.push(values.join(','));
  });
  return lines.join('\n');
};

export const summaryStats = (rows: CanonicalRow[]) => {
  if (!rows.length) {
    return { rowCount: 0, start: null, end: null };
  }
  const timestamps = rows.map((row) => row.timestamp.getTime());
  const min = Math.min(...timestamps);
  const max = Math.max(...timestamps);
  return { rowCount: rows.length, start: new Date(min), end: new Date(max) };
};
