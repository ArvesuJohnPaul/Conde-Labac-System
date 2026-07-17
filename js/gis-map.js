// =====================================================
// CONDE LABAK GIS SYSTEM — CUSTOM GEOJSON MAP ENGINE
// Renders the barangay boundary + buildings/roads/water/vegetation
// as inline SVG, with tools to draw new buildings, roads, vegetation,
// construction, and hazard-zone areas. No external map tiles/libraries.
// =====================================================

const GIS_DATA_PREFIX = location.pathname.includes("/pages/") ? "../data/" : "data/";

// Base layers are served from PostGIS (/api/gis/layers/*, populated by
// server/import-base-layers.js). The static data/*.geojson files remain as a
// fallback so the map still renders when the API is unreachable (e.g. the
// GitHub Pages demo with the tunnel down).
const GIS_BOUNDARY_URL =
  window.GIS_BOUNDARY_URL_OVERRIDE || GIS_DATA_PREFIX + "conde-labak-boundary.geojson";
const GIS_BUILDINGS_URL =
  window.GIS_BUILDINGS_URL_OVERRIDE || GIS_DATA_PREFIX + "conde-labak-buildings.geojson";
const GIS_ROADS_URL =
  window.GIS_ROADS_URL_OVERRIDE || GIS_DATA_PREFIX + "conde-labak-roads.geojson";
const GIS_WATER_URL =
  window.GIS_WATER_URL_OVERRIDE || GIS_DATA_PREFIX + "conde-labak-water.geojson";
const GIS_VEGETATION_URL =
  window.GIS_VEGETATION_URL_OVERRIDE || GIS_DATA_PREFIX + "conde-labak-vegetation.geojson";

// Fetches one base layer: PostGIS first, static file second. Returns null when
// both fail (callers already treat a null layer as "unavailable"). Plain fetch
// rather than apiGet — most map pages don't load js/api.js. window.API_BASE is
// set by api-config.js where present; same-origin otherwise (the Express
// server serves the site, so a relative /api path works in local dev).
async function gisFetchBaseLayer(apiName, staticUrl, label) {
  try {
    const res = await fetch((window.API_BASE || "") + "/api/gis/layers/" + apiName, {
      headers: { "ngrok-skip-browser-warning": "true" },
    });
    if (res.ok) {
      const fc = await res.json();
      if (fc && Array.isArray(fc.features) && fc.features.length) return fc;
    }
    console.warn(`[gis-map] ${label}: API gave no features, using static file`);
  } catch (e) {
    console.warn(`[gis-map] ${label}: API unavailable, using static file`, e);
  }
  try {
    const res = await fetch(staticUrl);
    return await res.json();
  } catch (e) {
    console.warn(`[gis-map] ${label} layer unavailable`, e);
    return null;
  }
}

// ───────── Icon system ─────────
// Small hand-authored stroke-icon set (24x24, currentColor) so the map UI
// doesn't depend on emoji glyphs (inconsistent rendering across platforms)
// or an external icon font/CDN. Referenced by name everywhere an emoji used
// to be hardcoded; `gisIcon()` inlines the matching <svg>.
const GIS_ICON_PATHS = {
  home: '<path d="M4 11.5 12 4l8 7.5"/><path d="M6 10v9a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-9"/><path d="M10 20v-6h4v6"/>',
  senior: '<circle cx="12" cy="6" r="2.6"/><path d="M12 10c-2.5 0-4 1.6-4 4v2h2.2l.6 5h2.4l.6-5H16v-2c0-2.4-1.5-4-4-4Z"/><path d="M8.5 15 6 17"/>',
  wheelchair: '<circle cx="9" cy="5" r="1.6"/><path d="M9 8v5l3.5 2.5"/><path d="M9 11h4.5"/><path d="M12.5 13.5 15 19h3"/><path d="M6.5 13a5 5 0 1 0 8 5.8"/>',
  family: '<circle cx="8.5" cy="7" r="2.2"/><circle cx="16" cy="8.5" r="1.8"/><path d="M4 19v-1.5A4 4 0 0 1 8.5 13a4 4 0 0 1 4 3.2"/><path d="M13 19v-1a3.2 3.2 0 0 1 6 0v1"/>',
  wheat: '<path d="M12 21V6"/><path d="M12 8c-2 0-3-1.4-3-3.2C10.6 4.8 12 6 12 8Z"/><path d="M12 8c2 0 3-1.4 3-3.2C13.4 4.8 12 6 12 8Z"/><path d="M12 12c-2 0-3-1.4-3-3.2 1.6 0 3 1.2 3 3.2Z"/><path d="M12 12c2 0 3-1.4 3-3.2-1.6 0-3 1.2-3 3.2Z"/><path d="M12 16c-2 0-3-1.4-3-3.2 1.6 0 3 1.2 3 3.2Z"/><path d="M12 16c2 0 3-1.4 3-3.2-1.6 0-3 1.2-3 3.2Z"/>',
  orchard: '<circle cx="12" cy="9" r="4.2"/><path d="M12 4.6V3"/><path d="M12 13v8"/>',
  tree: '<path d="M12 3 7.5 10h2.2L6 16h4.6v5h2.8v-5H18l-3.7-6h2.2Z"/>',
  grass: '<path d="M6 20c0-4 1-7 2-9"/><path d="M12 20c0-5 0-9-1-11"/><path d="M18 20c0-4-1-7-2-9"/>',
  barn: '<path d="M3 11 12 5l9 6"/><path d="M5 10.5V20h14v-9.5"/><path d="M12 20v-6h-2.4v6"/><path d="M12 14h2.4v6"/>',
  droplet: '<path d="M12 3s6 6.6 6 11a6 6 0 1 1-12 0c0-4.4 6-11 6-11Z"/>',
  waves: '<path d="M3 9c1.5-1.4 3-1.4 4.5 0s3 1.4 4.5 0 3-1.4 4.5 0 3 1.4 4.5 0"/><path d="M3 15c1.5-1.4 3-1.4 4.5 0s3 1.4 4.5 0 3-1.4 4.5 0 3 1.4 4.5 0"/>',
  mountain: '<path d="M3 19 9.5 8l3 4.8L15.5 9 21 19Z"/><path d="M8 19l3.5-5.7"/>',
  flame: '<path d="M12 3s-1 2.6-3 4.6C7 9.6 6 11.5 6 13.5A6 6 0 0 0 18 13.5c0-2-1.3-3.4-2.2-4.4.3 1.6-.2 2.6-1 3-.2-2.4-1.3-4-2.8-9.1Z"/>',
  warningTriangle: '<path d="M12 4 3 20h18Z"/><path d="M12 10.5v3.8"/><circle cx="12" cy="17" r="0.9" fill="currentColor" stroke="none"/>',
  car: '<path d="M4 16v-3.2L6 8.5A2 2 0 0 1 7.8 7.3h8.4A2 2 0 0 1 18 8.5l2 4.3V16"/><path d="M4 16h16v2.4a1 1 0 0 1-1 1h-1.4a1 1 0 0 1-1-1V17H7.4v1.4a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1Z"/><circle cx="8" cy="16" r="1.3"/><circle cx="16" cy="16" r="1.3"/>',
  medical: '<rect x="3.5" y="6" width="17" height="13" rx="1.6"/><path d="M12 9.5v6"/><path d="M9 12.5h6"/><path d="M8 6V4.6A1.6 1.6 0 0 1 9.6 3h4.8A1.6 1.6 0 0 1 16 4.6V6"/>',
  fist: '<path d="M7 11V8.6a1.6 1.6 0 1 1 3.2 0V11"/><path d="M10.2 10.6V7.8a1.6 1.6 0 1 1 3.2 0v2.8"/><path d="M13.4 10.8V8.2a1.6 1.6 0 1 1 3.2 0v5.4"/><path d="M6.8 12 5 13.6c-.6.6-.6 1.8 0 2.6l2 2.4c.7.9 1.8 1.4 3 1.4h3.6c2 0 3.6-1.6 3.6-3.6v-3.6"/>',
  siren: '<path d="M5 20v-5.5A7 7 0 0 1 12 7.5a7 7 0 0 1 7 7V20Z"/><path d="M12 7.5V5"/><path d="M8.5 6 7.3 4"/><path d="M15.5 6l1.2-2"/><path d="M4 20h16"/>',
  alertCircle: '<circle cx="12" cy="12" r="8.5"/><path d="M12 8v5"/><circle cx="12" cy="16" r="0.9" fill="currentColor" stroke="none"/>',
  cone: '<path d="M12 4 8 18h8Z"/><path d="M6.5 20h11"/><path d="M9.4 11.5h5.2"/><path d="M8.4 15h7.2"/>',
  road: '<path d="M9 3 6 21"/><path d="M15 3l3 18"/><path d="M12 4v2.2M12 9.5v2.2M12 15v2.2"/>',
  building: '<rect x="5" y="3.5" width="14" height="17" rx="1"/><path d="M8.5 7.5h1.6M13.9 7.5h1.6M8.5 11.5h1.6M13.9 11.5h1.6M8.5 15.5h1.6M13.9 15.5h1.6"/><path d="M10.4 20.5v-3.2h3.2v3.2"/>',
  edit: '<path d="M4 20h16"/><path d="m6 16.6 9.4-9.4 2.4 2.4L8.4 19H6Z"/><path d="m14.4 5.2 2.4-2.4 2.4 2.4-2.4 2.4Z"/>',
  trash: '<path d="M5 6.5h14"/><path d="M9 6.5V4.8A1.3 1.3 0 0 1 10.3 3.5h3.4A1.3 1.3 0 0 1 15 4.8v1.7"/><path d="m6.5 6.5.9 12a1.5 1.5 0 0 0 1.5 1.4h6.2a1.5 1.5 0 0 0 1.5-1.4l.9-12"/><path d="M10 10.5v6M14 10.5v6"/>',
  pin: '<path d="M12 21s7-6.5 7-11.6A7 7 0 0 0 5 9.4C5 14.5 12 21 12 21Z"/><circle cx="12" cy="9.4" r="2.4"/>',
  heart: '<path d="M12 20S5 15.4 5 10.6C5 8 7 6.2 9.2 6.2c1.2 0 2.2.6 2.8 1.5.6-.9 1.6-1.5 2.8-1.5C17 6.2 19 8 19 10.6 19 15.4 12 20 12 20Z"/>',
  check: '<path d="M4.5 12.5 9.5 17.5 19.5 6.5"/>',
  cancelX: '<path d="M5 5 19 19"/><path d="M19 5 5 19"/>',
  layers: '<path d="M12 3 3 8l9 5 9-5Z"/><path d="m3 12 9 5 9-5"/><path d="m3 16 9 5 9-5"/>',
  landmark: '<path d="M4 21h16"/><path d="M5 21V10.5"/><path d="M19 21V10.5"/><path d="M3 10.5 12 4l9 6.5Z"/><path d="M8.5 10.5V21M12 10.5V21M15.5 10.5V21"/>',
  plusClinic: '<rect x="4" y="4" width="16" height="16" rx="2.4"/><path d="M12 8v8M8 12h8"/>',
  refresh: '<path d="M4 12a8 8 0 0 1 13.7-5.7L20 8.5"/><path d="M20 4v4.5h-4.5"/><path d="M20 12a8 8 0 0 1-13.7 5.7L4 15.5"/><path d="M4 20v-4.5h4.5"/>',
  scissors: '<circle cx="6.5" cy="6.5" r="2"/><circle cx="6.5" cy="17.5" r="2"/><path d="M8 8l11 8M8 16 19 8"/>',
  zoomIn: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M10.5 7.5v6M7.5 10.5h6"/><path d="m20 20-4.4-4.4"/>',
  zoomOut: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M7.5 10.5h6"/><path d="m20 20-4.4-4.4"/>',
  toggleEye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="2.6"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m20 20-4.4-4.4"/>',
  ruler: '<path d="M4 15.5 15.5 4l4.5 4.5L8.5 20Z"/><path d="m9.5 10.5 1.5 1.5"/><path d="m12 8 1.5 1.5"/><path d="m14.5 5.5 1.5 1.5"/>',
  square: '<rect x="4.5" y="4.5" width="15" height="15" rx="1.2"/>',
  rotate: '<path d="M4 12a8 8 0 1 1 2.3 5.6"/><path d="M4 20v-4.5h4.5"/>',
};

