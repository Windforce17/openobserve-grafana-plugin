import {
  MyDataSourceOptions,
  MyQuery,
  OpenObserveFilterOperator,
  OpenObserveQueryType,
  TimeRange,
} from '../../types';

const TRACE_ID_PATTERN = /^[0-9a-fA-F]{16,32}$/;

// OpenObserve query timeout in seconds (3 minutes).
const QUERY_TIMEOUT_SECONDS = 180;

const escapeSqlString = (value: string) => value.replace(/'/g, "''");

const quoteIdentifier = (value: string) => `"${value.replace(/"/g, '""')}"`;

const isFullSql = (value: string) => /^\s*(select|with)\b/i.test(value);

const isBlank = (value?: string) => !value || !value.trim();

const getQueryType = (queryData: MyQuery): OpenObserveQueryType => {
  if (queryData.queryType) {
    return queryData.queryType;
  }
  if (queryData.streamType === 'traces' || queryData.displayMode === 'trace') {
    return 'traces';
  }
  return 'logs';
};

const getSetting = (jsonData: MyDataSourceOptions | undefined, key: keyof MyDataSourceOptions, fallback: string) => {
  const value = jsonData?.[key];
  return typeof value === 'string' && value.trim() ? value : fallback;
};

const getDefaultStream = (queryData: MyQuery, queryType: OpenObserveQueryType, jsonData?: MyDataSourceOptions) => {
  if (!isBlank(queryData.stream)) {
    return queryData.stream.trim();
  }

  if (queryType === 'logs') {
    return getSetting(jsonData, 'default_log_stream', 'default');
  }

  return getSetting(jsonData, 'default_trace_stream', 'default');
};

const formatValue = (value: string) => `'${escapeSqlString(value)}'`;

const normalizeLikeValue = (operator: string, value: string) => {
  if (!operator.includes('LIKE')) {
    return value;
  }
  return value.includes('%') ? value : `%${value}%`;
};

const formatConditionValue = (operator: string, value: string) => formatValue(normalizeLikeValue(operator, value));

const appendCondition = (
  conditions: string[],
  fieldName: string,
  value?: string,
  operator: OpenObserveFilterOperator | string = '='
) => {
  const trimmedField = fieldName.trim();
  const trimmedValue = value?.trim() || '';
  if (isBlank(trimmedField) || isBlank(trimmedValue)) {
    return;
  }
  conditions.push(`${quoteIdentifier(trimmedField)} ${operator} ${formatConditionValue(operator, trimmedValue)}`);
};

const appendStatusCondition = (conditions: string[], statusField: string, value?: string) => {
  if (isBlank(value)) {
    return;
  }

  const normalized = (value || '').trim().toUpperCase();
  const statusCodeMap: Record<string, string> = {
    UNSET: '0',
    OK: '1',
    ERROR: '2',
  };

  if (statusField === 'status_code' && statusCodeMap[normalized]) {
    conditions.push(
      `(${quoteIdentifier(statusField)} = ${statusCodeMap[normalized]} OR ${quoteIdentifier(statusField)} = ${formatValue(
        normalized
      )})`
    );
    return;
  }

  appendCondition(conditions, statusField, normalized);
};

const appendFullTextCondition = (conditions: string[], value?: string) => {
  if (isBlank(value)) {
    return;
  }
  conditions.push(`match_all(${formatValue((value || '').trim())})`);
};

const parseDurationToNanoseconds = (value: string) => {
  const trimmed = value.trim().toLowerCase();
  const match = trimmed.match(/^(\d+(?:\.\d+)?)\s*(ns|us|µs|ms|s)?$/);
  if (!match) {
    return value;
  }

  const amount = Number(match[1]);
  const unit = match[2] || '';
  const multiplier: Record<string, number> = {
    ns: 1,
    us: 1_000,
    'µs': 1_000,
    ms: 1_000_000,
    s: 1_000_000_000,
    '': 1,
  };

  return String(Math.round(amount * multiplier[unit]));
};

const buildWhere = (conditions: string[]) => {
  return conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';
};

const buildLogSql = (queryData: MyQuery, stream: string) => {
  const customSql = (queryData.logQuery || '').trim();
  const legacySql = queryData.sqlMode ? (queryData.query || '').trim() : '';
  if (isFullSql(customSql)) {
    return customSql;
  }
  if (isFullSql(legacySql)) {
    return legacySql;
  }

  const conditions: string[] = [];

  appendFullTextCondition(conditions, queryData.fullText);

  return `SELECT * FROM ${quoteIdentifier(stream)}${buildWhere(conditions)}`;
};

const buildTraceConditions = (queryData: MyQuery, jsonData?: MyDataSourceOptions) => {
  const traceIdField = getSetting(jsonData, 'trace_id_field', 'trace_id');
  const spanNameField = getSetting(jsonData, 'span_name_field', 'operation_name');
  const serviceNameField = getSetting(jsonData, 'service_name_field', 'service_name');
  const spanIdField = getSetting(jsonData, 'span_id_field', 'span_id');
  const statusField = getSetting(jsonData, 'status_field', 'status_code');
  const durationField = getSetting(jsonData, 'duration_field', 'duration');
  const conditions: string[] = [];

  appendCondition(conditions, serviceNameField, queryData.serviceName);
  appendCondition(conditions, spanNameField, queryData.spanName);
  appendStatusCondition(conditions, statusField, queryData.status);

  if (!isBlank(queryData.durationValue)) {
    const duration = parseDurationToNanoseconds(queryData.durationValue || '');
    conditions.push(`${quoteIdentifier(durationField)} ${queryData.durationOperator || '>'} ${duration}`);
  }

  if (!isBlank(queryData.tagKey) && !isBlank(queryData.tagValue)) {
    appendCondition(conditions, queryData.tagKey || '', queryData.tagValue, queryData.tagOperator || '=');
  }

  return {
    conditions,
    fields: {
      traceIdField,
      spanIdField,
      serviceNameField,
      spanNameField,
      statusField,
      durationField,
    },
  };
};

const buildTraceSql = (
  queryData: MyQuery,
  queryType: OpenObserveQueryType,
  stream: string,
  timestampColumn: string,
  jsonData?: MyDataSourceOptions
) => {
  const customSql = (queryData.advancedTraceSql || '').trim();
  const legacySql = queryData.sqlMode ? (queryData.query || '').trim() : '';
  if (isFullSql(customSql)) {
    return customSql;
  }
  if (isFullSql(legacySql)) {
    return legacySql;
  }

  const { conditions, fields } = buildTraceConditions(queryData, jsonData);
  const traceId = (queryData.traceId || queryData.query || '').trim();

  if ((queryType === 'trace_id' || TRACE_ID_PATTERN.test(traceId)) && traceId) {
    conditions.push(`${quoteIdentifier(fields.traceIdField)} = ${formatValue(traceId)}`);
  }

  // The service map builds service-to-service edges from parent/child spans, so it needs the
  // full span rows (parent span id, span id, service name) just like trace search does.
  return `SELECT * FROM ${quoteIdentifier(stream)}${buildWhere(conditions)} ORDER BY ${quoteIdentifier(
    timestampColumn
  )} ${queryType === 'trace_id' ? 'ASC' : 'DESC'}`;
};

export const buildGeneratedSql = (
  queryData: MyQuery,
  timestampColumn: string,
  jsonData?: MyDataSourceOptions
) => {
  const queryType = getQueryType(queryData);
  const stream = getDefaultStream(queryData, queryType, jsonData);

  const safeTimestampColumn = timestampColumn || '_timestamp';
  const sql =
    queryType === 'logs'
      ? buildLogSql(queryData, stream)
      : buildTraceSql(queryData, queryType, stream, safeTimestampColumn, jsonData);

  return sql.trim() || `SELECT * FROM ${quoteIdentifier(stream)}`;
};

/**
 * Service map node query: one row per service with its span count and error count, aggregated
 * server-side so every service in the time range is represented (not just the latest N spans).
 */
export const buildServiceMapNodesSql = (queryData: MyQuery, jsonData?: MyDataSourceOptions) => {
  const stream = getDefaultStream(queryData, 'service_graph', jsonData);
  const { conditions, fields } = buildTraceConditions(queryData, jsonData);
  const service = quoteIdentifier(fields.serviceNameField);

  return (
    `SELECT ${service} AS service_name, count(*) AS span_count, ` +
    `sum(CASE WHEN ${quoteIdentifier('span_status')} = 'ERROR' THEN 1 ELSE 0 END) AS error_count ` +
    `FROM ${quoteIdentifier(stream)}${buildWhere(conditions)} ` +
    `GROUP BY ${service} ORDER BY span_count DESC`
  );
};

/**
 * Service map edge query: caller -> callee call counts, built by joining each span to its parent
 * (child.reference_parent_span_id = parent.span_id) and grouping by the two service names.
 */
export const buildServiceMapEdgesSql = (queryData: MyQuery, jsonData?: MyDataSourceOptions) => {
  const stream = getDefaultStream(queryData, 'service_graph', jsonData);
  const { conditions, fields } = buildTraceConditions(queryData, jsonData);
  const service = quoteIdentifier(fields.serviceNameField);
  const spanId = quoteIdentifier(fields.spanIdField);
  const parentRef = quoteIdentifier('reference_parent_span_id');

  const childConditions = [...conditions, `${parentRef} != ''`];
  const child =
    `SELECT ${spanId} AS span_id, ${service} AS service_name, ${parentRef} AS parent_span_id ` +
    `FROM ${quoteIdentifier(stream)}${buildWhere(childConditions)}`;
  const parent = `SELECT ${spanId} AS span_id, ${service} AS service_name FROM ${quoteIdentifier(stream)}`;

  return (
    `SELECT p.service_name AS source, c.service_name AS target, count(*) AS call_count ` +
    `FROM (${child}) AS c JOIN (${parent}) AS p ON c.parent_span_id = p.span_id ` +
    `GROUP BY source, target ORDER BY call_count DESC`
  );
};

export const buildQuery = (
  queryData: MyQuery,
  timestamps: TimeRange,
  streamFields: any[],
  app: string,
  timestampColumn: string,
  jsonData?: MyDataSourceOptions
) => {
  const queryType = getQueryType(queryData);
  const size = app !== 'explore' ? 0 : queryType === 'logs' ? 200 : 1000;
  const sql = buildGeneratedSql(queryData, timestampColumn, jsonData).trim();

  return {
    query: {
      sql: sql || `SELECT * FROM ${quoteIdentifier(getDefaultStream(queryData, queryType, jsonData))}`,
      start_time: timestamps.startTimeInMicro,
      end_time: timestamps.endTimeInMirco,
      from: 0,
      size,
      sql_mode: 'full',
    },
    search_type: app === 'dashboard' || app === 'panel-editor' ? 'dashboards' : 'ui',
    timeout: QUERY_TIMEOUT_SECONDS,
  };
};
