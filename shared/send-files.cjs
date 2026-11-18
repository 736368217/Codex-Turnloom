"use strict";

/**
 * Bounded, disk-backed *ordinary file* attachments for POST /api/send.
 *
 * Images travel separately in `images[]` and are still handled by the existing
 * image pipeline. Files in `files[]` are never inlined as base64 model text and
 * are never treated as images: they are copied byte-for-byte into an App-owned
 * scratch directory and the model receives only sanitized human filenames plus
 * real, absolute, host-readable path references (`@"C:\\...\\file.pdf"`, matching
 * PI-Desktop's `formatFileInsert` / "Files mentioned" convention).
 *
 * Hard limits: 4 files, 4 MiB per file, 6 MiB total. Client-supplied paths are
 * ignored; only a sanitized basename and a safe extension are ever used. The
 * caller supplies the App-owned absolute `dataRoot` (for PI hosts: PI_DATA_ROOT).
 * Error messages never echo file data, names, paths or tokens, so logs stay safe.
 *
 * Integration contract (frozen):
 *   normalized = normalizeSendFiles(body.files)
 *   fingerprint = sendFilesFingerprint(body.files)  // raw or normalized is OK
 *   staged = await stageSendFiles(normalized, { dataRoot, sessionKey })
 *   prompt = messageWithSendFiles(body.message, staged)
 *   public files = sendFilesPublicMetadata(staged)
 * `stageSendFiles()` returns entries with a `staged: true` marker. Preserve that
 * marker if staged metadata is persisted (e.g. in a queue); prompt/public helpers
 * reject unmarked or malformed metadata rather than trusting a supplied path.
 */

const { createHash, randomBytes } = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

const MAX_SEND_FILES = 4;
const MAX_SEND_FILE_BYTES = 4 * 1024 * 1024;
const MAX_SEND_FILES_TOTAL_BYTES = 6 * 1024 * 1024;
const MAX_SEND_FILE_NAME_CHARS = 120;
const MAX_SEND_FILE_MIME_CHARS = 120;

