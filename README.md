# Cyfer plugins

Community plugins for **[Cyfers](https://github.com/Samhij/somtoday-login)** — a Somtoday desktop client for Dutch secondary-school students.

Fork this repo, add your plugin under `plugins/`, and open a pull request. After merge, the plugin appears in the Cyfers in-app store (when enabled).

## Quick start

1. Fork and clone this repository
2. Copy `plugins/voorbeeld-info` to `plugins/jouw-plugin`
3. Edit `manifest.json` (`id` must be unique kebab-case)
4. Build your UI under `ui/` (plain HTML/CSS/JS)
5. Open a pull request

Open the repo in VS Code / Cursor for `cyfers.*` and `Somtoday*` autocomplete
(repo-root `jsconfig.json` + [`types/`](types/)). Type files stay outside plugin zips.

Zip layout Cyfers expects:

```text
mijn-plugin/
  manifest.json
  ui/
    index.html
```

Max **2 MB**. Only `manifest.json` and files under `ui/` are allowed.

## Catalog

`catalog.json` is generated from `plugins/*/manifest.json` by
`scripts/generate-catalog.py`. CI regenerates and commits it on every push to
`main`; pull requests must keep it up to date (`python3 scripts/generate-catalog.py`).

Do not hand-edit `catalog.json`.

## Somtoday API endpoints

Plugins call Somtoday only through `cyfers.fetch(path)`. Every path must match a
glob in `permissions.api` (paths start with `/rest/`; `*` matches one segment).
Keep that list minimal — reviewers will scrutinize it.

Student id comes from `cyfers.getContext().students[].id` or
`GET /rest/v1/leerlingen`. Useful starting points:

| Endpoint | What it returns |
| --- | --- |
| `/rest/v1/leerlingen` | Linked student(s) for the account |
| `/rest/v1/leerlingen/*` | Single student by id |
| `/rest/v1/schooljaren/huidig` | Current school year |
| `/rest/v1/geldendvoortgangsdossierresultaten/leerling/*` | Progress grades for a student |
| `/rest/v1/geldendexamendossierresultaten/leerling/*` | Exam grades for a student |
| `/rest/v1/afspraken` | Schedule / appointments (often with `begindatum` / `einddatum`) |
| `/rest/v1/absentiemeldingen` | Absence reports |
| `/rest/v1/studiewijzers` | Study guides |
| `/rest/v1/studiewijzeritemafspraaktoekenningen` | Homework linked to appointments |
| `/rest/v1/vakken` | Subjects |
| `/rest/v1/account` | Account info |
| `/rest/v1/boodschappen/conversaties` | Messages |

Example allowlist for a grades widget:

```json
"permissions": {
  "api": [
    "/rest/v1/geldendvoortgangsdossierresultaten/leerling/*",
    "/rest/v1/geldendexamendossierresultaten/leerling/*"
  ]
}
```

This is not a full Somtoday API reference. For more endpoints and query params,
see the community docs: [elisaado/somtoday-api-docs](https://github.com/elisaado/somtoday-api-docs).

## Security

Plugins never receive Somtoday tokens. They may only call REST paths listed in `permissions.api`, via the Cyfers host proxy. Keep that list as small as possible — reviewers will scrutinize it.

See [CONTRIBUTING.md](CONTRIBUTING.md) for rules and the PR checklist.
