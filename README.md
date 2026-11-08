# File Agreements

File Agreements makes the same essential step happen on every client file: review the agreement, get the right person to sign it, and keep the signed copy with a traceable completion record. The document is supplied per file, so a new or previously unseen agreement does not need a preconfigured template.

## What is included

- **A file for each client.** Record the client, their email, an optional file reference, and the agreement used for that job or case.
- **Review once, reuse on every file.** Upload a previously unseen PDF up to 20 MB, inspect every page, and place the signature field. Save that reviewed agreement to the workspace library and attach it to future client files without another upload. A one-off agreement can also be used without saving it.
- **A one-time signing link.** Create a high-entropy, single-use link and copy it to send to the client. The signing page matches the entered email to the recipient address on file and requires a drawn signature, a full name, and electronic-signature consent. The email match is self-entered, not mailbox verification; the URL is a bearer link.
- **A signed PDF and completion certificate.** The signed agreement is downloadable as a PDF. Its appended certificate records the signer, completion time, signature method, matched email, consent, and SHA-256 hash of the original agreement.
- **A file activity trail and work gate.** Draft, sent, signed, and declined states are tracked. The dashboard identifies whether a file is cleared to begin; it is cleared only after signing. Declines are recorded and can be re-sent by the workspace operator.
- **Persistent storage and a deployable service.** The Node server persists file records and PDFs to disk. `render.yaml` configures a Render web service and persistent disk.

## Why these features

The client needs the agreement to be completed for each file, including an agreement the product has never encountered. Requiring a vendor-authored template would break that central requirement. A sender-placed field keeps first-time setup adaptable; saving the reviewed PDF and field then removes repeated setup for the company's standard agreement. The single-purpose work gate, secure link, signed artifact, and event history directly cover the path from a new file to permission to begin work.

## Deliberately left out

- **Independent identity proofing, qualified signatures, and legal enforceability guarantees.** A bearer link, self-entered email match, drawn mark, consent, timestamp, and document hash provide a basic signing record, but do not establish the signer's legal identity or replace jurisdiction-specific e-signature review. The certificate says so explicitly.
- **Company accounts, authentication, and tenant isolation.** This first-customer build has one shared workspace and is not suitable for storing real client data on a public deployment. Proper authentication, authorization, organization-level isolation, and access-controlled administration must precede commercial or production use.
- **Email delivery, reminders, expiration, and a production email service.** The app creates and copies a secure, single-use signing URL; delivery is left to the operator rather than pretending an email was sent.
- **DOCX, image, and non-PDF conversion; AI contract analysis; template management; negotiation; CRM; billing; and project management.** They do not improve the core test of getting an arbitrary existing PDF signed on every file within the available build window.
- **External signature provider integration.** This build demonstrates a complete first-party signing loop without API credentials or vendor lock-in. A regulated or high-volume rollout should integrate an established provider after requirements and jurisdictions are known.

## Run locally

Requires Node.js 20.12 or newer.

```sh
npm install
npm run build
npm start
```

Open [http://localhost:3000](http://localhost:3000). For frontend development with hot reload, use `npm run dev`; the API proxy expects the Node server at port 3000, so run `npm start` in another terminal.

Copy `.env.example` to `.env` and set local configuration there. `server.mjs` loads `.env` on startup using Node's built-in env-file loader. `PORT` sets the server port; `DATA_DIR` sets where files and agreements are stored. Keep API keys and other secrets in `.env`, never commit `.env`, and read credentials in server code through `process.env`. No external API key is required or currently consumed by this app.

Run the API tests with `npm test`.

## Deploy

[Create a Render deployment](https://render.com/deploy?repo=https://github.com/PrasanthGubbala/astra_ai)

The included `render.yaml` builds and runs the app as a Node web service and mounts a persistent disk at `/var/data`. Create a Render Blueprint from this repository and wait for the service health check to pass. Use the resulting HTTPS URL for the submission. Do not put real personal information or client agreements in this prototype.

## Implementation

Vanilla JavaScript, Vite, PDF.js (document preview), pdf-lib (signed PDF and completion certificate), and a Node.js HTTP server with a small JSON index and local PDF storage. Built with GitHub Copilot SDK in VS Code. No AI or third-party signing API is used at runtime.
