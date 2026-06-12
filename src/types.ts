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
