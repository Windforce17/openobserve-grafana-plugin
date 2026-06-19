package main

import (
	"os"

	"github.com/grafana/grafana-plugin-sdk-go/backend/datasource"
	"github.com/grafana/grafana-plugin-sdk-go/backend/log"

	"github.com/openobserve/openobserve-grafana-plugin/pkg/plugin"
)

// main is the entrypoint for the OpenObserve datasource backend plugin. Grafana launches this
// binary and communicates with it over the plugin SDK's gRPC protocol. Adding this backend is what
// makes the datasource usable from server-side contexts that cannot run the frontend datasource,
// most importantly Grafana Unified Alerting (rules are evaluated in the backend, not the browser).
func main() {
	if err := datasource.Manage("openobserve", plugin.NewDatasource, datasource.ManageOpts{}); err != nil {
		log.DefaultLogger.Error("failed to start openobserve datasource backend", "error", err.Error())
		os.Exit(1)
	}
}
