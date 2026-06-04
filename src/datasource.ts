import {
  DataQueryRequest,
  DataQueryResponse,
  DataSourceApi,
  DataSourceInstanceSettings,
  QueryFixAction,
  DataSourceWithSupplementaryQueriesSupport,
  SupplementaryQueryType,
  SupplementaryQueryOptions,
  LogLevel,
} from '@grafana/data';
import { Observable } from 'rxjs';
import { getBackendSrv, getTemplateSrv } from '@grafana/runtime';
import { queryLogsVolume } from './features/log/LogsModel';

import { MyQuery, MyDataSourceOptions, CachedQuery, OpenObserveStreamType } from './types';
import { logsErrorMessage, getConsumableTime } from 'utils/zincutils';
import { getOrganizations } from 'services/organizations';
import { getFieldValues } from 'services/streams';
import { cloneDeep } from 'lodash';
import {
  buildServiceMapFromAggregates,
  getGraphDataFrame,
  getLogsDataFrame,
  getTableDataFrame,
  getTraceDataFrame,
  getTracesTableDataFrame,
} from 'features/log/queryResponseBuilder';
import {
  buildGeneratedSql,
  buildQuery,
  buildServiceMapEdgesSql,
  buildServiceMapNodesSql,
} from './features/query/queryBuilder';

const REF_ID_STARTER_LOG_VOLUME = 'log-volume-';

// OpenObserve query timeout in seconds (3 minutes).
const QUERY_TIMEOUT_SECONDS = 180;

