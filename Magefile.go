//go:build mage

package main

// Standard Grafana backend plugin build entrypoint. Run `mage -v` (or `mage build:linux`) to compile
// the backend into dist/gpx_openobserve_<os>_<arch> for every supported target.
import (
	// mage:import
	build "github.com/grafana/grafana-plugin-sdk-go/build"
)

// Default target compiles backend binaries for all supported platforms.
var Default = build.BuildAll
