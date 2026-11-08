import * as pdfjs from "pdfjs-dist";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import "./style.css";

pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.js";

const app = document.querySelector("#app");
const icons = {
  arrow: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>',
  chevron: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>',
  file: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h8"/></svg>',
  plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  shield: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z"/><path d="m9 12 2 2 4-4"/></svg>',
  upload: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4m-5 5 5-5 5 5M4 20h16"/></svg>',
};

const state = {
  files: [],
  agreements: [],
  file: null,
  pdfBytes: null,
  pdfBase64: null,
  pdfDocument: null,
  agreementName: "",
  templateId: "",
  page: 1,
  pageCount: 0,
  signatureField: null,
  signatureTouched: false,
};

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function formatDate(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

function statusLabel(status) {
  return ({ draft: "Draft", sent: "Awaiting signature", signed: "Signed", declined: "Declined" })[status] || status;
}

function initials(name = "") {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "—";
}

function toast(message, type = "success") {
  const existing = document.querySelector(".toast");
  existing?.remove();
  const element = document.createElement("div");
  element.className = `toast toast-${type}`;
  element.textContent = message;
  document.body.append(element);
  window.setTimeout(() => element.remove(), 3800);
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { ...(options.body ? { "content-type": "application/json" } : {}), ...options.headers },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${response.status}).`);
  }
  return response.headers.get("content-type")?.includes("application/json") ? response.json() : response;
}

async function loadFiles() {
  state.files = await api("/api/files");
  return state.files;
}

async function loadAgreements() {
  state.agreements = await api("/api/agreements");
  return state.agreements;
}

function shell(content, { active = "files", title = "Files", subtitle = "Every client agreement, in one place." } = {}) {
  app.innerHTML = `
    <div class="app-shell">
      <aside class="sidebar">
        <a class="brand" href="#" aria-label="File Agreements home">
          <span class="brand-mark">f<span>.</span></span>
          <span class="brand-name">file<span>agreements</span></span>
        </a>
        <div class="workspace-label">WORKSPACE</div>
        <button class="workspace-switch" type="button"><span class="workspace-avatar">A</span><span class="workspace-text"><b>Astra AI</b><small>Workspace</small></span><span class="workspace-dots">···</span></button>
        <nav class="side-nav" aria-label="Main navigation">
          <a class="nav-link ${active === "files" ? "active" : ""}" href="#files"><span class="nav-icon">${icons.file}</span>Files</a>
          <a class="nav-link ${active === "templates" ? "active" : ""}" href="#templates"><span class="nav-icon">${icons.file}</span>Agreements</a>
        </nav>
        <div class="sidebar-bottom">
          <div class="sidebar-help"><span class="help-icon">?</span><div><b>Need a hand?</b><small>See how signing works</small></div>${icons.chevron}</div>
          <div class="profile"><span class="profile-avatar">A</span><span><b>Anthony</b><small>Workspace admin</small></span><span class="profile-menu">···</span></div>
        </div>
      </aside>
      <main class="main-area">
        <header class="topbar"><div class="breadcrumb"><span>Astra AI</span>${icons.chevron}<b>${escapeHtml(title)}</b></div><div class="topbar-right"><span class="secure-note">${icons.shield} Secure workspace</span><button class="icon-button notification-button" aria-label="Notifications"><span></span>♧</button><span class="topbar-avatar">A</span></div></header>
        <div class="page-content">${content}</div>
      </main>
    </div>
    <div id="modal-root"></div>`;
}

function dashboard() {
  const signed = state.files.filter((file) => file.status === "signed").length;
  const pending = state.files.filter((file) => file.status === "sent").length;
  const cleared = state.files.filter((file) => file.status === "signed").length;
  const rows = state.files.length ? state.files.map((file) => `
    <button class="file-row" data-open-file="${escapeHtml(file.id)}">
      <span class="row-file-icon ${file.status === "signed" ? "row-file-signed" : ""}">${icons.file}</span>
      <span class="row-client"><b>${escapeHtml(file.clientName)}</b><small>${escapeHtml(file.reference || file.agreementName)}</small></span>
      <span class="row-agreement">${escapeHtml(file.agreementName)}</span>
      <span class="status-pill status-${escapeHtml(file.status)}"><i></i>${escapeHtml(statusLabel(file.status))}</span>
      <span class="row-date">${formatDate(file.signedAt || file.sentAt || file.createdAt)}</span>
      <span class="row-arrow">${icons.chevron}</span>
    </button>`).join("") : `
      <div class="empty-state">
        <span class="empty-illustration">${icons.file}<span>${icons.check}</span></span>
        <h3>Your next file starts here</h3>
        <p>Create a client file, add the agreement you already use, and send it for a secure signature.</p>
        <button class="button button-primary" data-action="new">${icons.plus} Create your first file</button>
      </div>`;
  shell(`
    <div class="page-heading">
      <div><div class="eyebrow">YOUR WORKSPACE <span>·</span> ${formatDate(new Date())}</div><h1>Good morning, Anthony <span class="wave">✳</span></h1><p>Get the agreement signed. Then get to work.</p></div>
      <button class="button button-primary" data-action="new">${icons.plus} New client file</button>
    </div>
    <section class="metrics" aria-label="File overview">
      <article class="metric-card"><div class="metric-top"><span>Total files</span><span class="metric-icon metric-lilac">${icons.file}</span></div><b class="metric-number">${state.files.length}</b><small>All client files</small></article>
      <article class="metric-card"><div class="metric-top"><span>Awaiting signature</span><span class="metric-icon metric-amber">${icons.arrow}</span></div><b class="metric-number">${pending}</b><small>Follow up when needed</small></article>
      <article class="metric-card"><div class="metric-top"><span>Signed agreements</span><span class="metric-icon metric-green">${icons.check}</span></div><b class="metric-number">${signed}</b><small>Ready to get started</small></article>
      <article class="metric-card"><div class="metric-top"><span>Cleared to begin</span><span class="metric-icon metric-blue">${icons.shield}</span></div><b class="metric-number">${cleared}</b><small>Agreement signed on file</small></article>
    </section>
    <section class="files-section">
      <div class="section-heading"><div><h2>Client files <span class="count-badge">${state.files.length}</span></h2><p>Every file needs a signed agreement before work begins.</p></div><div class="table-actions"><label class="search-box">${searchIcon()}<input id="file-search" type="search" placeholder="Search files" aria-label="Search client files"></label><button class="button button-secondary button-small" data-action="new">${icons.plus} New file</button></div></div>
      <div class="file-table"><div class="table-header"><span>CLIENT</span><span>AGREEMENT</span><span>STATUS</span><span>LAST UPDATED</span><span></span></div><div id="file-rows">${rows}</div><div class="table-footer"><span>Showing <b>${state.files.length ? 1 : 0}–${state.files.length}</b> of <b>${state.files.length}</b> files</span><span>Work stays locked until an agreement is signed <span class="footer-lock">${icons.shield}</span></span></div></div>
    </section>
    <footer class="page-footer"><span>Thoughtful work starts with a clear agreement.</span><span>Test data only · Made for every file <span class="footer-heart">♥</span></span></footer>
  `);
  document.querySelectorAll('[data-action="new"]').forEach((button) => button.addEventListener("click", () => newFile()));
  document.querySelectorAll("[data-open-file]").forEach((button) => button.addEventListener("click", () => openFile(button.dataset.openFile)));
  document.querySelector("#file-search")?.addEventListener("input", (event) => {
    const query = event.target.value.toLowerCase();
    document.querySelectorAll(".file-row").forEach((row) => {
      row.hidden = !row.textContent.toLowerCase().includes(query);
    });
  });
  document.querySelector('[href="#templates"]')?.addEventListener("click", (event) => {
    event.preventDefault();
    showTemplates();
  });
}

function searchIcon() {
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>';
}

function showTemplates() {
  shell(`
    <div class="back-link-wrap"><button class="text-button" data-back>${icons.arrow} Back to files</button></div>
    <div class="page-heading compact-heading"><div><div class="eyebrow">AGREEMENT LIBRARY</div><h1>One reviewed agreement. Every new file.</h1><p>Save your team's standard agreement once, then attach it to the next client file in a click.</p></div><button class="button button-primary" data-add-agreement>${icons.plus} Add an agreement</button></div>
    <div class="agreement-library">${state.agreements.length ? state.agreements.map((agreement) => `
      <article class="library-card"><span class="template-symbol">${icons.file}</span><div class="library-copy"><span class="status-pill status-signed"><i></i>Ready to use</span><h2>${escapeHtml(agreement.name)}</h2><p>${agreement.pageCount} ${agreement.pageCount === 1 ? "page" : "pages"} · Signature field on page ${agreement.signatureField.page} · Used on ${agreement.filesUsed || 0} ${agreement.filesUsed === 1 ? "file" : "files"}</p><small>Added ${formatDate(agreement.createdAt)}</small></div><button class="button button-secondary" data-use-agreement="${escapeHtml(agreement.id)}">Use for a client file ${icons.arrow}</button></article>`).join("") : `
      <div class="empty-state library-empty"><span class="empty-illustration">${icons.file}</span><h3>No saved agreements yet</h3><p>Upload your standard agreement, review it, and place the signature field once. Save it to use again on future files.</p><button class="button button-primary" data-add-agreement>${icons.plus} Add your first agreement</button></div>`}
    </div>
    <div class="feature-note">${icons.shield}<span><b>New agreements are welcome.</b> Upload a PDF we have never seen, review every page, and set its signing position before adding it to your library.</span></div>
  `, { active: "templates", title: "Agreements", subtitle: "Upload the agreement your team already uses." });
  document.querySelector("[data-back]")?.addEventListener("click", dashboard);
  document.querySelectorAll("[data-add-agreement]").forEach((button) => button.addEventListener("click", () => newFile("", false)));
  document.querySelectorAll("[data-use-agreement]").forEach((button) => button.addEventListener("click", () => newFile(button.dataset.useAgreement, false)));
}

async function newFile(templateId = null, useDefaultAgreement = true) {
  if (!state.agreements.length) {
    try {
      await loadAgreements();
    } catch (error) {
      toast(error.message, "error");
      return;
    }
  }
  const selectedTemplateId = templateId ?? (useDefaultAgreement ? state.agreements[0]?.id || "" : "");
  state.pdfBytes = null;
  state.pdfBase64 = null;
  state.pdfDocument = null;
  state.agreementName = "";
  state.templateId = "";
  state.page = 1;
  state.pageCount = 0;
  state.signatureField = null;
  shell(`
    <div class="back-link-wrap"><button class="text-button" data-back>${icons.arrow} All files</button><span class="flow-step"><b>1</b> File details <i></i><span>2</span> Place signature</span></div>
    <div class="flow-heading"><div class="eyebrow">NEW CLIENT FILE</div><h1>Start with the details.</h1><p>One client, one file, one agreement. We'll take it from here.</p></div>
    <form id="file-form" class="create-layout">
      <section class="form-card">
        <div class="card-title-row"><span class="step-number">01</span><div><h2>Client &amp; file</h2><p>Who is this agreement for?</p></div></div>
        <label class="field-label">Client name <span>*</span><input name="clientName" required minlength="2" maxlength="120" placeholder="e.g. Jordan Lee" autocomplete="name"></label>
        <label class="field-label">Client email <span>*</span><input name="clientEmail" type="email" required maxlength="254" placeholder="jordan@example.com" autocomplete="email"><small>The signing form will check this address against the one on file.</small></label>
        <label class="field-label">File reference <span class="optional">(optional)</span><input name="reference" maxlength="100" placeholder="e.g. MAT-2048"></label>
        <div class="form-divider"></div>
        <div class="card-title-row"><span class="step-number">02</span><div><h2>Your agreement</h2><p>Upload a PDF you already use with clients.</p></div></div>
        ${state.agreements.length ? `<label class="field-label">Use a saved agreement<select id="agreement-source"><option value="">Upload a new PDF</option>${state.agreements.map((agreement) => `<option value="${escapeHtml(agreement.id)}" ${agreement.id === selectedTemplateId ? "selected" : ""}>${escapeHtml(agreement.name)} · ${agreement.filesUsed} ${agreement.filesUsed === 1 ? "file" : "files"}</option>`).join("")}</select></label>` : ""}
        <div id="new-agreement-content" ${selectedTemplateId ? "hidden" : ""}>
        <label class="upload-zone" id="upload-zone" for="agreement-file">
          <span class="upload-icon">${icons.upload}</span><b id="upload-title">Choose an agreement to upload</b><span id="upload-caption">PDF only · Up to 20 MB</span>
        <input id="agreement-file" name="agreement" type="file" accept="application/pdf,.pdf">
        </label>
        <label class="save-agreement-option"><input id="save-as-agreement" type="checkbox" checked><span><b>Save for future client files</b><small>Reuse this agreement and signature position next time.</small></span></label>
        </div>
        <div id="upload-error" class="inline-error" hidden></div>
        <p class="privacy-hint">${icons.shield}<span>Stored with this workspace and attached to the client file. Use test data only.</span></p>
      </section>
      <section class="preview-card">
        <div class="card-title-row"><span class="step-number">03</span><div><h2>Place the signature field</h2><p>Choose where the client signs on the agreement.</p></div></div>
        <div class="preview-empty" id="preview-empty"><span>${icons.file}</span><b>Your agreement will appear here</b><small>Upload a PDF to review it and choose a signing spot.</small></div>
        <div class="pdf-preview-wrap" id="preview-wrap" hidden>
          <div class="pdf-toolbar"><button type="button" class="page-control" id="previous-page" aria-label="Previous page">‹</button><span>Page <b id="page-number">1</b> of <span id="page-count">1</span></span><button type="button" class="page-control" id="next-page" aria-label="Next page">›</button><span class="toolbar-spacer"></span><span class="zoom-label">PDF preview</span></div>
          <div class="pdf-sheet"><div class="pdf-canvas-wrap" id="pdf-canvas-wrap"><canvas id="agreement-canvas" aria-label="Agreement preview. Click where the client should sign."></canvas><span class="field-marker" id="field-marker" hidden>✍ SIGN HERE</span></div></div>
          <div class="preview-instruction">${icons.arrow}<span>Click the document to place the client's signature field. You can move it by clicking elsewhere.</span></div>
        </div>
        <div class="signature-placement" id="placement-status"><span class="placement-dot"></span><span>Select an agreement to continue.</span></div>
        <button class="button button-primary button-wide" id="create-file-button" type="submit" disabled>Create file &amp; review <span class="button-arrow">${icons.arrow}</span></button>
        <p class="submit-caption">You can review everything before sending.</p>
      </section>
    </form>
  `, { title: "New client file", subtitle: "Start a new file and prepare its agreement." });
  document.querySelector("[data-back]")?.addEventListener("click", dashboard);
  document.querySelector("#agreement-file").addEventListener("change", handleAgreementUpload);
  document.querySelector("#agreement-source")?.addEventListener("change", (event) => {
    loadSelectedAgreement(event.target.value);
  });
  document.querySelector("#previous-page").addEventListener("click", () => changePage(-1));
  document.querySelector("#next-page").addEventListener("click", () => changePage(1));
  document.querySelector("#agreement-canvas").addEventListener("click", placeSignatureField);
  document.querySelector("#file-form").addEventListener("submit", createFile);
  if (selectedTemplateId) loadSelectedAgreement(selectedTemplateId);
}

async function handleAgreementUpload(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const errorElement = document.querySelector("#upload-error");
  const showError = (message) => {
    errorElement.hidden = false;
    errorElement.textContent = message;
  };
  errorElement.hidden = true;
  if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
    showError("Please choose a PDF agreement.");
    event.target.value = "";
    return;
  }
  if (file.size > 20 * 1024 * 1024) {
    showError("This PDF is over 20 MB. Choose a smaller agreement.");
    event.target.value = "";
    return;
  }
  try {
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    if (new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-") throw new Error("This file is not a readable PDF.");
    const pdfDocument = await pdfjs.getDocument({ data: bytes.slice() }).promise;
    state.pdfBytes = bytes;
    state.pdfBase64 = toBase64(bytes);
    state.pdfDocument = pdfDocument;
    state.agreementName = file.name;
    state.templateId = "";
    state.page = 1;
    state.pageCount = pdfDocument.numPages;
    state.signatureField = null;
    document.querySelector("#upload-title").textContent = file.name;
    document.querySelector("#upload-caption").textContent = `${(file.size / (1024 * 1024)).toFixed(1)} MB · ${pdfDocument.numPages} ${pdfDocument.numPages === 1 ? "page" : "pages"}`;
    document.querySelector("#upload-zone").classList.add("upload-complete");
    document.querySelector("#preview-empty").hidden = true;
    document.querySelector("#preview-wrap").hidden = false;
    document.querySelector("#page-count").textContent = String(pdfDocument.numPages);
    await renderPdfPage("agreement-canvas", pdfDocument, 1, "field-marker");
    updatePlacementStatus();
    document.querySelector("#previous-page").disabled = true;
    document.querySelector("#next-page").disabled = pdfDocument.numPages === 1;
  } catch (error) {
    showError(error.message || "We couldn't read this PDF. Try another file.");
    event.target.value = "";
  }
}

async function loadSelectedAgreement(templateId) {
  state.signatureField = null;
  state.templateId = "";
  state.pdfBytes = null;
  state.pdfBase64 = null;
  state.pdfDocument = null;
  state.agreementName = "";
  state.page = 1;
  state.pageCount = 0;
  if (!templateId) {
    document.querySelector("#new-agreement-content").hidden = false;
    document.querySelector("#preview-wrap").hidden = true;
    document.querySelector("#preview-empty").hidden = false;
    document.querySelector("#upload-title").textContent = "Choose an agreement to upload";
    document.querySelector("#upload-caption").textContent = "PDF only · Up to 20 MB";
    document.querySelector("#upload-zone").classList.remove("upload-complete");
    document.querySelector("#agreement-file").value = "";
    updatePlacementStatus();
    return;
  }
  const agreement = state.agreements.find((item) => item.id === templateId);
  if (!agreement) {
    toast("Saved agreement not found. Refresh and try again.", "error");
    return;
  }
  try {
    const response = await fetch(`/api/agreements/${agreement.id}/document`);
    if (!response.ok) throw new Error("We couldn't load this saved agreement.");
    const bytes = new Uint8Array(await response.arrayBuffer());
    const pdfDocument = await pdfjs.getDocument({ data: bytes.slice() }).promise;
    state.pdfBytes = bytes;
    state.pdfDocument = pdfDocument;
    state.agreementName = agreement.name;
    state.templateId = agreement.id;
    state.page = agreement.signatureField.page;
    state.pageCount = pdfDocument.numPages;
    state.signatureField = agreement.signatureField;
    document.querySelector("#new-agreement-content").hidden = true;
    document.querySelector("#preview-empty").hidden = true;
    document.querySelector("#preview-wrap").hidden = false;
    document.querySelector("#page-count").textContent = String(pdfDocument.numPages);
    document.querySelector("#page-number").textContent = String(state.page);
    document.querySelector("#previous-page").disabled = state.page === 1;
    document.querySelector("#next-page").disabled = state.page === state.pageCount;
    await renderPdfPage("agreement-canvas", pdfDocument, state.page, "field-marker");
    updateMarker(document.querySelector("#field-marker"), state.signatureField);
    updatePlacementStatus();
  } catch (error) {
    toast(error.message, "error");
  }
}

function toBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

async function changePage(delta) {
  const page = state.page + delta;
  if (!state.pdfDocument || page < 1 || page > state.pageCount) return;
  state.page = page;
  await renderPdfPage("agreement-canvas", state.pdfDocument, page, "field-marker");
  const marker = document.querySelector("#field-marker");
  const currentField = state.signatureField?.page === page ? state.signatureField : null;
  updateMarker(marker, currentField);
  document.querySelector("#page-number").textContent = String(page);
  document.querySelector("#previous-page").disabled = page === 1;
  document.querySelector("#next-page").disabled = page === state.pageCount;
  updatePlacementStatus();
}

async function renderPdfPage(canvasId, pdfDocument, pageNumber, markerId) {
  const page = await pdfDocument.getPage(pageNumber);
  const initialViewport = page.getViewport({ scale: 1 });
  const scale = Math.min(1.6, 710 / initialViewport.width);
  const viewport = page.getViewport({ scale });
  const canvas = document.querySelector(`#${canvasId}`);
  const context = canvas.getContext("2d", { alpha: false });
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  canvas.style.aspectRatio = `${viewport.width} / ${viewport.height}`;
  await page.render({ canvasContext: context, viewport }).promise;
  if (markerId) updateMarker(document.querySelector(`#${markerId}`), null);
}

