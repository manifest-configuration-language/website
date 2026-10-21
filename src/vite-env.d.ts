/// <reference types="astro/client" />

declare module "*.wasm.gz?url" {
  const url: string;
  export default url;
}

declare module "*runtime/wasm_exec.js";