const quoteSqlIdentifier = (value: string) => `"${value.replace(/"/g, '""')}"`;
const escapeSqlString = (value: string) => value.replace(/'/g, "''");

/**
 * Inserts a condition into a SELECT statement, adding a WHERE clause when there isn't one and
 * AND-ing onto an existing one. The condition is placed before any GROUP BY / ORDER BY / LIMIT.
 */
const addSqlCondition = (sql: string, condition: string): string => {
  const trimmed = (sql || '').trim();
  if (!trimmed) {
    return trimmed;
  }

  // Find where the WHERE region ends (first GROUP BY / ORDER BY / LIMIT at the top level).
  const tailMatch = trimmed.match(/\s+(group\s+by|order\s+by|limit)\b/i);
  const insertPos = tailMatch ? tailMatch.index! : trimmed.length;
  const head = trimmed.slice(0, insertPos);
  const tail = trimmed.slice(insertPos);

  const connector = /\bwhere\b/i.test(head) ? ' AND ' : ' WHERE ';
  return `${head}${connector}${condition}${tail}`;
};

export class DataSource
  extends DataSourceApi<MyQuery, MyDataSourceOptions>
  implements DataSourceWithSupplementaryQueriesSupport<MyQuery>
{
  instanceSettings?: DataSourceInstanceSettings<MyDataSourceOptions>;
  url: string;
  streamFields: any[];
  cachedLogsQuery: CachedQuery;
  cachedHistogramQuery: CachedQuery;
  timestampColumn: string;
  histogramTimestampColumn: string;

  constructor(instanceSettings: DataSourceInstanceSettings<MyDataSourceOptions>) {
    super(instanceSettings);
    this.url = instanceSettings.url || '';
    this.instanceSettings = instanceSettings;
    this.streamFields = [];
    this.cachedLogsQuery = {
      requestQuery: '',
      isFetching: false,
      data: null,
      promise: null,
    };
    this.cachedHistogramQuery = {
      requestQuery: '',
      isFetching: false,
      data: null,
      promise: null,
    };
    this.timestampColumn = instanceSettings.jsonData.timestamp_column;
    this.histogramTimestampColumn = "zo_sql_key"; // In histogram query response, we get zo_sql_key as timestamp column by default. Changing this will break things.
  }

  applyTemplateVariables(query: MyQuery, scopedVars: any): MyQuery {
    return {
      ...query,
      query: getTemplateSrv().replace(query.query || '', scopedVars),
    };
  }

  /**
   * Populates dashboard template variables (type "Query") with distinct values of a field, fetched
   * from OpenObserve's `_values` API. The plugin has no SQL-backed variable support, so the variable
   * query is a small `key=value` config string rather than SQL. Supported keys (all optional except
   * the field):
   *
   *   field=service_name           (required; a bare field name on its own is also accepted)
   *   type=traces|logs|metrics     (stream type; defaults to the trace stream's type, else logs)
   *   stream=default               (stream name; defaults to the configured default trace/log stream)
   *   org=default                  (organization; defaults to "default")
   *   keyword=foo                  (server-side substring filter on the returned values)
   *   size=500                     (max number of values to return)
   *
   * Examples:
   *   service_name
   *   field=service_name, type=traces, stream=default
   *   field=operation_name, type=traces, keyword=$service
   */
  async metricFindQuery(query: any, options?: any): Promise<Array<{ text: string; value: string }>> {
    const raw = (typeof query === 'string' ? query : query?.query ?? '').trim();
    if (!raw) {
      return [];
    }

    // Allow other dashboard variables to be referenced inside the variable query (cascading vars).
    const interpolated = getTemplateSrv().replace(raw, options?.scopedVars);

    // Parse "key=value" pairs; a bare token with no "=" is treated as the field name.
    const cfg: Record<string, string> = {};
    if (interpolated.includes('=')) {
      interpolated.split(/[;,\n]/).forEach((part) => {
        const idx = part.indexOf('=');
        if (idx > -1) {
          const key = part.slice(0, idx).trim().toLowerCase();
          const value = part.slice(idx + 1).trim();
          if (key) {
            cfg[key] = value;
          }
        }
      });
    } else {
      cfg['field'] = interpolated;
    }

    const field = cfg['field'] || cfg['fields'];
    if (!field) {
      return [];
    }
    // Several fields can be unioned by separating them with "|" (comma is reserved for the config
    // pairs). The _values API takes a comma-separated `fields` list and returns values for each;
    // extractVariableValues then merges + de-dupes them. This makes a variable resilient to schema
    // differences, e.g. `service_service_env|service_env`.
    const apiFields = field.split('|').map((f) => f.trim()).filter(Boolean).join(',');

    const jsonData = this.instanceSettings?.jsonData;
    const streamType = (cfg['type'] || cfg['streamtype'] || (jsonData?.default_trace_stream ? 'traces' : 'logs')) as OpenObserveStreamType;
    const stream =
      cfg['stream'] ||
      (streamType === 'traces' ? jsonData?.default_trace_stream : jsonData?.default_log_stream) ||
      jsonData?.default_trace_stream ||
      jsonData?.default_log_stream ||
      'default';
    const orgName = cfg['org'] || cfg['organization'] || 'default';
    const keyword = cfg['keyword'] || '';
    const size = Number.isFinite(Number(cfg['size'])) && Number(cfg['size']) > 0 ? Number(cfg['size']) : 500;

    // Resolve the time window from the variable's range (falls back to the last hour).
    const range = options?.range;
    let startTime: number;
    let endTime: number;
    if (range?.from && range?.to) {
      const t = getConsumableTime(range);
      startTime = Math.trunc(t.startTimeInMicro);
      endTime = Math.trunc(t.endTimeInMirco);
    } else {
      endTime = Date.now() * 1000;
      startTime = endTime - 60 * 60 * 1000 * 1000;
    }

    try {
      const response = await getFieldValues({
        url: this.url,
        orgName,
        stream,
        fields: apiFields,
        startTime,
        endTime,
        keyword,
        size,
        noCount: false,
        streamType,
      });
      return this.extractVariableValues(response, field).map((value) => ({ text: value, value }));
    } catch (error) {
      console.error('OpenObserve metricFindQuery (_values) failed:', error);
      return [];
    }
  }

  /** Pulls distinct, non-empty string values out of an OpenObserve `_values` response. */
  private extractVariableValues(response: any, field: string): string[] {
    const payload = response?.data ?? response;
    const seen = new Set<string>();
    const out: string[] = [];

    const push = (raw: any) => {
      if (raw === null || raw === undefined) {
        return;
      }
      const value = String(raw).trim();
      if (!value || seen.has(value)) {
        return;
      }
      seen.add(value);
      out.push(value);
    };

    const collect = (item: any) => {
      if (item === null || item === undefined) {
        return;
      }
      if (Array.isArray(item)) {
        item.forEach(collect);
        return;
      }
      if (typeof item !== 'object') {
        push(item);
        return;
      }
      // OpenObserve shape: { hits: [ { field, values: [ { zo_sql_key, zo_sql_num } ] } ] }
      if (Array.isArray(item.values)) {
        item.values.forEach(collect);
        return;
      }
      push(item.zo_sql_key ?? item.value ?? item.key ?? item[field]);
    };

    collect(payload?.hits ?? payload);
    return out;
  }

  /**
   * Main query method that processes data queries for logs and histograms
   * Handles caching, different query types (volume, dashboard, logs), and error scenarios
   */
  async query(options: DataQueryRequest<MyQuery>): Promise<DataQueryResponse> {
    const timestamps = getConsumableTime(options.range);
    const interpolatedTargets = options.targets.map((target) => {
      return this.applyTemplateVariables(target, options.scopedVars);
    });

    const promises = interpolatedTargets.map((target) => {
      return this.processSingleQuery(target, timestamps, options);
    });

    return Promise.all(promises).then((data) => {
      // A single target can resolve to multiple frames (e.g. service map returns nodes + edges),
      // so flatten one level before handing the response back to Grafana.
      return { data: (data || []).flat() };
    });
  }

  /**
   * Processes a single query target with caching, query type detection, and appropriate routing
   * Handles histogram queries, volume queries, dashboard queries, and regular logs queries
   */
  private processSingleQuery(target: MyQuery, timestamps: any, options: DataQueryRequest<MyQuery>): Promise<any> {
    const isHistogramQuery = Boolean(target?.refId?.includes(REF_ID_STARTER_LOG_VOLUME));
    const reqData = buildQuery(target, timestamps, this.streamFields, options.app, this.timestampColumn, this.instanceSettings?.jsonData);

    // Handle cache management
    const { currentCache, shouldUseCachedData } = this.handleCacheManagement(target, reqData, options, isHistogramQuery);

    if (shouldUseCachedData) {
      return this.processCachedDataResponse(target, options, currentCache.data);
    }

    // The logs volume bar chart is a single histogram aggregation, not a per-partition fan-out.
    if (isHistogramQuery) {
      return this.processHistogramQuery(target, reqData, options, currentCache);
    }

    // The service map is built from server-side aggregations (nodes + edges), not raw spans.
    if (target.queryType === 'service_graph') {
      return this.processServiceMapQuery(target, timestamps, options, currentCache);
    }

    // Process regular logs queries
    return this.processLogsQuery(target, reqData, options, currentCache);
  }

  private getFallbackSql(target: MyQuery): string {
    const stream = target.stream || this.instanceSettings?.jsonData?.default_log_stream || this.instanceSettings?.jsonData?.default_trace_stream || 'default';
    const safeStream = stream.replace(/"/g, '""');

    return `SELECT * FROM "${safeStream}"`;
  }

  private ensureSearchRequestBody(target: MyQuery, data: any, options: { addSize?: boolean } = {}): any {
    const body = data && typeof data === 'object' && !Array.isArray(data) ? cloneDeep(data) : {};
    const query = body.query && typeof body.query === 'object' && !Array.isArray(body.query) ? body.query : {};
    const sql = typeof query.sql === 'string' ? query.sql.trim() : '';

    const flatSql = typeof body.sql === 'string' ? body.sql.trim() : '';

    body.query = {
      ...query,
      sql: sql || flatSql || this.getFallbackSql(target),
      from: Number.isFinite(query.from) ? query.from : 0,
      sql_mode: query.sql_mode || 'full',
    };

    if (options.addSize && !Number.isFinite(body.query.size)) {
      body.query.size = target.streamType === 'traces' ? 1000 : 200;
    }

    body.search_type = body.search_type || 'ui';
    body.timeout = Number.isFinite(body.timeout) ? body.timeout : QUERY_TIMEOUT_SECONDS;

    return body;
  }

  /**
   * Rewrites the base logs query into a single histogram aggregation bucketed by the internal
   * timestamp column (e.g. `_timestamp`). This is the same shape OpenObserve's own UI uses, and
   * because the timestamp field is indexed it is cheap to run as one request over the full range
   * instead of fanning out one search per partition.
   */
  private buildHistogramRequest(target: MyQuery, data: any): any {
    const body = this.ensureSearchRequestBody(target, data);
    const baseSql = body.query?.sql || this.getFallbackSql(target);

    body.query = {
      ...body.query,
      sql: this.toHistogramSql(baseSql),
      sql_mode: 'full',
    };
    delete (body.query as Partial<typeof body.query>).size;

    return body;
  }

  private toHistogramSql(sql: string): string {
    const timestampColumn = this.timestampColumn || '_timestamp';
    const quoted = `"${timestampColumn.replace(/"/g, '""')}"`;

    // Drop any trailing ORDER BY / LIMIT from the base query so they don't conflict with the
    // histogram grouping, then swap the projection for the histogram + count aggregation.
    const base = (sql || '')
      .trim()
      .replace(/\s+order\s+by\s+[\s\S]*$/i, '')
      .replace(/\s+limit\s+\d+(\s+offset\s+\d+)?\s*$/i, '');

    const fromIndex = base.toLowerCase().indexOf(' from ');
    if (fromIndex === -1) {
      return base;
    }

    const fromClause = base.substring(fromIndex);
    return `SELECT histogram(${quoted}) AS zo_sql_key, count(*) AS zo_sql_num${fromClause} GROUP BY zo_sql_key ORDER BY zo_sql_key`;
  }

  doRequest(target: MyQuery, data: any) {
    const searchType = 'ui';
    const useCache = true;
    const pageType = target.streamType || 'logs';
    const requestBody = this.ensureSearchRequestBody(target, data, { addSize: true });

    const url =
      this.url + `/api/${target.organization}/_search?type=${pageType}&search_type=${searchType}&use_cache=${useCache}`;

    return getBackendSrv().post(url, requestBody, {
      showErrorAlert: false,
    });
  }

  doHistogramRequest(target: MyQuery, data: any, app = 'logs') {
    const searchType = app === 'panel-editor' || app === 'dashboard' ? 'dashboards' : 'ui';
    const useCache = true;
    const pageType = target.streamType || 'logs';
    const requestBody = this.buildHistogramRequest(target, data);

    const url =
      this.url + `/api/${target.organization}/_search?type=${pageType}&search_type=${searchType}&use_cache=${useCache}`;

    return getBackendSrv().post(url, requestBody, {
      showErrorAlert: false,
    });
  }

  resetHistogramQueryCache() {
    this.cachedHistogramQuery = {
      requestQuery: '',
      isFetching: false,
      data: null,
      promise: null,
    };
  }

  resetLogsQueryCache() {
    this.cachedLogsQuery = {
      requestQuery: '',
      isFetching: false,
      data: null,
      promise: null,
    };
  }

  /**
   * Handles cache lookup and initialization for query requests
   * Returns the cached data if available, otherwise sets up a new cache entry
   */
  private handleCacheManagement(target: MyQuery, reqData: any, options: DataQueryRequest<MyQuery>, isHistogramQuery: boolean): { currentCache: CachedQuery, shouldUseCachedData: boolean } {
    let currentCache = isHistogramQuery ? this.cachedHistogramQuery : this.cachedLogsQuery;

    const cacheKey = JSON.stringify({
      reqData,
      displayMode: target.displayMode ?? 'auto',
      type: target.refId,
    });

    // Check if we have cached data for this query
    if (cacheKey === currentCache.requestQuery && currentCache.data) {
      return { currentCache, shouldUseCachedData: true };
    }

    // Reset appropriate cache and set up new promise
    if (target?.refId?.includes(REF_ID_STARTER_LOG_VOLUME)) {
      this.resetHistogramQueryCache();
    } else {
      this.resetLogsQueryCache();
    }

    currentCache = isHistogramQuery ? this.cachedHistogramQuery : this.cachedLogsQuery;

    currentCache.data = new Promise((resolve, reject) => {
      currentCache.promise = { resolve, reject };
    });

    currentCache.requestQuery = cacheKey;
    currentCache.isFetching = true;

    return { currentCache, shouldUseCachedData: false };
  }

  /**
   * Processes cached data response based on query type and display mode
   * Returns the appropriate data frame for the query context
   */
  private processCachedDataResponse(target: MyQuery, options: DataQueryRequest<MyQuery>, cachedData: any): any {
    return cachedData?.then((res: any) => {
      const mode = target.displayMode || 'auto';
      if (target?.refId?.includes(REF_ID_STARTER_LOG_VOLUME)) {
        return res;
      }
      if (options.app === 'panel-editor' || options.app === 'dashboard') {
        if (mode === 'graph' || mode === 'auto') {
          return res;
        }
      }
      return res;
    });
  }

  /**
   * Creates appropriate data frame based on display mode and query type
   * Returns either graph or logs data frame with proper caching
   */
  private createDataFrame(hits: any[], target: MyQuery, options: DataQueryRequest<MyQuery>, currentCache: CachedQuery): any {
    const dataFrame = this.buildResultFrame(hits, target, options);
    currentCache.promise?.resolve(dataFrame);
    return dataFrame;
  }

  /**
   * Builds the appropriate data frame for a query result based on its query type.
   * - trace_id: a single trace rendered as a Grafana trace (call hierarchy)
   * - traces: trace search results rendered as a table, one row per trace
   * - graph / log volume: a time series graph frame
   * - logs: a standard logs frame
   */
  private buildResultFrame(hits: any[], target: MyQuery, options: DataQueryRequest<MyQuery>): any {
    const mode = target.displayMode || 'auto';
    const isVolume = Boolean(target?.refId?.includes(REF_ID_STARTER_LOG_VOLUME));

    const jsonData = this.instanceSettings?.jsonData;

    if (target.queryType === 'trace_id') {
      return getTraceDataFrame(hits, target, jsonData);
    }

    if (!isVolume && target.queryType === 'traces') {
      return getTracesTableDataFrame(
        hits,
        target,
        {
          datasourceUid: this.instanceSettings?.uid,
          datasourceName: this.instanceSettings?.name,
        },
        jsonData
      );
    }

    // An aggregation logs query (e.g. field "top values": GROUP BY ... COUNT) renders as a table.
    // This is derived from the SQL rather than a sticky flag, so switching back to a plain logs
    // query reliably restores the logs + histogram view.
    if (!isVolume && this.isAggregationLogsQuery(target)) {
      return getTableDataFrame(hits, target);
    }

    if (mode === 'graph' || isVolume) {
      return getGraphDataFrame(hits, target, options.app, this.histogramTimestampColumn);
    }

    // On a dashboard / panel editor the stream schema (streamFields) isn't loaded, so a logs frame
    // would only expose Time + a JSON "Content" blob — useless for table/heatmap/stat panels. Render
    // the raw rows as a table instead, with each selected column typed from the data (timestamps as
    // time). Explore keeps the logs + histogram experience.
    const isDashboardContext = options.app === 'dashboard' || options.app === 'panel-editor';
    if (!isVolume && isDashboardContext) {
      return getTableDataFrame(hits, target);
    }

    return getLogsDataFrame(hits, target, this.streamFields, this.timestampColumn);
  }

  /** The SQL that will actually run for a target (custom SQL, or generated from the filters). */
  private getEffectiveSql(target: MyQuery): string {
    if (target.sqlMode && typeof target.query === 'string' && target.query.trim()) {
      return target.query;
    }
    return buildGeneratedSql(target, this.timestampColumn, this.instanceSettings?.jsonData);
  }

  /**
   * True when a logs query aggregates and should render as a table (no logs + histogram view).
   * This covers two cases:
   *   1. an explicit GROUP BY (e.g. field "top values"), and
   *   2. a bare aggregate projection with no GROUP BY (e.g. `SELECT count(*) AS total`), which
   *      collapses to a single summary row. Such queries must become a table so stat/gauge panels
   *      receive a typed numeric field instead of an (empty) logs frame.
   */
  private isAggregationLogsQuery(target: MyQuery): boolean {
    if (target.queryType && target.queryType !== 'logs') {
      return false;
    }
    const sql = this.getEffectiveSql(target);
    if (/\bgroup\s+by\b/i.test(sql)) {
      return true;
    }
    // Only inspect the SELECT projection so an aggregate used in a subquery/WHERE doesn't misclassify
    // an otherwise row-returning query.
    const projection = sql.match(/\bselect\b([\s\S]*?)\bfrom\b/i)?.[1] ?? '';
    return /\b(count|sum|avg|min|max|median|stddev|variance|approx_percentile_cont|approx_percentile|approx_distinct)\s*\(/i.test(
      projection
    );
  }

  /**
   * Handles error scenarios and creates appropriate empty data frames
   * Resolves the cache promise with empty data and returns the data frame
   */
  private handleQueryError(target: MyQuery, options: DataQueryRequest<MyQuery>, currentCache: CachedQuery, error?: any, timestampColumn?: string): any {
    if (error) {
      console.error('Partition or histogram request failed:', error);
    }

    const dataFrame = this.buildResultFrame([], target, options);
    currentCache.promise?.resolve(dataFrame);
    return dataFrame;
  }

  /**
   * Runs the logs volume bar chart as a single histogram aggregation over the full time range.
   * One request instead of a `_search_partition` call plus one `_search` per partition.
   */
  private processHistogramQuery(target: MyQuery, reqData: any, options: DataQueryRequest<MyQuery>, currentCache: CachedQuery): Promise<any> {
    return this.doHistogramRequest(target, reqData, options.app)
      .then((histogramResponse) => {
        return this.createDataFrame(histogramResponse.hits || [], target, options, currentCache);
      })
      .catch((error) => {
        return this.handleQueryError(target, options, currentCache, error, this.timestampColumn);
      });
  }

  /**
   * Builds the service map from two server-side aggregations: a GROUP BY service for the nodes,
   * and a parent/child self-join for the edges. Both cover the full time range, so the map is
   * complete instead of being limited to the most recent N spans. The edge query is best-effort
   * (it relies on SQL JOIN support); if it fails the node map is still returned.
   */
  private processServiceMapQuery(
    target: MyQuery,
    timestamps: any,
    options: DataQueryRequest<MyQuery>,
    currentCache: CachedQuery
  ): Promise<any> {
    const jsonData = this.instanceSettings?.jsonData;
    const searchType = options.app === 'dashboard' || options.app === 'panel-editor' ? 'dashboards' : 'ui';
    const makeBody = (sql: string) => ({
      query: {
        sql,
        start_time: timestamps.startTimeInMicro,
        end_time: timestamps.endTimeInMirco,
        from: 0,
        size: 10000,
        sql_mode: 'full',
      },
      search_type: searchType,
      timeout: QUERY_TIMEOUT_SECONDS,
    });

    const nodesPromise = this.doRequest(target, makeBody(buildServiceMapNodesSql(target, jsonData)))
      .then((response) => response.hits || [])
      .catch((error) => {
        console.error('Service map nodes query failed:', error);
        return [];
      });

    const edgesPromise = this.doRequest(target, makeBody(buildServiceMapEdgesSql(target, jsonData)))
      .then((response) => response.hits || [])
      .catch((error) => {
        console.error('Service map edges query failed (JOIN may be unsupported):', error);
        return [];
      });

    return Promise.all([nodesPromise, edgesPromise]).then(([nodeRows, edgeRows]) => {
      const frames = buildServiceMapFromAggregates(nodeRows, edgeRows, target);
      currentCache.promise?.resolve(frames);
      currentCache.isFetching = false;
      return frames;
    });
  }

  /**
   * Processes regular logs queries using the standard doRequest flow
   * Handles response processing and error scenarios for logs queries
   */
  private processLogsQuery(target: MyQuery, reqData: any, options: DataQueryRequest<MyQuery>, currentCache: CachedQuery): Promise<any> {
    return this.doRequest(target, reqData)
      .then((response) => {
        return this.createDataFrame(response.hits || [], target, options, currentCache);
      })
      .catch((err) => {
        currentCache.promise?.reject(err);
        let error = {
          message: '',
          detail: '',
        };

        if (err.data) {
          error.message = err.data?.message;
          error.detail = err.data?.error_detail;
        } else {
          error.message = err.statusText;
        }

        const customMessage = logsErrorMessage(err.data.code);
        if (customMessage) {
          error.message = customMessage;
        }

        throw new Error(error.message + (error.detail ? ` ( ${error.detail} ) ` : ''));
      })
      .finally(() => {
        currentCache.isFetching = false;
      });
  }

  async testDatasource() {
    return getOrganizations({ url: this.url })
      .then((res) => {
        return {
          status: 'success',
          message: 'Data source successfully connected.',
        };
      })
      .catch((error) => {
        const info: string = error?.data?.message ?? '';
        const infoInParentheses = info !== '' ? ` (${info})` : '';
        return {
          status: 'error',
          message: `Unable to connect OpenObserve ${infoInParentheses}. Verify that OpenObserve is correctly configured`,
        };
      });
  }

  modifyQuery(query: MyQuery, action: QueryFixAction): MyQuery {
    const key = action.options?.key;
    if (!key) {
      return query;
    }

    let operator: string;
    if (action.type === 'ADD_FILTER') {
      operator = '=';
    } else if (action.type === 'ADD_FILTER_OUT') {
      operator = '!=';
    } else {
      return query;
    }

    const condition = `${quoteSqlIdentifier(key)} ${operator} ${this.formatFilterValue(key, action.options?.value)}`;

    // Start from the SQL that actually runs (custom SQL, or generated from the filters) and add a
    // proper WHERE/AND clause, then switch to SQL mode so the filtered query is what executes.
    const baseSql = this.getEffectiveSql(query);
    return { ...query, query: addSqlCondition(baseSql, condition), sqlMode: true };
  }

  /** Formats a filter value for SQL, leaving numeric columns unquoted to avoid type mismatches. */
  private formatFilterValue(field: string, value: unknown): string {
    const raw = value === undefined || value === null ? '' : String(value);
    const fieldType = String(this.streamFields.find((f) => f?.name === field)?.type || '').toLowerCase();
    const isNumericField = /int|float|double|decimal|number/.test(fieldType);

    if (isNumericField && raw.trim() !== '' && Number.isFinite(Number(raw))) {
      return raw.trim();
    }
    return `'${escapeSqlString(raw)}'`;
  }

  updateStreamFields(streamFields: any[]) {
    this.streamFields = [...streamFields];
  }

  getDataProvider(
    type: SupplementaryQueryType,
    request: DataQueryRequest<MyQuery>
  ): Observable<DataQueryResponse> | undefined {
    if (!this.getSupportedSupplementaryQueryTypes().includes(type)) {
      return undefined;
    }

    switch (type) {
      case SupplementaryQueryType.LogsVolume:
        return this.getLogsVolumeDataProvider(request);
      default:
        return undefined;
    }
  }

  getSupportedSupplementaryQueryTypes(): SupplementaryQueryType[] {
    return [SupplementaryQueryType.LogsVolume];
    // return [SupplementaryQueryType.LogsVolume, SupplementaryQueryType.LogsSample];
  }

  getSupplementaryQuery(options: SupplementaryQueryOptions, originalQuery: MyQuery): MyQuery | undefined {
    return undefined;
  }

  getLogsVolumeDataProvider(request: DataQueryRequest<MyQuery>): Observable<DataQueryResponse> | undefined {
    const logsVolumeRequest = cloneDeep(request);
    // Only build a volume histogram for plain log streams. Trace search, service maps and
    // aggregation tables are not time-series logs, so a volume histogram makes no sense there.
    const targets = logsVolumeRequest.targets
      .filter((target) => {
        const queryType = target.queryType ?? 'logs';
        return queryType === 'logs' && !target.fastMode && !this.isAggregationLogsQuery(target);
      })
      .map((target) => {
        target['refId'] = REF_ID_STARTER_LOG_VOLUME + target.refId;
        return target;
      });

    if (!targets.length) {
      return undefined;
    }

    return queryLogsVolume(
      this,
      { ...logsVolumeRequest, targets },
      {
        extractLevel: () => LogLevel.unknown,
        range: logsVolumeRequest.range,
        targets: logsVolumeRequest.targets,
      }
    );
  }
}
