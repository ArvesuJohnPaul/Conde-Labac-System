// js/household-panel.js — "who lives in this house?", opened from the map.
//
// A household in this system is a building tagged as one on the GIS map, and
// residents point at it (resident.building_id). Until now the map could only
// say HOW MANY residents a house held — the number in its popup — and the
// officer who wanted to know *which* ones had to leave the map, open Barangay
// Residency, and search the directory by surname with nothing to search for.
//
// This is the other half: click a tagged house and the roster opens, with the
// things that actually decide what an officer does next — who is a senior, a
// PWD, a solo parent, who can be phoned, who is a minor, who has an account
// to notify — and the one write that keeps it true, connecting a resident to
// the household or taking them out of it.
//
// It is deliberately NOT in js/gis-map.js. That file is also the public
// landing map and the resident's incident-report map; a roster of names,
// ages, phone numbers and vulnerabilities must not be in the bundle those
// pages load. This file is loaded by the MIS pages only, and the engine shows
// its button only when openHouseholdPanel() exists (householdPanelReady()).
//
// The server is the authority on all of it: routes/households.js guards the
// list with GIS-or-Residency and both writes with Residency, so a role that
// cannot work in Residency gets a read-only roster here however the page is
// rendered.

// The household currently open, by MAP key (an OSM id, or 'c<id>' for a
// building drawn in the app) — what every call below is keyed on, and what a
// reload after a write re-fetches.
let HH_KEY = null;
let HH_DATA = null;
// The last search this browser ran, so a reload after connecting someone does
// not wipe what the officer typed (they usually add two people, not one).
let HH_QUERY = "";
let HH_SEARCH_SEQ = 0;

const HH_CLASS_LABELS = {
  senior: "Senior Citizen",
  pwd: "PWD",
  "solo-parent": "Solo Parent",
  indigent: "Indigent",
};

// Writing is Residency work — connecting a resident to a house edits the
// resident's record, not the map. An Admin always has it; anyone else has it
// if the Role Access Matrix says so. Fails closed: with no session helper
// loaded the panel is read-only, and the server would refuse the write anyway.
function hhCanEdit() {
  try {
    const role = typeof getSession === "function" ? (getSession() || {}).role : null;
    if (!role) return false;
    if (role === "Admin") return true;
    return typeof moduleAllowedFor === "function" ? moduleAllowedFor("residency", role) : false;
  } catch (e) {
    return false;
  }
}

function hhEscape(str) {
  const div = document.createElement("div");
  div.textContent = str == null ? "" : String(str);
  return div.innerHTML;
}

