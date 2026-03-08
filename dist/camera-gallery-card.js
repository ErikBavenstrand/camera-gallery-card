/**
 * Camera Gallery Card
 */

const CARD_VERSION = "1.3.0";

// -------- HARD CODED SETTINGS --------
const ATTR_NAME = "fileList";
const PREVIEW_WIDTH = "100%";

const THUMBS_ENABLED = true;

const THUMB_SIZE = 86;
const THUMB_RADIUS = 14;
const THUMB_GAP = 12;

const DEFAULT_THUMB_BAR_POSITION = "bottom"; // "bottom" | "top" | "hidden"

// defaults (can be overridden via config)
const DEFAULT_ALLOW_DELETE = true;
const DEFAULT_ALLOW_BULK_DELETE = true;
const DEFAULT_DELETE_CONFIRM = true;

// delete_service required (for entity mode delete)
const DEFAULT_DELETE_SERVICE = "";

// hard safety prefix (NOT configurable)
const DEFAULT_DELETE_PREFIX = "/config/www/";

// bar opacity default (0-100)
const DEFAULT_BAR_OPACITY = 45;

// media-source safety limits
const DEFAULT_MAX_MEDIA = 20; // visible cap
const DEFAULT_RESOLVE_BATCH = 10;
const DEFAULT_WALK_DEPTH = 8; // max folder depth
const DEFAULT_BROWSE_TIMEOUT_MS = 8000; // prevent infinite loading
const DEFAULT_PER_ROOT_MIN_LIMIT = 40; // sane minimum

const DEFAULT_PREVIEW_CLICK_TO_OPEN = false;
const DEFAULT_PREVIEW_CLOSE_ON_TAP_WHEN_GATED = true;

const DEFAULT_SOURCE_MODE = "sensor"; // "sensor" | "media"
const DEFAULT_PREVIEW_POSITION = "top"; // "top" | "bottom"

const DEFAULT_VISIBLE_OBJECT_FILTERS = [];
const MAX_VISIBLE_OBJECT_FILTERS = 4;

// LIVE
const DEFAULT_LIVE_ENABLED = false;
const DEFAULT_LIVE_DEFAULT = false;
const DEFAULT_SHOW_LIVE_TOGGLE = true;
const DEFAULT_LIVE_LABEL = "Live Camera";

const AVAILABLE_OBJECT_FILTERS = [
  "person",
  "car",
  "dog",
  "cat",
  "truck",
  "bus",
  "bicycle",
  "motorcycle",
  "bird",
];

const STYLE = {
  card_background:
    "rgba(var(--rgb-card-background-color, 255,255,255), 0.50)",
  card_padding: "10px 12px",
  topbar_padding: "0px",
  topbar_margin: "0px",
  preview_background:
    "rgba(var(--rgb-card-background-color, 255,255,255), 0.50)",
};
// ------------------------------------

// ─── Resolve Lit from HA ─────────────────────────────────────────────
let LitElement, html, css;

(() => {
  const candidates = [
    "hui-masonry-view",
    "hui-view",
    "ha-panel-lovelace",
    "hc-lovelace",
    "hui-entities-card",
    "ha-card",
  ];
  for (const tag of candidates) {
    const klass = customElements.get(tag);
    if (!klass) continue;
    let proto = klass;
    while (proto && proto !== HTMLElement && proto !== Object) {
      if (proto.prototype?.html && proto.prototype?.css) {
        LitElement = proto;
        html = proto.prototype.html;
        css = proto.prototype.css;
        return;
      }
      proto = Object.getPrototypeOf(proto);
    }
  }
})();

if (!LitElement) {
  console.error("CAMERA-GALLERY-CARD: Could not resolve LitElement from HA");
}

class CameraGalleryCard extends LitElement {
  static get properties() {
    return {
      _hass: {},
      config: {},

      _selectedIndex: { type: Number },
      _selectedDay: { type: String },

      _swipeStartX: { type: Number },
      _swipeStartY: { type: Number },
      _swiping: { type: Boolean },

      _selectMode: { type: Boolean },
      _selectedSet: { type: Object },
      _pendingScrollToI: { type: Number },

      _showNav: { type: Boolean },
      _navHideT: { type: Number },

      _previewOpen: { type: Boolean },
      _objectFilters: { type: Array },

      _viewMode: { type: String }, // "media" | "live"
      _liveTick: { type: Number },
    };
  }

  static async getConfigElement() {
    await import("./camera-gallery-card-editor.js");
    return document.createElement("camera-gallery-card-editor");
  }

  static getStubConfig() {
    return {
      source_mode: DEFAULT_SOURCE_MODE,
      preview_position: DEFAULT_PREVIEW_POSITION,

      entity: "",
      entities: [],

      media_source: "",
      media_sources: [],

      delete_service: "",

      preview_height: 320,
      bar_position: "top",
      thumb_size: 140,
      thumb_bar_position: DEFAULT_THUMB_BAR_POSITION,
      bar_opacity: DEFAULT_BAR_OPACITY,

      max_media: DEFAULT_MAX_MEDIA,

      preview_click_to_open: DEFAULT_PREVIEW_CLICK_TO_OPEN,
      preview_close_on_tap: DEFAULT_PREVIEW_CLOSE_ON_TAP_WHEN_GATED,

      object_filters: DEFAULT_VISIBLE_OBJECT_FILTERS,

      live_enabled: DEFAULT_LIVE_ENABLED,
      live_camera_entity: "",
      live_default: DEFAULT_LIVE_DEFAULT,
      show_live_toggle: DEFAULT_SHOW_LIVE_TOGGLE,
      live_label: DEFAULT_LIVE_LABEL,
    };
  }

