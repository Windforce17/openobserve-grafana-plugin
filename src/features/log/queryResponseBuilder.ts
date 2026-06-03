import {
  FieldColorModeId,
  FieldType,
  DataFrame,
  Field,
  TraceKeyValuePair,
  TraceLog,
  TraceSpanReference,
} from '@grafana/data';
import { MyDataSourceOptions, MyQuery } from '../../types';
import { convertTimeToMs, getFieldType } from '../../utils/zincutils';

/**
 * Checks if a value looks like a timestamp by examining its format
 */
const isTimestampValue = (value: any): boolean => {
  if (value === null || value === undefined) {
    return false;
  }

  // Check if it's a large number (timestamp in ms or microseconds)
  // Timestamps are typically > 1 billion (after Sep 2001)
  if (typeof value === 'number' && value > 1_000_000_000) {
    return true;
  }

  // Check if it's an ISO 8601 date string (e.g., "2025-12-08T09:34:50")
  if (typeof value === 'string') {
    const isoDatePattern = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}/;
    if (isoDatePattern.test(value)) {
      return true;
    }

    // Also check if it's a valid date string that can be parsed
    const dateTest = new Date(value);
    if (!isNaN(dateTest.getTime()) && value.length >= 10) {
      return true;
    }
  }

  return false;
};

/**
 * Detects which field is the timestamp by checking actual values
 */
const detectTimestampField = (data: any[]): string | null => {
  if (!data || data.length === 0) {
    return null;
  }

  const firstRow = data[0];
  const fields = Object.keys(firstRow);

  // Check each field's value to see if it looks like a timestamp
  for (const field of fields) {
    const value = firstRow[field];
    if (isTimestampValue(value)) {
      return field;
    }
  }

  return null;
};

/**
 * Gets field names from response data
 */
const getFieldsFromData = (data: any[]): string[] => {
  if (!data || data.length === 0) {
    return [];
  }
  return Object.keys(data[0]);
};

/**
 * Infers Grafana field type from a value
 */
const inferFieldType = (value: any): FieldType => {
  if (value === null || value === undefined) {
    return FieldType.string;
  }
  if (typeof value === 'number') {
    return FieldType.number;
  }
  if (typeof value === 'boolean') {
    return FieldType.boolean;
  }
  return FieldType.string;
};

/**
 * Converts various timestamp formats to milliseconds
 */
const convertToTimeMs = (value: any): number => {
  if (typeof value === 'number') {
    // Check if it's in microseconds (> 500 billion)
    if (value > 500_000_000_000) {
      return convertTimeToMs(value);
    }
    // Check if it's in seconds (< 10 billion, roughly year 2286)
    if (value < 10_000_000_000) {
      return value * 1000;
    }
    // Already in milliseconds
    return value;
  }

  // Handle ISO 8601 date strings like "2025-12-08T09:34:50"
  if (typeof value === 'string') {
    // Add 'Z' if no timezone info to treat as UTC
    const dateString = value.includes('Z') || value.includes('+') || value.match(/-\d{2}:\d{2}$/)
      ? value
      : value + 'Z';
    return new Date(dateString).getTime();
  }

  return new Date(value).getTime();
};

const toNumber = (value: any): number | undefined => {
  if (value === null || value === undefined || value === '') {
    return undefined;
  }
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : undefined;
};

const convertTraceTimestampToMs = (value: any): number => {
  const numberValue = toNumber(value);
  if (numberValue !== undefined) {
    if (numberValue > 100_000_000_000_000) {
      return numberValue / 1_000_000;
    }
    if (numberValue > 100_000_000_000) {
      return numberValue / 1_000;
    }
    if (numberValue < 10_000_000_000) {
      return numberValue * 1000;
    }
    return numberValue;
  }

  return convertToTimeMs(value);
};

const parseJsonArray = (value: any): any[] => {
  if (Array.isArray(value)) {
    return value;
  }
  if (!value || typeof value !== 'string') {
    return [];
  }
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
};

const getFirstValue = (row: any, keys: string[], fallback = ''): any => {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && row[key] !== '') {
      return row[key];
    }
  }
  return fallback;
};

