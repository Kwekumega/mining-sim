// Copies the built web game into the desktop app. Run `npm run build` in ../web first.
const fs = require("fs");
const path = require("path");

const src = path.join(__dirname, "..", "web", "dist", "index.html");
const dest = path.join(__dirname, "app", "index.html");
if (!fs.existsSync(src)) {
  console.error(`Missing ${src}. Build the web game first: cd web && npm ci && npm run build`);
  process.exit(1);
}
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.copyFileSync(src, dest);
fs.copyFileSync(path.join(__dirname, "build", "icon.png"), path.join(__dirname, "app", "icon.png"));
console.log(`Copied the game to ${path.relative(process.cwd(), dest)}`);
