package plugin

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/grafana/grafana-plugin-sdk-go/backend/httpclient"
	"github.com/grafana/grafana-plugin-sdk-go/backend/instancemgmt"
	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
	"github.com/grafana/grafana-plugin-sdk-go/data"
)

// queryTimeoutSeconds matches QUERY_TIMEOUT_SECONDS in src/datasource.ts (OpenObserve's own cap).
const queryTimeoutSeconds = 180

// defaultRowLimit caps rows returned for a non-aggregating query. Aggregations (e.g. count(*)) return
// few rows regardless, so this only bounds raw log scans.
const defaultRowLimit = 1000

// Datasource is the backend instance for a single OpenObserve datasource. The SDK creates one per
// datasource configuration via NewDatasource and reuses it across queries.
type Datasource struct {
	settings   instanceSettings
	baseURL    string
	httpClient *http.Client
}

// Compile-time checks that we implement the handlers Grafana needs (QueryData powers alerting).
var (
	_ backend.QueryDataHandler      = (*Datasource)(nil)
	_ backend.CheckHealthHandler    = (*Datasource)(nil)
	_ instancemgmt.InstanceDisposer = (*Datasource)(nil)
)

// NewDatasource builds a Datasource from the saved settings. The HTTP client is created from the
// datasource's HTTP options so Grafana-managed basic auth / TLS / proxy settings are applied
// automatically — the same auth the frontend relied on through getBackendSrv().
func NewDatasource(ctx context.Context, ds backend.DataSourceInstanceSettings) (instancemgmt.Instance, error) {
	settings, err := newInstanceSettings(ds.JSONData)
	if err != nil {
		return nil, err
	}

	opts, err := ds.HTTPClientOptions(ctx)
	if err != nil {
		return nil, fmt.Errorf("building http client options: %w", err)
	}
	opts.Timeouts.Timeout = (queryTimeoutSeconds + 30) * time.Second

	cl, err := httpclient.New(opts)
	if err != nil {
		return nil, fmt.Errorf("building http client: %w", err)
	}

	return &Datasource{
		settings:   settings,
		baseURL:    strings.TrimRight(ds.URL, "/"),
		httpClient: cl,
	}, nil
}

// Dispose releases idle connections when the datasource instance is replaced.
func (d *Datasource) Dispose() {
	if d.httpClient != nil {
		d.httpClient.CloseIdleConnections()
	}
}

// QueryData runs each query in the request. Errors are returned per-RefID so one bad query does not
// fail the others — this is the entrypoint Unified Alerting calls to evaluate rule queries.
func (d *Datasource) QueryData(ctx context.Context, req *backend.QueryDataRequest) (*backend.QueryDataResponse, error) {
	resp := backend.NewQueryDataResponse()
	for _, q := range req.Queries {
		resp.Responses[q.RefID] = d.query(ctx, q)
	}
	return resp, nil
}

// searchResponse is the relevant subset of the OpenObserve /_search response body.
type searchResponse struct {
	Hits  []map[string]interface{} `json:"hits"`
	Total int                      `json:"total"`
	Code  int                      `json:"code"`
	Msg   string                   `json:"message"`
}

func (d *Datasource) query(ctx context.Context, q backend.DataQuery) backend.DataResponse {
	var qm queryModel
	if err := json.Unmarshal(q.JSON, &qm); err != nil {
		return backend.ErrDataResponse(backend.StatusBadRequest, fmt.Sprintf("parsing query: %v", err))
	}

	sql := d.settings.buildSQL(qm)
	if strings.TrimSpace(sql) == "" {
		return backend.ErrDataResponse(backend.StatusBadRequest, "query produced empty SQL")
	}

	// OpenObserve expects start/end in microseconds. Prefer the query's explicit window (used by the
	// "compare to previous period" feature) and otherwise use the panel/alert time range.
	startMicro := qm.StartTimeInMicro
	endMicro := qm.EndTimeInMicro
	if startMicro == 0 {
		startMicro = q.TimeRange.From.UnixMicro()
	}
	if endMicro == 0 {
		endMicro = q.TimeRange.To.UnixMicro()
	}

	size := qm.Size
	if size <= 0 {
		size = defaultRowLimit
	}

	body := map[string]interface{}{
		"query": map[string]interface{}{
			"sql":        sql,
			"start_time": startMicro,
			"end_time":   endMicro,
			"from":       0,
			"size":       size,
			"sql_mode":   "full",
		},
		"search_type": "ui",
		"timeout":     queryTimeoutSeconds,
	}

	sr, err := d.doSearch(ctx, qm, body)
	if err != nil {
		return backend.ErrDataResponse(backend.StatusInternal, err.Error())
	}

	frame := d.framesFromHits(q.RefID, sr.Hits)
	return backend.DataResponse{Frames: data.Frames{frame}}
}

