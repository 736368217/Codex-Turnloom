#!/usr/bin/env node
import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(projectDir, "android", "app", "build", "outputs", "apk", "debug", "app-debug.apk");
const target = path.join(projectDir, "public", "downloads", "Codex-Turnloom.apk");
const compatibilityTarget = path.join(projectDir, "public", "downloads", "CodexPocket.apk");

await mkdir(path.dirname(target), { recursive: true });
await copyFile(source, target);
await copyFile(source, compatibilityTarget);
console.log("Staged APK at " + target);