const SAFE_SESSION_KEY = /^[A-Za-z0-9_-]+(?:[.][A-Za-z0-9_-]+)*$/;
const SAFE_MIME_TYPE = /^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/;
const STRICT_BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const DATA_URL_PREFIX = /^data:[^,]*;base64,/i;
const SAFE_EXTENSION = /^\.[A-Za-z0-9]{1,12}$/;
const IMAGE_MIME_TYPE = /^image\//i;
const IMAGE_FILE_EXTENSION = /\.(png|jpe?g|webp|gif|bmp|heic|svg)$/i;
const STAGED_FILE_PREFIX = "turnloom-file-";
const STAGED_FILE_NAME = /^turnloom-file-[0-9a-f]{16}(?:\.[A-Za-z0-9]{1,12})?$/i;
const UNSAFE_ROOT_CHARS = /["\u0000]/;
const UNSAFE_STAGED_PATH_CHARS = /["\r\n\u0000]/;

function sendFileError(message, code = "INVALID_SEND_FILE", status = 400) {
  const error = new Error(message);
  error.name = "SendFileError";
  error.code = code;
  error.status = status;
  return error;
}

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/** A path supplied by the client is never used; only its basename is kept. */
function sanitizeSendFileName(value, index = 0) {
  let name = String(value ?? "").replace(/\\/g, "/");
  name = name.split("/").pop() || "";
  name = name.replace(/[\u0000-\u001f\u007f]/g, "");
  name = name.replace(/[^\p{L}\p{N}._+-]/gu, "_");
  name = name.replace(/^[._-]+/, "").replace(/[.\s]+$/g, "");
  name = name.slice(0, MAX_SEND_FILE_NAME_CHARS);
  return name || `file-${index + 1}`;
}

function normalizeMimeType(value) {
  const mimeType = value === undefined || value === null || value === ""
    ? "application/octet-stream"
    : String(value).trim().toLowerCase();
  if (mimeType.length > MAX_SEND_FILE_MIME_CHARS || !SAFE_MIME_TYPE.test(mimeType)) {
    throw sendFileError("Invalid file MIME type.");
  }
  // An ordinary file must never enter the image pipeline, even if the client
  // labels a PDF/zip/binary payload with an image MIME type.
  return IMAGE_MIME_TYPE.test(mimeType) ? "application/octet-stream" : mimeType;
}

/** Strict canonical base64; Buffer.from() alone is too permissive. */
function decodeStrictBase64(value) {
  if (typeof value !== "string") throw sendFileError("Invalid file data.");
  const data = value.trim().replace(DATA_URL_PREFIX, "");
  // A trailing newline in a bare base64 payload must not be silently accepted:
  // trim only the data-URL wrapper, then validate the payload itself.
  const wrapperTrimmed = data === value.trim();
  if ((wrapperTrimmed && data !== value) || !data || data.length % 4 !== 0 || !STRICT_BASE64.test(data)) {
    throw sendFileError("Invalid file data: expected base64.");
  }
  const bytes = Buffer.from(data, "base64");
  if (!bytes.byteLength || bytes.toString("base64") !== data) {
    throw sendFileError("Invalid file data: expected base64.");
  }
  return { data, bytes };
}

/**
 * Pure validation/decoding. No filesystem access, so callers may safely run it
 * before an idempotency gate. Returns canonical `{name,mimeType,data,size,sha256}`.
 * Any client-supplied `path` field is deliberately dropped.
 */
function normalizeSendFiles(files) {
  if (files === undefined || files === null) return [];
  if (!Array.isArray(files)) throw sendFileError("files must be an array.");
  if (files.length > MAX_SEND_FILES) {
    throw sendFileError(`Too many files. Maximum is ${MAX_SEND_FILES}.`, "TOO_MANY_SEND_FILES");
  }
  let total = 0;
  return files.map((file, index) => {
    if (!file || typeof file !== "object" || Array.isArray(file)) {
      throw sendFileError("Invalid file attachment.");
    }
    const { data, bytes } = decodeStrictBase64(file.data);
    if (bytes.byteLength > MAX_SEND_FILE_BYTES) {
      throw sendFileError("File is too large. Maximum is 4 MB per file.", "SEND_FILE_TOO_LARGE");
    }
    total += bytes.byteLength;
    if (total > MAX_SEND_FILES_TOTAL_BYTES) {
      throw sendFileError("Attached files are too large. Maximum is 6 MB total.", "SEND_FILES_TOO_LARGE");
    }
    return {
      name: sanitizeSendFileName(file.name, index),
      mimeType: normalizeMimeType(file.mimeType),
      data,
      size: bytes.byteLength,
      sha256: digest(bytes)
    };
  });
}

/**
 * Idempotency identity. Canonicalizes raw and normalized inputs to the same
 * value: sanitized name, normalized MIME type, and SHA-256 of decoded bytes.
 * It never returns or embeds file data, names or paths.
 */
function sendFilesFingerprint(files) {
  if (!Array.isArray(files)) return "";
  const hash = createHash("sha256");
  for (const [index, file] of files.entries()) {
    if (!file || typeof file !== "object" || Array.isArray(file)) {
      hash.update("<invalid>\0");
      continue;
    }
    let name;
    try {
      name = sanitizeSendFileName(file.name, index);
    } catch {
      name = "<invalid>";
    }
    let mimeType;
    try {
      mimeType = normalizeMimeType(file.mimeType);
    } catch {
      mimeType = `<invalid:${String(file.mimeType ?? "")}>`;
    }
    let dataIdentity = "<non-string>";
    if (typeof file.data === "string") {
      const trimmed = file.data.trim();
      const raw = trimmed.replace(DATA_URL_PREFIX, "");
      // A data URL may have surrounding whitespace; a bare base64 payload may
      // not be trimmed, otherwise two different requests share an identity.
      const isDataUrl = raw !== trimmed;
      const canonical = (isDataUrl || raw === file.data) &&
        raw && raw.length % 4 === 0 && STRICT_BASE64.test(raw);
      if (canonical) {
        const bytes = Buffer.from(raw, "base64");
        dataIdentity = bytes.toString("base64") === raw
          ? digest(bytes)
          : `<invalid:${digest(Buffer.from(raw))}>`;
      } else {
        dataIdentity = `<invalid:${digest(Buffer.from(raw))}>`;
      }
    }
    hash.update(name).update("\0").update(mimeType).update("\0").update(dataIdentity).update("\0");
  }
  return hash.digest("hex");
}

/** Validate normalized payloads and prepare bytes/metadata before any write. */
function prepareStagedFiles(files) {
  if (!Array.isArray(files)) throw sendFileError("Invalid file attachment.");
  if (files.length > MAX_SEND_FILES) {
    throw sendFileError(`Too many files. Maximum is ${MAX_SEND_FILES}.`, "TOO_MANY_SEND_FILES");
  }
  let total = 0;
  return files.map((file, index) => {
    if (!file || typeof file !== "object" || Array.isArray(file) || typeof file.data !== "string" ||
        !STRICT_BASE64.test(file.data)) {
      throw sendFileError("Invalid file attachment.");
    }
    const bytes = Buffer.from(file.data, "base64");
    const sha256 = digest(bytes);
    if (!bytes.byteLength || bytes.toString("base64") !== file.data ||
        !Number.isSafeInteger(file.size) || file.size !== bytes.byteLength ||
        !/^[0-9a-f]{64}$/.test(String(file.sha256 || "")) || String(file.sha256) !== sha256) {
      throw sendFileError("Invalid file attachment.");
    }
    const name = sanitizeSendFileName(file.name, index);
    const mimeType = normalizeMimeType(file.mimeType);
    if (bytes.byteLength > MAX_SEND_FILE_BYTES) {
      throw sendFileError("File is too large. Maximum is 4 MB per file.", "SEND_FILE_TOO_LARGE");
    }
    total += bytes.byteLength;
    if (total > MAX_SEND_FILES_TOTAL_BYTES) {
      throw sendFileError("Attached files are too large. Maximum is 6 MB total.", "SEND_FILES_TOO_LARGE");
    }
    return { name, mimeType, data: file.data, bytes, size: bytes.byteLength, sha256 };
  });
}

/** Validate the already-normalized (but not yet staged) shape. */
function assertNormalizedSendFiles(files) {
  prepareStagedFiles(files);
  return files;
}

/** Re-validate staged metadata before it is used to compose a model prompt. */
function validateStagedSendFiles(files) {
  if (files === undefined || files === null) return [];
  if (!Array.isArray(files) || files.length > MAX_SEND_FILES) {
    throw sendFileError("Invalid staged file attachment.");
  }
  return files.map((file, index) => {
    if (!file || typeof file !== "object" || Array.isArray(file) || file.staged !== true) {
      throw sendFileError("Invalid staged file attachment.");
    }
    const stagedPath = String(file.path || "");
    // Quotes/newlines would allow prompt injection through the @path marker.
    // Only stageSendFiles()-shaped paths under its own scratch layout are valid.
    if (!path.isAbsolute(stagedPath) || UNSAFE_STAGED_PATH_CHARS.test(stagedPath) ||
        !STAGED_FILE_NAME.test(path.basename(stagedPath))) {
      throw sendFileError("Invalid staged file path.", "SEND_FILE_STAGING_FAILED", 500);
    }
    const size = Number(file.size);
    const sha256 = String(file.sha256 || "");
    if (!Number.isSafeInteger(size) || size < 0 || size > MAX_SEND_FILE_BYTES ||
        !/^[0-9a-f]{64}$/.test(sha256)) {
      throw sendFileError("Invalid staged file metadata.", "SEND_FILE_STAGING_FAILED", 500);
    }
    return {
      name: sanitizeSendFileName(file.name, index),
      mimeType: normalizeMimeType(file.mimeType),
      size,
      sha256,
      path: stagedPath,
      staged: true
    };
  });
}

/** PI-Desktop's `formatFileInsert(path)` convention, including quoted paths. */
function formatSendFileReference(filePath) {
  return /\s/.test(filePath) ? `@"${filePath}"` : `@${filePath}`;
}

function sendFilesPromptBlock(files) {
  const staged = validateStagedSendFiles(files);
  if (!staged.length) return "";
  const lines = [
    "[Files mentioned: use the host-readable staged copies below.]",
    "The following ordinary file attachments were staged on the host. Their bytes are not embedded in this message and they are not images. Use the exact absolute paths with your file-reading tools."
  ];
  for (const [index, file] of staged.entries()) {
    lines.push(`${index + 1}. ${file.name} (${file.mimeType}, ${file.size} bytes, sha256 ${file.sha256})`);
    lines.push(`   ${formatSendFileReference(file.path)}`);
  }
  return lines.join("\n");
}

function messageWithSendFiles(text, files) {
  const block = sendFilesPromptBlock(files);
  if (!block) return String(text || "");
  const base = String(text || "").trimEnd();
  return base ? `${base}\n\n${block}` : block;
}

/** Client-facing metadata: deliberately excludes the host's absolute path. */
function sendFilesPublicMetadata(files) {
  return validateStagedSendFiles(files).map(({ name, mimeType, size, sha256 }) => ({
    name, mimeType, size, sha256
  }));
}

function assertInside(parent, child) {
  const relative = path.relative(parent, child);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw sendFileError("Invalid file staging directory.", "SEND_FILE_STAGING_FAILED", 500);
  }
}

function safeSessionKey(value, fallback) {
  const candidate = String(value || "").trim();
  if (candidate.length <= 128 && SAFE_SESSION_KEY.test(candidate) && !candidate.includes("..")) {
    return candidate;
  }
  return fallback;
}

/** Ordinary files must never be staged with an image extension or image MIME. */
function safeExtension(name, mimeType = "") {
  const candidate = path.extname(String(name || ""));
  const extension = SAFE_EXTENSION.test(candidate) ? candidate : "";
  if (IMAGE_MIME_TYPE.test(String(mimeType || "")) || IMAGE_FILE_EXTENSION.test(String(name || ""))) return ".bin";
  return extension;
}

/**
 * Copy bytes into `<dataRoot>/scratch/<safe session or request key>/`.
 *
 * `sessionKey` is normally the existing thread id (matching PI-Desktop's
 * `<dataRoot>/scratch/<sessionId>` root). For new conversations no session id
 * exists yet, so a random per-request key is used; the absolute path in the
 * prompt is still a real host-readable file. All client-supplied paths are
 * ignored, and every returned path is an absolute realpath inside the root.
 */
async function stageSendFiles(files, { dataRoot, sessionKey = "" } = {}) {
  const prepared = prepareStagedFiles(files);
  if (!prepared.length) return [];
  const root = String(dataRoot || "").trim();
  if (!root || !path.isAbsolute(root) || UNSAFE_ROOT_CHARS.test(root)) {
    throw sendFileError("Invalid file staging root.", "SEND_FILE_STAGING_FAILED", 500);
  }
  const resolvedRoot = path.resolve(root);
  const scratchRoot = path.resolve(resolvedRoot, "scratch");
  const key = safeSessionKey(sessionKey, `turnloom-request-${randomBytes(8).toString("hex")}`);
  const directory = path.resolve(scratchRoot, key);
  assertInside(scratchRoot, directory);

  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const realRoot = await fs.realpath(resolvedRoot);
  const realScratchRoot = await fs.realpath(scratchRoot);
  // Resolve junctions/symlinks so a replaced session scratch directory cannot
  // redirect writes outside the App-owned root (or into another session root).
  assertInside(realRoot, realScratchRoot);
  const realDirectory = await fs.realpath(directory);
  assertInside(realRoot, realDirectory);
  assertInside(realScratchRoot, realDirectory);
  if (path.basename(realDirectory) !== key) {
    throw sendFileError("Invalid file staging directory.", "SEND_FILE_STAGING_FAILED", 500);
  }
  const writtenPaths = [];
  const staged = [];
  try {
    for (const file of prepared) {
      let target = "";
      let written = false;
      for (let attempt = 0; attempt < 4 && !written; attempt += 1) {
        const candidate = path.join(
          directory,
          `${STAGED_FILE_PREFIX}${randomBytes(8).toString("hex")}${safeExtension(file.name, file.mimeType)}`
        );
        assertInside(directory, candidate);
        try {
          await fs.writeFile(candidate, file.bytes, { flag: "wx", mode: 0o600 });
          writtenPaths.push(candidate);
          target = candidate;
          written = true;
        } catch (error) {
          if (error?.code !== "EEXIST") throw error;
        }
      }
      if (!written) throw sendFileError("Could not stage the attached files.", "SEND_FILE_STAGING_FAILED", 500);
      const realTarget = await fs.realpath(target);
      assertInside(realDirectory, realTarget);
      if (!path.isAbsolute(realTarget) || UNSAFE_STAGED_PATH_CHARS.test(realTarget) ||
          !STAGED_FILE_NAME.test(path.basename(realTarget))) {
        throw sendFileError("Invalid staged file path.", "SEND_FILE_STAGING_FAILED", 500);
      }
      staged.push({
        name: file.name,
        mimeType: file.mimeType,
        size: file.size,
        sha256: file.sha256,
        path: realTarget,
        staged: true
      });
    }
    return staged;
  } catch (error) {
    // Roll back every byte written by this call, including a file whose final
    // realpath failed validation and therefore never entered `staged`.
    for (const writtenPath of writtenPaths) {
      try {
        await fs.rm(writtenPath, { force: true });
      } catch { /* best-effort rollback */ }
    }
    if (error?.name === "SendFileError") throw error;
    throw sendFileError("Could not stage the attached files.", "SEND_FILE_STAGING_FAILED", 500);
  }
}

module.exports = {
  MAX_SEND_FILES,
  MAX_SEND_FILE_BYTES,
  MAX_SEND_FILES_TOTAL_BYTES,
  normalizeSendFiles,
  assertNormalizedSendFiles,
  sendFilesFingerprint,
  validateStagedSendFiles,
  formatSendFileReference,
  sendFilesPromptBlock,
  messageWithSendFiles,
  sendFilesPublicMetadata,
  sanitizeSendFileName,
  stageSendFiles
};
