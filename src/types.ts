export type SourceType = 'csv' | 'http' | 'dune' | 'csv-url';

export interface DataSource {
  id: string;
  name: string;
  type: SourceType;
  config: Record<string, unknown>;
  createdAt: string;
}

export interface NormalizationConfig {
  timeField: string;
  numericFields: string[];
  renameMap: Record<string, string>;
  unitsMap: Record<string, string>;
}

export interface CanonicalRow {
  timestamp: Date;
  series: Record<string, number>;
  meta?: Record<string, unknown>;
}

export interface ExecutionResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export interface WatermarkConfig {
  src: string | null;
  opacity: number;
  scale: number;
  position: 'center' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
}

export type ChartType = 'line' | 'area' | 'bar' | 'scatter' | 'treemap' | 'pie';

export interface ChartLabels {
  title: string;
  xLabel: string;
  yLabel: string;
}

export interface ChartConfig {
  type: ChartType;
  line: {
    smooth: boolean;
    markers: boolean;
    dash: 'solid' | 'dash' | 'dot';
  };
  area: {
    stacked: boolean;
    opacity: number;
  };
  bar: {
    mode: 'group' | 'stack';
    orientation: 'v' | 'h';
  };
  scatter: {
    markerSize: number;
  };
  treemap: {
    labelField: string;
    valueField: string;
    groupField: string;
  };
  pie: {
    hole: number;
  };
}

export type Aggregation = 'sum' | 'avg' | 'min' | 'max' | 'count' | 'last';

export interface DataMapping {
  xField: string;
  yField: string;
  groupField: string;
  aggregation: Aggregation;
  timeGranularity: 'day' | 'week' | 'month';
  valueMode: 'absolute' | 'percent';
  stackTo100: boolean;
  sortBy: 'none' | 'x' | 'value-desc';
  topN: number;
  otherLabel: string;
  filterField: string;
  filterValue: string;
}
