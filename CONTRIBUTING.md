# Contributing a Cyfers plugin

## Rules

- One plugin per directory: `plugins/<id>/`
- `id` in `manifest.json` must match the directory name (kebab-case)
- Only `manifest.json` and files under `ui/`
- Package size when zipped must stay under 2 MB
- `permissions.api` entries must start with `/rest/` and use only what you need
- No secrets, no obfuscated code, no remote code loaders

## manifest.json

Required fields:

| Field | Notes |
| --- | --- |
| `id` | kebab-case, unique across this repo |
| `name` | Display name |
| `version` | Semver-ish string, e.g. `1.0.0` |
| `description` | Short Dutch or English blurb |
| `author` | Your name or handle |
| `kind` | `page` (sidebar) or `widget` (Overview only) |
| `entry` | Usually `ui/index.html` |
| `nav.label` / `nav.icon` / `nav.order` | Lucide icon name in PascalCase |
| `permissions.api` | Glob paths under `/rest/` |
| `listed` | Optional; set `false` to keep a template plugin out of the store |

## TypeScript / JSDoc types

Shared plugin types live in [`types/`](types/) (`api.ts` + ambient `globals.d.ts`).
The root `jsconfig.json` wires them into every `plugins/*/ui/*.js` file for IDE
autocomplete. Prefer JSDoc annotations (see `plugins/widget-cijfers`) over shipping
a bundler. Do not copy type files into your plugin directory — CI rejects anything
outside `manifest.json` + `ui/`.

## CSS tokens / autocomplete

The host injects [`styles/plugin-base.css`](styles/plugin-base.css) into every
plugin iframe (CSS variables like `--ink` / `--accent`, helpers like `.lede` /
`.error`). Do **not** copy or `@import` that file into your plugin zip.

For IDE autocomplete when editing `ui/*.css` / HTML classes:

1. Open this repository’s **root** in VS Code or Cursor (so `.vscode/settings.json` loads).
2. That settings file points `css.customData` / `html.customData` at
   [`styles/css-custom-data.json`](styles/css-custom-data.json) and
   [`styles/html-custom-data.json`](styles/html-custom-data.json).
3. Use `var(--…)` and the helper classes in your own stylesheets — see
   [`styles/README.md`](styles/README.md).

## Local preview in Cyfers (recommended)

Clone this repo **next to** [`somtoday-login`](https://github.com/Samhij/somtoday-login)
so the layout is:

```text
parent/
  somtoday-login/
  cyfer-plugins/plugins/<your-id>/
```

1. In `somtoday-login`, run `npm run dev` and sign in.
2. Open **Plugins** → section **Ontwikkeling**.
3. Click **Laden** on your plugin (no zip).
4. Edit files under `plugins/<id>/ui/` (and `manifest.json`); the host reloads the
   preview automatically, or click **Herladen**.

Override the scan root with `CYFERS_PLUGIN_DEV_DIR=/absolute/path/to/plugins` if the
repos are not siblings. Packaged Cyfers builds only honor that env var (they do not
auto-load a sibling checkout).

Example page plugin with week navigation: `plugins/rooster` (schedule via
`/rest/v1/afspraakitems/{studentId}/jaar/{year}/week/{week}`).

### Zip upload (still supported)

Zip the plugin folder and upload it under **Plugins** in the Cyfers app.

## Pull requests

Use the PR template. Maintainers review API permissions carefully before merge.

After changing plugins, refresh the store listing:

```bash
python3 scripts/generate-catalog.py
```

CI also regenerates `catalog.json` on `main`; PRs fail if it is out of date.
