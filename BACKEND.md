# OpenObserve datasource — Go backend

The datasource shipped as a **frontend-only** plugin. Grafana Unified Alerting evaluates rules
**server-side**, which requires a datasource plugin with a backend, so alerting against OpenObserve
failed with `plugin unavailable`. This package adds a Go backend that implements `QueryData` and
`CheckHealth`, which is what makes the datasource usable for alerting (and any other server-side
query path).

## Layout

- `pkg/main.go` — plugin entrypoint (`datasource.Manage("openobserve", ...)`).
- `pkg/plugin/datasource.go` — `QueryData` + `CheckHealth`, the OpenObserve `_search` client, and the
  hit→data.Frame conversion.
- `pkg/plugin/models.go` — datasource settings (`jsonData`) and per-query model parsing + SQL build.
- `Magefile.go` — standard SDK build target.

The backend talks to the same HTTP API the frontend used:
`POST {url}/api/{org}/_search?type={streamType}` with body
`{"query":{"sql","start_time","end_time","from","size","sql_mode":"full"},"search_type":"ui","timeout":180}`.
Time range comes from the panel/alert window (microseconds). Auth (basic-auth / TLS / proxy) is taken
from the datasource config via `settings.HTTPClientOptions`, so no credentials live in this code.

A query in **SQL mode** (what alert rules use) is sent verbatim. The response `hits` are turned into a
single frame: the timestamp column becomes a time field, numeric columns become nullable `float64`
fields, everything else becomes strings — so an aggregate like `count(*) AS cnt` yields a numeric
single-value frame that alerting's reduce/threshold expressions consume directly.

## Build

```bash
# all platforms via mage (installs deps on first run)
go run github.com/magefile/mage -v        # or: mage -v

# or build a single target by hand
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath \
  -o dist/gpx_openobserve_linux_amd64 ./pkg
```

`plugin.json` now declares `"backend": true`, `"executable": "gpx_openobserve"`, `"alerting": true`.
Grafana launches `dist/gpx_openobserve_<os>_<arch>` matching its host.

## Test

```bash
go test ./pkg/...                          # unit

# live integration test (skipped unless creds are set)
OO_URL=https://obs.example.dev OO_AUTH='user:pass' \
  go test ./pkg/plugin -run TestQueryIntegration -v
```

## Deploy

The plugin is unsigned; the target Grafana already allows it
(`allow_loading_unsigned_plugins = openobserve` in `deployment/grafana.ini`). Backend binaries must
be present in the plugin directory alongside `module.js`/`plugin.json`.

1. Build the frontend (`pnpm build`) and the backend binaries (above) into `dist/`.
2. Package `dist/` as the plugin folder and deploy it to `/var/lib/grafana/plugins/openobserve`
   (e.g. rebuild the `zo_gp.tar.gz` artifact the StatefulSet init-container pulls).
3. Restart Grafana. Confirm via **Save & test** on the datasource (calls `CheckHealth`).
