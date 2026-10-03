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

## Local test in Cyfers

Zip the plugin folder and upload it under **Plugins** in the Cyfers app.

## Pull requests

Use the PR template. Maintainers review API permissions carefully before merge.

After changing plugins, refresh the store listing:

```bash
python3 scripts/generate-catalog.py
```

CI also regenerates `catalog.json` on `main`; PRs fail if it is out of date.
