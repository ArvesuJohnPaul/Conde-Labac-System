// js/pages/gis.js
window.CURRENT_PAGE = "gis";

function renderPage() {
  renderGISPage();
}

function renderGISPage() {
  setContent(`
    <div class="page-header">
      <h2 class="page-title">GIS Mapping</h2>
      <p class="page-desc">Interactive zone and hazard mapping for Barangay Conde Labac</p>
    </div>
    <div class="kpi-grid">
      <div class="kpi-card"><div class="kpi-label">Geotagged Households</div><div class="kpi-value">1,024</div><div class="kpi-trend">82% of total</div></div>
      <div class="kpi-card danger"><div class="kpi-label">Hazard Zones</div><div class="kpi-value">2</div><div class="kpi-trend">Flood + Landslide</div></div>
      <div class="kpi-card warning"><div class="kpi-label">Families in Hazard Zone</div><div class="kpi-value">89</div></div>
      <div class="kpi-card success"><div class="kpi-label">Evacuation Centers</div><div class="kpi-value">3</div></div>
    </div>
    <div class="card">
      <div class="card-header">
        <div class="card-title">Barangay Map</div>
        <div class="btn-group">
          <button class="btn btn-sm btn-gold" onclick="openServicePopup('gis')">🗺 Open Full Map</button>
          <button class="btn btn-sm btn-outline">⬇ Export GeoJSON</button>
        </div>
      </div>
      <div class="map-controls">
        <button class="btn btn-sm btn-outline">All Layers</button>
        <button class="btn btn-sm btn-outline">🏠 Households</button>
        <button class="btn btn-sm btn-outline">⚠ Hazard Zones</button>
        <button class="btn btn-sm btn-outline">👴 Senior Citizens</button>
        <button class="btn btn-sm btn-outline">♿ PWD</button>
        <button class="btn btn-sm btn-outline">🏷 4Ps</button>
      </div>
      <div class="gis-map-embed gis-leaflet-map" id="gis-map-page"></div>
    </div>
  `);
  setTimeout(() => initGisMap("gis-map-page"), 80);
}
