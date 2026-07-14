// /api/gis — everything the map layer stores: building tags, custom-drawn
// features, and OSM edits (tombstones/overrides). Geometry crosses the wire as
// GeoJSON coordinate arrays — the exact shape gis-map.js already uses — so the
// frontend rewiring is mostly swapping localStorage calls for fetch().
const express = require("express");
const { pool, query } = require("../db");
const router = express.Router();

// ── Aggregate load: one call returns the whole map state ─────────────────────
// Mirrors the bundle of localStorage keys gis-map.js reads on init.
router.get("/state", async (_req, res, next) => {
  try {
    const [tags, customB, feats, edits] = await Promise.all([
      query(`SELECT COALESCE(osm_id::text, 'c'||building_id) AS key,
                    name, type, subcat, notes
               FROM building
              WHERE (type IS NOT NULL OR subcat IS NOT NULL)
                AND status = 'active'`),
      query(`SELECT building_id AS id,
                    ST_AsGeoJSON(geom)::json AS gj
               FROM building
              WHERE is_custom = true AND geom IS NOT NULL
                AND status = 'active'`),
      query(`SELECT feature_id AS id, type,
                    ST_AsGeoJSON(geom)::json AS gj, properties
               FROM map_feature
              WHERE status = 'active'`),
      query(`SELECT osm_id, feature_kind, edit_type, overrides FROM osm_edit`),
    ]);

    // building tags → { key: {name,type,subcat,notes} }
    const buildingTags = {};
    tags.rows.forEach((r) => {
      buildingTags[r.key] = {
        name: r.name || "",
        type: r.type || "",
        subcat: r.subcat || "",
        notes: r.notes || "",
      };
    });

    // custom buildings → [{ id, coordinates: outerRing }]
    const customBuildings = customB.rows.map((r) => ({
      id: r.id,
      coordinates: r.gj.coordinates[0],
    }));

    // features grouped by type; each carries its GeoJSON coords + properties
    const features = {};
    feats.rows.forEach((r) => {
      (features[r.type] ||= []).push({
        id: r.id,
        coordinates: r.gj.coordinates,
        ...r.properties,
      });
    });

    res.json({
      buildingTags,
      customBuildings,
      features,
      osmEdits: edits.rows,
    });
  } catch (err) {
    next(err);
  }
});

// ── Building tags ────────────────────────────────────────────────────────────
// PUT /api/gis/building-tags/:key  (key = OSM id, or 'c'+building_id for custom)
// Upserts the tag onto the building row (creating an OSM-shadow row if needed).
router.put("/building-tags/:key", async (req, res, next) => {
  try {
    const { key } = req.params;
    const t = req.body || {};
    if (key.startsWith("c")) {
      // custom building: update existing row by id
      await query(
        `UPDATE building SET name=$2, type=$3, subcat=$4, notes=$5
          WHERE building_id=$1`,
        [key.slice(1), t.name || null, t.type || null, t.subcat || null, t.notes || null]
      );
    } else {
      // OSM building: upsert a shadow row keyed by osm_id
      await query(
        `INSERT INTO building (osm_id, is_custom, name, type, subcat, notes)
         VALUES ($1, false, $2, $3, $4, $5)
         ON CONFLICT (osm_id) DO UPDATE
           SET name=EXCLUDED.name, type=EXCLUDED.type,
               subcat=EXCLUDED.subcat, notes=EXCLUDED.notes`,
        [key, t.name || null, t.type || null, t.subcat || null, t.notes || null]
      );
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.delete("/building-tags/:key", async (req, res, next) => {
  try {
    const { key } = req.params;
    if (key.startsWith("c")) {
      await query(
        `UPDATE building SET type=NULL, subcat=NULL WHERE building_id=$1`,
        [key.slice(1)]
      );
    } else {
      await query(`DELETE FROM building WHERE osm_id=$1 AND is_custom=false`, [key]);
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ── Custom-drawn buildings (polygons) ────────────────────────────────────────
// POST body: { coordinates: outerRing }  (ring = array of [lng,lat])
router.post("/custom-buildings", async (req, res, next) => {
  try {
    const ring = (req.body || {}).coordinates;
    if (!Array.isArray(ring)) {
      return res.status(400).json({ error: "coordinates (a ring) required" });
    }
    const geojson = JSON.stringify({ type: "Polygon", coordinates: [ring] });
    const { rows } = await query(
      `INSERT INTO building (is_custom, geom)
       VALUES (true, ST_SetSRID(ST_GeomFromGeoJSON($1), 4326))
       RETURNING building_id AS id`,
      [geojson]
    );
    res.status(201).json({ id: rows[0].id });
  } catch (err) {
    next(err);
  }
});

router.delete("/custom-buildings/:id", async (req, res, next) => {
  try {
    await query(`UPDATE building SET status='deleted' WHERE building_id=$1`, [
      req.params.id,
    ]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ── Map features (road / vegetation / construction / hazard / accident / report)
// POST body: { type, coordinates, properties? }
//   coordinates must match the type's geometry:
//     road       → LineString coords  [[lng,lat],...]
//     polygon fx → Polygon coords      [[[lng,lat],...]]
//     point fx   → Point coords        [lng,lat]
const GEOM_TYPE = {
  road: "LineString",
  vegetation: "Polygon",
  construction: "Polygon",
  hazard: "Point",
  accident: "Point",
  community_report: "Point",
};

router.post("/features", async (req, res, next) => {
  try {
    const b = req.body || {};
    const gt = GEOM_TYPE[b.type];
    if (!gt) return res.status(400).json({ error: "unknown feature type" });
    const geojson = JSON.stringify({ type: gt, coordinates: b.coordinates });
    const { rows } = await query(
      `INSERT INTO map_feature (type, geom, properties)
       VALUES ($1, ST_SetSRID(ST_GeomFromGeoJSON($2), 4326), $3)
       RETURNING feature_id AS id`,
      [b.type, geojson, b.properties || {}]
    );
    res.status(201).json({ id: rows[0].id });
  } catch (err) {
    next(err);
  }
});

router.delete("/features/:id", async (req, res, next) => {
  try {
    await query(`UPDATE map_feature SET status='deleted' WHERE feature_id=$1`, [
      req.params.id,
    ]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ── OSM edits (tombstones / overrides / cuts on the static base layer) ────────
// POST body: { osm_id, feature_kind, edit_type, overrides? }
router.post("/osm-edits", async (req, res, next) => {
  try {
    const b = req.body || {};
    await query(
      `INSERT INTO osm_edit (osm_id, feature_kind, edit_type, overrides)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (osm_id, feature_kind, edit_type)
         DO UPDATE SET overrides = EXCLUDED.overrides`,
      [b.osm_id, b.feature_kind, b.edit_type, b.overrides || {}]
    );
    res.status(201).json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.delete("/osm-edits", async (req, res, next) => {
  // Undo an edit (e.g. restore a tombstoned building). Query by the same key.
  try {
    const { osm_id, feature_kind, edit_type } = req.query;
    await query(
      `DELETE FROM osm_edit
        WHERE osm_id=$1 AND feature_kind=$2 AND edit_type=$3`,
      [osm_id, feature_kind, edit_type]
    );
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
