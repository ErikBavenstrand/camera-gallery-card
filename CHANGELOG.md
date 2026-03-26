# Changelog

## [1.9.2] - 2026-03-26

### Fixed
- Editor failed to load with "Failed to fetch dynamically imported module" error for HACS-installed users — editor path is now resolved relative to the card's own location

### Added
- README: step-by-step guide for setting up a Files sensor (sensor mode)

---

## [1.9.1] - 2026-03-26

### Added
- Lazy loading for thumbnails using Intersection Observer (`rootMargin: 200px` for pre-loading)
- Styling editor with 5 collapsible sections: Card, Preview bar, Thumbnails, Filter buttons, Today/Date/Live
- Color pickers and border radius sliders per section
- New CSS variables: `--cgc-tsbar-txt`, `--cgc-pill-bg`, `--cgc-tbar-txt`, `--cgc-thumb-radius`, `--cgc-obj-btn-radius`, `--cgc-ctrl-txt`, `--cgc-ctrl-chevron`, `--cgc-live-active-bg`, `--cgc-ctrl-radius`
- Card picker preview (`preview: true`, `getStubConfig` finds first camera)
- Auto-live mode: starts in live view when `live_camera_entity` is set but no media sources configured

### Fixed
- Filter button icon color was hardcoded, now uses `currentColor`
- Thumbnail bar appeared smaller than thumbnail due to border-radius on `.tbar`
- Active segment button border radius mismatch
- Live card host background was `#000`, now `transparent`
- Duplicate tab headers removed from all 5 editor tabs

---

## [1.9.0] - 2026-03-20

### Added
- Object filters with custom icons and per-filter color support
- Live view redesign with native Home Assistant WebRTC
- Redesigned editor UI with tabs

---

## [1.8.0]

### Added
- Native WebRTC live preview
- Media source improvements

---

## [1.7.0]

### Added
- Filtering, theming, and media loading improvements
