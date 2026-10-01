# Cyfer plugins

Community plugins for **[Cyfers](https://github.com/Samhij/somtoday-login)** — a Somtoday desktop client for Dutch secondary-school students.

Fork this repo, add your plugin under `plugins/`, and open a pull request. After merge, the plugin appears in the Cyfers in-app store (when enabled).

## Quick start

1. Fork and clone this repository
2. Copy `plugins/voorbeeld-info` to `plugins/jouw-plugin`
3. Edit `manifest.json` (`id` must be unique kebab-case)
4. Build your UI under `ui/` (plain HTML/CSS/JS)
5. Open a pull request

Zip layout Cyfers expects:

```text
mijn-plugin/
  manifest.json
  ui/
    index.html
```

Max **2 MB**. Only `manifest.json` and files under `ui/` are allowed.

## Catalog

`catalog.json` lists published plugins for the Cyfers app. CI regenerates it on `main`.

## Security

Plugins never receive Somtoday tokens. They may only call REST paths listed in `permissions.api`, via the Cyfers host proxy. Keep that list as small as possible — reviewers will scrutinize it.

See [CONTRIBUTING.md](CONTRIBUTING.md) for rules and the PR checklist.