// doSearch posts a search request to OpenObserve and decodes the response.
func (d *Datasource) doSearch(ctx context.Context, qm queryModel, body map[string]interface{}) (*searchResponse, error) {
	org := d.settings.resolveOrg(qm)
	pageType := qm.resolveStreamType()

	u := fmt.Sprintf("%s/api/%s/_search?type=%s&search_type=ui&use_cache=true",
		d.baseURL, url.PathEscape(org), url.QueryEscape(pageType))

	payload, err := json.Marshal(body)
	if err != nil {
		return nil, fmt.Errorf("encoding request body: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, u, bytes.NewReader(payload))
	if err != nil {
		return nil, fmt.Errorf("building request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")

	httpResp, err := d.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("calling OpenObserve _search: %w", err)
	}
	defer httpResp.Body.Close()

	raw, err := io.ReadAll(httpResp.Body)
	if err != nil {
		return nil, fmt.Errorf("reading OpenObserve response: %w", err)
	}

	if httpResp.StatusCode < 200 || httpResp.StatusCode >= 300 {
		msg := strings.TrimSpace(string(raw))
		if len(msg) > 500 {
			msg = msg[:500]
		}
		return nil, fmt.Errorf("OpenObserve returned %d: %s", httpResp.StatusCode, msg)
	}

	var sr searchResponse
	if err := json.Unmarshal(raw, &sr); err != nil {
		return nil, fmt.Errorf("decoding OpenObserve response: %w", err)
	}
	return &sr, nil
}

// framesFromHits converts the OpenObserve hit list into a single Grafana data frame. Columns are
// inferred from the union of hit keys; the configured timestamp column becomes a time field so
// time-series panels work, numeric values become float64 fields (nullable to tolerate gaps), and
// everything else becomes a string field. A numeric field is exactly what alerting's reduce/threshold
// expressions consume, so an aggregate like `count(*) AS cnt` yields a usable single-value frame.
func (d *Datasource) framesFromHits(refID string, hits []map[string]interface{}) *data.Frame {
	frame := data.NewFrame(refID)
	frame.RefID = refID

	if len(hits) == 0 {
		return frame
	}

	cols := orderedColumns(hits)
	tsCol := d.settings.timestampColumn()

	for _, col := range cols {
		switch fieldKind(col, tsCol, hits) {
		case kindTime:
			vals := make([]*time.Time, len(hits))
			for i, h := range hits {
				if micros, ok := toInt64(h[col]); ok {
					t := time.UnixMicro(micros)
					vals[i] = &t
				}
			}
			frame.Fields = append(frame.Fields, data.NewField(col, nil, vals))
		case kindNumber:
			vals := make([]*float64, len(hits))
			for i, h := range hits {
				if f, ok := toFloat64(h[col]); ok {
					v := f
					vals[i] = &v
				}
			}
			frame.Fields = append(frame.Fields, data.NewField(col, nil, vals))
		default:
			vals := make([]*string, len(hits))
			for i, h := range hits {
				if h[col] != nil {
					s := toString(h[col])
					vals[i] = &s
				}
			}
			frame.Fields = append(frame.Fields, data.NewField(col, nil, vals))
		}
	}
	return frame
}

type fieldKindT int

const (
	kindString fieldKindT = iota
	kindNumber
	kindTime
)

func fieldKind(col, tsCol string, hits []map[string]interface{}) fieldKindT {
	if col == tsCol {
		// Confirm it actually looks numeric (microsecond epoch) before treating it as time.
		for _, h := range hits {
			if _, ok := toInt64(h[col]); ok {
				return kindTime
			}
			if h[col] != nil {
				break
			}
		}
	}
	for _, h := range hits {
		v := h[col]
		if v == nil {
			continue
		}
		if _, ok := toFloat64(v); ok {
			return kindNumber
		}
		return kindString
	}
	return kindString
}

// orderedColumns returns the union of keys across hits, keeping first-seen order for stability and
// sorting any later-appearing keys so output is deterministic.
func orderedColumns(hits []map[string]interface{}) []string {
	seen := map[string]bool{}
	var ordered []string
	for _, k := range keysSorted(hits[0]) {
		seen[k] = true
		ordered = append(ordered, k)
	}
	var extra []string
	for _, h := range hits[1:] {
		for k := range h {
			if !seen[k] {
				seen[k] = true
				extra = append(extra, k)
			}
		}
	}
	sort.Strings(extra)
	return append(ordered, extra...)
}

func keysSorted(m map[string]interface{}) []string {
	ks := make([]string, 0, len(m))
	for k := range m {
		ks = append(ks, k)
	}
	sort.Strings(ks)
	return ks
}

func toFloat64(v interface{}) (float64, bool) {
	switch n := v.(type) {
	case float64:
		return n, true
	case float32:
		return float64(n), true
	case int:
		return float64(n), true
	case int64:
		return float64(n), true
	case json.Number:
		f, err := n.Float64()
		return f, err == nil
	}
	return 0, false
}

func toInt64(v interface{}) (int64, bool) {
	switch n := v.(type) {
	case float64:
		return int64(n), true
	case int64:
		return n, true
	case int:
		return int64(n), true
	case json.Number:
		i, err := n.Int64()
		if err == nil {
			return i, true
		}
		f, ferr := n.Float64()
		return int64(f), ferr == nil
	}
	return 0, false
}

func toString(v interface{}) string {
	switch s := v.(type) {
	case string:
		return s
	default:
		b, err := json.Marshal(v)
		if err != nil {
			return fmt.Sprintf("%v", v)
		}
		return string(b)
	}
}

// CheckHealth validates connectivity and auth by listing the configured organization's streams.
// This is what the datasource "Save & test" button and the /health endpoint call; returning OK here
// is what clears the previous "plugin unavailable" error.
func (d *Datasource) CheckHealth(ctx context.Context, _ *backend.CheckHealthRequest) (*backend.CheckHealthResult, error) {
	org := d.settings.resolveOrg(queryModel{})
	u := fmt.Sprintf("%s/api/%s/streams", d.baseURL, url.PathEscape(org))

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return unhealthy("failed to build health request: " + err.Error()), nil
	}

	httpResp, err := d.httpClient.Do(httpReq)
	if err != nil {
		log.DefaultLogger.Error("openobserve health check failed", "error", err)
		return unhealthy("cannot reach OpenObserve: " + err.Error()), nil
	}
	defer httpResp.Body.Close()
	_, _ = io.Copy(io.Discard, httpResp.Body)

	if httpResp.StatusCode == http.StatusUnauthorized || httpResp.StatusCode == http.StatusForbidden {
		return unhealthy(fmt.Sprintf("authentication failed (HTTP %d) — check credentials", httpResp.StatusCode)), nil
	}
	if httpResp.StatusCode < 200 || httpResp.StatusCode >= 300 {
		return unhealthy(fmt.Sprintf("OpenObserve returned HTTP %d", httpResp.StatusCode)), nil
	}

	return &backend.CheckHealthResult{
		Status:  backend.HealthStatusOk,
		Message: fmt.Sprintf("Connected to OpenObserve (org %q)", org),
	}, nil
}

func unhealthy(msg string) *backend.CheckHealthResult {
	return &backend.CheckHealthResult{Status: backend.HealthStatusError, Message: msg}
}
