import { DataSourceJsonData } from '@grafana/data';
import { DataQuery } from '@grafana/schema';

export type OpenObserveStreamType = 'logs' | 'metrics' | 'traces' | 'enrichment_tables';
export type OpenObserveQueryType = 'logs' | 'traces' | 'trace_id' | 'service_graph';
export type OpenObserveFilterOperator = '=' | '!=' | 'LIKE' | 'NOT LIKE';

export interface MyQuery extends DataQuery {
  query: string;
  constant: number;
  stream: string;
  streamType?: OpenObserveStreamType;
  queryType?: OpenObserveQueryType;
  startTimeInMicro?: number;
  endTimeInMicro?: number;
  sqlMode: boolean;
  organization: string;
  pagination?: {
    rows: number;
  };
  streamFields: any[];
  displayMode?: 'auto' | 'graph' | 'logs' | 'trace';
  logQuery?: string;
  fullText?: string;
  aggregateField?: string;
  topK?: number;
  fastMode?: boolean;
  traceId?: string;
  serviceName?: string;
  spanName?: string;
  status?: string;
  durationScope?: 'span' | 'trace';
  durationOperator?: '>' | '>=' | '<' | '<=' | '=';
  durationValue?: string;
  tagScope?: 'span' | 'resource';
  tagKey?: string;
  tagOperator?: OpenObserveFilterOperator;
  tagValue?: string;
  advancedTraceSql?: string;
  /**
   * Per-target "compare to previous period" offset (e.g. "1d", "7d", or a bare microsecond count).
   * When set, this target's start_time/end_time are shifted back by the offset (so the query stays
   * partition-pruned) and the returned timestamps are shifted forward by the same amount, so the
   * previous-period series aligns on the current time axis for overlay/comparison panels.
   */
  compareOffset?: string;
  /**
   * Result shape for dashboard panels. Defaults to a single table frame. Set to "timeseries" for a
   * time-bucketed group-by query (e.g. `histogram(_timestamp) AS time, service_name, COUNT(*)`) to
   * get labeled multi-series frames (one series per group) instead — required for sparkline tables
   * built with the "Time series to table" transformation.
   */
  format?: 'table' | 'timeseries';
}

export const DEFAULT_QUERY: Partial<MyQuery> = {
  constant: 6.5,
  streamType: 'logs',
  queryType: 'logs',
  displayMode: 'logs',
  durationScope: 'span',
  durationOperator: '>',
  tagScope: 'span',
  tagOperator: '=',
  topK: 10,
};

/**
 * These are options configured for each DataSource instance
 */
export interface MyDataSourceOptions extends DataSourceJsonData {
  path?: string;
  url: string;
  timestamp_column: string;
  default_organization?: string;
  default_log_stream?: string;
  default_trace_stream?: string;
  trace_id_field?: string;
  span_id_field?: string;
  service_name_field?: string;
  span_name_field?: string;
  status_field?: string;
  duration_field?: string;
}

/**
 * Value that is used in the backend, but never sent over HTTP to the frontend
 */
export interface MySecureJsonData {
  apiKey?: string;
}

export interface TimeRange {
  startTimeInMicro: number;
  endTimeInMirco: number;
}

export interface CachedQuery {
  requestQuery: string;
  data: Promise<any> | null;
  isFetching: boolean;
  promise: {
    resolve: (value: unknown) => void;
    reject: (value: unknown) => void;
  } | null;
}