function gisIcon(name, cls) {
  const inner = GIS_ICON_PATHS[name];
  if (!inner) return "";
  return `<svg class="gis-icon${cls ? " " + cls : ""}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
}

// ───────── Category / type dictionaries ─────────
// Keys match the filter buttons already in index.html / pages/*.html.
// Buildings are tagged with a *type* (what kind of structure it is); when the
// type is a household, an optional *sub-category* records the vulnerable
// classification it belongs to. The plural "households" key is kept so
// existing CSS classes, filter values, and legend dots stay valid.
const GIS_BUILDING_TYPE_META = {
  government: { label: "Government Building", icon: "landmark", color: "#92400e" },
  business: { label: "Business", icon: "building", color: "#0891b2" },
  households: { label: "Household", icon: "home", color: "#1d4ed8" },
};

// Household classification — which priority group a tagged household belongs
// to. Optional on the tag form; also drives the classification map filter.
const GIS_HOUSEHOLD_SUBCAT_META = {
  seniors: { label: "Senior Citizen", icon: "senior", color: "#f59e0b" },
  pwd: { label: "PWD", icon: "wheelchair", color: "#8b5cf6" },
  "solo-parent": { label: "Solo Parent", icon: "family", color: "#db2777" },
  indigent: { label: "Indigent Family", icon: "heart", color: "#0d9488" },
};

const GIS_VEGETATION_KIND_META = {
  farmland: { label: "Farmland", icon: "wheat" },
  orchard: { label: "Orchard", icon: "orchard" },
  wood: { label: "Forest / Wood", icon: "tree" },
  meadow: { label: "Meadow", icon: "grass" },
  farmyard: { label: "Farmyard", icon: "barn" },
};

const GIS_HAZARD_TYPE_META = {
  flood: { label: "Flood Zone", icon: "waves", color: "#3b82f6" },
  landslide: { label: "Landslide Risk", icon: "mountain", color: "#b45309" },
  fire: { label: "Fire Risk", icon: "flame", color: "#ef4444" },
  other: { label: "Other Hazard", icon: "warningTriangle", color: "#eab308" },
};
// Radius (in local map units, out of the 0..1000 viewBox) of a hazard "ping" —
// scales naturally with zoom like any other area feature on the map.
const GIS_HAZARD_PING_RADIUS = 35;

const GIS_ACCIDENT_TYPE_META = {
  vehicular: { label: "Vehicular Accident", icon: "car" },
  fire: { label: "Fire Incident", icon: "flame" },
  medical: { label: "Medical Emergency", icon: "medical" },
  altercation: { label: "Physical Altercation", icon: "fist" },
  crime: { label: "Crime / Theft", icon: "siren" },
  other: { label: "Other Incident", icon: "alertCircle" },
};
// Icon font-size (local map units) for accident markers, divided by zoom at
// render time so the icon stays a constant, legible size on screen.
const GIS_ACCIDENT_ICON_SIZE = 42;

// Incident / concern reports — the single combined "blotter report" model
// (concern reporting and blotter reporting were merged). Pins are placed from
// the "File an Incident" modal's embedded map (see js/incident-report.js) and
// stored via gisAddCommunityReport; the same records drive the map pins, the
// GIS "Recent Community Reports" feed, and the Blotter page.
//
// `interpersonal: true` types involve another party, so the incident modal
// reveals the Respondent/Subject and Witness Names fields only for those.
const GIS_REPORT_TYPE_META = {
  noise: { label: "Noise Complaint", icon: "siren", interpersonal: false },
  dispute: { label: "Property Dispute", icon: "alertCircle", interpersonal: true },
  altercation: { label: "Physical Altercation", icon: "siren", interpersonal: true },
  theft: { label: "Theft / Robbery", icon: "siren", interpersonal: true },
  vandalism: { label: "Vandalism", icon: "alertCircle", interpersonal: false },
  domestic: { label: "Domestic Disturbance", icon: "siren", interpersonal: true },
  flooding: { label: "Flooding / Natural Hazard", icon: "waves", interpersonal: false },
  other: { label: "Other", icon: "alertCircle", interpersonal: false },
};
const GIS_REPORT_ICON_SIZE = 44;

// The map opens fitted so the barangay boundary nearly touches the container
// edges (GIS_FIT_MARGIN of the available space). That fitted view is also the
// hard limit: zooming out past it and panning beyond its edges are blocked
// (GIS_MIN_ZOOM_FACTOR of the fit zoom, plus the pan clamp in applyTransform),
// so the map stays anchored to the barangay and its immediate context.
const GIS_FIT_MARGIN = 0.97;
const GIS_MIN_ZOOM_FACTOR = 1;

const GIS_CONSTRUCTION_STATUS_META = {
  planned: { label: "Planned" },
  ongoing: { label: "Ongoing" },
  completed: { label: "Completed" },
};

// Three-tier road classification — OSM highway tags get mapped onto these
// same three so custom-drawn and imported roads share one visual language.
const GIS_ROAD_TYPE_META = {
  major: { label: "Major Road", color: "#64748b" },
  local: { label: "Local Road", color: "#94a3b8" },
  service: { label: "Service Road", color: "#cbd5e1" },
};

function gisRoadTypeForHighway(highway) {
  if (["tertiary", "secondary", "primary", "trunk", "motorway"].includes(highway)) return "major";
  if (highway === "service") return "service";
  return "local";
}

// ───────── Storage ─────────
const GIS_BUILDING_TAGS_KEY = "gis_building_tags";
const GIS_CUSTOM_BUILDINGS_KEY = "gis_custom_buildings";
const GIS_CUSTOM_ROADS_KEY = "gis_custom_roads";
const GIS_CUSTOM_VEGETATION_KEY = "gis_custom_vegetation";
const GIS_CUSTOM_CONSTRUCTION_KEY = "gis_custom_construction";
const GIS_HAZARD_ZONES_KEY = "gis_hazard_zones";
const GIS_ACCIDENTS_KEY = "gis_accidents";
const GIS_DELETED_BUILDINGS_KEY = "gis_deleted_buildings";
const GIS_ARCHIVED_BUILDINGS_KEY = "gis_archived_buildings";
const GIS_VEGETATION_CUTS_KEY = "gis_vegetation_cuts";
const GIS_COMMUNITY_REPORTS_KEY = "gis_community_reports";

const gisInstances = {};
let gisDefsCounter = 0;

function gisLoadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    return fallback;
  }
}

function gisSaveJSON(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function gisNewId(prefix) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}

// Building tags ({name, type, subcat, notes, groupId?}), keyed by building id
// (OSM way id or custom id). groupId links buildings tagged together via
// group tagging: hovering one highlights the rest, editing one updates all.
// Older saves used a single {category} field (households/seniors/pwd/4ps);
// normalize those into the type + sub-category shape wherever they surface —
// on every read, once as a write-back at init, and when restoring archived
// buildings whose snapshots predate the new shape.
function gisNormalizeBuildingTag(tag) {
  if (!tag || tag.type !== undefined) return tag;
  const cat = tag.category || "";
  const isSubcat = Object.prototype.hasOwnProperty.call(GIS_HOUSEHOLD_SUBCAT_META, cat);
  return {
    name: tag.name || "",
    type: cat ? "households" : "",
    subcat: isSubcat ? cat : "",
    notes: tag.notes || "",
  };
}

function gisMigrateBuildingTags() {
  const raw = gisLoadJSON(GIS_BUILDING_TAGS_KEY, {});
  let changed = false;
  Object.keys(raw).forEach((id) => {
    const normalized = gisNormalizeBuildingTag(raw[id]);
    if (normalized !== raw[id]) {
      raw[id] = normalized;
      changed = true;
    }
  });
  if (changed) gisSaveJSON(GIS_BUILDING_TAGS_KEY, raw);
}

// Display icon/label for a tag: the sub-category wins for the icon (a senior
// household reads better as the senior glyph), and the label spells out both,
// e.g. "Household · Senior Citizen".
function gisTagDisplayMeta(tag) {
  const typeMeta = tag?.type ? GIS_BUILDING_TYPE_META[tag.type] : null;
  const subMeta = tag?.subcat ? GIS_HOUSEHOLD_SUBCAT_META[tag.subcat] : null;
  if (!typeMeta) return null;
  return {
    icon: subMeta ? subMeta.icon : typeMeta.icon,
    label: subMeta ? `${typeMeta.label} · ${subMeta.label}` : typeMeta.label,
  };
}

function gisLoadBuildingTags() {
  const tags = gisLoadJSON(GIS_BUILDING_TAGS_KEY, {});
  Object.keys(tags).forEach((id) => {
    tags[id] = gisNormalizeBuildingTag(tags[id]);
  });
  return tags;
}
function gisSaveBuildingTag(buildingId, tag) {
  const tags = gisLoadBuildingTags();
  tags[buildingId] = tag;
  gisSaveJSON(GIS_BUILDING_TAGS_KEY, tags);
  gisPushBuildingTag(buildingId, tag);
}
function gisClearBuildingTag(buildingId) {
  const tags = gisLoadBuildingTags();
  delete tags[buildingId];
  gisSaveJSON(GIS_BUILDING_TAGS_KEY, tags);
  // Mirror the removal into the shared DB so the mobile app drops it too
  // (temp-id buildings never reached the DB, so there's nothing to remove).
  if (typeof apiDelete === "function" && gisIsServerId(buildingId))
    apiDelete("/api/gis/building-tags/" + encodeURIComponent(buildingId)).catch(() => {});
}

// ───────── Shared-DB sync layer ─────────
// Every map store below is mirrored into the API (PostGIS) so the web system
// (localhost + GitHub Pages) and the Flutter app all see ONE map. Writes are
// optimistic: localStorage updates immediately (instant UI + offline
// fallback), the API call rides along fire-and-forget, and a one-time sync at
// map init reconciles both directions.

// A server-issued id is numeric (map_feature rows) or 'c<n>' (custom
// buildings). Anything else is a browser temp id (gisNewId) that hasn't
// reached the DB yet.
function gisIsServerId(id) {
  return /^\d+$/.test(String(id)) || /^c\d+$/.test(String(id));
}

// Features deleted while their create-POST was still in flight: remember the
// temp id so the create can be undone when the server id arrives.
const gisPendingDeletes = new Set();

// Mirrors one tag into the shared DB (PUT /api/gis/building-tags/:key).
// Temp-id buildings are skipped — gisMigrateLocalId re-pushes the tag once
// the building's real id arrives. groupId is browser-side and not sent.
function gisPushBuildingTag(buildingId, tag) {
  if (typeof apiPut !== "function" || !tag) return;
  if (!gisIsServerId(buildingId)) return;
  apiPut("/api/gis/building-tags/" + encodeURIComponent(buildingId), {
    name: tag.name || "",
    type: tag.type || "",
    subcat: tag.subcat || "",
    notes: tag.notes || "",
  }).catch(() => {});
}

// Rewrites a temp local id to the server's id everywhere it can appear —
// the feature store itself, building tags, vegetation cuts and archive
// entries — then repaints every open map.
function gisMigrateLocalId(storeKey, oldId, newId, kind) {
  if (gisPendingDeletes.has(String(oldId))) {
    gisPendingDeletes.delete(String(oldId));
    if (typeof apiDelete === "function") {
      const path =
        kind === "building"
          ? "/api/gis/custom-buildings/" + newId
          : "/api/gis/features/" + newId;
      apiDelete(path).catch(() => {});
    }
    return;
  }
  const list = gisLoadJSON(storeKey, []);
  const entry = list.find((x) => String(x.id) === String(oldId));
  if (entry) {
    entry.id = newId;
    gisSaveJSON(storeKey, list);
  }
  const tags = gisLoadJSON(GIS_BUILDING_TAGS_KEY, {});
  if (tags[oldId]) {
    tags[newId] = tags[oldId];
    delete tags[oldId];
    gisSaveJSON(GIS_BUILDING_TAGS_KEY, tags);
    gisPushBuildingTag(newId, tags[newId]);
  }
  const cuts = gisLoadJSON(GIS_VEGETATION_CUTS_KEY, {});
  if (cuts[oldId]) {
    cuts[newId] = cuts[oldId];
    delete cuts[oldId];
    gisSaveJSON(GIS_VEGETATION_CUTS_KEY, cuts);
    gisPushVegetationCuts(newId, cuts[newId]);
  }
  const archived = gisLoadJSON(GIS_ARCHIVED_BUILDINGS_KEY, []);
  const archEntry = archived.find((a) => String(a.id) === String(oldId));
  if (archEntry) {
    archEntry.id = newId;
    gisSaveJSON(GIS_ARCHIVED_BUILDINGS_KEY, archived);
  }
  Object.values(gisInstances).forEach((inst) => {
    if (inst && typeof inst.refreshAll === "function") inst.refreshAll();
  });
}

// Mirrors a new map feature (road / vegetation / construction / hazard /
// accident) into the DB, then swaps the temp id for the server's.
function gisPushFeature(storeKey, localId, type, coordinates, properties) {
  if (typeof apiPost !== "function") return;
  apiPost("/api/gis/features", { type, coordinates, properties })
    .then((res) => gisMigrateLocalId(storeKey, localId, res.id, "feature"))
    .catch(() => {});
}

function gisPatchFeature(id, properties, coordinates) {
  if (typeof apiPatch !== "function" || !gisIsServerId(id)) return;
  const body = coordinates ? { properties, coordinates } : { properties };
  apiPatch("/api/gis/features/" + id, body).catch(() => {});
}

function gisDeleteFeatureRemote(id) {
  if (!gisIsServerId(id)) {
    gisPendingDeletes.add(String(id));
    return;
  }
  if (typeof apiDelete === "function")
    apiDelete("/api/gis/features/" + id).catch(() => {});
}

// Upserts a vegetation area's full cut list into osm_edit (edit_type 'cut',
// overrides {rings}). One row per vegetation id; each push replaces it.
function gisPushVegetationCuts(vegId, rings) {
  if (typeof apiPost !== "function" || !gisIsServerId(vegId)) return;
  apiPost("/api/gis/osm-edits", {
    osm_id: String(vegId),
    feature_kind: "vegetation",
    edit_type: "cut",
    overrides: { rings: rings || [] },
  }).catch(() => {});
}

// Reconciles one feature store with the server list: server rows become the
// local list (server = source of truth), local temp-id entries survive and
// get pushed up. fromServer maps a /state row to the local entry shape;
// toPush returns [coordinates, properties] for the POST.
function gisSyncFeatureList(storeKey, type, serverRows, fromServer, toPush) {
  const local = gisLoadJSON(storeKey, []);
  const server = (serverRows || []).map(fromServer);
  const unsynced = local.filter((e) => !gisIsServerId(e.id));
  gisSaveJSON(storeKey, server.concat(unsynced));
  unsynced.forEach((e) => {
    const pushed = toPush(e);
    gisPushFeature(storeKey, e.id, type, pushed[0], pushed[1]);
  });
}

// One-time full reconciliation with the shared DB (GET /api/gis/state):
// pulls every feature type, pushes anything that only exists in this
// browser's localStorage, and leaves localStorage holding the server state
// (so the app still renders something when the server is unreachable).
let gisStateSynced = false;
async function gisSyncMapState() {
  if (gisStateSynced || typeof apiGet !== "function") return;
  gisStateSynced = true;
  try {
    const state = await apiGet("/api/gis/state");

    // 1 — building tags (merge; local wins on conflict)
    const serverTags = (state && state.buildingTags) || {};
    const localTags = gisLoadBuildingTags();
    let tagsChanged = false;
    Object.keys(serverTags).forEach((id) => {
      if (!localTags[id]) {
        localTags[id] = gisNormalizeBuildingTag(serverTags[id]);
        tagsChanged = true;
      }
    });
    Object.keys(localTags).forEach((id) => {
      if (!serverTags[id]) gisPushBuildingTag(id, localTags[id]);
    });
    if (tagsChanged) gisSaveJSON(GIS_BUILDING_TAGS_KEY, localTags);

    // 2 — custom buildings ('c<id>' locally, matching their tag key)
    const localB = gisLoadJSON(GIS_CUSTOM_BUILDINGS_KEY, []);
    const serverB = (state.customBuildings || []).map((b) => ({
      id: "c" + b.id,
      coordinates: b.coordinates,
    }));
    const unsyncedB = localB.filter((b) => !gisIsServerId(b.id));
    gisSaveJSON(GIS_CUSTOM_BUILDINGS_KEY, serverB.concat(unsyncedB));
    unsyncedB.forEach((b) => {
      apiPost("/api/gis/custom-buildings", { coordinates: b.coordinates })
        .then((res) =>
          gisMigrateLocalId(GIS_CUSTOM_BUILDINGS_KEY, b.id, "c" + res.id, "building"),
        )
        .catch(() => {});
    });

    // 3 — staff-drawn features by type
    const f = state.features || {};
    gisSyncFeatureList(
      GIS_CUSTOM_ROADS_KEY, "road", f.road,
      (x) => ({ id: x.id, coordinates: x.coordinates, name: x.name || "", roadType: x.roadType || "local" }),
      (e) => [e.coordinates, { custom: true, name: e.name || "", roadType: e.roadType || "local" }],
    );
    gisSyncFeatureList(
      GIS_CUSTOM_VEGETATION_KEY, "vegetation", f.vegetation,
      (x) => ({ id: x.id, coordinates: x.coordinates[0], kind: x.kind || "", notes: x.notes || "" }),
      (e) => [[e.coordinates], { custom: true, kind: e.kind || "", notes: e.notes || "" }],
    );
    gisSyncFeatureList(
      GIS_CUSTOM_CONSTRUCTION_KEY, "construction", f.construction,
      (x) => ({ id: x.id, coordinates: x.coordinates[0], name: x.name || "", status: x.status || "planned", notes: x.notes || "" }),
      (e) => [[e.coordinates], { name: e.name || "", status: e.status || "planned", notes: e.notes || "" }],
    );
    gisSyncFeatureList(
      GIS_HAZARD_ZONES_KEY, "hazard", f.hazard,
      (x) => ({ id: x.id, point: x.coordinates, radius: x.radius || GIS_HAZARD_PING_RADIUS, hazardType: x.hazardType || "other", severity: x.severity || "", notes: x.notes || "" }),
      (e) => [e.point, { hazardType: e.hazardType || "other", severity: e.severity || "", notes: e.notes || "", radius: e.radius || GIS_HAZARD_PING_RADIUS }],
    );
    gisSyncFeatureList(
      GIS_ACCIDENTS_KEY, "accident", f.accident,
      (x) => ({ id: x.id, point: x.coordinates, incidentType: x.incidentType || "other", notes: x.notes || "" }),
      (e) => [e.point, { incidentType: e.incidentType || "other", notes: e.notes || "" }],
    );

    // 4 — tombstoned OSM buildings (osm_edit 'delete')
    const edits = state.osmEdits || [];
    const serverDeleted = edits
      .filter((e) => e.edit_type === "delete" && e.feature_kind === "building")
      .map((e) => String(e.osm_id));
    const localDeleted = gisLoadDeletedBuildings().map(String);
    localDeleted
      .filter((id) => !serverDeleted.includes(id))
      .forEach((id) => {
        apiPost("/api/gis/osm-edits", {
          osm_id: id,
          feature_kind: "building",
          edit_type: "delete",
        }).catch(() => {});
      });
    gisSaveJSON(
      GIS_DELETED_BUILDINGS_KEY,
      Array.from(new Set(serverDeleted.concat(localDeleted))),
    );

    // 5 — vegetation cuts (osm_edit 'cut', overrides {rings})
    const serverCuts = {};
    edits
      .filter((e) => e.edit_type === "cut" && e.feature_kind === "vegetation")
      .forEach((e) => {
        serverCuts[e.osm_id] = (e.overrides && e.overrides.rings) || [];
      });
    const localCuts = gisLoadJSON(GIS_VEGETATION_CUTS_KEY, {});
    Object.keys(localCuts).forEach((vegId) => {
      if (!serverCuts[vegId]) gisPushVegetationCuts(vegId, localCuts[vegId]);
    });
    gisSaveJSON(GIS_VEGETATION_CUTS_KEY, Object.assign({}, serverCuts, localCuts));

    // 6 — archived buildings (shared archive table)
    try {
      const serverArch = await apiGet("/api/gis/archive");
      const serverIds = new Set(serverArch.map((a) => String(a.id)));
      const localOnly = gisLoadJSON(GIS_ARCHIVED_BUILDINGS_KEY, []).filter(
        (a) => !serverIds.has(String(a.id)),
      );
      localOnly.forEach((a) => {
        apiPost("/api/gis/archive", a).catch(() => {});
      });
      gisSaveJSON(GIS_ARCHIVED_BUILDINGS_KEY, serverArch.concat(localOnly));
    } catch (e) {
      /* archive list stays local */
    }

    // 7 — community reports now come from /api/incidents
    await gisSyncCommunityReports();
  } catch (e) {
    gisStateSynced = false; // retry on the next map init
  }
}

// ── Custom-drawn features: merged with OSM-sourced features at render time ──
function gisCustomBuildingFeatures() {
  return gisLoadJSON(GIS_CUSTOM_BUILDINGS_KEY, []).map((b) => ({
    type: "Feature",
    properties: { id: b.id, custom: true },
    geometry: { type: "Polygon", coordinates: [b.coordinates] },
  }));
}
function gisAddCustomBuilding(ring) {
  const list = gisLoadJSON(GIS_CUSTOM_BUILDINGS_KEY, []);
  const id = gisNewId("bld");
  list.push({ id, coordinates: ring });
  gisSaveJSON(GIS_CUSTOM_BUILDINGS_KEY, list);
  // Mirror into the DB; the temp id becomes 'c<building_id>' when it lands.
  if (typeof apiPost === "function")
    apiPost("/api/gis/custom-buildings", { coordinates: ring })
      .then((res) => gisMigrateLocalId(GIS_CUSTOM_BUILDINGS_KEY, id, "c" + res.id, "building"))
      .catch(() => {});
  if (typeof logAudit === "function")
    logAudit("MAP_BUILDING_ADD", `New building outline drawn on map (${id})`, "info", "map");
  return id;
}
function gisDeleteCustomBuilding(id) {
  const list = gisLoadJSON(GIS_CUSTOM_BUILDINGS_KEY, []).filter((b) => b.id !== id);
  gisSaveJSON(GIS_CUSTOM_BUILDINGS_KEY, list);
  gisClearBuildingTag(id);
  if (!gisIsServerId(id)) {
    gisPendingDeletes.add(String(id));
  } else if (typeof apiDelete === "function") {
    apiDelete("/api/gis/custom-buildings/" + encodeURIComponent(id)).catch(() => {});
  }
}

// Pre-existing (OSM-sourced) buildings live in a static geojson file, so they
// can't be removed from the source data — instead we keep a tombstone list of
// their ids and filter them out at render time, same net effect as deleting.
function gisLoadDeletedBuildings() {
  return gisLoadJSON(GIS_DELETED_BUILDINGS_KEY, []);
}
function gisSoftDeleteBuilding(id) {
  const list = gisLoadDeletedBuildings();
  if (!list.includes(id)) list.push(id);
  gisSaveJSON(GIS_DELETED_BUILDINGS_KEY, list);
  gisClearBuildingTag(id);
  // Tombstone in the shared DB so every client hides this OSM building.
  if (typeof apiPost === "function")
    apiPost("/api/gis/osm-edits", {
      osm_id: String(id),
      feature_kind: "building",
      edit_type: "delete",
    }).catch(() => {});
}

// Deleted buildings land here instead of just vanishing, so they can be
// restored from the Archive module (see js/pages/archive.js) rather than a
// transient in-map "Undo" that disappears after a few seconds.
function gisLoadArchivedBuildings() {
  return gisLoadJSON(GIS_ARCHIVED_BUILDINGS_KEY, []);
}
function gisArchiveBuilding(entry) {
  const list = gisLoadArchivedBuildings();
  list.push({ ...entry, archivedAt: Date.now() });
  gisSaveJSON(GIS_ARCHIVED_BUILDINGS_KEY, list);
  // Snapshot into the shared archive table so the Archive page shows the
  // same recycle bin on every device.
  if (typeof apiPost === "function")
    apiPost("/api/gis/archive", entry).catch(() => {});
  if (typeof logAudit === "function")
    logAudit(
      "MAP_BUILDING_DELETE",
      `Building "${entry.tag?.name || "Untagged"}" (${entry.id}) deleted from map — moved to Archive`,
      "warning",
      "map",
    );
}
function gisRemoveArchivedBuilding(id) {
  gisSaveJSON(GIS_ARCHIVED_BUILDINGS_KEY, gisLoadArchivedBuildings().filter((b) => String(b.id) !== String(id)));
}
// Reverses a building's deletion using the snapshot captured at delete time —
// re-adds the custom building (or un-tombstones the OSM one) and restores its
// tag. Returns false if the archive entry is already gone.
function gisRestoreArchivedBuilding(id) {
  const entry = gisLoadArchivedBuildings().find((b) => String(b.id) === String(id));
  if (!entry) return false;
  if (entry.isCustom && entry.coordinates) {
    const list = gisLoadJSON(GIS_CUSTOM_BUILDINGS_KEY, []);
    list.push({ id: entry.id, coordinates: entry.coordinates });
    gisSaveJSON(GIS_CUSTOM_BUILDINGS_KEY, list);
    // A custom building that never reached the DB (temp id) is re-created
    // there now; synced ones are re-activated by the archive/restore call.
    if (!gisIsServerId(entry.id) && typeof apiPost === "function")
      apiPost("/api/gis/custom-buildings", { coordinates: entry.coordinates })
        .then((res) => gisMigrateLocalId(GIS_CUSTOM_BUILDINGS_KEY, entry.id, "c" + res.id, "building"))
        .catch(() => {});
  } else if (!entry.isCustom) {
    gisSaveJSON(GIS_DELETED_BUILDINGS_KEY, gisLoadDeletedBuildings().filter((did) => String(did) !== String(entry.id)));
  }
  // Server side: mark the snapshot restored, re-activate the building /
  // remove the tombstone, and put the tag back on the row.
  if (typeof apiPost === "function")
    apiPost("/api/gis/archive/restore", { id: String(entry.id) }).catch(() => {});
  if (entry.tag) gisSaveBuildingTag(entry.id, gisNormalizeBuildingTag(entry.tag));
  gisRemoveArchivedBuilding(entry.id);
  if (typeof logAudit === "function")
    logAudit(
      "ARCHIVE_BUILDING_RESTORE",
      `Building "${entry.tag?.name || "Untagged"}" (${entry.id}) restored to map from Archive`,
      "info",
      "archive",
    );
  return true;
}

function gisCustomRoadFeatures() {
  return gisLoadJSON(GIS_CUSTOM_ROADS_KEY, []).map((r) => ({
    type: "Feature",
    properties: { id: r.id, custom: true, name: r.name, roadType: r.roadType },
    geometry: { type: "LineString", coordinates: r.coordinates },
  }));
}
function gisAddCustomRoad(line, name, roadType) {
  const list = gisLoadJSON(GIS_CUSTOM_ROADS_KEY, []);
  const id = gisNewId("road");
  list.push({ id, coordinates: line, name, roadType });
  gisSaveJSON(GIS_CUSTOM_ROADS_KEY, list);
  gisPushFeature(GIS_CUSTOM_ROADS_KEY, id, "road", line, {
    custom: true,
    name: name || "",
    roadType: roadType || "local",
  });
  if (typeof logAudit === "function")
    logAudit("MAP_ROAD_ADD", `Road "${name || "Unnamed"}" (${roadType}) drawn on map`, "info", "map");
  return id;
}
function gisUpdateCustomRoad(id, name, roadType) {
  const list = gisLoadJSON(GIS_CUSTOM_ROADS_KEY, []);
  const road = list.find((r) => r.id === id);
  if (road) {
    road.name = name;
    road.roadType = roadType;
    gisSaveJSON(GIS_CUSTOM_ROADS_KEY, list);
    gisPatchFeature(id, { custom: true, name: name || "", roadType: roadType || "local" });
    if (typeof logAudit === "function")
      logAudit("MAP_ROAD_EDIT", `Road "${name || "Unnamed"}" (${roadType}) updated`, "info", "map");
  }
}
function gisDeleteCustomRoad(id) {
  const list = gisLoadJSON(GIS_CUSTOM_ROADS_KEY, []);
  const road = list.find((r) => r.id === id);
  gisSaveJSON(GIS_CUSTOM_ROADS_KEY, list.filter((r) => r.id !== id));
  gisDeleteFeatureRemote(id);
  if (typeof logAudit === "function")
    logAudit("MAP_ROAD_DELETE", `Road "${road?.name || id}" deleted from map`, "warning", "map");
}

function gisCustomVegetationFeatures() {
  return gisLoadJSON(GIS_CUSTOM_VEGETATION_KEY, []).map((v) => ({
    type: "Feature",
    properties: { id: v.id, custom: true, kind: v.kind, notes: v.notes },
    geometry: { type: "Polygon", coordinates: [v.coordinates] },
  }));
}
function gisAddCustomVegetation(ring, kind, notes) {
  const list = gisLoadJSON(GIS_CUSTOM_VEGETATION_KEY, []);
  const id = gisNewId("veg");
  list.push({ id, coordinates: ring, kind, notes });
  gisSaveJSON(GIS_CUSTOM_VEGETATION_KEY, list);
  gisPushFeature(GIS_CUSTOM_VEGETATION_KEY, id, "vegetation", [ring], {
    custom: true,
    kind: kind || "",
    notes: notes || "",
  });
  if (typeof logAudit === "function")
    logAudit("MAP_VEGETATION_ADD", `Vegetation area (${kind || "unspecified"}) drawn on map (${id})`, "info", "map");
  return id;
}
function gisUpdateCustomVegetation(id, kind, notes) {
  const list = gisLoadJSON(GIS_CUSTOM_VEGETATION_KEY, []);
  const v = list.find((x) => x.id === id);
  if (v) {
    v.kind = kind;
    v.notes = notes;
    gisSaveJSON(GIS_CUSTOM_VEGETATION_KEY, list);
    gisPatchFeature(id, { custom: true, kind: kind || "", notes: notes || "" });
    if (typeof logAudit === "function")
      logAudit("MAP_VEGETATION_EDIT", `Vegetation area ${id} updated (${kind || "unspecified"})`, "info", "map");
  }
}
function gisDeleteCustomVegetation(id) {
  gisSaveJSON(GIS_CUSTOM_VEGETATION_KEY, gisLoadJSON(GIS_CUSTOM_VEGETATION_KEY, []).filter((v) => v.id !== id));
  gisClearVegetationCuts(id);
  gisDeleteFeatureRemote(id);
  if (typeof logAudit === "function")
    logAudit("MAP_VEGETATION_DELETE", `Vegetation area ${id} deleted from map`, "warning", "map");
}

// Vegetation "cut" tool — trims a bite out of a vegetation area (custom-drawn
// or pre-existing/OSM alike) by storing the traced shape keyed by vegetation
// id. Rendered as an SVG <mask> on the vegetation path (see
// gisCreateMap/buildVegetationCutMask) rather than merged into the polygon's
// own rings — a mask can only ever hide pixels the path already paints, so a
// cut traced outside the vegetation's own outline has no effect instead of
// showing up as a brand new filled shape.
function gisLoadVegetationCuts() {
  return gisLoadJSON(GIS_VEGETATION_CUTS_KEY, {});
}
function gisAddVegetationCut(vegId, cutRing) {
  const cuts = gisLoadVegetationCuts();
  if (!cuts[vegId]) cuts[vegId] = [];
  cuts[vegId].push(cutRing);
  gisSaveJSON(GIS_VEGETATION_CUTS_KEY, cuts);
  gisPushVegetationCuts(vegId, cuts[vegId]);
  if (typeof logAudit === "function")
    logAudit("MAP_VEGETATION_TRIM", `Vegetation area ${vegId} trimmed (cut applied)`, "info", "map");
}
function gisClearVegetationCuts(vegId) {
  const cuts = gisLoadVegetationCuts();
  if (cuts[vegId]) {
    delete cuts[vegId];
    gisSaveJSON(GIS_VEGETATION_CUTS_KEY, cuts);
    if (typeof apiDelete === "function" && gisIsServerId(vegId))
      apiDelete(
        `/api/gis/osm-edits?osm_id=${encodeURIComponent(vegId)}&feature_kind=vegetation&edit_type=cut`,
      ).catch(() => {});
  }
}

function gisAllConstructionFeatures() {
  return gisLoadJSON(GIS_CUSTOM_CONSTRUCTION_KEY, []).map((c) => ({
    type: "Feature",
    properties: { id: c.id, name: c.name, status: c.status, notes: c.notes },
    geometry: { type: "Polygon", coordinates: [c.coordinates] },
  }));
}
function gisAddConstruction(ring, name, status, notes) {
  const list = gisLoadJSON(GIS_CUSTOM_CONSTRUCTION_KEY, []);
  const id = gisNewId("con");
  list.push({ id, coordinates: ring, name, status, notes });
  gisSaveJSON(GIS_CUSTOM_CONSTRUCTION_KEY, list);
  gisPushFeature(GIS_CUSTOM_CONSTRUCTION_KEY, id, "construction", [ring], {
    name: name || "",
    status: status || "planned",
    notes: notes || "",
  });
  if (typeof logAudit === "function")
    logAudit("MAP_CONSTRUCTION_ADD", `Construction area "${name || "Unnamed"}" (${status}) added to map`, "info", "map");
  return id;
}
function gisUpdateConstruction(id, name, status, notes) {
  const list = gisLoadJSON(GIS_CUSTOM_CONSTRUCTION_KEY, []);
  const c = list.find((x) => x.id === id);
  if (c) {
    Object.assign(c, { name, status, notes });
    gisSaveJSON(GIS_CUSTOM_CONSTRUCTION_KEY, list);
    gisPatchFeature(id, { name: name || "", status: status || "planned", notes: notes || "" });
    if (typeof logAudit === "function")
      logAudit("MAP_CONSTRUCTION_EDIT", `Construction area "${name || "Unnamed"}" updated (${status})`, "info", "map");
  }
}
function gisDeleteConstruction(id) {
  const list = gisLoadJSON(GIS_CUSTOM_CONSTRUCTION_KEY, []);
  const c = list.find((x) => x.id === id);
  gisSaveJSON(GIS_CUSTOM_CONSTRUCTION_KEY, list.filter((x) => x.id !== id));
  gisDeleteFeatureRemote(id);
  if (typeof logAudit === "function")
    logAudit("MAP_CONSTRUCTION_DELETE", `Construction area "${c?.name || id}" deleted from map`, "warning", "map");
}

// Hazard zones are ping-only (a general-area marker with an adjustable
// radius) — there is no polygon-boundary hazard drawing tool.
function gisAllHazardFeatures() {
  return gisLoadJSON(GIS_HAZARD_ZONES_KEY, []).map((h) => ({
    type: "Feature",
    properties: {
      id: h.id,
      hazardType: h.hazardType,
      severity: h.severity,
      notes: h.notes,
      radius: h.radius || GIS_HAZARD_PING_RADIUS,
    },
    geometry: { type: "Point", coordinates: h.point },
  }));
}
function gisAddHazardPing(point, radius, hazardType, severity, notes) {
  const list = gisLoadJSON(GIS_HAZARD_ZONES_KEY, []);
  const id = gisNewId("haz");
  list.push({ id, point, radius, hazardType, severity, notes });
  gisSaveJSON(GIS_HAZARD_ZONES_KEY, list);
  gisPushFeature(GIS_HAZARD_ZONES_KEY, id, "hazard", point, {
    hazardType: hazardType || "other",
    severity: severity || "",
    notes: notes || "",
    radius: radius || GIS_HAZARD_PING_RADIUS,
  });
  if (typeof logAudit === "function")
    logAudit(
      "MAP_HAZARD_ADD",
      `Hazard zone marked on map — ${hazardType || "unspecified"} (${severity || "unrated"} severity)`,
      severity === "critical" ? "critical" : "warning",
      "map",
    );
  return id;
}
function gisUpdateHazard(id, hazardType, severity, notes) {
  const list = gisLoadJSON(GIS_HAZARD_ZONES_KEY, []);
  const h = list.find((x) => x.id === id);
  if (h) {
    Object.assign(h, { hazardType, severity, notes });
    gisSaveJSON(GIS_HAZARD_ZONES_KEY, list);
    gisPatchFeature(id, {
      hazardType: hazardType || "other",
      severity: severity || "",
      notes: notes || "",
      radius: h.radius || GIS_HAZARD_PING_RADIUS,
    });
    if (typeof logAudit === "function")
      logAudit(
        "MAP_HAZARD_EDIT",
        `Hazard zone ${id} updated — ${hazardType || "unspecified"} (${severity || "unrated"} severity)`,
        severity === "critical" ? "critical" : "info",
        "map",
      );
  }
}
function gisDeleteHazard(id) {
  const list = gisLoadJSON(GIS_HAZARD_ZONES_KEY, []);
  const h = list.find((x) => x.id === id);
  gisSaveJSON(GIS_HAZARD_ZONES_KEY, list.filter((x) => x.id !== id));
  gisDeleteFeatureRemote(id);
  if (typeof logAudit === "function")
    logAudit("MAP_HAZARD_DELETE", `Hazard zone (${h?.hazardType || id}) removed from map`, "warning", "map");
}

// Accidents/incidents — point markers rendered as an icon per incident type.
function gisAllAccidentFeatures() {
  return gisLoadJSON(GIS_ACCIDENTS_KEY, []).map((a) => ({
    type: "Feature",
    properties: { id: a.id, incidentType: a.incidentType, notes: a.notes },
    geometry: { type: "Point", coordinates: a.point },
  }));
}
function gisAddAccident(point, incidentType, notes) {
  const list = gisLoadJSON(GIS_ACCIDENTS_KEY, []);
  const id = gisNewId("acc");
  list.push({ id, point, incidentType, notes });
  gisSaveJSON(GIS_ACCIDENTS_KEY, list);
  gisPushFeature(GIS_ACCIDENTS_KEY, id, "accident", point, {
    incidentType: incidentType || "other",
    notes: notes || "",
  });
  if (typeof logAudit === "function")
    logAudit("MAP_INCIDENT_ADD", `Accident/incident marker (${incidentType || "unspecified"}) placed on map`, "warning", "map");
  return id;
}
function gisUpdateAccident(id, incidentType, notes) {
  const list = gisLoadJSON(GIS_ACCIDENTS_KEY, []);
  const a = list.find((x) => x.id === id);
  if (a) {
    Object.assign(a, { incidentType, notes });
    gisSaveJSON(GIS_ACCIDENTS_KEY, list);
    gisPatchFeature(id, { incidentType: incidentType || "other", notes: notes || "" });
    if (typeof logAudit === "function")
      logAudit("MAP_INCIDENT_EDIT", `Accident/incident marker ${id} updated (${incidentType || "unspecified"})`, "info", "map");
  }
}
function gisDeleteAccident(id) {
  const list = gisLoadJSON(GIS_ACCIDENTS_KEY, []);
  const a = list.find((x) => x.id === id);
  gisSaveJSON(GIS_ACCIDENTS_KEY, list.filter((x) => x.id !== id));
  gisDeleteFeatureRemote(id);
  if (typeof logAudit === "function")
    logAudit("MAP_INCIDENT_DELETE", `Accident/incident marker (${a?.incidentType || id}) removed from map`, "warning", "map");
}

// Community reports — resident-submitted concern pins with reporter details.
//
// Single source of truth: the incident table (/api/incidents) — the same
// records the Blotter page and the mobile app use. An in-memory cache holds
// the rows in the legacy record shape every renderer already reads, and the
// old localStorage key is kept only as a last-known snapshot for offline.
let gisReportsCache = null;
let gisReportsFetchedAt = 0;

function gisReportFromIncident(row) {
  const name = row.complainant_name || "Resident";
  return {
    id: row.id,
    caseNo: row.case_no,
    point: [Number(row.lng), Number(row.lat)],
    reportType: row.report_type,
    title: row.title || GIS_REPORT_TYPE_META[row.report_type]?.label || "Incident",
    comment: row.narration || "",
    reporter: { name, initials: name.charAt(0).toUpperCase(), role: "Resident", purok: null },
    complainant: name,
    contact: row.contact || "",
    respondent: row.respondent || "",
    witnesses: row.witnesses || "",
    createdAt: Date.parse(row.created_at) || Date.now(),
    resolved: row.status === "resolved" || row.status === "dismissed",
    resolvedAt: row.resolved_at ? Date.parse(row.resolved_at) : null,
  };
}

function gisSaveReportsCache() {
  if (gisReportsCache) gisSaveJSON(GIS_COMMUNITY_REPORTS_KEY, gisReportsCache);
}

// Refreshes the cache from /api/incidents (throttled). Legacy local-only
// reports (temp 'rpt_*' ids from before reports lived in the DB) are pushed
// up once, then the server list wins. Re-renders the feed/blotter only when
// the data actually changed, so render → sync → render can't loop.
async function gisSyncCommunityReports() {
  if (typeof apiGet !== "function") return;
  if (Date.now() - gisReportsFetchedAt < 5000) return;
  gisReportsFetchedAt = Date.now();
  try {
    let rows = await apiGet("/api/incidents");

    // One-time migration: push reports that only exist in this browser.
    const known = new Set(rows.map((r) => r.case_no));
    const legacy = gisLoadJSON(GIS_COMMUNITY_REPORTS_KEY, []).filter(
      (r) => !gisIsServerId(r.id) && !known.has(r.caseNo),
    );
    if (legacy.length) {
      await Promise.all(
        legacy.map((r) =>
          apiPost("/api/incidents", {
            report_type: r.reportType || "other",
            title: r.title || "Incident",
            narration: r.comment || r.title || "—",
            complainant_name: r.complainant || r.reporter?.name || "Resident",
            contact: r.contact || null,
            respondent: r.respondent || null,
            witnesses: r.witnesses || null,
            lng: r.point?.[0],
            lat: r.point?.[1],
          }).catch(() => null),
        ),
      );
      rows = await apiGet("/api/incidents");
    }

    const fresh = rows.map(gisReportFromIncident);
    const changed = JSON.stringify(fresh) !== JSON.stringify(gisReportsCache);
    gisReportsCache = fresh;
    gisSaveReportsCache();
    if (changed) {
      if (typeof renderReportFeed === "function") renderReportFeed();
      if (window.CURRENT_PAGE === "incidents" && typeof renderPage === "function") renderPage();
      Object.values(gisInstances).forEach((inst) => {
        if (inst && typeof inst.refreshAll === "function") inst.refreshAll();
      });
    }
  } catch (e) {
    /* offline — keep the last snapshot */
  }
}

function gisAllCommunityReports() {
  if (gisReportsCache) return gisReportsCache;
  return gisLoadJSON(GIS_COMMUNITY_REPORTS_KEY, []);
}
function gisAllReportFeatures() {
  return gisAllCommunityReports().map((r) => ({
    type: "Feature",
    properties: {
      id: r.id,
      caseNo: r.caseNo || null,
      reportType: r.reportType,
      title: r.title,
      comment: r.comment,
      reporter: r.reporter,
      createdAt: r.createdAt,
      resolved: !!r.resolved,
      resolvedAt: r.resolvedAt || null,
    },
    geometry: { type: "Point", coordinates: r.point },
  }));
}
// Sequential blotter case number, e.g. "INC-2026-001". Numbering restarts each
// calendar year; the sequence is the count of reports already filed this year.
function gisNextCaseNo(existing) {
  const year = new Date().getFullYear();
  const soFar = existing.filter((r) => new Date(r.createdAt || 0).getFullYear() === year).length;
  return `INC-${year}-${String(soFar + 1).padStart(3, "0")}`;
}
// Files one combined incident/concern report. Beyond the map-pin fields
// (reportType/title/comment/reporter) it carries the blotter fields entered in
// the "File an Incident" modal: complainant, contact, and — for interpersonal
// incident types only — respondent and witnesses. The incident date/time is
// always "now" (createdAt), so the modal shows it read-only instead of asking.
function gisAddCommunityReport(point, data) {
  const list = gisAllCommunityReports();
  const record = {
    id: data.serverId || gisNewId("rpt"),
    // When the report was already filed to the API (the incident modal does
    // this itself), reuse the server's id + case number so the pin, the DB
    // row, and the app all agree.
    caseNo: data.caseNo || gisNextCaseNo(list),
    point,
    reportType: data.reportType,
    title: data.title,
    comment: data.comment || "",
    reporter: data.reporter || null,
    complainant: data.complainant || data.reporter?.name || "",
    contact: data.contact || "",
    respondent: data.respondent || "",
    witnesses: data.witnesses || "",
    createdAt: Date.now(),
    resolved: false,
    resolvedAt: null,
  };
  gisReportsCache = list.concat([record]);
  gisSaveReportsCache();
  // Not filed yet (the map's own report tool) → file it to the DB now, then
  // swap in the server id + case number.
  if (!data.caseNo && typeof apiPost === "function") {
    apiPost("/api/incidents", {
      report_type: record.reportType || "other",
      title: record.title || "Incident",
      narration: record.comment || record.title || "—",
      complainant_name: record.complainant || "Resident",
      contact: record.contact || null,
      respondent: record.respondent || null,
      witnesses: record.witnesses || null,
      lng: point[0],
      lat: point[1],
    })
      .then((res) => {
        record.id = res.id;
        record.caseNo = res.case_no;
        gisSaveReportsCache();
        if (typeof renderReportFeed === "function") renderReportFeed();
        Object.values(gisInstances).forEach((inst) => {
          if (inst && typeof inst.refreshAll === "function") inst.refreshAll();
        });
      })
      .catch(() => {});
  }
  if (typeof logAudit === "function")
    logAudit(
      "INCIDENT_FILE",
      `Incident/concern "${record.title}" (${GIS_REPORT_TYPE_META[record.reportType]?.label || record.reportType || "general"}) filed as ${record.caseNo}${record.complainant ? " by " + record.complainant : ""}`,
      "info",
      "concern",
    );
  return record;
}
function gisDeleteCommunityReport(id) {
  const record = gisAllCommunityReports().find((r) => String(r.id) === String(id));
  gisReportsCache = gisAllCommunityReports().filter((r) => String(r.id) !== String(id));
  gisSaveReportsCache();
  if (gisIsServerId(id) && typeof apiDelete === "function")
    apiDelete("/api/incidents/" + id).catch(() => {});
  if (typeof logAudit === "function")
    logAudit("CONCERN_DELETE", `Resident concern "${record?.title || id}" deleted`, "warning", "concern");
}
// Resolving a concern pin hides it from the map and the "Recent Community
// Reports" feed (which only shows active/unresolved pins) — it stays in the
// full history (View All modal) and can be reopened there. Global (not
// module-scoped) so the MIS page's feed/history modal can call it directly.
function gisSetCommunityReportResolved(id, resolved) {
  const list = gisAllCommunityReports();
  const record = list.find((r) => String(r.id) === String(id));
  if (!record) return;
  record.resolved = !!resolved;
  record.resolvedAt = resolved ? Date.now() : null;
  gisReportsCache = list;
  gisSaveReportsCache();
  // Same status transition the MIS blotter page and the app use.
  if (gisIsServerId(id) && typeof apiPatch === "function")
    apiPatch("/api/incidents/" + id, { status: resolved ? "resolved" : "open" }).catch(() => {});
  if (typeof logAudit === "function")
    logAudit(
      resolved ? "CONCERN_RESOLVE" : "CONCERN_REOPEN",
      `Resident concern "${record.title}" marked as ${resolved ? "resolved" : "reopened"}`,
      "info",
      "concern",
    );
}
// Permanently drops every resolved concern (the "Clear Resolved" action in
// the history modal) — including their DB rows. Active reports are
// untouched. Returns the number removed. Irreversible — callers confirm
// first; the DB audit trigger keeps each deleted row's snapshot.
function gisClearResolvedCommunityReports() {
  const list = gisAllCommunityReports();
  const kept = list.filter((r) => !r.resolved);
  const removed = list.length - kept.length;
  if (typeof apiDelete === "function")
    list
      .filter((r) => r.resolved && gisIsServerId(r.id))
      .forEach((r) => apiDelete("/api/incidents/" + r.id).catch(() => {}));
  gisReportsCache = kept;
  gisSaveReportsCache();
  if (removed > 0 && typeof logAudit === "function")
    logAudit("CONCERN_PURGE", `${removed} resolved resident concern${removed === 1 ? "" : "s"} permanently cleared`, "warning", "concern");
  return removed;
}

// Compact relative timestamp for report cards/feeds ("5m ago", "2d ago"...).
function gisTimeAgo(ts) {
  if (!ts) return "";
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// ───────── Projection helpers ─────────
// Great-circle distance in meters — used by the measurement tool.
function gisHaversineMeters([lng1, lat1], [lng2, lat2]) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Compact single-unit form (used for the on-map label).
function gisFormatDistance(meters) {
  return meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(2)} km`;
}

