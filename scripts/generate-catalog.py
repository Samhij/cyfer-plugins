#!/usr/bin/env python3
"""Generate catalog.json from plugins/*/manifest.json."""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PLUGINS_DIR = ROOT / "plugins"
CATALOG_PATH = ROOT / "catalog.json"
ID_RE = __import__("re").compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


def repo_slug() -> str:
    return os.environ.get("GITHUB_REPOSITORY", "Samhij/cyfer-plugins").strip() or "Samhij/cyfer-plugins"


def ref_name() -> str:
    # Store sourceUrl always targets the catalog base branch (main), not a PR head.
    # On pull_request, GITHUB_REF_NAME is the feature branch and would make --check fail.
    base = os.environ.get("GITHUB_BASE_REF", "").strip()
    if base:
        return base
    ref = os.environ.get("GITHUB_REF_NAME", "").strip()
    if ref:
        return ref
    return "main"


def source_url(plugin_id: str) -> str:
    return f"https://github.com/{repo_slug()}/tree/{ref_name()}/plugins/{plugin_id}"


def load_manifest(path: Path, expected_id: str) -> dict:
    with path.open(encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, dict):
        raise SystemExit(f"{path}: manifest must be a JSON object")

    plugin_id = str(data.get("id", "")).strip()
    if not ID_RE.match(plugin_id):
        raise SystemExit(f"{path}: id must be kebab-case, got {plugin_id!r}")
    if plugin_id != expected_id:
        raise SystemExit(f"{path}: id {plugin_id!r} must match directory {expected_id!r}")

    name = str(data.get("name", "")).strip()
    if not name:
        raise SystemExit(f"{path}: name is required")

    version = str(data.get("version", "1.0.0")).strip() or "1.0.0"
    description = str(data.get("description", "")).strip()
    author = str(data.get("author", "")).strip()

    kind = str(data.get("kind", "page")).strip().lower()
    if kind not in ("page", "widget"):
        raise SystemExit(f'{path}: kind must be "page" or "widget"')

    nav = data.get("nav")
    if not isinstance(nav, dict):
        raise SystemExit(f"{path}: nav is required")
    label = str(nav.get("label", name)).strip() or name
    icon = str(nav.get("icon", "Puzzle")).strip() or "Puzzle"
    try:
        order = int(nav.get("order", 100))
    except (TypeError, ValueError):
        order = 100

    permissions = data.get("permissions")
    if not isinstance(permissions, dict) or not isinstance(permissions.get("api"), list):
        raise SystemExit(f"{path}: permissions.api must be a list")
    api: list[str] = []
    for item in permissions["api"]:
        pattern = str(item).strip()
        if not pattern:
            continue
        if not pattern.startswith("/rest/") or ".." in pattern:
            raise SystemExit(f"{path}: invalid API path {pattern!r}")
        api.append(pattern)

    listed = data.get("listed", True)
    if not isinstance(listed, bool):
        raise SystemExit(f"{path}: listed must be a boolean if set")

    return {
        "id": plugin_id,
        "name": name,
        "version": version,
        "description": description,
        "author": author,
        "kind": kind,
        "nav": {"label": label, "icon": icon, "order": order},
        "permissions": {"api": api},
        "downloadUrl": "",
        "sourceUrl": source_url(plugin_id),
        "_listed": listed,
    }


def build_catalog() -> dict:
    plugins: list[dict] = []
    for directory in sorted(PLUGINS_DIR.iterdir()):
        if not directory.is_dir():
            continue
        manifest = directory / "manifest.json"
        if not manifest.is_file():
            raise SystemExit(f"Missing manifest.json in {directory.relative_to(ROOT)}")
        entry = load_manifest(manifest, directory.name)
        if not entry.pop("_listed"):
            continue
        plugins.append(entry)

    plugins.sort(key=lambda p: (p["nav"]["order"], p["nav"]["label"].lower(), p["id"]))
    return {
        "updatedAt": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "plugins": plugins,
    }


def dump_catalog(catalog: dict) -> str:
    return json.dumps(catalog, indent=2, ensure_ascii=False) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check",
        action="store_true",
        help="Exit 1 if catalog.json is missing or out of date (ignores updatedAt).",
    )
    args = parser.parse_args()

    catalog = build_catalog()
    rendered = dump_catalog(catalog)

    if args.check:
        if not CATALOG_PATH.is_file():
            print("catalog.json is missing; run scripts/generate-catalog.py", file=sys.stderr)
            return 1
        current = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
        current_plugins = current.get("plugins")
        if current_plugins != catalog["plugins"]:
            print("catalog.json is out of date; run scripts/generate-catalog.py", file=sys.stderr)
            return 1
        print(f"catalog.json is up to date ({len(catalog['plugins'])} plugins)")
        return 0

    if CATALOG_PATH.is_file():
        current = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
        if current.get("plugins") == catalog["plugins"]:
            print(f"catalog.json unchanged ({len(catalog['plugins'])} plugins)")
            return 0

    CATALOG_PATH.write_text(rendered, encoding="utf-8")
    print(f"Wrote {CATALOG_PATH.relative_to(ROOT)} with {len(catalog['plugins'])} plugins")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
