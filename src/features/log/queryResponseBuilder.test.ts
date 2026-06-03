import { buildServiceMapFromAggregates, getTraceDataFrame, getTracesTableDataFrame } from './queryResponseBuilder';
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
