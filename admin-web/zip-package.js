const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { query } = require("./db");
const { importLct3Workbook, importStandardWorkbook } = require("./excel");

const ROOT_DIR = path.join(__dirname, "..");
const ALLOWED_ASSET_EXTENSIONS = new Set([
  ".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp",
  ".mp3", ".mp4", ".webm", ".mov", ".avi",
]);

function readUInt16(buffer, offset) {
  return buffer.readUInt16LE(offset);
}

function readUInt32(buffer, offset) {
  return buffer.readUInt32LE(offset);
}

function findEndOfCentralDirectory(buffer) {
  const minOffset = Math.max(0, buffer.length - 22 - 0xffff);
  for (let offset = buffer.length - 22; offset >= minOffset; offset -= 1) {
    if (readUInt32(buffer, offset) === 0x06054b50) return offset;
  }
  throw new Error("Khong doc duoc file ZIP: thieu end of central directory.");
}

function parseZipEntries(zipPath) {
  const buffer = fs.readFileSync(zipPath);
  const eocd = findEndOfCentralDirectory(buffer);
  const totalEntries = readUInt16(buffer, eocd + 10);
  let offset = readUInt32(buffer, eocd + 16);
  const entries = [];

  for (let index = 0; index < totalEntries; index += 1) {
    if (readUInt32(buffer, offset) !== 0x02014b50) break;
    const flags = readUInt16(buffer, offset + 8);
    const method = readUInt16(buffer, offset + 10);
    const compressedSize = readUInt32(buffer, offset + 20);
    const uncompressedSize = readUInt32(buffer, offset + 24);
    const fileNameLength = readUInt16(buffer, offset + 28);
    const extraLength = readUInt16(buffer, offset + 30);
    const commentLength = readUInt16(buffer, offset + 32);
    const localHeaderOffset = readUInt32(buffer, offset + 42);
    const rawName = buffer.toString("utf8", offset + 46, offset + 46 + fileNameLength);
    entries.push({
      rawName,
      flags,
      method,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
    });
    offset += 46 + fileNameLength + extraLength + commentLength;
  }

  return { buffer, entries };
}

function normalizeZipPath(rawName) {
  const normalized = String(rawName || "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized || normalized.endsWith("/") || normalized.startsWith("__MACOSX/")) return "";
  const parts = normalized.split("/").filter(Boolean);
  if (!parts.length || parts.some((part) => part === "." || part === ".." || /^[a-z]:$/i.test(part))) return "";
  return parts.join("/");
}

function extractEntry(zipBuffer, entry) {
  if (entry.flags & 0x01) throw new Error(`Khong ho tro ZIP co mat khau: ${entry.rawName}`);
  const offset = entry.localHeaderOffset;
  if (readUInt32(zipBuffer, offset) !== 0x04034b50) throw new Error(`Local header loi: ${entry.rawName}`);
  const nameLength = readUInt16(zipBuffer, offset + 26);
  const extraLength = readUInt16(zipBuffer, offset + 28);
  const dataOffset = offset + 30 + nameLength + extraLength;
  const compressed = zipBuffer.subarray(dataOffset, dataOffset + entry.compressedSize);
  if (entry.method === 0) return Buffer.from(compressed);
  if (entry.method === 8) return zlib.inflateRawSync(compressed, { finishFlush: zlib.constants.Z_SYNC_FLUSH });
  throw new Error(`Khong ho tro compression method ${entry.method}: ${entry.rawName}`);
}

function safePackageName(originalName) {
  const base = path.basename(String(originalName || "package"), path.extname(String(originalName || "")));
  return (base.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 60) || `package-${Date.now()}`).toLowerCase();
}

function assetTarget(zipName, packageName) {
  const parts = zipName.split("/");
  const first = parts[0].toLowerCase();
  if (first === "sounds") return { root: path.join(ROOT_DIR, "Sounds"), relativeParts: parts.slice(1), urlPrefix: "/sounds" };
  if (first === "resources") return { root: path.join(ROOT_DIR, "Resources"), relativeParts: parts.slice(1), urlPrefix: "/resources" };
  if (first === "assets") return { root: path.join(ROOT_DIR, "assets"), relativeParts: parts.slice(1), urlPrefix: "/assets" };

  const ext = path.extname(zipName).toLowerCase();
  if (ALLOWED_ASSET_EXTENSIONS.has(ext)) {
    return { root: path.join(ROOT_DIR, "Resources", "imported", packageName), relativeParts: parts, urlPrefix: `/resources/imported/${packageName}` };
  }
  return null;
}

function mediaTypeFor(fileName) {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === ".mp3") return "audio";
  if ([".mp4", ".webm", ".mov", ".avi"].includes(ext)) return "video";
  if (ALLOWED_ASSET_EXTENSIONS.has(ext)) return "image";
  return null;
}

async function registerMediaAsset(questionSetId, asset) {
  const mediaType = mediaTypeFor(asset.relativeUrl);
  if (!mediaType) return;
  await query(
    "INSERT INTO media_assets (question_set_id, title, media_type, local_path, duration_seconds) VALUES (?, ?, ?, ?, ?)",
    [questionSetId || null, asset.title, mediaType, asset.relativeUrl, 0],
  );
}

async function importQuestionPackage(zipPath, { originalName = "", format = "q2t_standard", questionSetId = 1, uploadsDir = path.join(__dirname, "uploads") } = {}) {
  const packageName = safePackageName(originalName);
  const { buffer, entries } = parseZipEntries(zipPath);
  const normalizedEntries = entries
    .map((entry) => ({ ...entry, zipName: normalizeZipPath(entry.rawName) }))
    .filter((entry) => entry.zipName);

  const workbookEntry = normalizedEntries.find((entry) => /\.xlsx$/i.test(entry.zipName) && !path.basename(entry.zipName).startsWith("~$"));
  if (!workbookEntry) throw new Error("Goi ZIP phai co it nhat 1 file .xlsx.");

  fs.mkdirSync(uploadsDir, { recursive: true });
  const workbookPath = path.join(uploadsDir, `${Date.now()}-${path.basename(workbookEntry.zipName).replace(/[^a-z0-9_.-]/gi, "-")}`);
  fs.writeFileSync(workbookPath, extractEntry(buffer, workbookEntry));

  const imported = format === "lct3"
    ? await importLct3Workbook(workbookPath, questionSetId)
    : await importStandardWorkbook(workbookPath, questionSetId);

  const assets = [];
  for (const entry of normalizedEntries) {
    if (entry === workbookEntry) continue;
    const target = assetTarget(entry.zipName, packageName);
    if (!target || !target.relativeParts.length) continue;
    const safeRelative = normalizeZipPath(target.relativeParts.join("/"));
    if (!safeRelative) continue;
    const outputPath = path.join(target.root, safeRelative);
    const resolved = path.resolve(outputPath);
    const allowedRoot = path.resolve(target.root);
    if (!resolved.startsWith(allowedRoot + path.sep) && resolved !== allowedRoot) continue;
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, extractEntry(buffer, entry));
    const relativeUrl = `${target.urlPrefix}/${safeRelative.replace(/\\/g, "/")}`;
    const asset = { zipName: entry.zipName, relativeUrl, title: path.basename(safeRelative) };
    assets.push(asset);
    await registerMediaAsset(questionSetId, asset);
  }

  return { imported, assets, workbookPath };
}

module.exports = { importQuestionPackage };
