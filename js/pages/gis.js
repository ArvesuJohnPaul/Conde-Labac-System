// js/pages/gis.js
window.CURRENT_PAGE = "gis";

function renderPage() {
  renderGISPage();
}

function gisPageEscapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = String(str ?? "");
  return div.innerHTML;
}

// "Recent Community Reports" side panel — newest resident-submitted pins,
// straight from the same localStorage the map renders. Clicking an entry
// flies the map to that pin.
function renderReportFeed() {
  const feedEl = document.getElementById("gis-report-feed");
  if (!feedEl) return;
  const reports = gisAllCommunityReports()
    .slice()
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .slice(0, 8);
  if (!reports.length) {
    feedEl.innerHTML = `<div class="gis-feed-empty">No community reports yet. Concerns residents pin on the public map will appear here.</div>`;
    return;
  }
  feedEl.innerHTML = reports
    .map((r) => {
      const meta = GIS_REPORT_TYPE_META[r.reportType] || GIS_REPORT_TYPE_META.other;
      return `
        <button type="button" class="gis-feed-item" data-report-id="${gisPageEscapeHtml(r.id)}" title="Show on map">
          <div class="gis-report-avatar gis-feed-avatar">${gisPageEscapeHtml(r.reporter?.initials || "?")}</div>
          <div class="gis-feed-body">
            <div class="gis-feed-title">${gisIcon(meta.icon)} ${gisPageEscapeHtml(r.title)}</div>
            <div class="gis-feed-sub">${gisPageEscapeHtml(r.reporter?.name || "Resident")} · ${gisPageEscapeHtml(gisTimeAgo(r.createdAt))}</div>
          </div>
        </button>`;
    })
    .join("");
}

async function renderGISPage() {
  setContent(`
    <div class="page-header gis-page-header">
      <h2 class="page-title">GIS Mapping</h2>
      <p class="page-desc">Interactive zone and hazard mapping for Barangay Conde Labac</p>
    </div>
    <div class="kpi-grid">
      <div class="kpi-card"><div class="kpi-label">Mapped Buildings</div><div class="kpi-value" id="gis-kpi-buildings">—</div><div class="kpi-trend" id="gis-kpi-buildings-trend">Loading…</div></div>
      <div class="kpi-card success"><div class="kpi-label">Tagged Households</div><div class="kpi-value" id="gis-kpi-households">—</div><div class="kpi-trend" id="gis-kpi-households-trend"></div></div>
      <div class="kpi-card danger"><div class="kpi-label">Active Hazard Zones</div><div class="kpi-value" id="gis-kpi-hazards">—</div></div>
      <div class="kpi-card warning"><div class="kpi-label">Recorded Incidents</div><div class="kpi-value" id="gis-kpi-incidents">—</div></div>
      <div class="kpi-card info"><div class="kpi-label">Community Reports</div><div class="kpi-value" id="gis-kpi-reports">—</div><div class="kpi-trend">Resident-submitted pins</div></div>
    </div>
    <div class="gis-page-layout">
      <aside class="gis-side-col">
        <div class="card gis-side-panel gis-side-reports">
          <div class="card-header">
            <div class="card-title">Recent Community Reports</div>
          </div>
          <div class="gis-report-feed" id="gis-report-feed"></div>
        </div>
        <div class="card gis-side-panel gis-side-ai">
          <div class="card-header">
            <div class="card-title">AI Narrative Report</div>
          </div>
          <div class="gis-ai-placeholder">
            ${gisIcon("layers")}
            <div>An AI-generated narrative summary of the map — hazard zones, community reports, and coverage trends — will appear here.</div>
            <button class="btn btn-sm btn-outline" disabled>Generate Report (coming soon)</button>
          </div>
        </div>
      </aside>
      <div class="card gis-map-card">
        <div class="card-header">
          <div class="card-title">Barangay Map</div>
        </div>
        <!-- Populated by the map engine: Map Layers, Building Type, and
             Classification dropdowns plus the household search. Must stay
             the immediate previous sibling of the map embed. The legend is
             also engine-generated, as an overlay inside the map. -->
        <div class="gis-filter-row"></div>
        <div class="gis-map-embed" id="gis-map-page"></div>
      </div>
    </div>
  `);
  // Editing is an MIS-only capability — this is the only embed of the map
  // that gets it; the public landing page and resident-portal preview modal
  // stay read-only.
  const instance = await initGisMap("gis-map-page", { editable: true });
  if (!instance || typeof instance.getStats !== "function") return;

  renderReportFeed();
  document.getElementById("gis-report-feed").addEventListener("click", (evt) => {
    const btn = evt.target.closest("[data-report-id]");
    if (!btn) return;
    instance.flyToReport(btn.getAttribute("data-report-id"));
  });

  // KPIs are pulled straight from the map's own data (OSM + custom features,
  // minus soft-deletes) so they always track what's actually plotted below,
  // rather than hand-maintained placeholder numbers.
  const stats = instance.getStats();
  const pct = stats.totalBuildings ? Math.round((stats.taggedHouseholds / stats.totalBuildings) * 100) : 0;
  document.getElementById("gis-kpi-buildings").textContent = stats.totalBuildings.toLocaleString();
  document.getElementById("gis-kpi-buildings-trend").textContent = "Footprints on the map";
  document.getElementById("gis-kpi-households").textContent = stats.taggedHouseholds.toLocaleString();
  document.getElementById("gis-kpi-households-trend").textContent = `${pct}% of mapped buildings`;
  document.getElementById("gis-kpi-hazards").textContent = stats.hazardZones.toLocaleString();
  document.getElementById("gis-kpi-incidents").textContent = stats.incidents.toLocaleString();
  document.getElementById("gis-kpi-reports").textContent = stats.communityReports.toLocaleString();
}
