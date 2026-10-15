import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";

// Bundle the main process (including @satchel/node) into one ESM file.
await build({
  entryPoints: ["src/main.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  outfile: "out/main.mjs",
  external: ["electron"],
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: "warning",
});
await build({ entryPoints: ["src/preload.ts"], bundle: true, platform: "node", format: "cjs", outfile: "out/preload.cjs", external: ["electron"], logLevel: "warning" });

// macOS OCR helper (Vision framework). Optional: skipped when swiftc isn't available.
if (process.platform === "darwin") {
  mkdirSync("helpers/bin", { recursive: true });
  try {
    if (!existsSync("helpers/bin/satchel-ocr")) execFileSync("swiftc", ["-O", "helpers/ocr.swift", "-o", "helpers/bin/satchel-ocr"], { stdio: "inherit" });
  } catch {
    console.warn("swiftc not found; OCR helper not built");
  }
}
console.log("built out/main.mjs");
