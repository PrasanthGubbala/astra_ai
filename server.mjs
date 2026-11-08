import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.DATA_DIR || path.join(root, "data");
const originalDir = path.join(dataDir, "originals");
const signedDir = path.join(dataDir, "signed");
const agreementDir = path.join(dataDir, "agreements");
const storePath = path.join(dataDir, "files.json");
const agreementStorePath = path.join(dataDir, "agreements.json");
const maxPdfBytes = 20 * 1024 * 1024;
const maxBodyBytes = Math.ceil(maxPdfBytes * 1.5) + 256 * 1024;
const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

await mkdir(originalDir, { recursive: true });
await mkdir(signedDir, { recursive: true });
await mkdir(agreementDir, { recursive: true });

async function loadFiles() {
  try {
    return JSON.parse(await readFile(storePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function saveFiles(files) {
  const temporaryPath = `${storePath}.tmp`;
  await writeFile(temporaryPath, JSON.stringify(files, null, 2), { mode: 0o600 });
  await rename(temporaryPath, storePath);
}

async function loadAgreements() {
  try {
    return JSON.parse(await readFile(agreementStorePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function saveAgreements(agreements) {
  const temporaryPath = `${agreementStorePath}.tmp`;
  await writeFile(temporaryPath, JSON.stringify(agreements, null, 2), { mode: 0o600 });
  await rename(temporaryPath, agreementStorePath);
}

let writeQueue = Promise.resolve();
function updateFiles(update) {
  const operation = writeQueue.then(async () => {
    const files = await loadFiles();
    const result = await update(files);
    await saveFiles(files);
    return result;
  });
  writeQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

let agreementWriteQueue = Promise.resolve();
function updateAgreements(update) {
  const operation = agreementWriteQueue.then(async () => {
    const agreements = await loadAgreements();
    const result = await update(agreements);
    await saveAgreements(agreements);
    return result;
  });
  agreementWriteQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

function respond(response, status, value) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}

function fail(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function readJson(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBodyBytes) throw fail(413, "Request is too large. PDFs must be 20 MB or smaller.");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw fail(400, "The request body must be valid JSON.");
  }
}

function validatePdf(encoded) {
  if (typeof encoded !== "string" || encoded.length > Math.ceil(maxPdfBytes * 1.5)) {
    throw fail(400, "Upload a PDF that is 20 MB or smaller.");
  }
  const bytes = Buffer.from(encoded, "base64");
  if (!bytes.subarray(0, 5).equals(Buffer.from("%PDF-")) || bytes.length > maxPdfBytes) {
    throw fail(400, "The uploaded file is not a valid PDF under 20 MB.");
  }
  return bytes;
}

function safeFile(file) {
  const { id, clientName, clientEmail, reference, agreementName, status, createdAt, sentAt, signedAt, events, signatureUrl } = file;
  return { id, clientName, clientEmail, reference, agreementName, status, createdAt, sentAt, signedAt, events, signatureUrl };
}

function findByToken(files, token) {
  return files.find((file) => file.signingToken === token);
}

async function serveFile(request, response, pathname) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const target = path.resolve(root, "dist", `.${requested}`);
  const distDir = path.resolve(root, "dist");
  if (!target.startsWith(`${distDir}${path.sep}`)) throw fail(404, "Not found.");
  try {
    const info = await stat(target);
    if (!info.isFile()) throw fail(404, "Not found.");
    const contents = await readFile(target);
    response.writeHead(200, {
      "content-type": mimeTypes[path.extname(target)] || "application/octet-stream",
      "content-length": contents.length,
      "cache-control": target.endsWith("index.html") || target.endsWith("pdf.worker.min.js") ? "no-cache" : "public, max-age=31536000, immutable",
    });
    response.end(contents);
  } catch (error) {
    if (error.status) throw error;
    throw fail(404, "Not found.");
  }
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    const pathname = decodeURIComponent(url.pathname);
    const method = request.method || "GET";

    if (method === "GET" && pathname === "/api/health") {
      respond(response, 200, { ok: true });
      return;
    }

    if (method === "GET" && pathname === "/api/files") {
      respond(response, 200, (await loadFiles()).map(safeFile));
      return;
    }

    if (method === "GET" && pathname === "/api/agreements") {
      const [agreements, files] = await Promise.all([loadAgreements(), loadFiles()]);
      respond(response, 200, agreements.map((agreement) => ({
        ...agreement,
        filesUsed: files.filter((file) => file.templateId === agreement.id).length,
      })));
      return;
    }

    const agreementDocumentMatch = pathname.match(/^\/api\/agreements\/([a-f0-9-]+)\/document$/);
    if (method === "GET" && agreementDocumentMatch) {
      const agreement = (await loadAgreements()).find((item) => item.id === agreementDocumentMatch[1]);
      if (!agreement) throw fail(404, "Agreement template not found.");
      const bytes = await readFile(path.join(agreementDir, `${agreement.id}.pdf`)).catch(() => { throw fail(404, "Agreement document not found."); });
      response.writeHead(200, {
        "content-type": "application/pdf",
        "content-length": bytes.length,
        "content-disposition": `inline; filename="${encodeURIComponent(agreement.name)}"`,
        "cache-control": "private, no-store",
      });
      response.end(bytes);
      return;
    }

    if (method === "POST" && pathname === "/api/files") {
      const body = await readJson(request);
      const clientName = String(body.clientName || "").trim();
      const clientEmail = String(body.clientEmail || "").trim().toLowerCase();
      const reference = String(body.reference || "").trim();
      const templateId = String(body.templateId || "");
      let agreementName;
      let field;
      let pdf;
      let pageCount;
      if (clientName.length < 2 || clientName.length > 120) throw fail(400, "Enter a client name between 2 and 120 characters.");
      if (clientEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clientEmail)) throw fail(400, "Enter a valid client email address.");
      if (reference.length > 100) throw fail(400, "The file reference must be 100 characters or fewer.");
      let selectedTemplate = null;
      if (templateId) {
        selectedTemplate = (await loadAgreements()).find((item) => item.id === templateId);
        if (!selectedTemplate) throw fail(404, "The selected saved agreement was not found. Refresh and try again.");
        agreementName = selectedTemplate.name;
        field = selectedTemplate.signatureField;
        pageCount = selectedTemplate.pageCount;
        pdf = await readFile(path.join(agreementDir, `${selectedTemplate.id}.pdf`)).catch(() => { throw fail(404, "The selected agreement document could not be found."); });
      } else {
        agreementName = String(body.agreementName || "").trim();
        field = body.signatureField;
        pageCount = Number(body.pageCount);
        if (agreementName.length < 1 || agreementName.length > 180) throw fail(400, "Choose a PDF agreement under 180 characters.");
        if (!Number.isInteger(pageCount) || pageCount < 1 || pageCount > 1000) throw fail(400, "The PDF page count could not be read.");
        if (!field || !Number.isInteger(field.page) || field.page < 1 || field.page > pageCount || ![field.x, field.y].every((v) => Number.isFinite(v) && v >= 0) || field.x > 0.64 || field.y > 0.91) {
          throw fail(400, "Place a signature field on a page of the agreement before continuing.");
        }
        pdf = validatePdf(body.pdfBase64);
      }
      const id = randomUUID();
      await writeFile(path.join(originalDir, `${id}.pdf`), pdf, { mode: 0o600 });
      let savedTemplate = selectedTemplate;
      if (!selectedTemplate && body.saveAsAgreement === true) {
        savedTemplate = {
          id: randomUUID(),
          name: agreementName,
          pageCount,
          signatureField: field,
          createdAt: new Date().toISOString(),
        };
        await writeFile(path.join(agreementDir, `${savedTemplate.id}.pdf`), pdf, { mode: 0o600 });
        await updateAgreements((agreements) => agreements.unshift(savedTemplate));
      }
      const file = {
        id,
        clientName,
        clientEmail,
        reference,
        agreementName,
        templateId: savedTemplate?.id,
        status: "draft",
        createdAt: new Date().toISOString(),
        signatureField: field,
        events: [{
          type: "file_created",
          at: new Date().toISOString(),
          detail: selectedTemplate ? "Saved agreement attached to this file." : "Agreement uploaded and signing field placed.",
        }],
      };
      await updateFiles((files) => files.unshift(file));
      respond(response, 201, safeFile(file));
      return;
    }

    const sendMatch = pathname.match(/^\/api\/files\/([a-f0-9-]+)\/send$/);
    if (method === "POST" && sendMatch) {
      const token = randomBytes(32).toString("hex");
      const file = await updateFiles((files) => {
        const found = files.find((item) => item.id === sendMatch[1]);
        if (!found) throw fail(404, "File not found.");
        if (found.status !== "draft" && found.status !== "declined") throw fail(409, "This agreement has already been sent or completed.");
        found.signingToken = token;
        found.status = "sent";
        found.sentAt = new Date().toISOString();
        found.signatureUrl = `${url.origin}/#sign/${token}`;
        found.events.push({ type: "agreement_sent", at: found.sentAt, detail: "Secure signing link created." });
        return safeFile(found);
      });
      respond(response, 200, file);
      return;
    }

    const documentMatch = pathname.match(/^\/api\/files\/([a-f0-9-]+)\/(original|signed)$/);
    if (method === "GET" && documentMatch) {
      const file = (await loadFiles()).find((item) => item.id === documentMatch[1]);
      if (!file) throw fail(404, "File not found.");
      const isSigned = documentMatch[2] === "signed";
      if (isSigned && file.status !== "signed") throw fail(404, "No signed agreement is available yet.");
      const location = path.join(isSigned ? signedDir : originalDir, `${file.id}.pdf`);
      const bytes = await readFile(location).catch(() => { throw fail(404, "Agreement document not found."); });
      response.writeHead(200, {
        "content-type": "application/pdf",
        "content-length": bytes.length,
        "content-disposition": `${isSigned ? "attachment" : "inline"}; filename="${encodeURIComponent(file.agreementName.replace(/\.pdf$/i, ""))}${isSigned ? "-signed" : ""}.pdf"`,
        "cache-control": "private, no-store",
      });
      response.end(bytes);
      return;
    }

    const signMatch = pathname.match(/^\/api\/sign\/([a-f0-9]{64})$/);
    if (method === "GET" && signMatch) {
      const file = findByToken(await loadFiles(), signMatch[1]);
      if (!file || file.status !== "sent") throw fail(404, "This signing link is invalid, expired, or already completed.");
      respond(response, 200, {
        clientName: file.clientName,
        clientEmail: file.clientEmail,
        agreementName: file.agreementName,
        signatureField: file.signatureField,
        originalUrl: `/api/files/${file.id}/original`,
      });
      return;
    }

    const completeMatch = pathname.match(/^\/api\/sign\/([a-f0-9]{64})\/complete$/);
    if (method === "POST" && completeMatch) {
      const body = await readJson(request);
      const signedPdf = validatePdf(body.pdfBase64);
      const signerName = String(body.signerName || "").trim();
      const signerEmail = String(body.signerEmail || "").trim().toLowerCase();
      if (signerName.length < 2 || signerName.length > 120) throw fail(400, "Enter your full name to sign.");
      if (signerEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(signerEmail)) throw fail(400, "Enter a valid email address.");
      const file = await updateFiles(async (files) => {
        const found = findByToken(files, completeMatch[1]);
        if (!found || found.status !== "sent") throw fail(404, "This signing link is invalid, expired, or already completed.");
        if (signerEmail !== found.clientEmail) throw fail(403, "Use the email address this agreement was sent to.");
        const original = await readFile(path.join(originalDir, `${found.id}.pdf`));
        const originalHash = createHash("sha256").update(original).digest("hex");
        if (body.sourceHash !== originalHash) throw fail(409, "The original agreement changed. Reload the signing link and review it again.");
        await writeFile(path.join(signedDir, `${found.id}.pdf`), signedPdf, { mode: 0o600 });
        found.status = "signed";
        found.signedAt = new Date().toISOString();
        found.signerName = signerName;
        found.signingToken = undefined;
        found.events.push({
          type: "agreement_signed",
          at: found.signedAt,
          detail: `Signed by ${signerName} (${signerEmail}); original SHA-256 ${originalHash}.`,
          userAgent: String(request.headers["user-agent"] || "").slice(0, 300),
        });
        return safeFile(found);
      });
      respond(response, 200, file);
      return;
    }

    const declineMatch = pathname.match(/^\/api\/sign\/([a-f0-9]{64})\/decline$/);
    if (method === "POST" && declineMatch) {
      const body = await readJson(request);
      const reason = String(body.reason || "").trim().slice(0, 500);
      const email = String(body.email || "").trim().toLowerCase();
      const file = await updateFiles((files) => {
        const found = findByToken(files, declineMatch[1]);
        if (!found || found.status !== "sent") throw fail(404, "This signing link is invalid, expired, or already completed.");
        if (email !== found.clientEmail) throw fail(403, "Use the email address this agreement was sent to.");
        found.status = "declined";
        found.events.push({ type: "agreement_declined", at: new Date().toISOString(), detail: reason || "Signer declined the agreement." });
        found.signingToken = undefined;
        found.signatureUrl = undefined;
        return safeFile(found);
      });
      respond(response, 200, file);
      return;
    }

    if (method === "GET") {
      await serveFile(request, response, pathname);
      return;
    }
    throw fail(404, "Not found.");
  } catch (error) {
    if (response.headersSent) {
      response.destroy(error);
      return;
    }
    respond(response, error.status || 500, { error: error.status ? error.message : "Something went wrong. Please try again." });
    if (!error.status) console.error(error);
  }
});

const port = Number(process.env.PORT ?? 3000);
server.listen(port, "0.0.0.0", () => {
  console.log(`File Agreements listening on port ${port}`);
});

export { server };
