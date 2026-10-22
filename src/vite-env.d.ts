/// <reference types="astro/client" />

declare module "*.wasm?url" {
  const url: string;
  export default url;
}

declare module "*runtime/wasm_exec.js";
