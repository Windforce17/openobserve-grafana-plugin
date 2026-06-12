import React, { useEffect, useMemo, useState } from 'react';
import { Button, Combobox, InlineField, InlineLabel, InlineSwitch, Input, RadioButtonGroup, useStyles2 } from '@grafana/ui';
import { GrafanaTheme2, QueryEditorProps } from '@grafana/data';
import { DataSource } from '../datasource';
import {
  MyDataSourceOptions,
  MyQuery,
  OpenObserveFilterOperator,
  OpenObserveQueryType,
  OpenObserveStreamType,
} from '../types';
import { getFieldValues, getStreams } from '../services/streams';
import { getOrganizations } from '../services/organizations';
import { buildGeneratedSql } from '../features/query/queryBuilder';
import { ZincEditor } from './ZincEditor';
import { css } from '@emotion/css';
import { cloneDeep } from 'lodash';

type Props = QueryEditorProps<DataSource, MyQuery, MyDataSourceOptions>;

type SelectOption<T extends string = string> = { label?: string; value: T; description?: string };
type QueryTabValue = Extract<OpenObserveQueryType, 'logs' | 'traces' | 'service_graph'>;
type QueryTypeOption = { label: string; value: QueryTabValue; description?: string };
type DurationOperatorOption = { label: string; value: NonNullable<MyQuery['durationOperator']> };
type FilterOperatorOption = { label: string; value: OpenObserveFilterOperator };

const QUERY_TYPE_OPTIONS: QueryTypeOption[] = [
  { label: 'Logs', value: 'logs', description: 'Search logs with generated SQL you can edit directly' },
  { label: 'Traces', value: 'traces', description: 'Filter traces and open any result to inspect its spans' },
  { label: 'Service Map', value: 'service_graph', description: 'Visualize service-to-service dependencies from spans' },
];

const STREAM_TYPE_OPTIONS: Array<SelectOption<OpenObserveStreamType>> = [
  { label: 'Logs', value: 'logs' },
  { label: 'Metrics', value: 'metrics' },
  { label: 'Traces', value: 'traces' },
  { label: 'Enrichment tables', value: 'enrichment_tables' },
];

const DURATION_OPERATOR_OPTIONS: DurationOperatorOption[] = [
  { label: '>', value: '>' },
  { label: '>=', value: '>=' },
  { label: '<', value: '<' },
  { label: '<=', value: '<=' },
  { label: '=', value: '=' },
];

const FILTER_OPERATOR_OPTIONS: FilterOperatorOption[] = [
  { label: '=', value: '=' },
  { label: '!=', value: '!=' },
  { label: 'LIKE', value: 'LIKE' },
  { label: 'NOT LIKE', value: 'NOT LIKE' },
];

const STATUS_OPTIONS: SelectOption[] = [
  { label: 'Any status', value: '' },
  { label: 'OK', value: 'OK' },
  { label: 'ERROR', value: 'ERROR' },
  { label: 'UNSET', value: 'UNSET' },
];

const DURATION_SCOPE_OPTIONS: Array<SelectOption<NonNullable<MyQuery['durationScope']>>> = [
  { label: 'Span duration', value: 'span' },
  { label: 'Trace duration', value: 'trace' },
];

const TAG_SCOPE_OPTIONS: Array<SelectOption<NonNullable<MyQuery['tagScope']>>> = [
  { label: 'Span attribute', value: 'span' },
  { label: 'Resource attribute', value: 'resource' },
];

const getQueryType = (query: MyQuery): OpenObserveQueryType => {
  if (query.queryType) {
    return query.queryType;
  }
  if (query.streamType === 'traces' || query.displayMode === 'trace') {
    return 'traces';
  }
  return 'logs';
};

const getStreamTypeForQueryType = (queryType: OpenObserveQueryType): OpenObserveStreamType => {
  return queryType === 'logs' ? 'logs' : 'traces';
};

