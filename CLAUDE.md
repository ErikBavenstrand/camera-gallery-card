# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A **Home Assistant Lovelace custom card** distributed via HACS. The entire runtime ships as a single hand-edited file: `camera-gallery-card.js` (~12k lines). There is **no build step, no bundler, no test suite, no linter, and no `node_modules`** — `package.json` is metadata only. Edits to the JS file are the deployable artifact.

## Commonly used commands

There are no project scripts. The relevant operations are:

- **Local install for testing**: copy `camera-gallery-card.js` to a Home Assistant `config/www/` path and register it as a Lovelace resource (`/local/...`). HA caches aggressively — bump the `?v=` query string or hard-reload the dashboard.
- **HACS validation** (mirrors CI): `docker run --rm -v "$PWD":/github/workspace ghcr.io/hacs/action:main` (or push a tag / open a PR — `.github/workflows/hacs.yml` runs `hacs/action@main` with `category: plugin`).
- **Release**: tagging a version triggers the HACS workflow. The HACS-served filename is fixed by `hacs.json` (`filename: camera-gallery-card.js`, `content_in_root: false`).

## Version sources (keep in sync on release)

Three places encode the version, and they drift:

- `CARD_VERSION` constant at the top of `camera-gallery-card.js` (the source of truth at runtime — printed to console and used in stub configs).
- `version` in `package.json` (currently lags behind — historical artifact, not used at runtime).
- `README.md` "Current version" line and `CHANGELOG.md`.

When bumping, update `CARD_VERSION` and the README/CHANGELOG. The git tag drives HACS distribution.

## Architecture

Two custom elements are defined in the single file:

1. **`camera-gallery-card`** — `class CameraGalleryCard extends LitElement` (starts ~line 106, ends ~line 7153). The card itself.
2. **`camera-gallery-card-editor`** — `class CameraGalleryCardEditor extends HTMLElement` (starts ~line 7224). The Lovelace visual editor, wired up via `static getConfigElement()`. **Not** a LitElement — it manually manages a shadow DOM and re-renders via `_scheduleRender()`. Editor state lives in `_config`, `_activeTab`, `_suggestState`, `_mediaBrowser*`, etc.

### Lit is borrowed at runtime, not imported

There is no `import` for Lit. The IIFE near the top walks `customElements.get("hui-masonry-view")` (and a few fallbacks) up the prototype chain to find an HA element that already extends `LitElement`, then captures `LitElement`, `html`, and `css` from it. This is why the card has no dependencies and no build step — but it also means **Lit APIs are constrained to whatever version HA ships**. Do not assume modern Lit features are available; mirror patterns already used in the file.

### Home Assistant integration surface

The card talks to HA exclusively through the `hass` object (set via the `set hass(hass)` setter, ~line 385):

- `hass.callWS({ type: "media_source/browse_media", ... })` — media-source mode browsing.
- `hass.callWS({ type: "auth/sign_path", path: "/api/webrtc/ws" })` — signed URL for WebRTC live preview.
- `hass.callService(domain, service, { path })` — delete via user-configured `delete_service` shell command (and `filetrack.add_sensor` from the editor wizard).
- `hass.states[entity_id].attributes.fileList` — sensor mode source (constant `ATTR_NAME = "fileList"`).

Live view reuses HA's own `picture-glance`/WebRTC card by creating a child Lovelace card element and injecting CSS into nested shadow roots (see `_injectLiveFillStyle`, ~line 1957). When touching live view, expect to deal with shadow DOM piercing and HA's internal element tags.

### Two source modes (`source_mode`)

The entire data layer branches on this:

- `"sensor"` — read `fileList` attribute from one or more sensors (typically created by the **FileTrack** custom integration, a fork of TarheelGrad1998's `files`). Posters are generated client-side via first-frame video capture, throttled by `SENSOR_POSTER_CONCURRENCY` and `SENSOR_POSTER_QUEUE_LIMIT`.
- `"media"` — recursive `media_source/browse_media` walks (depth capped by `DEFAULT_WALK_DEPTH = 6`, results capped per root). Frigate snapshots are detected and used as posters; other sources fall back to first-frame capture.

Many config keys are mode-specific (`entity`/`entities` vs `media_source`/`media_sources`). `setConfig` (~line 4377) normalizes both shapes — the singular and plural forms coexist for backwards compatibility, and the editor cleans up legacy keys.

### Filename / path datetime parsing

A non-trivial chunk of code (`_parseFolderFileDatetime`, `_autoDetectFolderDate`, `_autoDetectFileTime`, `_parseDateFromFilename`, `_buildFilenameDateRegex`, ~lines 766–1100) auto-detects timestamps from common NVR layouts (Frigate, Reolink, Blue Iris, raw `YYYYMMDD_HHMMSS`, Unix epochs). Users can override with `folder_datetime_format` / `filename_datetime_format` config keys using a `{YYYY}{MM}{DD}` token mini-language. **Auto-detection rules are documented in the README** — keep the README table and the parser in sync when changing recognized formats.

### Styling system

CSS variables prefixed `--cgc-*` are the public styling API (documented in README). The editor's **Styling** tab is generated from the `STYLE_SECTIONS` array (~line 7168) — adding a new themable element means adding a CSS variable in the card's `static get styles()`, then adding a control entry to `STYLE_SECTIONS`.

### State machine quirks worth knowing

- The card has two top-level view modes: `_viewMode` is `"media"` or `"live"`. `start_mode` config controls the initial value, and there is an "auto-live" path when only `live_camera_entity` is configured (no media sources).
- Pinch-to-zoom, fullscreen handling, and aspect-ratio toggling for live view all use direct DOM event listeners on the host element, not Lit-managed listeners — see the bound handler properties assigned in the constructor (`_onZoomTouchStart`, etc.).
- `_posterCache`, `_msBrowseTtlCache`, `_objectCache`, `_snapshotCache` are per-instance Maps; they are cleared on source-config changes (see `_isSourceConfigChange` vs `_isUiOnlyConfigChange` at ~line 1299–1338, which decides whether a `setConfig` invalidates caches).

## Conventions

- **Single-file edits only.** Do not split the file or introduce ES modules — HACS serves it as one resource and there is no build step to combine modules.
- **No external dependencies.** Anything not already in the file (Lit excepted, borrowed at runtime) cannot be added without a build pipeline.
- **Comments in the file are mixed English/Dutch** (the original author writes in Dutch). Match the surrounding style; don't translate unrelated comments while making other changes.
- **Defaults are exposed as `DEFAULT_*` constants** at the top of the file. New config keys should follow that pattern and be normalized in `setConfig`.
- **Do not log to console** outside the existing `console.info(\`Camera Gallery Card v${CARD_VERSION}\`)` banner and explicit error overlays — HA dashboards are noisy and users notice.