// Full multi-unit breakdown (used by the measure hint, which renders each
// unit as its own chip).
function gisFormatDistanceParts(meters) {
  const m = Math.round(meters);
  const km = (meters / 1000).toFixed(2);
  const ft = Math.round(meters * 3.28084);
  const mi = (meters / 1609.344).toFixed(2);
  const yd = Math.round(meters * 1.09361);
  return [`${m} m`, `${km} km`, `${ft} ft`, `${yd} yd`, `${mi} mi`];
}

// Equirectangular projection of lon/lat into a 0..1000 x 0..1000 SVG box,
// preserving aspect ratio based on the boundary's bounding box.
function gisBuildProjector(bbox) {
  const [minLng, minLat, maxLng, maxLat] = bbox;
  const lngSpan = maxLng - minLng || 0.001;
  const latSpan = maxLat - minLat || 0.001;
  const padding = 0.12; // fractional padding around the shape
  const vbSize = 1000;
  const usable = vbSize * (1 - padding * 2);

  // Correct for latitude distortion so the shape isn't stretched
  const midLat = (minLat + maxLat) / 2;
  const lngScale = Math.cos((midLat * Math.PI) / 180);
  const adjustedLngSpan = lngSpan * lngScale;
  const scale = usable / Math.max(adjustedLngSpan, latSpan);

  const drawWidth = adjustedLngSpan * scale;
  const drawHeight = latSpan * scale;
  const offsetX = (vbSize - drawWidth) / 2;
  const offsetY = (vbSize - drawHeight) / 2;

  function project(lng, lat) {
    const x = offsetX + (lng - minLng) * lngScale * scale;
    const y = offsetY + (maxLat - lat) * scale; // flip Y (north = up)
    return [x, y];
  }

  project.invert = function ([x, y]) {
    const lng = (x - offsetX) / (lngScale * scale) + minLng;
    const lat = maxLat - (y - offsetY) / scale;
    return [lng, lat];
  };

  return project;
}

function gisComputeBBox(geojson) {
  let minLng = Infinity,
    minLat = Infinity,
    maxLng = -Infinity,
    maxLat = -Infinity;

  function walk(coords) {
    if (typeof coords[0] === "number") {
      const [lng, lat] = coords;
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    } else {
      coords.forEach(walk);
    }
  }

  geojson.features.forEach((f) => walk(f.geometry.coordinates));
  return [minLng, minLat, maxLng, maxLat];
}

// Ray-casting point-in-polygon test against a single linear ring
// ([lng,lat] pairs). Used to tell barangay features from the buffered
// surroundings the extractor now includes past the border.
function gisPointInRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

// Outer ring (or line) of a geometry, for the inside/outside test.
function gisGeometryOuterRing(geometry) {
  return geometry.type === "Polygon"
    ? geometry.coordinates[0]
    : geometry.type === "LineString"
      ? geometry.coordinates
      : geometry.coordinates[0]?.[0] || [];
}

function gisPolygonToPath(coordinates, project) {
  // coordinates: array of linear rings (first = outer, rest = holes)
  return coordinates
    .map((ring) => {
      const pts = ring.map(([lng, lat]) => project(lng, lat));
      return "M" + pts.map((p) => p.join(",")).join("L") + "Z";
    })
    .join(" ");
}

function gisLineToPath(coordinates, project) {
  const pts = coordinates.map(([lng, lat]) => project(lng, lat));
  return "M" + pts.map((p) => p.join(",")).join("L");
}

function gisGeometryToPath(geometry, project) {
  if (geometry.type === "Polygon") {
    return gisPolygonToPath(geometry.coordinates, project);
  }
  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates
      .map((poly) => gisPolygonToPath(poly, project))
      .join(" ");
  }
  if (geometry.type === "LineString") {
    return gisLineToPath(geometry.coordinates, project);
  }
  if (geometry.type === "MultiLineString") {
    return geometry.coordinates
      .map((line) => gisLineToPath(line, project))
      .join(" ");
  }
  return "";
}

// Caps max zoom to the scale of the map's own features (buildings), rather
// than an arbitrary constant — so "fully zoomed in" lands on individual
// building footprints instead of empty over-magnified space either way.
function gisComputeMaxZoom(buildingsGeojson, project) {
  const DEFAULT_MAX = 8;
  const TARGET_SIZE = 70; // desired on-screen size (SVG units) of a typical building at max zoom
  if (!buildingsGeojson || !buildingsGeojson.features?.length) return DEFAULT_MAX;

  const sizes = buildingsGeojson.features
    .map((f) => {
      const ring = f.geometry?.coordinates?.[0];
      if (!ring) return null;
      const pts = ring.map(([lng, lat]) => project(lng, lat));
      const xs = pts.map((p) => p[0]);
      const ys = pts.map((p) => p[1]);
      return Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    })
    .filter((s) => s && s > 0)
    .sort((a, b) => a - b);

  if (!sizes.length) return DEFAULT_MAX;

  const median = sizes[Math.floor(sizes.length / 2)];
  const computed = TARGET_SIZE / median;
  return Math.min(Math.max(computed, 4), 40);
}

// ───────── Main init ─────────
async function initGisMap(targetId, opts = {}) {
  const container = document.getElementById(targetId);
  if (!container) return;

  // One-time write-back of any old-shape {category} building tags.
  gisMigrateBuildingTags();

  // Reconcile the whole map state with the shared DB (pull server features /
  // push local-only ones), then repaint so merged data shows without a reload.
  gisSyncMapState().then(() => {
    if (gisInstances[targetId] && typeof gisInstances[targetId].refreshAll === "function")
      gisInstances[targetId].refreshAll();
  });

  // Always recenter to the fitted view when a map is (re)opened, even if an
  // instance is already cached (e.g. reopening the "Open Full Map" modal).
  if (gisInstances[targetId]) {
    gisInstances[targetId].resetView();
    gisInstances[targetId].refreshAll();
    return gisInstances[targetId];
  }

  const geojson = await gisFetchBaseLayer("boundary", GIS_BOUNDARY_URL, "boundary");
  if (!geojson) {
    container.innerHTML =
      '<div class="gis-load-error">Unable to load map boundary data.</div>';
    console.error("[gis-map] failed to load boundary geojson");
    return;
  }

  const [buildingsGeojson, roadsGeojson, waterGeojson, vegetationGeojson] = await Promise.all([
    gisFetchBaseLayer("buildings", GIS_BUILDINGS_URL, "buildings"),
    gisFetchBaseLayer("roads", GIS_ROADS_URL, "roads"),
    gisFetchBaseLayer("water", GIS_WATER_URL, "water"),
    gisFetchBaseLayer("vegetation", GIS_VEGETATION_URL, "vegetation"),
  ]);

  const bbox = gisComputeBBox(geojson);
  const project = gisBuildProjector(bbox);
  const maxZoom = gisComputeMaxZoom(buildingsGeojson, project);

  const instance = gisCreateMap(
    container,
    geojson,
    { buildingsGeojson, roadsGeojson, waterGeojson, vegetationGeojson },
    project,
    maxZoom,
    opts,
  );
  gisInstances[targetId] = instance;
  return instance;
}