function updateMarker(marker, field) {
  if (!marker) return;
  marker.hidden = !field;
  if (field) {
    marker.style.left = `${field.x * 100}%`;
    marker.style.top = `${field.y * 100}%`;
  }
}

function placeSignatureField(event) {
  const canvas = event.currentTarget;
  if (!state.pdfDocument || state.templateId) return;
  const bounds = canvas.getBoundingClientRect();
  state.signatureField = {
    page: state.page,
    x: Math.max(0, Math.min(0.64, (event.clientX - bounds.left) / bounds.width)),
    y: Math.max(0, Math.min(0.91, (event.clientY - bounds.top) / bounds.height)),
  };
  updateMarker(document.querySelector("#field-marker"), state.signatureField);
  updatePlacementStatus();
}

function updatePlacementStatus() {
  const element = document.querySelector("#placement-status");
  if (!element) return;
  const ready = Boolean(state.signatureField);
  element.classList.toggle("placement-ready", ready);
  element.innerHTML = ready
    ? `${icons.check}<span>${state.templateId ? `Saved signature field on page ${state.signatureField.page}.` : `Signature field placed on page ${state.signatureField.page}. Click again to move it.`}</span>`
    : '<span class="placement-dot"></span><span>Select an agreement to continue.</span>';
  document.querySelector("#create-file-button").disabled = !ready;
}

