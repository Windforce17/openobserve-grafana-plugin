import {
  buildServiceMapFromAggregates,
  getTableDataFrame,
  getTimeSeriesByLabelFrames,
  getTraceDataFrame,
  getTracesTableDataFrame,
} from './queryResponseBuilder';
import { FieldType } from '@grafana/data';
import { MyQuery } from '../../types';

const target = { refId: 'A', stream: 'default', organization: 'default' } as unknown as MyQuery;

// Spans shaped like OpenObserve traces. Note the generic `name` field carries an unrelated
// value and must NOT be used as the span/operation name.
const spans = [
  {
    trace_id: 't1',
    span_id: 's1',
    reference_parent_span_id: '',
    service_name: 'gateway',
    operation_name: 'GET /api',
    name: 'unrelated-name-field',
    start_time: 1780424218864000000,
    span_duration_nano: 5_000_000,
    span_status: 'OK',
  },
  {
    trace_id: 't1',
    span_id: 's2',
    reference_parent_span_id: 's1',
    service_name: 'billing',
    operation_name: 'charge',
    name: 'unrelated-name-field',
    start_time: 1780424218865000000,
    span_duration_nano: 2_000_000,
    span_status: 'ERROR',
  },
];

describe('getTracesTableDataFrame', () => {
  it('names the trace from the root span service + operation_name (not the generic name field)', () => {
    const frame = getTracesTableDataFrame(spans, target);
    const traceName = frame.fields.find((f) => f.name === 'traceName')!;
    const spanCount = frame.fields.find((f) => f.name === 'spanCount')!;

    expect(traceName.values[0]).toBe('gateway: GET /api');
    expect(spanCount.values[0]).toBe(2);
  });
});

describe('getTraceDataFrame', () => {
  it('uses operation_name for operationName and never the generic name field', () => {
    const frame = getTraceDataFrame(spans, target);
    const operationName = frame.fields.find((f) => f.name === 'operationName')!;
    const serviceName = frame.fields.find((f) => f.name === 'serviceName')!;

    expect(operationName.values).toEqual(['GET /api', 'charge']);
    expect(operationName.values).not.toContain('unrelated-name-field');
    expect(serviceName.values).toEqual(['gateway', 'billing']);
  });
});

describe('getTableDataFrame', () => {
  it('types a histogram "time" column as time and converts it to ms (drives timeseries panels)', () => {
    const rows = [
      { time: '2026-06-03T15:00:00', service_name: 'gateway', requests: 10 },
      { time: '2026-06-03T15:01:00', service_name: 'gateway', requests: 12 },
    ];
    const frame = getTableDataFrame(rows, target);
    const timeField = frame.fields.find((f) => f.name === 'time')!;
    const requests = frame.fields.find((f) => f.name === 'requests')!;

    expect(timeField.type).toBe(FieldType.time);
    expect(timeField.values[0]).toBe(Date.parse('2026-06-03T15:00:00Z'));
    expect(requests.type).toBe(FieldType.number);
  });

  it('does NOT mistake a large numeric (e.g. COUNT) column for a timestamp', () => {
    const rows = [{ service_name: 'gateway', total: 31154571 }];
    const frame = getTableDataFrame(rows, target);
    const total = frame.fields.find((f) => f.name === 'total')!;

    expect(total.type).toBe(FieldType.number);
    expect(total.values[0]).toBe(31154571);
  });

  it('exposes a single-stat aggregate result as a numeric field', () => {
    const frame = getTableDataFrame([{ 'Total Spans': 31154571 }], target);
    const field = frame.fields.find((f) => f.name === 'Total Spans')!;
    expect(field.type).toBe(FieldType.number);
    expect(field.values).toEqual([31154571]);
  });
});

