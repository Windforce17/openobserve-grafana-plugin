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

## Installing the plugin in Grafana

This plugin is **unsigned**, so Grafana must be told to load it. The plugin id is `openobserve`.

### Option A — install from a release archive (recommended)

1. Download `openobserve-<version>.zip` from the [Releases](https://github.com/Windforce17/openobserve-grafana-plugin/releases) page.
2. Extract it into Grafana's plugin directory so the files live in a folder named after the plugin id:

   ```bash
   # default plugin dir is /var/lib/grafana/plugins
   unzip openobserve-<version>.zip -d /var/lib/grafana/plugins
   # result: /var/lib/grafana/plugins/openobserve/plugin.json
   ```

3. Allow the unsigned plugin, either via `grafana.ini`:

   ```ini
   [plugins]
   allow_loading_unsigned_plugins = openobserve
   ```

   or via environment variable:

   ```bash
   GF_PLUGINS_ALLOW_LOADING_UNSIGNED_PLUGINS=openobserve
   ```

4. Restart Grafana.
5. Go to **Connections → Data sources → Add new data source → OpenObserve**, set the OpenObserve
   **URL** and **authentication** (see the [Security notice](#️-security-notice) about scoping credentials), then **Save & test**.

### Option B — Docker

```yaml
services:
  grafana:
    image: grafana/grafana:latest
    ports:
      - "3000:3000"
    environment:
      GF_PLUGINS_ALLOW_LOADING_UNSIGNED_PLUGINS: openobserve
    volumes:
      # extracted plugin folder -> /var/lib/grafana/plugins/openobserve
      - ./openobserve:/var/lib/grafana/plugins/openobserve
```

### Option C — build from source

```bash
corepack enable          # if you don't have pnpm
pnpm install
pnpm build               # outputs to dist/
# copy dist/ to <grafana-plugins-dir>/openobserve, allow the unsigned plugin, restart Grafana
```

> Verify the plugin loaded under **Administration → Plugins** (search "OpenObserve"). If it doesn't
> appear, check the Grafana server logs for an unsigned-plugin warning and confirm the folder name
> is exactly `openobserve`.

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


# Distributing your plugin

When distributing a Grafana plugin either within the community or privately the plugin must be signed so the Grafana application can verify its authenticity. This can be done with the `@grafana/sign-plugin` package.

_Note: It's not necessary to sign a plugin during development. The docker development environment that is scaffolded with `@grafana/create-plugin` caters for running the plugin without a signature._

## Initial steps

Before signing a plugin please read the Grafana [plugin publishing and signing criteria](https://grafana.com/docs/grafana/latest/developers/plugins/publishing-and-signing-criteria/) documentation carefully.

`@grafana/create-plugin` has added the necessary commands and workflows to make signing and distributing a plugin via the grafana plugins catalog as straightforward as possible.

Before signing a plugin for the first time please consult the Grafana [plugin signature levels](https://grafana.com/docs/grafana/latest/developers/plugins/sign-a-plugin/#plugin-signature-levels) documentation to understand the differences between the types of signature level.

1. Create a [Grafana Cloud account](https://grafana.com/signup).
2. Make sure that the first part of the plugin ID matches the slug of your Grafana Cloud account.
   - _You can find the plugin ID in the plugin.json file inside your plugin directory. For example, if your account slug is `acmecorp`, you need to prefix the plugin ID with `acmecorp-`._
3. Create a Grafana Cloud API key with the `PluginPublisher` role.
4. Keep a record of this API key as it will be required for signing a plugin

## Signing a plugin

### Using Github actions release workflow

If the plugin is using the github actions supplied with `@grafana/create-plugin` signing a plugin is included out of the box. The [release workflow](./.github/workflows/release.yml) can prepare everything to make submitting your plugin to Grafana as easy as possible. Before being able to sign the plugin however a secret needs adding to the Github repository.

1. Please navigate to "settings > secrets > actions" within your repo to create secrets.
2. Click "New repository secret"
3. Name the secret "GRAFANA_API_KEY"
4. Paste your Grafana Cloud API key in the Secret field
5. Click "Add secret"

#### Push a version tag

To trigger the workflow we need to push a version tag to github. This can be achieved with the following steps:

1. Run `pnpm version <major|minor|patch>`
2. Run `git push origin main --follow-tags`


## Learn more

Below you can find source code for existing app plugins and other related documentation.

- [Upstream project: openobserve/openobserve-grafana-plugin](https://github.com/openobserve/openobserve-grafana-plugin/) — the original source this fork is based on
- [OpenObserve SQL functions reference](https://openobserve.ai/docs/reference/sql-functions/)
- [Basic data source plugin example](https://github.com/grafana/grafana-plugin-examples/tree/master/examples/datasource-basic#readme)
- [Plugin.json documentation](https://grafana.com/docs/grafana/latest/developers/plugins/metadata/)
- [How to sign a plugin?](https://grafana.com/docs/grafana/latest/developers/plugins/sign-a-plugin/)

## Acknowledgements

This plugin is a fork of [openobserve/openobserve-grafana-plugin](https://github.com/openobserve/openobserve-grafana-plugin/),
created and maintained by the OpenObserve team. Many thanks to the original authors. This fork is
not officially affiliated with or endorsed by OpenObserve.