function gisCreateMap(container, geojson, layers, project, maxZoom, opts) {
  const { buildingsGeojson, roadsGeojson, waterGeojson, vegetationGeojson } = layers;
  // Editing (Edit Mode, draw/ping tools, tagging, delete, cut) is a staff-only
  // MIS capability — public/resident-facing embeds of this same map component
  // must never get the button that unlocks it. Opt in per initGisMap() call.
  const editable = !!opts.editable;

  // Anonymous embeds (the public landing-page map) keep tagged households
  // private: no household names, no vulnerable-classification tag/filter/color,
  // and no reporter names on community-concern pins — only the generic
  // "Household" type tag survives. Opt in per initGisMap() call.
  const anonymous = !!opts.anonymous;

  // Minimal embeds (the "File an Incident / Concern" modal's pick-a-location
  // map) drop the layer-toggle/filter controls and the legend overlay so the
  // map itself gets the full width — the resident only needs to drop a pin.
  const minimal = !!opts.minimal;

  // The extractor includes surroundings a few hundred meters past the border
  // for context. A feature counts as part of the barangay if ANY part of it
  // touches the boundary — only features entirely outside render faded and
  // non-interactive, and stay out of stats and filters. Staff-drawn (custom)
  // features always count as inside so they stay editable.
  const boundaryRing = geojson.features[0].geometry.coordinates[0];
  const insideCache = new Map();
  function featureInsideBoundary(feature) {
    if (feature.properties.custom) return true;
    const id = feature.properties.id;
    if (insideCache.has(id)) return insideCache.get(id);
    const ring = gisGeometryOuterRing(feature.geometry);
    // Any feature vertex inside the boundary…
    let inside = ring.some((pt) => gisPointInRing(pt, boundaryRing));
    // …or, for a shape straddling the border with no vertex inside, any
    // boundary vertex inside the feature's own polygon.
    if (!inside && feature.geometry.type === "Polygon") {
      inside = boundaryRing.some((pt) => gisPointInRing(pt, ring));
    }
    insideCache.set(id, inside);
    return inside;
  }

  const state = {
    typeFilter: "all", // building-type filter (government/business/households)
    sectorFilter: "all", // household-classification filter (seniors/pwd/…)
    showBuildings: true,
    showRoads: true,
    showWater: true,
    showVegetation: true,
    showHazard: true,
    showConstruction: true,
    showAccidents: true,
    showReports: true,
    reportMode: false, // resident "place a community report" one-shot mode
    pendingReporter: null, // reporter details captured when report mode was armed
    pickMode: false, // lightweight "pick a location" mode for the incident modal's embedded map
    pickCallback: null, // called with [lng, lat] each time a spot is picked
    pickPoint: null, // the currently-picked [lng, lat], drawn as a marker
    editMode: false,
    drawTool: null, // null | 'building' | 'road' | 'vegetation' | 'construction' | 'hazard-ping' | 'accident-ping' | 'vegetation-cut'
    drawSubtype: null, // the specific type picked in the draw panel (e.g. 'flood' for a hazard ping)
    drawShape: "freeform", // 'freeform' | 'square' — how area tools (building/vegetation/construction) trace their outline
    squareRotation: 0, // radians the square preview is rotated by before it's confirmed
    squareHover: null, // [lng, lat] live opposite corner while the second click is still pending
    drawPoints: [],
    pingCenter: null, // { lng, lat, localX, localY } while mid-sizing a hazard ping
    pingRadius: 0,
    cutTargetVegId: null, // vegetation id being trimmed while drawTool === 'vegetation-cut'
    groupSelect: false, // multi-select mode: building clicks toggle membership instead of opening the popup
    groupSelection: new Set(), // building ids (as strings) picked while groupSelect is on
    groupEditId: null, // when re-opening an existing group: its groupId, so saving keeps the same group
    groupSeedTag: null, // the existing group's tag, to prefill the form when editing membership
    zoom: 1,
    panX: 0,
    panY: 0,
  };

  const MIN_POINTS = { building: 3, road: 2, vegetation: 3, construction: 3, "vegetation-cut": 3, measure: 1 };
  // Area tools that can also be traced as a rotatable box instead of a freeform
  // polygon (the "Square" shape option). Lines (road) and points (pings) can't.
  const SQUARE_TOOLS = new Set(["building", "vegetation", "construction"]);
  const DRAW_HINTS = {
    building: "Click to place points. Drag a point to move it, click a point to remove it, or drag inside the shape to move it. Use Finish when done.",
    road: "Click to place points. Drag a point to move it, or click a point to remove it. Use Finish when done.",
    vegetation: "Click to place points. Drag a point to move it, click a point to remove it, or drag inside the shape to move it. Use Finish when done.",
    construction: "Click to place points. Drag a point to move it, click a point to remove it, or drag inside the shape to move it. Use Finish when done.",
    "hazard-ping": "Click to set the center, move to size it, click again to confirm.",
    "accident-ping": "Click the map once to mark an accident.",
    "vegetation-cut": "Trace the area to remove from this vegetation zone, then Finish.",
    measure: "Click to add a point. Drag a point to move it, click a point to remove it, or drag the map to pan.",
    square: "Click two opposite corners. Drag a corner to resize, the handle to rotate, or inside to move, then Finish.",
  };
  const isSquareMode = () => state.drawShape === "square" && SQUARE_TOOLS.has(state.drawTool);

  const defsId = "gis-defs-" + gisDefsCounter++;
  const hazardGradientDefs = Object.entries(GIS_HAZARD_TYPE_META)
    .map(
      ([key, meta]) => `
    <radialGradient id="${defsId}-grad-${key}" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="${meta.color}" stop-opacity="0.55"/>
      <stop offset="65%" stop-color="${meta.color}" stop-opacity="0.25"/>
      <stop offset="100%" stop-color="${meta.color}" stop-opacity="0"/>
    </radialGradient>`,
    )
    .join("");
  const constructionStripeDef = `
    <pattern id="${defsId}-construction-stripe" width="5" height="5" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
      <rect width="5" height="5" fill="#111"/>
      <rect width="2.5" height="5" fill="#facc15"/>
    </pattern>`;

  // The filter row's three dropdowns — Building Type, Household
  // Classification, and Map Layers — all share the same button-plus-panel
  // design and are injected into the host page's `.gis-filter-row`
  // (immediately before the map container) when one is present. Falls back
  // to the map's own toolbar if a host page doesn't provide a filter row.
  const choiceDropdownHtml = (kind, defaultLabel, iconName, allLabel, meta) => `
    <div class="gis-elements-dropdown gis-choice-dropdown" data-gis-choice="${kind}">
      <button type="button" class="gis-elements-btn" title="Filter buildings by ${defaultLabel.toLowerCase()}">${gisIcon(iconName)} <span data-gis-choice-label>${defaultLabel}</span> <span class="gis-elements-caret">▾</span></button>
      <div class="gis-elements-panel" hidden>
        <button type="button" class="gis-filter-btn gis-choice-option active" data-value="all">${gisIcon("layers")} ${allLabel}</button>
        ${Object.entries(meta)
          .map(
            ([key, m]) =>
              `<button type="button" class="gis-filter-btn gis-choice-option" data-value="${key}">${gisIcon(m.icon)} ${m.label}</button>`,
          )
          .join("")}
      </div>
    </div>
  `;
  const typeFilterHtml = choiceDropdownHtml(
    "type", "Building Type", "building", "All Building Types", GIS_BUILDING_TYPE_META,
  );
  const sectorFilterHtml = choiceDropdownHtml(
    "sector", "Classification", "home", "All Classifications", GIS_HOUSEHOLD_SUBCAT_META,
  );

  const layerToggleButtonsHtml = `
    <div class="gis-elements-dropdown" data-gis-elements-dropdown>
      <button type="button" class="gis-elements-btn" data-gis-elements-open title="Choose which layers are visible on the map">${gisIcon("layers")} Map Layers <span class="gis-elements-caret">▾</span></button>
      <div class="gis-elements-panel" data-gis-elements-panel hidden>
        <button type="button" class="gis-filter-btn gis-layer-toggle active" data-gis-vegetation-toggle title="Toggle grass/farmland/forest">${gisIcon("wheat")} Vegetation</button>
        <button type="button" class="gis-filter-btn gis-layer-toggle active" data-gis-water-toggle title="Toggle rivers/water">${gisIcon("droplet")} Water</button>
        <button type="button" class="gis-filter-btn gis-layer-toggle active" data-gis-roads-toggle title="Toggle roads">${gisIcon("road")} Roads</button>
        <button type="button" class="gis-filter-btn gis-layer-toggle active" data-gis-buildings-toggle title="Toggle building outlines">${gisIcon("building")} Buildings</button>
        <button type="button" class="gis-filter-btn gis-layer-toggle active" data-gis-hazard-toggle title="Toggle hazard zones">${gisIcon("warningTriangle")} Hazard</button>
        <button type="button" class="gis-filter-btn gis-layer-toggle active" data-gis-construction-toggle title="Toggle construction areas">${gisIcon("cone")} Construction</button>
        <button type="button" class="gis-filter-btn gis-layer-toggle active" data-gis-accidents-toggle title="Toggle accident/incident markers">${gisIcon("siren")} Accidents</button>
        <button type="button" class="gis-filter-btn gis-layer-toggle active" data-gis-reports-toggle title="Toggle community report pins">${gisIcon("pin")} Reports</button>
      </div>
    </div>
  `;

  // Household search — looks up tagged buildings by name and pans/zooms to
  // the match. Available on every embed (not just editable ones); mounted
  // alongside the layer toggles since both live in the host's filter row.
  const searchHtml = `
    <div class="gis-search-wrap" data-gis-search-wrap>
      ${gisIcon("search", "gis-search-icon")}
      <input type="text" class="gis-search-input" data-gis-search-input placeholder="Search tagged household…" autocomplete="off" />
      <div class="gis-search-results" data-gis-search-results hidden></div>
    </div>
  `;

  // Edit controls sit inline with the zoom buttons; the drawing tools live
  // in a panel that pops up from the map's bottom-right corner while Edit
  // Mode is on. Each element expands into its specific types (a hazard ping
  // is picked as Flood/Landslide/…, a road as Major/Local/…), so the pin
  // form afterwards never needs a type selector.
  const editControlsHtml = editable
    ? `
      <button type="button" class="gis-toolbar-btn gis-deselect-btn" data-gis-deselect-tool title="Deselect current tool (Esc)" hidden>${gisIcon("cancelX")} Deselect</button>
      <button type="button" class="gis-toolbar-btn gis-edit-toggle-btn" data-gis-edit-toggle title="Toggle map editing">${gisIcon("edit")} Edit Mode</button>`
    : "";

  const drawGroups = [
    // "none" draws a plain footprint and skips the tag form entirely — it's a
    // draw-panel-only option, deliberately absent from GIS_BUILDING_TYPE_META
    // so it never shows up in filters, legends, or the tag form.
    {
      tool: "building",
      label: "Building",
      icon: "building",
      types: { ...GIS_BUILDING_TYPE_META, none: { label: "No Tag (outline only)", icon: "building" } },
    },
    { tool: "road", label: "Road", icon: "road", types: GIS_ROAD_TYPE_META },
    { tool: "vegetation", label: "Vegetation", icon: "wheat", types: GIS_VEGETATION_KIND_META },
    { tool: "construction", label: "Construction", icon: "cone", types: GIS_CONSTRUCTION_STATUS_META },
    { tool: "hazard-ping", label: "Hazard Ping", icon: "warningTriangle", types: GIS_HAZARD_TYPE_META },
    { tool: "accident-ping", label: "Accident Ping", icon: "siren", types: GIS_ACCIDENT_TYPE_META },
    { tool: "measure", label: "Measure Distance", icon: "ruler", types: null },
  ];
  const drawPanelHtml = editable
    ? `
      <div class="gis-draw-dock" data-gis-draw-panel hidden>
        <div class="gis-draw-dock-col gis-draw-dock-side">
          <div class="gis-draw-panel gis-draw-actions-panel" data-gis-actions-panel hidden>
            <button type="button" class="gis-draw-action-btn gis-draw-finish" data-gis-draw-finish hidden>${gisIcon("check")} Finish</button>
            <button type="button" class="gis-draw-action-btn gis-draw-cancel" data-gis-draw-cancel hidden>${gisIcon("cancelX")} Cancel</button>
          </div>
          <div class="gis-draw-panel gis-draw-shape-panel" data-gis-shape-panel hidden>
            <div class="gis-draw-panel-title">${gisIcon("square")} Shape</div>
            <div class="gis-draw-shape-opts">
              <button type="button" class="gis-draw-shape-btn" data-gis-shape="freeform">${gisIcon("edit")} Freeform</button>
              <button type="button" class="gis-draw-shape-btn" data-gis-shape="square">${gisIcon("square")} Square</button>
            </div>
          </div>
          <div class="gis-draw-panel gis-draw-types-panel" data-gis-types-panel hidden>
            <div class="gis-draw-panel-title" data-gis-types-title></div>
            <div class="gis-draw-types" data-gis-types-list></div>
          </div>
        </div>
        <div class="gis-draw-dock-col">
          <div class="gis-draw-panel gis-draw-hint" hidden></div>
          <div class="gis-draw-panel gis-draw-main-panel">
            <div class="gis-draw-panel-title">${gisIcon("edit")} Add to Map</div>
            ${drawGroups
              .map((g) => {
                if (!g.types) {
                  return `<button type="button" class="gis-draw-btn" data-gis-draw-tool="${g.tool}">${gisIcon(g.icon)} ${g.label}</button>`;
                }
                return `<button type="button" class="gis-draw-btn" data-gis-draw-group="${g.tool}">${gisIcon(g.icon)} ${g.label} <span class="gis-elements-caret">◂</span></button>`;
              })
              .join("")}
          </div>
        </div>
      </div>`
    : "";

  container.classList.add("gis-custom-map");
  container.innerHTML = `
    <div class="gis-map-toolbar">
      <div class="gis-toolbar-row">
        <button type="button" class="gis-zoom-btn" data-gis-zoom="in" title="Zoom in">${gisIcon("zoomIn")}</button>
        <button type="button" class="gis-zoom-btn" data-gis-zoom="out" title="Zoom out">${gisIcon("zoomOut")}</button>
        <button type="button" class="gis-zoom-btn" data-gis-zoom="reset" title="Reset view">${gisIcon("refresh")}</button>
        ${editControlsHtml}
      </div>
    </div>
    <div class="gis-svg-wrap">
      <svg class="gis-svg" viewBox="0 0 1000 1000" preserveAspectRatio="xMidYMid meet">
        <defs>${hazardGradientDefs}${constructionStripeDef}</defs>
        <g class="gis-svg-viewport">
          <path class="gis-boundary" d="${gisGeometryToPath(geojson.features[0].geometry, project)}"></path>
          <g class="gis-vegetation-layer"></g>
          <g class="gis-water-layer"></g>
          <g class="gis-hazard-layer"></g>
          <g class="gis-construction-layer"></g>
          <g class="gis-roads-layer"></g>
          <g class="gis-buildings-layer"></g>
          <g class="gis-accidents-layer"></g>
          <g class="gis-reports-layer"></g>
          <g class="gis-draw-preview-layer"></g>
        </g>
      </svg>
      <div class="gis-popup" hidden></div>
      <div class="gis-pin-form" hidden></div>
      <div class="gis-report-hint" hidden></div>
      ${editable ? `
      <div class="gis-group-dock" data-gis-group-dock hidden>
        <span class="gis-group-dock-count" data-gis-group-count></span>
        <button type="button" class="btn btn-sm btn-gold" data-gis-group-tag>${gisIcon("layers")} Tag Group</button>
        <button type="button" class="btn btn-sm btn-outline" data-gis-group-cancel>Cancel</button>
      </div>` : ""}
      ${drawPanelHtml}
    </div>
  `;

  // Anonymous embeds drop the household-classification filter and the
  // by-name household search (both would expose private resident info).
  const sectorFilterMarkup = anonymous ? "" : sectorFilterHtml;
  const searchMarkup = anonymous ? "" : searchHtml;

  const filterRowEl =
    container.previousElementSibling && container.previousElementSibling.classList.contains("gis-filter-row")
      ? container.previousElementSibling
      : null;
  if (filterRowEl) {
    filterRowEl.insertAdjacentHTML(
      "beforeend",
      layerToggleButtonsHtml + typeFilterHtml + sectorFilterMarkup + searchMarkup,
    );
  } else {
    container
      .querySelector(".gis-map-toolbar")
      .insertAdjacentHTML(
        "afterbegin",
        `<div class="gis-toolbar-row gis-toolbar-row-wrap">${layerToggleButtonsHtml}${typeFilterHtml}${sectorFilterMarkup}</div>${searchMarkup}`,
      );
  }
  const toggleButtonsHost = filterRowEl || container;
  // Minimal embeds keep the controls in the DOM (the engine wires them) but
  // hide the filter row and legend via CSS so the map fills the width.
  if (minimal) container.classList.add("gis-minimal");

  // Legend — generated by the engine as a translucent overlay in the map's
  // bottom-left corner, one column per filter dropdown in the same order
  // (Map Layers / Building Type / Classification), so it can never drift
  // from the meta dictionaries. Any legacy sibling legend markup is removed.
  if (
    container.nextElementSibling &&
    container.nextElementSibling.classList.contains("gis-legend")
  ) {
    container.nextElementSibling.remove();
  }
  const legendItemHtml = (dotKey, label, layer) =>
    `<div class="gis-legend-item"${layer ? ` data-legend-layer="${layer}"` : ""}><div class="gis-dot gis-dot-${dotKey}"></div>${label}</div>`;
  const legendColumnHtml = (title, itemsHtml) =>
    `<div class="gis-legend-col"><div class="gis-legend-col-title">${title}</div>${itemsHtml}</div>`;
  const legendHtml = `<div class="gis-legend gis-legend-overlay">
    ${legendColumnHtml(
      "Map Layers",
      [
        legendItemHtml("vegetation", "Vegetation", "vegetation"),
        legendItemHtml("water", "Water", "water"),
        legendItemHtml("roads", "Roads", "roads"),
        legendItemHtml("hazard", "Hazard Zone", "hazard"),
        legendItemHtml("construction", "Construction Area", "construction"),
        legendItemHtml("accidents", "Accidents", "accidents"),
        legendItemHtml("reports", "Community Reports", "reports"),
      ].join(""),
    )}
    ${legendColumnHtml(
      "Building Type",
      Object.entries(GIS_BUILDING_TYPE_META)
        .map(([key, m]) => legendItemHtml(key, m.label, "buildings"))
        .join(""),
    )}
    ${
      anonymous
        ? ""
        : legendColumnHtml(
            "Classification",
            Object.entries(GIS_HOUSEHOLD_SUBCAT_META)
              .map(([key, m]) => legendItemHtml(key, m.label, "buildings"))
              .join(""),
          )
    }
  </div>`;
  container.querySelector(".gis-svg-wrap").insertAdjacentHTML("beforeend", legendHtml);
  const legendEl = container.querySelector(".gis-legend-overlay");
  container
    .querySelector(".gis-svg-wrap")
    .insertAdjacentHTML("beforeend", `<div class="gis-measure-readout" hidden></div>`);
  const measureReadoutEl = container.querySelector(".gis-measure-readout");

  const svg = container.querySelector(".gis-svg");
  const defsEl = svg.querySelector("defs");
  const viewport = container.querySelector(".gis-svg-viewport");
  const vegetationLayer = container.querySelector(".gis-vegetation-layer");
  const waterLayer = container.querySelector(".gis-water-layer");
  const hazardLayer = container.querySelector(".gis-hazard-layer");
  const constructionLayer = container.querySelector(".gis-construction-layer");
  const roadsLayer = container.querySelector(".gis-roads-layer");
  const buildingsLayer = container.querySelector(".gis-buildings-layer");
  const accidentsLayer = container.querySelector(".gis-accidents-layer");
  const reportsLayer = container.querySelector(".gis-reports-layer");
  const drawPreviewLayer = container.querySelector(".gis-draw-preview-layer");
  const popupEl = container.querySelector(".gis-popup");
  const formEl = container.querySelector(".gis-pin-form");
  const reportHintEl = container.querySelector(".gis-report-hint");
  const drawHintEl = container.querySelector(".gis-draw-hint");
  const editToggleBtn = container.querySelector("[data-gis-edit-toggle]");
  const deselectBtn = container.querySelector("[data-gis-deselect-tool]");
  const buildingsToggleBtn = toggleButtonsHost.querySelector("[data-gis-buildings-toggle]");
  const roadsToggleBtn = toggleButtonsHost.querySelector("[data-gis-roads-toggle]");
  const waterToggleBtn = toggleButtonsHost.querySelector("[data-gis-water-toggle]");
  const vegetationToggleBtn = toggleButtonsHost.querySelector("[data-gis-vegetation-toggle]");
  const hazardToggleBtn = toggleButtonsHost.querySelector("[data-gis-hazard-toggle]");
  const constructionToggleBtn = toggleButtonsHost.querySelector("[data-gis-construction-toggle]");
  const accidentsToggleBtn = toggleButtonsHost.querySelector("[data-gis-accidents-toggle]");
  const reportsToggleBtn = toggleButtonsHost.querySelector("[data-gis-reports-toggle]");
  const drawPanelEl = container.querySelector("[data-gis-draw-panel]");
  const typesPanelEl = container.querySelector("[data-gis-types-panel]");
  const shapePanelEl = container.querySelector("[data-gis-shape-panel]");
  const typesTitleEl = container.querySelector("[data-gis-types-title]");
  const typesListEl = container.querySelector("[data-gis-types-list]");
  const actionsPanelEl = container.querySelector("[data-gis-actions-panel]");
  let openTypesGroup = null; // which element's types panel is showing
  const drawFinishBtn = container.querySelector("[data-gis-draw-finish]");
  const drawCancelBtn = container.querySelector("[data-gis-draw-cancel]");
  const searchWrapEl = toggleButtonsHost.querySelector("[data-gis-search-wrap]");
  const searchInputEl = toggleButtonsHost.querySelector("[data-gis-search-input]");
  const searchResultsEl = toggleButtonsHost.querySelector("[data-gis-search-results]");
  // Dropdown open/close, shared by all three filter dropdowns (Building
  // Type, Classification, Map Layers). One panel open at a time; clicks on
  // the Map Layers toggle rows keep that panel open so several layers can be
  // flipped in one visit; clicking anywhere else closes everything.
  const filterDropdowns = Array.from(toggleButtonsHost.querySelectorAll(".gis-elements-dropdown"));
  function closeFilterDropdowns(except) {
    filterDropdowns.forEach((dd) => {
      if (dd === except) return;
      dd.querySelector(".gis-elements-panel").hidden = true;
      dd.classList.remove("open");
    });
  }
  filterDropdowns.forEach((dd) => {
    const openBtn = dd.querySelector(".gis-elements-btn");
    const panel = dd.querySelector(".gis-elements-panel");
    openBtn.addEventListener("click", (evt) => {
      evt.stopPropagation();
      closeFilterDropdowns(dd);
      panel.hidden = !panel.hidden;
      dd.classList.toggle("open", !panel.hidden);
    });
  });
  document.addEventListener("click", (evt) => {
    filterDropdowns.forEach((dd) => {
      if (!dd.contains(evt.target)) {
        dd.querySelector(".gis-elements-panel").hidden = true;
        dd.classList.remove("open");
      }
    });
  });

  // Choice dropdowns: picking an option applies the filter to every map
  // embed on the page (and syncs all matching dropdowns), then closes.
  toggleButtonsHost.querySelectorAll("[data-gis-choice]").forEach((dd) => {
    const kind = dd.getAttribute("data-gis-choice");
    const panel = dd.querySelector(".gis-elements-panel");
    panel.querySelectorAll(".gis-choice-option").forEach((opt) => {
      opt.addEventListener("click", (evt) => {
        evt.stopPropagation();
        const value = opt.getAttribute("data-value");
        if (kind === "type") gisApplyTypeFilter(value);
        else gisApplySectorFilter(value);
        panel.hidden = true;
        dd.classList.remove("open");
      });
    });
  });

  // The viewBox-space rect the container actually shows. The square 0..1000
  // viewBox letterboxes inside non-square containers ("meet"), so the visible
  // region extends past 0/1000 along the container's longer axis.
  function visibleViewBoxRect() {
    const rect = svg.getBoundingClientRect();
    const pxPerUnit = Math.min(rect.width, rect.height) / 1000 || 1;
    const halfW = rect.width / pxPerUnit / 2;
    const halfH = rect.height / pxPerUnit / 2;
    return { minX: 500 - halfW, maxX: 500 + halfW, minY: 500 - halfH, maxY: 500 + halfH };
  }

  // Keeps the view inside the map's home extent — the area visible in the
  // initial fitted view. Zoomed in, you can pan around, but never past the
  // edges of what the map showed on load; at the fit zoom itself the view is
  // pinned. Recomputed from the live container size so a resize can't strand
  // the view somewhere it could no longer reach.
  function clampPan() {
    const vis = visibleViewBoxRect();
    const fitZoom = computeFitZoom();
    const fitPan = 500 * (1 - fitZoom);
    const clampAxis = (pan, visMin, visMax) => {
      const homeMin = (visMin - fitPan) / fitZoom;
      const homeMax = (visMax - fitPan) / fitZoom;
      const lo = visMax - state.zoom * homeMax;
      const hi = visMin - state.zoom * homeMin;
      if (lo > hi) return (lo + hi) / 2; // zoom below fit (transient): pin centered
      return Math.min(Math.max(pan, lo), hi);
    };
    state.panX = clampAxis(state.panX, vis.minX, vis.maxX);
    state.panY = clampAxis(state.panY, vis.minY, vis.maxY);
  }

  function applyTransform() {
    clampPan();
    viewport.setAttribute(
      "transform",
      `translate(${state.panX} ${state.panY}) scale(${state.zoom})`,
    );
  }

  // With the view clamped to the initial fitted extent (clampPan above), a
  // feature lying entirely beyond that extent can never be scrolled into
  // view. Rendering it anyway just parks an invisible DOM node that slows
  // every pan/zoom frame, so the layer renderers skip such features.
  // Verdicts are cached by feature id; staff-drawn (custom) features are
  // never culled.
  const homeCullCache = new Map();
  function homeExtentLocalRect() {
    const rect = svg.getBoundingClientRect();
    if (!rect.width || !rect.height) return null; // not laid out yet — don't cull
    const vis = visibleViewBoxRect();
    const fitZoom = computeFitZoom();
    const fitPan = 500 * (1 - fitZoom);
    // ~5% padding so a container that grows a little after load (revealing
    // slightly more map than at first paint) doesn't expose culled edges.
    const padX = (vis.maxX - vis.minX) * 0.05;
    const padY = (vis.maxY - vis.minY) * 0.05;
    return {
      minX: (vis.minX - padX - fitPan) / fitZoom,
      maxX: (vis.maxX + padX - fitPan) / fitZoom,
      minY: (vis.minY - padY - fitPan) / fitZoom,
      maxY: (vis.maxY + padY - fitPan) / fitZoom,
    };
  }
  function featureInHomeExtent(feature) {
    if (feature.properties.custom) return true;
    const id = feature.properties.id;
    if (homeCullCache.has(id)) return homeCullCache.get(id);
    const home = homeExtentLocalRect();
    if (!home) return true;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    (function walk(coords) {
      if (typeof coords[0] === "number") {
        const [x, y] = project(coords[0], coords[1]);
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      } else {
        coords.forEach(walk);
      }
    })(feature.geometry.coordinates);
    const visible = maxX >= home.minX && minX <= home.maxX && maxY >= home.minY && minY <= home.maxY;
    homeCullCache.set(id, visible);
    return visible;
  }

  // Projected (viewBox-space) bounding box of the boundary polygon — the
  // basis for the fit-to-container zoom below.
  const boundaryBBoxVb = (() => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    (function walk(coords) {
      if (typeof coords[0] === "number") {
        const [x, y] = project(coords[0], coords[1]);
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      } else {
        coords.forEach(walk);
      }
    })(geojson.features[0].geometry.coordinates);
    return { width: maxX - minX, height: maxY - minY };
  })();

  // Zoom at which the boundary nearly fills the container. The square 0-1000
  // viewBox letterboxes inside non-square containers ("meet"), so the fit
  // depends on the container's live dimensions — recomputed on every reset.
  function computeFitZoom() {
    const rect = svg.getBoundingClientRect();
    if (!rect.width || !rect.height || !boundaryBBoxVb.width || !boundaryBBoxVb.height) return 1;
    const pxPerUnit = Math.min(rect.width, rect.height) / 1000;
    return Math.max(
      1,
      GIS_FIT_MARGIN *
        Math.min(
          rect.width / (boundaryBBoxVb.width * pxPerUnit),
          rect.height / (boundaryBBoxVb.height * pxPerUnit),
        ),
    );
  }

  let minZoom = 1;

  function resetView() {
    const fitZoom = computeFitZoom();
    minZoom = fitZoom * GIS_MIN_ZOOM_FACTOR;
    state.zoom = fitZoom;
    // The projector centers the boundary at viewBox (500,500), which "meet"
    // keeps at the container's center — scale around that point.
    state.panX = 500 * (1 - fitZoom);
    state.panY = 500 * (1 - fitZoom);
    applyTransform();
    renderScreenScaledMarkers();
  }

  // Markers sized in screen pixels (accidents, community reports) must be
  // re-rendered whenever the zoom changes so they keep a constant size.
  function renderScreenScaledMarkers() {
    renderDrawPreview();
    renderAccidents();
    renderReports();
  }

  function hidePopup() {
    popupEl.hidden = true;
    // Strip the hoverable/expanded classes so later read-only popups don't
    // inherit pointer-events:auto and start swallowing map interactions.
    popupEl.classList.remove("gis-popup-readonly", "gis-popup-hoverable", "gis-popup-expanded");
    cancelHidePopup();
  }

  // ── Hover-persistent popups (community report pins) ──
  // Read-only hover popups are pointer-events:none, so they can't hold a
  // button. Report cards instead stay put and survive the cursor's travel
  // from pin to popup via a short grace timer that either side can cancel.
  let popupHideTimer = null;
  function cancelHidePopup() {
    if (popupHideTimer) {
      clearTimeout(popupHideTimer);
      popupHideTimer = null;
    }
  }
  function scheduleHidePopup() {
    cancelHidePopup();
    popupHideTimer = setTimeout(hidePopup, 180);
  }

  function hideForm() {
    formEl.hidden = true;
  }

  function positionFloatingEl(el, x, y, host) {
    const rect = host.getBoundingClientRect();
    el.style.left = Math.min(x, rect.width - 220) + "px";
    el.style.top = Math.max(y - 10, 8) + "px";
  }

  // Read-only popup shown on hover while NOT in edit mode — info only, no
  // edit/delete actions (those are only ever reachable through the click
  // path below, which is itself gated to edit mode).
  function showInfoPopup(html, screenX, screenY) {
    popupEl.innerHTML = html;
    popupEl.classList.remove("gis-popup-hoverable", "gis-popup-expanded");
    popupEl.classList.add("gis-popup-readonly");
    popupEl.hidden = false;
    positionFloatingEl(popupEl, screenX, screenY, container);
  }

  // Editable popup (with action buttons) shown on click while in edit mode.
  function showEditPopup(screenX, screenY) {
    popupEl.classList.remove("gis-popup-readonly", "gis-popup-hoverable", "gis-popup-expanded");
    popupEl.hidden = false;
    positionFloatingEl(popupEl, screenX, screenY, container);
  }

  // Interactive hover card: clickable (pointer-events:auto via the hoverable
  // class) and fixed in place — unlike the read-only popup it must not follow
  // the cursor, or the cursor could never reach its "See more" button.
  function showHoverCard(html, screenX, screenY) {
    popupEl.innerHTML = html;
    popupEl.classList.remove("gis-popup-readonly", "gis-popup-expanded");
    popupEl.classList.add("gis-popup-hoverable");
    popupEl.hidden = false;
    positionFloatingEl(popupEl, screenX, screenY, container);
    clampPopupToContainer();
  }

  // positionFloatingEl assumes a ~220px-wide popup; the expanded report card
  // is wider, so re-clamp using its real rendered size.
  function clampPopupToContainer() {
    const rect = container.getBoundingClientRect();
    const left = parseFloat(popupEl.style.left) || 0;
    const top = parseFloat(popupEl.style.top) || 0;
    if (left + popupEl.offsetWidth > rect.width - 8) {
      popupEl.style.left = Math.max(rect.width - popupEl.offsetWidth - 8, 8) + "px";
    }
    if (top + popupEl.offsetHeight > rect.height - 8) {
      popupEl.style.top = Math.max(rect.height - popupEl.offsetHeight - 8, 8) + "px";
    }
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = String(str ?? "");
    return div.innerHTML;
  }

  // Styled in-map replacement for the browser's confirm() dialog, anchored
  // where the delete was requested. onConfirm only runs on explicit
  // confirmation; Cancel (or clicking the map) dismisses it.
  function showDeleteConfirm({ title, message, confirmLabel = "Delete", onConfirm }, screenX, screenY) {
    hidePopup();
    formEl.innerHTML = `
      <div class="gis-confirm-head">
        <div class="gis-confirm-icon">${gisIcon("trash")}</div>
        <div class="gis-pin-form-title">${escapeHtml(title)}</div>
      </div>
      <div class="gis-confirm-message">${escapeHtml(message)}</div>
      <div class="gis-pin-form-actions">
        <button type="button" class="btn btn-sm btn-outline" data-gis-cancel>Cancel</button>
        <button type="button" class="btn btn-sm gis-confirm-delete" data-gis-confirm>${escapeHtml(confirmLabel)}</button>
      </div>
    `;
    formEl.hidden = false;
    positionFloatingEl(formEl, screenX, screenY, container);
    formEl.querySelector("[data-gis-cancel]").addEventListener("click", (e) => {
      e.stopPropagation();
      hideForm();
    });
    formEl.querySelector("[data-gis-confirm]").addEventListener("click", (e) => {
      e.stopPropagation();
      hideForm();
      onConfirm();
    });
    formEl.addEventListener("click", (e) => e.stopPropagation());
  }

  // Native <option> elements can't render inline SVG, so this stays text-only —
  // the matching gisIcon() is shown instead wherever the same choice appears
  // as a button, popup title, or chip (see swatchPickerHtml for those spots).
  function optionsHtml(meta, selected) {
    return Object.entries(meta)
      .map(
        ([key, m]) =>
          `<option value="${key}" ${key === selected ? "selected" : ""}>${m.label}</option>`,
      )
      .join("");
  }

  // A row of chip buttons, each showing a small colored circle + label —
  // used where a plain <option> text list wouldn't show the color at a glance.
  function swatchPickerHtml(meta, selected, pickerName) {
    const entries = Object.entries(meta);
    const selectedKey = selected && meta[selected] ? selected : entries[0][0];
    return `<div class="gis-swatch-picker" data-picker="${pickerName}">${entries
      .map(
        ([key, m]) => `
      <button type="button" class="gis-swatch-option${key === selectedKey ? " active" : ""}" data-value="${key}">
        <span class="gis-swatch-dot" style="background:${m.color}"></span>${escapeHtml(m.label)}
      </button>`,
      )
      .join("")}</div>`;
  }

  function wireSwatchPicker(pickerName) {
    const options = formEl.querySelectorAll(`[data-picker="${pickerName}"] .gis-swatch-option`);
    options.forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        options.forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
      });
    });
  }

  function getSwatchValue(pickerName, fallback) {
    return (
      formEl.querySelector(`[data-picker="${pickerName}"] .gis-swatch-option.active`)?.getAttribute("data-value") ||
      fallback
    );
  }

  // Shared interaction wiring for every feature type (buildings, roads,
  // vegetation, construction, hazards, accidents). Outside edit mode, a
  // feature is read-only: hovering it shows an info popup that follows the
  // cursor, and clicks do nothing. Inside edit mode, hover info is disabled
  // and a click opens the full popup with edit/delete actions — editing and
  // deleting are only ever reachable through that click path, so both are
  // impossible while edit mode is off.
  // An open expanded report card should survive the cursor brushing over
  // other features on its way to the card — don't let their hover popups
  // clobber it (it closes via its ✕, Esc, or a background click).
  function expandedCardOpen() {
    return !popupEl.hidden && popupEl.classList.contains("gis-popup-expanded");
  }

  function attachFeatureInteraction(el, { hoverHtml, onOpen }) {
    el.classList.add("gis-interactive-feature");
    el.addEventListener("mouseenter", (evt) => {
      if (state.drawTool || state.editMode || state.reportMode || state.pickMode || expandedCardOpen()) return;
      const svgRect = svg.getBoundingClientRect();
      showInfoPopup(hoverHtml(), evt.clientX - svgRect.left, evt.clientY - svgRect.top);
    });
    el.addEventListener("mousemove", (evt) => {
      if (state.drawTool || state.editMode || state.reportMode || state.pickMode) return;
      if (popupEl.hidden || !popupEl.classList.contains("gis-popup-readonly")) return;
      const svgRect = svg.getBoundingClientRect();
      positionFloatingEl(popupEl, evt.clientX - svgRect.left, evt.clientY - svgRect.top, container);
    });
    el.addEventListener("mouseleave", () => {
      if (state.drawTool || state.editMode || state.reportMode || state.pickMode || expandedCardOpen()) return;
      hidePopup();
    });
    el.addEventListener("click", (evt) => {
      // While placing a community report or picking an incident location, let
      // the click fall through to the map's own handler (features cover most
      // of the map surface).
      if (state.drawTool || state.reportMode || state.pickMode) return;
      evt.stopPropagation();
      if (!state.editMode) return;
      onOpen(evt);
    });
  }

  // Grace-timer handoff: entering the interactive popup cancels the pending
  // hide that the pin's mouseleave scheduled; leaving it re-schedules (the
  // expanded card stays until explicitly closed).
  popupEl.addEventListener("mouseenter", () => {
    if (popupEl.classList.contains("gis-popup-hoverable")) cancelHidePopup();
  });
  popupEl.addEventListener("mouseleave", () => {
    if (popupEl.classList.contains("gis-popup-hoverable") && !popupEl.classList.contains("gis-popup-expanded")) {
      scheduleHidePopup();
    }
  });

  // ───────── Buildings (OSM + custom), taggable with resident/category info ─────────
  function allBuildingFeatures() {
    const deleted = new Set(gisLoadDeletedBuildings());
    return (buildingsGeojson?.features || [])
      .filter((f) => !deleted.has(f.properties.id))
      .concat(gisCustomBuildingFeatures());
  }

  function buildingInfoHtml(buildingId) {
    const tags = gisLoadBuildingTags();
    const tag = tags[buildingId];
    const displayMeta = gisTagDisplayMeta(tag);
    const groupSize = tag?.groupId ? Object.values(tags).filter((t) => t?.groupId === tag.groupId).length : 0;
    // Anonymous embeds keep tagged *households* private — only the generic
    // "Household" tag shows, never the resident name, vulnerable
    // classification, or free-text notes. Businesses and government buildings
    // are public info, so they still show their full details.
    if (anonymous && tag?.type === "households") {
      const typeMeta = GIS_BUILDING_TYPE_META.households;
      return `<div class="gis-popup-title">${gisIcon(typeMeta.icon)} ${escapeHtml(typeMeta.label)}</div>`;
    }
    return tag
      ? `
      <div class="gis-popup-title">${gisIcon(displayMeta ? displayMeta.icon : "home")} ${escapeHtml(tag.name)}</div>
      ${displayMeta ? `<div class="gis-popup-cat">${escapeHtml(displayMeta.label)}</div>` : ""}
      ${groupSize > 1 ? `<div class="gis-popup-cat">${gisIcon("layers")} Group of ${groupSize} buildings</div>` : ""}
      ${tag.notes ? `<div class="gis-popup-notes">${escapeHtml(tag.notes)}</div>` : ""}
    `
      : `
      <div class="gis-popup-title">${gisIcon("home")} Untagged Building</div>
      <div class="gis-popup-cat">No resident info yet</div>
    `;
  }

  // Rendered inside-boundary building paths by id — lets group-hover reach
  // sibling paths without a DOM query per hover.
  let buildingPathsById = new Map();

  // Hovering any member of a tag group highlights the other members, so the
  // group's full footprint is visible at a glance. Works in view and edit
  // mode alike.
  function highlightGroupPeers(buildingId, on) {
    const tags = gisLoadBuildingTags();
    const groupId = tags[buildingId]?.groupId;
    if (!groupId) return;
    Object.keys(tags).forEach((id) => {
      if (id !== String(buildingId) && tags[id]?.groupId === groupId) {
        const peer = buildingPathsById.get(id);
        if (peer) peer.classList.toggle("gis-building-group-hover", on);
      }
    });
  }

  function renderBuildings() {
    buildingsLayer.innerHTML = "";
    buildingPathsById = new Map();
    if (!state.showBuildings) return;

    const tags = gisLoadBuildingTags();
    const filtering = state.typeFilter !== "all" || state.sectorFilter !== "all";
    allBuildingFeatures().forEach((feature) => {
      if (!featureInHomeExtent(feature)) return;
      const buildingId = feature.properties.id;
      const tag = tags[buildingId];

      // Surrounding-context buildings (outside the boundary): faded, not
      // taggable/hoverable, and hidden entirely while filtering.
      if (!featureInsideBoundary(feature)) {
        if (filtering) return;
        const ctx = document.createElementNS("http://www.w3.org/2000/svg", "path");
        ctx.setAttribute("d", gisGeometryToPath(feature.geometry, project));
        ctx.setAttribute("class", "gis-building gis-building-outside");
        buildingsLayer.appendChild(ctx);
        return;
      }

      // The two dropdown filters combine: building type narrows by tag.type;
      // household classification narrows to households of that group.
      if (state.typeFilter !== "all" && tag?.type !== state.typeFilter) return;
      if (
        state.sectorFilter !== "all" &&
        !(tag?.type === "households" && tag?.subcat === state.sectorFilter)
      ) {
        return;
      }

      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", gisGeometryToPath(feature.geometry, project));
      let cls = "gis-building";
      if (tag) cls += " gis-building-tagged";
      if (tag?.type) {
        // Households colored by classification when one is set (its group
        // hues carry over from the old category system); other types get
        // their own type color. Anonymous embeds ignore the classification so
        // every household reads as the same neutral household color.
        const catKey = !anonymous && tag.type === "households" && tag.subcat ? tag.subcat : tag.type;
        cls += " gis-building-cat-" + catKey;
      }
      if (state.groupSelection.has(String(buildingId))) cls += " gis-building-grouped";
      path.setAttribute("class", cls);
      buildingPathsById.set(String(buildingId), path);
      path.addEventListener("mouseenter", () => highlightGroupPeers(buildingId, true));
      path.addEventListener("mouseleave", () => highlightGroupPeers(buildingId, false));
      attachFeatureInteraction(path, {
        hoverHtml: () => buildingInfoHtml(buildingId),
        onOpen: (evt) => {
          // Group-select mode: clicks pick/unpick buildings for a shared tag
          // instead of opening the single-building popup.
          if (state.groupSelect) {
            const key = String(buildingId);
            if (state.groupSelection.has(key)) state.groupSelection.delete(key);
            else state.groupSelection.add(key);
            path.classList.toggle("gis-building-grouped", state.groupSelection.has(key));
            updateGroupDock();
            return;
          }
          const svgRect = svg.getBoundingClientRect();
          showBuildingPopup(buildingId, feature.properties.custom, evt.clientX - svgRect.left, evt.clientY - svgRect.top);
        },
      });
      buildingsLayer.appendChild(path);
    });
  }

  function showBuildingPopup(buildingId, isCustom, screenX, screenY) {
    const tag = gisLoadBuildingTags()[buildingId];
    popupEl.innerHTML =
      buildingInfoHtml(buildingId) +
      `
      <button type="button" class="gis-popup-action" data-gis-edit-building>${tag ? (tag.groupId ? "Edit group tag" : "Edit tag") : "+ Tag this building"}</button>
      <button type="button" class="gis-popup-action" data-gis-group-toggle>${gisIcon("layers")} ${tag?.groupId ? "Add buildings to group" : "Group tagging"}</button>
      ${tag ? `<button type="button" class="gis-popup-delete" data-gis-untag-building>Remove tag</button>` : ""}
      <button type="button" class="gis-popup-delete" data-gis-delete-building>Delete building</button>
    `;
    showEditPopup(screenX, screenY);

    popupEl.querySelector("[data-gis-edit-building]").addEventListener("click", () => {
      showBuildingTagForm(buildingId, tag, screenX, screenY);
    });
    popupEl.querySelector("[data-gis-group-toggle]").addEventListener("click", () => {
      enterGroupSelect(buildingId, tag);
    });
    popupEl.querySelector("[data-gis-untag-building]")?.addEventListener("click", () => {
      gisClearBuildingTag(buildingId);
      if (typeof logAudit === "function")
        logAudit("MAP_TAG_REMOVE", `Tag "${tag?.name || "Untagged"}" removed from building ${buildingId}`, "info", "map");
      hidePopup();
      renderBuildings();
    });
    popupEl.querySelector("[data-gis-delete-building]").addEventListener("click", () => {
      showDeleteConfirm(
        {
          title: "Delete this building?",
          message: "It will be moved to the Archive, where it can be restored anytime.",
          confirmLabel: "Move to Archive",
          onConfirm: () => {
            const customBackup = isCustom ? gisLoadJSON(GIS_CUSTOM_BUILDINGS_KEY, []).find((b) => b.id === buildingId) : null;
            gisArchiveBuilding({
              id: buildingId,
              isCustom,
              coordinates: customBackup ? customBackup.coordinates : null,
              tag: tag || null,
            });
            if (isCustom) gisDeleteCustomBuilding(buildingId);
            else gisSoftDeleteBuilding(buildingId);
            renderBuildings();
            if (typeof showToast === "function") showToast("Building moved to Archive", gisIcon("trash"));
          },
        },
        screenX,
        screenY,
      );
    });
  }

  // ── Group tagging — entered from a building popup's "Group tagging"
  // button. While active, clicks on buildings toggle selection (see
  // renderBuildings) instead of opening popups, and a floating dock shows
  // the running count with Tag Group / Cancel actions. Saving applies one
  // shared tag to every selected building.
  const groupDockEl = container.querySelector("[data-gis-group-dock]");
  const groupCountEl = groupDockEl ? groupDockEl.querySelector("[data-gis-group-count]") : null;
  function enterGroupSelect(seedId, existingTag) {
    state.groupSelect = true;
    // Re-opening an existing group pre-selects every current member, so new
    // buildings can be added (or members unpicked) without re-selecting the
    // whole group from scratch. Saving keeps the same groupId.
    if (existingTag?.groupId) {
      const tags = gisLoadBuildingTags();
      state.groupEditId = existingTag.groupId;
      state.groupSeedTag = existingTag;
      state.groupSelection = new Set(
        Object.keys(tags).filter((id) => tags[id]?.groupId === existingTag.groupId),
      );
    } else {
      state.groupEditId = null;
      state.groupSeedTag = null;
      state.groupSelection = new Set([String(seedId)]);
    }
    hidePopup();
    hideForm();
    renderBuildings();
    updateGroupDock();
  }
  function exitGroupSelect() {
    if (!state.groupSelect) return;
    state.groupSelect = false;
    state.groupSelection = new Set();
    state.groupEditId = null;
    state.groupSeedTag = null;
    if (groupDockEl) groupDockEl.hidden = true;
    hideForm();
    renderBuildings();
  }
  function updateGroupDock() {
    if (!groupDockEl) return;
    groupDockEl.hidden = !state.groupSelect;
    const n = state.groupSelection.size;
    groupCountEl.textContent = `${n} building${n === 1 ? "" : "s"} selected`;
    groupDockEl.querySelector("[data-gis-group-tag]").disabled = n === 0;
  }
  if (groupDockEl) {
    groupDockEl.querySelector("[data-gis-group-cancel]").addEventListener("click", exitGroupSelect);
    groupDockEl.querySelector("[data-gis-group-tag]").addEventListener("click", () => {
      const rect = container.getBoundingClientRect();
      showBuildingTagForm(null, state.groupSeedTag, rect.width / 2 - 110, rect.height / 3, undefined, [...state.groupSelection]);
    });
  }

  // presetType is passed when the building was just drawn via the draw panel
  // (where the type was already picked) — the form then shows the type as a
  // fixed line instead of a selector. Tagging/editing existing buildings
  // still gets the full selector. groupIds (from group tagging) switches the
  // form to apply the same tag to every id in the list.
  function showBuildingTagForm(buildingId, existingTag, screenX, screenY, presetType, groupIds) {
    hidePopup();
    const normalized = gisNormalizeBuildingTag(existingTag);
    const effectiveType = presetType || normalized?.type || "";
    const typeOptions =
      `<option value="">— Select type —</option>` + optionsHtml(GIS_BUILDING_TYPE_META, normalized?.type);
    const subcatOptions =
      `<option value="">— None —</option>` + optionsHtml(GIS_HOUSEHOLD_SUBCAT_META, normalized?.subcat);
    const presetMeta = presetType ? GIS_BUILDING_TYPE_META[presetType] : null;
    const typeRowHtml = presetMeta
      ? `<div class="gis-pin-form-static">${gisIcon(presetMeta.icon)} ${escapeHtml(presetMeta.label)}</div>`
      : `<label class="gis-pin-form-label">Building Type
          <select class="gis-pin-form-input" data-f="type">${typeOptions}</select>
        </label>`;
    formEl.innerHTML = `
      <div class="gis-pin-form-title">${groupIds ? `Tag ${groupIds.length} Buildings` : "Tag Building"}</div>
      ${typeRowHtml}
      <label class="gis-pin-form-label">Name
        <input type="text" class="gis-pin-form-input" data-f="name" placeholder="${groupIds ? "e.g. Riverside Compound" : "e.g. Dela Cruz Residence"}" value="${normalized ? escapeHtml(normalized.name) : ""}" />
      </label>
      <label class="gis-pin-form-label" data-subcat-row ${effectiveType === "households" ? "" : "hidden"}>Household Classification
        <select class="gis-pin-form-input" data-f="subcat">${subcatOptions}</select>
      </label>
      <label class="gis-pin-form-label">Notes
        <textarea class="gis-pin-form-input" data-f="notes" placeholder="Optional notes">${normalized ? escapeHtml(normalized.notes || "") : ""}</textarea>
      </label>
      <div class="gis-pin-form-actions">
        <button type="button" class="btn btn-sm btn-outline" data-gis-cancel>Cancel</button>
        <button type="button" class="btn btn-sm btn-gold" data-gis-save>Save Tag</button>
      </div>
    `;
    formEl.hidden = false;
    positionFloatingEl(formEl, screenX, screenY, container);

    // Household classification only applies to households — hide it (and
    // drop its value on save) for any other building type.
    const typeSelect = formEl.querySelector('[data-f="type"]');
    const subcatRow = formEl.querySelector("[data-subcat-row]");
    typeSelect?.addEventListener("change", () => {
      subcatRow.hidden = typeSelect.value !== "households";
    });

    formEl.querySelector("[data-gis-cancel]").addEventListener("click", (e) => {
      e.stopPropagation();
      hideForm();
    });
    formEl.querySelector("[data-gis-save]").addEventListener("click", (e) => {
      e.stopPropagation();
      const name = formEl.querySelector('[data-f="name"]').value.trim();
      const type = presetType || typeSelect.value;
      const subcat = type === "households" ? formEl.querySelector('[data-f="subcat"]').value : "";
      const notes = formEl.querySelector('[data-f="notes"]').value.trim();
      if (!name) {
        formEl.querySelector('[data-f="name"]').focus();
        return;
      }
      if (!type) {
        typeSelect.focus();
        return;
      }
      const tagValue = { name, type, subcat, notes };
      const typeIcon = gisIcon(GIS_BUILDING_TYPE_META[type]?.icon || "home");
      if (groupIds) {
        // Members share a groupId so hovering one highlights the rest and
        // editing one updates them all. Re-saving an existing group keeps
        // its id; members unpicked during re-selection keep their tag but
        // leave the group.
        const groupId = state.groupEditId || gisNewId("grp");
        if (state.groupEditId) {
          const all = gisLoadBuildingTags();
          Object.keys(all).forEach((id) => {
            if (all[id]?.groupId === groupId && !groupIds.includes(id)) {
              const { groupId: _removed, ...rest } = all[id];
              gisSaveBuildingTag(id, rest);
            }
          });
        }
        groupIds.forEach((id) => gisSaveBuildingTag(id, { ...tagValue, groupId }));
        exitGroupSelect(); // also hides the form and re-renders
        if (typeof logAudit === "function")
          logAudit(
            "MAP_TAG_SAVE",
            `Group tag "${name}" (${GIS_BUILDING_TYPE_META[type]?.label || type}) applied to ${groupIds.length} building${groupIds.length === 1 ? "" : "s"}`,
            "info",
            "map",
          );
        if (typeof showToast === "function")
          showToast(`${groupIds.length} building${groupIds.length === 1 ? "" : "s"} tagged`, typeIcon);
        return;
      }
      if (normalized?.groupId) {
        // Editing a group member: the change applies to the whole group.
        const all = gisLoadBuildingTags();
        const memberIds = Object.keys(all).filter((id) => all[id]?.groupId === normalized.groupId);
        memberIds.forEach((id) => gisSaveBuildingTag(id, { ...tagValue, groupId: normalized.groupId }));
        hideForm();
        renderBuildings();
        if (typeof logAudit === "function")
          logAudit(
            "MAP_TAG_SAVE",
            `Group tag "${name}" updated (${memberIds.length} building${memberIds.length === 1 ? "" : "s"})`,
            "info",
            "map",
          );
        if (typeof showToast === "function") showToast(`Group updated (${memberIds.length} buildings)`, typeIcon);
        return;
      }
      gisSaveBuildingTag(buildingId, tagValue);
      hideForm();
      renderBuildings();
      if (typeof logAudit === "function")
        logAudit(
          "MAP_TAG_SAVE",
          `Building ${buildingId} tagged "${name}" (${GIS_BUILDING_TYPE_META[type]?.label || type})`,
          "info",
          "map",
        );
      if (typeof showToast === "function") showToast("Building tagged", typeIcon);
    });
    formEl.addEventListener("click", (e) => e.stopPropagation());
  }

  // ───────── Roads (OSM context + custom, custom ones are taggable/deletable) ─────────
  function roadInfoHtml(props) {
    const roadTypeLabel = GIS_ROAD_TYPE_META[props.roadType]?.label || props.roadType || "Road";
    return `
      <div class="gis-popup-title">${gisIcon("road")} ${escapeHtml(props.name || "Unnamed Road")}</div>
      <div class="gis-popup-cat">${escapeHtml(roadTypeLabel)}</div>
    `;
  }

  function renderRoads() {
    roadsLayer.innerHTML = "";
    if (!state.showRoads) return;

    (roadsGeojson?.features || []).forEach((feature) => {
      if (!featureInHomeExtent(feature)) return;
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", gisGeometryToPath(feature.geometry, project));
      path.setAttribute("class", "gis-road gis-road-" + gisRoadTypeForHighway(feature.properties.highway));
      roadsLayer.appendChild(path);
    });

    gisCustomRoadFeatures().forEach((feature) => {
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", gisGeometryToPath(feature.geometry, project));
      path.setAttribute("class", "gis-road gis-road-" + (feature.properties.roadType || "local"));
      attachFeatureInteraction(path, {
        hoverHtml: () => roadInfoHtml(feature.properties),
        onOpen: (evt) => {
          const svgRect = svg.getBoundingClientRect();
          showRoadPopup(feature.properties, evt.clientX - svgRect.left, evt.clientY - svgRect.top);
        },
      });
      roadsLayer.appendChild(path);
    });
  }

  function showRoadPopup(props, screenX, screenY) {
    popupEl.innerHTML =
      roadInfoHtml(props) +
      `
      <button type="button" class="gis-popup-action" data-gis-edit>Edit</button>
      <button type="button" class="gis-popup-delete" data-gis-delete>Delete road</button>
    `;
    showEditPopup(screenX, screenY);
    popupEl.querySelector("[data-gis-edit]").addEventListener("click", () => {
      showRoadForm(props.id, props, screenX, screenY);
    });
    popupEl.querySelector("[data-gis-delete]").addEventListener("click", () => {
      showDeleteConfirm(
        {
          title: "Delete this road?",
          message: `"${props.name || "Unnamed Road"}" will be permanently removed from the map.`,
          onConfirm: () => {
            gisDeleteCustomRoad(props.id);
            renderRoads();
            if (typeof showToast === "function") showToast("Road deleted", gisIcon("trash"));
          },
        },
        screenX,
        screenY,
      );
    });
  }

  function showRoadForm(existingId, existing, screenX, screenY) {
    hidePopup();
    // Creating: the road type was already picked in the draw panel — show it
    // as a fixed line. Editing keeps the swatch picker to change it.
    const presetMeta = !existingId ? GIS_ROAD_TYPE_META[state.drawSubtype] : null;
    const typeRowHtml = presetMeta
      ? `<div class="gis-pin-form-static"><span class="gis-swatch-dot" style="background:${presetMeta.color}"></span>${escapeHtml(presetMeta.label)}</div>`
      : `<label class="gis-pin-form-label">Road Type
          ${swatchPickerHtml(GIS_ROAD_TYPE_META, existing?.roadType, "roadType")}
        </label>`;
    formEl.innerHTML = `
      <div class="gis-pin-form-title">${existingId ? "Edit Road" : "Draw Road"}</div>
      ${typeRowHtml}
      <label class="gis-pin-form-label">Road Name
        <input type="text" class="gis-pin-form-input" data-f="name" placeholder="e.g. Purok 3 Access Road" value="${existing ? escapeHtml(existing.name || "") : ""}" />
      </label>
      <div class="gis-pin-form-actions">
        <button type="button" class="btn btn-sm btn-outline" data-gis-cancel>Cancel</button>
        <button type="button" class="btn btn-sm btn-gold" data-gis-save>Save Road</button>
      </div>
    `;
    formEl.hidden = false;
    positionFloatingEl(formEl, screenX, screenY, container);
    if (!presetMeta) wireSwatchPicker("roadType");
    formEl.querySelector("[data-gis-cancel]").addEventListener("click", (e) => {
      e.stopPropagation();
      hideForm();
      if (!existingId) cancelDrawing();
    });
    formEl.querySelector("[data-gis-save]").addEventListener("click", (e) => {
      e.stopPropagation();
      const name = formEl.querySelector('[data-f="name"]').value.trim();
      const type = presetMeta ? state.drawSubtype : getSwatchValue("roadType", "local");
      if (!name) {
        formEl.querySelector('[data-f="name"]').focus();
        return;
      }
      if (existingId) {
        gisUpdateCustomRoad(existingId, name, type);
      } else {
        gisAddCustomRoad(state.drawPoints.slice(), name, type);
        finishDrawing();
      }
      hideForm();
      renderRoads();
      if (typeof showToast === "function") showToast("Road saved", gisIcon("road"));
    });
    formEl.addEventListener("click", (e) => e.stopPropagation());
  }

  // ───────── Vegetation (OSM context + custom). Custom areas are fully
  // taggable/deletable; every area (OSM-sourced or custom) can be trimmed
  // with the cut tool, which punches a hole where the user traces. ─────────
  function vegetationInfoHtml(feature) {
    const props = feature.properties;
    const meta = GIS_VEGETATION_KIND_META[props.kind] || { label: props.kind || "Vegetation", icon: "grass" };
    const trimmed = (gisLoadVegetationCuts()[props.id] || []).length > 0;
    return `
      <div class="gis-popup-title">${gisIcon(meta.icon)} ${escapeHtml(meta.label)}</div>
      ${props.notes ? `<div class="gis-popup-notes">${escapeHtml(props.notes)}</div>` : ""}
      ${trimmed ? `<div class="gis-popup-cat">Area has been trimmed</div>` : ""}
    `;
  }

  // Builds (or rebuilds) a <mask> that's white everywhere except the traced
  // cut ring(s), which are painted black. Applying this to the vegetation
  // path via `mask="url(#...)"` means a cut can only hide pixels the path
  // itself already paints — tracing outside the vegetation's outline simply
  // has no effect, instead of showing up as a brand new filled shape.
  function buildVegetationCutMask(vegId, cutRings) {
    const maskId = `${defsId}-vegmask-${vegId}`;
    const existing = defsEl.querySelector(`#${CSS.escape(maskId)}`);
    if (existing) existing.remove();

    const mask = document.createElementNS("http://www.w3.org/2000/svg", "mask");
    mask.setAttribute("id", maskId);
    mask.setAttribute("class", "gis-veg-cut-mask");
    mask.setAttribute("maskUnits", "userSpaceOnUse");
    mask.innerHTML =
      `<rect x="0" y="0" width="1000" height="1000" fill="white"/>` +
      cutRings.map((ring) => `<path d="${gisPolygonToPath([ring], project)}" fill="black"/>`).join("");
    defsEl.appendChild(mask);
    return maskId;
  }

  function renderVegetationFeature(feature, isCustom) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", gisGeometryToPath(feature.geometry, project));
    path.setAttribute("class", "gis-vegetation gis-vegetation-" + (feature.properties.kind || "default"));
    // Surrounding-context vegetation: faded, no hover/cut interactions.
    if (!featureInsideBoundary(feature)) {
      path.classList.add("gis-vegetation-outside");
      vegetationLayer.appendChild(path);
      return;
    }
    const cuts = gisLoadVegetationCuts()[feature.properties.id];
    if (cuts && cuts.length) {
      path.setAttribute("mask", `url(#${buildVegetationCutMask(feature.properties.id, cuts)})`);
    }
    attachFeatureInteraction(path, {
      hoverHtml: () => vegetationInfoHtml(feature),
      onOpen: (evt) => {
        const svgRect = svg.getBoundingClientRect();
        showVegetationPopup(feature.properties, isCustom, evt.clientX - svgRect.left, evt.clientY - svgRect.top);
      },
    });
    vegetationLayer.appendChild(path);
  }

  function renderVegetation() {
    vegetationLayer.innerHTML = "";
    defsEl.querySelectorAll(".gis-veg-cut-mask").forEach((el) => el.remove());
    if (!state.showVegetation) return;

    (vegetationGeojson?.features || []).forEach((feature) => {
      if (featureInHomeExtent(feature)) renderVegetationFeature(feature, false);
    });
    gisCustomVegetationFeatures().forEach((feature) => renderVegetationFeature(feature, true));
  }

  function showVegetationPopup(props, isCustom, screenX, screenY) {
    const meta = GIS_VEGETATION_KIND_META[props.kind] || { label: props.kind || "Vegetation", icon: "grass" };
    const hasCuts = (gisLoadVegetationCuts()[props.id] || []).length > 0;
    popupEl.innerHTML = `
      <div class="gis-popup-title">${gisIcon(meta.icon)} ${escapeHtml(meta.label)}</div>
      ${props.notes ? `<div class="gis-popup-notes">${escapeHtml(props.notes)}</div>` : ""}
      ${isCustom ? `<button type="button" class="gis-popup-action" data-gis-edit>Edit</button>` : ""}
      <button type="button" class="gis-popup-action" data-gis-cut>${gisIcon("scissors")} Cut area</button>
      ${hasCuts ? `<button type="button" class="gis-popup-action" data-gis-restore>${gisIcon("refresh")} Restore full shape</button>` : ""}
      ${isCustom ? `<button type="button" class="gis-popup-delete" data-gis-delete>Delete area</button>` : ""}
    `;
    showEditPopup(screenX, screenY);
    popupEl.querySelector("[data-gis-edit]")?.addEventListener("click", () => {
      showVegetationForm(props.id, props, screenX, screenY);
    });
    popupEl.querySelector("[data-gis-delete]")?.addEventListener("click", () => {
      showDeleteConfirm(
        {
          title: "Delete this vegetation area?",
          message: "The drawn area (and any cuts made to it) will be permanently removed.",
          onConfirm: () => {
            gisDeleteCustomVegetation(props.id);
            renderVegetation();
            if (typeof showToast === "function") showToast("Vegetation area deleted", gisIcon("trash"));
          },
        },
        screenX,
        screenY,
      );
    });
    popupEl.querySelector("[data-gis-cut]").addEventListener("click", () => {
      hidePopup();
      startVegetationCut(props.id);
    });
    popupEl.querySelector("[data-gis-restore]")?.addEventListener("click", () => {
      gisClearVegetationCuts(props.id);
      hidePopup();
      renderVegetation();
      if (typeof logAudit === "function")
        logAudit("MAP_VEGETATION_RESTORE", `Vegetation area ${props.id} restored to full shape (cuts cleared)`, "info", "map");
      if (typeof showToast === "function") showToast("Vegetation area restored", gisIcon("refresh"));
    });
  }

  // Enters the special "vegetation-cut" draw tool scoped to one vegetation
  // area: the next polygon the user traces is subtracted (as a hole) from
  // that area's shape rather than creating a new feature.
  function startVegetationCut(vegId) {
    hideForm();
    state.drawTool = "vegetation-cut";
    state.cutTargetVegId = vegId;
    state.drawPoints = [];
    renderDrawPreview();
    updateDrawUI();
  }

  function showVegetationForm(existingId, existing, screenX, screenY) {
    hidePopup();
    // Creating: the vegetation kind comes from the draw panel selection.
    const presetMeta = !existingId ? GIS_VEGETATION_KIND_META[state.drawSubtype] : null;
    const kindRowHtml = presetMeta
      ? `<div class="gis-pin-form-static">${gisIcon(presetMeta.icon)} ${escapeHtml(presetMeta.label)}</div>`
      : `<label class="gis-pin-form-label">Type
          <select class="gis-pin-form-input" data-f="kind">${optionsHtml(GIS_VEGETATION_KIND_META, existing?.kind)}</select>
        </label>`;
    formEl.innerHTML = `
      <div class="gis-pin-form-title">${existingId ? "Edit Vegetation Area" : "Draw Vegetation Area"}</div>
      ${kindRowHtml}
      <label class="gis-pin-form-label">Notes
        <textarea class="gis-pin-form-input" data-f="notes" placeholder="Optional notes">${existing ? escapeHtml(existing.notes || "") : ""}</textarea>
      </label>
      <div class="gis-pin-form-actions">
        <button type="button" class="btn btn-sm btn-outline" data-gis-cancel>Cancel</button>
        <button type="button" class="btn btn-sm btn-gold" data-gis-save>Save Area</button>
      </div>
    `;
    formEl.hidden = false;
    positionFloatingEl(formEl, screenX, screenY, container);
    formEl.querySelector("[data-gis-cancel]").addEventListener("click", (e) => {
      e.stopPropagation();
      hideForm();
      if (!existingId) cancelDrawing();
    });
    formEl.querySelector("[data-gis-save]").addEventListener("click", (e) => {
      e.stopPropagation();
      const kind = presetMeta ? state.drawSubtype : formEl.querySelector('[data-f="kind"]').value;
      const notes = formEl.querySelector('[data-f="notes"]').value.trim();
      if (existingId) {
        gisUpdateCustomVegetation(existingId, kind, notes);
      } else {
        const ring = state.drawPoints.concat([state.drawPoints[0]]);
        gisAddCustomVegetation(ring, kind, notes);
        finishDrawing();
      }
      hideForm();
      renderVegetation();
      if (typeof showToast === "function") showToast("Vegetation area saved", gisIcon("wheat"));
    });
    formEl.addEventListener("click", (e) => e.stopPropagation());
  }

  // ───────── Construction areas (custom only) ─────────
  function constructionInfoHtml(props) {
    const statusMeta = GIS_CONSTRUCTION_STATUS_META[props.status] || { label: props.status };
    return `
      <div class="gis-popup-title">${gisIcon("cone")} ${escapeHtml(props.name || "Construction Area")}</div>
      <div class="gis-popup-cat">${escapeHtml(statusMeta.label)}</div>
      ${props.notes ? `<div class="gis-popup-notes">${escapeHtml(props.notes)}</div>` : ""}
    `;
  }

  function renderConstruction() {
    constructionLayer.innerHTML = "";
    if (!state.showConstruction) return;

    gisAllConstructionFeatures().forEach((feature) => {
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", gisGeometryToPath(feature.geometry, project));
      path.setAttribute("class", "gis-construction");
      path.setAttribute("stroke", `url(#${defsId}-construction-stripe)`);
      attachFeatureInteraction(path, {
        hoverHtml: () => constructionInfoHtml(feature.properties),
        onOpen: (evt) => {
          const svgRect = svg.getBoundingClientRect();
          showConstructionPopup(feature.properties, evt.clientX - svgRect.left, evt.clientY - svgRect.top);
        },
      });
      constructionLayer.appendChild(path);
    });
  }

  function showConstructionPopup(props, screenX, screenY) {
    popupEl.innerHTML =
      constructionInfoHtml(props) +
      `
      <button type="button" class="gis-popup-action" data-gis-edit>Edit</button>
      <button type="button" class="gis-popup-delete" data-gis-delete>Delete area</button>
    `;
    showEditPopup(screenX, screenY);
    popupEl.querySelector("[data-gis-edit]").addEventListener("click", () => {
      showConstructionForm(props.id, props, screenX, screenY);
    });
    popupEl.querySelector("[data-gis-delete]").addEventListener("click", () => {
      showDeleteConfirm(
        {
          title: "Delete this construction area?",
          message: `"${props.name || "Construction area"}" will be permanently removed from the map.`,
          onConfirm: () => {
            gisDeleteConstruction(props.id);
            renderConstruction();
            if (typeof showToast === "function") showToast("Construction area deleted", gisIcon("trash"));
          },
        },
        screenX,
        screenY,
      );
    });
  }

  function showConstructionForm(existingId, existing, screenX, screenY) {
    hidePopup();
    // Creating: the status comes from the draw panel selection.
    const presetMeta = !existingId ? GIS_CONSTRUCTION_STATUS_META[state.drawSubtype] : null;
    const statusOptions = optionsHtml(GIS_CONSTRUCTION_STATUS_META, existing?.status || "planned");
    const statusRowHtml = presetMeta
      ? `<div class="gis-pin-form-static">${gisIcon("cone")} ${escapeHtml(presetMeta.label)}</div>`
      : `<label class="gis-pin-form-label">Status
          <select class="gis-pin-form-input" data-f="status">${statusOptions}</select>
        </label>`;
    formEl.innerHTML = `
      <div class="gis-pin-form-title">${existingId ? "Edit Construction Area" : "Draw Construction Area"}</div>
      ${statusRowHtml}
      <label class="gis-pin-form-label">Name / Description
        <input type="text" class="gis-pin-form-input" data-f="name" placeholder="e.g. New barangay hall extension" value="${existing ? escapeHtml(existing.name || "") : ""}" />
      </label>
      <label class="gis-pin-form-label">Notes
        <textarea class="gis-pin-form-input" data-f="notes" placeholder="Optional notes">${existing ? escapeHtml(existing.notes || "") : ""}</textarea>
      </label>
      <div class="gis-pin-form-actions">
        <button type="button" class="btn btn-sm btn-outline" data-gis-cancel>Cancel</button>
        <button type="button" class="btn btn-sm btn-gold" data-gis-save>Save</button>
      </div>
    `;
    formEl.hidden = false;
    positionFloatingEl(formEl, screenX, screenY, container);
    formEl.querySelector("[data-gis-cancel]").addEventListener("click", (e) => {
      e.stopPropagation();
      hideForm();
      if (!existingId) cancelDrawing();
    });
    formEl.querySelector("[data-gis-save]").addEventListener("click", (e) => {
      e.stopPropagation();
      const name = formEl.querySelector('[data-f="name"]').value.trim();
      const status = presetMeta ? state.drawSubtype : formEl.querySelector('[data-f="status"]').value;
      const notes = formEl.querySelector('[data-f="notes"]').value.trim();
      if (!name) {
        formEl.querySelector('[data-f="name"]').focus();
        return;
      }
      if (existingId) {
        gisUpdateConstruction(existingId, name, status, notes);
      } else {
        const ring = state.drawPoints.concat([state.drawPoints[0]]);
        gisAddConstruction(ring, name, status, notes);
        finishDrawing();
      }
      hideForm();
      renderConstruction();
      if (typeof showToast === "function") showToast("Construction area saved", gisIcon("cone"));
    });
    formEl.addEventListener("click", (e) => e.stopPropagation());
  }

  // ───────── Hazard zones (custom only) ─────────
  function hazardInfoHtml(props) {
    const meta = GIS_HAZARD_TYPE_META[props.hazardType] || { label: props.hazardType, icon: "warningTriangle" };
    return `
      <div class="gis-popup-title">${gisIcon(meta.icon)} ${escapeHtml(meta.label)}</div>
      <div class="gis-popup-cat">Severity: ${escapeHtml(props.severity || "medium")}</div>
      ${props.notes ? `<div class="gis-popup-notes">${escapeHtml(props.notes)}</div>` : ""}
    `;
  }

  function renderHazards() {
    hazardLayer.innerHTML = "";
    if (!state.showHazard) return;

    gisAllHazardFeatures().forEach((feature) => {
      const hazardType = feature.properties.hazardType || "other";
      const severityClass = `gis-hazard-severity-${feature.properties.severity || "medium"}`;
      const [x, y] = project(...feature.geometry.coordinates);
      const el = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      el.setAttribute("cx", x);
      el.setAttribute("cy", y);
      el.setAttribute("r", feature.properties.radius || GIS_HAZARD_PING_RADIUS);
      el.setAttribute("fill", `url(#${defsId}-grad-${hazardType})`);
      el.setAttribute("class", `gis-hazard-ping ${severityClass}`);

      attachFeatureInteraction(el, {
        hoverHtml: () => hazardInfoHtml(feature.properties),
        onOpen: (evt) => {
          const svgRect = svg.getBoundingClientRect();
          showHazardPopup(feature.properties, evt.clientX - svgRect.left, evt.clientY - svgRect.top);
        },
      });
      hazardLayer.appendChild(el);
    });
  }

  // Accident/incident markers are drawn as a small vector icon (white disc +
  // stroke glyph) rather than emoji text, so they render identically across
  // platforms and scale cleanly with the icon set used everywhere else.
  function renderAccidents() {
    accidentsLayer.innerHTML = "";
    if (!state.showAccidents) return;

    gisAllAccidentFeatures().forEach((feature) => {
      const meta = GIS_ACCIDENT_TYPE_META[feature.properties.incidentType] || { icon: "alertCircle" };
      const [x, y] = project(...feature.geometry.coordinates);
      // Divide by zoom so the icon stays a constant, legible size on screen
      // regardless of zoom level (same reasoning as the draw-preview dots).
      const size = GIS_ACCIDENT_ICON_SIZE / state.zoom;
      const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
      g.setAttribute("class", "gis-accident-icon");
      g.setAttribute("transform", `translate(${x - size / 2} ${y - size / 2}) scale(${size / 24})`);
      g.innerHTML = `<circle cx="12" cy="12" r="11" class="gis-accident-icon-bg"></circle>${GIS_ICON_PATHS[meta.icon] || GIS_ICON_PATHS.alertCircle}`;

      attachFeatureInteraction(g, {
        hoverHtml: () => accidentInfoHtml(feature.properties),
        onOpen: (evt) => {
          const svgRect = svg.getBoundingClientRect();
          showAccidentPopup(feature.properties, evt.clientX - svgRect.left, evt.clientY - svgRect.top);
        },
      });
      accidentsLayer.appendChild(g);
    });
  }

  function accidentInfoHtml(props) {
    const meta = GIS_ACCIDENT_TYPE_META[props.incidentType] || { label: props.incidentType, icon: "alertCircle" };
    return `
      <div class="gis-popup-title">${gisIcon(meta.icon)} ${escapeHtml(meta.label)}</div>
      ${props.notes ? `<div class="gis-popup-notes">${escapeHtml(props.notes)}</div>` : ""}
    `;
  }

  function showHazardPopup(props, screenX, screenY) {
    popupEl.innerHTML =
      hazardInfoHtml(props) +
      `
      <button type="button" class="gis-popup-action" data-gis-edit>Edit</button>
      <button type="button" class="gis-popup-delete" data-gis-delete>Delete zone</button>
    `;
    showEditPopup(screenX, screenY);
    popupEl.querySelector("[data-gis-edit]").addEventListener("click", () => {
      showHazardForm(props.id, props, screenX, screenY);
    });
    popupEl.querySelector("[data-gis-delete]").addEventListener("click", () => {
      showDeleteConfirm(
        {
          title: "Delete this hazard zone?",
          message: "The hazard marker and its radius will be permanently removed from the map.",
          onConfirm: () => {
            gisDeleteHazard(props.id);
            renderHazards();
            if (typeof showToast === "function") showToast("Hazard zone deleted", gisIcon("trash"));
          },
        },
        screenX,
        screenY,
      );
    });
  }

  function showHazardForm(existingId, existing, screenX, screenY, pingData) {
    hidePopup();
    // Creating (pingData set): the hazard type comes from the draw panel.
    const presetMeta = !existingId ? GIS_HAZARD_TYPE_META[state.drawSubtype] : null;
    const severityOptions = ["low", "medium", "high"]
      .map((s) => `<option value="${s}" ${(existing?.severity || "medium") === s ? "selected" : ""}>${s[0].toUpperCase() + s.slice(1)}</option>`)
      .join("");
    const title = existingId ? "Edit Hazard Zone" : "Mark Hazard Area";
    const typeRowHtml = presetMeta
      ? `<div class="gis-pin-form-static">${gisIcon(presetMeta.icon)} ${escapeHtml(presetMeta.label)}</div>`
      : `<label class="gis-pin-form-label">Hazard Type
          <select class="gis-pin-form-input" data-f="type">${optionsHtml(GIS_HAZARD_TYPE_META, existing?.hazardType)}</select>
        </label>`;
    formEl.innerHTML = `
      <div class="gis-pin-form-title">${title}</div>
      ${typeRowHtml}
      <label class="gis-pin-form-label">Severity
        <select class="gis-pin-form-input" data-f="severity">${severityOptions}</select>
      </label>
      <label class="gis-pin-form-label">Notes
        <textarea class="gis-pin-form-input" data-f="notes" placeholder="Optional notes">${existing ? escapeHtml(existing.notes || "") : ""}</textarea>
      </label>
      <div class="gis-pin-form-actions">
        <button type="button" class="btn btn-sm btn-outline" data-gis-cancel>Cancel</button>
        <button type="button" class="btn btn-sm btn-gold" data-gis-save>Save Hazard</button>
      </div>
    `;
    formEl.hidden = false;
    positionFloatingEl(formEl, screenX, screenY, container);
    formEl.querySelector("[data-gis-cancel]").addEventListener("click", (e) => {
      e.stopPropagation();
      hideForm();
    });
    formEl.querySelector("[data-gis-save]").addEventListener("click", (e) => {
      e.stopPropagation();
      const hazardType = presetMeta ? state.drawSubtype : formEl.querySelector('[data-f="type"]').value;
      const severity = formEl.querySelector('[data-f="severity"]').value;
      const notes = formEl.querySelector('[data-f="notes"]').value.trim();
      if (existingId) {
        gisUpdateHazard(existingId, hazardType, severity, notes);
      } else if (pingData) {
        gisAddHazardPing(pingData.point, pingData.radius, hazardType, severity, notes);
      }
      hideForm();
      renderHazards();
      if (typeof showToast === "function") showToast("Hazard zone saved", gisIcon("warningTriangle"));
    });
    formEl.addEventListener("click", (e) => e.stopPropagation());
  }

  function showAccidentPopup(props, screenX, screenY) {
    popupEl.innerHTML =
      accidentInfoHtml(props) +
      `
      <button type="button" class="gis-popup-action" data-gis-edit>Edit</button>
      <button type="button" class="gis-popup-delete" data-gis-delete>Delete marker</button>
    `;
    showEditPopup(screenX, screenY);
    popupEl.querySelector("[data-gis-edit]").addEventListener("click", () => {
      showAccidentForm(props.id, props, screenX, screenY);
    });
    popupEl.querySelector("[data-gis-delete]").addEventListener("click", () => {
      showDeleteConfirm(
        {
          title: "Delete this accident marker?",
          message: "The incident marker will be permanently removed from the map.",
          onConfirm: () => {
            gisDeleteAccident(props.id);
            renderAccidents();
            if (typeof showToast === "function") showToast("Accident marker deleted", gisIcon("trash"));
          },
        },
        screenX,
        screenY,
      );
    });
  }

  function showAccidentForm(existingId, existing, screenX, screenY, pingPoint) {
    hidePopup();
    // Creating (pingPoint set): the incident type comes from the draw panel.
    const presetMeta = !existingId ? GIS_ACCIDENT_TYPE_META[state.drawSubtype] : null;
    const title = existingId ? "Edit Accident Marker" : "Mark Accident";
    const typeRowHtml = presetMeta
      ? `<div class="gis-pin-form-static">${gisIcon(presetMeta.icon)} ${escapeHtml(presetMeta.label)}</div>`
      : `<label class="gis-pin-form-label">Incident Type
          <select class="gis-pin-form-input" data-f="type">${optionsHtml(GIS_ACCIDENT_TYPE_META, existing?.incidentType)}</select>
        </label>`;
    formEl.innerHTML = `
      <div class="gis-pin-form-title">${title}</div>
      ${typeRowHtml}
      <label class="gis-pin-form-label">Notes
        <textarea class="gis-pin-form-input" data-f="notes" placeholder="Optional notes">${existing ? escapeHtml(existing.notes || "") : ""}</textarea>
      </label>
      <div class="gis-pin-form-actions">
        <button type="button" class="btn btn-sm btn-outline" data-gis-cancel>Cancel</button>
        <button type="button" class="btn btn-sm btn-gold" data-gis-save>Save</button>
      </div>
    `;
    formEl.hidden = false;
    positionFloatingEl(formEl, screenX, screenY, container);
    formEl.querySelector("[data-gis-cancel]").addEventListener("click", (e) => {
      e.stopPropagation();
      hideForm();
    });
    formEl.querySelector("[data-gis-save]").addEventListener("click", (e) => {
      e.stopPropagation();
      const incidentType = presetMeta ? state.drawSubtype : formEl.querySelector('[data-f="type"]').value;
      const notes = formEl.querySelector('[data-f="notes"]').value.trim();
      if (existingId) {
        gisUpdateAccident(existingId, incidentType, notes);
      } else if (pingPoint) {
        gisAddAccident(pingPoint, incidentType, notes);
      }
      hideForm();
      renderAccidents();
      if (typeof showToast === "function") showToast("Accident marked", gisIcon("siren"));
    });
    formEl.addEventListener("click", (e) => e.stopPropagation());
  }

  // ───────── Community Reports (resident-submitted concern pins) ─────────
  function renderReports() {
    reportsLayer.innerHTML = "";
    if (state.showReports) {
      gisAllReportFeatures().forEach((feature) => {
        const props = feature.properties;
        // Resolved concerns drop off the map — they live on only in the history.
        if (props.resolved) return;
        const [x, y] = project(...feature.geometry.coordinates);
        // Constant on-screen size (same trick as accidents), but translated so
        // the pin's TIP — not its center — sits on the reported location.
        const size = GIS_REPORT_ICON_SIZE / state.zoom;
        const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
        g.setAttribute("class", "gis-report-pin");
        g.setAttribute("transform", `translate(${x - size / 2} ${y - size}) scale(${size / 24})`);
        g.innerHTML = GIS_ICON_PATHS.pin;
        attachReportInteraction(g, props);
        reportsLayer.appendChild(g);
      });
    }
    // The incident modal's "pick a location" marker — drawn on top of the
    // report pins (and independent of the reports layer's visibility) so the
    // resident can always see the spot they just chose.
    if (state.pickMode && state.pickPoint) {
      const [x, y] = project(...state.pickPoint);
      const size = GIS_REPORT_ICON_SIZE / state.zoom;
      const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
      g.setAttribute("class", "gis-report-pin gis-pick-pin");
      g.setAttribute("transform", `translate(${x - size / 2} ${y - size}) scale(${size / 24})`);
      g.innerHTML = GIS_ICON_PATHS.pin;
      reportsLayer.appendChild(g);
    }
  }

  function reportHoverHtml(props) {
    const meta = GIS_REPORT_TYPE_META[props.reportType] || GIS_REPORT_TYPE_META.other;
    const comment = props.comment || "";
    const truncated = comment.length > 90 ? comment.slice(0, 90).trimEnd() + "…" : comment;
    // Anonymous embeds omit the reporter's name — just "a resident".
    const reportedBy = anonymous ? "a resident" : props.reporter?.name || "Resident";
    return `
      <div class="gis-popup-title">${gisIcon(meta.icon)} ${escapeHtml(props.title || meta.label)}</div>
      <div class="gis-popup-cat">Reported by ${escapeHtml(reportedBy)} · ${escapeHtml(gisTimeAgo(props.createdAt))}</div>
      ${truncated ? `<div class="gis-popup-notes">${escapeHtml(truncated)}</div>` : ""}
      <button type="button" class="gis-popup-action" data-gis-report-more>See more</button>
    `;
  }

  // Hover card + "See more" wiring, shared by pin hover and the report feed's
  // flyToReport.
  function openReportHoverCard(props, screenX, screenY) {
    showHoverCard(reportHoverHtml(props), screenX, screenY);
    popupEl.querySelector("[data-gis-report-more]")?.addEventListener("click", (e) => {
      e.stopPropagation();
      // Expand in place — reuse the card's current position.
      const left = parseFloat(popupEl.style.left) || 0;
      const top = parseFloat(popupEl.style.top) || 0;
      showExpandedReportCard(props, left, top + 10);
    });
  }

  // Full-detail card: complete comment, submission time, and the reporter's
  // details (avatar/name/role/purok). Stays open until explicitly dismissed.
  function showExpandedReportCard(props, screenX, screenY) {
    const meta = GIS_REPORT_TYPE_META[props.reportType] || GIS_REPORT_TYPE_META.other;
    const reporter = props.reporter || {};
    const when = props.createdAt
      ? new Date(props.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
      : "";
    // Anonymous embeds show a generic reporter identity only.
    const reporterName = anonymous ? "Resident" : reporter.name || "Resident";
    const reporterInitials = anonymous ? "R" : reporter.initials || (reporter.name || "?").charAt(0);
    const reporterSub = anonymous
      ? "Community report"
      : [reporter.role || "Resident", reporter.purok].filter(Boolean).join(" · ");
    popupEl.innerHTML = `
      <button type="button" class="gis-popup-close" data-gis-report-close aria-label="Close report details">${gisIcon("cancelX")}</button>
      <div class="gis-report-card-head">
        <div class="gis-report-avatar">${escapeHtml(reporterInitials)}</div>
        <div class="gis-report-reporter">
          <div class="gis-report-reporter-name">${escapeHtml(reporterName)}</div>
          <div class="gis-report-reporter-sub">${escapeHtml(reporterSub)}</div>
        </div>
      </div>
      <div class="gis-popup-title">${gisIcon(meta.icon)} ${escapeHtml(props.title || meta.label)}</div>
      <div class="gis-popup-cat">${escapeHtml(meta.label)}${when ? ` · ${escapeHtml(when)}` : ""}</div>
      ${props.comment ? `<div class="gis-popup-notes">${escapeHtml(props.comment)}</div>` : ""}
      ${
        // Resolving is a plain moderation action available to MIS staff any time
        // (no need to arm Edit Mode); deleting stays gated behind Edit Mode as a
        // destructive action. Public/anonymous embeds get neither.
        editable && (!props.resolved || state.editMode)
          ? `<div class="gis-popup-actions-row">
               ${props.resolved ? "" : `<button type="button" class="gis-popup-resolve" data-gis-report-resolve>${gisIcon("check")} Mark as resolved</button>`}
               ${state.editMode ? `<button type="button" class="gis-popup-delete" data-gis-report-delete>Delete report</button>` : ""}
             </div>`
          : ""
      }
    `;
    popupEl.classList.remove("gis-popup-readonly");
    popupEl.classList.add("gis-popup-hoverable", "gis-popup-expanded");
    popupEl.hidden = false;
    cancelHidePopup();
    positionFloatingEl(popupEl, screenX, screenY, container);
    clampPopupToContainer();

    popupEl.querySelector("[data-gis-report-close]").addEventListener("click", (e) => {
      e.stopPropagation();
      hidePopup();
    });
    // Staff moderation: resolving clears the pin off the map and out of the
    // active feed; it remains in the View All history where it can be reopened.
    popupEl.querySelector("[data-gis-report-resolve]")?.addEventListener("click", () => {
      gisSetCommunityReportResolved(props.id, true);
      hidePopup();
      renderReports();
      if (typeof renderReportFeed === "function") renderReportFeed();
      if (typeof showToast === "function") showToast("Concern marked as resolved", gisIcon("check"));
    });
    // Staff moderation: deletable from the MIS embed while edit mode is on.
    popupEl.querySelector("[data-gis-report-delete]")?.addEventListener("click", () => {
      showDeleteConfirm(
        {
          title: "Delete this community report?",
          message: `"${props.title || "This report"}" by ${props.reporter?.name || "a resident"} will be permanently removed.`,
          onConfirm: () => {
            gisDeleteCommunityReport(props.id);
            renderReports();
            // Keep the MIS GIS page's "Recent Community Reports" feed in sync.
            if (typeof renderReportFeed === "function") renderReportFeed();
            if (typeof showToast === "function") showToast("Community report deleted", gisIcon("trash"));
          },
        },
        screenX,
        screenY,
      );
    });
  }

  function attachReportInteraction(g, props) {
    g.classList.add("gis-interactive-feature");
    g.addEventListener("mouseenter", (evt) => {
      if (state.drawTool || state.reportMode || state.pickMode || expandedCardOpen()) return;
      cancelHidePopup();
      const svgRect = svg.getBoundingClientRect();
      openReportHoverCard(props, evt.clientX - svgRect.left, evt.clientY - svgRect.top);
    });
    g.addEventListener("mouseleave", () => {
      if (expandedCardOpen()) return;
      scheduleHidePopup();
    });
    // Click (and tap — touch devices have no hover) opens the full card
    // directly; doubles as a shortcut past the hover step.
    g.addEventListener("click", (evt) => {
      if (state.drawTool || state.reportMode || state.pickMode) return;
      evt.stopPropagation();
      const svgRect = svg.getBoundingClientRect();
      showExpandedReportCard(props, evt.clientX - svgRect.left, evt.clientY - svgRect.top);
    });
  }

  // ── Report placement mode — a one-shot, resident-safe pin drop. Fully
  // independent of editMode/drawTool so public embeds never expose editing.
  function updateReportModeUI() {
    container.classList.toggle("gis-reporting", state.reportMode);
    reportHintEl.hidden = !state.reportMode;
    reportHintEl.textContent = state.reportMode
      ? "Click the spot on the map where the concern is located — Esc to cancel."
      : "";
  }

  function beginCommunityReport(reporter) {
    state.reportMode = true;
    state.pendingReporter = reporter || null;
    hidePopup();
    hideForm();
    updateReportModeUI();
  }

  function cancelCommunityReport() {
    state.reportMode = false;
    state.pendingReporter = null;
    hideForm();
    updateReportModeUI();
  }

  // ── Location-pick mode — a lightweight point picker used by the "File an
  // Incident" modal's embedded map. Unlike beginCommunityReport (which opens
  // the map's own concern form on click), this only captures a coordinate,
  // drops a marker, and reports it back through the callback; the modal owns
  // the form and the actual persistence. Re-clicking moves the marker.
  function updatePickModeUI() {
    container.classList.toggle("gis-reporting", state.pickMode);
    reportHintEl.hidden = !state.pickMode;
    reportHintEl.textContent = state.pickMode
      ? "Click the spot on the map where the incident happened."
      : "";
  }

  function beginLocationPick(onPick) {
    state.pickMode = true;
    state.pickCallback = typeof onPick === "function" ? onPick : null;
    state.pickPoint = null;
    hidePopup();
    hideForm();
    updatePickModeUI();
    renderReports();
  }

  function endLocationPick() {
    state.pickMode = false;
    state.pickCallback = null;
    state.pickPoint = null;
    updatePickModeUI();
    renderReports();
  }

  function showCommunityReportForm(point, screenX, screenY) {
    hidePopup();
    formEl.innerHTML = `
      <div class="gis-pin-form-title">Report a Concern</div>
      <label class="gis-pin-form-label">Concern Type
        <select class="gis-pin-form-input" data-f="type">${optionsHtml(GIS_REPORT_TYPE_META)}</select>
      </label>
      <label class="gis-pin-form-label">Title
        <input type="text" class="gis-pin-form-input" data-f="title" placeholder="e.g. Blocked drainage canal" />
      </label>
      <label class="gis-pin-form-label">Comment (optional)
        <textarea class="gis-pin-form-input" data-f="comment" placeholder="Add more details about the concern"></textarea>
      </label>
      <div class="gis-pin-form-actions">
        <button type="button" class="btn btn-sm btn-outline" data-gis-cancel>Cancel</button>
        <button type="button" class="btn btn-sm btn-gold" data-gis-save>Submit Report</button>
      </div>
    `;
    formEl.hidden = false;
    positionFloatingEl(formEl, screenX, screenY, container);

    formEl.querySelector("[data-gis-cancel]").addEventListener("click", (e) => {
      e.stopPropagation();
      cancelCommunityReport();
    });
    formEl.querySelector("[data-gis-save]").addEventListener("click", (e) => {
      e.stopPropagation();
      const reportType = formEl.querySelector('[data-f="type"]').value;
      const title = formEl.querySelector('[data-f="title"]').value.trim();
      const comment = formEl.querySelector('[data-f="comment"]').value.trim();
      if (!title) {
        formEl.querySelector('[data-f="title"]').focus();
        return;
      }
      gisAddCommunityReport(point, { reportType, title, comment, reporter: state.pendingReporter });
      cancelCommunityReport();
      renderReports();
      if (typeof renderReportFeed === "function") renderReportFeed();
      if (typeof showToast === "function") showToast("Concern reported — thank you!", gisIcon("pin"));
    });
    formEl.addEventListener("click", (e) => e.stopPropagation());
  }

  // ───────── Drawing engine (shared by building/road/vegetation/construction/hazard) ─────────
  // Derives the four (optionally rotated) corners of the square preview from
  // the two placed corners — or the first corner plus the live hover point —
  // in both local (projected) and lng/lat space. Returns null until there are
  // two corners to work with. centerLocal is the un-rotated box centre, so the
  // rotate handle can pivot around it.
  function computeSquareCorners() {
    if (!isSquareMode() || state.drawPoints.length < 1) return null;
    const secondSrc = state.drawPoints.length >= 2 ? state.drawPoints[1] : state.squareHover;
    if (!secondSrc) return null;
    const [ax, ay] = project(...state.drawPoints[0]);
    const [bx, by] = project(...secondSrc);
    const cx = (ax + bx) / 2;
    const cy = (ay + by) / 2;
    const box = [
      [ax, ay],
      [bx, ay],
      [bx, by],
      [ax, by],
    ];
    const cos = Math.cos(state.squareRotation);
    const sin = Math.sin(state.squareRotation);
    const rot = ([x, y]) => {
      const dx = x - cx;
      const dy = y - cy;
      return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos];
    };
    const localCorners = box.map(rot);
    const lnglatCorners = localCorners.map((p) => project.invert(p));
    const topMidUnrot = [(ax + bx) / 2, Math.min(ay, by)];
    return {
      localCorners,
      lnglatCorners,
      centerLocal: [cx, cy],
      topEdgeMid: rot(topMidUnrot),
      handlePos: rot([topMidUnrot[0], topMidUnrot[1] - 26 / state.zoom]),
    };
  }

  function gisSvgEl(tag, attrs) {
    const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const k in attrs) el.setAttribute(k, attrs[k]);
    return el;
  }

  // Renders the square/rectangle preview: the (rotated) outline, a dot at each
  // corner, a meter label on each edge, and — once both corners are down — a
  // rotate handle above the shape that the user drags to spin it before Finish.
  function renderSquarePreview() {
    if (state.drawPoints.length === 1 && !state.squareHover) {
      const [x, y] = project(...state.drawPoints[0]);
      drawPreviewLayer.appendChild(
        gisSvgEl("circle", { cx: x, cy: y, r: 3 / state.zoom, class: "gis-draw-preview-vertex" }),
      );
      return;
    }
    const sq = computeSquareCorners();
    if (!sq) return;
    const { localCorners, lnglatCorners } = sq;
    const placed = state.drawPoints.length >= 2; // both corners locked in

    const d = "M" + localCorners.map((p) => p.join(",")).join("L") + "Z";
    const boxPath = gisSvgEl("path", { d, class: "gis-draw-preview-shape" });
    // Once placed, hold-and-drag inside the box moves the whole square.
    if (placed) {
      boxPath.classList.add("gis-draw-shape-movable");
      boxPath.addEventListener("mousedown", startShapeMove);
    }
    drawPreviewLayer.appendChild(boxPath);

    localCorners.forEach(([x, y], i) => {
      const dot = gisSvgEl("circle", {
        cx: x,
        cy: y,
        r: (placed ? 5 : 3) / state.zoom,
        class: "gis-draw-preview-vertex" + (placed ? " gis-draw-point-draggable" : ""),
      });
      // Corners stay editable after placement: dragging one resizes the box
      // while its diagonal opposite stays pinned (rotation is preserved).
      if (placed) {
        dot.addEventListener("mousedown", (e) => {
          if (e.button !== 0) return; // right-drag should still pan
          e.stopPropagation();
          e.preventDefault();
          squareCornerDrag = { anchorLocal: localCorners[(i + 2) % 4] };
          suppressClickAdd = true;
        });
      }
      drawPreviewLayer.appendChild(dot);
    });

    for (let i = 0; i < 4; i++) {
      const a = i;
      const b = (i + 1) % 4;
      const meters = gisHaversineMeters(lnglatCorners[a], lnglatCorners[b]);
      const label = gisSvgEl("text", {
        x: (localCorners[a][0] + localCorners[b][0]) / 2,
        y: (localCorners[a][1] + localCorners[b][1]) / 2 - 6 / state.zoom,
        "font-size": 16 / state.zoom,
        class: "gis-draw-segment-label",
      });
      label.textContent = gisFormatDistance(meters);
      drawPreviewLayer.appendChild(label);
    }

    // Rotate handle only after the box is locked in (two real corners).
    if (state.drawPoints.length >= 2) {
      const [tx, ty] = sq.topEdgeMid;
      const [hx, hy] = sq.handlePos;
      const s = 13 / state.zoom / 24;
      const handle = gisSvgEl("g", { class: "gis-draw-rotate-handle" });
      handle.innerHTML =
        `<line x1="${tx}" y1="${ty}" x2="${hx}" y2="${hy}" class="gis-draw-rotate-stem"/>` +
        `<circle cx="${hx}" cy="${hy}" r="${9 / state.zoom}" class="gis-draw-rotate-handle-bg"/>` +
        `<g transform="translate(${hx} ${hy}) scale(${s}) translate(-12 -12)" class="gis-draw-rotate-handle-icon">${GIS_ICON_PATHS.rotate}</g>`;
      handle.addEventListener("mousedown", (e) => {
        if (e.button !== 0) return; // right-drag should still pan
        e.stopPropagation();
        e.preventDefault();
        rotatingSquare = true;
        suppressClickAdd = true;
      });
      drawPreviewLayer.appendChild(handle);
    }
  }

  function renderDrawPreview() {
    drawPreviewLayer.innerHTML = "";

    if (state.drawTool === "hazard-ping" && state.pingCenter) {
      const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      circle.setAttribute("cx", state.pingCenter.localX);
      circle.setAttribute("cy", state.pingCenter.localY);
      circle.setAttribute("r", state.pingRadius);
      circle.setAttribute("class", "gis-draw-preview-ping");
      drawPreviewLayer.appendChild(circle);

      const center = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      center.setAttribute("cx", state.pingCenter.localX);
      center.setAttribute("cy", state.pingCenter.localY);
      center.setAttribute("r", 3 / state.zoom);
      center.setAttribute("class", "gis-draw-preview-vertex");
      drawPreviewLayer.appendChild(center);
      return;
    }

    if (isSquareMode() && state.drawPoints.length >= 1) {
      renderSquarePreview();
      return;
    }

    if (!state.drawTool || state.drawPoints.length === 0) return;

    const pts = state.drawPoints.map(([lng, lat]) => project(lng, lat));
    const isLine = state.drawTool === "road" || state.drawTool === "measure";
    const isPolygon = !isLine;
    const pathData =
      "M" + pts.map((p) => p.join(",")).join("L") + (isPolygon && pts.length > 2 ? "Z" : "");

    const previewPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
    previewPath.setAttribute("d", pathData);
    // A road (or measurement) is a line, not an area — SVG fills any path
    // (even an open one) by implicitly connecting the last point back to the
    // first, so without this the in-progress preview shows a bogus
    // filled-in shape. The cut tool gets its own (red) style so it reads as
    // "remove" rather than "add".
    let previewCls = isPolygon ? "gis-draw-preview-shape" : "gis-draw-preview-line";
    if (state.drawTool === "vegetation-cut") previewCls = "gis-draw-preview-cut";
    else if (state.drawTool === "measure") previewCls = "gis-draw-preview-measure";
    previewPath.setAttribute("class", previewCls);
    // Once a polygon has actually closed into a shape, its interior becomes a
    // grab surface: hold and drag anywhere inside to move the whole shape. A
    // clean click inside (no movement) still adds a vertex as before.
    if (isPolygon && pts.length > 2) {
      previewPath.classList.add("gis-draw-shape-movable");
      previewPath.addEventListener("mousedown", startShapeMove);
    }
    drawPreviewLayer.appendChild(previewPath);

    pts.forEach((p, i) => {
      const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      dot.setAttribute("cx", p[0]);
      dot.setAttribute("cy", p[1]);
      // Divide by the current zoom so the dot stays a small, constant size on
      // screen regardless of how far zoomed in the map is (otherwise a fixed
      // radius in local map units balloons into a giant circle at high zoom).
      // Slightly bigger than a plain marker since it's a drag/click target.
      dot.setAttribute("r", 5 / state.zoom);
      dot.setAttribute("class", "gis-draw-preview-vertex gis-draw-point-draggable");
      // Every placed point can be dragged to a new spot, or clicked in place
      // (no movement) to delete it — resolved on mouseup by pointDragMoved.
      dot.addEventListener("mousedown", (e) => {
        if (e.button !== 0) return; // right-drag should still pan
        e.stopPropagation(); // don't start a pan or reach the svg's click
        e.preventDefault();
        pointDragIndex = i;
        pointDragMoved = false;
        gestureStart = { x: e.clientX, y: e.clientY };
        suppressClickAdd = true;
      });
      drawPreviewLayer.appendChild(dot);
    });

    // Live dimensions — every drawn edge gets a meter label at its midpoint
    // (polygons also preview the closing edge once it exists). Font size is
    // divided by zoom, like the vertex dots, to stay constant on screen.
    const segments = [];
    for (let i = 1; i < pts.length; i++) segments.push([i - 1, i]);
    if (isPolygon && pts.length > 2) segments.push([pts.length - 1, 0]);
    segments.forEach(([a, b]) => {
      const meters = gisHaversineMeters(state.drawPoints[a], state.drawPoints[b]);
      const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
      label.setAttribute("x", (pts[a][0] + pts[b][0]) / 2);
      label.setAttribute("y", (pts[a][1] + pts[b][1]) / 2 - 6 / state.zoom);
      label.setAttribute("font-size", 16 / state.zoom);
      label.setAttribute("class", "gis-draw-segment-label");
      label.textContent = gisFormatDistance(meters);
      drawPreviewLayer.appendChild(label);
    });

    if (state.drawTool === "measure" && pts.length) {
      const last = pts[pts.length - 1];
      const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
      label.setAttribute("x", last[0] + 10 / state.zoom);
      label.setAttribute("y", last[1] - 10 / state.zoom);
      // Divide by zoom (same reasoning as the vertex dots) so the label
      // stays a large, constant, legible size on screen at any zoom level.
      label.setAttribute("font-size", 26 / state.zoom);
      label.setAttribute("class", "gis-draw-measure-label");
      label.textContent = gisFormatDistance(gisMeasureDistance(state.drawPoints));
      drawPreviewLayer.appendChild(label);
    }
  }

  // Sums great-circle distance across consecutive lng/lat points.
  function gisMeasureDistance(points) {
    let total = 0;
    for (let i = 1; i < points.length; i++) total += gisHaversineMeters(points[i - 1], points[i]);
    return total;
  }

  function updateDrawUI() {
    if (!editable) return;
    drawPanelEl.querySelectorAll("[data-gis-draw-tool]").forEach((btn) => {
      const subtype = btn.getAttribute("data-gis-draw-subtype") || null;
      btn.classList.toggle(
        "active",
        btn.getAttribute("data-gis-draw-tool") === state.drawTool && subtype === state.drawSubtype,
      );
    });
    // Element rows: highlight the one whose types panel is open, and the one
    // holding the armed tool.
    drawPanelEl.querySelectorAll("[data-gis-draw-group]").forEach((btn) => {
      const group = btn.getAttribute("data-gis-draw-group");
      btn.classList.toggle("open", openTypesGroup === group);
      btn.classList.toggle("armed", state.drawTool === group);
    });
    // A square is finishable once its two corners are down; freeform shapes use
    // their per-tool minimum vertex count.
    const min = isSquareMode() ? 2 : state.drawTool ? MIN_POINTS[state.drawTool] : Infinity;
    drawFinishBtn.hidden = !(state.drawTool && state.drawPoints.length >= min);
    drawCancelBtn.hidden = !(state.drawTool && (state.drawPoints.length > 0 || state.pingCenter));
    // The Finish/Cancel box only shows while it has something to offer.
    actionsPanelEl.hidden = drawFinishBtn.hidden && drawCancelBtn.hidden;
    deselectBtn.hidden = !state.drawTool;
    drawHintEl.hidden = !state.drawTool;
    drawHintEl.textContent = !state.drawTool
      ? ""
      : isSquareMode()
        ? DRAW_HINTS.square
        : DRAW_HINTS[state.drawTool] || "";
    // Running distance chips sit above the legend (bottom-left) so they never
    // crowd the Add to Map dock; the offset tracks the legend's live height.
    const measuring = state.drawTool === "measure" && state.drawPoints.length > 1;
    measureReadoutEl.hidden = !measuring;
    if (measuring) {
      const parts = gisFormatDistanceParts(gisMeasureDistance(state.drawPoints));
      measureReadoutEl.innerHTML = parts.map((p) => `<span class="gis-measure-chip">${p}</span>`).join("");
      const legendH = legendEl ? legendEl.offsetHeight : 0;
      measureReadoutEl.style.bottom = `${legendH ? legendH + 18 : 10}px`;
    }
    container.classList.toggle("gis-drawing", !!state.drawTool);
  }

  function addDrawVertex(evt) {
    const svgPoint = gisScreenToSvg(svg, evt.clientX, evt.clientY);
    const [lng, lat] = project.invert(svgPoint);

    // Hazard ping is a two-click placement: first click sets the center and
    // starts sizing (tracked via mousemove below), second click locks in the
    // radius and opens the tag form.
    if (state.drawTool === "hazard-ping") {
      if (!state.pingCenter) {
        const [localX, localY] = project(lng, lat);
        state.pingCenter = { lng, lat, localX, localY };
        state.pingRadius = 0;
        renderDrawPreview();
        updateDrawUI();
      } else {
        const svgRect = svg.getBoundingClientRect();
        const finalRadius = Math.max(state.pingRadius, 15);
        const centerPoint = [state.pingCenter.lng, state.pingCenter.lat];
        state.pingCenter = null;
        renderDrawPreview();
        updateDrawUI();
        showHazardForm(null, null, evt.clientX - svgRect.left, evt.clientY - svgRect.top, {
          point: centerPoint,
          radius: finalRadius,
        });
      }
      return;
    }

    // Accident ping is a simple single-click placement — no area to size.
    if (state.drawTool === "accident-ping") {
      const svgRect = svg.getBoundingClientRect();
      showAccidentForm(null, null, evt.clientX - svgRect.left, evt.clientY - svgRect.top, [lng, lat]);
      return;
    }

    // Square mode is a two-click box: first click sets a corner, second sets
    // the opposite one. After that the shape is complete (rotate + Finish), so
    // further map clicks are ignored.
    if (isSquareMode()) {
      if (state.drawPoints.length >= 2) return;
      state.drawPoints.push([lng, lat]);
      if (state.drawPoints.length === 2) state.squareHover = null;
      renderDrawPreview();
      updateDrawUI();
      return;
    }

    state.drawPoints.push([lng, lat]);
    renderDrawPreview();
    updateDrawUI();
  }

  // While placing a square, the still-unplaced opposite corner tracks the
  // cursor so the box previews live between the two clicks.
  function updateSquareHover(evt) {
    if (!isSquareMode() || state.drawPoints.length !== 1) return;
    if (dragging || rotatingSquare || pointDragIndex !== null || squareCornerDrag || shapeDrag) return;
    const [x, y] = gisScreenToSvg(svg, evt.clientX, evt.clientY);
    state.squareHover = project.invert([x, y]);
    renderDrawPreview();
  }

  function updatePingRadius(evt) {
    if (state.drawTool !== "hazard-ping" || !state.pingCenter) return;
    const [x, y] = gisScreenToSvg(svg, evt.clientX, evt.clientY);
    const dx = x - state.pingCenter.localX;
    const dy = y - state.pingCenter.localY;
    state.pingRadius = Math.sqrt(dx * dx + dy * dy);
    renderDrawPreview();
  }

  function cancelDrawing() {
    state.drawPoints = [];
    state.pingCenter = null;
    state.pingRadius = 0;
    state.cutTargetVegId = null;
    state.squareRotation = 0;
    state.squareHover = null;
    renderDrawPreview();
    updateDrawUI();
    hideForm();
  }

  // Fully deselects whichever draw/ping tool is active — unlike cancelDrawing()
  // above, which only clears an in-progress shape but leaves the tool armed
  // for another attempt. Wired to the toolbar's Deselect button and Esc.
  function deselectTool() {
    state.drawTool = null;
    state.drawSubtype = null;
    cancelDrawing();
  }

  function finishDrawing() {
    state.drawPoints = [];
    renderDrawPreview();
    updateDrawUI();
  }

  // Converts a point in local/unscaled domain space (as produced by project())
  // into container-relative CSS pixels, accounting for the current pan/zoom
  // transform on the viewport group plus the outer <svg>'s viewBox scaling.
  function localToContainerPixels(localX, localY) {
    const pt = svg.createSVGPoint();
    pt.x = localX;
    pt.y = localY;
    const screenPt = pt.matrixTransform(viewport.getScreenCTM());
    const svgRect = svg.getBoundingClientRect();
    return [screenPt.x - svgRect.left, screenPt.y - svgRect.top];
  }

  function tryFinishShape() {
    if (!state.drawTool || state.drawTool === "hazard-ping" || state.drawTool === "accident-ping") return;
    // A square is defined by two corners plus a rotation; bake it down to a
    // normal four-point ring so the rest of the finish flow (which reads
    // state.drawPoints) treats it exactly like a freeform polygon.
    if (isSquareMode()) {
      const sq = computeSquareCorners();
      if (!sq || state.drawPoints.length < 2) return;
      state.drawPoints = sq.lnglatCorners;
      state.squareRotation = 0;
      state.squareHover = null;
    }
    const min = MIN_POINTS[state.drawTool];
    if (state.drawPoints.length < min) return;

    const [localX, localY] = project(...state.drawPoints[state.drawPoints.length - 1]);
    const [screenX, screenY] = localToContainerPixels(localX, localY);

    if (state.drawTool === "building") {
      const ring = state.drawPoints.concat([state.drawPoints[0]]);
      const id = gisAddCustomBuilding(ring);
      finishDrawing();
      renderBuildings();
      if (state.drawSubtype && state.drawSubtype !== "none") {
        showBuildingTagForm(id, null, screenX, screenY, state.drawSubtype);
      } else if (typeof showToast === "function") {
        // "No Tag" buildings are just an outline — nothing to fill in.
        showToast("Building outline added", gisIcon("building"));
      }
    } else if (state.drawTool === "road") {
      showRoadForm(null, null, screenX, screenY);
    } else if (state.drawTool === "vegetation") {
      showVegetationForm(null, null, screenX, screenY);
    } else if (state.drawTool === "construction") {
      showConstructionForm(null, null, screenX, screenY);
    } else if (state.drawTool === "hazard") {
      showHazardForm(null, null, screenX, screenY);
    } else if (state.drawTool === "vegetation-cut") {
      const ring = state.drawPoints.concat([state.drawPoints[0]]);
      gisAddVegetationCut(state.cutTargetVegId, ring);
      state.cutTargetVegId = null;
      finishDrawing();
      renderVegetation();
      if (typeof showToast === "function") showToast("Vegetation area trimmed", gisIcon("scissors"));
    } else if (state.drawTool === "measure") {
      // Nothing to save — Finish just ends the measuring session (same as
      // Deselect/Esc), clearing the traced line and its distance label.
      deselectTool();
    }
  }

  if (editable) {
    function armTool(tool, subtype) {
      const sameSelection = state.drawTool === tool && state.drawSubtype === subtype;
      state.drawTool = sameSelection ? null : tool;
      state.drawSubtype = sameSelection ? null : subtype;
      state.drawPoints = [];
      state.squareRotation = 0;
      state.squareHover = null;
      renderDrawPreview();
      updateDrawUI();
      hidePopup();
      hideForm();
    }

    // Clicking an element opens its types in a companion panel to the LEFT
    // of "Add to Map" (re-populated per element); picking a type there is
    // what arms the draw tool.
    function openTypesPanel(group) {
      const g = drawGroups.find((x) => x.tool === group);
      if (!g || !g.types) return;
      openTypesGroup = group;
      typesTitleEl.innerHTML = `${gisIcon(g.icon)} ${g.label}`;
      typesListEl.innerHTML = Object.entries(g.types)
        .map(
          ([key, m]) =>
            `<button type="button" class="gis-draw-type-btn" data-gis-draw-tool="${g.tool}" data-gis-draw-subtype="${key}">${m.icon ? gisIcon(m.icon) : ""} ${m.label}</button>`,
        )
        .join("");
      // Area tools offer a shape option (freeform outline vs a rotatable box)
      // in a companion panel stacked directly above this one; lines and point
      // pings can't be traced as a box, so the panel hides for them.
      const showShapePanel = SQUARE_TOOLS.has(g.tool);
      shapePanelEl
        .querySelectorAll("[data-gis-shape]")
        .forEach((b) => b.classList.toggle("active", b.getAttribute("data-gis-shape") === state.drawShape));
      // Re-toggle hidden even when already open so the fold-up animation
      // replays when switching between elements.
      typesPanelEl.hidden = true;
      shapePanelEl.hidden = true;
      void typesPanelEl.offsetWidth;
      typesPanelEl.hidden = false;
      shapePanelEl.hidden = !showShapePanel;
      updateDrawUI();
    }
    function closeTypesPanel() {
      openTypesGroup = null;
      typesPanelEl.hidden = true;
      shapePanelEl.hidden = true;
      typesListEl.innerHTML = "";
      updateDrawUI();
    }

    drawPanelEl.querySelectorAll("[data-gis-draw-group]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const group = btn.getAttribute("data-gis-draw-group");
        if (openTypesGroup === group) closeTypesPanel();
        else openTypesPanel(group);
      });
    });
    // Type buttons are re-rendered per element — delegate their clicks.
    typesListEl.addEventListener("click", (evt) => {
      const btn = evt.target.closest("[data-gis-draw-tool]");
      if (!btn) return;
      armTool(btn.getAttribute("data-gis-draw-tool"), btn.getAttribute("data-gis-draw-subtype") || null);
    });
    // Shape option (Freeform/Square): picking one just switches the trace mode
    // and resets any half-drawn shape — the tool stays armed (or unarmed).
    shapePanelEl.addEventListener("click", (evt) => {
      const shapeBtn = evt.target.closest("[data-gis-shape]");
      if (!shapeBtn) return;
      state.drawShape = shapeBtn.getAttribute("data-gis-shape");
      shapePanelEl
        .querySelectorAll("[data-gis-shape]")
        .forEach((b) => b.classList.toggle("active", b === shapeBtn));
      cancelDrawing();
    });
    // Static tools without types (Measure Distance).
    drawPanelEl.querySelectorAll(".gis-draw-main-panel [data-gis-draw-tool]").forEach((btn) => {
      btn.addEventListener("click", () => {
        armTool(btn.getAttribute("data-gis-draw-tool"), null);
      });
    });
    drawFinishBtn.addEventListener("click", tryFinishShape);
    drawCancelBtn.addEventListener("click", cancelDrawing);
    deselectBtn.addEventListener("click", deselectTool);
  }

  document.addEventListener("keydown", (evt) => {
    // Map shortcuts: Ctrl+E toggles Edit Mode, Ctrl+R resets the view
    // (suppressed while typing so form fields keep their native behavior).
    if ((evt.ctrlKey || evt.metaKey) && !evt.shiftKey && !evt.altKey) {
      const typing =
        /^(INPUT|TEXTAREA|SELECT)$/.test(evt.target.tagName) || evt.target.isContentEditable;
      const key = evt.key.toLowerCase();
      if (!typing && key === "e" && editable && editToggleBtn) {
        evt.preventDefault();
        editToggleBtn.click();
        return;
      }
      if (!typing && key === "r") {
        evt.preventDefault();
        resetView();
        return;
      }
    }
    if (evt.key === "Escape" && state.reportMode) {
      cancelCommunityReport();
      return;
    }
    if (evt.key === "Escape" && expandedCardOpen()) {
      hidePopup();
      return;
    }
    if (evt.key === "Escape" && state.groupSelect) {
      exitGroupSelect();
      return;
    }
    if (!state.drawTool) return;
    if (evt.key === "Escape") deselectTool();
    else if (evt.key === "Enter") tryFinishShape();
  });

  // Zooms while keeping the point (anchorX, anchorY) — in the outer <svg>'s
  // fixed 0..1000 viewBox space — visually stationary on screen. Without
  // this, scaling the inner group always grows from its origin (0,0),
  // flinging the content toward the top-left corner at higher zoom.
  function zoomAt(newZoomRaw, anchorX, anchorY) {
    const newZoom = Math.min(Math.max(newZoomRaw, minZoom), maxZoom);
    const localX = (anchorX - state.panX) / state.zoom;
    const localY = (anchorY - state.panY) / state.zoom;
    state.panX = anchorX - newZoom * localX;
    state.panY = anchorY - newZoom * localY;
    state.zoom = newZoom;
    applyTransform();
    renderScreenScaledMarkers();
  }

  function screenToViewBox(clientX, clientY) {
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const p = pt.matrixTransform(svg.getScreenCTM().inverse());
    return [p.x, p.y];
  }

  // ── Zoom controls ──
  container.querySelectorAll("[data-gis-zoom]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const action = btn.getAttribute("data-gis-zoom");
      if (action === "in") zoomAt(state.zoom * 1.3, 500, 500);
      else if (action === "out") zoomAt(state.zoom / 1.3, 500, 500);
      else resetView();
    });
  });

  // Dims legend entries for whichever layers are currently switched off, so
  // the legend (rendered by the host page, immediately after the map
  // container) always matches what's actually visible. No-op if the host
  // page doesn't have a `.gis-legend` there.
  function updateLegendDimStates() {
    if (!legendEl) return;
    const layerState = {
      buildings: state.showBuildings,
      vegetation: state.showVegetation,
      water: state.showWater,
      roads: state.showRoads,
      hazard: state.showHazard,
      construction: state.showConstruction,
      accidents: state.showAccidents,
      reports: state.showReports,
    };
    legendEl.querySelectorAll("[data-legend-layer]").forEach((el) => {
      el.classList.toggle("gis-legend-dim", layerState[el.getAttribute("data-legend-layer")] === false);
    });
  }

  // ── Layer toggles ──
  buildingsToggleBtn.addEventListener("click", () => {
    state.showBuildings = !state.showBuildings;
    buildingsToggleBtn.classList.toggle("active", state.showBuildings);
    renderBuildings();
    updateLegendDimStates();
  });
  roadsToggleBtn.addEventListener("click", () => {
    state.showRoads = !state.showRoads;
    roadsToggleBtn.classList.toggle("active", state.showRoads);
    renderRoads();
    updateLegendDimStates();
  });
  waterToggleBtn.addEventListener("click", () => {
    state.showWater = !state.showWater;
    waterToggleBtn.classList.toggle("active", state.showWater);
    renderWater();
    updateLegendDimStates();
  });
  vegetationToggleBtn.addEventListener("click", () => {
    state.showVegetation = !state.showVegetation;
    vegetationToggleBtn.classList.toggle("active", state.showVegetation);
    renderVegetation();
    updateLegendDimStates();
  });
  hazardToggleBtn.addEventListener("click", () => {
    state.showHazard = !state.showHazard;
    hazardToggleBtn.classList.toggle("active", state.showHazard);
    renderHazards();
    updateLegendDimStates();
  });
  constructionToggleBtn.addEventListener("click", () => {
    state.showConstruction = !state.showConstruction;
    constructionToggleBtn.classList.toggle("active", state.showConstruction);
    renderConstruction();
    updateLegendDimStates();
  });
  accidentsToggleBtn.addEventListener("click", () => {
    state.showAccidents = !state.showAccidents;
    accidentsToggleBtn.classList.toggle("active", state.showAccidents);
    renderAccidents();
    updateLegendDimStates();
  });
  reportsToggleBtn.addEventListener("click", () => {
    state.showReports = !state.showReports;
    reportsToggleBtn.classList.toggle("active", state.showReports);
    renderReports();
    updateLegendDimStates();
  });

  function renderWater() {
    waterLayer.innerHTML = "";
    if (!waterGeojson || !state.showWater) return;

    waterGeojson.features.forEach((feature) => {
      if (!featureInHomeExtent(feature)) return;
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", gisGeometryToPath(feature.geometry, project));
      const isLine = feature.geometry.type === "LineString" || feature.geometry.type === "MultiLineString";
      path.setAttribute("class", isLine ? "gis-water-line" : "gis-water-poly");
      waterLayer.appendChild(path);
    });
  }

  // ── Household search — looks up tagged buildings by name and pans/zooms
  // the map to center on a match. Available on every embed, since it's a
  // navigation aid rather than an editing capability. ──
  function flyToHousehold(rawId) {
    const feature = allBuildingFeatures().find((f) => String(f.properties.id) === String(rawId));
    if (!feature) return;
    const ring = feature.geometry.coordinates[0];
    const lngs = ring.map((p) => p[0]);
    const lats = ring.map((p) => p[1]);
    const centerLng = (Math.min(...lngs) + Math.max(...lngs)) / 2;
    const centerLat = (Math.min(...lats) + Math.max(...lats)) / 2;
    const [localX, localY] = project(centerLng, centerLat);
    state.zoom = Math.min(Math.max(state.zoom, 10), maxZoom);
    state.panX = 500 - state.zoom * localX;
    state.panY = 500 - state.zoom * localY;
    applyTransform();
    renderScreenScaledMarkers();
    const [screenX, screenY] = localToContainerPixels(localX, localY);
    showInfoPopup(buildingInfoHtml(feature.properties.id), screenX, screenY);
  }

  // Pans/zooms to a community report pin and opens its hover card — used by
  // the MIS GIS page's "Recent Community Reports" feed.
  function flyToReport(rawId) {
    const record = gisAllCommunityReports().find((r) => String(r.id) === String(rawId));
    if (!record) return;
    const [localX, localY] = project(record.point[0], record.point[1]);
    state.zoom = Math.min(Math.max(state.zoom, 10), maxZoom);
    state.panX = 500 - state.zoom * localX;
    state.panY = 500 - state.zoom * localY;
    applyTransform();
    renderScreenScaledMarkers();
    const [screenX, screenY] = localToContainerPixels(localX, localY);
    openReportHoverCard(record, screenX, screenY);
  }

  function renderSearchResults(query) {
    const q = query.trim().toLowerCase();
    if (!q) {
      searchResultsEl.hidden = true;
      searchResultsEl.innerHTML = "";
      return;
    }
    const tags = gisLoadBuildingTags();
    const matches = Object.entries(tags)
      .filter(([, tag]) => tag.name && tag.name.toLowerCase().includes(q))
      .slice(0, 8);
    if (!matches.length) {
      searchResultsEl.innerHTML = `<div class="gis-search-empty">No matching households</div>`;
      searchResultsEl.hidden = false;
      return;
    }
    searchResultsEl.innerHTML = matches
      .map(([id, tag]) => {
        const displayMeta = gisTagDisplayMeta(tag);
        return `<button type="button" class="gis-search-result" data-id="${escapeHtml(id)}">${gisIcon(displayMeta ? displayMeta.icon : "home")} <span>${escapeHtml(tag.name)}</span></button>`;
      })
      .join("");
    searchResultsEl.hidden = false;
  }

  if (searchWrapEl) {
    searchInputEl.addEventListener("input", () => renderSearchResults(searchInputEl.value));
    searchInputEl.addEventListener("focus", () => {
      if (searchInputEl.value) renderSearchResults(searchInputEl.value);
    });
    searchResultsEl.addEventListener("click", (evt) => {
      const btn = evt.target.closest("[data-id]");
      if (!btn) return;
      flyToHousehold(btn.getAttribute("data-id"));
      searchResultsEl.hidden = true;
      searchInputEl.value = "";
    });
    document.addEventListener("click", (evt) => {
      if (!searchWrapEl.contains(evt.target)) searchResultsEl.hidden = true;
    });
  }

  // ── Edit mode toggle — reveals the draw/ping tools as an animated
  // one-column dropdown anchored under the Edit Mode button. Turning edit
  // mode off also closes any open popup/form, since those are the only
  // places edit/delete actions live and shouldn't linger once editing ends.
  // Only wired up at all for editable (MIS) instances — public/resident
  // embeds never get this button in the first place.
  if (editable) {
    editToggleBtn.addEventListener("click", () => {
      state.editMode = !state.editMode;
      editToggleBtn.classList.toggle("active", state.editMode);
      drawPanelEl.hidden = !state.editMode;
      hidePopup();
      hideForm();
      if (!state.editMode) {
        exitGroupSelect();
        state.drawTool = null;
        state.drawSubtype = null;
        state.drawPoints = [];
        state.cutTargetVegId = null;
        state.squareRotation = 0;
        state.squareHover = null;
        openTypesGroup = null;
        typesPanelEl.hidden = true;
        shapePanelEl.hidden = true;
        typesListEl.innerHTML = "";
        renderDrawPreview();
        updateDrawUI();
      }
    });
  }

  // ── Pan (drag) — disabled only while actively placing vertices ──
  let dragging = false;
  let dragStart = null;
  let dragMoved = false; // did this drag actually move (vs. a stationary click)?
  let pointDragIndex = null; // index of the drawn point being dragged, if any
  let pointDragMoved = false; // moved past the slop, so it's a move — not a delete-click
  let gestureStart = null; // client coords where a point/shape gesture began (for the slop check)
  let squareCornerDrag = null; // { anchorLocal } — resizing the square by a corner
  let shapeDrag = null; // { startLocal, origPoints, moved } — moving a whole formed shape
  let rotatingSquare = false; // dragging the square's rotate handle
  let suppressClickAdd = false; // set by a drag/rotate/point-move so the trailing click doesn't drop a vertex
  // Mousedown inside a formed shape (freeform polygon or placed square) arms a
  // whole-shape move; it only becomes one once the cursor clears the slop, so
  // a clean click inside still falls through to the svg's click handler.
  function startShapeMove(e) {
    if (e.button !== 0) return; // right-drag should still pan
    e.preventDefault();
    shapeDrag = {
      startLocal: gisScreenToSvg(svg, e.clientX, e.clientY),
      origPoints: state.drawPoints.map((p) => p.slice()),
      moved: false,
    };
    gestureStart = { x: e.clientX, y: e.clientY };
  }
  function startPan(evt) {
    dragging = true;
    dragMoved = false;
    dragStart = { x: evt.clientX, y: evt.clientY, panX: state.panX, panY: state.panY };
  }
  svg.addEventListener("mousedown", (evt) => {
    // Stop the browser starting a text selection — otherwise dragging past
    // the map's edge highlights the surrounding page text.
    evt.preventDefault();
    suppressClickAdd = false;
    // Right-drag always pans, even while drawing or placing a report pin: it
    // never drops a vertex/pin (those are left-click only), so it's a safe
    // way to reposition the map mid-draw.
    if (evt.button === 2) {
      startPan(evt);
      return;
    }
    // Measure is special: left-drag pans too, and a point is only added on a
    // clean click (no movement). Dragging a point's marker is handled by the
    // marker's own mousedown (which stops propagation before reaching here).
    if (state.drawTool === "measure") {
      startPan(evt);
      return;
    }
    // Other draw tools / report mode: left-drag stays disabled so a drag can't
    // end in a click that places a point unintended.
    if (state.drawTool || state.reportMode) return;
    startPan(evt);
  });
  // Suppress the browser context menu across the whole map component (svg, its
  // overlays, and the card padding around them) so a right-drag pan never pops
  // a menu on release — text inputs keep theirs so right-click paste works.
  // Bind to the map card wrapper when the host page provides one, so a release
  // on the card's padding (just outside the svg) is covered too.
  (container.closest(".gis-map-card") || container).addEventListener("contextmenu", (evt) => {
    if (/^(INPUT|TEXTAREA)$/.test(evt.target.tagName) || evt.target.isContentEditable) return;
    evt.preventDefault();
  });
  // Same few-pixels-of-slop rule as panning: within it a gesture still counts
  // as a stationary click (delete a point / add a vertex), beyond it it's a drag.
  const pastSlop = (evt) =>
    gestureStart && (Math.abs(evt.clientX - gestureStart.x) > 3 || Math.abs(evt.clientY - gestureStart.y) > 3);
  window.addEventListener("mousemove", (evt) => {
    // Dragging a drawn point relocates it (live dimensions update as it moves).
    // Until the cursor clears the slop the point stays put, so a wobble-free
    // click leaves it in place for the delete check on mouseup.
    if (pointDragIndex !== null) {
      if (!pointDragMoved && !pastSlop(evt)) return;
      pointDragMoved = true;
      const [x, y] = gisScreenToSvg(svg, evt.clientX, evt.clientY);
      state.drawPoints[pointDragIndex] = project.invert([x, y]);
      renderDrawPreview();
      updateDrawUI();
      return;
    }
    // Dragging a placed square's corner resizes the box: the dragged corner
    // follows the cursor while its diagonal opposite stays pinned. The two
    // are un-rotated about their midpoint (the box centre — invariant under
    // rotation) to recover the axis-aligned pair drawPoints stores.
    if (squareCornerDrag) {
      const [mx, my] = gisScreenToSvg(svg, evt.clientX, evt.clientY);
      const [ax, ay] = squareCornerDrag.anchorLocal;
      const cx = (ax + mx) / 2;
      const cy = (ay + my) / 2;
      const cos = Math.cos(-state.squareRotation);
      const sin = Math.sin(-state.squareRotation);
      const unrot = ([x, y]) => [cx + (x - cx) * cos - (y - cy) * sin, cy + (x - cx) * sin + (y - cy) * cos];
      state.drawPoints = [project.invert(unrot([ax, ay])), project.invert(unrot([mx, my]))];
      renderDrawPreview();
      updateDrawUI();
      return;
    }
    // Holding inside a formed shape drags the whole thing: every point gets
    // the same local-space offset from where the hold began.
    if (shapeDrag) {
      if (!shapeDrag.moved && !pastSlop(evt)) return;
      shapeDrag.moved = true;
      const [mx, my] = gisScreenToSvg(svg, evt.clientX, evt.clientY);
      const dx = mx - shapeDrag.startLocal[0];
      const dy = my - shapeDrag.startLocal[1];
      state.drawPoints = shapeDrag.origPoints.map(([lng, lat]) => {
        const [x, y] = project(lng, lat);
        return project.invert([x + dx, y + dy]);
      });
      renderDrawPreview();
      updateDrawUI();
      return;
    }
    // Dragging the rotate handle spins the square around its centre so the
    // handle keeps pointing at the cursor.
    if (rotatingSquare) {
      const sq = computeSquareCorners();
      if (sq) {
        const [cx, cy] = sq.centerLocal;
        const [mx, my] = gisScreenToSvg(svg, evt.clientX, evt.clientY);
        state.squareRotation = Math.atan2(my - cy, mx - cx) + Math.PI / 2;
        renderDrawPreview();
      }
      return;
    }
    if (!dragging) return;
    const dx = evt.clientX - dragStart.x;
    const dy = evt.clientY - dragStart.y;
    // A few pixels of slop still counts as a click (so the point still lands);
    // beyond that it's a genuine pan and the trailing click must not add one.
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) dragMoved = true;
    state.panX = dragStart.panX + dx;
    state.panY = dragStart.panY + dy;
    applyTransform();
  });
  window.addEventListener("mouseup", () => {
    if (pointDragIndex !== null) {
      // Released without ever clearing the slop → it was a click on the
      // point, which means "remove this point".
      if (!pointDragMoved) {
        state.drawPoints.splice(pointDragIndex, 1);
        renderDrawPreview();
      }
      pointDragIndex = null;
      gestureStart = null;
      suppressClickAdd = true;
      updateDrawUI();
      return;
    }
    if (squareCornerDrag) {
      squareCornerDrag = null;
      suppressClickAdd = true;
      updateDrawUI();
      return;
    }
    if (shapeDrag) {
      // Only a real move swallows the trailing click — a stationary click
      // inside the shape still falls through and adds a vertex as usual.
      if (shapeDrag.moved) suppressClickAdd = true;
      shapeDrag = null;
      gestureStart = null;
      return;
    }
    if (rotatingSquare) {
      rotatingSquare = false;
      suppressClickAdd = true;
      return;
    }
    // A drag that actually moved was a pan, not a point placement.
    if (dragging && dragMoved) suppressClickAdd = true;
    dragging = false;
  });
  window.addEventListener("mousemove", updatePingRadius);
  window.addEventListener("mousemove", updateSquareHover);

  // ── Wheel zoom ──
  svg.addEventListener(
    "wheel",
    (evt) => {
      evt.preventDefault();
      const factor = evt.deltaY < 0 ? 1.15 : 1 / 1.15;
      const [anchorX, anchorY] = screenToViewBox(evt.clientX, evt.clientY);
      zoomAt(state.zoom * factor, anchorX, anchorY);
    },
    { passive: false },
  );

  // ── Click on the map background: place a report pin in report mode, place
  // a vertex while drawing, otherwise close popups ──
  svg.addEventListener("click", (evt) => {
    // A pan, point-move, or rotate just happened — swallow the click so it
    // doesn't also drop a vertex, then clear the flag for the next gesture.
    if (suppressClickAdd) {
      suppressClickAdd = false;
      return;
    }
    if (state.pickMode) {
      const svgPoint = gisScreenToSvg(svg, evt.clientX, evt.clientY);
      const [lng, lat] = project.invert(svgPoint);
      state.pickPoint = [lng, lat];
      renderReports();
      if (state.pickCallback) state.pickCallback([lng, lat]);
      return;
    }
    if (state.reportMode) {
      const svgPoint = gisScreenToSvg(svg, evt.clientX, evt.clientY);
      const [lng, lat] = project.invert(svgPoint);
      const svgRect = svg.getBoundingClientRect();
      showCommunityReportForm([lng, lat], evt.clientX - svgRect.left, evt.clientY - svgRect.top);
      return;
    }
    if (state.drawTool) {
      addDrawVertex(evt);
      return;
    }
    hidePopup();
    hideForm();
  });

  function renderAll() {
    renderVegetation();
    renderWater();
    renderHazards();
    renderConstruction();
    renderAccidents();
    renderReports();
    renderRoads();
    renderBuildings();
  }

  resetView();
  renderAll();
  updateDrawUI();
  updateLegendDimStates();

  return {
    setTypeFilter(value) {
      state.typeFilter = value || "all";
      renderBuildings();
    },
    setSectorFilter(value) {
      state.sectorFilter = value || "all";
      renderBuildings();
    },
    // "All Layers" means show everything — including any individual layers
    // (Vegetation/Water/Roads/etc.) the user had toggled off, not just the
    // building category filter. Resets every show* flag and their toggle
    // buttons back on and re-renders.
    showAllLayers() {
      state.showBuildings = true;
      state.showRoads = true;
      state.showWater = true;
      state.showVegetation = true;
      state.showHazard = true;
      state.showConstruction = true;
      state.showAccidents = true;
      state.showReports = true;
      [
        buildingsToggleBtn,
        roadsToggleBtn,
        waterToggleBtn,
        vegetationToggleBtn,
        hazardToggleBtn,
        constructionToggleBtn,
        accidentsToggleBtn,
        reportsToggleBtn,
      ].forEach((btn) => btn.classList.add("active"));
      renderAll();
      updateLegendDimStates();
    },
    // Real counts pulled straight from the same data the map itself renders
    // (OSM + custom features, minus soft-deletes) — for KPI cards or any
    // other summary UI that wants numbers that track what's actually on the
    // map instead of hand-maintained placeholders.
    getStats() {
      const tags = gisLoadBuildingTags();
      return {
        // Surrounding-context features (outside the boundary) don't count.
        totalBuildings: allBuildingFeatures().filter(featureInsideBoundary).length,
        taggedHouseholds: Object.values(tags).filter((t) => t?.type === "households").length,
        hazardZones: gisAllHazardFeatures().length,
        incidents: gisAllAccidentFeatures().length,
        constructionAreas: gisAllConstructionFeatures().length,
        vegetationAreas: (vegetationGeojson?.features || []).length + gisCustomVegetationFeatures().length,
        communityReports: gisAllCommunityReports().length,
      };
    },
    refreshAll: renderAll,
    resetView,
    // Community Reports — resident pin drop + feed navigation.
    beginCommunityReport,
    cancelCommunityReport,
    flyToReport,
    // Location picker for the "File an Incident" modal's embedded map.
    beginLocationPick,
    endLocationPick,
  };
}

