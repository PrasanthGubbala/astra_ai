import { defineConfig } from "vite";
import { readFile } from "node:fs/promises";
import path from "node:path";

const pdfWorkerPath = path.resolve("node_modules/pdfjs-dist/build/pdf.worker.min.mjs");

function pdfWorkerPlugin() {
  return {
    name: "pdfjs-worker",
    configureServer(server) {
      server.middlewares.use("/pdf.worker.min.js", (request, response, next) => {
        if (request.method !== "GET") return next();
        readFile(pdfWorkerPath).then((source) => {
          response.setHeader("Content-Type", "text/javascript; charset=utf-8");
          response.end(source);
        }).catch(next);
      });
    },
    async generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "pdf.worker.min.js",
        source: await readFile(pdfWorkerPath),
      });
    },
  };
}

export default defineConfig({
  plugins: [pdfWorkerPlugin()],
  server: {
    proxy: {
      "/api": "http://localhost:3000",
    },
  },
});
