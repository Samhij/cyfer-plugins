# Cyfer plugins — agent guide

This repository is the **community plugin catalog** for **Cyfers**, a Somtoday desktop client.
Cyfers itself lives in the sibling repo `../somtoday-login` (GitHub: `Samhij/somtoday-login`).

Plugins are plain HTML/CSS/JS zip packages. They never receive Somtoday tokens. All REST
access goes through a host proxy and a per-plugin path allowlist.

## Sibling host app (read this when unsure)

| Path in `somtoday-login` | Why it matters |
| --- | --- |
| `docs/plugins.md` | Full Dutch author guide (source of truth for authors) |
| `lib/plugins/manifest.ts` | Manifest validation (types imported from vendored copy of `types/`) |
| `lib/plugins/sdk.ts` | Injected `window.cyfers` bridge |
| `lib/plugins/match.ts` | `/rest/` glob allowlist matching (`*` = one path segment) |
| `lib/plugins/base-styles.ts` | Runtime injection of vendored `styles/plugin-base.css` + font links |
| `lib/plugins/store.ts` | How Cyfers loads `catalog.json` from this repo |
| `vendor/cyfer-plugin-types/` | Vendored copy of this repo’s `types/` (keep in sync) |
| `vendor/cyfer-plugin-styles/` | Vendored copy of this repo’s `styles/plugin-base.css` |
| `plugins/voorbeeld-info` | Local page sample (mirrors this repo) |

Prefer reading those files over inventing APIs.

## Repository layout

```text
types/
  api.ts                 # exported plugin-facing types (source of truth)
  globals.d.ts           # ambient `cyfers` + Somtoday* for IDE / JSDoc
styles/
  plugin-base.css        # host-injected CSS (authoring SoT; not in plugin zips)
  css-custom-data.json   # VS Code/Cursor CSS variable autocomplete
  html-custom-data.json  # VS Code/Cursor class-name hints
plugins/<id>/
  manifest.json          # required
  ui/
    index.html           # usual entry
    *.css / *.js / …     # optional assets
.vscode/settings.json    # css.customData / html.customData → styles/
jsconfig.json            # includes plugins/** + types/** for autocomplete
package.json             # `@cyfers/plugin-types` (types-only, private)
catalog.json             # store listing consumed by Cyfers
.github/workflows/validate.yml
```

Constraints enforced by CI and by Cyfers install:

- One plugin per directory; directory name **must** equal `manifest.id`
- `id`: kebab-case `^[a-z0-9]+(-[a-z0-9]+)*$`
- Only `manifest.json` and files under `ui/` (no other top-level paths)
- Zipped package max **2 MB**
- No secrets, obfuscation, or remote code loaders

## Creating a plugin

1. Copy `plugins/voorbeeld-info` → `plugins/<your-id>`
2. Edit `manifest.json` (unique `id`, `name`, `kind`, `nav`, minimal `permissions.api`)
3. Build UI under `ui/` (plain HTML/CSS/JS — no bundler required; use JSDoc + `types/`)
4. Preview in Cyfers without zip: keep this repo as a sibling of `somtoday-login`,
   run host `npm run dev`, then **Plugins → Ontwikkeling → Laden** (see CONTRIBUTING).
   Or set `CYFERS_PLUGIN_DEV_DIR` to this `plugins/` directory.
5. Run `python3 scripts/generate-catalog.py`, then open a pull request

When changing SDK / Somtoday shapes, edit `types/api.ts` (and keep `globals.d.ts`
in sync if you add exports). Ask the host repo to re-run `npm run sync:plugin-types`.

When changing injected CSS tokens/helpers, edit `styles/plugin-base.css` (and keep
the custom-data JSON files in sync). Ask the host to re-run `npm run sync:plugin-styles`.

Zip layout Cyfers expects:

```text
mijn-plugin/
  manifest.json
  ui/
    index.html
```

## manifest.json

Required shape (see `types/api.ts` → `PluginManifest`; host validates in
`somtoday-login/lib/plugins/manifest.ts`):