describe('buildServiceMapFromAggregates', () => {
  it('builds node + edge frames from aggregated rows', () => {
    const nodeRows = [
      { service_name: 'gateway', span_count: 100, error_count: 5 },
      { service_name: 'billing', span_count: 40, error_count: 0 },
    ];
    const edgeRows = [{ source: 'gateway', target: 'billing', call_count: 30 }];

    const [nodes, edges] = buildServiceMapFromAggregates(nodeRows, edgeRows, target);

    expect(nodes.fields.find((f) => f.name === 'id')!.values).toEqual(expect.arrayContaining(['gateway', 'billing']));
    expect(nodes.fields.find((f) => f.name === 'mainstat')!.values).toEqual(expect.arrayContaining([100, 40]));
    expect(edges.fields.find((f) => f.name === 'source')!.values).toEqual(['gateway']);
    expect(edges.fields.find((f) => f.name === 'target')!.values).toEqual(['billing']);
    expect(edges.fields.find((f) => f.name === 'mainstat')!.values).toEqual([30]);
  });

  it('adds missing edge endpoints as nodes and drops self-edges', () => {
    const [nodes, edges] = buildServiceMapFromAggregates(
      [{ service_name: 'a', span_count: 1, error_count: 0 }],
      [
        { source: 'a', target: 'b', call_count: 2 },
        { source: 'c', target: 'c', call_count: 9 },
      ],
      target
    );

    expect(nodes.fields.find((f) => f.name === 'id')!.values).toEqual(expect.arrayContaining(['a', 'b']));
    // self-edge c -> c is dropped
    expect(edges.length).toBe(1);
  });
});

describe('getTimeSeriesByLabelFrames', () => {
  const tsTarget = { refId: 'A', stream: 'default', organization: 'default' } as unknown as MyQuery;

  // Two services x two time buckets, long format like `histogram(_timestamp) AS time, service_name, tpm_now`.
  const rows = [
    { time: '2026-06-16T00:00:00', service_name: 'checkout', tpm_now: 10 },
    { time: '2026-06-16T00:01:00', service_name: 'checkout', tpm_now: 12 },
    { time: '2026-06-16T00:00:00', service_name: 'cart', tpm_now: 3 },
    { time: '2026-06-16T00:01:00', service_name: 'cart', tpm_now: 5 },
  ];

  it('produces one labeled series frame per group, time-sorted', () => {
    const frames = getTimeSeriesByLabelFrames(rows, tsTarget);
    expect(frames.length).toBe(2);

    const checkout = frames.find((f) => f.name === 'checkout')!;
    expect(checkout).toBeDefined();

    const timeField = checkout.fields.find((f) => f.name === 'Time')!;
    expect(timeField.type).toBe(FieldType.time);
    expect(timeField.values.length).toBe(2);
    expect(typeof timeField.values[0]).toBe('number');

    const valueField = checkout.fields.find((f) => f.name === 'tpm_now')!;
    expect(valueField.type).toBe(FieldType.number);
    expect(valueField.values).toEqual([10, 12]);
    // service_name carried as a label so "Time series to table" surfaces it as a column.
    expect(valueField.labels).toEqual({ service_name: 'checkout' });
  });

  it('keeps each group isolated', () => {
    const frames = getTimeSeriesByLabelFrames(rows, tsTarget);
    const cart = frames.find((f) => f.name === 'cart')!;
    expect(cart.fields.find((f) => f.name === 'tpm_now')!.values).toEqual([3, 5]);
    expect(cart.fields.find((f) => f.name === 'tpm_now')!.labels).toEqual({ service_name: 'cart' });
  });

  it('collapses to a single frame when there is no dimension column', () => {
    const dimless = [
      { time: '2026-06-16T00:00:00', p95: 100 },
      { time: '2026-06-16T00:01:00', p95: 120 },
    ];
    const frames = getTimeSeriesByLabelFrames(dimless, tsTarget);
    expect(frames.length).toBe(1);
    expect(frames[0].fields.find((f) => f.name === 'p95')!.values).toEqual([100, 120]);
  });

  it('returns a single empty frame for no data', () => {
    const frames = getTimeSeriesByLabelFrames([], tsTarget);
    expect(frames.length).toBe(1);
    expect(frames[0].length).toBe(0);
  });
});