const getDurationMs = (row: any): number => {
  const spanDurationNano = toNumber(row.span_duration_nano);
  if (spanDurationNano !== undefined) {
    return spanDurationNano / 1_000_000;
  }

  const start = toNumber(getFirstValue(row, ['_start_time_ns', 'start_time']));
  const end = toNumber(getFirstValue(row, ['_end_time_ns', 'end_time']));
  if (start !== undefined && end !== undefined && end >= start) {
    return (end - start) / 1_000_000;
  }

  const duration = toNumber(row.duration);
  if (duration !== undefined) {
    if (duration > 1_000_000) {
      return duration / 1_000_000;
    }
    if (duration > 1_000) {
      return duration / 1_000;
    }
    return duration;
  }

  return 0;
};

const spanKindMap: Record<string, string> = {
  '1': 'internal',
  '2': 'server',
  '3': 'client',
  '4': 'producer',
  '5': 'consumer',
};

const getSpanKind = (value: any): string | undefined => {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  const key = String(value).toLowerCase();
  return spanKindMap[key] || key.replace('span_kind_', '').toLowerCase();
};

const toTags = (row: any, predicate: (key: string) => boolean): TraceKeyValuePair[] => {
  return Object.keys(row)
    .filter((key) => predicate(key) && row[key] !== undefined && row[key] !== null)
    .map((key) => ({ key, value: row[key] }));
};

const getTraceLogs = (row: any): TraceLog[] => {
  return parseJsonArray(row.events).map((event: any) => {
    const fields = Array.isArray(event.fields)
      ? event.fields
      : Array.isArray(event.attributes)
      ? event.attributes.map((attribute: any) => ({ key: attribute.key, value: attribute.value ?? attribute }))
      : toTags(event, (key) => !['timestamp', 'time', 'timeUnixNano', 'name'].includes(key));

    return {
      timestamp: convertTraceTimestampToMs(event.timestamp ?? event.time ?? event.timeUnixNano ?? row.start_time ?? row._timestamp),
      name: event.name,
      fields,
    };
  });
};

const getTraceReferences = (row: any): TraceSpanReference[] => {
  const references = parseJsonArray(row.links).map((link: any) => ({
    traceID: String(link.traceID ?? link.traceId ?? link.trace_id ?? row.trace_id ?? ''),
    spanID: String(link.spanID ?? link.spanId ?? link.span_id ?? ''),
    tags: Array.isArray(link.tags) ? link.tags : toTags(link, (key) => !['traceID', 'traceId', 'trace_id', 'spanID', 'spanId', 'span_id'].includes(key)),
  }));

  const parentTraceID = getFirstValue(row, ['reference_parent_trace_id'], '');
  const parentSpanID = getFirstValue(row, ['reference_parent_span_id'], '');
  if (parentTraceID && parentSpanID) {
    references.push({ traceID: String(parentTraceID), spanID: String(parentSpanID), tags: [] });
  }

  return references;
};

const coreTraceFields = new Set([
  '_timestamp',
  'trace_id',
  'traceID',
  'traceId',
  'span_id',
  'spanID',
  'spanId',
  'reference_parent_span_id',
  'parent_span_id',
  'parentSpanID',
  'operation_name',
  'operationName',
  'name',
  'service_name',
  'serviceName',
  'service_namespace',
  'serviceNamespace',
  'start_time',
  '_start_time_ns',
  'end_time',
  '_end_time_ns',
  'duration',
  'span_duration_nano',
  'events',
  'links',
  'span_kind',
  'kind',
  'span_status',
  'status_code',
  'statusCode',
  'status_message',
  'statusMessage',
  'trace_state',
  'traceState',
  'instrumentation_library_name',
  'instrumentationLibraryName',
  'instrumentation_library_version',
  'instrumentationLibraryVersion',
]);

interface TraceFieldNames {
  traceId: string;
  spanId: string;
  parentSpanId: string;
  service: string;
  operation: string;
  status: string;
}

/**
 * Resolves the span field names from the datasource config so trace/service-map parsing uses
 * the exact same columns the SQL query filters on. Defaults match OpenObserve's trace schema
 * (service_name, operation_name, span_id, reference_parent_span_id, ...).
 */
const resolveTraceFields = (jsonData?: MyDataSourceOptions): TraceFieldNames => ({
  traceId: jsonData?.trace_id_field?.trim() || 'trace_id',
  spanId: jsonData?.span_id_field?.trim() || 'span_id',
  parentSpanId: 'reference_parent_span_id',
  service: jsonData?.service_name_field?.trim() || 'service_name',
  operation: jsonData?.span_name_field?.trim() || 'operation_name',
  status: jsonData?.status_field?.trim() || 'status_code',
});

