# Plugin base styles

Authoring source of truth for the CSS Cyfers injects into every plugin iframe.

| File | Role |
| --- | --- |
| [`plugin-base.css`](plugin-base.css) | Tokens, reset, buttons, tables, helper classes |
| [`css-custom-data.json`](css-custom-data.json) | VS Code / Cursor CSS variable descriptions |
| [`html-custom-data.json`](html-custom-data.json) | VS Code / Cursor HTML `class` value hints |

## Autocomplete (VS Code / Cursor)

1. Open the **cyfer-plugins repository root** as your workspace folder (not only a single plugin subfolder).
2. Repo [`.vscode/settings.json`](../.vscode/settings.json) already points `css.customData` and `html.customData` at the JSON files above.
3. In `plugins/*/ui/*.css`, type `var(--` to see host tokens (`--ink`, `--accent`, …). In HTML, class completion suggests `.lede`, `.error`, etc.

Do **not** `@import` or copy this stylesheet into a plugin zip — the host injects it at runtime. Plugin CSS should only add layout/component rules on top of these tokens.

## Host sync

[somtoday-login](https://github.com/Samhij/somtoday-login) vendors a copy and embeds it into `lib/plugins/base-styles.ts` for iframe injection. After editing `plugin-base.css` here:

```bash
# from somtoday-login, with this repo as a sibling checkout
npm run sync:plugin-styles
```

Font `<link>` tags stay in the host (`CYFERS_PLUGIN_FONT_LINKS`); only the CSS body is synced from this file.