const getDisplayModeForQueryType = (queryType: OpenObserveQueryType): MyQuery['displayMode'] => {
  if (queryType === 'logs') {
    return 'logs';
  }
  if (queryType === 'service_graph') {
    return 'graph';
  }
  return 'trace';
};

const getFieldName = (field: any): string => {
  if (typeof field === 'string') {
    return field;
  }
  return field?.name || field?.field || field?.column || field?.key || '';
};

const toOption = (value: string): SelectOption => ({ label: value, value });

const quoteIdentifier = (value: string) => `"${value.replace(/"/g, '""')}"`;
const escapeSqlString = (value: string) => value.replace(/'/g, "''");

const uniqueOptions = (values: string[]): SelectOption[] => {
  const seen = new Set<string>();
  return values
    .map((value) => value?.trim())
    .filter((value): value is string => {
      if (!value || seen.has(value)) {
        return false;
      }
      seen.add(value);
      return true;
    })
    .map(toOption);
};

const asArray = (value: any): any[] => {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value;
  }
  return Object.values(value);
};

const normalizeResponsePayload = (response: any) => response?.data ?? response;

const normalizeOrganizations = (response: any): SelectOption[] => {
  const payload = normalizeResponsePayload(response);
  const organizations = Array.isArray(payload) ? payload : payload?.data || payload?.list || payload?.organizations || [];
  const seen = new Set<string>();

  return asArray(organizations)
    .map((org: any) => {
      if (typeof org === 'string') {
        return toOption(org);
      }
      const value = String(org?.identifier || org?.name || org?.org_name || org?.id || '');
      const label = String(org?.name || org?.identifier || org?.org_name || org?.id || '');
      return value ? { label, value } : null;
    })
    .filter((option: SelectOption | null): option is SelectOption => {
      if (!option || seen.has(option.value)) {
        return false;
      }
      seen.add(option.value);
      return true;
    });
};

const normalizeStreams = (response: any): any[] => {
  const payload = normalizeResponsePayload(response);
  const streams = Array.isArray(payload) ? payload : payload?.list || payload?.streams || payload?.items || [];

  return asArray(streams)
    .map((stream: any) => {
      if (typeof stream === 'string') {
        return { name: stream, schema: [] };
      }
      const name = stream?.name || stream?.stream_name || stream?.stream || stream?.id || '';
      return { ...stream, name, schema: stream?.schema || [] };
    })
    .filter((stream: any) => Boolean(stream.name));
};

const extractFieldValues = (response: any, fieldName: string): string[] => {
  const payload = normalizeResponsePayload(response);
  const values: string[] = [];

  const collect = (item: any) => {
    if (item === null || item === undefined) {
      return;
    }
    if (Array.isArray(item)) {
      item.forEach(collect);
      return;
    }
    if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') {
      values.push(String(item));
      return;
    }

    if (Array.isArray(item.values)) {
      item.values.forEach(collect);
      return;
    }

    const directValue = item.zo_sql_key ?? item.value ?? item.key ?? item[fieldName];
    if (directValue !== null && directValue !== undefined) {
      values.push(String(directValue));
    }
  };

  collect(payload?.hits);
  collect(payload?.values);
  collect(payload?.list);
  collect(payload?.data);
  collect(payload?.[fieldName]);

  return values;
};