// Normalizes the span status into a numeric OTEL code, handling both the numeric `status_code`
// and the string `span_status` ("OK" | "ERROR" | "UNSET") forms OpenObserve emits.
const getStatusCode = (span: any, fields: TraceFieldNames): number | undefined => {
  const numeric = toNumber(getFirstValue(span, [fields.status, 'status_code', 'statusCode']));
  if (numeric !== undefined) {
    return numeric;
  }
  const text = String(getFirstValue(span, ['span_status', 'status', 'status_message'], '')).toUpperCase();
  if (text === 'ERROR') {
    return 2;
  }
  if (text === 'OK') {
    return 1;
  }
  if (text === 'UNSET') {
    return 0;
  }
  return undefined;
};

const isErrorStatusCode = (code: number | undefined): boolean => code === 2 || (code !== undefined && code >= 400);

export const getLogsDataFrame = (
  data: any,
  target: MyQuery,
  streamFields: any = [],
  timestampColumn = '_timestamp'
): DataFrame => {
  // Build fields array
  const fields: Field[] = [
    {
      name: 'Time',
      type: FieldType.time,
      config: {},
      values: [],
    },
    {
      name: 'Content',
      type: FieldType.string,
      config: {},
      values: [],
    },
  ];

  // Add stream fields
  streamFields.forEach((field: any) => {
    fields.push({
      name: field.name,
      type: getFieldType(field.type),
      config: {},
      values: [],
    });
  });

  // Populate field values
  data.forEach((log: any) => {
    fields[0].values.push(convertToTimeMs(log[timestampColumn])); // Time
    fields[1].values.push(JSON.stringify(log)); // Content

    // Add stream field values
    streamFields.forEach((field: any, index: number) => {
      fields[index + 2].values.push(log[field.name]);
    });
  });

  return {
    refId: target.refId,
    meta: {
      preferredVisualisationType: 'logs',
    },
    fields,
    length: data.length,
  };
};

export const getTraceDataFrame = (data: any[], target: MyQuery, jsonData?: MyDataSourceOptions): DataFrame => {
  const traceFields = resolveTraceFields(jsonData);
  const fields: Field[] = [
    { name: 'traceID', type: FieldType.string, config: {}, values: [] },
    { name: 'spanID', type: FieldType.string, config: {}, values: [] },
    { name: 'parentSpanID', type: FieldType.string, config: {}, values: [] },
    { name: 'operationName', type: FieldType.string, config: {}, values: [] },
    { name: 'serviceName', type: FieldType.string, config: {}, values: [] },
    { name: 'serviceNamespace', type: FieldType.string, config: {}, values: [] },
    { name: 'kind', type: FieldType.string, config: {}, values: [] },
    { name: 'statusCode', type: FieldType.number, config: {}, values: [] },
    { name: 'statusMessage', type: FieldType.string, config: {}, values: [] },
    { name: 'instrumentationLibraryName', type: FieldType.string, config: {}, values: [] },
    { name: 'instrumentationLibraryVersion', type: FieldType.string, config: {}, values: [] },
    { name: 'traceState', type: FieldType.string, config: {}, values: [] },
    { name: 'serviceTags', type: FieldType.other, config: {}, values: [] },
    { name: 'startTime', type: FieldType.number, config: {}, values: [] },
    { name: 'duration', type: FieldType.number, config: {}, values: [] },
    { name: 'logs', type: FieldType.other, config: {}, values: [] },
    { name: 'references', type: FieldType.other, config: {}, values: [] },
    { name: 'tags', type: FieldType.other, config: {}, values: [] },
  ];

  data.forEach((span: any) => {
    const traceID = String(getFirstValue(span, [traceFields.traceId, 'traceID', 'traceId']));
    const spanID = String(getFirstValue(span, [traceFields.spanId, 'spanID', 'spanId']));
    const parentSpanID = String(getFirstValue(span, [traceFields.parentSpanId, 'parent_span_id', 'parentSpanID'], ''));
    const statusCode = getStatusCode(span, traceFields);
    const spanTags = toTags(span, (key) => !coreTraceFields.has(key) && !key.startsWith('service_'));

    if (statusCode && statusCode > 0) {
      spanTags.push({ key: 'error', value: isErrorStatusCode(statusCode) });
    }

    const values = [
      traceID,
      spanID,
      parentSpanID,
      String(getFirstValue(span, [traceFields.operation, 'operationName'])),
      String(getFirstValue(span, [traceFields.service, 'serviceName'], 'unknown_service')),
      getFirstValue(span, ['service_namespace', 'serviceNamespace'], undefined),
      getSpanKind(getFirstValue(span, ['span_kind', 'kind'], undefined)),
      statusCode,
      getFirstValue(span, ['status_message', 'statusMessage', 'span_status'], ''),
      getFirstValue(span, ['instrumentation_library_name', 'instrumentationLibraryName'], undefined),
      getFirstValue(span, ['instrumentation_library_version', 'instrumentationLibraryVersion'], undefined),
      getFirstValue(span, ['trace_state', 'traceState'], undefined),
      toTags(span, (key) => key.startsWith('service_')),
      convertTraceTimestampToMs(getFirstValue(span, ['_start_time_ns', 'start_time', '_timestamp'])),
      getDurationMs(span),
      getTraceLogs(span),
      getTraceReferences(span),
      spanTags,
    ];

    values.forEach((value, index) => fields[index].values.push(value));
  });

  return {
    refId: target.refId,
    meta: {
      preferredVisualisationType: 'trace',
      custom: {
        traceFormat: 'openobserve',
      },
    },
    fields,
    length: data.length,
  };
};

