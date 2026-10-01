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

## Local test in Cyfers

Zip the plugin folder and upload it under **Plugins** in the Cyfers app.

## Pull requests

Use the PR template. Maintainers review API permissions carefully before merge.
