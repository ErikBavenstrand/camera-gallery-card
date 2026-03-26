Custom **Home Assistant Lovelace card** for browsing camera media in a clean **timeline-style gallery** with preview player, object filters, optional live view, and a built-in visual editor.

## Features

- Image & video preview with timeline thumbnails and lazy loading
- Day grouping & filename timestamp parsing
- Object filter buttons with custom icon and color support
- Object detection pill in timestamp bar
- Horizontal or vertical thumbnail layout
- Live camera view (native Home Assistant WebRTC)
- Delete, bulk delete & download actions
- Built-in visual editor with styling tab (colors, border radius)
- Auto-live mode

## Sources

- `sensor` entities with `fileList` attribute (via Files integration)
- Home Assistant `media_source` (including Frigate)
- Multiple sensors or media folders

See the [README](https://github.com/TheScubadiver/camera-gallery-card/blob/main/README.md) for full documentation and configuration options.