interface TraceTableLink {
  datasourceUid?: string;
  datasourceName?: string;
}

const getParentSpanId = (span: any, fields: TraceFieldNames): string =>
  String(getFirstValue(span, [fields.parentSpanId, 'parent_span_id', 'parentSpanID'], ''));

/**
 * Aggregates flat span rows into one row per trace so trace search can be rendered as a
 * table. The trace ID column carries an internal data link that opens the full trace
 * (queryType `trace_id`) when clicked, matching the Tempo-style search experience.
 */
export const getTracesTableDataFrame = (
  data: any[],
  target: MyQuery,
  link: TraceTableLink = {},
  jsonData?: MyDataSourceOptions
): DataFrame => {
  const traceFields = resolveTraceFields(jsonData);
  const traces = new Map<string, any[]>();

  for (const span of data) {
    const traceID = String(getFirstValue(span, [traceFields.traceId, 'traceID', 'traceId'], ''));
    if (!traceID) {
      continue;
    }
    const spans = traces.get(traceID);
    if (spans) {
      spans.push(span);
    } else {
      traces.set(traceID, [span]);
    }
  }

  const rows = Array.from(traces.entries()).map(([traceID, spans]) => {
    const starts = spans.map((span) =>
      convertTraceTimestampToMs(getFirstValue(span, ['_start_time_ns', 'start_time', '_timestamp']))
    );
    const minStart = Math.min(...starts);

    // Prefer the root span (no parent); fall back to the earliest span in the trace.
    let root = spans.find((span) => !getParentSpanId(span, traceFields));
    if (!root) {
      const earliestIndex = starts.indexOf(minStart);
      root = spans[earliestIndex >= 0 ? earliestIndex : 0];
    }

    let maxEnd = minStart;
    spans.forEach((span, index) => {
      const end = starts[index] + getDurationMs(span);
      if (end > maxEnd) {
        maxEnd = end;
      }
    });

    const rootDuration = getDurationMs(root);
    const duration = rootDuration > 0 ? rootDuration : maxEnd - minStart;
    const service = String(getFirstValue(root, [traceFields.service, 'serviceName'], 'unknown_service'));
    const operation = String(getFirstValue(root, [traceFields.operation, 'operationName'], ''));

    return {
      traceID,
      traceName: operation ? `${service}: ${operation}` : service,
      startTime: minStart,
      duration,
      spanCount: spans.length,
    };
  });

  // Most recent traces first.
  rows.sort((a, b) => b.startTime - a.startTime);

  const traceIdLinks = link.datasourceUid
    ? [
        {
          title: 'View trace ${__value.raw}',
          url: '',
          internal: {
            datasourceUid: link.datasourceUid,
            datasourceName: link.datasourceName || '',
            query: {
              refId: target.refId,
              queryType: 'trace_id',
              streamType: 'traces',
              displayMode: 'trace',
              traceId: '${__value.raw}',
              query: '${__value.raw}',
              stream: target.stream,
              organization: target.organization,
              sqlMode: false,
            },
          },
        },
      ]
    : undefined;

  const fields: Field[] = [
    {
      name: 'traceID',
      type: FieldType.string,
      config: { displayNameFromDS: 'Trace ID', ...(traceIdLinks ? { links: traceIdLinks } : {}) },
      values: rows.map((row) => row.traceID),
    },
    {
      name: 'traceName',
      type: FieldType.string,
      config: { displayNameFromDS: 'Trace name' },
      values: rows.map((row) => row.traceName),
    },
    {
      name: 'startTime',
      type: FieldType.time,
      config: { displayNameFromDS: 'Start time' },
      values: rows.map((row) => row.startTime),
    },
    {
      name: 'duration',
      type: FieldType.number,
      config: { displayNameFromDS: 'Duration', unit: 'ms' },
      values: rows.map((row) => row.duration),
    },
    {
      name: 'spanCount',
      type: FieldType.number,
      config: { displayNameFromDS: 'Spans' },
      values: rows.map((row) => row.spanCount),
    },
  ];

  return {
    refId: target.refId,
    meta: {
      preferredVisualisationType: 'table',
    },
    fields,
    length: rows.length,
  };
};