// Two initials for the avatar disc: "Dela Cruz, Juan P." → "DJ".
function hhInitials(name) {
  const parts = String(name || "")
    .replace(/,/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return "?";
  const first = parts[0][0] || "";
  const second = parts.length > 1 ? parts[1][0] || "" : "";
  return (first + second).toUpperCase();
}

function hhModal() {
  let el = document.getElementById("modal-household");
  if (el) return el;
  el = document.createElement("div");
  el.className = "modal-backdrop";
  el.id = "modal-household";
  el.innerHTML = `
    <div class="modal-box modal-lg">
      <div class="modal-header">
        <div class="modal-title">
          <div class="modal-title-icon"><i data-icon=houses></i></div>
          <span id="hh-title">Household</span>
        </div>
        <button class="modal-close" type="button" data-hh-close><i data-icon=x></i></button>
      </div>
      <div class="modal-body" id="hh-body"></div>
      <div class="modal-footer">
        <button class="btn btn-outline" type="button" data-hh-close>Close</button>
      </div>
    </div>`;
  document.body.appendChild(el);
  // Backdrop click closes; a click inside the box must not.
  el.addEventListener("click", (evt) => {
    if (evt.target === el || evt.target.closest("[data-hh-close]")) closeHouseholdPanel();
  });
  el.addEventListener("click", onHouseholdClick);
  el.addEventListener("input", (evt) => {
    if (evt.target.id === "hh-search") runHouseholdSearch(evt.target.value);
  });
  return el;
}

function closeHouseholdPanel() {
  document.getElementById("modal-household")?.classList.remove("open");
  HH_KEY = null;
  HH_DATA = null;
  HH_QUERY = "";
}

// The map calls this with the building key it was clicked on. Any footprint of
// a group-tagged household resolves to the same household on the server, so
// clicking any of the three buildings "Bahay ni Shane" covers opens the one
// roster.
async function openHouseholdPanel(key) {
  const modal = hhModal();
  HH_KEY = String(key);
  HH_QUERY = "";
  modal.classList.add("open");
  document.getElementById("hh-title").textContent = "Household";
  document.getElementById("hh-body").innerHTML =
    `<p class="table-muted" style="text-align:center;padding:28px">Loading residents…</p>`;
  await loadHouseholdPanel();
}

async function loadHouseholdPanel(keepSearch) {
  const key = HH_KEY;
  const body = document.getElementById("hh-body");
  if (!body || !key) return;
  try {
    const data = await apiGet(`/api/households/${encodeURIComponent(key)}/members`);
    // A second click while the first was in flight: the later one wins.
    if (HH_KEY !== key) return;
    HH_DATA = data;
    document.getElementById("hh-title").textContent = data.name || "Household";
    body.innerHTML = householdPanelHtml(data);
    if (typeof hydrateIcons === "function") hydrateIcons(body);
    if (keepSearch && HH_QUERY) {
      const input = document.getElementById("hh-search");
      if (input) {
        input.value = HH_QUERY;
        runHouseholdSearch(HH_QUERY);
      }
    }
  } catch (err) {
    body.innerHTML = `<p style="text-align:center;padding:24px;color:#b91c1c">Could not load this household (${hhEscape(err.message)}).</p>`;
  }
}

// One summary tile. Zero is shown, not hidden: "0 seniors" is an answer, and a
// tile that disappears when it is zero makes the officer check twice.
function hhTile(label, value, tone) {
  return `
    <div class="hh-tile${tone ? " hh-tile-" + tone : ""}">
      <span class="hh-tile-value">${value}</span>
      <span class="hh-tile-label">${label}</span>
    </div>`;
}

function householdPanelHtml(d) {
  const s = d.summary;
  const classes = (d.classifications || [])
    .map((c) => `<span class="badge badge-gold">${hhEscape(HH_CLASS_LABELS[c === "seniors" ? "senior" : c] || c)}</span>`)
    .join(" ");
  const purok = d.residents.find((r) => r.purok);
  return `
    <div class="hh-head">
      <div>
        ${/* The name is already the modal's heading — repeating it here just
             pushed the counts down the screen. */ ""}
        <div class="hh-sub">
          ${d.buildings > 1 ? `<span><i data-icon=houses></i> ${d.buildings} footprints on the map</span>` : `<span><i data-icon=map-pin></i> One footprint on the map</span>`}
          ${purok ? `<span><i data-icon=flag></i> ${hhEscape(purok.purok)}</span>` : ""}
        </div>
      </div>
      <div class="hh-badges">${classes || `<span class="badge badge-gray">No classification</span>`}</div>
    </div>
    ${d.notes ? `<div class="hh-notes">${hhEscape(d.notes)}</div>` : ""}
    <div class="hh-tiles">
      ${hhTile("Residents", s.members)}
      ${hhTile("Minors", s.minors)}
      ${hhTile("Seniors", s.seniors)}
      ${hhTile("PWD", s.pwd)}
      ${hhTile("Solo parents", s.solo_parent)}
      ${hhTile("Indigent", s.indigent)}
      ${hhTile("Can be texted", s.with_contact, s.with_contact ? "" : "warn")}
      ${hhTile("Online accounts", s.claimed)}
    </div>
    ${
      s.senior_unrecorded
        ? `<div class="hh-flag"><i data-icon=triangle-alert></i> ${s.senior_unrecorded} resident${s.senior_unrecorded === 1 ? " is" : "s are"} 60 or older but not recorded as a senior citizen — the house is not coloured as a senior household until that is set in Barangay Residency.</div>`
        : ""
    }
    <div class="hh-section-title">Residents connected (${s.members})</div>
    ${
      d.residents.length
        ? `<div class="hh-list">${d.residents.map(hhResidentRow).join("")}</div>`
        : `<div class="hh-empty">
             <i data-icon=family></i>
             <p>No resident is connected to this house yet.</p>
             <p class="table-muted">Connecting one is what gives the household its classification on the map — a house with a senior citizen in it turns amber on its own.</p>
           </div>`
    }
    ${hhConnectHtml()}`;
}

function hhResidentRow(r) {
  const facts = [];
  if (r.age != null) facts.push(`${r.age} yrs old`);
  if (r.sex) facts.push(r.sex === "M" ? "Male" : r.sex === "F" ? "Female" : hhEscape(r.sex));
  if (r.civil_status) facts.push(hhEscape(r.civil_status));
  if (r.occupation) facts.push(hhEscape(r.occupation));
  const badges = (r.classifications || [])
    .map((c) => `<span class="badge badge-gold">${hhEscape(HH_CLASS_LABELS[c] || c)}</span>`)
    .join(" ");
  const lines = [];
  // The phone number an emergency text would go to, and whether anyone ever
  // proved it belongs to them (resident.contact_verified_at).
  lines.push(
    r.contact_no
      ? `<span><i data-icon=phone></i> ${hhEscape(r.contact_no)}${r.contact_verified ? ` <span class="hh-ok">verified</span>` : ` <span class="hh-muted">unverified</span>`}</span>`
      : `<span class="hh-muted"><i data-icon=phone></i> No contact number</span>`,
  );
  // A tick beside "Not Registered" reads as a tick: say it in words instead.
  if (r.is_voter) lines.push(`<span><i data-icon=check></i> Registered voter</span>`);
  else if (r.voter_status) lines.push(`<span class="hh-muted"><i data-icon=x></i> Not a registered voter</span>`);
  lines.push(
    r.account_claimed
      ? `<span><i data-icon=user></i> Has an online account</span>`
      : `<span class="hh-muted"><i data-icon=user></i> No online account</span>`,
  );
  if (r.status && r.status !== "active")
    lines.push(`<span class="hh-warn"><i data-icon=triangle-alert></i> Record: ${hhEscape(r.status)}</span>`);
  return `
    <div class="hh-row" data-hh-resident="${r.resident_id}">
      <div class="hh-avatar">${hhEscape(hhInitials(r.full_name))}</div>
      <div class="hh-row-main">
        <div class="hh-row-top">
          <span class="hh-row-name">${hhEscape(r.full_name)}</span>
          ${badges}
        </div>
        <div class="hh-row-facts">${facts.join(" · ")}</div>
        <div class="hh-row-lines">${lines.join("")}</div>
        ${
          r.senior_unrecorded
            ? `<div class="hh-row-flag"><i data-icon=triangle-alert></i> 60+ but not recorded as a senior citizen</div>`
            : ""
        }
      </div>
      <div class="hh-row-actions">
        <button type="button" class="btn btn-sm btn-outline" data-hh-open="${r.resident_id}">Open record</button>
        ${hhCanEdit() ? `<button type="button" class="btn btn-sm btn-outline hh-remove" data-hh-remove="${r.resident_id}">Remove</button>` : ""}
      </div>
    </div>`;
}

// The connect box. Hidden entirely for a role that cannot edit Residency —
// there is nothing for them to do with it, and the server would refuse.
function hhConnectHtml() {
  if (!hhCanEdit())
    return `<p class="hh-readonly table-muted">Your role can see this household but not change who lives in it. Connecting a resident is a Barangay Residency permission.</p>`;
  return `
    <div class="hh-connect">
      <div class="hh-section-title">Connect a resident to this household</div>
      <div class="hh-search-wrap">
        <i data-icon=search></i>
        <input type="text" id="hh-search" class="form-control" autocomplete="off"
               placeholder="Search a resident by name, e.g. Dela Cruz" />
      </div>
      <div id="hh-results" class="hh-results"></div>
      <p class="hh-hint table-muted">A resident can live in one household at a time. Connecting someone who is already in another house moves them here.</p>
    </div>`;
}

// ── Search ──────────────────────────────────────────────────────────────────
// Debounced, and every reply carries the sequence number of the keystroke that
// asked for it: a slow answer to "de" must not land after a fast answer to
// "dela cruz" and put the old list back.
let hhSearchTimer = null;
function runHouseholdSearch(value) {
  HH_QUERY = value;
  clearTimeout(hhSearchTimer);
  const results = document.getElementById("hh-results");
  if (!results) return;
  const q = String(value || "").trim();
  if (q.length < 2) {
    results.innerHTML = "";
    return;
  }
  const seq = ++HH_SEARCH_SEQ;
  hhSearchTimer = setTimeout(async () => {
    try {
      const rows = await apiGet(
        `/api/households/${encodeURIComponent(HH_KEY)}/candidates?q=${encodeURIComponent(q)}`,
      );
      if (seq !== HH_SEARCH_SEQ) return;
      results.innerHTML = rows.length
        ? rows.map(hhCandidateRow).join("")
        : `<p class="table-muted hh-no-match">No resident by that name is free to connect. Residents already in this household are not listed.</p>`;
      if (typeof hydrateIcons === "function") hydrateIcons(results);
    } catch (err) {
      results.innerHTML = `<p class="hh-no-match" style="color:#b91c1c">Search failed (${hhEscape(err.message)}).</p>`;
    }
  }, 220);
}

function hhCandidateRow(r) {
  const facts = [r.age != null ? `${r.age} yrs` : null, r.sex === "M" ? "Male" : r.sex === "F" ? "Female" : null, r.purok]
    .filter(Boolean)
    .map(hhEscape)
    .join(" · ");
  return `
    <div class="hh-result">
      <div class="hh-avatar hh-avatar-sm">${hhEscape(hhInitials(r.full_name))}</div>
      <div class="hh-result-main">
        <div class="hh-row-name">${hhEscape(r.full_name)}</div>
        <div class="hh-row-facts">${facts}</div>
        ${
          r.household_name
            ? `<div class="hh-row-flag"><i data-icon=houses></i> Currently in “${hhEscape(r.household_name)}” — connecting moves them</div>`
            : `<div class="hh-row-facts hh-muted">Not in any household yet</div>`
        }
      </div>
      <button type="button" class="btn btn-sm btn-gold"
              data-hh-connect="${r.resident_id}"
              data-hh-name="${hhEscape(r.full_name)}"
              data-hh-from="${hhEscape(r.household_name || "")}">Connect</button>
    </div>`;
}

// ── Writes ──────────────────────────────────────────────────────────────────
async function onHouseholdClick(evt) {
  const connect = evt.target.closest("[data-hh-connect]");
  if (connect) return hhConnect(connect);
  const remove = evt.target.closest("[data-hh-remove]");
  if (remove) return hhRemove(remove.getAttribute("data-hh-remove"));
  const open = evt.target.closest("[data-hh-open]");
  if (open) return hhOpenRecord(open.getAttribute("data-hh-open"));
}

async function hhConnect(btn) {
  const id = btn.getAttribute("data-hh-connect");
  const name = btn.getAttribute("data-hh-name");
  const from = btn.getAttribute("data-hh-from");
  // Moving someone out of a house they are recorded in is the one step here
  // that undoes an earlier decision, so it is confirmed; a resident with no
  // household yet is just connected.
  if (from && typeof uiConfirm === "function") {
    const ok = await uiConfirm({
      title: "Move this resident?",
      message: `${name} is currently connected to “${from}”. Connecting them here moves them out of that household.`,
      confirmLabel: "Move them here",
      confirmIcon: "houses",
      icon: "houses",
      // Not a destructive act — the gold dialog, not the red one.
      tone: "accent",
    });
    if (!ok) return;
  }
  btn.disabled = true;
  btn.textContent = "Connecting…";
  try {
    const out = await apiPost(`/api/households/${encodeURIComponent(HH_KEY)}/members`, {
      resident_id: Number(id),
    });
    await hhAfterChange(
      out.moved_from
        ? `${out.full_name} moved from “${out.moved_from}” to this household`
        : `${out.full_name} connected to this household`,
      "RESIDENT_HOUSEHOLD_CONNECT",
      `Resident ${out.full_name} (#${id}) connected to household "${HH_DATA?.name || HH_KEY}"`,
    );
  } catch (err) {
    btn.disabled = false;
    btn.textContent = "Connect";
    if (typeof showToast === "function")
      showToast(err.message || "Could not connect that resident", "<i data-icon=triangle-alert></i>");
  }
}

async function hhRemove(id) {
  const r = (HH_DATA?.residents || []).find((x) => String(x.resident_id) === String(id));
  const name = r ? r.full_name : "This resident";
  if (typeof uiConfirm === "function") {
    const ok = await uiConfirm({
      title: "Remove from this household?",
      message: `${name} stays in the barangay records — only the link to this house is cleared. The household's classification on the map is recalculated from whoever is left.`,
      confirmLabel: "Remove from household",
      icon: "houses",
    });
    if (!ok) return;
  }
  try {
    await apiDelete(`/api/households/${encodeURIComponent(HH_KEY)}/members/${id}`);
    await hhAfterChange(
      `${name} removed from this household`,
      "RESIDENT_HOUSEHOLD_REMOVE",
      `Resident ${name} (#${id}) removed from household "${HH_DATA?.name || HH_KEY}"`,
    );
  } catch (err) {
    if (typeof showToast === "function")
      showToast(err.message || "Could not remove that resident", "<i data-icon=triangle-alert></i>");
  }
}

// Every write ends the same way: the roster is re-read (so the summary and the
// classifications are the server's answer, not this browser's guess), the map
// behind the modal is repainted — the member count and the household's colour
// both come from the same endpoint — and the trail gets an entry.
async function hhAfterChange(toast, action, details) {
  await loadHouseholdPanel(true);
  if (typeof gisRefreshHouseholds === "function") await gisRefreshHouseholds();
  if (typeof showToast === "function") showToast(toast, "<i data-icon=family></i>");
  if (typeof logAudit === "function") logAudit(action, details, "info", "resident");
}

// "Open record" leaves the map for the resident's full profile in Barangay
// Residency. The id is stashed the same way the Blotter hands a report to the
// map, and the Residency page opens that profile on arrival.
function hhOpenRecord(id) {
  try {
    sessionStorage.setItem("ibmdss.openResident", String(id));
  } catch (e) {
    /* storage disabled — Residency just opens at its list */
  }
  closeHouseholdPanel();
  if (typeof nav === "function") nav(null, "residency");
}
