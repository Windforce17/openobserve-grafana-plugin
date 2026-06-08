# OpenObserve data source plugin for Grafana

A Grafana data source plugin to query OpenObserve logs and traces (log search, trace search,
and service map).

> **Fork notice.** This is a fork of the original
> [openobserve/openobserve-grafana-plugin](https://github.com/openobserve/openobserve-grafana-plugin/).
> It builds on that project with a redesigned query editor (log/trace/service-map tabs), SQL
> autocomplete, field "top values", a single-request histogram, and other fixes. All credit for the
> original plugin goes to the OpenObserve team; see the upstream repository for the canonical source.

> **🤖 AI agent notice.** This fork was developed largely through AI-assisted "vibe coding" (an AI
> coding agent). While it is tested (typecheck, unit tests, and builds pass), please review the code
> yourself and validate behavior in your own environment before relying on it in production.

## ⚠️ Security notice

This plugin is a thin **proxy** to OpenObserve: it forwards search/values/streams API requests to
the OpenObserve instance you configure, authenticated with the credentials stored on the Grafana
data source. **OpenObserve performs the authorization** — the plugin does not add any access control
of its own.

As a result:

- **Anyone who can use this data source in Grafana can issue API requests to OpenObserve** with the
  configured credentials, across any organization/stream those credentials can reach.
- The query editor lets users run arbitrary SQL (and `_values` / `streams` lookups), so access is
  effectively "whatever the configured OpenObserve credentials are allowed to do" — which may be
  **broader than what an individual Grafana user should have**, and can exceed this plugin's intended
  read-only logs/traces use case.

**Recommendations:**

- Use this plugin in **trusted / internal environments only**, and restrict who can access the
  Grafana instance and this data source (Grafana data source permissions / RBAC).
- **Scope the credentials on the OpenObserve side**: configure a least-privilege user/service account
  or API key limited to the specific organization(s) and stream(s) that should be queryable, with
  read-only access. Do not use admin/root credentials.
- Avoid exposing a Grafana instance that uses this data source to untrusted users.

## 🚀 Quickstart

This plugin is **unsigned**, so installing it always means two things:

1. **Install** the plugin (id: `openobserve`).
2. **Allow** the unsigned plugin (`allow_loading_unsigned_plugins = openobserve`).

Then restart Grafana and add the data source. The fastest path is the recommended Docker Compose
snippet below — it does both in one step.

> Replace `v1.0.0` / `1.0.0` in the URLs below with the latest version from the
> [Releases](https://github.com/Windforce17/openobserve-grafana-plugin/releases) page.

### Step 1 — install the plugin (pick one)

**🟢 Docker Compose — recommended.** Grafana downloads, installs, and allows the plugin on boot:

```yaml
services:
  grafana:
    image: grafana/grafana:latest
    ports:
      - "3000:3000"
    environment:
      GF_INSTALL_PLUGINS: "https://github.com/Windforce17/openobserve-grafana-plugin/releases/download/v1.0.0/openobserve-1.0.0.zip;openobserve"
      GF_PLUGINS_ALLOW_LOADING_UNSIGNED_PLUGINS: "openobserve"
```

**Environment variables (existing Grafana).** Set these on the Grafana process, then restart:

```bash
GF_INSTALL_PLUGINS=https://github.com/Windforce17/openobserve-grafana-plugin/releases/download/v1.0.0/openobserve-1.0.0.zip;openobserve
GF_PLUGINS_ALLOW_LOADING_UNSIGNED_PLUGINS=openobserve
```

**`grafana.ini` preinstall (Grafana 11.5+).** Syntax is `id@version@url`:

```ini
[plugins]
preinstall = openobserve@1.0.0@https://github.com/Windforce17/openobserve-grafana-plugin/releases/download/v1.0.0/openobserve-1.0.0.zip
allow_loading_unsigned_plugins = openobserve
```

**Manual (air-gapped or locally built).** Download `openobserve-<version>.zip` from the
[Releases](https://github.com/Windforce17/openobserve-grafana-plugin/releases) page and extract it
into Grafana's plugin directory:

```bash
# default plugin dir is /var/lib/grafana/plugins
unzip openobserve-1.0.0.zip -d /var/lib/grafana/plugins
# result: /var/lib/grafana/plugins/openobserve/plugin.json
```

In Docker, mount the extracted folder instead:

```yaml
    volumes:
      - ./openobserve:/var/lib/grafana/plugins/openobserve
```

Either way you must also **allow the unsigned plugin** — via `grafana.ini`
(`allow_loading_unsigned_plugins = openobserve`) or env var
(`GF_PLUGINS_ALLOW_LOADING_UNSIGNED_PLUGINS=openobserve`).

**Build from source.** See [Getting started](#getting-started); copy `dist/` to
`<grafana-plugins-dir>/openobserve`, allow the unsigned plugin, and restart Grafana.

### Step 2 — add the data source

1. **Restart Grafana**, then confirm the plugin loaded under **Administration → Plugins** (search
   "OpenObserve").
2. Go to **Connections → Data sources → Add new data source → OpenObserve**.
3. Set the OpenObserve **URL** and **authentication** (see the [Security notice](#️-security-notice)
   about scoping credentials).
4. Click **Save & test**.

> **Plugin not showing up?** Check the Grafana server logs for an unsigned-plugin warning, and make
> sure the plugin folder is named exactly `openobserve`.

## What are Grafana data source plugins?

Grafana supports a wide range of data sources, including Prometheus, MySQL, and even Datadog. There’s a good chance you can already visualize metrics from the systems you have set up. In some cases, though, you already have an in-house metrics solution that you’d like to add to your Grafana dashboards. Grafana Data Source Plugins enables integrating such solutions with Grafana.

## Getting started

This project uses [pnpm](https://pnpm.io/) (see the `packageManager` field in `package.json`).
Enable it with `corepack enable` if you don't have it installed.

### Frontend

1. Install dependencies

   ```bash
   pnpm install
   ```

2. Build plugin in development mode and run in watch mode

   ```bash
   pnpm dev
   ```

3. Build plugin in production mode

   ```bash
   pnpm build
   ```

4. Run the tests (using Jest)

   ```bash
   # Runs the tests and watches for changes, requires git init first
   pnpm test

   # Exits after running all the tests
   pnpm test:ci
   ```

5. Spin up a Grafana instance and run the plugin inside it (using Docker)

   ```bash
   pnpm server

   # or use the helper script (builds the plugin, then starts Grafana on http://localhost:3000)
   pnpm dev:grafana
   ```

6. Run the E2E tests (using Cypress)

   ```bash
   # Spins up a Grafana instance first that we tests against
   pnpm server

   # Starts the tests
   pnpm e2e
   ```

7. Run the linter

   ```bash
   pnpm lint

   # or

   pnpm lint:fix
   ```

8. Type-check the project

   ```bash
   pnpm typecheck
   ```


## Learn more

Below you can find source code for existing app plugins and other related documentation.

- [Upstream project: openobserve/openobserve-grafana-plugin](https://github.com/openobserve/openobserve-grafana-plugin/) — the original source this fork is based on
- [OpenObserve SQL functions reference](https://openobserve.ai/docs/reference/sql-functions/)
- [Basic data source plugin example](https://github.com/grafana/grafana-plugin-examples/tree/master/examples/datasource-basic#readme)
- [Plugin.json documentation](https://grafana.com/docs/grafana/latest/developers/plugins/metadata/)

## Acknowledgements

This plugin is a fork of [openobserve/openobserve-grafana-plugin](https://github.com/openobserve/openobserve-grafana-plugin/),
created and maintained by the OpenObserve team. Many thanks to the original authors. This fork is
not officially affiliated with or endorsed by OpenObserve.
