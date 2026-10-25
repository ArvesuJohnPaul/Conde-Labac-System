// js/account-application.js — "Apply for an Account".
//
// A resident asks for an online account with their details, a valid ID and a
// selfie holding it; a barangay official or Admin approves it on the MIS
// Account Claiming page. It replaced the old claim, which needed only a name
// and a birthdate — two facts anyone could know.
//
// One wizard, two homes: claim-account.html (its own page) and the portal's
// service modal (#modal-accounts in the MIS pages). Each gives it a root:
//
//   AccountApplication.mount(rootEl, { mode: "page" | "modal", onDone })
//
// Server side: routes/account-applications.js. Nothing is sent until the
// resident presses Submit — then the draft, the photos and the submit go in
// one run, so half-finished applications are not left behind. The page never
// says whether a barangay record was found: that is for the reviewer only.
//
// THE ONE EXCEPTION is "Text me a code" on the number step: asking for a text
// obviously has to send something, so that button is what creates the draft.
// Submit then reuses it. Skip the step and the old behaviour is unchanged.
//
// That step is OPTIONAL and is hidden entirely unless the server says a text
// would really arrive (`mobile_confirmation` on /id-types). Confirming the
// number is evidence for the reviewer — it proves the applicant holds the
// number they typed, and the reviewer can see whether it matches the one on
// the record — not a gate (SMS-HOTLINE-PLAN.md §5.3).
(function () {
  // Longest edge of an uploaded photo. Enough to read an ID number; a 12-MP
  // phone photo shrinks from ~4 MB to a few hundred KB, well under the 3 MB cap.
  const IMG_MAX_EDGE = 1600;
  const IMG_MAX_BYTES = 3 * 1024 * 1024;

  const esc = (s) =>
    String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
    );

  // A phone photo, made small enough to send: re-drawn at IMG_MAX_EDGE as a
  // JPEG. Also normalises formats the server will not take (and strips the
  // photo's location metadata, which a re-drawn canvas never carries).
  function shrinkPhoto(file) {
    return new Promise((resolve, reject) => {
      if (!file || !/^image\//.test(file.type || "image/"))
        return reject(new Error("Choose a photo (JPEG or PNG)."));
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, IMG_MAX_EDGE / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        let q = 0.85;
        let data = canvas.toDataURL("image/jpeg", q);
        while (data.length * 0.75 > IMG_MAX_BYTES && q > 0.4) {
          q -= 0.15;
          data = canvas.toDataURL("image/jpeg", q);
        }
        resolve(data);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("This photo could not be read. Take it again, or choose a JPEG or PNG."));
      };
      img.src = url;
    });
  }

  function mount(root, opts) {
    opts = opts || {};
    const modal = opts.mode === "modal";
    const state = {
      step: 1,
      photos: { id_front: null, id_back: null, selfie: null },
      ref: null,
      token: null, // the draft's one-time token, kept while retrying a failed upload
      busy: false,
      // The number step: offered only when the server says a code would
      // actually reach a phone, and skippable even then.
      askMobile: false,
      codeSent: false,
      mobileConfirmed: false,
    };

    root.classList.add("acc-wizard");
    const bodyOpen = modal ? '<div class="modal-body">' : "<div>";
    const footerCls = modal ? "modal-footer" : "claim-footer";
    const cancel = modal
      ? `<button class="btn btn-outline" type="button" data-act="cancel">Cancel</button>`
      : `<a class="btn btn-outline" href="system.html">Cancel</a>`;

    root.innerHTML = `
      ${bodyOpen}
        <div class="acc-steps">
          <div class="acc-step active" data-dot="1">1</div>
          <div class="acc-step-line" data-line="1"></div>
          <div class="acc-step acc-step-mobile" data-dot="2" hidden>2</div>
          <div class="acc-step-line acc-step-mobile" data-line="2" hidden></div>
          <div class="acc-step" data-dot="3">2</div>
          <div class="acc-step-line" data-line="3"></div>
          <div class="acc-step" data-dot="4">3</div>
        </div>
        <div class="acc-step-labels"><span>Your Details</span><span class="acc-step-mobile" hidden>Your Number</span><span>Valid ID</span><span>Submitted</span></div>
        <div class="acc-alert" hidden></div>

        <div data-step="1">
          <p class="acc-step-help">
            Apply for a C.A.R.E.S. resident account. A barangay official checks
            your ID and links the account to your barangay record — or makes
            one for you if you are not registered yet.
          </p>
          <div class="form-row">
            <div class="form-group"><label class="form-label" for="aa-fname">First Name</label>
              <input class="form-control" id="aa-fname" data-rule="name" maxlength="80" autocomplete="given-name" required placeholder="Juan" /></div>
            <div class="form-group"><label class="form-label" for="aa-mname">Middle Name</label>
              <input class="form-control" id="aa-mname" data-rule="name" maxlength="80" autocomplete="additional-name" placeholder="Optional" /></div>
          </div>
          <div class="form-row">
            <div class="form-group"><label class="form-label" for="aa-lname">Last Name</label>
              <input class="form-control" id="aa-lname" data-rule="name" maxlength="80" autocomplete="family-name" required placeholder="Santos" /></div>
            <div class="form-group"><label class="form-label" for="aa-suffix">Suffix</label>
              <input class="form-control" id="aa-suffix" data-rule="name" maxlength="10" placeholder="Jr., III — optional" /></div>
          </div>
          <div class="form-row">
            <div class="form-group"><label class="form-label" for="aa-dob">Date of Birth</label>
              <input class="form-control" type="date" id="aa-dob" data-rule="past-date" autocomplete="bday" required /></div>
            <div class="form-group"><label class="form-label" for="aa-sex">Sex</label>
              <select class="form-control" id="aa-sex"><option value="">Select sex</option><option value="M">Male</option><option value="F">Female</option></select></div>
          </div>
          <div class="form-row">
            <div class="form-group"><label class="form-label" for="aa-purok">Purok</label>
              <select class="form-control" id="aa-purok"><option value="">Loading…</option></select></div>
            <div class="form-group"><label class="form-label" for="aa-address">House No. / Street</label>
              <input class="form-control" id="aa-address" data-rule="address" maxlength="200" autocomplete="street-address" placeholder="Optional" /></div>
          </div>
          <div class="form-group"><label class="form-label" for="aa-mobile">Mobile Number</label>
            <input class="form-control" type="tel" id="aa-mobile" data-rule="mobile" maxlength="11" autocomplete="tel" required placeholder="09XXXXXXXXX" />
            <div class="modal-help-text">The barangay uses this number to contact you about this application.</div></div>
          <div class="form-group"><label class="form-label" for="aa-email">Email Address</label>
            <input class="form-control" type="email" id="aa-email" autocomplete="email" required placeholder="your@email.com" />
            <div class="modal-help-text">You will sign in with this email.</div></div>
          <div class="form-row">
            <div class="form-group"><label class="form-label" for="aa-pass">Password</label>
              <input class="form-control" type="password" id="aa-pass" autocomplete="new-password" required placeholder="At least 8 characters" /></div>
            <div class="form-group"><label class="form-label" for="aa-pass2">Confirm Password</label>
              <input class="form-control" type="password" id="aa-pass2" autocomplete="new-password" required placeholder="Re-enter password" /></div>
          </div>
        </div>

        <div data-step="2" hidden>
          <p class="acc-step-help">
            We can text a six-digit code to the number you entered. Typing it
            back proves the number is yours, which helps the official match you
            to your barangay record. You can skip this and still apply.
          </p>
          <div class="form-group"><label class="form-label" for="aa-mobile2">Mobile Number</label>
            <input class="form-control" type="tel" id="aa-mobile2" data-rule="mobile" maxlength="11" autocomplete="tel" placeholder="09XXXXXXXXX" />
            <div class="modal-help-text">Change it here if it is not right.</div></div>
          <div class="acc-code-row">
            <button class="btn btn-outline" type="button" data-act="send-code">
              <i data-icon=phone></i> <span data-code-btn>Text me a code</span></button>
          </div>
          <div class="form-group" data-code-wrap hidden>
            <label class="form-label" for="aa-code">Code from the text</label>
            <input class="form-control" id="aa-code" data-rule="digits" inputmode="numeric" autocomplete="one-time-code"
                   maxlength="6" placeholder="123456" />
            <div class="modal-help-text">It is good for ten minutes. Never share it with anyone, even barangay staff.</div>
          </div>
          <div class="acc-code-row" data-code-wrap hidden>
            <button class="btn btn-gold" type="button" data-act="confirm-code"><i data-icon=check></i> Confirm my number</button>
          </div>
          <div class="acc-confirmed" data-confirmed hidden>
            <i data-icon=check-circle></i> <span>Your number is confirmed.</span>
          </div>
        </div>

        <div data-step="3" hidden>
          <p class="acc-step-help">
            Take clear photos in good light, with every corner of the ID in the
            picture. The selfie shows the official that the person holding the
            ID is the person on it.
          </p>
          <div class="form-group"><label class="form-label" for="aa-idtype">Kind of ID</label>
            <select class="form-control" id="aa-idtype" required><option value="">Loading…</option></select></div>
          <div class="acc-photo-grid">
            ${photoSlot("id_front", "Front of the ID", "environment", true)}
            ${photoSlot("id_back", "Back of the ID", "environment", false)}
            ${photoSlot("selfie", "Selfie holding the ID", "user", true)}
          </div>
          <label class="acc-consent">
            <input type="checkbox" id="aa-consent" />
            <span>I agree that Barangay Conde Labac may use these photos only to
            confirm who I am for this application. They are seen only by the
            officials who review it and are deleted 30 days after the decision
            (Data Privacy Act of 2012, RA 10173).</span>
          </label>
        </div>

        <div data-step="4" class="acc-step-complete" hidden>
          <div class="acc-success-icon"><i data-icon=check></i></div>
          <h3 class="acc-success-title">Application Received</h3>
          <p class="acc-success-copy">
            A barangay official will check your ID. You can sign in with your
            email and password once your application is approved. If you are
            asked to visit the barangay hall, bring the same ID.
          </p>
          <div class="acc-ref-box">
            <div class="acc-ref-label">Reference Number</div>
            <div class="acc-ref-number" data-ref>—</div>
          </div>
        </div>
      </div>
      <div class="${footerCls}" data-footer>
        ${cancel}
        <button class="btn btn-outline" type="button" data-act="back" hidden><i data-icon=arrow-left></i> Back</button>
        <button class="btn btn-gold" type="button" data-act="next">Next <i data-icon=arrow-right></i></button>
      </div>`;

    function photoSlot(kind, label, facing, required) {
      return `
        <div class="acc-photo" data-kind="${kind}">
          <div class="acc-photo-label">${esc(label)}${required ? "" : ' <span class="table-muted">(if it has details)</span>'}</div>
          <label class="acc-photo-drop">
            <input type="file" accept="image/*" capture="${facing}" data-photo="${kind}" hidden />
            <span class="acc-photo-empty"><i data-icon=camera></i><span>Take or choose a photo</span></span>
            <img alt="" hidden />
          </label>
        </div>`;
    }

    const $ = (sel) => root.querySelector(sel);
    const val = (id) => (root.querySelector("#" + id)?.value || "").trim();

    function showAlert(msg) {
      const box = $(".acc-alert");
      if (!msg) {
        box.hidden = true;
        box.innerHTML = "";
        return;
      }
      box.hidden = false;
      box.innerHTML = `<div class="alert alert-warning alert-mb"><span class="alert-icon"><i data-icon=triangle-alert></i></span> ${esc(msg)}</div>`;
      if (typeof hydrateIcons === "function") hydrateIcons(box);
      box.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
    }
    // Field-level marking where js/motion.js is loaded, the alert otherwise.
    function reject(id, msg) {
      showAlert(msg);
      if (window.Motion) Motion.reject(id, msg);
      return false;
    }

    function setStep(n) {
      state.step = n;
      // The number step opens on whatever was typed on the details screen, so
      // confirming it is one tap and correcting it is an edit, not a retype.
      if (n === 2) {
        const here = $("#aa-mobile2");
        if (here && !here.value) here.value = val("aa-mobile");
      }
      root.querySelectorAll("[data-step]").forEach((el) => (el.hidden = el.dataset.step !== String(n)));
      root.querySelectorAll("[data-dot]").forEach((d) => {
        const i = Number(d.dataset.dot);
        d.classList.toggle("active", i === n);
        d.style.background = i < n ? "#22c55e" : i === n ? "var(--navy)" : "";
        d.style.color = i <= n ? "#fff" : "";
        d.innerHTML = i < n ? "<i data-icon=check></i>" : String(i);
      });
      root.querySelectorAll("[data-line]").forEach((l) => {
        l.style.background = Number(l.dataset.line) < n ? "#22c55e" : "";
      });
      const back = $('[data-act="back"]');
      const next = $('[data-act="next"]');
      back.hidden = n === 1 || n === 4;
      if (n === 1) next.innerHTML = "Next <i data-icon=arrow-right></i>";
      if (n === 2) paintNextLabel();
      if (n === 3) next.innerHTML = "Submit Application <i data-icon=check></i>";
      if (n === 4) {
        $("[data-footer]").innerHTML = modal
          ? `<button class="btn btn-gold" type="button" data-act="done">Done <i data-icon=check></i></button>`
          : `<a class="btn btn-gold" href="system.html">Go to Sign In <i data-icon=arrow-right></i></a>`;
      }
      if (typeof hydrateIcons === "function") hydrateIcons(root);
      showAlert(null);
    }

    // The number step's Next button says which choice it is: skipping the
    // confirmation, or moving on with it done. Separate from setStep() because
    // setStep clears the alert, and this is called right after one is shown.
    function paintNextLabel() {
      if (state.step !== 2) return;
      const next = $('[data-act="next"]');
      next.innerHTML = state.mobileConfirmed
        ? "Next <i data-icon=arrow-right></i>"
        : "Skip this step <i data-icon=arrow-right></i>";
      if (typeof hydrateIcons === "function") hydrateIcons(next);
    }

    function checkDetails() {
      if (window.Motion) Motion.clearErrors(root);
      const need = ["aa-fname", "aa-lname", "aa-dob", "aa-mobile", "aa-email", "aa-pass", "aa-pass2"];
      if (window.Motion) {
        if (!Motion.require(need)) {
          showAlert("Please fill in the highlighted fields.");
          return false;
        }
      } else if (need.some((id) => !val(id))) {
        showAlert("Please fill in your name, date of birth, mobile number, email and a password.");
        return false;
      }
      // Letters in the names, 11 digits in the number, a birthday that has
      // already happened — each marked on its own field (js/input-guard.js).
      if (window.InputGuard && !InputGuard.check(root)) {
        showAlert("Please correct the highlighted fields.");
        return false;
      }
      const dob = new Date(val("aa-dob") + "T00:00:00");
      if (isNaN(dob) || dob > new Date()) return reject("aa-dob", "Enter your real date of birth.");
      const digits = val("aa-mobile").replace(/[^\d+]/g, "");
      if (!/^(?:\+?63|0)?9\d{9}$/.test(digits))
        return reject("aa-mobile", "Enter a mobile number like 09171234567.");
      if (!/^\S+@\S+\.\S+$/.test(val("aa-email"))) return reject("aa-email", "Enter a valid email address.");
      const p = $("#aa-pass").value;
      if (p.length < 8) return reject("aa-pass", "Use at least 8 characters.");
      if (p !== $("#aa-pass2").value) return reject("aa-pass2", "This does not match the password above.");
      return true;
    }

    function checkId() {
      if (!val("aa-idtype")) return reject("aa-idtype", "Choose the kind of ID you are using.");
      if (!state.photos.id_front) return showAlert("Add a photo of the front of your ID."), false;
      if (!state.photos.selfie) return showAlert("Add a selfie of you holding the same ID."), false;
      if (!$("#aa-consent").checked)
        return showAlert("Please agree to the ID check notice. Your ID is needed to confirm who you are."), false;
      return true;
    }

    // Asking for a code is the one thing that sends anything before Submit —
    // it has to, because the code goes to a phone. It creates the draft if
    // there is not one yet, and Submit reuses it.
    async function sendCode() {
      const btn = $('[data-act="send-code"]');
      const label = $("[data-code-btn]");
      if (state.busy) return;
      state.busy = true;
      btn.disabled = true;
      label.textContent = "Sending\u2026";
      try {
        if (!state.token) await startDraft();
        const r = await apiPost(
          `/api/account-applications/${encodeURIComponent(state.ref)}/mobile-code`,
          { token: state.token, mobile_no: val("aa-mobile2") || val("aa-mobile") }
        );
        state.codeSent = true;
        state.mobileConfirmed = false;
        root.querySelectorAll("[data-code-wrap]").forEach((el) => (el.hidden = false));
        $("[data-confirmed]").hidden = true;
        label.textContent = "Send another code";
        showAlert(null);
        if (!r.sent)
          showAlert(
            "The code could not be texted just now. You can skip this step and still apply."
          );
        const field = $("#aa-code");
        if (field) field.focus();
      } catch (err) {
        showAlert(err.message);
        label.textContent = "Text me a code";
      } finally {
        btn.disabled = false;
        state.busy = false;
        paintNextLabel();
      }
    }

    async function confirmCode() {
      const code = ($("#aa-code").value || "").trim();
      if (!/^\d{6}$/.test(code)) return showAlert("Type the six digits from the text.");
      if (state.busy) return;
      state.busy = true;
      try {
        await apiPost(
          `/api/account-applications/${encodeURIComponent(state.ref)}/mobile-confirm`,
          { token: state.token, code }
        );
        state.mobileConfirmed = true;
        root.querySelectorAll("[data-code-wrap]").forEach((el) => (el.hidden = true));
        $("[data-confirmed]").hidden = false;
        $('[data-act="send-code"]').hidden = true;
        showAlert(null);
      } catch (err) {
        showAlert(err.message);
      } finally {
        state.busy = false;
        paintNextLabel();
      }
    }

    // The draft: made once, by whichever comes first — asking for a code or
    // pressing Submit.
    async function startDraft() {
      const res = await apiPost("/api/account-applications", {
        email: val("aa-email").toLowerCase(),
        password: $("#aa-pass").value,
        first_name: val("aa-fname"),
        middle_name: val("aa-mname") || null,
        last_name: val("aa-lname"),
        suffix: val("aa-suffix") || null,
        birthdate: val("aa-dob"),
        sex: val("aa-sex") || null,
        purok_id: val("aa-purok") || null,
        address_text: val("aa-address") || null,
        mobile_no: val("aa-mobile"),
        id_type: val("aa-idtype") || null,
        consent: true,
      });
      state.ref = res.ref;
      state.token = res.token;
      return res;
    }

    async function submit() {
      const next = $('[data-act="next"]');
      state.busy = true;
      next.disabled = true;
      const say = (t) => (next.textContent = t);
      try {
        // The draft is made once; a retry after a failed photo upload, and a
        // draft already made to send a code, both reuse it.
        if (!state.token) {
          say("Sending your details…");
          await startDraft();
        }
        const kinds = ["id_front", "id_back", "selfie"].filter((k) => state.photos[k]);
        for (let i = 0; i < kinds.length; i++) {
          say(`Uploading photo ${i + 1} of ${kinds.length}…`);
          await apiPost(`/api/account-applications/${encodeURIComponent(state.ref)}/files`, {
            token: state.token,
            kind: kinds[i],
            data_url: state.photos[kinds[i]],
          });
        }
        say("Submitting…");
        await apiPost(`/api/account-applications/${encodeURIComponent(state.ref)}/submit`, {
          token: state.token,
          // Chosen on this screen, which may be after the draft was made.
          id_type: val("aa-idtype"),
        });
        $("[data-ref]").textContent = state.ref;
        setStep(4);
        if (typeof showToast === "function")
          showToast("Application received — Ref " + state.ref, "<i data-icon=check></i>");
      } catch (err) {
        // Details the server refused send the resident back to fix them; a
        // failed upload stays here so it can simply be retried.
        const detailsProblem = !state.token;
        if (detailsProblem && !/ID|photo|consent/i.test(err.message)) setStep(1);
        showAlert(err.message);
        next.disabled = false;
        next.innerHTML = (state.step === 1 ? "Next <i data-icon=arrow-right></i>" : "Submit Application <i data-icon=check></i>");
        if (typeof hydrateIcons === "function") hydrateIcons(next);
      } finally {
        state.busy = false;
      }
    }

    root.addEventListener("click", (e) => {
      const act = e.target.closest("[data-act]")?.dataset.act;
      if (!act || state.busy) return;
      if (act === "cancel" || act === "done") return opts.onDone && opts.onDone(act);
      if (act === "back") return setStep(state.step === 3 && state.askMobile ? 2 : 1);
      if (act === "send-code") return sendCode();
      if (act === "confirm-code") return confirmCode();
      if (act === "next") {
        if (state.step === 1 && checkDetails()) setStep(state.askMobile ? 2 : 3);
        else if (state.step === 2) setStep(3);
        else if (state.step === 3 && checkId()) submit();
      }
    });

    root.addEventListener("change", async (e) => {
      const kind = e.target.dataset?.photo;
      if (!kind || !e.target.files || !e.target.files[0]) return;
      const slot = root.querySelector(`.acc-photo[data-kind="${kind}"]`);
      try {
        state.photos[kind] = await shrinkPhoto(e.target.files[0]);
        const img = slot.querySelector("img");
        img.src = state.photos[kind];
        img.hidden = false;
        slot.querySelector(".acc-photo-empty").hidden = true;
        showAlert(null);
      } catch (err) {
        state.photos[kind] = null;
        showAlert(err.message);
      }
    });

    // The two lists the form needs; a failure leaves a usable form behind.
    apiGet("/api/puroks")
      .then((rows) => {
        $("#aa-purok").innerHTML =
          `<option value="">Choose your purok</option>` +
          rows.map((p) => `<option value="${p.purok_id}">${esc(p.name)}</option>`).join("");
      })
      .catch(() => ($("#aa-purok").innerHTML = `<option value="">(could not load — leave blank)</option>`));
    apiGet("/api/account-applications/id-types")
      .then((r) => {
        $("#aa-idtype").innerHTML =
          `<option value="">Choose one</option>` +
          r.id_types.map((t) => `<option>${esc(t)}</option>`).join("");
        // The number step appears only if a code would really arrive. While
        // texting is off or in dry-run the applicant never sees it — asking
        // someone to wait for a text that cannot come is worse than not
        // asking (§5.3: the confirmation is evidence, not a gate).
        state.askMobile = r.mobile_confirmation === true;
        root
          .querySelectorAll(".acc-step-mobile")
          .forEach((el) => (el.hidden = !state.askMobile));
      })
      .catch(() => showAlert("Could not reach the barangay server. Check your connection and try again."));

    if (typeof hydrateIcons === "function") hydrateIcons(root);
    setStep(1);
  }

  window.AccountApplication = { mount };
})();