| Field | Notes |
| --- | --- |
| `id` | kebab-case; must match folder name |
| `name` | Display name |
| `version` | e.g. `1.0.0` |
| `description` | Short Dutch or English blurb |
| `author` | Name or handle |
| `kind` | `"page"` (sidebar) or `"widget"` (Overview only) |
| `entry` | Under `ui/`, usually `ui/index.html` |
| `nav.label` | Sidebar / Overview title |
| `nav.icon` | Lucide icon name, PascalCase (invalid → `Puzzle`) |
| `nav.order` | Sort key (lower first) |
| `permissions.api` | List of `/rest/...` globs; keep minimal |

### Page vs widget

| | `page` | `widget` |
| --- | --- | --- |
| Placement | Sidebar tab | Overview block only |
| Space | Full content column | Compact (`body.cyfers-widget`) |
| Chrome | Title + content OK | Prefer little chrome; host shows `nav.label` |

## UI runtime

Cyfers loads the entry HTML in a sandboxed iframe (`sandbox="allow-scripts"`, no
`allow-same-origin`) and injects:

1. Base CSS + fonts (IBM Plex Sans, Syne)
2. `window.cyfers` SDK (do **not** ship your own SDK script)

Relative `src` / `href` are rewritten to the plugin asset API. Leave
`https:`, `data:`, `blob:`, and `#` URLs alone.

### CSS tokens / helpers (injected)

Authoring source: [`styles/plugin-base.css`](styles/plugin-base.css). Open the
repo root so `.vscode/settings.json` loads custom data for `var(--…)` and class
hints. Do not ship this file inside plugin zips.

`--ink`, `--muted`, `--line`, `--accent`, `--accent-soft`, `--bg-elevated`,
`--danger`, `--danger-bg`, `--font-body`, `--font-display`

Classes: `.lede`, `.muted`, `.empty`, `.error`

Theme follows the host via `data-theme` on `<html>` (`light` / `dark`).

## SDK (`window.cyfers`)

```js
const ctx = await cyfers.getContext();
// { schoolName, tenant, schoolYear, students }

const data = await cyfers.fetch("/rest/v1/leerlingen");
await cyfers.storage.set("key", "value");
const value = await cyfers.storage.get("key");
await cyfers.storage.remove("key");
```

- `getContext()` — school / student info; **never** tokens
- `fetch(path, init?)` — only paths matching `permissions.api`; returns JSON or throws
- `storage.*` — string key/value, isolated per plugin; Cyfers persists each plugin’s
  bag as a JSON file under `userData/data/plugin-storage/<plugin-id>.json` (survives
  restarts; not browser `localStorage`)

Allowlist globs: `*` matches one path segment (not `/`). Example:
`/rest/v1/geldendvoortgangsdossierresultaten/leerling/*`

## catalog.json

Cyfers reads this file (default URL:
`https://raw.githubusercontent.com/Samhij/cyfer-plugins/main/catalog.json`).

Generated from every `plugins/*/manifest.json` with `"listed": false` skipped
(by `scripts/generate-catalog.py`; sort: `nav.order`, then label). Includes
`sourceUrl` pointing at the plugin tree.

```bash
python3 scripts/generate-catalog.py          # write
python3 scripts/generate-catalog.py --check  # CI / PR gate
```

Do not hand-edit. CI regenerates and commits on push to `main`.

## Security & agent guardrails

- Do **not** request or log tokens, cookies, or passwords
- Do **not** widen `permissions.api` beyond what the UI actually calls
- Do **not** add files outside `manifest.json` + `ui/`
- Do **not** assume same-origin access to the Cyfers React shell
- Do **not** proxy arbitrary hosts — only Somtoday `/rest/` via `cyfers.fetch`
- Prefer copying `voorbeeld-info` over inventing a new layout
- Match existing Dutch UI tone when writing user-facing copy

## Validation

`.github/workflows/validate.yml` on PRs/pushes that touch `plugins/**` or catalog tooling:

- Directory name / `id` kebab-case and uniqueness
- Manifest fields and `permissions.api` shape
- Only `manifest.json` + `ui/**` files present
- Declared `entry` file exists
- `catalog.json` matches generated output (`--check` on PRs; regenerate+commit on `main`)

## Further reading

- [README.md](README.md) — quick start
- [CONTRIBUTING.md](CONTRIBUTING.md) — contribution rules
- `../somtoday-login/docs/plugins.md` — detailed author guide
- `../somtoday-login/AGENTS.md` — host app architecture for agents