const getStyles = (theme: GrafanaTheme2) => ({
  container: css`
    display: flex;
    flex-direction: column;
    gap: ${theme.spacing(1.5)};
  `,
  headerRow: css`
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: ${theme.spacing(1)};
  `,
  headerLabel: css`
    margin: 0;
  `,
  panel: css`
    border: 1px solid ${theme.colors.border.weak};
    border-radius: ${theme.shape.radius.default};
    padding: ${theme.spacing(2)};
    background: ${theme.colors.background.secondary};
    display: flex;
    flex-direction: column;
    gap: ${theme.spacing(1.5)};
  `,
  searchRow: css`
    display: flex;
    align-items: center;
    gap: ${theme.spacing(1)};
  `,
  searchInput: css`
    flex: 1 1 auto;
  `,
  inlineHint: css`
    color: ${theme.colors.text.secondary};
    font-size: ${theme.typography.bodySmall.fontSize};
    white-space: nowrap;
  `,
  filterRow: css`
    display: grid;
    grid-template-columns: 150px minmax(0, 1fr);
    align-items: center;
    gap: ${theme.spacing(1)};

    @media (max-width: 900px) {
      grid-template-columns: 1fr;
    }
  `,
  filterLabel: css`
    align-items: center;
    background: ${theme.colors.background.primary};
    border: 1px solid ${theme.colors.border.weak};
    border-radius: ${theme.shape.radius.default};
    color: ${theme.colors.text.primary};
    display: flex;
    font-size: ${theme.typography.bodySmall.fontSize};
    font-weight: ${theme.typography.fontWeightMedium};
    min-height: ${theme.spacing(4)};
    padding: 0 ${theme.spacing(1.25)};
  `,
  filterControls: css`
    display: flex;
    align-items: center;
    gap: ${theme.spacing(0.5)};
    flex-wrap: wrap;
  `,
  operatorBadge: css`
    color: ${theme.colors.text.secondary};
    font-family: ${theme.typography.fontFamilyMonospace};
    padding: 0 ${theme.spacing(0.5)};
  `,
  sqlEditor: css`
    display: flex;
    flex-direction: column;
    gap: ${theme.spacing(0.5)};
  `,
  sqlHeader: css`
    align-items: center;
    display: flex;
    justify-content: space-between;
    gap: ${theme.spacing(1)};
  `,
  sqlLabel: css`
    color: ${theme.colors.text.primary};
    font-weight: ${theme.typography.fontWeightMedium};
  `,
  helperText: css`
    color: ${theme.colors.text.secondary};
    font-size: ${theme.typography.bodySmall.fontSize};
    margin: 0;
  `,
  sqlEditorBox: css`
    border: 1px solid ${theme.colors.border.medium};
    border-radius: ${theme.shape.radius.default};
    background: ${theme.colors.background.primary};
    padding: ${theme.spacing(0.5)};
  `,
  actionsRow: css`
    display: flex;
    align-items: center;
    gap: ${theme.spacing(1)};
  `,
});