/**
 * Builds a generic table frame from arbitrary result rows. Used for aggregation queries
 * such as the field "top values" (GROUP BY field, COUNT) so the result renders as a table
 * instead of a logs stream.
 */
// Column names produced by OpenObserve / our dashboard SQL that should be treated as the time axis.
const TIME_COLUMN_NAMES = new Set(['time', '_timestamp', 'timestamp', 'zo_sql_key', 'x_axis_1']);

const looksLikeIsoDate = (value: any): boolean =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}/.test(value);

export const getTableDataFrame = (data: any[], target: MyQuery): DataFrame => {
  const fieldNames = data.length ? Object.keys(data[0]) : [];

  const fields: Field[] = fieldNames.map((name) => {
    const sample = data.find((row) => row[name] !== null && row[name] !== undefined)?.[name];

    // Detect the time axis by column name (e.g. `histogram(...) AS time`) or an ISO timestamp value.
    // We deliberately do NOT treat any large integer as time, so a big COUNT/SUM column is not
    // mistaken for a timestamp. This lets the same table frame drive time series panels too.
    const isTime = TIME_COLUMN_NAMES.has(name.toLowerCase()) || looksLikeIsoDate(sample);
    if (isTime) {
      return {
        name,
        type: FieldType.time,
        config: {},
        values: data.map((row) => {
          const value = row[name];
          return value === null || value === undefined ? null : convertToTimeMs(value);
        }),
      };
    }

    return {
      name,
      type: inferFieldType(sample),
      config: {},
      values: data.map((row) => row[name]),
    };
  });

  return {
    refId: target.refId,
    meta: {
      preferredVisualisationType: 'table',
    },
    fields,
    length: data.length,
  };
};

/**
 * Builds a Grafana node graph (nodes + edges frames) from server-side aggregated rows:
 *  - nodeRows: one row per service (service_name, span_count, error_count)
 *  - edgeRows: one row per caller -> callee pair (source, target, call_count)
 * Aggregating in SQL means every service/edge in the time range is represented, instead of
 * only the services that happened to appear in the most recent N spans.
 */