async function createFile(event) {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity() || (!state.templateId && (!state.pdfBase64 || !state.signatureField))) return;
  const button = document.querySelector("#create-file-button");
  button.disabled = true;
  button.innerHTML = '<span class="spinner"></span> Preparing your file…';
  const data = new FormData(form);
  try {
    const agreementPayload = state.templateId
      ? { templateId: state.templateId }
      : {
        agreementName: state.agreementName || data.get("agreement")?.name,
        pdfBase64: state.pdfBase64,
        signatureField: state.signatureField,
        pageCount: state.pageCount,
        saveAsAgreement: document.querySelector("#save-as-agreement").checked,
      };
    const file = await api("/api/files", {
      method: "POST",
      body: JSON.stringify({
        clientName: data.get("clientName"),
        clientEmail: data.get("clientEmail"),
        reference: data.get("reference"),
        ...agreementPayload,
      }),
    });
    await loadFiles();
    await loadAgreements();
    openFile(file.id);
  } catch (error) {
    toast(error.message, "error");
    button.disabled = false;
    button.innerHTML = `Create file &amp; review <span class="button-arrow">${icons.arrow}</span>`;
  }
}

function statusMarkup(status) {
  return `<span class="status-pill status-${escapeHtml(status)}"><i></i>${escapeHtml(statusLabel(status))}</span>`;
}