  constructor() {
    super();

    this._liveCard = null;
    this._liveCardConfigKey = "";

    this._posterCache = new Map();
    this._posterPending = new Set();
    this._deleted = new Set();

    this._selectMode = false;
    this._selectedSet = new Set();
    this._pendingScrollToI = null;
    this._forceThumbReset = false;

    this._showNav = false;
    this._navHideT = null;

    this._previewOpen = false;
    this._objectFilters = [];

    this._viewMode = "media";
    this._liveTick = Date.now();

    this._ms = {
      key: "",
      loading: false,
      loadedAt: 0,
      roots: [],
      list: [],
      urlCache: new Map(),
    };

    this._msResolveInFlight = false;
    this._msResolveQueued = new Set();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._navHideT) clearTimeout(this._navHideT);
    this._navHideT = null;
  }

  set hass(hass) {
    this._hass = hass;
    this.requestUpdate();
  }

  get hass() {
    return this._hass;
  }

  _isDarkMode() {
    const dm = this._hass?.themes?.darkMode;
    if (typeof dm === "boolean") return dm;
    try {
      return (
        window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ?? false
      );
    } catch (_) {
      return false;
    }
  }

  _isGraphiteTheme() {
    const name =
      this._hass?.themes?.theme ||
      this._hass?.selectedTheme ||
      this._hass?.themes?.selectedTheme ||
      "";
    return String(name).toLowerCase().includes("graphite");
  }

  _resetThumbScrollToStart() {
    requestAnimationFrame(() => {
      const wrap = this.renderRoot?.querySelector(".tthumbs");
      if (!wrap) return;
      wrap.scrollLeft = 0;
      try {
        wrap.scrollTo({ left: 0, behavior: "auto" });
      } catch (_) {}
    });
  }

  _showNavChevrons() {
    this._showNav = true;
    this.requestUpdate();

    if (this._navHideT) clearTimeout(this._navHideT);
    this._navHideT = setTimeout(() => {
      this._showNav = false;
      this.requestUpdate();
    }, 2500);
  }

  _navPrev() {
    if (this._selectMode || this._isLiveActive()) return;
    const i = this._selectedIndex ?? 0;
    if (i <= 0) return;
    this._selectedIndex = i - 1;
    this._pendingScrollToI = this._selectedIndex;
    this.requestUpdate();
    this._showNavChevrons();
  }

  _navNext(listLen) {
    if (this._selectMode || this._isLiveActive()) return;
    const i = this._selectedIndex ?? 0;
    if (i >= listLen - 1) return;
    this._selectedIndex = i + 1;
    this._pendingScrollToI = this._selectedIndex;
    this.requestUpdate();
    this._showNavChevrons();
  }

  _normThumbBarPosition(v) {
    const s = String(v || "").toLowerCase().trim();
    if (s === "top") return "top";
    if (s === "hidden") return "hidden";
    return "bottom";
  }

  _normPrefixHardcoded() {
    const lead = DEFAULT_DELETE_PREFIX.startsWith("/")
      ? DEFAULT_DELETE_PREFIX
      : "/" + DEFAULT_DELETE_PREFIX;
    const noMulti = lead.replace(/\/{2,}/g, "/");
    return noMulti.endsWith("/") ? noMulti : noMulti + "/";
  }

  _normSourceMode(v) {
    const s = String(v || "").toLowerCase().trim();
    return s === "media" ? "media" : "sensor";
  }

  _normPreviewPosition(v) {
    const s = String(v || "").toLowerCase().trim();
    return s === "bottom" ? "bottom" : "top";
  }

  _normMaxMedia(v) {
    const n = Number(String(v ?? "").trim());
    if (!Number.isFinite(n)) return DEFAULT_MAX_MEDIA;
    return Math.max(1, Math.min(100, Math.round(n)));
  }

  _normalizeVisibleObjectFilters(listOrSingle) {
    const arr = Array.isArray(listOrSingle)
      ? listOrSingle
      : listOrSingle
        ? [listOrSingle]
        : [];

    const out = [];
    const seen = new Set();
    const allowed = new Set(
      AVAILABLE_OBJECT_FILTERS.map((x) => String(x).toLowerCase())
    );

    for (const raw of arr) {
      const v = String(raw || "").toLowerCase().trim();
      if (!v || !allowed.has(v) || seen.has(v)) continue;
      seen.add(v);
      out.push(v);
      if (out.length >= MAX_VISIBLE_OBJECT_FILTERS) break;
    }

    return out;
  }

  _getVisibleObjectFilters() {
    return Array.isArray(this.config?.object_filters)
      ? this.config.object_filters
      : [];
  }

  _sensorNormalizeEntities(listOrSingle, fallbackSingle = "") {
    const arr = Array.isArray(listOrSingle)
      ? listOrSingle
      : listOrSingle
        ? [listOrSingle]
        : fallbackSingle
          ? [fallbackSingle]
          : [];

    const out = [];
    const seen = new Set();

    for (const raw of arr) {
      const v = String(raw ?? "").trim();
      if (!v) continue;
      const k = v.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(v);
    }

    return out;
  }

  _sensorEntityList() {
    const arr = Array.isArray(this.config?.entities) ? this.config.entities : [];
    const clean = arr.map((x) => String(x || "").trim()).filter(Boolean);
    if (clean.length) return clean;

    const single = String(this.config?.entity || "").trim();
    return single ? [single] : [];
  }

  async _ensureLiveCard() {
    const entity = String(this.config?.live_camera_entity || "").trim();
    if (!entity) {
      this._liveCard = null;
      this._liveCardConfigKey = "";
      return null;
    }

    const cfg = {
      type: "custom:webrtc-camera",
      entity,
      mode: "webrtc",
      muted: true,
      ui: false,
      background: false,
    };

    const key = JSON.stringify(cfg);

    if (this._liveCard && this._liveCardConfigKey === key) {
      this._liveCard.hass = this._hass;
      return this._liveCard;
    }

    const helpers = await window.loadCardHelpers?.();
    if (!helpers) {
      console.warn("[camera-gallery-card] loadCardHelpers unavailable");
      return null;
    }

    const card = await helpers.createCardElement(cfg);
    card.hass = this._hass;

    try {
      card.style.setProperty("width", "100%");
      card.style.setProperty("height", "100%");
      card.style.setProperty("display", "block");
    } catch (_) {}

    this._liveCard = card;
    this._liveCardConfigKey = key;
    return card;
  }

  async _mountLiveCard() {
    if (!this._isLiveActive()) return;

    const host = this.renderRoot?.querySelector("#live-card-host");
    if (!host) return;

    const card = await this._ensureLiveCard();
    if (!card) return;

    if (card.parentElement !== host) {
      host.innerHTML = "";
      host.appendChild(card);
    }

    card.hass = this._hass;

    // 🔧 remove RTC label from webrtc-camera
    const removeRTC = () => {
      const rtc = card.querySelector?.(".mode, .webrtc-mode");
      if (rtc) rtc.remove();
    };

    removeRTC();

    const obs = new MutationObserver(removeRTC);
    obs.observe(card, { childList: true, subtree: true });
  }

  _renderLiveCardHost() {
    return html`<div id="live-card-host" class="live-card-host"></div>`;
  }

  _jsonEq(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  _configChangedKeys(prev = {}, next = {}) {
    const keys = new Set([
      ...Object.keys(prev || {}),
      ...Object.keys(next || {}),
    ]);
    return Array.from(keys).filter((k) => !this._jsonEq(prev?.[k], next?.[k]));
  }

  _isUiOnlyConfigChange(keys = []) {
    if (!keys.length) return false;

    const uiOnlyKeys = new Set([
      "preview_height",
      "bar_position",
      "thumb_size",
      "bar_opacity",
      "thumb_bar_position",
      "preview_click_to_open",
      "preview_close_on_tap",
      "preview_position",
      "object_filters",
      "live_enabled",
      "live_camera_entity",
      "live_default",
      "show_live_toggle",
      "live_label",
    ]);

    return keys.every((k) => uiOnlyKeys.has(k));
  }

  _isSourceConfigChange(keys = []) {
    const sourceKeys = new Set([
      "source_mode",
      "entity",
      "entities",
      "media_source",
      "media_sources",
      "max_media",
      "delete_service",
      "allow_delete",
      "allow_bulk_delete",
      "delete_confirm",
    ]);

    return keys.some((k) => sourceKeys.has(k));
  }

  _hasLiveConfig() {
    return (
      !!this.config?.live_enabled &&
      !!String(this.config?.live_camera_entity || "").trim()
    );
  }

  _isLiveActive() {
    return this._hasLiveConfig() && this._viewMode === "live";
  }

  _setViewMode(nextMode) {
    const mode = nextMode === "live" ? "live" : "media";
    if (mode === "live" && !this._hasLiveConfig()) return;

    this._viewMode = mode;
    this._showNav = false;

    if (this.config?.preview_click_to_open) {
      this._previewOpen = mode === "live" ? true : !!this._previewOpen;
    }

    this.requestUpdate();
  }

  setConfig(config) {
    const prevConfig = this.config ? { ...this.config } : null;

    const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
    const num = (v, d) => {
      if (v === null || v === undefined) return d;
      const n = Number(String(v).trim().replace("px", "").replace("%", ""));
      return Number.isFinite(n) ? n : d;
    };

    const posRaw = String(config.bar_position ?? "top").toLowerCase().trim();
    const bar_position =
      posRaw === "bottom" ? "bottom" : posRaw === "hidden" ? "hidden" : "top";

    const thumb_size = Math.max(
      40,
      Math.min(220, num(config.thumb_size, THUMB_SIZE))
    );

    const thumb_bar_position = this._normThumbBarPosition(
      config.thumb_bar_position ?? DEFAULT_THUMB_BAR_POSITION
    );

    const bar_opacity = clamp(
      num(config.bar_opacity, DEFAULT_BAR_OPACITY),
      0,
      100
    );

    const max_media = this._normMaxMedia(config.max_media ?? DEFAULT_MAX_MEDIA);

    let source_mode = this._normSourceMode(
      config.source_mode ?? DEFAULT_SOURCE_MODE
    );

    const preview_position = this._normPreviewPosition(
      config.preview_position ?? DEFAULT_PREVIEW_POSITION
    );

    const entityRaw = String(config?.entity || "").trim();
    const sensorEntitiesClean = this._sensorNormalizeEntities(
      config?.entities,
      entityRaw
    );

    const mediaRaw = String(config?.media_source || "").trim();
    const mediaArrRaw = Array.isArray(config?.media_sources)
      ? config.media_sources
      : Array.isArray(config?.media_folders_fav)
        ? config.media_folders_fav
        : null;

    const mediaSourcesClean = Array.isArray(mediaArrRaw)
      ? mediaArrRaw.map((x) => String(x ?? "").trim()).filter(Boolean)
      : [];

    const visibleObjectFilters = this._normalizeVisibleObjectFilters(
      config.object_filters ?? DEFAULT_VISIBLE_OBJECT_FILTERS
    );

    if (
      config.source_mode === undefined ||
      config.source_mode === null ||
      String(config.source_mode).trim() === ""
    ) {
      if ((mediaSourcesClean.length || mediaRaw) && !sensorEntitiesClean.length) {
        source_mode = "media";
      } else {
        source_mode = "sensor";
      }
    }

    if (source_mode === "sensor") {
      if (!sensorEntitiesClean.length) {
        throw new Error(
          "camera-gallery-card: 'entity' or 'entities' is required in source_mode: sensor"
        );
      }
    } else if (!mediaRaw && !mediaSourcesClean.length) {
      throw new Error(
        "camera-gallery-card: 'media_source' OR 'media_sources' is required in source_mode: media"
      );
    }

    const allow_delete =
      config.allow_delete !== undefined
        ? !!config.allow_delete
        : DEFAULT_ALLOW_DELETE;

    const allow_bulk_delete =
      config.allow_bulk_delete !== undefined
        ? !!config.allow_bulk_delete
        : DEFAULT_ALLOW_BULK_DELETE;

    const delete_service =
      (config.delete_service && String(config.delete_service).trim()) ||
      (config.shell_command && String(config.shell_command).trim()) ||
      DEFAULT_DELETE_SERVICE;

    const delete_confirm =
      config.delete_confirm !== undefined
        ? !!config.delete_confirm
        : DEFAULT_DELETE_CONFIRM;

    const wantsDelete = source_mode === "sensor" && allow_delete;

    let effectiveAllowDelete = allow_delete;
    let effectiveAllowBulkDelete = allow_bulk_delete;

    if (wantsDelete && !delete_service) {
      effectiveAllowDelete = false;
      effectiveAllowBulkDelete = false;
    }

    if (delete_service && !/^[a-z0-9_]+\.[a-z0-9_]+$/i.test(delete_service)) {
      throw new Error(
        "camera-gallery-card: 'delete_service' must be 'domain.service'"
      );
    }

    const preview_click_to_open =
      config.preview_click_to_open !== undefined
        ? !!config.preview_click_to_open
        : DEFAULT_PREVIEW_CLICK_TO_OPEN;

    const preview_close_on_tap =
      config.preview_close_on_tap !== undefined
        ? !!config.preview_close_on_tap
        : preview_click_to_open
          ? DEFAULT_PREVIEW_CLOSE_ON_TAP_WHEN_GATED
          : false;

    const normalizedMediaRoots =
      source_mode === "media"
        ? this._msNormalizeRoots(
            mediaSourcesClean.length ? mediaSourcesClean : mediaRaw
          )
        : [];

    const live_enabled =
      config.live_enabled !== undefined
        ? !!config.live_enabled
        : DEFAULT_LIVE_ENABLED;

    const live_camera_entity = String(config.live_camera_entity || "").trim();
    const live_default =
      config.live_default !== undefined
        ? !!config.live_default
        : DEFAULT_LIVE_DEFAULT;
    const show_live_toggle =
      config.show_live_toggle !== undefined
        ? !!config.show_live_toggle
        : DEFAULT_SHOW_LIVE_TOGGLE;
    const live_label =
      String(config.live_label || "").trim() || DEFAULT_LIVE_LABEL;

    const nextConfig = {
      source_mode,
      preview_position,

      entity: source_mode === "sensor" ? sensorEntitiesClean[0] || "" : "",
      entities: source_mode === "sensor" ? sensorEntitiesClean : [],

      media_source: source_mode === "media" ? mediaRaw : "",
      media_sources: source_mode === "media" ? normalizedMediaRoots : [],

      preview_height: Number(config.preview_height) || 320,
      bar_position,
      thumb_size,
      bar_opacity,
      thumb_bar_position,

      max_media,

      allow_delete: effectiveAllowDelete,
      allow_bulk_delete: effectiveAllowBulkDelete,

      delete_service: delete_service || "",
      delete_confirm,

      preview_click_to_open,
      preview_close_on_tap,

      object_filters: visibleObjectFilters,

      live_enabled,
      live_camera_entity,
      live_default,
      show_live_toggle,
      live_label,
    };

    this.config = nextConfig;

    const changedKeys = prevConfig
      ? this._configChangedKeys(prevConfig, nextConfig)
      : [];
    const uiOnlyChange = prevConfig
      ? this._isUiOnlyConfigChange(changedKeys)
      : false;
    const sourceChange = prevConfig
      ? this._isSourceConfigChange(changedKeys)
      : true;

    if (this._selectedIndex === undefined) this._selectedIndex = 0;
    if (this._swipeStartX === undefined) this._swipeStartX = 0;
    if (this._swipeStartY === undefined) this._swipeStartY = 0;
    if (this._swiping === undefined) this._swiping = false;

    if (!this._selectedSet) this._selectedSet = new Set();
    if (this._selectMode === undefined) this._selectMode = false;
    if (!Array.isArray(this._objectFilters)) this._objectFilters = [];

    const visibleSet = new Set(this._getVisibleObjectFilters());
    this._objectFilters = this._objectFilters.filter((x) => visibleSet.has(x));

    if (!prevConfig) {
      this._previewOpen = this.config.preview_click_to_open ? false : true;
      this._viewMode =
        this._hasLiveConfig() && this.config.live_default ? "live" : "media";
    } else if (
      prevConfig.preview_click_to_open !== this.config.preview_click_to_open
    ) {
      this._previewOpen = !this.config.preview_click_to_open;
    }

    if (sourceChange) {
      this._selectedIndex = 0;
      this._pendingScrollToI = 0;
      this._selectedSet.clear();
      this._selectMode = false;
      this._forceThumbReset = false;
      this._previewOpen = !this.config.preview_click_to_open;
    }

    if (!this._hasLiveConfig()) {
      this._viewMode = "media";
    }

    if (this.config.source_mode === "media") {
      const prevKey = prevConfig
        ? this._msKeyFromRoots(
            prevConfig?.media_sources,
            prevConfig?.media_source
          )
        : "";
      const nextKey = this._msKeyFromRoots(
        this.config?.media_sources,
        this.config?.media_source
      );

      if (!prevConfig || (sourceChange && prevKey !== nextKey)) {
        this._ms.key = "";
        this._ms.roots = [];
        this._ms.list = [];
        this._ms.urlCache = new Map();
        this._ms.loadedAt = 0;
        this._ms.loading = false;
      }
    }

    if (prevConfig && uiOnlyChange) {
      this.requestUpdate();
    }
  }

  updated(changedProps) {
    const dayChanged = changedProps.has("_selectedDay");
    const filterChanged = changedProps.has("_objectFilters");

    if (this._forceThumbReset || dayChanged || filterChanged) {
      this._forceThumbReset = false;
      this._pendingScrollToI = null;
      this._resetThumbScrollToStart();
      return;
    }

    if (this._pendingScrollToI != null) {
      const i = this._pendingScrollToI;
      this._pendingScrollToI = null;
      this._scrollThumbIntoView(i);
    }

    if (this._isLiveActive()) {
      this._mountLiveCard();
    }
  }

  async _scrollThumbIntoView(filteredIndexI) {
    try {
      await this.updateComplete;
    } catch (_) {}

    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    );

    const wrap = this.renderRoot?.querySelector(".tthumbs");
    if (!wrap) return;

    const btn = wrap.querySelector(`button.tthumb[data-i="${filteredIndexI}"]`);
    if (!btn) return;

    const wrapRect = wrap.getBoundingClientRect();
    const btnRect = btn.getBoundingClientRect();

    const currentScroll = wrap.scrollLeft;
    const btnCenterInScrollSpace =
      currentScroll + (btnRect.left - wrapRect.left) + btnRect.width / 2;

    const target = btnCenterInScrollSpace - wrap.clientWidth / 2;
    const max = Math.max(0, wrap.scrollWidth - wrap.clientWidth);
    const clamped = Math.max(0, Math.min(max, target));

    try {
      wrap.scrollTo({
        left: clamped,
        behavior: "smooth",
      });
    } catch (_) {
      wrap.scrollLeft = clamped;
    }
  }

  _toWebPath(p) {
    if (!p) return "";
    const v = String(p).trim();
    if (v.startsWith("/config/www/")) {
      return "/local/" + v.slice("/config/www/".length);
    }
    if (v === "/config/www") return "/local";
    return v;
  }

  _toFsPath(src) {
    if (!src) return "";
    let clean = String(src).trim();
    clean = clean.split("?")[0].split("#")[0];
    try {
      if (clean.startsWith("http://") || clean.startsWith("https://")) {
        clean = new URL(clean).pathname;
      }
    } catch (_) {}
    try {
      clean = decodeURIComponent(clean);
    } catch (_) {}
    if (clean.startsWith("/local/")) {
      return "/config/www/" + clean.slice("/local/".length);
    }
    if (clean.startsWith("/config/www/")) return clean;
    return "";
  }

  _isVideo(src) {
    return /\.(mp4|webm|mov|m4v)$/i.test(String(src || ""));
  }

  _isMediaSourceId(v) {
    return String(v || "").startsWith("media-source://");
  }

  _activeObjectFilters() {
    return Array.isArray(this._objectFilters)
      ? this._objectFilters
          .map((x) => String(x || "").toLowerCase().trim())
          .filter(Boolean)
      : [];
  }

  _isObjectFilterActive(value) {
    const v = String(value || "").toLowerCase().trim();
    return this._activeObjectFilters().includes(v);
  }

  _matchesObjectFilterValue(src, filterValues) {
    const active = Array.isArray(filterValues)
      ? filterValues
          .map((x) => String(x || "").toLowerCase().trim())
          .filter(Boolean)
      : [];

    if (!active.length) return true;

    const obj = this._objectForSrc(src);
    return !!obj && active.includes(obj);
  }

  _serviceParts() {
    const full = String(this.config?.delete_service || "");
    const [domain, service] = full.split(".");
    if (!domain || !service) return null;
    return { domain, service };
  }

  async _downloadSrc(urlOrPath) {
    if (!urlOrPath) return;

    const url = String(urlOrPath);
    const base = url.split("?")[0].split("#")[0];
    const name = (() => {
      try {
        return decodeURIComponent(base.split("/").pop() || "download");
      } catch (_) {
        return base.split("/").pop() || "download";
      }
    })();

    try {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const blob = await resp.blob();
      const blobUrl = URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();

      setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
    } catch (_) {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  }

  async _ensurePoster(src) {
    if (!src || this._posterCache.has(src) || this._posterPending.has(src)) {
      return;
    }
    this._posterPending.add(src);
    try {
      const dataUrl = await this._captureFirstFrame(src);
      if (dataUrl) this._posterCache.set(src, dataUrl);
    } catch (_) {
    } finally {
      this._posterPending.delete(src);
      this.requestUpdate();
    }
  }

  _captureFirstFrame(src) {
    return new Promise((resolve, reject) => {
      const v = document.createElement("video");
      v.muted = true;
      v.playsInline = true;
      v.preload = "metadata";
      v.controls = false;

      const cleanup = () => {
        try {
          v.pause();
        } catch (_) {}
        v.removeAttribute("src");
        try {
          v.load();
        } catch (_) {}
      };

      const fail = (err) => {
        cleanup();
        reject(err ?? new Error("poster fail"));
      };

      const draw = () => {
        try {
          const w = v.videoWidth || 0;
          const h = v.videoHeight || 0;
          if (!w || !h) return fail(new Error("no video dimensions"));
          const c = document.createElement("canvas");
          c.width = w;
          c.height = h;
          c.getContext("2d").drawImage(v, 0, 0, w, h);
          cleanup();
          resolve(c.toDataURL("image/jpeg", 0.72));
        } catch (e) {
          fail(e);
        }
      };

      v.addEventListener(
        "error",
        () => fail(new Error("video load error")),
        { once: true }
      );
      v.addEventListener(
        "loadedmetadata",
        () => {
          try {
            v.currentTime = 0.01;
          } catch (_) {
            draw();
          }
        },
        { once: true }
      );
      v.addEventListener("seeked", () => draw(), { once: true });

      v.src = src;
      try {
        v.load();
      } catch (_) {}
    });
  }

  // ─── LIVE ──────────────────────────────────────────────────────────

  _renderLiveInner() {
    const entity = String(this.config?.live_camera_entity || "").trim();
    if (!entity) {
      return html`<div class="preview-empty">No live camera configured.</div>`;
    }

    const st = this._hass?.states?.[entity];
    if (!st) {
      return html`<div class="preview-empty">Camera entity not found: ${entity}</div>`;
    }

    return html`
      <div class="live-stage">
        ${this._renderLiveCardHost()}
      </div>
    `;
  }

  // ─── Media Source ────────────────────────────────────────────────

  _msMetaById(id) {
    const it = (this._ms?.list || []).find((x) => x.id === id);
    if (!it) return { mime: "", cls: "", title: "" };
    return { mime: it.mime || "", cls: it.cls || "", title: it.title || "" };
  }

  _detectObjectFromText(text) {
    const s = String(text || "").toLowerCase();
    if (/\bperson\b/.test(s)) return "person";
    if (/\bcat\b/.test(s)) return "cat";
    if (/\bdog\b/.test(s)) return "dog";
    if (/\bcar\b/.test(s)) return "car";
    if (/\btruck\b/.test(s)) return "truck";
    if (/\bbus\b/.test(s)) return "bus";
    if (/\bbicycle\b/.test(s)) return "bicycle";
    if (/\bmotorcycle\b/.test(s)) return "motorcycle";
    if (/\bbird\b/.test(s)) return "bird";
    return null;
  }

  _objectIcon(obj) {
    if (!obj) return "";
    if (obj === "person") return "mdi:account";
    if (obj === "cat") return "mdi:cat";
    if (obj === "dog") return "mdi:dog";
    if (obj === "car") return "mdi:car";
    if (obj === "truck") return "mdi:truck";
    if (obj === "bus") return "mdi:bus";
    if (obj === "bicycle") return "mdi:bicycle";
    if (obj === "motorcycle") return "mdi:motorbike";
    if (obj === "bird") return "mdi:bird";
    return "";
  }

  _objectColor() {
    return "rgba(255,255,255,0.92)";
  }

  _objectForSrc(src) {
    if (this.config?.source_mode === "media" && this._isMediaSourceId(src)) {
      const meta = this._msMetaById(src);
      const hit = this._detectObjectFromText(meta?.title || "");
      if (hit) return hit;
      return this._detectObjectFromText(src);
    }
    return this._detectObjectFromText(src);
  }

  _matchesObjectFilter(src) {
    return this._matchesObjectFilterValue(src, this._objectFilters);
  }

  _filterLabel(v) {
    const s = String(v || "").toLowerCase();
    if (s === "person") return "person";
    if (s === "car") return "car";
    if (s === "dog") return "dog";
    if (s === "cat") return "cat";
    if (s === "truck") return "truck";
    if (s === "bus") return "bus";
    if (s === "bicycle") return "bicycle";
    if (s === "motorcycle") return "motorcycle";
    if (s === "bird") return "bird";
    return "selected";
  }

  _filterLabelList(values) {
    const arr = Array.isArray(values)
      ? values
          .map((x) => String(x || "").toLowerCase().trim())
          .filter(Boolean)
      : [];

    if (!arr.length) return "selected";
    return arr.map((v) => this._filterLabel(v)).join(", ");
  }

  _setObjectFilter(next) {
    const clicked = String(next || "").toLowerCase().trim();
    if (!clicked) return;

    const visible = new Set(this._getVisibleObjectFilters());
    if (!visible.has(clicked)) return;

    const currentFilters = this._activeObjectFilters().filter((x) =>
      visible.has(x)
    );
    const set = new Set(currentFilters);

    if (set.has(clicked)) set.delete(clicked);
    else set.add(clicked);

    const nextFilters = Array.from(set);

    const rawItems = this._items();

    const withDt = rawItems.map((src, idx) => {
      const dtMs = this._dtMsFromSrc(src);
      const dayKey = this._extractDayKey(src);
      return { src, idx, dtMs, dayKey };
    });

    withDt.sort((a, b) => {
      const aOk = Number.isFinite(a.dtMs);
      const bOk = Number.isFinite(b.dtMs);
      if (aOk && bOk && b.dtMs !== a.dtMs) return b.dtMs - a.dtMs;
      if (aOk && !bOk) return -1;
      if (!aOk && bOk) return 1;
      return b.idx - a.idx;
    });

    const allWithDay = withDt.map((x) => ({ src: x.src, dayKey: x.dayKey }));
    const days = this._uniqueDays(allWithDay);
    const newestDay = days[0] ?? null;
    const activeDay = this._selectedDay ?? newestDay;

    const dayFiltered = !activeDay
      ? allWithDay
      : allWithDay.filter((x) => x.dayKey === activeDay);

    const currentFiltered = dayFiltered.filter((x) =>
      this._matchesObjectFilterValue(x.src, currentFilters)
    );

    const currentIdx = Math.min(
      Math.max(this._selectedIndex ?? 0, 0),
      Math.max(0, currentFiltered.length - 1)
    );

    const currentSelectedSrc =
      currentFiltered.length > 0 ? currentFiltered[currentIdx]?.src : "";

    const nextFiltered = dayFiltered.filter((x) =>
      this._matchesObjectFilterValue(x.src, nextFilters)
    );

    let nextIndex = 0;

    if (currentSelectedSrc) {
      const keepIdx = nextFiltered.findIndex(
        (x) => x.src === currentSelectedSrc
      );
      if (keepIdx >= 0) nextIndex = keepIdx;
    }

    this._objectFilters = nextFilters;
    this._selectedIndex = nextIndex;
    this._pendingScrollToI = null;
    this._forceThumbReset = true;

    if (this.config?.preview_click_to_open) {
      this._previewOpen = false;
    }

    if (this._isLiveActive()) {
      this._setViewMode("media");
    }

    this.requestUpdate();
  }

  _formatTimeFromMs(ms) {
    if (!Number.isFinite(ms)) return "";
    try {
      return new Intl.DateTimeFormat("en", {
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(ms));
    } catch (_) {
      return "";
    }
  }

  _isVideoSmart(urlOrTitle, mime, cls) {
    const m = String(mime || "").toLowerCase();
    const c = String(cls || "").toLowerCase();
    if (m.startsWith("video/")) return true;
    if (c === "video") return true;
    return this._isVideo(urlOrTitle);
  }

  _msNormalizeRoot(raw) {
    let v = String(raw || "").trim();
    if (!v) return "";

    const strip = (s) =>
      String(s || "").replace(/^\/+/, "").replace(/\/+$/, "");

    if (v.startsWith("media-source://")) {
      let rest = v
        .slice("media-source://".length)
        .replace(/\/{2,}/g, "/")
        .replace(/\/+$/g, "");
      if (rest.startsWith("local/")) rest = `media_source/${rest}`;
      return `media-source://${rest}`;
    }

    v = strip(v);

    if (/^frigate(\/|$)/i.test(v)) {
      const rest = strip(v.replace(/^frigate/i, ""));
      return rest ? `media-source://frigate/${rest}` : `media-source://frigate`;
    }

    v = v.replace(/^media\//, "");
    return `media-source://media_source/${v}`;
  }

  _msNormalizeRoots(listOrSingle) {
    const arr = Array.isArray(listOrSingle)
      ? listOrSingle
      : listOrSingle
        ? [listOrSingle]
        : [];

    const out = [];
    const seen = new Set();

    for (const raw of arr) {
      const n = this._msNormalizeRoot(raw);
      if (!n) continue;
      const k = String(n).toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(n);
    }

    return out;
  }

  _msKeyFromRoots(rootsArr, fallbackSingle) {
    const roots =
      Array.isArray(rootsArr) && rootsArr.length
        ? this._msNormalizeRoots(rootsArr)
        : this._msNormalizeRoots(fallbackSingle);

    if (!roots.length) return "";
    return roots
      .slice()
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
      .join(" | ");
  }

  _wsWithTimeout(payload, timeoutMs = DEFAULT_BROWSE_TIMEOUT_MS) {
    const p = this._hass.callWS(payload);
    const t = new Promise((_, rej) =>
      setTimeout(() => rej(new Error(`WS timeout: ${payload?.type}`)), timeoutMs)
    );
    return Promise.race([p, t]);
  }

  async _msBrowse(rootId) {
    return await this._wsWithTimeout({
      type: "media_source/browse_media",
      media_content_id: rootId,
    });
  }

  async _msResolve(mediaId) {
    const cached = this._ms?.urlCache?.get(mediaId);
    if (cached) return cached;

    const r = await this._wsWithTimeout(
      {
        type: "media_source/resolve_media",
        media_content_id: mediaId,
        expires: 60 * 60,
      },
      12000
    );

    const url = r?.url ? String(r.url) : "";
    if (url) this._ms.urlCache.set(mediaId, url);
    return url;
  }

  _msIsRenderable(mime, mediaClass, title) {
    const t = String(title || "").toLowerCase();
    const m = String(mime || "").toLowerCase();
    const c = String(mediaClass || "").toLowerCase();

    if (m.startsWith("image/")) return true;
    if (m.startsWith("video/")) return true;
    if (/\.(jpg|jpeg|png|webp|gif)$/i.test(t)) return true;
    if (/\.(mp4|webm|mov|m4v)$/i.test(t)) return true;
    if (c === "image" || c === "video") return true;

    return false;
  }

  async _msWalkIter(rootId, limit, depthLimit) {
    const out = [];
    const stack = [{ id: rootId, depth: 0 }];

    while (stack.length && out.length < limit) {
      const { id, depth } = stack.pop();
      if (!id || depth > depthLimit) continue;

      let node;
      try {
        node = await this._msBrowse(id);
      } catch (_) {
        continue;
      }

      const children = Array.isArray(node?.children) ? node.children : [];

      if (!children.length) {
        if (node?.media_content_id) {
          const ok = this._msIsRenderable(
            node?.mime_type,
            node?.media_class,
            node?.title
          );
          if (ok) out.push(node);
        }
        continue;
      }

      for (let i = children.length - 1; i >= 0; i--) {
        if (out.length >= limit) break;

        const ch = children[i];
        const mid = String(ch?.media_content_id || "");
        if (!mid) continue;

        const cls = String(ch?.media_class || "").toLowerCase();
        if (cls === "directory") {
          stack.push({ id: mid, depth: depth + 1 });
        } else {
          const ok = this._msIsRenderable(
            ch?.mime_type,
            ch?.media_class,
            ch?.title
          );
          if (ok) out.push(ch);
        }
      }
    }

    return out;
  }

  async _msEnsureLoaded() {
    const roots =
      Array.isArray(this.config?.media_sources) &&
      this.config.media_sources.length
        ? this._msNormalizeRoots(this.config.media_sources)
        : this._msNormalizeRoots(this.config?.media_source);

    if (!roots.length) return;

    const now = Date.now();
    const key = this._msKeyFromRoots(roots);
    const sameKey = this._ms.key === key;
    const fresh = sameKey && now - (this._ms.loadedAt || 0) < 10_000;

    if (this._ms.loading || fresh) return;

    if (!sameKey) {
      this._ms.key = key;
      this._ms.roots = roots.slice();
      this._ms.list = [];
      this._ms.urlCache = new Map();
    }

    this._ms.loading = true;

    try {
      const visibleCap = this._normMaxMedia(this.config?.max_media);
      const internalCap = Math.min(2000, Math.max(visibleCap * 10, 300));

      const walkLimitTotal = Math.min(
        4000,
        Math.max(internalCap * 4, internalCap + 100)
      );
      const perRootLimit = Math.max(
        DEFAULT_PER_ROOT_MIN_LIMIT,
        Math.ceil(walkLimitTotal / roots.length)
      );

      const flat = [];

      for (const root of roots) {
        try {
          const depthLimit = String(root).includes("media_source/local/")
            ? Math.min(6, DEFAULT_WALK_DEPTH)
            : DEFAULT_WALK_DEPTH;

          const tmp = await this._msWalkIter(root, perRootLimit, depthLimit);
          flat.push(...tmp);
        } catch (e) {
          console.warn("MS root failed:", root, e);
        }
      }

      let items = flat
        .filter((x) => !!x?.media_content_id)
        .map((x) => ({
          id: String(x.media_content_id || ""),
          title: String(x.title || ""),
          mime: String(x.mime_type || ""),
          cls: String(x.media_class || ""),
        }))
        .filter((x) => !!x.id);

      items = this._dedupeByRelPath(items);

      items.sort((a, b) => {
        const am = this._dtMsFromSrc(a.id);
        const bm = this._dtMsFromSrc(b.id);
        const aOk = Number.isFinite(am);
        const bOk = Number.isFinite(bm);
        if (aOk && bOk && bm !== am) return bm - am;
        if (aOk && !bOk) return -1;
        if (!aOk && bOk) return 1;
        return a.title < b.title ? 1 : a.title > b.title ? -1 : 0;
      });

      this._ms.list = items.slice(0, internalCap);
      this._ms.loadedAt = Date.now();
    } catch (e) {
      console.warn("MS ensure load failed:", e);
      console.warn("MS roots used:", roots);
      this._ms.list = [];
    } finally {
      this._ms.loading = false;
      this.requestUpdate();
    }
  }

  _msIds() {
    return Array.isArray(this._ms?.list) ? this._ms.list.map((x) => x.id) : [];
  }

  _msTitleById(id) {
    const it = (this._ms?.list || []).find((x) => x.id === id);
    return it?.title || "";
  }

  _msQueueResolve(ids) {
    for (const id of ids || []) {
      if (!id || this._ms.urlCache.has(id)) continue;
      this._msResolveQueued.add(id);
    }
    if (this._msResolveInFlight) return;

    this._msResolveInFlight = true;

    (async () => {
      try {
        while (this._msResolveQueued.size) {
          const chunk = Array.from(this._msResolveQueued).slice(
            0,
            DEFAULT_RESOLVE_BATCH
          );
          chunk.forEach((x) => this._msResolveQueued.delete(x));

          await Promise.allSettled(chunk.map((id) => this._msResolve(id)));
          this.requestUpdate();
        }
      } finally {
        this._msResolveInFlight = false;
      }
    })().catch(() => {
      this._msResolveInFlight = false;
    });
  }

  // ─── Data ─────────────────────────────────────────────────────────

  _items() {
    const usingMediaSource = this.config?.source_mode === "media";

    if (usingMediaSource) {
      this._msEnsureLoaded();

      let ids = this._msIds();
      ids = this._dedupeByRelPath(ids);

      if (this._deleted?.size) {
        return ids.filter((id) => !this._deleted.has(id));
      }
      return ids;
    }

    const entities = this._sensorEntityList();
    if (!entities.length) return [];

    let list = [];

    for (const entityId of entities) {
      const st = this._hass?.states?.[entityId];
      const raw = st?.attributes?.[ATTR_NAME];
      if (!raw) continue;

      let part = [];

      if (Array.isArray(raw)) {
        part = raw.map((x) => this._toWebPath(x)).filter(Boolean);
      } else if (typeof raw === "string") {
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            part = parsed.map((x) => this._toWebPath(x)).filter(Boolean);
          } else {
            part = [this._toWebPath(raw)].filter(Boolean);
          }
        } catch (_) {
          part = [this._toWebPath(raw)].filter(Boolean);
        }
      }

      list.push(...part);
    }

    list = this._dedupeByRelPath(list);

    if (this._deleted?.size) {
      list = list.filter((src) => !this._deleted.has(src));
    }

    return list;
  }

  _sourceNameForParsing(src) {
    if (!this._isMediaSourceId(src)) return String(src || "");
    const t = this._msTitleById(src);
    return t || String(src || "");
  }

  _dayKeyFromMs(ms) {
    if (!Number.isFinite(ms)) return null;
    try {
      const d = new Date(ms);
      const y = String(d.getFullYear()).padStart(4, "0");
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      return `${y}-${m}-${dd}`;
    } catch (_) {
      return null;
    }
  }

  _dtKeyFromMs(ms) {
    if (!Number.isFinite(ms)) return null;
    try {
      const d = new Date(ms);
      const y = String(d.getFullYear()).padStart(4, "0");
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      const hh = String(d.getHours()).padStart(2, "0");
      const mm = String(d.getMinutes()).padStart(2, "0");
      const ss = String(d.getSeconds()).padStart(2, "0");
      return `${y}-${m}-${dd}T${hh}:${mm}:${ss}`;
    } catch (_) {
      return null;
    }
  }

  _extractEpochMs(src) {
    const s = this._sourceNameForParsing(src);
    if (!s) return NaN;

    let m = String(s).match(/-(\d{9,11}(?:\.\d+)?)-/);
    if (!m) m = String(s).match(/(\d{9,11}(?:\.\d+)?)/);
    if (!m) return NaN;

    const sec = Number.parseFloat(m[1]);
    if (!Number.isFinite(sec)) return NaN;

    if (sec < 946684800 || sec > 4102444800) return NaN;

    return sec * 1000;
  }

  _extractYmdHms(src) {
    const s = this._sourceNameForParsing(src);
    if (!s) return null;

    const m = String(s).match(
      /(\d{4})-(\d{2})-(\d{2})[T _-]?(\d{2})[:\-\.](\d{2})[:\-\.](\d{2})/
    );
    if (!m) return null;

    const y = m[1];
    const mo = m[2];
    const d = m[3];
    const hh = m[4];
    const mm = m[5];
    const ss = m[6];

    return {
      dayKey: `${y}-${mo}-${d}`,
      dtKey: `${y}-${mo}-${d}T${hh}:${mm}:${ss}`,
    };
  }

  _extractDayKey(src) {
    const ymd = this._extractYmdHms(src);
    if (ymd?.dayKey) return ymd.dayKey;

    const ms = this._dtMsFromSrc(src);
    const dk = this._dayKeyFromMs(ms);
    if (dk) return dk;

    const s = this._sourceNameForParsing(src);
    const m = String(s).match(/(\d{8})/);
    if (!m) return null;
    return `${m[1].slice(0, 4)}-${m[1].slice(4, 6)}-${m[1].slice(6, 8)}`;
  }

  _extractDateTimeKey(src) {
    const ymd = this._extractYmdHms(src);
    if (ymd?.dtKey) return ymd.dtKey;

    const ms = this._dtMsFromSrc(src);
    const dt = this._dtKeyFromMs(ms);
    if (dt) return dt;

    const s = this._sourceNameForParsing(src);
    const m = String(s || "").match(/(\d{8})[_-](\d{6})/);
    if (!m) return null;
    return `${m[1].slice(0, 4)}-${m[1].slice(4, 6)}-${m[1].slice(
      6,
      8
    )}T${m[2].slice(0, 2)}:${m[2].slice(2, 4)}:${m[2].slice(4, 6)}`;
  }

  _dtMsFromSrc(src) {
    const ems = this._extractEpochMs(src);
    if (Number.isFinite(ems)) return ems;

    const ymd = this._extractYmdHms(src);
    if (ymd?.dtKey) {
      const ms = new Date(ymd.dtKey).getTime();
      if (Number.isFinite(ms)) return ms;
    }

    const dtKey = (() => {
      const s = this._sourceNameForParsing(src);
      const m = String(s || "").match(/(\d{8})[_-](\d{6})/);
      if (!m) return null;
      return `${m[1].slice(0, 4)}-${m[1].slice(4, 6)}-${m[1].slice(
        6,
        8
      )}T${m[2].slice(0, 2)}:${m[2].slice(2, 4)}:${m[2].slice(4, 6)}`;
    })();

    if (dtKey) {
      const ms = new Date(dtKey).getTime();
      if (Number.isFinite(ms)) return ms;
    }

    const dayKey = (() => {
      const s = this._sourceNameForParsing(src);
      const m = String(s || "").match(/(\d{8})/);
      if (!m) return null;
      return `${m[1].slice(0, 4)}-${m[1].slice(4, 6)}-${m[1].slice(6, 8)}`;
    })();

    if (dayKey) {
      const ms = new Date(`${dayKey}T00:00:00`).getTime();
      if (Number.isFinite(ms)) return ms;
    }

    return NaN;
  }

  _tsLabelFromFilename(src) {
    const name = this._sourceNameForParsing(src);
    if (!name) return "";

    const ms = this._dtMsFromSrc(src);
    if (Number.isFinite(ms)) {
      const dtKey = this._dtKeyFromMs(ms);
      const nice = this._formatDateTime(dtKey);
      if (nice) return nice;
    }

    const dayKey = this._extractDayKey(src);
    if (dayKey) {
      try {
        const day = new Intl.DateTimeFormat("en", {
          day: "2-digit",
          month: "short",
          year: "numeric",
        })
          .format(new Date(`${dayKey}T00:00:00`))
          .replace(".", "");
        return day;
      } catch (_) {
        return dayKey;
      }
    }

    const base = String(name).split("/").pop() || String(name);
    const noExt = base.replace(
      /\.(mp4|webm|mov|m4v|jpg|jpeg|png|webp|gif)$/i,
      ""
    );
    return noExt.length > 42 ? `${noExt.slice(0, 39)}…` : noExt;
  }

  _formatDateTime(dtKey) {
    if (!dtKey) return "";
    try {
      const dt = new Date(dtKey);
      const date = new Intl.DateTimeFormat("en", {
        day: "2-digit",
        month: "short",
      })
        .format(dt)
        .replace(".", "");
      const time = new Intl.DateTimeFormat("en", {
        hour: "2-digit",
        minute: "2-digit",
      }).format(dt);
      return `${date} • ${time}`;
    } catch (_) {
      return "";
    }
  }

  _onThumbWheel(e) {
    const el = e.currentTarget;
    if (!el) return;

    const maxScroll = el.scrollWidth - el.clientWidth;
    if (maxScroll <= 0) return;

    const absX = Math.abs(e.deltaX || 0);
    const absY = Math.abs(e.deltaY || 0);

    let delta = absX > absY ? e.deltaX : e.deltaY;

    if (e.shiftKey && absY > 0) {
      delta = e.deltaY;
    }

    if (!Number.isFinite(delta) || Math.abs(delta) < 0.5) return;

    e.preventDefault();
    e.stopPropagation();

    let step = delta;
    if (e.deltaMode === 1) step = delta * 16;
    if (e.deltaMode === 2) step = delta * el.clientWidth * 0.85;

    const next = Math.max(0, Math.min(maxScroll, el.scrollLeft + step));
    el.scrollLeft = next;
  }

  _uniqueDays(itemsWithDay) {
    const set = new Set();
    for (const it of itemsWithDay) {
      if (it.dayKey) set.add(it.dayKey);
    }
    return Array.from(set).sort((a, b) => (a < b ? 1 : -1));
  }

  _formatDay(dayKey) {
    if (!dayKey) return "";
    try {
      return new Intl.DateTimeFormat("en", {
        day: "2-digit",
        month: "long",
      })
        .format(new Date(`${dayKey}T00:00:00`))
        .replace(".", "");
    } catch (_) {
      return dayKey;
    }
  }

  _dedupeByRelPath(items) {
    const seen = new Map();

    const norm = (idOrPath) =>
      String(idOrPath || "")
        .replace(/^media-source:\/\/media_source\//, "")
        .replace(/^media-source:\/\/media_source/, "")
        .replace(/^media-source:\/\//, "")
        .replace(/\/{2,}/g, "/")
        .replace(/^\/+/, "")
        .replace(/\/+$/g, "")
        .trim()
        .toLowerCase();

    for (const it of items || []) {
      const key = norm(it?.media_content_id || it?.path || it?.id || it);
      if (!key) continue;
      if (!seen.has(key)) seen.set(key, it);
    }

    return Array.from(seen.values());
  }

  _stepDay(delta, days, activeDay) {
    if (!days?.length) return;
    const current = activeDay && days.includes(activeDay) ? activeDay : days[0];
    const i = days.indexOf(current);
    const next = days[Math.min(Math.max(i + delta, 0), days.length - 1)];

    this._selectedDay = next;
    this._selectedIndex = 0;
    this._pendingScrollToI = null;
    this._forceThumbReset = true;
    this._exitSelectMode();

    if (this.config?.preview_click_to_open) this._previewOpen = false;

    if (this._isLiveActive()) {
      this._setViewMode("media");
    }

    this.requestUpdate();
  }

  _exitSelectMode() {
    this._selectMode = false;
    this._selectedSet.clear();
    this.requestUpdate();
  }

  _toggleSelected(src) {
    if (!src) return;
    if (this._selectedSet.has(src)) this._selectedSet.delete(src);
    else this._selectedSet.add(src);
    this.requestUpdate();
  }

  async _bulkDelete(selectedSrcList) {
    if (this.config?.source_mode !== "sensor") return;
    if (!this.config?.allow_delete || !this.config?.allow_bulk_delete) return;

    const sp = this._serviceParts();
    if (!sp) return;

    const prefix = this._normPrefixHardcoded();
    const srcs = Array.from(selectedSrcList || []);
    if (!srcs.length) return;

    if (this.config?.delete_confirm) {
      const ok = window.confirm(
        `Are you sure you want to delete ${srcs.length} file(s)?`
      );
      if (!ok) return;
    }

    for (const src of srcs) {
      const fsPath = this._toFsPath(src);
      if (!fsPath || !fsPath.startsWith(prefix)) continue;

      try {
        await this._hass.callService(sp.domain, sp.service, { path: fsPath });
        this._deleted.add(src);
      } catch (_) {}
    }

    this._selectedSet.clear();
    this._selectMode = false;
    this.requestUpdate();
  }

  _isInsideTsbar(e) {
    const path = e.composedPath?.() || [];
    return path.some(
      (el) =>
        el?.classList?.contains("tsicon") || el?.classList?.contains("tsbar")
    );
  }

  _closePreviewIfEnabled(e) {
    if (!this.config?.preview_click_to_open) return;
    if (!this.config?.preview_close_on_tap) return;
    if (!this._previewOpen) return;

    if (this._isInsideTsbar(e)) return;

    const path = e.composedPath?.() || [];
    if (path.some((el) => el?.classList?.contains("pnavbtn"))) return;
    if (path.some((el) => el?.classList?.contains("viewtoggle"))) return;
    if (path.some((el) => el?.classList?.contains("live-el"))) return;

    this._previewOpen = false;
    this._showNav = false;
    this.requestUpdate();
  }

  _onPreviewPointerDown(e) {
    if (e?.isPrimary === false) return;

    const path = e.composedPath?.() || [];
    if (
      this._isInsideTsbar(e) ||
      path.some((el) => el?.classList?.contains("pnavbtn")) ||
      path.some((el) => el?.tagName === "VIDEO") ||
      path.some((el) => el?.classList?.contains("viewtoggle")) ||
      path.some((el) => el?.classList?.contains("live-el"))
    ) {
      return;
    }

    if (this._isLiveActive()) return;

    this._swiping = true;
    this._swipeStartX = e.clientX;
    this._swipeStartY = e.clientY;

    try {
      e.currentTarget?.setPointerCapture?.(e.pointerId);
    } catch (_) {}
  }

  _onPreviewPointerUp(e, listLen) {
    if (!this._swiping) {
      if (this.config?.preview_click_to_open && !this._previewOpen) return;
      if (this._selectMode || this._isLiveActive()) return;
      this._showNavChevrons();
      return;
    }

    this._swiping = false;

    if (this.config?.preview_click_to_open && !this._previewOpen) return;
    if (this._isLiveActive()) return;

    const dx = e.clientX - this._swipeStartX;
    const dy = e.clientY - this._swipeStartY;

    if (Math.abs(dx) < 10 && Math.abs(dy) < 10) {
      this._showNavChevrons();
      return;
    }

    if (Math.abs(dy) > Math.abs(dx)) return;
    if (Math.abs(dx) < 45) return;
    if (this._selectMode) return;

    if (dx < 0) {
      if ((this._selectedIndex ?? 0) < listLen - 1) {
        this._selectedIndex = (this._selectedIndex ?? 0) + 1;
      }
    } else if ((this._selectedIndex ?? 0) > 0) {
      this._selectedIndex = (this._selectedIndex ?? 0) - 1;
    }

    this._pendingScrollToI = this._selectedIndex ?? 0;
    this.requestUpdate();
    this._showNavChevrons();
  }

  render() {
    if (!this._hass || !this.config) return html``;

    const usingMediaSource = this.config?.source_mode === "media";
    const rawItems = this._items();
    const visibleObjectFilters = this._getVisibleObjectFilters();

    if (!rawItems.length) {
      if (usingMediaSource && this._ms?.loading) {
        return html`<div class="empty">Loading media…</div>`;
      }
      return html`<div class="empty">No media found.</div>`;
    }

    const withDt = rawItems.map((src, idx) => {
      const dtMs = this._dtMsFromSrc(src);
      const dayKey = this._extractDayKey(src);
      return { src, idx, dtMs, dayKey };
    });

    withDt.sort((a, b) => {
      const aOk = Number.isFinite(a.dtMs);
      const bOk = Number.isFinite(b.dtMs);
      if (aOk && bOk && b.dtMs !== a.dtMs) return b.dtMs - a.dtMs;
      if (aOk && !bOk) return -1;
      if (!aOk && bOk) return 1;
      return b.idx - a.idx;
    });

    const allWithDay = withDt.map((x) => ({ src: x.src, dayKey: x.dayKey }));
    const days = this._uniqueDays(allWithDay);
    const newestDay = days[0] ?? null;
    const activeDay = this._selectedDay ?? newestDay;

    const dayFiltered = !activeDay
      ? allWithDay
      : allWithDay.filter((x) => x.dayKey === activeDay);

    const filteredAll = dayFiltered.filter((x) =>
      this._matchesObjectFilter(x.src)
    );

    const noResultsForFilter = !filteredAll.length;

    const cap = this._normMaxMedia(this.config?.max_media);
    const filtered = noResultsForFilter
      ? []
      : filteredAll.slice(0, Math.min(cap, filteredAll.length));

    if (!filtered.length) this._selectedIndex = 0;
    else if ((this._selectedIndex ?? 0) >= filtered.length)
      this._selectedIndex = 0;

    const idx = filtered.length
      ? Math.min(Math.max(this._selectedIndex ?? 0, 0), filtered.length - 1)
      : 0;

    const selected = filtered.length ? filtered[idx]?.src : "";

    const thumbs =
      THUMBS_ENABLED && filtered.length
        ? filtered.map((it, i) => ({ ...it, i }))
        : [];

    if (usingMediaSource) {
      const want = new Set();
      if (selected && this._isMediaSourceId(selected)) want.add(selected);
      for (const t of thumbs) {
        if (t?.src && this._isMediaSourceId(t.src)) want.add(t.src);
      }
      this._msQueueResolve(Array.from(want));
    }

    let selectedUrl = selected;
    if (this._isMediaSourceId(selected)) {
      selectedUrl = this._ms.urlCache.get(selected) || "";
    }

    let selectedMime = "";
    let selectedCls = "";
    let selectedTitle = "";
    if (usingMediaSource && this._isMediaSourceId(selected)) {
      const meta = this._msMetaById(selected);
      selectedMime = meta.mime;
      selectedCls = meta.cls;
      selectedTitle = meta.title;
    }

    const selectedIsVideo =
      !!selected &&
      this._isVideoSmart(selectedUrl || selectedTitle, selectedMime, selectedCls);

    if (selectedIsVideo && selectedUrl) this._ensurePoster(selectedUrl);

    const tsKey = selected ? this._extractDateTimeKey(selected) : "";
    const tsText = tsKey ? this._formatDateTime(tsKey) : "";
    const tsLabel = selected ? tsText || this._tsLabelFromFilename(selected) : "";

    const currentForNav = activeDay ?? newestDay;
    const dayIdx = currentForNav ? days.indexOf(currentForNav) : -1;
    const canPrev = dayIdx >= 0 && dayIdx < days.length - 1;
    const canNext = dayIdx > 0;
    const isToday = currentForNav === newestDay;

    const isGraphite = this._isGraphiteTheme();
    const isDark = this._isDarkMode();

    const PAL = isGraphite
      ? {
          cardBg: STYLE.card_background,
          previewBg: STYLE.preview_background,

          uiBg: "rgba(255,255,255,0.10)",
          uiStroke: "rgba(255,255,255,0.18)",
          uiTxt: "var(--primary-text-color, rgba(255,255,255,0.92))",
          uiTxt2: "var(--secondary-text-color, rgba(255,255,255,0.78))",
          uiDis: "rgba(var(--rgb-disabled-text-color, 120,120,120), 0.65)",

          divider: "var(--divider-color, rgba(255,255,255,0.10))",

          tsRgb: "0,0,0",
          pillBg: "rgba(255,255,255,0.12)",
          thumbBg: "rgba(var(--rgb-card-background-color, 255,255,255), 0.22)",
          tbarBg: "rgba(var(--rgb-card-background-color, 255,255,255), 0.72)",
          selOvA: "rgba(0,0,0,0.18)",
          selOvB: "rgba(0,0,0,0.28)",
          bulkBg: "rgba(var(--rgb-card-background-color, 255,255,255), 0.18)",
          bulkBorder:
            "rgba(var(--rgb-primary-text-color, 255,255,255), 0.12)",
          emptyBg: "rgba(var(--rgb-card-background-color, 255,255,255), 0.18)",
          navBtnBg: "rgba(var(--rgb-card-background-color, 255,255,255), 0.72)",
          navBtnBorder:
            "rgba(var(--rgb-primary-text-color, 255,255,255), 0.18)",
        }
      : isDark
        ? {
            cardBg: "rgba(20,20,22,0.86)",
            previewBg: "rgba(20,20,22,0.86)",

            uiBg: "rgba(255,255,255,0.10)",
            uiStroke: "rgba(255,255,255,0.18)",
            uiTxt: "rgba(255,255,255,0.92)",
            uiTxt2: "rgba(255,255,255,0.78)",
            uiDis: "rgba(255,255,255,0.35)",

            divider: "rgba(255,255,255,0.10)",

            tsRgb: "0,0,0",
            pillBg: "rgba(255,255,255,0.12)",
            thumbBg: "rgba(255,255,255,0.10)",
            tbarBg: "rgba(0,0,0,0.26)",
            selOvA: "rgba(0,0,0,0.18)",
            selOvB: "rgba(0,0,0,0.28)",
            bulkBg: "rgba(255,255,255,0.08)",
            bulkBorder: "rgba(255,255,255,0.12)",
            emptyBg: "rgba(255,255,255,0.08)",
            navBtnBg: "rgba(0,0,0,0.38)",
            navBtnBorder: "rgba(255,255,255,0.18)",
          }
        : {
            cardBg: "rgba(255,255,255,0.86)",
            previewBg: "rgba(255,255,255,0.86)",

            uiBg: "rgba(0,0,0,0.16)",
            uiStroke: "rgba(0,0,0,0.18)",
            uiTxt: "rgba(0,0,0,0.92)",
            uiTxt2: "rgba(0,0,0,0.70)",
            uiDis: "rgba(0,0,0,0.35)",

            divider: "rgba(0,0,0,0.10)",

            tsRgb: "0,0,0",
            pillBg: "rgba(255,255,255,0.14)",
            thumbBg: "rgba(0,0,0,0.06)",
            tbarBg: "rgba(0,0,0,0.16)",
            selOvA: "rgba(0,0,0,0.10)",
            selOvB: "rgba(0,0,0,0.16)",
            bulkBg: "rgba(0,0,0,0.06)",
            bulkBorder: "rgba(0,0,0,0.10)",
            emptyBg: "rgba(0,0,0,0.06)",
            navBtnBg: "rgba(0,0,0,0.18)",
            navBtnBorder: "rgba(0,0,0,0.18)",
          };

    const rootVars = `
      --gap:10px; --r:18px;

      --cardBg:${PAL.cardBg}; --cardPad:${STYLE.card_padding};
      --topbarPad:${STYLE.topbar_padding}; --topbarMar:${STYLE.topbar_margin};
      --previewBg:${PAL.previewBg};

      --uiBg:${PAL.uiBg}; --uiStroke:${PAL.uiStroke};
      --uiTxt:${PAL.uiTxt}; --uiTxt2:${PAL.uiTxt2};
      --uiDis:${PAL.uiDis};

      --divider:${PAL.divider};

      --tsRgb:${PAL.tsRgb};
      --pillBg:${PAL.pillBg};
      --thumbBg:${PAL.thumbBg};
      --tbarBg:${PAL.tbarBg};
      --selOvA:${PAL.selOvA};
      --selOvB:${PAL.selOvB};
      --bulkBg:${PAL.bulkBg};
      --bulkBorder:${PAL.bulkBorder};
      --emptyBg:${PAL.emptyBg};

      --navBtnBg:${PAL.navBtnBg};
      --navBtnBorder:${PAL.navBtnBorder};

      --barOpacity:${this.config.bar_opacity};
    `;

    const sp = this._serviceParts();

    const canDelete =
      this.config?.source_mode === "sensor" &&
      !!this.config?.allow_delete &&
      !!sp;
    const canBulkDelete =
      this.config?.source_mode === "sensor" &&
      !!this.config?.allow_bulk_delete &&
      !!sp;
    const showBulkToggle = canDelete && canBulkDelete;
    const bulkToggleDisabled = (thumbs?.length ?? 0) === 0;

    const tsPosClass =
      this.config.bar_position === "bottom"
        ? "bottom"
        : this.config.bar_position === "hidden"
          ? "hidden"
          : "top";

    const previewGated = !!this.config?.preview_click_to_open;
    const previewOpen = !previewGated || !!this._previewOpen;

    const showPreviewSection = previewOpen === true;
    const previewAtBottom = this.config?.preview_position === "bottom";

    const selectedNeedsResolve =
      !!selected && usingMediaSource && this._isMediaSourceId(selected);
    const selectedHasUrl = !!selected && (!selectedNeedsResolve || !!selectedUrl);

    const showLiveToggle =
      !!this.config?.show_live_toggle && this._hasLiveConfig();

    const isLive = this._isLiveActive();

    const previewBlock = showPreviewSection
      ? html`
          <div
            class="preview"
            style="height:${this.config.preview_height}px; touch-action:${isLive
              ? "auto"
              : "pan-y"};"
            @pointerdown=${(e) => {
              if (e?.isPrimary === false) return;

              const path = e.composedPath?.() || [];
              const isOnControls =
                this._isInsideTsbar(e) ||
                path.some((el) => el?.classList?.contains("pnavbtn")) ||
                path.some((el) => el?.tagName === "VIDEO") ||
                path.some((el) => el?.classList?.contains("live-el"));

              if (!isOnControls) {
                e.preventDefault?.();
                e.stopPropagation?.();
                e.stopImmediatePropagation?.();
                try {
                  e.currentTarget?.blur?.();
                } catch (_) {}
              }

              this._onPreviewPointerDown(e);
            }}
            @pointerup=${(e) => this._onPreviewPointerUp(e, filtered.length)}
            @pointercancel=${() => (this._swiping = false)}
            @click=${(e) => this._closePreviewIfEnabled(e)}
          >
            ${isLive
              ? this._renderLiveInner()
              : noResultsForFilter
                ? html`
                    <div class="preview-empty">
                      No ${this._filterLabelList(this._objectFilters)} media for this day.
                    </div>
                  `
                : !selectedHasUrl
                  ? html`<div class="empty inpreview">Loading media…</div>`
                  : selectedIsVideo
                    ? html`<video
                        class="pimg"
                        src=${selectedUrl}
                        controls
                        playsinline
                        preload="auto"
                        poster=${this._posterCache.get(selectedUrl) || ""}
                      ></video>`
                    : html`<img class="pimg" src=${selectedUrl} alt="" />`}

            ${!noResultsForFilter &&
            !isLive &&
            this._showNav &&
            filtered.length > 1
              ? html`
                  <div class="pnav">
                    <button
                      class="pnavbtn left"
                      ?disabled=${idx <= 0}
                      @click=${(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        this._navPrev();
                      }}
                      aria-label="Previous"
                      title="Previous"
                    >
                      <ha-icon icon="mdi:chevron-left"></ha-icon>
                    </button>

                    <button
                      class="pnavbtn right"
                      ?disabled=${idx >= filtered.length - 1}
                      @click=${(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        this._navNext(filtered.length);
                      }}
                      aria-label="Next"
                      title="Next"
                    >
                      <ha-icon icon="mdi:chevron-right"></ha-icon>
                    </button>
                  </div>
                `
              : html``}

            ${tsPosClass !== "hidden" && !isLive
              ? html`
                  <div class="tsbar ${tsPosClass}">
                    <div class="tsleft">
                      ${!noResultsForFilter ? tsLabel || "—" : "—"}
                    </div>
                    <div class="tspill">
                      <span class="tspill-val">${idx + 1}/${filtered.length}</span>
                    </div>
                  </div>
                `
              : html``}
          </div>
        `
      : html``;

    const objectFiltersBlock = visibleObjectFilters.length
      ? html`
          <div class="objfilters" role="group" aria-label="Object filters">
            ${visibleObjectFilters.map((filterValue) => {
              const objIcon = this._objectIcon(filterValue);
              const label = this._filterLabel(filterValue);
              return html`
                <button
                  class="objbtn ${this._isObjectFilterActive(filterValue)
                    ? "on"
                    : ""}"
                  @click=${() => this._setObjectFilter(filterValue)}
                  title="Filter ${label}"
                >
                  ${objIcon
                    ? html`<ha-icon icon="${objIcon}"></ha-icon>`
                    : html``}
                  <span>${label.charAt(0).toUpperCase() + label.slice(1)}</span>
                </button>
              `;
            })}
          </div>
        `
      : html``;

    const previewSection = showPreviewSection
      ? html`
          ${previewBlock}
          ${objectFiltersBlock}
        `
      : html``;

    const thumbsBlock = html`
      <div class="timeline">
        ${this._selectMode && (this._selectedSet?.size ?? 0)
          ? html`
              <div class="bulkbar topbulk">
                <span class="bulkcount">${this._selectedSet.size} selected</span>
                <div class="bulkactions">
                  <button
                    type="button"
                    class="bulkicon bulkcancel"
                    title="Cancel"
                    aria-label="Cancel"
                    @click=${(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      this._exitSelectMode();
                    }}
                  >
                    <ha-icon icon="mdi:close"></ha-icon>
                  </button>
                  <button
                    type="button"
                    class="bulkicon bulkdelete"
                    title="Delete"
                    aria-label="Delete"
                    ?disabled=${!canDelete}
                    @click=${async (e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      await this._bulkDelete(this._selectedSet);
                    }}
                  >
                    <ha-icon icon="mdi:trash-can"></ha-icon>
                  </button>
                </div>
              </div>
              <div class="divider"></div>
            `
          : html``}

        ${thumbs.length
          ? html`
              <div
                class="tthumbs"
                style="--tgap:${THUMB_GAP}px;"
                @wheel=${this._onThumbWheel}
              >
                ${thumbs.map((it) => {
                  const isOn = it.i === idx && !isLive;
                  const isSel = this._selectedSet?.has(it.src);
                  const isMs = usingMediaSource && this._isMediaSourceId(it.src);

                  let thumbUrl = it.src;
                  if (isMs) thumbUrl = this._ms.urlCache.get(it.src) || "";

                  let tMime = "";
                  let tCls = "";
                  let tTitle = "";
                  if (isMs) {
                    const meta = this._msMetaById(it.src);
                    tMime = meta.mime;
                    tCls = meta.cls;
                    tTitle = meta.title;
                  }

                  const isVid = this._isVideoSmart(
                    thumbUrl || tTitle,
                    tMime,
                    tCls
                  );
                  if (isVid && thumbUrl) this._ensurePoster(thumbUrl);

                  const poster = isVid ? this._posterCache.get(thumbUrl) : thumbUrl;

                  const needsResolve = isMs;
                  const hasUrl = !needsResolve || !!thumbUrl;
                  const showImg = hasUrl && !!poster;

                  const tMs = this._dtMsFromSrc(it.src);
                  const tTime = this._formatTimeFromMs(tMs);

                  const obj = this._objectForSrc(it.src);
                  const objIcon = this._objectIcon(obj);
                  const objColor = this._objectColor(obj);

                  const barPos = this.config?.thumb_bar_position || "bottom";
                  const showBar = barPos !== "hidden" && (!!tTime || !!objIcon);

                  return html`
                    <button
                      class="tthumb ${isOn ? "on" : ""} ${this._selectMode &&
                      isSel
                        ? "sel"
                        : ""}"
                      data-i="${it.i}"
                      style="width:${this.config.thumb_size}px;height:${this.config.thumb_size}px;border-radius:${THUMB_RADIUS}px;"
                      @pointerdown=${(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        e.stopImmediatePropagation?.();
                        e.currentTarget?.blur?.();
                      }}
                      @click=${(e) => {
                        e.preventDefault();
                        e.stopPropagation();

                        if (this._selectMode) {
                          this._toggleSelected(it.src);
                          return;
                        }

                        if (this._isLiveActive()) {
                          this._setViewMode("media");
                        }

                        if (this.config?.preview_click_to_open) {
                          this._previewOpen = true;
                        }

                        this._selectedIndex = it.i;
                        this._pendingScrollToI = it.i;
                        this.requestUpdate();
                      }}
                    >
                      ${showImg
                        ? html`<img
                            class="timg"
                            src="${poster}"
                            alt=""
                            loading="lazy"
                          />`
                        : html`<div class="tph" aria-hidden="true"></div>`}

                      ${showBar
                        ? html`
                            <div class="tbar ${barPos}">
                              <div class="tbar-left">${tTime || "—"}</div>
                              ${objIcon
                                ? html`
                                    <ha-icon
                                      class="tbar-icon"
                                      icon="${objIcon}"
                                      style="color:${objColor}"
                                    ></ha-icon>
                                  `
                                : html``}
                            </div>
                          `
                        : html``}

                      ${this._selectMode
                        ? html`
                            <div class="selOverlay ${isSel ? "on" : ""}">
                              <ha-icon icon="mdi:check"></ha-icon>
                            </div>
                          `
                        : html``}
                    </button>
                  `;
                })}
              </div>
            `
          : noResultsForFilter
            ? html`
                <div class="empty filter-empty">
                  No ${this._filterLabelList(this._objectFilters)} media for this day.
                </div>
              `
            : html``}
      </div>
    `;

    return html`
      <div class="root" style="${rootVars}">
        <div class="panel" style="width:${PREVIEW_WIDTH}; margin:0 auto;">
          ${!previewAtBottom && showPreviewSection
            ? html`${previewSection}<div class="divider"></div>`
            : html``}

          <div class="topbar">
            <div class="seg" role="tablist" aria-label="Filter">
              <button
                class="segbtn ${isToday ? "on" : ""}"
                @click=${() => {
                  this._selectedDay = newestDay;
                  this._selectedIndex = 0;
                  this._pendingScrollToI = null;
                  this._forceThumbReset = true;
                  this._exitSelectMode();
                  if (this.config?.preview_click_to_open) this._previewOpen = false;
                  if (this._isLiveActive()) this._setViewMode("media");
                  this.requestUpdate();
                }}
                title="Today"
                role="tab"
                aria-selected=${isToday}
              >
                <span>Today</span>
              </button>
            </div>

            <div class="datepill" role="group" aria-label="Day navigation">
              <button
                class="iconbtn"
                ?disabled=${!canPrev}
                @click=${() => this._stepDay(+1, days, currentForNav)}
                aria-label="Previous day"
                title="Previous day"
              >
                <ha-icon icon="mdi:chevron-left"></ha-icon>
              </button>
              <div class="dateinfo" title="Selected day">
                <span class="txt"
                  >${currentForNav ? this._formatDay(currentForNav) : "—"}</span
                >
              </div>
              <button
                class="iconbtn"
                ?disabled=${!canNext}
                @click=${() => this._stepDay(-1, days, currentForNav)}
                aria-label="Next day"
                title="Next day"
              >
                <ha-icon icon="mdi:chevron-right"></ha-icon>
              </button>
            </div>

            ${showBulkToggle
              ? html`
                  <button
                    class="bulkbtn ${this._selectMode ? "on" : ""}"
                    ?disabled=${bulkToggleDisabled}
                    title=${bulkToggleDisabled
                      ? "No media available for selection"
                      : this._selectMode
                        ? "Stop selecting"
                        : "Select"}
                    @pointerdown=${(e) => {
                      if (bulkToggleDisabled) return;
                      e.preventDefault();
                      e.stopPropagation();
                      e.stopImmediatePropagation?.();
                    }}
                    @click=${(e) => {
                      if (bulkToggleDisabled) return;
                      e.preventDefault();
                      e.stopPropagation();
                      e.stopImmediatePropagation?.();
                      e.currentTarget.blur();
                      this._selectMode = !this._selectMode;
                      this._selectedSet?.clear?.();
                      this.requestUpdate();
                    }}
                  >
                    <ha-icon
                      icon="mdi:checkbox-multiple-marked-outline"
                    ></ha-icon>
                  </button>
                `
              : html``}

            <button
              class="bulkbtn"
              title="Download"
              @click=${(e) => {
                e.preventDefault();
                e.stopPropagation();
                this._downloadSrc(selectedUrl || selected);
              }}
            >
              <ha-icon icon="mdi:download"></ha-icon>
            </button>

            ${showLiveToggle
              ? html`
                  <button
                    class="bulkbtn live ${isLive ? "on" : ""}"
                    title="Live camera"
                    @click=${(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      this._setViewMode(isLive ? "media" : "live");
                    }}
                  >
                    <ha-icon
                      icon="${isLive ? "mdi:video" : "mdi:video-outline"}"
                    ></ha-icon>
                  </button>
                `
              : html``}
          </div>

          <div class="divider"></div>

          ${thumbsBlock}

          ${previewAtBottom && showPreviewSection
            ? html`<div class="divider"></div>${previewSection}`
            : html``}
        </div>
      </div>
    `;
  }

  static get styles() {
    return css`
      :host {
        display: block;
      }

      .root {
        display: block;
        background: transparent;
        padding: 0;
        border-radius: 0;
        min-height: 0;
      }
      .panel {
        background: var(--cardBg);
        border-radius: var(--r);
        padding: var(--cardPad);
        box-sizing: border-box;
      }
      .divider {
        height: 1px;
        background: var(--divider);
        margin: 10px 0;
      }

      .preview {
        position: relative;
        -webkit-mask-image: -webkit-radial-gradient(white, black);
        transform: translateZ(0);
        background: var(--previewBg);
        width: 100%;
        border-radius: var(--r);
        overflow: hidden;
      }
      .pimg {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
      }

      .live-card-host {
        position: absolute;
        inset: 0;
        border-radius: inherit;
        overflow: hidden;
      }

      .live-card-host > * {
        width: 100% !important;
        height: 100% !important;
        display: block !important;
      }

      .live-card-host ha-card {
        width: 100% !important;
        height: 100% !important;
        margin: 0 !important;
        box-shadow: none !important;
        background: transparent !important;
        border-radius: inherit !important;
        overflow: hidden !important;
      }

      .live-card-host video {
        width: 100% !important;
        height: 100% !important;
        object-fit: cover !important;
      }

      .live-stage {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
      }

      .live-stage::before {
        content: "LIVE";
        position: absolute;
        top: 10px;
        left: 16px;        /* iets verder naar rechts */

        background: rgba(255,0,0,0.9);
        color: white;

        font-size: 9px;    /* kleiner */
        font-weight: 800;
        letter-spacing: 0.5px;

        padding: 2px 6px;  /* compacter */
        border-radius: 6px;

        z-index: 20;
      }

      .live-el {
        display: block;
        width: 100%;
        height: 100%;
      }

      .preview-empty {
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        text-align: center;
        padding: 24px;
        box-sizing: border-box;
        color: var(--uiTxt);
        font-size: 15px;
        font-weight: 700;
        background: var(--previewBg);
      }

      .objfilters {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 8px;
        margin-top: 10px;
        width: 100%;
      }

      .objbtn {
        width: 100%;
        min-width: 0;
        border: 0;
        border-radius: 10px;
        padding: 10px 12px;
        background: var(--uiBg);
        color: var(--uiTxt);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        cursor: pointer;
        font-size: 12px;
        font-weight: 800;
        text-transform: capitalize;
        -webkit-tap-highlight-color: transparent;
        box-sizing: border-box;
      }

      .objbtn.on {
        background: var(--primary-color, #ffffff);
        color: var(--text-primary-color, #ffffff);
        border-radius: 8px;
      }
      .objbtn ha-icon {
        --ha-icon-size: 16px;
        --mdc-icon-size: var(--ha-icon-size);
        width: var(--ha-icon-size);
        height: var(--ha-icon-size);
      }

      .pnav {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0 10px;
        pointer-events: none;
        z-index: 4;
      }
      .pnavbtn {
        pointer-events: auto;
        width: 44px;
        height: 44px;
        border-radius: 999px;
        border: 1px solid var(--navBtnBorder);
        background: var(--navBtnBg);
        backdrop-filter: blur(6px);
        -webkit-backdrop-filter: blur(6px);
        color: var(--uiTxt);
        display: grid;
        place-items: center;
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
      }
      .pnavbtn[disabled] {
        opacity: 0;
        cursor: default;
      }
      .pnavbtn ha-icon {
        --ha-icon-size: 26px;
        --mdc-icon-size: var(--ha-icon-size);
        width: var(--ha-icon-size);
        height: var(--ha-icon-size);
      }

      .tsbar {
        position: absolute;
        left: 0;
        right: 0;
        height: 40px;
        padding: 0 10px 0 12px;
        background: rgba(
          var(--tsRgb, 0, 0, 0),
          calc(var(--barOpacity, 45) / 100)
        );
        color: var(--uiTxt);
        font-size: 12px;
        font-weight: 700;
        display: flex;
        align-items: center;
        justify-content: space-between;
        box-sizing: border-box;
        pointer-events: none;
        z-index: 2;
        backdrop-filter: blur(calc(8px * min(1, var(--barOpacity, 45))));
        -webkit-backdrop-filter: blur(
          calc(8px * min(1, var(--barOpacity, 45)))
        );
      }
      .tsbar.top {
        top: 0;
      }
      .tsbar.bottom {
        bottom: 0;
      }
      .tsleft {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .tspill {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 4px 12px;
        border-radius: 999px;
        background: var(--pillBg);
        backdrop-filter: blur(6px);
        color: var(--uiTxt);
        font-size: 11px;
        font-weight: 800;
        white-space: nowrap;
        pointer-events: auto;
        flex-shrink: 0;
      }

      .topbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: var(--topbarPad);
        margin: var(--topbarMar);
        overflow: hidden;
        min-width: 0;
      }

      .seg {
        display: inline-flex;
        align-items: center;
        height: 30px;
        background: var(--uiBg);
        border-radius: 10px;
        overflow: hidden;
        flex: 0 0 auto;
      }
      .segbtn {
        border: 0;
        height: 100%;
        padding: 0 12px;
        border-radius: 10px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        color: var(--uiTxt2);
        background: transparent;
        font-size: 13px;
        font-weight: 700;
        white-space: nowrap;
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
      }
      .segbtn.on {
        background: var(--primary-color, #ffffff);
        color: var(--text-primary-color, #ffffff);
        border-radius: 8px;
      }

      .datepill {
        display: flex;
        align-items: center;
        height: 30px;
        background: var(--uiBg);
        border-radius: 10px;
        overflow: hidden;
        flex: 1 1 auto;
        min-width: 0;
      }
      .iconbtn {
        width: 44px;
        height: 44px;
        border: 0;
        background: transparent;
        color: var(--uiTxt);
        display: grid;
        place-items: center;
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
        flex: 0 0 auto;
      }
      .iconbtn[disabled] {
        color: var(--uiDis);
        cursor: default;
      }
      .dateinfo {
        flex: 1 1 auto;
        min-width: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 10px 14px;
        color: var(--uiTxt);
        font-size: 13px;
        font-weight: 800;
      }
      .dateinfo .txt {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .bulkbtn {
        --bsize: 30px;
        width: var(--bsize);
        height: var(--bsize);
        border-radius: 999px;
        background: var(--uiBg);
        color: var(--uiTxt);
        display: grid;
        place-items: center;
        cursor: pointer;
        pointer-events: auto;
        position: relative;
        z-index: 3;
        flex: 0 0 auto;
        -webkit-tap-highlight-color: transparent;
        padding: 0;
        line-height: 0;
        box-sizing: border-box;
        border: 0;
      }
      .bulkbtn.on {
        background: var(--primary-color, #ffffff);
        color: var(--text-primary-color, #ffffff);
      }
      .bulkbtn.live.on {
        background: rgba(255, 59, 48, 0.18);
        color: #ff6b60;
      }
      .bulkbtn ha-icon {
        --ha-icon-size: calc(var(--bsize) * 0.55);
        --mdc-icon-size: var(--ha-icon-size);
        width: var(--ha-icon-size);
        height: var(--ha-icon-size);
        display: block;
        margin: auto;
        transform: translateY(-0.5px);
      }

      .bulkbtn[disabled] {
        opacity: 0.42;
        cursor: default;
        pointer-events: none;
      }

      .timeline {
        padding: 0;
        margin: 0;
      }
      .tthumbs {
        display: flex;
        align-items: center;
        gap: var(--tgap, 12px);
        margin-bottom: 0px;
        min-width: 0;
        overflow-x: auto;
        overflow-y: hidden;
        -webkit-overflow-scrolling: touch;
        padding-bottom: 2px;
        overscroll-behavior-x: contain;
        overscroll-behavior-y: none;
      }

      .tthumb:focus {
        outline: none;
      }
      .tthumb {
        border: 0;
        padding: 0;
        overflow: hidden;
        background: var(--thumbBg);
        outline: none;
        cursor: pointer;
        position: relative;
        flex: 0 0 auto;
        scroll-snap-align: start;
        box-shadow: 0 4px 10px rgba(0, 0, 0, 0.25);
      }

      .live-card-host {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        background: #000;
      }

      .live-card-host > * {
        width: 100% !important;
        height: 100% !important;
        display: block !important;
      }

      .live-card-host ha-card {
        width: 100% !important;
        height: 100% !important;
        margin: 0 !important;
        box-shadow: none !important;
        background: transparent !important;
        border-radius: 0 !important;
        overflow: hidden !important;
      }

      .tthumb::after {
        content: "";
        position: absolute;
        inset: 0;
        border-radius: inherit;
        pointer-events: none;
        box-sizing: border-box;
        border: 1px solid
          rgba(var(--rgb-primary-text-color, 255, 255, 255), 0.18);
      }
      .tthumb.on::after {
        border: 2px solid var(--primary-color, rgba(255, 165, 0, 0.95));
      }
      .tthumb.sel::after {
        border: 2px solid rgba(255, 192, 203, 0.95);
      }

      .timg {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
      }
      .tph {
        width: 100%;
        height: 100%;
        background: var(--thumbBg);
      }



      .tbar {
        position: absolute;
        left: 0;
        right: 0;
        height: 26px;
        padding: 0 8px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        background: var(--tbarBg);
        backdrop-filter: blur(6px);
        -webkit-backdrop-filter: blur(6px);
        font-size: 11px;
        font-weight: 800;
        color: var(--uiTxt);
        pointer-events: none;
        z-index: 2;
      }
      .tbar.bottom {
        bottom: 0;
        border-bottom-left-radius: 14px;
        border-bottom-right-radius: 14px;
      }
      .tbar.top {
        top: 0;
        border-top-left-radius: 14px;
        border-top-right-radius: 14px;
      }

      .tbar.hidden {
        display: none;
      }

      .tbar-left {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .tbar-icon {
        --ha-icon-size: 16px;
        --mdc-icon-size: var(--ha-icon-size);
        width: var(--ha-icon-size);
        height: var(--ha-icon-size);
        flex: 0 0 auto;
      }

      .selOverlay {
        position: absolute;
        inset: 0;
        background: var(--selOvA);
        display: flex;
        align-items: center;
        justify-content: center;
        opacity: 0;
        transition: 0.12s ease;
        pointer-events: none;
      }
      .selOverlay.on {
        opacity: 1;
        background: var(--selOvB);
      }
      .selOverlay ha-icon {
        color: var(--uiTxt);
        --mdc-icon-size: 22px;
        --ha-icon-size: 22px;
        width: 22px;
        height: 22px;
      }

      .bulkbar {
        margin: 8px 0 0 0;
        padding: 10px 12px;
        border-radius: 14px;
        background: var(--bulkBg);
        border: 1px solid var(--bulkBorder);
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        flex-wrap: wrap;
      }
      .bulkcount {
        font-size: 13px;
        font-weight: 900;
        color: var(--uiTxt);
        white-space: nowrap;
        flex: 1 1 auto;
        min-width: 0;
      }
      .bulkactions {
        display: flex;
        align-items: center;
        gap: 10px;
        flex: 0 0 auto;
      }
      .bulkicon {
        --asize: 40px;
        width: var(--asize);
        height: var(--asize);
        border-radius: 999px;
        display: grid;
        place-items: center;
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
        padding: 0;
        line-height: 0;
        box-sizing: border-box;
        opacity: 1;
      }
      .bulkicon[disabled] {
        opacity: 0.45;
        cursor: default;
      }
      .bulkcancel {
        border: 0;
        background: var(--success-color, #2e7d32);
        color: var(--text-primary-color, rgba(255, 255, 255, 0.98));
      }
      .bulkdelete {
        border: 0;
        background: var(--error-color, #ff0000);
        color: var(--text-primary-color, rgba(255, 255, 255, 0.98));
      }
      .bulkicon ha-icon {
        --ha-icon-size: calc(var(--asize) * 0.55);
        --mdc-icon-size: var(--ha-icon-size);
        width: var(--ha-icon-size);
        height: var(--ha-icon-size);
        display: block;
        margin: auto;
        transform: translateY(-0.5px);
      }
      .bulkbar,
      .bulkactions,
      .bulkicon {
        pointer-events: auto;
        position: relative;
        z-index: 2;
      }

      .empty {
        padding: 12px;
        border-radius: 14px;
        background: var(--emptyBg);
        color: var(--uiTxt);
      }

      .empty.inpreview {
        position: absolute;
        inset: 50% auto auto 50%;
        transform: translate(-50%, -50%);
        z-index: 3;
      }

      .filter-empty {
        text-align: center;
      }

      @media (max-width: 420px) {
        .segbtn {
          padding: 9px 12px;
        }
        .iconbtn {
          width: 40px;
          height: 40px;
        }
        .dateinfo {
          padding: 9px 12px;
        }
        .objfilters {
          gap: 6px;
        }
        .objbtn {
          padding: 7px 10px;
        }
      }
    `;
  }
}

customElements.define("camera-gallery-card", CameraGalleryCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "camera-gallery-card",
  name: "Camera Gallery Card",
  description:
    "Media gallery for Home Assistant (sensor fileList OR media_source folder) with optional live preview",
});

console.info(`Camera Gallery Card v${CARD_VERSION}`);