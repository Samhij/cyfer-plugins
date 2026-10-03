# Plugin types

Source of truth for Cyfers plugin TypeScript / JSDoc types:

| File | Role |
| --- | --- |
| `api.ts` | Exported module types (`CyfersSdk`, `PluginManifest`, Somtoday REST shapes) |
| `globals.d.ts` | Ambient globals so plain `ui/*.js` plugins get IDE autocomplete |

The repo-root [`jsconfig.json`](../jsconfig.json) includes `plugins/**` and `types/**`, so opening this repository in VS Code / Cursor enables `cyfers.*` and `Somtoday*` autocomplete without copying types into each plugin zip.

## Host app

[somtoday-login](https://github.com/Samhij/somtoday-login) vendors these files under `vendor/cyfer-plugin-types/` and re-exports them from `lib/types.ts` / `lib/plugins/manifest.ts`. After editing types here, sync the host copy:

```bash
# from somtoday-login, with this repo as a sibling checkout
npm run sync:plugin-types
```

Do **not** put type files inside `plugins/<id>/` — CI only allows `manifest.json` + `ui/`.

For CSS token / class autocomplete, see [`styles/README.md`](../styles/README.md).
