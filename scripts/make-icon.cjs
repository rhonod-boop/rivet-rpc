/**
 * Rasterises build/icon.svg into the PNG/ICO files electron-builder packages.
 * Run with: node_modules/electron/dist/electron.exe scripts/make-icon.cjs
 */
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const BUILD = path.join(__dirname, "..", "build");
const SVG = fs.readFileSync(path.join(BUILD, "icon.svg"), "utf8");
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "rivet-icon-"));

app.disableHardwareAcceleration();

const MASTER = 1024;

function pageFor(size) {
  // The logo's rounded plate provides the transparency; CSS resizes the root svg.
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;padding:0;width:${size}px;height:${size}px;overflow:hidden;background:transparent}
    body{display:block}
    svg{display:block;width:${size}px;height:${size}px}
  </style></head><body>${SVG}</body></html>`;
}

/** One large render; every icon size is a Skia downscale of it. */
async function master() {
  const file = path.join(TMP, "icon.html");
  fs.writeFileSync(file, pageFor(MASTER));

  for (let attempt = 0; attempt < 3; attempt++) {
    const win = new BrowserWindow({
      width: MASTER,
      height: MASTER,
      useContentSize: true,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: "#00000000",
      webPreferences: { offscreen: true, backgroundThrottling: false },
    });

    try {
      await win.loadFile(file);
      // Give the offscreen compositor a couple of frames to paint the vector.
      await win.webContents.executeJavaScript(
        "new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(done, 60))))",
      );
      const image = await win.webContents.capturePage();
      if (image.isEmpty()) throw new Error("empty capture");
      win.destroy();
      return image;
    } catch (error) {
      win.destroy();
      if (attempt === 2) throw error;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
  throw new Error("unreachable");
}

function pngAt(image, size) {
  const png = size === MASTER ? image.toPNG() : image.resize({ width: size, height: size, quality: "best" }).toPNG();
  if (!png || png.length < 100) throw new Error(`icon render failed at ${size}px`);
  return png;
}

function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  let offset = 6 + images.length * 16;
  const entries = images.map(({ size, png }) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += png.length;
    return entry;
  });

  return Buffer.concat([header, ...entries, ...images.map((image) => image.png)]);
}

app.whenReady().then(async () => {
  try {
    const image = await master();
    const images = ICO_SIZES.map((size) => ({ size, png: pngAt(image, size) }));

    fs.writeFileSync(path.join(BUILD, "icon.png"), pngAt(image, 512));
    fs.writeFileSync(path.join(BUILD, "icon.ico"), ico(images));
    console.log(`created icon.png (512) and icon.ico (${ICO_SIZES.join(", ")})`);
    app.exit(0);
  } catch (error) {
    console.error("icon generation failed:", error.message);
    app.exit(1);
  } finally {
    fs.rmSync(TMP, { recursive: true, force: true });
  }
});
