import { MyDataSourceOptions } from 'types';
import { DataSource } from './datasource';
import { DataSourceInstanceSettings, PluginSignatureStatus, PluginType } from '@grafana/data';
import { buildQuery } from 'features/query/queryBuilder';

let DateTime = {
  add: jest.fn(),
  set: jest.fn(),
  diff: jest.fn(),
  endOf: jest.fn(),
  format: jest.fn(),
  fromNow: jest.fn(),
  from: jest.fn(),
  isSame: jest.fn(),
  isBefore: jest.fn(),
  isValid: jest.fn(),
  local: jest.fn(),
  locale: jest.fn(),
  startOf: jest.fn(),
  subtract: jest.fn(),
  toDate: jest.fn(),
  toISOString: jest.fn(),
  isoWeekday: jest.fn(),
  valueOf: jest.fn().mockReturnValue(new Date('2023-05-16T00:00:00Z')),
  unix: jest.fn(),
  utc: jest.fn(),
  utcOffset: jest.fn(),
  hour: jest.fn(),
  minute: jest.fn(),
};

jest.mock('rxjs', () => {
  return {
    Observable: jest.fn(),
  };
});

jest.mock('@grafana/runtime', () => ({
  config: {
    bootData: {
      user: {
        theme: 'light',
      },
    },
  },
  getBackendSrv: () => {
    return {
      post: jest.fn().mockResolvedValue({
        hits: [
          {
            _p: 'F',
            _timestamp: 1684219692352167,
            kubernetes_container_hash:
              'registry.k8s.io/ingress-nginx/controller@sha256:4ba73c697770664c1e00e9f968de14e08f606ff961c76e5d7033a4a9c593c629',
            kubernetes_container_image: 'sha256:f2e1146a6d96ac8eebb251284f45f8569f5879c6ec894ae1335d26617d36af2d',
            kubernetes_container_name: 'controller',
            kubernetes_docker_id: 'e7d62026ddcae35198986225d10ca11080fac2cd1537d427e1ca5007cb9d4311',
            kubernetes_host: 'gke-dev1-default-pool-e40c8755-duy8',
            kubernetes_labels_app_kubernetes_io_component: 'controller',
            kubernetes_labels_app_kubernetes_io_instance: 'ingress-nginx',
            kubernetes_labels_app_kubernetes_io_name: 'ingress-nginx',
            kubernetes_labels_pod_template_hash: '6f7bd4bcfb',
            kubernetes_namespace_name: 'ingress-nginx',
            kubernetes_pod_id: '109d2bd2-53d0-4e58-9588-69563e6891ef',
            kubernetes_pod_name: 'ingress-nginx-controller-6f7bd4bcfb-8dslk',
            log: '203.0.113.10 - root@example.com [16/May/2023:06:48:12 +0000] "POST /api/example_org/default/_json HTTP/2.0" 200 86 "-" "Fluent-Bit" 44501 0.008 [example-router] [] 10.0.0.1:5080 102 0.008 200 f0455fd5afbee4926c34606fd33a30f9',
            stream: 'stdout',
            time: '2023-05-16T06:48:12.352167318Z',
          },
        ],
      }),
    };
  },
  reportInteraction: jest.fn(),
  getTemplateSrv: () => ({
    replace: jest.fn((str) => str),
  }),
}));

