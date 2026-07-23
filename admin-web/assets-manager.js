const fs = require("fs");
const path = require("path");

const ROOT_DIR = path.join(__dirname, "..");
const ASSET_ROOTS = [
  { key: "sounds", title: "Sounds", dir: path.join(ROOT_DIR, "Sounds"), urlPrefix: "/sounds" },
  { key: "resources", title: "Resources", dir: path.join(ROOT_DIR, "Resources"), urlPrefix: "/resources" },
  { key: "assets", title: "Assets", dir: path.join(ROOT_DIR, "assets"), urlPrefix: "/assets" },
];

function assetType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".mp3") return "audio";
  if ([".mp4", ".webm", ".mov", ".avi"].includes(ext)) return "video";
  if ([".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".svg"].includes(ext)) return "image";
  return "other";
}

function walkFiles(rootDir, currentDir = rootDir, result = []) {
  if (!fs.existsSync(currentDir)) return result;
  for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
    const fullPath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(rootDir, fullPath, result);
    } else if (entry.isFile()) {
      const relativePath = path.relative(rootDir, fullPath).replace(/\\/g, "/");
      const stat = fs.statSync(fullPath);
      result.push({ relativePath, size: stat.size, modifiedAt: stat.mtime.toISOString(), type: assetType(fullPath) });
    }
  }
  return result;
}

function listAssetCatalog() {
  return ASSET_ROOTS.map((root) => ({
    key: root.key,
    title: root.title,
    urlPrefix: root.urlPrefix,
    files: walkFiles(root.dir).map((file) => ({
      ...file,
      url: `${root.urlPrefix}/${file.relativePath}`,
    })),
  }));
}

module.exports = { listAssetCatalog };
