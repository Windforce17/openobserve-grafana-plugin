package plugin

import (
	"encoding/json"
	"fmt"
	"strings"
)

// instanceSettings holds the per-datasource jsonData fields the backend cares about. These mirror
// MyDataSourceOptions in src/types.ts; only the fields used by the backend are declared here.
type instanceSettings struct {
	DefaultOrganization string `json:"default_organization"`
	DefaultLogStream    string `json:"default_log_stream"`
	DefaultTraceStream  string `json:"default_trace_stream"`
	TimestampColumn     string `json:"timestamp_column"`
}

// queryModel mirrors the subset of MyQuery (src/types.ts) that the backend needs to build an
// OpenObserve _search request. The frontend serialises these field names, and the alert-rule query
// model uses the same shape, so the same struct deserialises both.
type queryModel struct {
	QueryText        string `json:"query"`
	Stream           string `json:"stream"`
	StreamType       string `json:"streamType"`
	QueryType        string `json:"queryType"`
	SQLMode          bool   `json:"sqlMode"`
	Organization     string `json:"organization"`
	Size             int    `json:"size"`
	StartTimeInMicro int64  `json:"startTimeInMicro"`
	EndTimeInMicro   int64  `json:"endTimeInMicro"`
}

func newInstanceSettings(raw json.RawMessage) (instanceSettings, error) {
	var s instanceSettings
	if len(raw) == 0 {
		return s, nil
	}
	if err := json.Unmarshal(raw, &s); err != nil {
		return s, fmt.Errorf("parsing datasource jsonData: %w", err)
	}
	return s, nil
}

// resolveOrg picks the organization for an API call: the query's org, else the datasource default,
// else "default" — matching DataSource.resolveOrg in src/datasource.ts.
func (s instanceSettings) resolveOrg(q queryModel) string {
	if org := strings.TrimSpace(q.Organization); org != "" {
		return org
	}
	if org := strings.TrimSpace(s.DefaultOrganization); org != "" {
		return org
	}
	return "default"
}

// resolveStreamType defaults the OpenObserve page type to "logs" as the frontend does.
func (q queryModel) resolveStreamType() string {
	if st := strings.TrimSpace(q.StreamType); st != "" {
		return st
	}
	return "logs"
}

func (s instanceSettings) timestampColumn() string {
	if c := strings.TrimSpace(s.TimestampColumn); c != "" {
		return c
	}
	return "_timestamp"
}

// quoteIdent quotes a SQL identifier (stream name) the same way the frontend does.
func quoteIdent(v string) string {
	return `"` + strings.ReplaceAll(v, `"`, `""`) + `"`
}

// escapeString escapes a SQL string literal the same way the frontend does.
func escapeString(v string) string {
	return strings.ReplaceAll(v, `'`, `''`)
}

// buildSQL produces the SQL sent to OpenObserve. When the query is in SQL mode the user-authored
// SQL is used verbatim (this is the path Unified Alerting uses). Otherwise we fall back to a simple
// stream scan, optionally constrained by a full-text match, so basic non-SQL queries still resolve.
func (s instanceSettings) buildSQL(q queryModel) string {
	text := strings.TrimSpace(q.QueryText)
	if q.SQLMode && text != "" {
		return text
	}

	stream := strings.TrimSpace(q.Stream)
	if stream == "" {
		if q.resolveStreamType() == "traces" {
			stream = strings.TrimSpace(s.DefaultTraceStream)
		} else {
			stream = strings.TrimSpace(s.DefaultLogStream)
		}
	}
	if stream == "" {
		stream = "default"
	}

	sql := "SELECT * FROM " + quoteIdent(stream)
	if !q.SQLMode && text != "" {
		sql += fmt.Sprintf(" WHERE match_all('%s')", escapeString(text))
	}
	return sql
}
