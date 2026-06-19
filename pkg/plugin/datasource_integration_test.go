package plugin

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"os"
	"testing"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
)

// basicAuthRT injects an Authorization: Basic header, mimicking what Grafana's managed HTTP client
// does from the datasource's configured credentials.
type basicAuthRT struct {
	auth string
	next http.RoundTripper
}

func (b basicAuthRT) RoundTrip(r *http.Request) (*http.Response, error) {
	r.Header.Set("Authorization", "Basic "+b.auth)
	return b.next.RoundTrip(r)
}

// TestQueryIntegration runs the real backend query path against a live OpenObserve instance.
// It is skipped unless OO_URL and OO_AUTH ("user:pass") are set, so it never runs in CI by default.
func TestQueryIntegration(t *testing.T) {
	base := os.Getenv("OO_URL")
	auth := os.Getenv("OO_AUTH")
	if base == "" || auth == "" {
		t.Skip("set OO_URL and OO_AUTH to run the integration test")
	}

	d := &Datasource{
		settings: instanceSettings{DefaultOrganization: "default", TimestampColumn: "_timestamp"},
		baseURL:  base,
		httpClient: &http.Client{
			Timeout:   60 * time.Second,
			Transport: basicAuthRT{auth: base64.StdEncoding.EncodeToString([]byte(auth)), next: http.DefaultTransport},
		},
	}

	model, _ := json.Marshal(queryModel{
		QueryText:    `SELECT count(*) AS cnt FROM "apisix" WHERE response_status = 200 AND path LIKE '%nternal%'`,
		Stream:       "apisix",
		StreamType:   "logs",
		SQLMode:      true,
		Organization: "default",
	})

	now := time.Now()
	resp := d.query(context.Background(), backend.DataQuery{
		RefID:     "A",
		JSON:      model,
		TimeRange: backend.TimeRange{From: now.Add(-30 * time.Minute), To: now},
	})

	if resp.Error != nil {
		t.Fatalf("query returned error: %v", resp.Error)
	}
	if len(resp.Frames) != 1 {
		t.Fatalf("expected 1 frame, got %d", len(resp.Frames))
	}
	frame := resp.Frames[0]
	t.Logf("frame %q: %d fields, %d rows", frame.Name, len(frame.Fields), frame.Rows())
	for _, f := range frame.Fields {
		if f.Len() > 0 {
			t.Logf("  field %q type=%s first=%v", f.Name, f.Type(), f.At(0))
		} else {
			t.Logf("  field %q type=%s (empty)", f.Name, f.Type())
		}
	}

	// CheckHealth too.
	hr, err := d.CheckHealth(context.Background(), &backend.CheckHealthRequest{})
	if err != nil {
		t.Fatalf("CheckHealth error: %v", err)
	}
	t.Logf("CheckHealth -> %s: %s", hr.Status, hr.Message)
	if hr.Status != backend.HealthStatusOk {
		t.Fatalf("expected healthy, got %s: %s", hr.Status, hr.Message)
	}
}