function openFile(id) {
  const file = state.files.find((item) => item.id === id);
  if (!file) return dashboard();
  state.file = file;
  const canStart = file.status === "signed";
  const action = file.status === "draft" || file.status === "declined"
    ? `<button class="button button-primary" id="send-agreement">${icons.arrow} Send for signature</button>`
    : file.status === "signed"
      ? `<a class="button button-primary" href="/api/files/${escapeHtml(file.id)}/signed" download>${icons.file} Download signed agreement</a>`
      : `<button class="button button-secondary" id="copy-link">${copyIcon()} Copy signing link</button>`;
  const events = (file.events || []).slice().reverse().map((entry) => `
    <div class="timeline-item"><span class="timeline-mark ${entry.type === "agreement_signed" ? "timeline-complete" : ""}">${entry.type === "agreement_signed" ? icons.check : ""}</span><div><b>${escapeHtml(eventTitle(entry.type))}</b><p>${escapeHtml(entry.detail)}</p><small>${formatDate(entry.at)} · ${new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date(entry.at))}</small></div></div>`).join("");
  shell(`
    <div class="back-link-wrap"><button class="text-button" data-back>${icons.arrow} All files</button><span class="file-breadcrumb">${icons.chevron} ${escapeHtml(file.clientName)}</span></div>
    <div class="detail-heading"><div class="client-avatar">${escapeHtml(initials(file.clientName))}</div><div class="detail-title"><div class="eyebrow">${escapeHtml(file.reference || "CLIENT FILE")} <span>·</span> CREATED ${formatDate(file.createdAt).toUpperCase()}</div><h1>${escapeHtml(file.clientName)}</h1><p>${escapeHtml(file.clientEmail)} <span class="detail-separator">·</span> ${escapeHtml(file.agreementName)}</p></div><div class="detail-actions">${action}<button class="icon-button more-button" aria-label="More file actions">···</button></div></div>
    <section class="gate-banner ${canStart ? "gate-cleared" : ""}"><span class="gate-icon">${canStart ? icons.check : icons.shield}</span><div><b>${canStart ? "Clear to begin work" : file.status === "declined" ? "Agreement declined" : file.status === "draft" ? "Not sent yet — work cannot begin" : "Agreement not signed — work cannot begin"}</b><p>${canStart ? `Signed by ${escapeHtml(file.signerName || file.clientName)} on ${formatDate(file.signedAt)}. This file is cleared to begin.` : file.status === "draft" || file.status === "declined" ? "Review the agreement and send a secure link to your client." : `Sent to ${escapeHtml(file.clientEmail)}. This file will be cleared automatically when the agreement is signed.`}</p></div><span class="gate-status">${statusMarkup(file.status)}</span></section>
    <div class="detail-grid">
      <section class="detail-card document-card"><div class="detail-card-heading"><div><h2>Agreement</h2><p>Original agreement attached to this file.</p></div>${statusMarkup(file.status)}</div><div class="document-preview"><iframe title="Original agreement PDF" src="/api/files/${escapeHtml(file.id)}/original#toolbar=0&navpanes=0"></iframe><div class="document-overlay"></div></div><div class="document-footer"><span>${icons.file}<b>${escapeHtml(file.agreementName)}</b></span><a href="/api/files/${escapeHtml(file.id)}/original" target="_blank" rel="noopener">View original ${icons.arrow}</a></div>${canStart ? `<div class="signed-download-note">${icons.check}<span>Signed PDF includes the completed agreement and a certificate of completion.</span></div>` : ""}</section>
      <aside class="detail-card activity-card"><div class="detail-card-heading"><div><h2>Activity</h2><p>A clear record for every step.</p></div><span class="activity-count">${file.events.length}</span></div><div class="timeline">${events}</div>${file.signatureUrl && file.status === "sent" ? `<div class="share-link-card"><span class="share-icon">${icons.shield}</span><div><b>Secure signing link</b><small>Share this link with your client.</small></div><button class="copy-link-inline" id="copy-link-inline" aria-label="Copy signing link">${copyIcon()}</button><input id="signing-link" readonly value="${escapeHtml(file.signatureUrl)}"></div>` : ""}
        ${canStart ? `<a class="signed-file-link" href="/api/files/${escapeHtml(file.id)}/signed" download>${icons.file}<span><b>Signed agreement</b><small>Download completed PDF</small></span>${icons.arrow}</a>` : ""}
      </aside>
    </div>
  `, { title: "Client file", subtitle: `Agreement status for ${file.clientName}.` });
  document.querySelector("[data-back]")?.addEventListener("click", dashboard);
  document.querySelector("#send-agreement")?.addEventListener("click", () => sendAgreement(file.id));
  document.querySelector("#copy-link")?.addEventListener("click", () => copySigningLink(file.signatureUrl));
  document.querySelector("#copy-link-inline")?.addEventListener("click", () => copySigningLink(file.signatureUrl));
}

