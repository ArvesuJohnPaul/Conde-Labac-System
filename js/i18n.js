// ════════════════════ I18N ════════════════════
// Resident-facing strings in English and Filipino — the web counterpart of
// the mobile app's AppText + LocaleController
// (cares_app/lib/core/i18n/app_text.dart). Same two languages, same
// 'cares.language' preference key, same translations word for word.
//
// SCOPE: resident-facing surfaces only — the landing page, the resident
// portal, and the service modals. The staff MIS (sidebar, module pages,
// tables) stays in English on purpose: barangay personnel are trained on the
// English module names, and the app makes the same call for its own MIS
// screens. Don't add data-i18n attributes to pages/*.html.
//
// Usage in markup:
//   <span data-i18n="announcements"></span>          → textContent
//   <input data-i18n-placeholder="searchHint" />     → placeholder attribute
//   <a data-i18n-title="helpSupport">                → title attribute
// Then call L.apply() (done automatically on DOMContentLoaded and on change).
//
// Load after js/theme.js. Every page may load it; only pages with
// data-i18n attributes are affected.
(function () {
  "use strict";

  var KEY = "cares.language";
  var LANGS = ["english", "filipino"];

  // ── String table ────────────────────────────────────────────────────
  // [english, filipino] — kept in the same order and grouping as the
  // app's AppText so the two files can be diffed side by side.
  var STRINGS = {
    languageName: ["English", "Filipino"],

    // Navigation
    navHome: ["Home", "Home"],
    navServices: ["Services", "Serbisyo"],
    navGisMap: ["GIS Map", "Mapa"],
    navProfile: ["Profile", "Profile"],

    // Home
    servicesHeading: [
      "How can the barangay help you today?",
      "Paano kayo matutulungan ng barangay ngayon?",
    ],
    servicesSub: [
      "Transact with Barangay Conde Labac without lining up at the hall.",
      "Makipagtransaksyon sa Barangay Conde Labac nang hindi pumipila sa hall.",
    ],
    heroDescription: [
      "The official service platform of Barangay Conde Labac — request certificates, file blotter reports, explore the community GIS map, and reach your barangay from anywhere.",
      "Ang opisyal na serbisyong plataporma ng Barangay Conde Labac — humiling ng sertipiko, mag-file ng blotter report, tingnan ang community GIS map, at maabot ang inyong barangay kahit saan.",
    ],
    announcements: ["Announcements", "Mga Anunsyo"],
    citizenServices: ["Citizen Services", "Serbisyo sa Mamamayan"],
    chooseService: [
      "Choose a service to get started.",
      "Pumili ng serbisyo upang magsimula.",
    ],
    // Replaced noAccountNeeded — most services now sit behind an account.
    accountRequired: [
      "Accounts are required for most services.",
      "Kailangan ng account sa karamihan ng serbisyo.",
    ],
    seeAll: ["See all", "Lahat"],

    // Landing page (index.html)
    // No counterpart in the app's AppText: the app opens on a signed-in home
    // screen and has no public landing page to translate. Everything else in
    // this file is kept word for word with the app; this group is web-only by
    // nature, not by drift.
    skipToContent: ["Skip to main content", "Lumaktaw sa pangunahing nilalaman"],
    officialPortal: [
      "The Official Web Portal of Barangay Conde Labac, Batangas City",
      "Ang Opisyal na Web Portal ng Barangay Conde Labac, Batangas City",
    ],
    republic: ["Republic of the Philippines", "Republika ng Pilipinas"],
    navBulletin: ["Bulletin", "Bulletin"],
    navOfficials: ["Officials", "Mga Opisyal"],
    navContact: ["Contact", "Kontak"],
    heroEyebrow: [
      "Official Digital Portal · Batangas City",
      "Opisyal na Digital Portal · Batangas City",
    ],
    exploreServices: ["Explore Services", "Tingnan ang mga Serbisyo"],
    viewGisMap: ["View GIS Map", "Tingnan ang GIS Map"],
    // newResident dropped with the hero's "New resident? Claim your account"
    // line — the services footnote and the footer still carry claimAccount.
    claimAccount: ["Claim your account", "I-claim ang inyong account"],
    claimToTrack: [
      "Claim an account to track your requests",
      "Mag-claim ng account upang masubaybayan ang inyong mga hiling",
    ],
    readBulletin: ["Read the bulletin", "Tingnan ang bulletin"],
    openNow: ["Open now", "Bukas ngayon"],
    closedNow: ["Closed now", "Sarado ngayon"],

    openService: ["Open service", "Buksan ang serbisyo"],
    noteLogged: [
      "Lookups logged under RA 10173",
      "Naitatala ang paghahanap sa ilalim ng RA 10173",
    ],
    noteProcessing: [
      "Ready for pickup in 1–3 working days",
      "Makukuha sa loob ng 1–3 araw ng trabaho",
    ],
    noteResponse: [
      "An official contacts you within 24 hours",
      "Kokontakin kayo ng opisyal sa loob ng 24 oras",
    ],
    noteReviewed: [
      "Reviewed monthly by barangay officials",
      "Sinusuri buwan-buwan ng mga opisyal ng barangay",
    ],

    howKicker: ["How it works", "Paano ito gumagana"],
    howTitle: ["Three steps, no queue", "Tatlong hakbang, walang pila"],
    how1Title: ["Choose a service", "Pumili ng serbisyo"],
    how1Desc: [
      "Pick a service above. It opens right here on the page — nothing to download or install.",
      "Pumili ng serbisyo sa itaas. Bubukas ito dito mismo sa pahina — walang ida-download o ii-install.",
    ],
    how2Title: ["Fill in your details", "Punan ang inyong detalye"],
    how2Desc: [
      "Give your name, purok and purpose. For an incident, drop a pin on the map where it happened.",
      "Ibigay ang inyong pangalan, purok at layunin. Para sa insidente, maglagay ng pin sa mapa kung saan ito nangyari.",
    ],
    how3Title: ["Get notified", "Makatanggap ng abiso"],
    how3Desc: [
      "Barangay staff review your request and notify you when it is ready or acted upon.",
      "Sinusuri ng kawani ng barangay ang inyong hiling at aabisuhan kayo kapag handa na ito o naaksyunan.",
    ],

    gisKicker: [
      "Geographic Information System",
      "Sistema ng Impormasyong Heograpiko",
    ],
    gisTitle: ["Community GIS Map", "Mapa ng Komunidad"],
    gisDesc: [
      "Explore households, hazard zones, roads, and community concerns across Barangay Conde Labac. Toggle the layers to view specific datasets on the interactive map.",
      "Tingnan ang mga kabahayan, hazard zone, kalsada, at alalahanin ng komunidad sa buong Barangay Conde Labac. I-toggle ang mga layer upang matingnan ang partikular na datos sa interactive na mapa.",
    ],
    gisFactBuildings: [
      "Every mapped household and building in the barangay",
      "Lahat ng naka-mapang kabahayan at gusali sa barangay",
    ],
    gisFactBase: [
      "Roads, waterways and vegetation as base layers",
      "Mga kalsada, daluyan ng tubig at halamanan bilang base layer",
    ],
    gisFactConcerns: [
      "Community concerns and incident pins filed by residents",
      "Mga alalahanin at insidenteng iniulat ng mga residente",
    ],
    gisFactPrivacy: [
      "Names and household classifications stay private on this public view",
      "Nananatiling pribado ang mga pangalan at klasipikasyon ng kabahayan sa pampublikong view na ito",
    ],
    gisDisclaimer: [
      "This map is for reference only. For precise coordinates, contact the barangay GIS officer.",
      "Ang mapa ay para sa reperensiya lamang. Para sa tumpak na koordinado, kontakin ang GIS officer ng barangay.",
    ],

    bulletinKicker: ["Community Bulletin", "Bulletin ng Komunidad"],
    bulletinTitle: ["Latest Announcements", "Pinakabagong Anunsyo"],
    bulletinDesc: [
      "Advisories, events, and community updates from the barangay.",
      "Mga advisory, kaganapan, at update mula sa barangay.",
    ],

    leadershipKicker: ["Leadership", "Pamunuan"],
    officialsTitle: ["Barangay Officials", "Mga Opisyal ng Barangay"],
    officialsDesc: [
      "The current elected officials serving Barangay Conde Labac.",
      "Ang mga kasalukuyang nahalal na opisyal na nagseserbisyo sa Barangay Conde Labac.",
    ],

    visitKicker: ["Get in touch", "Makipag-ugnayan"],
    visitTitle: [
      "Visit or call the barangay hall",
      "Bisitahin o tawagan ang barangay hall",
    ],
    visitDesc: [
      "Walk-in transactions, document pickup, and anything the portal cannot settle online are handled at the hall during office hours.",
      "Ang mga walk-in na transaksyon, pagkuha ng dokumento, at anumang hindi matatapos online ay inaasikaso sa hall tuwing oras ng opisina.",
    ],
    emergencyTitle: ["In an emergency", "Sa oras ng emergency"],
    emergencyDesc: [
      "Do not wait for an online report. Call the national emergency hotline, then the barangay.",
      "Huwag maghintay ng online na ulat. Tumawag sa pambansang emergency hotline, pagkatapos sa barangay.",
    ],
    emergencyNational: [
      "National Emergency Hotline",
      "Pambansang Emergency Hotline",
    ],

    footerBlurb: [
      "GIS-Enabled Integrated Barangay Management and Decision Support System for evidence-based local governance.",
      "GIS-Enabled Integrated Barangay Management and Decision Support System para sa pamamahalang batay sa ebidensya.",
    ],
    footerPrivacy: [
      "Resident data is handled under the Data Privacy Act of 2012 (RA 10173). Record lookups are logged.",
      "Ang datos ng residente ay pinangangasiwaan sa ilalim ng Data Privacy Act of 2012 (RA 10173). Naitatala ang paghahanap ng talaan.",
    ],
    footerQuickLinks: ["Quick Links", "Mabilisang Link"],
    footerStaffSignIn: ["Staff Sign In", "Sign In para sa Kawani"],
    footerContact: ["Contact the Barangay", "Kontakin ang Barangay"],

    // Quick info chips
    infoHotline: ["Barangay Hotline", "Hotline ng Barangay"],
    infoHours: ["Office Hours", "Oras ng Opisina"],
    infoAddress: ["Address", "Address"],
    infoPopulation: ["Population", "Populasyon"],

    // Services catalog
    svcResidency: ["Barangay Residency", "Talaan ng Residente"],
    svcResidencySub: [
      "Search and view resident records and purok listings",
      "Hanapin at tingnan ang mga talaan ng residente at listahan ng purok",
    ],
    svcCertificates: ["Certificate Issuance", "Paglabas ng Sertipiko"],
    svcCertificatesSub: [
      "Request clearances, indigency, residency & more",
      "Humiling ng clearance, indigency, residency at iba pa",
    ],
    svcIncidents: ["Blotter Reporting", "Pag-uulat ng Blotter"],
    svcIncidentsSub: [
      "File an incident report for complaints or concerns",
      "Mag-file ng incident report para sa reklamo o alalahanin",
    ],
    svcFeedback: ["Feedback", "Puna at Mungkahi"],
    svcFeedbackSub: [
      "Share comments and suggestions on barangay services",
      "Ibahagi ang inyong komento at mungkahi sa serbisyo ng barangay",
    ],

    // Profile
    myInformation: ["My Information", "Aking Impormasyon"],
    myInformationSub: [
      "View your account & barangay record",
      "Tingnan ang inyong account at talaan sa barangay",
    ],
    // My Requests and Activity History merged into one entry — see
    // openMyActivity() in js/portal-account.js. The old keys stay so the
    // mobile app and any cached markup still resolve.
    myActivity: ["My Activity", "Aking mga Aktibidad"],
    myActivitySub: [
      "Requests, reports & feedback you sent",
      "Mga hiling, ulat at punang isinumite ninyo",
    ],
    myRequests: ["My Requests", "Aking mga Hiling"],
    myRequestsSub: [
      "Track certificates & clearances",
      "Subaybayan ang mga sertipiko at clearance",
    ],
    activityHistory: ["Activity History", "Kasaysayan ng Aktibidad"],
    activityHistorySub: [
      "Reports filed & feedback given",
      "Mga ulat na isinumite at punang ibinigay",
    ],
    notifications: ["Notifications", "Mga Abiso"],
    notificationsSub: [
      "Advisories & request updates",
      "Mga advisory at update sa hiling",
    ],
    helpSupport: ["Help & Support", "Tulong at Suporta"],
    signOut: ["Sign Out", "Mag-sign Out"],
    signIn: ["Sign In", "Mag-sign In"],
    guest: ["Guest", "Bisita"],

    // Settings
    settings: ["Settings", "Mga Setting"],
    settingsSub: [
      "Appearance, language, notifications & about",
      "Itsura, wika, abiso at tungkol sa app",
    ],

    appearance: ["Appearance", "Itsura"],
    appearanceCaption: [
      "Dark mode keeps the barangay navy and gold, just easier on the eyes at night.",
      "Pinapanatili ng dark mode ang navy at ginto ng barangay — mas magaan lang sa mata kapag gabi.",
    ],
    themeSystem: ["Follow system", "Sundan ang system"],
    themeSystemSub: [
      "Match your device's display setting",
      "Tumugma sa setting ng inyong device",
    ],
    themeLight: ["Light", "Maliwanag"],
    themeLightSub: [
      "Cream background, navy text",
      "Cream na background, navy na teksto",
    ],
    themeDark: ["Dark", "Madilim"],
    themeDarkSub: [
      "Navy background, gold accents",
      "Navy na background, gintong accent",
    ],

    languageSection: ["Language", "Wika"],
    languageCaption: [
      "Applies to resident-facing screens. The staff MIS stays in English to match the mobile app.",
      "Nalalapat sa mga screen na nakaharap sa residente. Nananatiling Ingles ang MIS ng kawani upang tumugma sa mobile app.",
    ],
    languageChanged: ["Switched to English.", "Nakatakda na sa Filipino."],
    languageEnglishSub: [
      "Default · barangay forms language",
      "Default · barangay forms language",
    ],
    languageFilipinoSub: [
      "Wikang ginagamit sa barangay",
      "Wikang ginagamit sa barangay",
    ],

    security: ["Security", "Seguridad"],
    changePassword: ["Change Password", "Palitan ang Password"],
    changePasswordSub: [
      "Requires your current password",
      "Kailangan ang kasalukuyang password",
    ],

    notificationsGroup: ["Notifications", "Mga Abiso"],
    notifAdvisories: ["Barangay advisories", "Mga advisory ng barangay"],
    notifAdvisoriesSub: [
      "Announcements, calamity and curfew notices",
      "Anunsyo, kalamidad at curfew na abiso",
    ],
    notifRequests: ["Request updates", "Update sa mga hiling"],
    notifRequestsSub: [
      "When a certificate or report changes status",
      "Kapag nagbago ang status ng sertipiko o ulat",
    ],

    about: ["About", "Tungkol Dito"],
    version: ["Version", "Bersyon"],
    signedInAs: ["Signed in as", "Naka-sign in bilang"],

    // Change password
    pwIntro: [
      "Enter your current password first. Being signed in alone is not enough — this protects your account if your device is left unlocked.",
      "Ilagay muna ang inyong kasalukuyang password. Hindi sapat ang naka-sign in lamang — pinoprotektahan nito ang inyong account kung maiwan ang device nang nakabukas.",
    ],
    pwCurrent: ["Current Password", "Kasalukuyang Password"],
    pwCurrentHint: [
      "The password you use now",
      "Ang password na ginagamit ninyo ngayon",
    ],
    pwNew: ["New Password", "Bagong Password"],
    pwNewHint: ["At least 8 characters", "Hindi bababa sa 8 karakter"],
    pwConfirm: ["Confirm New Password", "Kumpirmahin ang Bagong Password"],
    pwConfirmHint: [
      "Re-enter the new password",
      "Ilagay muli ang bagong password",
    ],
    pwSubmit: ["Change Password", "Palitan ang Password"],
    pwSaving: ["Saving…", "Sine-save…"],
    pwEnterCurrent: [
      "Enter your current password.",
      "Ilagay ang kasalukuyang password.",
    ],
    pwTooShort: [
      "New password must be at least 8 characters.",
      "Dapat hindi bababa sa 8 karakter ang bagong password.",
    ],
    pwNoMatch: ["Passwords do not match.", "Hindi magkatugma ang password."],
    pwMatches: ["Passwords match.", "Magkatugma ang password."],
    pwSameAsOld: [
      "New password must be different from the current one.",
      "Dapat iba ang bagong password sa kasalukuyan.",
    ],
    pwChanged: [
      "Password changed successfully.",
      "Napalitan na ang password.",
    ],
    pwWeak: ["Weak", "Mahina"],
    pwFair: ["Fair", "Katamtaman"],
    pwStrong: ["Strong", "Malakas"],
  };

  var listeners = [];
  var language = read();

  function read() {
    try {
      var saved = localStorage.getItem(KEY);
      return LANGS.indexOf(saved) !== -1 ? saved : "english";
    } catch (e) {
      return "english";
    }
  }

  function index() {
    return language === "filipino" ? 1 : 0;
  }

  // Look up one string. An unknown key returns the key itself and warns —
  // the app gets a compile error for this, the web can only shout.
  function t(key) {
    var pair = STRINGS[key];
    if (!pair) {
      console.warn("[i18n] unknown key:", key);
      return key;
    }
    return pair[index()] || pair[0];
  }

  // "Advisories turned on." — the app's turnedOn()/turnedOff().
  function turnedOn(what) {
    return language === "filipino"
      ? "Naka-on ang " + what + "."
      : what + " turned on.";
  }
  function turnedOff(what) {
    return language === "filipino"
      ? "Naka-off ang " + what + "."
      : what + " turned off.";
  }

  // Swap every translated node in the document (or a subtree).
  function apply(root) {
    var scope = root || document;
    scope.querySelectorAll("[data-i18n]").forEach(function (el) {
      el.textContent = t(el.getAttribute("data-i18n"));
    });
    scope.querySelectorAll("[data-i18n-placeholder]").forEach(function (el) {
      el.setAttribute(
        "placeholder",
        t(el.getAttribute("data-i18n-placeholder")),
      );
    });
    scope.querySelectorAll("[data-i18n-title]").forEach(function (el) {
      el.setAttribute("title", t(el.getAttribute("data-i18n-title")));
    });
    if (!root) {
      // Keep the document language in sync for screen readers and
      // browser translation prompts.
      document.documentElement.setAttribute(
        "lang",
        language === "filipino" ? "fil" : "en",
      );
    }
  }

  function notify() {
    listeners.forEach(function (fn) {
      try {
        fn(language);
      } catch (e) {
        console.error("[i18n] listener failed", e);
      }
    });
  }

  function setLanguage(next) {
    if (LANGS.indexOf(next) === -1 || next === language) return;
    language = next;
    try {
      localStorage.setItem(KEY, next);
    } catch (e) {
      // A failed write only costs the preference on the next visit.
    }
    apply();
    notify();
  }

  // Another tab changed the language — mirror it here.
  window.addEventListener("storage", function (e) {
    if (e.key !== KEY) return;
    language = read();
    apply();
    notify();
  });

  window.L = {
    get language() {
      return language;
    },
    get isFilipino() {
      return language === "filipino";
    },
    t: t,
    turnedOn: turnedOn,
    turnedOff: turnedOff,
    setLanguage: setLanguage,
    apply: apply,
    // Register a callback fired whenever the language changes.
    // Returns an unsubscribe function.
    subscribe: function (fn) {
      if (typeof fn !== "function") return function () {};
      listeners.push(fn);
      return function () {
        var i = listeners.indexOf(fn);
        if (i !== -1) listeners.splice(i, 1);
      };
    },
  };

  document.addEventListener("DOMContentLoaded", function () {
    apply();
  });
})();
