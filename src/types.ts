export type SourceType = 'csv' | 'http' | 'shell' | 'python' | 'node';

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
