import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { once } from "node:events";
import os from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";

let server;
let baseUrl;
let dataDir;

before(async () => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), "file-agreements-test-"));
  process.env.DATA_DIR = dataDir;
  process.env.PORT = "0";
  ({ server } = await import("../server.mjs"));
  await once(server, "listening");
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server?.listening) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  if (dataDir) await rm(dataDir, { recursive: true, force: true });
});

async function post(url, body) {
  return fetch(`${baseUrl}${url}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("a new PDF agreement can be sent, signed once, and downloaded", async () => {
  const original = Buffer.from("%PDF-1.4\nsample agreement\n%%EOF");
  const create = await post("/api/files", {
    clientName: "Jordan Lee",
    clientEmail: "Jordan@example.com",
    reference: "TEST-001",
    agreementName: "unseen-agreement.pdf",
    pdfBase64: original.toString("base64"),
    signatureField: { page: 1, x: 0.62, y: 0.82 },
    pageCount: 1,
    saveAsAgreement: true,
  });
  assert.equal(create.status, 201);
  const file = await create.json();
  assert.equal(file.status, "draft");
  assert.equal(file.clientEmail, "jordan@example.com");

  const send = await post(`/api/files/${file.id}/send`, {});
  assert.equal(send.status, 200);
  const sent = await send.json();
  assert.equal(sent.status, "sent");
  const token = new URL(sent.signatureUrl).hash.slice("#sign/".length);
  assert.match(token, /^[a-f0-9]{64}$/);

  const detailsResponse = await fetch(`${baseUrl}/api/sign/${token}`);
  assert.equal(detailsResponse.status, 200);
  const details = await detailsResponse.json();
  assert.equal(details.clientEmail, "jordan@example.com");
  assert.deepEqual(details.signatureField, { page: 1, x: 0.62, y: 0.82 });
  assert.equal((await fetch(`${baseUrl}${details.originalUrl}`)).status, 200);

  const signedBytes = Buffer.from("%PDF-1.4\nsigned sample agreement\n%%EOF");
  const wrongEmail = await post(`/api/sign/${token}/complete`, {
    pdfBase64: signedBytes.toString("base64"),
    signerName: "Jordan Lee",
    signerEmail: "someone-else@example.com",
    sourceHash: createHash("sha256").update(original).digest("hex"),
  });
  assert.equal(wrongEmail.status, 403);

  const complete = await post(`/api/sign/${token}/complete`, {
    pdfBase64: signedBytes.toString("base64"),
    signerName: "Jordan Lee",
    signerEmail: "jordan@example.com",
    sourceHash: createHash("sha256").update(original).digest("hex"),
  });
  assert.equal(complete.status, 200);
  const signed = await complete.json();
  assert.equal(signed.status, "signed");
  assert.ok(signed.signedAt);
  assert.ok(signed.events.some((event) => event.type === "agreement_signed"));

  const download = await fetch(`${baseUrl}/api/files/${file.id}/signed`);
  assert.equal(download.status, 200);
  assert.equal(download.headers.get("content-type"), "application/pdf");
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), signedBytes);
  assert.equal((await fetch(`${baseUrl}/api/sign/${token}`)).status, 404);
  assert.equal((await fetch(`${baseUrl}/api/files`)).status, 200);

  const libraryResponse = await fetch(`${baseUrl}/api/agreements`);
  assert.equal(libraryResponse.status, 200);
  const [agreement] = await libraryResponse.json();
  assert.equal(agreement.name, "unseen-agreement.pdf");
  assert.equal(agreement.filesUsed, 1);
  const reused = await post("/api/files", {
    clientName: "Morgan Example",
    clientEmail: "morgan@example.com",
    templateId: agreement.id,
  });
  assert.equal(reused.status, 201);
  const reusedFile = await reused.json();
  assert.equal(reusedFile.agreementName, agreement.name);
  assert.deepEqual(reusedFile.events[0].detail, "Saved agreement attached to this file.");
  assert.deepEqual(Buffer.from(await (await fetch(`${baseUrl}/api/files/${reusedFile.id}/original`)).arrayBuffer()), original);
  assert.equal((await (await fetch(`${baseUrl}/api/agreements`)).json())[0].filesUsed, 2);
});

test("a signer can decline and the sender can issue a fresh link", async () => {
  const create = await post("/api/files", {
    clientName: "Taylor Morgan",
    clientEmail: "taylor@example.com",
    agreementName: "another-agreement.pdf",
    pdfBase64: Buffer.from("%PDF-1.4\nanother agreement").toString("base64"),
    signatureField: { page: 2, x: 0.6, y: 0.8 },
    pageCount: 2,
  });
  assert.equal(create.status, 201);
  const file = await create.json();
  const firstSend = await post(`/api/files/${file.id}/send`, {});
  const firstToken = new URL((await firstSend.json()).signatureUrl).hash.slice("#sign/".length);

  const decline = await post(`/api/sign/${firstToken}/decline`, {
    email: "taylor@example.com",
    reason: "Please correct the service start date.",
  });
  assert.equal(decline.status, 200);
  const declined = await decline.json();
  assert.equal(declined.status, "declined");
  assert.ok(declined.events.some((event) => event.detail === "Please correct the service start date."));

  const secondSend = await post(`/api/files/${file.id}/send`, {});
  assert.equal(secondSend.status, 200);
  assert.notEqual(new URL((await secondSend.json()).signatureUrl).hash, `#sign/${firstToken}`);
});

test("invalid agreement files and signature coordinates are rejected", async () => {
  const response = await post("/api/files", {
    clientName: "Casey Example",
    clientEmail: "casey@example.com",
    agreementName: "not-a-pdf.pdf",
    pdfBase64: Buffer.from("plain text").toString("base64"),
    signatureField: { page: 1, x: 2, y: 0.5 },
    pageCount: 1,
  });
  assert.equal(response.status, 400);
});