function eventTitle(type) {
  return ({
    file_created: "File created",
    agreement_sent: "Agreement sent for signature",
    agreement_signed: "Agreement signed",
    agreement_declined: "Agreement declined",
  })[type] || type;
}

function copyIcon() {
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/></svg>';
}

async function sendAgreement(id) {
  const button = document.querySelector("#send-agreement");
  button.disabled = true;
  button.innerHTML = '<span class="spinner spinner-light"></span> Creating secure link…';
  try {
    const file = await api(`/api/files/${id}/send`, { method: "POST", body: "{}" });
    await loadFiles();
    openFile(file.id);
    toast("Secure signing link is ready to share.");
  } catch (error) {
    toast(error.message, "error");
    button.disabled = false;
    button.innerHTML = `${icons.arrow} Send for signature`;
  }
}

async function copySigningLink(link) {
  try {
    await navigator.clipboard.writeText(link);
    toast("Signing link copied.");
  } catch {
    const input = document.querySelector("#signing-link");
    if (input) {
      input.select();
      document.execCommand("copy");
      toast("Signing link copied.");
    } else {
      toast("Copy the signing URL from the file details.", "error");
    }
  }
}

function signView(token) {
  shell(`
    <div class="signing-topline"><span class="brand-mark">f<span>.</span></span><span>${icons.shield} Secure electronic signing</span></div>
    <div class="signing-layout"><section class="signing-main"><div class="signing-badge">${icons.file} CLIENT AGREEMENT</div><h1>Review &amp; sign</h1><p class="signing-lede">Please read the agreement below. Your signature will be added to the marked field.</p><div class="signing-document-shell"><div class="pdf-toolbar"><button type="button" class="page-control" id="sign-previous" aria-label="Previous page">‹</button><span>Page <b id="sign-page-number">1</b> of <span id="sign-page-count">—</span></span><button type="button" class="page-control" id="sign-next" aria-label="Next page">›</button><span class="toolbar-spacer"></span><a id="open-original" class="text-link" target="_blank" rel="noopener">Open PDF ${icons.arrow}</a></div><div class="pdf-sheet sign-pdf-sheet"><div class="pdf-canvas-wrap"><canvas id="signing-pdf-canvas"></canvas><span class="field-marker signing-marker" id="sign-field-marker" hidden>✍ SIGN HERE</span></div></div></div><div class="signing-doc-caption">${icons.shield}<span>This agreement is provided securely by Astra AI. Review every page before signing.</span></div></section>
      <aside class="signing-panel"><div class="sign-panel-top"><span class="panel-step">YOUR SIGNATURE</span><span class="sign-step-number">1 / 1</span></div><h2>Ready to make it official?</h2><p>Sign below to complete this client agreement.</p><form id="sign-form">
        <label class="field-label">Full legal name <span>*</span><input id="signer-name" required minlength="2" maxlength="120" placeholder="Type your full name" autocomplete="name"></label>
        <label class="field-label">Email address <span>*</span><input id="signer-email" type="email" required maxlength="254" autocomplete="email"></label>
        <div class="field-label signature-label">Draw your signature <span>*</span><button type="button" id="clear-signature" class="clear-signature">Clear</button></div>
        <div class="signature-pad-wrap"><canvas id="signature-pad" aria-label="Draw your signature here"></canvas><span class="signature-placeholder" id="signature-placeholder">Sign here using your mouse or finger</span><span class="signature-line"></span><span class="signature-caption">Your signature</span></div>
        <label class="consent-check"><input id="sign-consent" type="checkbox" required><span>I agree to sign this document electronically. I confirm I am the person named above and have reviewed this agreement.</span></label>
        <div id="sign-error" class="inline-error" hidden></div>
        <button id="submit-signature" class="button button-primary button-wide sign-submit" type="submit" disabled>${icons.check} Sign agreement</button>
        <p class="identity-note">${icons.shield}<span>We'll match your email to the recipient address and add a completion certificate to the signed PDF.</span></p>
      </form><div class="decline-divider"><span>Not ready to sign?</span><button id="decline-agreement" class="text-button">Decline this agreement</button></div></aside>
    </div><footer class="signing-footer"><span>Powered by <b>fileagreements</b></span><span>Encrypted document transfer <i>·</i> Tamper-evident audit trail</span></footer>
  `, { title: "Secure signing", subtitle: "Review and sign this client agreement." });
  document.querySelector(".sidebar")?.remove();
  document.querySelector(".topbar")?.remove();
  document.querySelector(".page-content")?.classList.add("signing-content");
  loadSigning(token);
}