export const buildServiceMapFromAggregates = (
  nodeRows: any[],
  edgeRows: any[],
  target: MyQuery
): DataFrame[] => {
  const nodes = new Map<string, { count: number; errors: number }>();
  const touchNode = (service: string) => {
    let node = nodes.get(service);
    if (!node) {
      node = { count: 0, errors: 0 };
      nodes.set(service, node);
    }
    return node;
  };

  for (const row of nodeRows) {
    const service = String(getFirstValue(row, ['service_name', 'serviceName'], '')) || 'unknown_service';
    const node = touchNode(service);
    node.count += toNumber(getFirstValue(row, ['span_count', 'count'])) ?? 0;
    node.errors += toNumber(getFirstValue(row, ['error_count'])) ?? 0;
  }

  const edges = edgeRows
    .map((row) => ({
      source: String(getFirstValue(row, ['source'], '')),
      target: String(getFirstValue(row, ['target'], '')),
      count: toNumber(getFirstValue(row, ['call_count', 'count'])) ?? 0,
    }))
    .filter((edge) => edge.source && edge.target && edge.source !== edge.target);

  // Edge endpoints must exist as nodes for the graph to render.
  edges.forEach((edge) => {
    touchNode(edge.source);
    touchNode(edge.target);
  });

  const nodeEntries = Array.from(nodes.entries());
  const successArc = { mode: FieldColorModeId.Fixed, fixedColor: 'green' };
  const errorArc = { mode: FieldColorModeId.Fixed, fixedColor: 'red' };

  const nodesFrame: DataFrame = {
    name: 'nodes',
    refId: target.refId,
    meta: { preferredVisualisationType: 'nodeGraph' },
    fields: [
      { name: 'id', type: FieldType.string, config: {}, values: nodeEntries.map(([service]) => service) },
      { name: 'title', type: FieldType.string, config: {}, values: nodeEntries.map(([service]) => service) },
      {
        name: 'mainstat',
        type: FieldType.number,
        config: { displayName: 'Spans' },
        values: nodeEntries.map(([, node]) => node.count),
      },
      {
        name: 'secondarystat',
        type: FieldType.number,
        config: { displayName: 'Error rate', unit: 'percent' },
        values: nodeEntries.map(([, node]) => (node.count ? (node.errors / node.count) * 100 : 0)),
      },
      {
        name: 'arc__success',
        type: FieldType.number,
        config: { displayName: 'Success', color: successArc },
        values: nodeEntries.map(([, node]) => (node.count ? (node.count - node.errors) / node.count : 1)),
      },
      {
        name: 'arc__error',
        type: FieldType.number,
        config: { displayName: 'Error', color: errorArc },
        values: nodeEntries.map(([, node]) => (node.count ? node.errors / node.count : 0)),
      },
    ],
    length: nodeEntries.length,
  };

  const edgesFrame: DataFrame = {
    name: 'edges',
    refId: target.refId,
    meta: { preferredVisualisationType: 'nodeGraph' },
    fields: [
      {
        name: 'id',
        type: FieldType.string,
        config: {},
        values: edges.map((edge) => `${edge.source}->${edge.target}`),
      },
      { name: 'source', type: FieldType.string, config: {}, values: edges.map((edge) => edge.source) },
      { name: 'target', type: FieldType.string, config: {}, values: edges.map((edge) => edge.target) },
      {
        name: 'mainstat',
        type: FieldType.number,
        config: { displayName: 'Calls' },
        values: edges.map((edge) => edge.count),
      },
    ],
    length: edges.length,
  };

  return [nodesFrame, edgesFrame];
};

export const getGraphDataFrame = (
  data: any,
  target: MyQuery,
  app: string,
  timestampColumn = '_timestamp'
): DataFrame => {
  // Get actual fields from response data instead of hardcoding
  let fieldNames = data.length > 0 ? getFieldsFromData(data) : [];

  // Detect which field is the timestamp by checking values
  const detectedTimeField = detectTimestampField(data);
  const timeFieldName = detectedTimeField || timestampColumn;

  // If no data, use default fields for empty state
  if (!fieldNames.length) {
    fieldNames = ['zo_sql_key', 'zo_sql_num', 'x_axis_1'];
  }

  // Build fields array
  const fields: Field[] = [];

  for (let i = 0; i < fieldNames.length; i++) {
    const fieldName = fieldNames[i];
    const isTime = fieldName === timeFieldName;

    if (isTime) {
      fields.push({
        name: 'Time',
        type: FieldType.time,
        config: { filterable: true },
        values: [],
      });
    } else {
      // Infer type from first row value
      const fieldType = data.length > 0 ? inferFieldType(data[0][fieldName]) : FieldType.number;
      fields.push({
        name: fieldName,
        type: fieldType,
        config: {},
        values: [],
      });
    }
  }

  // Populate field values
  data.forEach((log: any) => {
    const processedRow = getField(log, fieldNames, timeFieldName);

    fields.forEach((field) => {
      const fieldName = field.name === 'Time' ? 'Time' : field.name;
      field.values.push(processedRow[fieldName]);
    });
  });

  return {
    refId: target.refId,
    meta: {
      preferredVisualisationType: 'graph',
    },
    fields,
    length: data.length,
  };
};

const getField = (log: any, columns: any, timestampColumn: string) => {
  let field: any = {};

  for (let i = 0; i < columns.length; i++) {
    let col_name = columns[i];
    let col_value = log[col_name];

    // Check if this column is the timestamp column
    if (col_name === timestampColumn) {
      // Use the helper function to handle all timestamp formats
      field['Time'] = convertToTimeMs(col_value);
    } else {
      field[col_name] = log[col_name];
    }
  }

  return field;
};
