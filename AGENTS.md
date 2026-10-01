# Cyfer plugins — agent guide

This repository is the **community plugin catalog** for **Cyfers**, a Somtoday desktop client.
Cyfers itself lives in the sibling repo `../somtoday-login` (GitHub: `Samhij/somtoday-login`).

Plugins are plain HTML/CSS/JS zip packages. They never receive Somtoday tokens. All REST
access goes through a host proxy and a per-plugin path allowlist.

## Sibling host app (read this when unsure)

| Path in `somtoday-login` | Why it matters |
| --- | --- |
| `docs/plugins.md` | Full Dutch author guide (source of truth for authors) |
| `lib/plugins/manifest.ts` | Manifest schema + validation |
| `lib/plugins/sdk.ts` | Injected `window.cyfers` bridge |
| `lib/plugins/match.ts` | `/rest/` glob allowlist matching (`*` = one path segment) |
| `lib/plugins/base-styles.ts` | Injected CSS tokens / helpers |
| `lib/plugins/store.ts` | How Cyfers loads `catalog.json` from this repo |
| `plugins/cyfers.d.ts` | Ambient TypeScript types for the SDK |
| `plugins/voorbeeld-info` | Local page sample (mirrors this repo) |
| `plugins/cyfers.d.ts` | Ambient TypeScript types for the SDK |

Prefer reading those files over inventing APIs.

## Repository layout

```text
plugins/<id>/
  manifest.json          # required
  ui/
    index.html           # usual entry
    *.css / *.js / …     # optional assets
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
3. Build UI under `ui/` (plain HTML/CSS/JS — no bundler required)
4. Add/update an entry in `catalog.json` so the in-app store can list it
5. Locally test: zip the plugin folder and upload under **Plugins** in Cyfers (`npm run dev` in `somtoday-login`)
6. Open a PR using `.github/PULL_REQUEST_TEMPLATE.md`

Zip layout Cyfers expects:

```text
mijn-plugin/
  manifest.json
  ui/
    index.html
```

## manifest.json

Required shape (see `somtoday-login/lib/plugins/manifest.ts`):

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
- `storage.*` — string key/value, isolated per plugin in the host

Allowlist globs: `*` matches one path segment (not `/`). Example:
`/rest/v1/geldendvoortgangsdossierresultaten/leerling/*`

## catalog.json

Cyfers reads this file (default URL:
`https://raw.githubusercontent.com/Samhij/cyfer-plugins/main/catalog.json`).
Each entry should mirror the plugin’s public metadata plus optional
`downloadUrl` / `sourceUrl` / `sha256`.

When adding a plugin for the store, update `catalog.json` in the same PR.

## Security & agent guardrails

- Do **not** request or log tokens, cookies, or passwords
- Do **not** widen `permissions.api` beyond what the UI actually calls
- Do **not** add files outside `manifest.json` + `ui/`
- Do **not** assume same-origin access to the Cyfers React shell
- Do **not** proxy arbitrary hosts — only Somtoday `/rest/` via `cyfers.fetch`
- Prefer copying `voorbeeld-info` over inventing a new layout
- Match existing Dutch UI tone when writing user-facing copy

## Validation

`.github/workflows/validate.yml` checks on PRs/pushes that touch `plugins/**` or
`catalog.json`:

- Directory name / `id` kebab-case and uniqueness
- Manifest fields and `permissions.api` shape
- Only `manifest.json` + `ui/**` files present
- Declared `entry` file exists

## Further reading

- [README.md](README.md) — quick start
- [CONTRIBUTING.md](CONTRIBUTING.md) — contribution rules
- `../somtoday-login/docs/plugins.md` — detailed author guide
- `../somtoday-login/AGENTS.md` — host app architecture for agents
