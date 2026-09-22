// pdfjs-dist ships this file with no accompanying types -- see openai-provider.ts's top-of-file
// comment for why we import it directly (to make it statically traceable and to pre-populate
// globalThis.pdfjsWorker, avoiding pdfjs's own runtime `import(workerSrc)` lookup).
declare module "pdfjs-dist/legacy/build/pdf.worker.mjs" {
  export const WorkerMessageHandler: unknown;
}
