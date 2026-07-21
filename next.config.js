/** @type {import('next').NextConfig} */
const nextConfig = {
  // Travel Cover scan PDF rasterization (lib/travel/claim/document-scan/openai-provider.ts) --
  // all three must be required at runtime in the Node server, never bundled by webpack:
  // - @napi-rs/canvas ships a native .node binary webpack can't parse.
  // - pdfjs-dist spins up a worker by dynamically importing pdf.worker.mjs from its own package
  //   directory at runtime; webpack relocates it into a vendor chunk, so that import resolves to
  //   a path that doesn't exist ("Setting up fake worker failed: Cannot find module
  //   .next/server/vendor-chunks/pdf.worker.mjs") unless it's left external so Node's normal
  //   node_modules resolution finds the real file instead.
  // - unpdf wraps both of the above, so it needs the same treatment.
  // Next 14.2's stable equivalent is `serverExternalPackages` in Next 15+; this is the 14.2 name.
  experimental: {
    serverComponentsExternalPackages: ["@napi-rs/canvas", "pdfjs-dist", "unpdf"],
  },
};

module.exports = nextConfig;