export const QueryEditor = ({ query, onChange, onRunQuery, datasource, app, range }: Props) => {
  const styles = useStyles2(getStyles);
  const [streamDetails, setStreamDetails] = useState<Record<string, any>>({});
  const [streamOptions, setStreamOptions] = useState<SelectOption[]>([]);
  const [orgOptions, setOrgOptions] = useState<SelectOption[]>([]);
  const [isMounted, setIsMounted] = useState(false);
  const [loadingCount, setLoadingCount] = useState(0);

  const jsonData = useMemo(
    () => datasource.instanceSettings?.jsonData ?? ({} as MyDataSourceOptions),
    [datasource.instanceSettings?.jsonData]
  );
  const queryType = getQueryType(query);
  const streamType: OpenObserveStreamType =
    queryType === 'logs' ? query.streamType || 'logs' : 'traces';
  const isInDashboard = useMemo(() => app === 'panel-editor' || app === 'dashboard', [app]);
  const isLoading = loadingCount > 0;

  const timestampColumn = jsonData.timestamp_column || '_timestamp';
  const traceIdField = jsonData.trace_id_field || 'trace_id';
  const spanIdField = jsonData.span_id_field || 'span_id';
  const serviceNameField = jsonData.service_name_field || 'service_name';
  const spanNameField = jsonData.span_name_field || 'operation_name';
  const statusField = jsonData.status_field || 'status_code';
  const durationField = jsonData.duration_field || 'duration';

  const schemaFieldOptions = useMemo(() => {
    const schema = streamDetails[query.stream]?.schema || [];
    return uniqueOptions([
      ...schema.map(getFieldName),
      timestampColumn,
      traceIdField,
      spanIdField,
      serviceNameField,
      spanNameField,
      statusField,
      durationField,
    ]);
  }, [
    durationField,
    query.stream,
    serviceNameField,
    spanIdField,
    spanNameField,
    statusField,
    streamDetails,
    timestampColumn,
    traceIdField,
  ]);

  const streamColumnOptions = useMemo(() => {
    const schema = streamDetails[query.stream]?.schema || [];
    return uniqueOptions(schema.map(getFieldName));
  }, [query.stream, streamDetails]);

  const generatedSql = useMemo(
    () =>
      buildGeneratedSql(
        { ...query, query: '', logQuery: '', advancedTraceSql: '', sqlMode: false, queryType, streamType },
        timestampColumn,
        jsonData
      ),
    [jsonData, query, queryType, streamType, timestampColumn]
  );

  const startLoading = () => setLoadingCount((count) => count + 1);
  const stopLoading = () => setLoadingCount((count) => Math.max(count - 1, 0));

  const getSelectionTimeRange = () => {
    const now = Date.now() * 1000;
    const fallbackStart = now - 15 * 60 * 1000 * 1000;
    const from = range?.from?.valueOf ? range.from.valueOf() * 1000 : fallbackStart;
    const to = range?.to?.valueOf ? range.to.valueOf() * 1000 : now;

    return { startTime: Math.trunc(from), endTime: Math.trunc(to) };
  };

  const loadFieldValues = (fieldName: string) => async (inputValue: string): Promise<SelectOption[]> => {
    if (!query.organization || !query.stream || !fieldName) {
      return [];
    }

    const { startTime, endTime } = getSelectionTimeRange();
    try {
      const response = await getFieldValues({
        url: datasource.url,
        orgName: query.organization,
        stream: query.stream,
        fields: fieldName,
        startTime,
        endTime,
        keyword: inputValue || '',
        size: 50,
        noCount: false,
        streamType,
      });

      return uniqueOptions(extractFieldValues(response, fieldName));
    } catch (error) {
      console.log(error);
      return [];
    }
  };

  const getDefaultStream = (selectedStreamType: OpenObserveStreamType, streams: any[]) => {
    const configuredDefault =
      selectedStreamType === 'traces' ? jsonData.default_trace_stream || '' : jsonData.default_log_stream || '';
    const configuredStream = streams.find((stream) => stream.name === configuredDefault);
    return configuredStream?.name || streams[0]?.name || '';
  };

  const setupStreams = (orgName: string, selectedStreamType: OpenObserveStreamType = 'logs') => {
    return new Promise<any[]>((resolve) => {
      getStreams(datasource.url, orgName, selectedStreamType)
        .then((response: any) => {
          const streamList = normalizeStreams(response);
          const streams: Record<string, any> = {};
          streamList.forEach((stream: any) => {
            streams[stream.name] = stream;
          });
          setStreamDetails(cloneDeep(streams));
          resolve(streamList);
        })
        .catch((err) => {
          console.log(err);
          setStreamDetails({});
          resolve([]);
        });
    });
  };

  const setStreams = (streams: any[]) => {
    setStreamOptions(
      streams.map((stream: any) => ({
        label: stream.name,
        value: stream.name,
      }))
    );
  };

  const updateDataSourceFields = (streamName: string, streams?: any[]) => {
    const stream = streams?.find((item: any) => item.name === streamName) ?? streamDetails[streamName];
    datasource.updateStreamFields(stream?.schema ? cloneDeep(stream.schema) : []);
  };

  const buildNextQuery = (patch: Partial<MyQuery>): MyQuery => {
    const nextQueryType = patch.queryType || queryType;
    let nextStreamType: OpenObserveStreamType;
    if (patch.streamType) {
      nextStreamType = patch.streamType;
    } else if (nextQueryType === 'traces' || nextQueryType === 'trace_id') {
      nextStreamType = 'traces';
    } else {
      nextStreamType = query.streamType || 'logs';
    }

    const nextQuery: MyQuery = {
      ...query,
      queryType: nextQueryType,
      streamType: nextStreamType,
      displayMode: getDisplayModeForQueryType(nextQueryType),
      logQuery: '',
      advancedTraceSql: '',
      ...patch,
    };

    if (!nextQuery.sqlMode) {
      nextQuery.query = buildGeneratedSql(nextQuery, timestampColumn, jsonData);
    }

    return nextQuery;
  };

  const updateQuery = (patch: Partial<MyQuery>, shouldRunQuery = false) => {
    onChange(buildNextQuery(patch));
    if (shouldRunQuery) {
      onRunQuery();
    }
  };

  useEffect(() => {
    startLoading();
    getOrganizations({ url: datasource.url, page_num: 0, page_size: 1000, sort_by: 'id' })
      .then((orgs: any) => {
        const organizations = normalizeOrganizations(orgs);
        setOrgOptions(organizations);

        // Prefer the org already on the query (saved dashboards), then the configured default
        // organization, then the first org the API returns, then the literal "default".
        const selectedOrg =
          query.organization ||
          jsonData.default_organization?.trim() ||
          organizations[0]?.value ||
          'default';
        const initialQueryType = getQueryType(query);
        const selectedStreamType =
          initialQueryType === 'logs' ? query.streamType || 'logs' : 'traces';

        startLoading();
        setupStreams(selectedOrg, selectedStreamType)
          .then((streams: any[]) => {
            setStreams(streams);
            const preferredStream = query.stream || getDefaultStream(selectedStreamType, streams);
            const selectedStream = streams.some((stream) => stream.name === preferredStream)
              ? preferredStream
              : getDefaultStream(selectedStreamType, streams);

            updateDataSourceFields(selectedStream, streams);

            if (!(query.organization && query.stream && query.hasOwnProperty('sqlMode'))) {
              const initializedQuery: MyQuery = {
                ...query,
                organization: selectedOrg,
                stream: selectedStream,
                streamType: selectedStreamType,
                queryType: initialQueryType,
                sqlMode: query.sqlMode ?? false,
                displayMode: getDisplayModeForQueryType(initialQueryType),
                durationScope: query.durationScope ?? 'span',
                durationOperator: query.durationOperator ?? '>',
                tagScope: query.tagScope ?? 'span',
                tagOperator: query.tagOperator ?? '=',
                logQuery: '',
                advancedTraceSql: '',
              };
              if (!initializedQuery.sqlMode) {
                initializedQuery.query = buildGeneratedSql(initializedQuery, timestampColumn, jsonData);
              }
              onChange(initializedQuery);
            } else if (isInDashboard && query.organization && query.stream) {
              onRunQuery();
            }

            setIsMounted(true);
          })
          .finally(() => stopLoading());
      })
      .catch((err) => console.log(err))
      .finally(() => stopLoading());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const reloadStreamsAndApply = (
    orgName: string,
    nextStreamType: OpenObserveStreamType,
    patch: Partial<MyQuery>,
    runAfter: boolean
  ) => {
    startLoading();
    setupStreams(orgName, nextStreamType)
      .then((streams: any[]) => {
        setStreams(streams);
        const nextStream = getDefaultStream(nextStreamType, streams);
        updateDataSourceFields(nextStream, streams);
        onChange(
          buildNextQuery({
            organization: orgName,
            stream: nextStream,
            streamType: nextStreamType,
            sqlMode: false,
            ...patch,
          })
        );
        if (runAfter) {
          onRunQuery();
        }
      })
      .finally(() => stopLoading());
  };

  const queryTypeUpdated = (nextQueryType: QueryTabValue) => {
    if (nextQueryType === queryType) {
      return;
    }
    const nextStreamType = getStreamTypeForQueryType(nextQueryType);
    // Run the new query after switching so the panel refreshes — otherwise Explore keeps showing
    // the previous result (e.g. a service-map node graph still rendered on the Traces tab).
    reloadStreamsAndApply(
      query.organization,
      nextStreamType,
      { queryType: nextQueryType, displayMode: getDisplayModeForQueryType(nextQueryType) },
      isMounted
    );
  };

  const streamTypeUpdated = (option: { value: OpenObserveStreamType } | null) => {
    if (!option) {
      return;
    }
    reloadStreamsAndApply(query.organization, option.value, { queryType }, isMounted);
  };

  const streamUpdated = (stream: { value: string } | null) => {
    if (!stream) {
      return;
    }
    updateDataSourceFields(stream.value);
    updateQuery({ stream: stream.value, queryType, streamType }, true);
  };

  const orgUpdated = (organization: { value: string } | null) => {
    if (!organization) {
      return;
    }
    reloadStreamsAndApply(organization.value, streamType, { queryType }, isMounted);
  };

  const updateField = (field: keyof MyQuery, value: string) => {
    updateQuery({ [field]: value } as Partial<MyQuery>);
  };

  const updateOptionalField = (field: keyof MyQuery, option: { value: string } | null) => {
    updateQuery({ [field]: option?.value || '' } as Partial<MyQuery>);
  };

  const updateSelectField = <K extends keyof MyQuery>(field: K, option: { value: MyQuery[K] }) => {
    updateQuery({ [field]: option.value } as Partial<MyQuery>);
  };

  const runStructuredQuery = () => {
    onRunQuery();
  };

  const toggleFastMode = (enabled: boolean) => {
    onChange({ ...query, fastMode: enabled });
    onRunQuery();
  };

  const sqlValue = query.sqlMode ? query.query || '' : generatedSql;
  const sqlSchemaFields = streamDetails[query.stream]?.schema || [];

  // Any manual edit takes over the SQL verbatim (sqlMode = true) so spaces and clauses
  // like WHERE are never stripped by re-generating the SQL from the structured filters.
  const updateSql = (value: string) => {
    onChange({
      ...query,
      query: value,
      sqlMode: true,
      logQuery: '',
      advancedTraceSql: '',
    });
  };

  const resetSql = () => {
    updateQuery({
      sqlMode: false,
      displayMode: getDisplayModeForQueryType(queryType),
      logQuery: '',
      advancedTraceSql: '',
    });
  };

  const setAggregateField = (option: { value: string } | null) => {
    onChange({ ...query, aggregateField: option?.value || '' });
  };

  const setTopK = (value: string) => {
    const parsed = parseInt(value, 10);
    onChange({ ...query, topK: Number.isFinite(parsed) && parsed > 0 ? parsed : undefined });
  };

  // Build a GROUP BY / COUNT query for the selected field and run it as a table, so a single
  // click surfaces the top K values of a column (honoring the current full-text filter).
  const showTopValues = () => {
    const field = (query.aggregateField || '').trim();
    if (!field || !query.stream) {
      return;
    }
    const limit = query.topK && query.topK > 0 ? Math.trunc(query.topK) : 10;
    const fullText = (query.fullText || '').trim();
    const where = fullText ? ` WHERE match_all('${escapeSqlString(fullText)}')` : '';
    const sql =
      `SELECT ${quoteIdentifier(field)} AS ${quoteIdentifier(field)}, count(*) AS count ` +
      `FROM ${quoteIdentifier(query.stream)}${where} ` +
      `GROUP BY ${quoteIdentifier(field)} ORDER BY count DESC LIMIT ${limit}`;

    // The result renders as a table because the SQL aggregates (GROUP BY) — the datasource
    // detects this from the query, so no sticky display flag is needed.
    onChange({
      ...query,
      query: sql,
      sqlMode: true,
      logQuery: '',
      advancedTraceSql: '',
    });
    onRunQuery();
  };

  const renderSqlEditor = () => (
    <div className={styles.sqlEditor}>
      <div className={styles.sqlHeader}>
        <span className={styles.sqlLabel}>SQL</span>
        <Button type="button" variant="secondary" size="sm" fill="outline" onClick={resetSql}>
          Reset to generated SQL
        </Button>
      </div>
      <p className={styles.helperText}>
        使用 <code>str_match(field, &apos;123&apos;)</code> 比 <code>LIKE &apos;%123%&apos;</code> 更快；参考文档：
        <a href="https://openobserve.ai/docs/reference/sql-functions/" target="_blank" rel="noreferrer">
          https://openobserve.ai/docs/reference/sql-functions/
        </a>
      </p>
      <div className={styles.sqlEditorBox}>
        <ZincEditor
          id={`oo-sql-${query.refId}`}
          query={sqlValue}
          isSQLMode={query.sqlMode}
          placeholder="SELECT * FROM stream WHERE ..."
          getFields={sqlSchemaFields}
          timestamp_column={timestampColumn}
          runQuery={onRunQuery}
          onChange={({ value }) => updateSql(value)}
        />
      </div>
    </div>
  );

  const renderFilterRow = (label: string, controls: React.ReactNode) => (
    <div className={styles.filterRow}>
      <div className={styles.filterLabel}>{label}</div>
      <div className={styles.filterControls}>{controls}</div>
    </div>
  );

  const renderLogSearch = () => (
    <div className={styles.panel}>
      <div className={styles.searchRow}>
        <div className={styles.searchInput}>
          <Input
            value={query.fullText || ''}
            placeholder="Full-text search (optional)"
            onChange={(event) => updateQuery({ fullText: event.currentTarget.value, sqlMode: false })}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                onRunQuery();
              }
            }}
          />
        </div>
        <Button type="button" variant="primary" onClick={runStructuredQuery}>
          Run query
        </Button>
        <InlineField
          label="Fast mode"
          tooltip="Skip the logs volume histogram for faster queries (one request instead of two)."
          transparent
        >
          <InlineSwitch
            value={!!query.fastMode}
            onChange={(event) => toggleFastMode(event.currentTarget.checked)}
          />
        </InlineField>
      </div>
      <div className={styles.searchRow}>
        <span className={styles.inlineHint}>Top values</span>
        <Combobox
          options={streamColumnOptions}
          value={query.aggregateField || null}
          onChange={setAggregateField}
          width={32}
          placeholder="Select a field"
          isClearable
        />
        <Input
          type="number"
          min={1}
          width={12}
          value={query.topK ?? 10}
          aria-label="Top K"
          onChange={(event) => setTopK(event.currentTarget.value)}
        />
        <Button type="button" variant="secondary" disabled={!query.aggregateField} onClick={showTopValues}>
          Show top values
        </Button>
      </div>
      {renderSqlEditor()}
    </div>
  );

  const renderTraceFilters = () => (
    <div className={styles.panel}>
      {renderFilterRow(
        'Service Name',
        <>
          <span className={styles.operatorBadge}>=</span>
          <Combobox
            options={loadFieldValues(serviceNameField)}
            value={query.serviceName || null}
            onChange={(option) => updateOptionalField('serviceName', option)}
            width={34}
            placeholder="Select value"
            isClearable
          />
        </>
      )}
      {renderFilterRow(
        'Span Name',
        <>
          <span className={styles.operatorBadge}>=</span>
          <Combobox
            options={loadFieldValues(spanNameField)}
            value={query.spanName || null}
            onChange={(option) => updateOptionalField('spanName', option)}
            width={34}
            placeholder="Select value"
            isClearable
          />
        </>
      )}
      {renderFilterRow(
        'Status',
        <>
          <span className={styles.operatorBadge}>=</span>
          <Combobox
            options={STATUS_OPTIONS}
            value={query.status || ''}
            onChange={(option) => updateOptionalField('status', option)}
            width={34}
            placeholder="Any status"
            isClearable
          />
        </>
      )}
      {renderFilterRow(
        'Duration',
        <>
          <Combobox
            options={DURATION_SCOPE_OPTIONS}
            value={query.durationScope || 'span'}
            onChange={(option) => updateSelectField('durationScope', option)}
            width={20}
          />
          <Combobox
            options={DURATION_OPERATOR_OPTIONS}
            value={query.durationOperator || '>'}
            onChange={(option) => updateSelectField('durationOperator', option)}
            width={10}
          />
          <Input
            value={query.durationValue || ''}
            placeholder="e.g. 100ms, 1.2s"
            width={20}
            onChange={(event) => updateField('durationValue', event.currentTarget.value)}
          />
        </>
      )}
      {renderFilterRow(
        'Tags',
        <>
          <Combobox
            options={TAG_SCOPE_OPTIONS}
            value={query.tagScope || 'span'}
            onChange={(option) => updateSelectField('tagScope', option)}
            width={20}
          />
          <Combobox
            options={schemaFieldOptions}
            value={query.tagKey || null}
            onChange={(option) => updateOptionalField('tagKey', option)}
            width={28}
            placeholder="Select tag"
            isClearable
          />
          <Combobox
            options={FILTER_OPERATOR_OPTIONS}
            value={query.tagOperator || '='}
            onChange={(option) => updateSelectField('tagOperator', option)}
            width={12}
          />
          <Combobox
            options={loadFieldValues(query.tagKey || '')}
            value={query.tagValue || null}
            onChange={(option) => updateOptionalField('tagValue', option)}
            width={28}
            placeholder="Select value"
            disabled={!query.tagKey}
            isClearable
          />
        </>
      )}
      <div className={styles.actionsRow}>
        <Button type="button" variant="primary" onClick={runStructuredQuery}>
          Run query
        </Button>
        <span className={styles.helperText}>
          {queryType === 'service_graph'
            ? 'Services and call edges are aggregated server-side across the full time range.'
            : 'Results are listed as a table — open any trace to inspect its spans.'}
        </span>
      </div>
      {queryType !== 'service_graph' && renderSqlEditor()}
    </div>
  );

  const tabValue: QueryTabValue =
    queryType === 'service_graph' ? 'service_graph' : queryType === 'logs' ? 'logs' : 'traces';

  return (
    <div className={styles.container}>
      <RadioButtonGroup options={QUERY_TYPE_OPTIONS} value={tabValue} onChange={queryTypeUpdated} />

      <div className={styles.headerRow}>
        <InlineLabel
          data-testid="query-editor-select-organization-label"
          width="auto"
          className={styles.headerLabel}
        >
          Organization
        </InlineLabel>
        <Combobox
          id="query-editor-select-organization-input"
          options={orgOptions}
          value={query.organization}
          onChange={orgUpdated}
          loading={isLoading}
          width={26}
        />
        {queryType === 'logs' && (
          <>
            <InlineLabel width="auto" className={styles.headerLabel}>
              Stream type
            </InlineLabel>
            <Combobox
              id="query-editor-select-stream-type-input"
              options={STREAM_TYPE_OPTIONS}
              value={streamType}
              onChange={streamTypeUpdated}
              loading={isLoading}
              width={22}
            />
          </>
        )}
        <InlineLabel data-testid="query-editor-select-stream-label" width="auto" className={styles.headerLabel}>
          {queryType === 'logs' ? 'Log stream' : 'Trace stream'}
        </InlineLabel>
        <Combobox
          id="query-editor-select-stream-input"
          options={streamOptions}
          value={query.stream}
          onChange={streamUpdated}
          loading={isLoading}
          width={26}
        />
      </div>

      {query.stream && queryType === 'logs' && renderLogSearch()}
      {query.stream &&
        (queryType === 'traces' || queryType === 'trace_id' || queryType === 'service_graph') &&
        renderTraceFilters()}
    </div>
  );
};