async function loadSigning(token) {
  const form = document.querySelector("#sign-form");
  try {
    const details = await api(`/api/sign/${token}`);
    const pdfResponse = await fetch(details.originalUrl);
    if (!pdfResponse.ok) throw new Error("We couldn't load this agreement. Ask the sender to share a new link.");
    const pdfBytes = new Uint8Array(await pdfResponse.arrayBuffer());
    const pdfDocument = await pdfjs.getDocument({ data: pdfBytes.slice() }).promise;
    state.signing = { token, details, pdfBytes, pdfDocument, page: 1, touched: false };
    document.querySelector("#signer-email").value = details.clientEmail;
    document.querySelector(".signing-lede").textContent = `Please read ${details.agreementName}. Your signature will be added to the marked field.`;
    document.querySelector("#sign-page-count").textContent = String(pdfDocument.numPages);
    document.querySelector("#open-original").href = details.originalUrl;
    await renderSigningPage(1);
    setupSignaturePad();
    document.querySelector("#sign-previous").addEventListener("click", () => renderSigningPage(state.signing.page - 1));
    document.querySelector("#sign-next").addEventListener("click", () => renderSigningPage(state.signing.page + 1));
    document.querySelector("#clear-signature").addEventListener("click", clearSignature);
    document.querySelector("#signer-name").addEventListener("input", updateSignButton);
    document.querySelector("#signer-email").addEventListener("input", updateSignButton);
    document.querySelector("#sign-consent").addEventListener("change", updateSignButton);
    form.addEventListener("submit", (event) => completeSigning(event, token));
    document.querySelector("#decline-agreement").addEventListener("click", () => declineAgreement(token));
  } catch (error) {
    form.hidden = true;
    document.querySelector(".signing-panel").innerHTML = `<span class="error-symbol">!</span><h2>This signing link isn't available.</h2><p>${escapeHtml(error.message)}</p><p class="identity-note">If you believe this is a mistake, contact the person who sent the agreement.</p>`;
  }
}