function gisScreenToSvg(svg, clientX, clientY) {
  const pt = svg.createSVGPoint();
  pt.x = clientX;
  pt.y = clientY;
  const ctm = svg.querySelector(".gis-svg-viewport").getScreenCTM();
  const inverted = pt.matrixTransform(ctm.inverse());
  return [inverted.x, inverted.y];
}

// ════════════════════ GIS BUILDING FILTERS (shared) ════════════════════
// Called by the Building Type / Classification choice dropdowns the engine
// injects into each filter row. A change applies to every map embed on the
// page and keeps every matching dropdown (e.g. section map + preview modal)
// in sync — button label, highlighted option, and active styling.
function gisSyncChoiceDropdowns(kind, value, defaultLabel, meta) {
  document.querySelectorAll(`[data-gis-choice="${kind}"]`).forEach((dd) => {
    dd.querySelector("[data-gis-choice-label]").textContent =
      value === "all" ? defaultLabel : meta[value]?.label || value;
    dd.querySelectorAll(".gis-choice-option").forEach((opt) => {
      opt.classList.toggle("active", opt.getAttribute("data-value") === value);
    });
    dd.classList.toggle("gis-choice-active", value !== "all");
  });
}

function gisApplyTypeFilter(value) {
  Object.values(gisInstances).forEach((inst) => inst.setTypeFilter?.(value));
  gisSyncChoiceDropdowns("type", value, "Building Type", GIS_BUILDING_TYPE_META);
  const label =
    value === "all" ? "Showing all building types" : `Filtered to: ${GIS_BUILDING_TYPE_META[value]?.label || value}`;
  if (typeof showToast === "function") showToast(label, gisIcon("layers"));
}

function gisApplySectorFilter(value) {
  Object.values(gisInstances).forEach((inst) => inst.setSectorFilter?.(value));
  gisSyncChoiceDropdowns("sector", value, "Classification", GIS_HOUSEHOLD_SUBCAT_META);
  const label =
    value === "all"
      ? "Showing all household classifications"
      : `Filtered to: ${GIS_HOUSEHOLD_SUBCAT_META[value]?.label || value} households`;
  if (typeof showToast === "function") showToast(label, gisIcon("layers"));
}
