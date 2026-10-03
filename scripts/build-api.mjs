import { build } from 'esbuild';
// Bundle server TS into one Node ESM file. The Vercel entry is plain JavaScript,
// so its runtime never depends on extensionless TypeScript module resolution.
await build({entryPoints:['server/vercel.ts'],outfile:'.server/api.mjs',bundle:true,
  platform:'node',target:'node24',format:'esm',sourcemap:false,
  banner:{js:'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);'}});
console.log('API Node.js bundle ready');