async function renderSigningPage(pageNumber) {
  const current = state.signing;
  if (!current || pageNumber < 1 || pageNumber > current.pdfDocument.numPages) return;
  current.page = pageNumber;
  await renderPdfPage("signing-pdf-canvas", current.pdfDocument, pageNumber);
  const field = current.details.signatureField.page === pageNumber ? current.details.signatureField : null;
  updateMarker(document.querySelector("#sign-field-marker"), field);
  document.querySelector("#sign-page-number").textContent = String(pageNumber);
  document.querySelector("#sign-previous").disabled = pageNumber === 1;
  document.querySelector("#sign-next").disabled = pageNumber === current.pdfDocument.numPages;
}

function setupSignaturePad() {
  const canvas = document.querySelector("#signature-pad");
  const context = canvas.getContext("2d");
  const ratio = window.devicePixelRatio || 1;
  const bounds = canvas.getBoundingClientRect();
  canvas.width = Math.round(bounds.width * ratio);
  canvas.height = Math.round(bounds.height * ratio);
  context.scale(ratio, ratio);
  context.lineWidth = 2.4;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.strokeStyle = "#202d28";
  let drawing = false;
  const point = (event) => {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  canvas.addEventListener("pointerdown", (event) => {
    drawing = true;
    state.signing.touched = true;
    canvas.setPointerCapture(event.pointerId);
    const position = point(event);
    context.beginPath();
    context.moveTo(position.x, position.y);
    document.querySelector("#signature-placeholder").hidden = true;
    updateSignButton();
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!drawing) return;
    const position = point(event);
    context.lineTo(position.x, position.y);
    context.stroke();
  });
  canvas.addEventListener("pointerup", () => { drawing = false; });
  canvas.addEventListener("pointercancel", () => { drawing = false; });
}

function clearSignature() {
  const canvas = document.querySelector("#signature-pad");
  canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
  state.signing.touched = false;
  document.querySelector("#signature-placeholder").hidden = false;
  updateSignButton();
}

function updateSignButton() {
  const name = document.querySelector("#signer-name")?.value.trim();
  const email = document.querySelector("#signer-email")?.value.trim();
  const accepted = document.querySelector("#sign-consent")?.checked;
  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || "");
  const button = document.querySelector("#submit-signature");
  if (button) button.disabled = !(name?.length >= 2 && validEmail && accepted && state.signing?.touched);
}

