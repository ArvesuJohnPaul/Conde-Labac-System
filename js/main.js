// =====================================================
// CONDE LABAK GIS BARANGAY SYSTEM - MAIN JAVASCRIPT
// =====================================================

document.addEventListener("DOMContentLoaded", function () {
  initializeSidebarToggle();
  setActiveNavItem();
  initializeEventListeners();
});

// ===== SIDEBAR TOGGLE FOR MOBILE =====
function initializeSidebarToggle() {
  const sidebarToggle = document.getElementById("sidebarToggle");
  const sidebar = document.getElementById("sidebar");

  if (sidebarToggle) {
    sidebarToggle.addEventListener("click", function () {
      sidebar.classList.toggle("mobile-open");
      // Close user dropdown when opening sidebar
      const dropdown = document.getElementById("nav-user-dropdown");
      if (dropdown) dropdown.classList.remove("open");
    });
  }

  // Close sidebar when clicking on nav items
  const navItems = document.querySelectorAll(".nav-item");
  navItems.forEach((item) => {
    item.addEventListener("click", function () {
      if (window.innerWidth < 768) {
        sidebar.classList.remove("mobile-open");
      }
    });
  });

  // Close sidebar when clicking outside
  document.addEventListener("click", function (event) {
    if (
      window.innerWidth < 768 &&
      !sidebar.contains(event.target) &&
      !sidebarToggle.contains(event.target)
    ) {
      sidebar.classList.remove("mobile-open");
    }
  });
}

// ===== SET ACTIVE NAV ITEM =====
function setActiveNavItem() {
  const currentPage = window.location.pathname.split("/").pop();
  const navItems = document.querySelectorAll(".nav-item");

  navItems.forEach((item) => {
    item.classList.remove("active");
    const href = item.getAttribute("href");
    if (
      href === currentPage ||
      (currentPage === "" && href === "index.html") ||
      (currentPage === "index.html" && href === "index.html")
    ) {
      item.classList.add("active");
    }
  });
}

// ===== INITIALIZE EVENT LISTENERS =====
function initializeEventListeners() {
  // Alert close buttons
  const alertCloseButtons = document.querySelectorAll(".alert-close");
  alertCloseButtons.forEach((btn) => {
    btn.addEventListener("click", function () {
      this.parentElement.style.display = "none";
    });
  });

  // Modal functionality
  const modalCloseButtons = document.querySelectorAll(".modal-close-btn");
  modalCloseButtons.forEach((btn) => {
    btn.addEventListener("click", function () {
      const modal = this.closest(".modal");
      if (modal) {
        modal.classList.remove("active");
      }
    });
  });

  // Close modal when clicking outside
  document.querySelectorAll(".modal").forEach((modal) => {
    modal.addEventListener("click", function (e) {
      if (e.target === this) {
        this.classList.remove("active");
      }
    });
  });
}

// ===== UTILITY FUNCTIONS =====

/**
 * Format date to readable format
 */
function formatDate(date) {
  const options = { year: "numeric", month: "short", day: "numeric" };
  return new Date(date).toLocaleDateString("en-US", options);
}

/**
 * Format time to relative format (e.g., "2 hours ago")
 */
function formatRelativeTime(date) {
  const now = new Date();
  const diff = now - new Date(date);
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return "Just now";
  if (minutes < 60) return `${minutes} minute${minutes !== 1 ? "s" : ""} ago`;
  if (hours < 24) return `${hours} hour${hours !== 1 ? "s" : ""} ago`;
  if (days < 30) return `${days} day${days !== 1 ? "s" : ""} ago`;

  return formatDate(date);
}

/**
 * Show notification toast
 */
function showNotification(message, type = "info", duration = 4000) {
  const toastHtml = `
        <div class="alert alert-${type}" role="alert" style="
            position: fixed;
            top: 20px;
            right: 20px;
            z-index: 9999;
            min-width: 300px;
            max-width: 500px;
            animation: slideIn 0.3s ease;
        ">
            ${message}
            <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
        </div>
    `;

  const container = document.createElement("div");
  container.innerHTML = toastHtml;
  document.body.appendChild(container);

  if (duration > 0) {
    setTimeout(() => {
      container.remove();
    }, duration);
  }
}

/**
 * Open a modal dialog
 */
function openModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.add("active");
  }
}

/**
 * Close a modal dialog
 */
function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.remove("active");
  }
}

/**
 * Validate email format
 */
function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Validate phone format (Philippines)
 */
function isValidPhone(phone) {
  const phoneRegex = /^(\+63|0)?9\d{9}$/;
  return phoneRegex.test(phone.replace(/\s/g, ""));
}

/**
 * Show form validation error
 */
function showFieldError(fieldId, message) {
  const field = document.getElementById(fieldId);
  if (field) {
    field.classList.add("error");
    let errorElement = field.nextElementSibling;
    if (!errorElement || !errorElement.classList.contains("form-error")) {
      errorElement = document.createElement("div");
      errorElement.className = "form-error";
      field.parentNode.insertBefore(errorElement, field.nextSibling);
    }
    errorElement.textContent = message;
  }
}

/**
 * Clear form validation error
 */
function clearFieldError(fieldId) {
  const field = document.getElementById(fieldId);
  if (field) {
    field.classList.remove("error");
    const errorElement = field.nextElementSibling;
    if (errorElement && errorElement.classList.contains("form-error")) {
      errorElement.remove();
    }
  }
}

/**
 * Validate form before submission
 */