describe('DataSource', () => {
  const instanceSettings: DataSourceInstanceSettings<MyDataSourceOptions> = {
    id: 2,
    uid: 'fd886f75-fdd9-444b-8868-be92687ff464',
    type: 'zinc-grafanatest-datasource',
    name: 'OpenObserve',
    meta: {
      id: 'zinc-grafanatest-datasource',
      type: 'datasource' as PluginType,
      name: 'OpenObserve',
      info: {
        author: {
          name: 'OpenObserve',
          url: '',
        },
        description: 'OpenObserve',
        links: [],
        logos: {
          small: 'public/plugins/zinc-grafanatest-datasource/img/logo.png',
          large: 'public/plugins/zinc-grafanatest-datasource/img/logo.png',
        },
        build: {},
        screenshots: [],
        version: '1.0.0',
        updated: '2023-05-15',
      },
      dependencies: {
        grafanaDependency: '^9.3.8',
        grafanaVersion: '*',
        plugins: [],
        extensions: {
          exposedComponents: [],
        }
      },
      includes: undefined,
      category: '',
      backend: false,
      annotations: false,
      metrics: true,
      alerting: false,
      logs: true,
      tracing: false,
      streaming: false,
      signature: 'unsigned' as PluginSignatureStatus,
      module: 'plugins/zinc-grafanatest-datasource/module',
      baseUrl: 'public/plugins/zinc-grafanatest-datasource',
    },
    url: '/api/datasources/proxy/uid/fd886f75-fdd9-444b-8868-be92687ff464',
    isDefault: false,
    access: 'proxy',
    jsonData: {
      timestamp_column: '_timestamp',
      url: '/api/datasources/proxy/uid/fd886f75-fdd9-444b-8868-be92687ff464',
    },
    readOnly: false,
  };

  let ds: DataSource;

  beforeEach(() => {
    ds = new DataSource(instanceSettings);
  });

  describe('testDatasource', () => {
    it('should return success status', async () => {
      const result = await ds.testDatasource();

      expect(result).toEqual({
        status: 'error',
        message: 'Unable to connect OpenObserve . Verify that OpenObserve is correctly configured',
      });
    });
  });

  describe('When query method is called', () => {
    let options = {
      app: 'explore',
      timezone: 'browser',
      startTime: 1684212732045,
      interval: '2s',
      intervalMs: 2000,
      panelId: 325325235425,
      targets: [
        {
          refId: 'A',
          datasource: {
            type: 'zinc-grafanatest-datasource',
            uid: 'fd886f75-fdd9-444b-8868-be92687ff464',
          },
          stream: 'gke-fluentbit',
          organization: 'default',
          constant: 5,
          streamFields: [
            {
              name: '_p',
              type: 'Utf8',
            },
            {
              name: '_timestamp',
              type: 'Int64',
            },
            {
              name: 'kubernetes_annotations_checksum_config',
              type: 'Utf8',
            },
            {
              name: 'kubernetes_annotations_checksum_luascripts',
              type: 'Utf8',
            },
            {
              name: 'kubernetes_container_image',
              type: 'Utf8',
            },
            {
              name: 'kubernetes_container_name',
              type: 'Utf8',
            },
            {
              name: 'kubernetes_docker_id',
              type: 'Utf8',
            },
            {
              name: 'kubernetes_host',
              type: 'Utf8',
            },
            {
              name: 'kubernetes_labels_app_kubernetes_io_instance',
              type: 'Utf8',
            },
            {
              name: 'kubernetes_labels_app_kubernetes_io_name',
              type: 'Utf8',
            },
            {
              name: 'kubernetes_labels_controller_revision_hash',
              type: 'Utf8',
            },
            {
              name: 'kubernetes_labels_pod_template_generation',
              type: 'Utf8',
            },
            {
              name: 'kubernetes_namespace_name',
              type: 'Utf8',
            },
            {
              name: 'kubernetes_pod_id',
              type: 'Utf8',
            },
            {
              name: 'kubernetes_pod_name',
              type: 'Utf8',
            },
            {
              name: 'log',
              type: 'Utf8',
            },
            {
              name: 'stream',
              type: 'Utf8',
            },
            {
              name: 'time',
              type: 'Utf8',
            },
            {
              name: 'kubernetes_container_hash',
              type: 'Utf8',
            },
            {
              name: 'kubernetes_labels_app',
              type: 'Utf8',
            },
            {
              name: 'kubernetes_labels_component',
              type: 'Utf8',
            },
          ],
          sqlMode: true,
          query: 'SELECT *  FROM "gke-fluentbit" ',
          key: 'Q-7f589db2-4fa2-424a-a36a-3fc9bcff8ebd-0',
        },
      ],
      range: {
        from: DateTime,
        to: DateTime,
        raw: {
          from: 'now-1h',
          to: 'now',
        },
      },
      requestId: 'explore_left',
      rangeRaw: {
        from: 'now-1h',
        to: 'now',
      },
      scopedVars: {
        __interval: {
          text: '2s',
          value: '2s',
        },
        __interval_ms: {
          text: 2000,
          value: 2000,
        },
      },
      maxDataPoints: 1378,
      liveStreaming: false,
      endTime: 1684212733488,
    };
    let result: any;
    let doRequest: any;
    beforeEach(async () => {
      doRequest = jest.spyOn(ds, 'doRequest');
      result = await ds.query(options);
    });
    it('should call doRequest', () => {
      expect(doRequest).toHaveBeenCalledTimes(1);
    });
    it('should return DataFrame', () => {
      expect(result.data.length).toBe(1);
    });
  });

  describe('histogram request body', () => {
    it('rewrites the base query into a single histogram aggregation by the timestamp column', () => {
      const target: any = {
        refId: 'log-volume-A',
        stream: 'gke-fluentbit',
        organization: 'default',
        streamType: 'logs',
      };
      const request = (ds as any).buildHistogramRequest(target, {
        query: {
          sql: 'SELECT * FROM "gke-fluentbit" WHERE match_all(\'error\')',
          start_time: 1684224722497000,
          end_time: 1684228322497000,
          from: 0,
          size: 200,
          sql_mode: 'full',
        },
        search_type: 'ui',
        timeout: 0,
      });

      expect(request.query.sql).toBe(
        'SELECT histogram("_timestamp") AS zo_sql_key, count(*) AS zo_sql_num FROM "gke-fluentbit" WHERE match_all(\'error\') GROUP BY zo_sql_key ORDER BY zo_sql_key'
      );
      // Time bounds are preserved and the row-size cap is dropped so all buckets come back.
      expect(request.query.start_time).toBe(1684224722497000);
      expect(request.query.end_time).toBe(1684228322497000);
      expect(request.query.size).toBeUndefined();
    });

    it('issues exactly one request for the logs volume histogram', async () => {
      const target: any = {
        refId: 'log-volume-A',
        stream: 'gke-fluentbit',
        organization: 'default',
        streamType: 'logs',
        displayMode: 'graph',
      };
      const doHistogramRequest = jest.spyOn(ds as any, 'doHistogramRequest');

      await (ds as any).processHistogramQuery(
        target,
        { query: { sql: 'SELECT * FROM "gke-fluentbit"' } },
        { app: 'explore' },
        { promise: { resolve: jest.fn(), reject: jest.fn() } }
      );

      expect(doHistogramRequest).toHaveBeenCalledTimes(1);
    });
  });

  describe('aggregation (top values) detection', () => {
    it('treats a GROUP BY logs query as an aggregation (table, no histogram)', () => {
      const target: any = {
        refId: 'A',
        queryType: 'logs',
        sqlMode: true,
        query: 'SELECT "level" AS "level", count(*) AS count FROM "gke-fluentbit" GROUP BY "level" ORDER BY count DESC',
      };
      expect((ds as any).isAggregationLogsQuery(target)).toBe(true);
    });

    it('treats a plain logs query as logs (renders logs + histogram)', () => {
      const target: any = {
        refId: 'A',
        queryType: 'logs',
        sqlMode: true,
        query: 'SELECT * FROM "gke-fluentbit" WHERE match_all(\'error\')',
      };
      expect((ds as any).isAggregationLogsQuery(target)).toBe(false);
    });

    it('never treats trace queries as logs aggregations', () => {
      const target: any = { refId: 'A', queryType: 'traces', sqlMode: true, query: 'SELECT * FROM x GROUP BY y' };
      expect((ds as any).isAggregationLogsQuery(target)).toBe(false);
    });
  });

  describe('modifyQuery (filter for / out value)', () => {
    it('adds a WHERE clause when the query has none', () => {
      const query: any = { refId: 'A', queryType: 'logs', sqlMode: true, query: 'SELECT * FROM "gke-fluentbit"' };
      const result = ds.modifyQuery(query, { type: 'ADD_FILTER', options: { key: 'level', value: 'error' } } as any);
      expect(result.query).toBe('SELECT * FROM "gke-fluentbit" WHERE "level" = \'error\'');
      expect(result.sqlMode).toBe(true);
    });

    it('ANDs onto an existing WHERE and supports filter-out', () => {
      const query: any = {
        refId: 'A',
        queryType: 'logs',
        sqlMode: true,
        query: 'SELECT * FROM "gke-fluentbit" WHERE "level" = \'error\'',
      };
      const result = ds.modifyQuery(query, { type: 'ADD_FILTER_OUT', options: { key: 'app', value: 'web' } } as any);
      expect(result.query).toBe('SELECT * FROM "gke-fluentbit" WHERE "level" = \'error\' AND "app" != \'web\'');
    });

    it('inserts the condition before ORDER BY / LIMIT', () => {
      const query: any = {
        refId: 'A',
        queryType: 'logs',
        sqlMode: true,
        query: 'SELECT * FROM "gke-fluentbit" ORDER BY "_timestamp" DESC',
      };
      const result = ds.modifyQuery(query, { type: 'ADD_FILTER', options: { key: 'level', value: 'error' } } as any);
      expect(result.query).toBe('SELECT * FROM "gke-fluentbit" WHERE "level" = \'error\' ORDER BY "_timestamp" DESC');
    });
  });

  describe('buildSearch', () => {
    const queryData = {
      refId: 'A',
      constant: 5,
      datasource: {
        type: 'zinc-grafanatest-datasource',
        uid: 'fd886f75-fdd9-444b-8868-be92687ff464',
      },
      stream: 'gke-fluentbit',
      organization: 'default',
      streamFields: [
        {
          name: '_p',
          type: 'Utf8',
        },
        {
          name: '_timestamp',
          type: 'Int64',
        },
        {
          name: 'kubernetes_annotations_checksum_config',
          type: 'Utf8',
        },
        {
          name: 'kubernetes_annotations_checksum_luascripts',
          type: 'Utf8',
        },
        {
          name: 'kubernetes_container_image',
          type: 'Utf8',
        },
        {
          name: 'kubernetes_container_name',
          type: 'Utf8',
        },
        {
          name: 'kubernetes_docker_id',
          type: 'Utf8',
        },
        {
          name: 'kubernetes_host',
          type: 'Utf8',
        },
        {
          name: 'kubernetes_labels_app_kubernetes_io_instance',
          type: 'Utf8',
        },
        {
          name: 'kubernetes_labels_app_kubernetes_io_name',
          type: 'Utf8',
        },
        {
          name: 'kubernetes_labels_controller_revision_hash',
          type: 'Utf8',
        },
        {
          name: 'kubernetes_labels_pod_template_generation',
          type: 'Utf8',
        },
        {
          name: 'kubernetes_namespace_name',
          type: 'Utf8',
        },
        {
          name: 'kubernetes_pod_id',
          type: 'Utf8',
        },
        {
          name: 'kubernetes_pod_name',
          type: 'Utf8',
        },
        {
          name: 'log',
          type: 'Utf8',
        },
        {
          name: 'stream',
          type: 'Utf8',
        },
        {
          name: 'time',
          type: 'Utf8',
        },
        {
          name: 'kubernetes_container_hash',
          type: 'Utf8',
        },
      ],
      sqlMode: true,
      query: 'SELECT *  FROM "gke-fluentbit" ',
      key: 'Q-2985ff4a-77bf-49ad-a58b-0ce8963cdfc3-0',
    };
    const timestamps = {
      startTimeInMicro: 1684224722497000,
      endTimeInMirco: 1684228322497000,
    };

    let result: any;
    const expectedReq = {
      query: {
        sql: 'SELECT *  FROM "gke-fluentbit"',
        start_time: 1684224722497000,
        end_time: 1684228322497000,
        from: 0,
        size: 200,
        sql_mode: 'full',
      },
      search_type: 'ui',
      timeout: 180,
    };
    beforeEach(async () => {
      result = buildQuery(queryData, timestamps, queryData.streamFields, 'explore', '_timestamp');
    });
    it('should return query request data', () => {
      expect(JSON.stringify(result)).toMatch(JSON.stringify(expectedReq));
    });
  });
});