async function sha256(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function createSignedPdf(current, signerName, signerEmail) {
  const pdf = await PDFDocument.load(current.pdfBytes);
  const page = pdf.getPages()[current.details.signatureField.page - 1];
  if (!page) throw new Error("The signature field points to a page that doesn't exist.");
  const { width, height } = page.getSize();
  const { x, y } = current.details.signatureField;
  const left = Math.min(width * x, width - 18);
  const signatureWidth = Math.min(width * 0.34, width - left - 18);
  const signatureHeight = Math.min(56, signatureWidth * 0.28);
  const signatureBytes = await new Promise((resolve, reject) => {
    document.querySelector("#signature-pad").toBlob(async (blob) => {
      if (!blob) return reject(new Error("Your signature couldn't be captured. Please draw it again."));
      resolve(new Uint8Array(await blob.arrayBuffer()));
    }, "image/png");
  });
  const image = await pdf.embedPng(signatureBytes);
  const top = height * y;
  const imageY = Math.max(12, Math.min(height - signatureHeight - 20, height - top - signatureHeight));
  page.drawImage(image, { x: left, y: imageY, width: signatureWidth, height: signatureHeight });
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const signedAt = new Date();
  const date = signedAt.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
  page.drawText(date, { x: left, y: Math.max(8, imageY - 13), size: 9, font, color: rgb(0.27, 0.31, 0.29) });

  const certificate = pdf.addPage([612, 792]);
  const dark = rgb(0.12, 0.18, 0.15);
  const muted = rgb(0.38, 0.43, 0.40);
  certificate.drawRectangle({ x: 0, y: 0, width: 612, height: 792, color: rgb(0.98, 0.98, 0.96) });
  certificate.drawText("CERTIFICATE OF COMPLETION", { x: 58, y: 706, size: 11, font, color: rgb(0.27, 0.46, 0.34) });
  certificate.drawText("Agreement signed", { x: 58, y: 658, size: 29, font: await pdf.embedFont(StandardFonts.HelveticaBold), color: dark });
  certificate.drawText("This certificate records the electronic signing event for the agreement preceding it.", { x: 58, y: 627, size: 11, font, color: muted });
  const lines = [
    ["DOCUMENT", current.details.agreementName],
    ["SIGNER", signerName],
    ["RECIPIENT EMAIL", signerEmail],
    ["SIGNED AT (UTC)", signedAt.toISOString()],
    ["SIGNING METHOD", "Drawn electronic signature; recipient email matched"],
    ["IDENTITY CHECK", "Email address matched; identity not independently verified"],
    ["ORIGINAL DOCUMENT SHA-256", await sha256(current.pdfBytes)],
    ["SIGNATURE CONSENT", "Signer confirmed intent to sign electronically"],
  ];
  let yPosition = 566;
  for (const [label, value] of lines) {
    certificate.drawText(label, { x: 58, y: yPosition, size: 8, font: await pdf.embedFont(StandardFonts.HelveticaBold), color: muted });
    const clipped = value.length > 78 ? `${value.slice(0, 75)}...` : value;
    certificate.drawText(clipped, { x: 58, y: yPosition - 18, size: 10, font, color: dark });
    yPosition -= 55;
  }
  certificate.drawLine({ start: { x: 58, y: 92 }, end: { x: 554, y: 92 }, thickness: 0.6, color: rgb(0.84, 0.86, 0.83) });
  certificate.drawText("File Agreements · Completion record", { x: 58, y: 72, size: 9, font, color: muted });
  return { bytes: await pdf.save(), signedAt };
}

async function completeSigning(event, token) {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity() || !state.signing?.touched) return;
  const button = document.querySelector("#submit-signature");
  const error = document.querySelector("#sign-error");
  error.hidden = true;
  button.disabled = true;
  button.innerHTML = '<span class="spinner spinner-light"></span> Completing agreement…';
  try {
    const current = state.signing;
    const signerName = document.querySelector("#signer-name").value.trim();
    const signerEmail = document.querySelector("#signer-email").value.trim();
    const { bytes, signedAt } = await createSignedPdf(current, signerName, signerEmail);
    await api(`/api/sign/${token}/complete`, {
      method: "POST",
      body: JSON.stringify({
        pdfBase64: toBase64(bytes),
        signerName,
        signerEmail,
        sourceHash: await sha256(current.pdfBytes),
      }),
    });
    showCompletion(signerName, signedAt);
  } catch (problem) {
    error.hidden = false;
    error.textContent = problem.message;
    button.disabled = false;
    button.innerHTML = `${icons.check} Sign agreement`;
  }
}

async function declineAgreement(token) {
  const reason = window.prompt("If you'd like, share why you're declining this agreement:");
  if (reason === null) return;
  const email = document.querySelector("#signer-email").value.trim();
  try {
    await api(`/api/sign/${token}/decline`, {
      method: "POST",
      body: JSON.stringify({ email, reason }),
    });
    shell(`<div class="completion-card"><span class="completion-icon decline-icon">×</span><div class="eyebrow">AGREEMENT DECLINED</div><h1>We've let the sender know.</h1><p>The agreement wasn't signed. Contact the sender if you'd like to discuss any changes.</p></div>`, { title: "Agreement declined" });
    document.querySelector(".sidebar")?.remove();
    document.querySelector(".topbar")?.remove();
    document.querySelector(".page-content")?.classList.add("completion-content");
  } catch (error) {
    toast(error.message, "error");
  }
}

function showCompletion(name, signedAt) {
  shell(`<div class="completion-card"><span class="completion-icon">${icons.check}</span><div class="eyebrow">AGREEMENT COMPLETE</div><h1>All signed, ${escapeHtml(name.split(" ")[0])}.</h1><p>Your signed agreement and completion certificate are ready. The sender has been notified and their file is now cleared to begin work.</p><div class="completion-details"><span>${icons.check} Signed ${formatDate(signedAt)}</span><span>${icons.shield} Securely recorded</span></div><a href="#files" class="button button-primary completion-button">You're all set ${icons.arrow}</a></div>`, { title: "Agreement complete" });
  document.querySelector(".sidebar")?.remove();
  document.querySelector(".topbar")?.remove();
  document.querySelector(".page-content")?.classList.add("completion-content");
}

function expiredLink() {
  shell(`<div class="completion-card"><span class="error-symbol">!</span><div class="eyebrow">SECURE SIGNING</div><h1>This signing link isn't available.</h1><p>It may have already been signed or declined. Contact the sender if you need a new link.</p></div>`, { title: "Signing link unavailable" });
  document.querySelector(".sidebar")?.remove();
  document.querySelector(".topbar")?.remove();
  document.querySelector(".page-content")?.classList.add("completion-content");
}

async function renderRoute() {
  const hash = window.location.hash;
  const signMatch = hash.match(/^#sign\/([a-f0-9]{64})$/);
  if (signMatch) {
    signView(signMatch[1]);
    return;
  }
  try {
    await loadFiles();
    await loadAgreements();
    if (hash === "#templates") {
      showTemplates();
      return;
    }
    dashboard();
  } catch (error) {
    shell(`<div class="completion-card"><span class="error-symbol">!</span><div class="eyebrow">WORKSPACE UNAVAILABLE</div><h1>We couldn't load your files.</h1><p>${escapeHtml(error.message)}</p><button class="button button-primary" onclick="location.reload()">Try again</button></div>`);
    document.querySelector(".sidebar")?.remove();
    document.querySelector(".topbar")?.remove();
    document.querySelector(".page-content")?.classList.add("completion-content");
  }
}

window.addEventListener("hashchange", renderRoute);
renderRoute();