function validateForm(formId) {
  const form = document.getElementById(formId);
  if (!form) return false;

  let isValid = true;
  const inputs = form.querySelectorAll("[required]");

  inputs.forEach((input) => {
    if (!input.value.trim()) {
      showFieldError(input.id, "This field is required");
      isValid = false;
    } else {
      clearFieldError(input.id);
    }

    // Email validation
    if (input.type === "email" && input.value && !isValidEmail(input.value)) {
      showFieldError(input.id, "Please enter a valid email");
      isValid = false;
    }

    // Phone validation
    if (
      input.classList.contains("phone-field") &&
      input.value &&
      !isValidPhone(input.value)
    ) {
      showFieldError(input.id, "Please enter a valid phone number");
      isValid = false;
    }
  });

  return isValid;
}

/**
 * Export table to CSV
 */
function exportTableToCSV(tableId, filename) {
  const table = document.getElementById(tableId);
  if (!table) return;

  let csv = [];
  const rows = table.querySelectorAll("tr");

  rows.forEach((row) => {
    const cells = row.querySelectorAll("td, th");
    const csvRow = Array.from(cells).map((cell) => {
      let text = cell.textContent.trim();
      if (text.includes(",") || text.includes('"') || text.includes("\n")) {
        text = '"' + text.replace(/"/g, '""') + '"';
      }
      return text;
    });
    csv.push(csvRow.join(","));
  });

  downloadCSV(csv.join("\n"), filename);
}

/**
 * Download CSV file
 */
function downloadCSV(csv, filename) {
  const link = document.createElement("a");
  link.href = "data:text/csv;charset=utf-8," + encodeURIComponent(csv);
  link.download = filename;
  link.click();
}

/**
 * Format currency
 */
function formatCurrency(amount) {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
  }).format(amount);
}

/**
 * Format large numbers with separators
 */
function formatNumber(num) {
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * Get status badge HTML
 */
function getStatusBadge(status) {
  const statusMap = {
    pending: { class: "badge-warning", label: "Pending" },
    approved: { class: "badge-success", label: "Approved" },
    rejected: { class: "badge-danger", label: "Rejected" },
    processing: { class: "badge-info", label: "Processing" },
    completed: { class: "badge-success", label: "Completed" },
    critical: { class: "badge-danger", label: "Critical" },
  };

  const statusInfo = statusMap[status.toLowerCase()] || {
    class: "badge-primary",
    label: status,
  };
  return `<span class="badge ${statusInfo.class}">${statusInfo.label}</span>`;
}

/**
 * API Call Wrapper with loading state
 */
async function apiCall(url, options = {}) {
  const defaultOptions = {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${localStorage.getItem("authToken")}`,
    },
  };

  const finalOptions = { ...defaultOptions, ...options };

  try {
    const response = await fetch(url, finalOptions);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error("API Error:", error);
    showNotification("An error occurred. Please try again.", "danger");
    throw error;
  }
}

/**
 * Initialize charts (Chart.js)
 */
function initializeChart(canvasId, chartType, data, options = {}) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return null;

  const ctx = canvas.getContext("2d");

  return new Chart(ctx, {
    type: chartType,
    data: data,
    options: {
      responsive: true,
      maintainAspectRatio: false,
      ...options,
    },
  });
}

/**
 * Initialize GIS Map (Leaflet.js)
 */
function initializeMap(
  mapId,
  latitude = 13.8784,
  longitude = 121.0832,
  zoom = 15,
) {
  const mapElement = document.getElementById(mapId);
  if (!mapElement) return null;

  const map = L.map(mapId).setView([latitude, longitude], zoom);

  // Add OpenStreetMap tiles
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap contributors",
    maxZoom: 19,
  }).addTo(map);

  // Add marker
  L.marker([latitude, longitude])
    .addTo(map)
    .bindPopup("Conde Labak, Batangas City")
    .openPopup();

  return map;
}

/**
 * Add heatmap layer to map (for incident visualization)
 */
function addHeatmapLayer(map, dataPoints) {
  if (typeof L.heatLayer === "undefined") {
    console.error("Leaflet Heat plugin not loaded");
    return;
  }

  L.heatLayer(dataPoints, {
    radius: 25,
    blur: 15,
    maxZoom: 17,
    minOpacity: 0.3,
  }).addTo(map);
}

/**
 * Save user preference to localStorage
 */
function savePreference(key, value) {
  localStorage.setItem(`pref_${key}`, JSON.stringify(value));
}

/**
 * Get user preference from localStorage
 */
function getPreference(key, defaultValue = null) {
  const stored = localStorage.getItem(`pref_${key}`);
  return stored ? JSON.parse(stored) : defaultValue;
}

/**
 * Clear all user preferences
 */
function clearAllPreferences() {
  Object.keys(localStorage).forEach((key) => {
    if (key.startsWith("pref_")) {
      localStorage.removeItem(key);
    }
  });
}

// ===== CSS ANIMATIONS =====
const style = document.createElement("style");
style.textContent = `
    @keyframes slideIn {
        from {
            transform: translateX(400px);
            opacity: 0;
        }
        to {
            transform: translateX(0);
            opacity: 1;
        }
    }
    
    @keyframes fadeIn {
        from {
            opacity: 0;
        }
        to {
            opacity: 1;
        }
    }
    
    @keyframes bounce {
        0%, 100% {
            transform: translateY(0);
        }
        50% {
            transform: translateY(-10px);
        }
    }
`;
document.head.appendChild(style);

// Export functions for use in other modules
window.CondeLabak = {
  formatDate,
  formatRelativeTime,
  showNotification,
  openModal,
  closeModal,
  isValidEmail,
  isValidPhone,
  showFieldError,
  clearFieldError,
  validateForm,
  exportTableToCSV,
  formatCurrency,
  formatNumber,
  getStatusBadge,
  apiCall,
  initializeChart,
  initializeMap,
  addHeatmapLayer,
  savePreference,
  getPreference,
  clearAllPreferences,
};
