// js/portal-account.js — signed-in account features, shared by the landing
// page (index.html) and the MIS pages. Loaded LAST on purpose: it upgrades
// the older demo handlers (fake submitCertificate/submitFeedback/toggleNotif)
// to real API-backed versions, and injects the account panels:
//   • My Information   — the resident's full record (GET /api/residents/:id)
//   • My Requests      — certificates this account filed (?resident_id=)
//   • Activity History — incident reports + feedback given
//   • Notifications    — /api/notifications feed with unread badge + polling
//
// Everything reads the session from localStorage (ibmdss.session) and calls
// the same API the mobile app uses. All functions are defensive: signed-out
// users get a friendly "sign in first" message instead of errors.
(function () {
  "use strict";

  // ── helpers ────────────────────────────────────────────────────────────
  function session() {
    try {
      return JSON.parse(localStorage.getItem("ibmdss.session"));
    } catch (e) {
      return null;
    }
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(
      /[&<>"']/g,
      (c) =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
    );
  }

  function fmtDate(d) {
    if (!d) return "—";
    const dt = new Date(typeof d === "string" && d.length === 10 ? d + "T00:00:00" : d);
    return isNaN(dt)
      ? String(d)
      : dt.toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" });
  }

  function toast(msg, icon) {
    if (typeof showToast === "function") showToast(msg, icon || "<i data-icon=check></i>");
  }

  function hydrate(el) {
    if (typeof hydrateIcons === "function") hydrateIcons(el);
    else if (typeof window.renderIcons === "function") window.renderIcons(el);
  }

  function api(method, path, body) {
    if (typeof apiRequest === "function") return apiRequest(method, path, body);
    // api.js not loaded on this page — degrade gracefully.
    return Promise.reject(new Error("API helper not loaded on this page."));
  }
  const get = (p) => api("GET", p);
  const post = (p, b) => api("POST", p, b);

  const CAT_LABELS = {
    senior: "Senior Citizen",
    pwd: "PWD",
    "solo-parent": "Solo Parent",
    indigent: "Indigent Family",
  };

  const CERT_SLUGS = {
    "Barangay Clearance": "barangay-clearance",
    "Certificate of Indigency": "indigency",
    "Certificate of Residency": "residency",
    "Business Clearance": "business-clearance",
    "Certificate of Good Moral": "good-moral",
    "Good Moral Certificate": "good-moral",
    "Certificate of Solo Parent": "solo-parent",
    "Solo Parent Certificate": "solo-parent",
  };
  const CERT_LABELS = {
    "barangay-clearance": "Barangay Clearance",
    indigency: "Certificate of Indigency",
    residency: "Certificate of Residency",
    "business-clearance": "Business Clearance",
    "good-moral": "Certificate of Good Moral",
    "solo-parent": "Certificate of Solo Parent",
  };

  const CERT_BADGES = {
    pending: "badge-warning",
    approved: "badge-info",
    issued: "badge-success",
    rejected: "badge-danger",
  };

  // ── real certificate submission (replaces the demo handler) ───────────
  // Reads the modal's DOM directly (the selected type card, the fields), so
  // it works with both index.html's and shell.js's copies of the modal.
  function selectedCertName() {
    const el = document.querySelector(".cert-type-card.selected .cert-name");
    return (el && el.textContent.trim()) || "Barangay Clearance";
  }

  window.submitCertificate = async function () {
    const val = (id) => (document.getElementById(id)?.value || "").trim();
    const fname = val("cert-fname");
    const lname = val("cert-lname");
    if (!fname || !lname) {
      alert("Please enter your first and last name.");
      return;
    }
    const certName = selectedCertName();
    const type = CERT_SLUGS[certName] || "barangay-clearance";
    // Extra details ride along in `purpose` — the certificate table keeps a
    // single free-text purpose column (same convention as the mobile app).
    const extras = [
      val("cert-purpose"),
      val("cert-contact") && "Contact: " + val("cert-contact"),
      val("cert-pickup") && "Preferred pickup: " + fmtDate(val("cert-pickup")),
      val("cert-purok") && "Address: " + val("cert-purok"),
    ]
      .filter(Boolean)
      .join(" · ");

    const s = session();
    let res;
    try {
      res = await post("/api/certificates", {
        type: type,
        applicant_name: lname + ", " + fname,
        purpose: extras || null,
        resident_id: s?.resident_id || null,
        account_id: s?.account_id || null,
      });
    } catch (err) {
      alert("Could not submit the request: " + err.message);
      return;
    }
    if (typeof closeServiceModal === "function") closeServiceModal("certificates");
    if (typeof logAudit === "function")
      logAudit(
        "CERT_REQUEST",
        `${certName} requested by ${fname} ${lname} (Ref: ${res.request_no})`,
        "info",
        "certificate"
      );
    toast(`${certName} request submitted! Ref: ${res.request_no}`, "<i data-icon=file-text></i>");
  };

  // Auto-fill the request form from the signed-in resident's record.
  async function prefillCertificateForm() {
    const s = session();
    if (!s || !s.resident_id) return;
    let r;
    try {
      r = await get("/api/residents/" + s.resident_id);
    } catch (e) {
      return; // best-effort — the blank form still works
    }
    const set = (id, v) => {
      const el = document.getElementById(id);
      if (el && !el.value && v) el.value = v;
    };
    set("cert-fname", r.first_name);
    set("cert-lname", r.last_name);
    set("cert-dob", r.birthdate);
    set("cert-contact", r.contact_no);
    const purokSel = document.getElementById("cert-purok");
    if (purokSel && r.purok) {
      for (const opt of purokSel.options) {
        if (opt.value.indexOf(r.purok) === 0) {
          purokSel.value = opt.value;
          break;
        }
      }
    }
  }

  // Wrap openServicePopup so opening the certificate modal auto-fills it.
  if (typeof window.openServicePopup === "function") {
    const _open = window.openServicePopup;
    window.openServicePopup = function (service) {
      _open(service);
      if (service === "certificates") prefillCertificateForm();
    };
  }

  // ── real feedback submission (replaces the demo handler) ──────────────
  window.submitFeedback = async function () {
    const comment = (document.getElementById("fb-comment")?.value || "").trim();
    if (!comment) {
      alert("Please enter a comment or suggestion.");
      return;
    }
    const rating = document.querySelectorAll(".star.active").length || 4;
    const category = document.getElementById("fb-category")?.value || "Other";
    const name = (document.getElementById("fb-name")?.value || "").trim();
    const contact = (document.getElementById("fb-contact")?.value || "").trim();
    const s = session();
    try {
      await post("/api/feedback", {
        rating: rating,
        category: category,
        comment: comment,
        name: name,
        contact: contact || null,
        account_id: s?.account_id || null,
      });
    } catch (err) {
      alert("Could not submit feedback: " + err.message);
      return;
    }
    // Keep the local store in sync so the staff Feedback page's "Recent" list
    // (still localStorage-backed) shows it immediately too.
    if (window.FeedbackStore)
      FeedbackStore.add({ rating, category, comment, name, contact });
    if (typeof closeServiceModal === "function") closeServiceModal("feedback");
    if (typeof logAudit === "function")
      logAudit("FEEDBACK_SUBMIT", `Feedback submitted — rated ${rating}/5`, "info", "feedback");
    if (typeof refreshRecentFeedback === "function") refreshRecentFeedback();
    toast("Feedback submitted! Thank you for your input.", "<i data-icon=message-square></i>");
  };

  // ── live resident search on index.html ────────────────────────────────
  // index.html ships a hardcoded RESIDENTS_DATA demo list; the MIS pages get
  // the live version from shell.js. Only override where shell.js is absent.
  if (typeof window.loadSearchResidents !== "function") {
    let LIVE_RESIDENTS = null;

    window.renderResidentResults = function (filtered) {
      const container = document.getElementById("resident-results");
      if (!container) return;
      if (LIVE_RESIDENTS === null) {
        container.innerHTML = '<div class="resident-summary">Loading residents…</div>';
        get("/api/residents")
          .then((rows) => {
            LIVE_RESIDENTS = rows;
            window.filterResidents();
          })
          .catch((err) => {
            container.innerHTML =
              '<div class="resident-empty">Could not reach the server (' +
              esc(err.message) +
              ").</div>";
          });
        return;
      }
      const list = Array.isArray(filtered) ? filtered : LIVE_RESIDENTS;
      if (!list.length) {
        container.innerHTML =
          '<div class="resident-empty">No residents found matching your search criteria.</div>';
        return;
      }
      container.innerHTML =
        `<div class="resident-summary">Showing ${list.length} result${list.length !== 1 ? "s" : ""}</div>` +
        list
          .map((r) => {
            const claimed = r.claimed === true;
            const cats = (r.cats || []).map((c) => CAT_LABELS[c] || c).join(", ");
            const parts = (r.name || "").split(",");
            const initials =
              ((parts[1] ? parts[1].trim()[0] : "") + (parts[0] ? parts[0][0] : "")) || "?";
            return `
        <div class="resident-card">
          <div class="resident-avatar-sm">${esc(initials)}</div>
          <div class="resident-info">
            <h4>${esc(r.name)}</h4>
            <p>${r.age == null ? "—" : r.age + " yrs"} · ${esc(r.purok || "—")}${cats ? " · " + esc(cats) : ""}</p>
          </div>
          <span class="badge ${claimed ? "badge-success" : "badge-gray"} badge-align-right">${claimed ? "Active" : "Unclaimed"}</span>
        </div>`;
          })
          .join("");
    };

    window.filterResidents = function () {
      if (LIVE_RESIDENTS === null) {
        window.renderResidentResults("");
        return;
      }
      const nameQ = (document.getElementById("res-search-name")?.value || "").toLowerCase();
      const purokQ = document.getElementById("res-search-purok")?.value || "";
      const catQ = document.getElementById("res-search-cat")?.value || "";
      const statusQ = document.getElementById("res-search-status")?.value || "";
      const filtered = LIVE_RESIDENTS.filter((r) => {
        const cats = (r.cats || []).map((c) => CAT_LABELS[c] || c);
        const statusLabel = r.claimed === true ? "Active" : "Unclaimed";
        return (
          (!nameQ || (r.name || "").toLowerCase().includes(nameQ)) &&
          (!purokQ || (r.purok && purokQ.indexOf(r.purok) === 0)) &&
          (!catQ || cats.indexOf(catQ) !== -1) &&
          (!statusQ || statusLabel === statusQ)
        );
      });
      window.renderResidentResults(filtered);
    };
  }

  // ── account panels (injected modals) ───────────────────────────────────
  function ensurePanels() {
    if (document.getElementById("modal-acct-info")) return;
    const wrap = document.createElement("div");
    wrap.innerHTML = ["acct-info", "acct-requests", "acct-activity", "acct-notifs"]
      .map(
        (key) => `
      <div class="modal-backdrop" id="modal-${key}" onclick="closeServiceModal('${key}', event)">
        <div class="modal-box">
          <div class="modal-header">
            <div class="modal-title"><div class="modal-title-icon"><i data-icon="${
              { "acct-info": "user", "acct-requests": "file-text", "acct-activity": "clock", "acct-notifs": "bell" }[key]
            }"></i></div> <span id="${key}-title"></span></div>
            <button class="modal-close" onclick="closeServiceModal('${key}')"><i data-icon=x></i></button>
          </div>
          <div class="modal-body" id="${key}-body"></div>
          <div class="modal-footer">
            <button class="btn btn-outline" onclick="closeServiceModal('${key}')">Close</button>
          </div>
        </div>
      </div>`
      )
      .join("");
    document.body.appendChild(wrap);
    hydrate(wrap);
  }

  function openPanel(key, title, render) {
    ensurePanels();
    document.getElementById(key + "-title").textContent = title;
    const body = document.getElementById(key + "-body");
    const s = session();
    if (!s) {
      body.innerHTML =
        '<div class="alert alert-info"><span class="alert-icon"><i data-icon=info></i></span> Please sign in first to view this.</div>';
    } else {
      body.innerHTML =
        '<p class="table-muted" style="text-align:center;padding:24px">Loading…</p>';
      render(body, s);
    }
    document.getElementById("modal-" + key).classList.add("open");
    hydrate(body);
  }

  const row = (label, value) => `
    <div style="display:flex;justify-content:space-between;gap:16px;padding:8px 0;border-bottom:1px solid rgba(0,0,0,.06)">
      <span class="table-muted" style="flex-shrink:0">${label}</span>
      <span style="text-align:right;font-weight:500">${value}</span>
    </div>`;
  const dash = '<span class="table-muted">—</span>';
  const v = (x) => (x == null || x === "" ? dash : esc(x));

  // My Information — account details + (for residents) the full record.
  window.openMyInfo = function () {
    openPanel("acct-info", "My Information", async (body, s) => {
      const accountBlock =
        `<div style="font-weight:700;font-size:13px;letter-spacing:.4px;color:var(--navy,#0b1d3a);margin-bottom:4px">ACCOUNT</div>` +
        row("Name", v(s.displayName)) +
        row("Email", v(s.user)) +
        row("Role", v(s.role));
      if (!s.resident_id) {
        body.innerHTML =
          accountBlock +
          `<p class="modal-help-text" style="margin-top:12px">This account is not linked to a resident record — staff accounts only carry the details above.</p>`;
        return;
      }
      let r;
      try {
        r = await get("/api/residents/" + s.resident_id);
      } catch (err) {
        body.innerHTML =
          accountBlock +
          `<div class="alert alert-warning" style="margin-top:12px"><span class="alert-icon"><i data-icon=triangle-alert></i></span> Could not load your barangay record (${esc(err.message)}).</div>`;
        hydrate(body);
        return;
      }
      const fullName =
        `${r.last_name}, ${r.first_name}` +
        (r.middle_name ? " " + r.middle_name[0] + "." : "") +
        (r.suffix ? " " + r.suffix : "");
      const cats = (r.classifications || [])
        .map((c) => `<span class="badge badge-gold">${esc(CAT_LABELS[c] || c)}</span>`)
        .join(" ");
      body.innerHTML =
        accountBlock +
        `<div style="font-weight:700;font-size:13px;letter-spacing:.4px;color:var(--navy,#0b1d3a);margin:16px 0 4px">BARANGAY RECORD</div>` +
        row("Full Name", esc(fullName)) +
        row("Age", r.age == null ? dash : r.age + " yrs") +
        row("Birthdate", v(fmtDate(r.birthdate))) +
        row("Sex", r.sex === "M" ? "Male" : r.sex === "F" ? "Female" : dash) +
        row("Civil Status", v(r.civil_status)) +
        row("Contact No.", v(r.contact_no)) +
        row("Occupation", v(r.occupation)) +
        row("Voter Status", v(r.voter_status)) +
        row("Purok", v(r.purok)) +
        row("Household No.", v(r.household_no)) +
        row("Address", v(r.address_text)) +
        row("Classifications", cats || dash) +
        row("Date Registered", v(fmtDate(r.date_registered)));
    });
  };

  // My Requests — the certificates this account has filed.
  window.openMyRequests = function () {
    openPanel("acct-requests", "My Requests", async (body, s) => {
      if (!s.resident_id) {
        body.innerHTML =
          '<div class="alert alert-info"><span class="alert-icon"><i data-icon=info></i></span> Requests are tracked through your barangay record — this account has no linked resident record.' +
          (s.account_id ? "" : " If you claimed your account recently, sign out and back in.") +
          "</div>";
        return;
      }
      let rows;
      try {
        rows = await get("/api/certificates?resident_id=" + s.resident_id);
      } catch (err) {
        body.innerHTML = `<div class="alert alert-warning"><span class="alert-icon"><i data-icon=triangle-alert></i></span> Could not load your requests (${esc(err.message)}).</div>`;
        hydrate(body);
        return;
      }
      if (!rows.length) {
        body.innerHTML =
          '<p class="table-muted" style="text-align:center;padding:24px">No requests yet. Certificates you request will appear here so you can track their status.</p>';
        return;
      }
      body.innerHTML = rows
        .map((r) => {
          const badge = CERT_BADGES[r.status] || "badge-gray";
          return `
        <div style="padding:10px 0;border-bottom:1px solid rgba(0,0,0,.06)">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
            <span class="table-mono" style="font-size:12px;color:#6b7280">${esc(r.request_no)}</span>
            <span class="badge ${badge}">${esc(r.status.charAt(0).toUpperCase() + r.status.slice(1))}</span>
          </div>
          <div style="font-weight:700;margin-top:2px">${esc(CERT_LABELS[r.type] || r.type)}</div>
          <div class="table-muted" style="font-size:12px">Filed ${fmtDate(r.created_at)}${r.remarks ? " · Remarks: " + esc(r.remarks) : ""}</div>
          ${r.purpose ? `<div class="table-muted" style="font-size:12px;margin-top:2px">${esc(r.purpose)}</div>` : ""}
        </div>`;
        })
        .join("");
    });
  };

  // Activity History — incident reports filed + feedback given.
  window.openActivityHistory = function () {
    openPanel("acct-activity", "Activity History", async (body, s) => {
      const items = [];
      try {
        if (s.resident_id) {
          const incidents = await get("/api/incidents?complainant_id=" + s.resident_id);
          for (const i of incidents) {
            items.push({
              ts: new Date(i.created_at).getTime(),
              icon: "siren",
              title: "Reported: " + (i.title || i.report_type),
              sub: `${i.case_no} · ${i.narration || ""}`,
              badge: i.status === "resolved" || i.status === "dismissed" ? "Resolved" : "Open",
              badgeClass:
                i.status === "resolved" || i.status === "dismissed"
                  ? "badge-success"
                  : "badge-warning",
            });
          }
        }
        if (s.account_id) {
          const feedback = await get("/api/feedback");
          for (const f of feedback) {
            if (f.account_id !== s.account_id) continue;
            items.push({
              ts: new Date(f.created_at).getTime(),
              icon: "message-square",
              title: "Feedback: " + (f.category || "Other"),
              sub: f.comment || "(no comment)",
              badge: (f.rating || 0) + "★",
              badgeClass: "badge-gold",
            });
          }
        }
      } catch (err) {
        body.innerHTML = `<div class="alert alert-warning"><span class="alert-icon"><i data-icon=triangle-alert></i></span> Could not load your activity (${esc(err.message)}).</div>`;
        hydrate(body);
        return;
      }
      if (!s.account_id && !s.resident_id) {
        body.innerHTML =
          '<div class="alert alert-info"><span class="alert-icon"><i data-icon=info></i></span> Your session is missing its account link — please sign out and sign back in.</div>';
        return;
      }
      if (!items.length) {
        body.innerHTML =
          '<p class="table-muted" style="text-align:center;padding:24px">No activity yet. Incident reports you file and feedback you send will show up here.</p>';
        return;
      }
      items.sort((a, b) => b.ts - a.ts);
      body.innerHTML = items
        .map(
          (a) => `
        <div style="display:flex;gap:10px;padding:10px 0;border-bottom:1px solid rgba(0,0,0,.06)">
          <div style="flex-shrink:0;width:32px;height:32px;border-radius:8px;background:rgba(11,29,58,.08);display:flex;align-items:center;justify-content:center"><i data-icon=${a.icon}></i></div>
          <div style="min-width:0;flex:1">
            <div style="font-weight:700">${esc(a.title)}</div>
            <div class="table-muted" style="font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(a.sub)}</div>
            <div style="margin-top:4px;display:flex;gap:8px;align-items:center">
              <span class="badge ${a.badgeClass}">${esc(a.badge)}</span>
              <span class="table-muted" style="font-size:11px">${fmtDate(a.ts)}</span>
            </div>
          </div>
        </div>`
        )
        .join("");
      hydrate(body);
    });
  };

  // ── notifications ───────────────────────────────────────────────────────
  const NOTIF_ICONS = { certificate: "file-text", message: "mail", system: "info" };
  let unreadCount = 0;

  function paintUnread() {
    // MIS topbar dot
    const dot = document.getElementById("notif-dot");
    if (dot) dot.style.display = unreadCount > 0 ? "" : "none";
    // index.html dropdown badge
    const badge = document.getElementById("nav-notif-badge");
    if (badge) {
      badge.textContent = unreadCount > 9 ? "9+" : String(unreadCount);
      badge.style.display = unreadCount > 0 ? "inline-flex" : "none";
    }
  }

  async function refreshUnread() {
    const s = session();
    if (!s || !s.account_id) {
      unreadCount = 0;
      paintUnread();
      return;
    }
    try {
      const rows = await get("/api/notifications?account_id=" + s.account_id + "&limit=100");
      unreadCount = rows.filter((n) => !n.is_read).length;
    } catch (e) {
      /* offline — keep the last known count */
    }
    paintUnread();
  }

  window.openNotifications = function () {
    openPanel("acct-notifs", "Notifications", async (body, s) => {
      if (!s.account_id) {
        body.innerHTML =
          '<div class="alert alert-info"><span class="alert-icon"><i data-icon=info></i></span> Your session is missing its account link — please sign out and sign back in to enable notifications.</div>';
        return;
      }
      let rows;
      try {
        rows = await get("/api/notifications?account_id=" + s.account_id + "&limit=100");
      } catch (err) {
        body.innerHTML = `<div class="alert alert-warning"><span class="alert-icon"><i data-icon=triangle-alert></i></span> Could not load notifications (${esc(err.message)}).</div>`;
        hydrate(body);
        return;
      }
      if (!rows.length) {
        body.innerHTML =
          '<p class="table-muted" style="text-align:center;padding:24px">Nothing here yet. Updates on your requests and messages from the barangay office will appear here.</p>';
      } else {
        body.innerHTML = rows
          .map(
            (n) => `
          <div style="display:flex;gap:10px;padding:10px;margin-bottom:6px;border-radius:10px;border:1px solid ${n.is_read ? "rgba(0,0,0,.08)" : "var(--yellow,#eab308)"};background:${n.is_read ? "transparent" : "rgba(234,179,8,.08)"}">
            <div style="flex-shrink:0;width:32px;height:32px;border-radius:8px;background:rgba(11,29,58,.08);display:flex;align-items:center;justify-content:center"><i data-icon=${NOTIF_ICONS[n.kind] || "info"}></i></div>
            <div style="min-width:0;flex:1">
              <div style="font-weight:700">${esc(n.title)}</div>
              ${n.body ? `<div class="table-muted" style="font-size:12px;line-height:1.5">${esc(n.body)}</div>` : ""}
              <div class="table-muted" style="font-size:11px;margin-top:3px">${[n.ref, fmtDate(n.created_at)].filter(Boolean).map(esc).join(" · ")}</div>
            </div>
          </div>`
          )
          .join("");
        hydrate(body);
      }
      // Opening the feed clears the unread badge (same as the mobile app).
      if (rows.some((n) => !n.is_read)) {
        post("/api/notifications/read-all", { account_id: s.account_id }).catch(() => {});
      }
      unreadCount = 0;
      paintUnread();
    });
  };

  // The topbar bell used to just toast "3 new notifications" — open the feed.
  window.toggleNotif = function () {
    window.openNotifications();
  };

  // ── boot: unread polling ────────────────────────────────────────────────
  function boot() {
    ensurePanels();
    refreshUnread();
    setInterval(refreshUnread, 60000);
  }
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
