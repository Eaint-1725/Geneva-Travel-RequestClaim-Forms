/** @type {import('next').NextConfig} */
const nextConfig = {
  // @napi-rs/canvas ships a native .node binary (used by the Travel Cover scan's PDF
  // rasterization, lib/travel/claim/document-scan/openai-provider.ts) -- it must be required at
  // runtime in the Node server, never bundled by webpack (webpack can't parse a native binary).
  // Next 14.2's stable equivalent is `serverExternalPackages` in Next 15+; this is the 14.2 name.
  experimental: {
    serverComponentsExternalPackages: ["@napi-rs/canvas"],
  },
};

module.exports = nextConfig;
