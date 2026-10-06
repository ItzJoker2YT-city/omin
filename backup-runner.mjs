// OmniRoute auto backup/restore for Render free plan (no persistent disk).
// - On start: if DATA_DIR has no database, restore the latest backup from a PRIVATE GitHub repo.
// - While running: back up every BACKUP_INTERVAL_MIN minutes (only when data changed).
// - On deploy / restart / sleep (SIGTERM): stop OmniRoute cleanly, back up, then exit.
// Disabled (just starts OmniRoute) when BACKUP_GITHUB_TOKEN or BACKUP_GITHUB_REPO is missing.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const DATA_DIR = process.env.DATA_DIR || "/app/data";
const TOKEN = process.env.BACKUP_GITHUB_TOKEN || "";
const REPO = process.env.BACKUP_GITHUB_REPO || ""; // e.g. user/omin-backup
const BRANCH = process.env.BACKUP_GITHUB_BRANCH || "main";
const FILE = process.env.BACKUP_FILE || "omniroute-backup.bin";
const INTERVAL_MIN = Number(process.env.BACKUP_INTERVAL_MIN || 1);
const SECRET = process.env.BACKUP_PASSPHRASE || process.env.STORAGE_ENCRYPTION_KEY || process.env.API_KEY_SECRET || process.env.JWT_SECRET || "";
const SKIP_DIRS = new Set(["logs", "call_logs", "backups", "tmp", "cache", ".cache"]);
const MAX_FILE = 80 * 1024 * 1024;
const ENABLED = Boolean(TOKEN && REPO && SECRET);
const log = (...a) => console.log("[backup]", ...a);
const MISSING = [!TOKEN && "BACKUP_GITHUB_TOKEN", !REPO && "BACKUP_GITHUB_REPO", !SECRET && "BACKUP_PASSPHRASE (or API_KEY_SECRET)"].filter(Boolean).join(", ");
const key = crypto.createHash("sha256").update(SECRET).digest();
const api = `https://api.github.com/repos/${REPO}/contents/${FILE}`;
const headers = { Authorization: `Bearer ${TOKEN}`, "User-Agent": "omniroute-backup", "X-GitHub-Api-Version": "2022-11-28" };

function walk(dir, base = dir, out = []) {
  for (const e of fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }) : []) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(p, base, out); }
    else if (e.isFile() && fs.statSync(p).size <= MAX_FILE) out.push(path.relative(base, p));
  }
  return out;
}

// Consistent SQLite snapshot via better-sqlite3 when available; else raw copy (db + wal + shm).
async function snapshot(rel) {
  const full = path.join(DATA_DIR, rel);
  if (rel.endsWith(".sqlite") || rel.endsWith(".db")) {
    try {
      const require = createRequire("/app/package.json");
      const Database = require("better-sqlite3");
      const tmp = `/tmp/snap-${crypto.randomUUID()}`;
      const db = new Database(full, { readonly: true, fileMustExist: true });
      await db.backup(tmp); db.close();
      const buf = fs.readFileSync(tmp); fs.rmSync(tmp, { force: true });
      return { buf, clean: true };
    } catch { /* fall through */ }
  }
  return { buf: fs.readFileSync(full), clean: false };
}

async function buildBundle() {
  const files = {}; const cleanDbs = new Set();
  for (const rel of walk(DATA_DIR)) {
    if (/-(wal|shm)$/.test(rel) && cleanDbs.has(rel.replace(/-(wal|shm)$/, ""))) continue;
    const { buf, clean } = await snapshot(rel);
    if (clean) cleanDbs.add(rel);
    files[rel] = buf.toString("base64");
  }
  for (const db of cleanDbs) { delete files[db + "-wal"]; delete files[db + "-shm"]; }
  return Buffer.from(JSON.stringify({ v: 1, at: new Date().toISOString(), files }));
}

function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([c.update(zlib.gzipSync(plain)), c.final()]);
  return Buffer.concat([Buffer.from("ORB1"), iv, c.getAuthTag(), body]);
}
function decrypt(blob) {
  if (blob.subarray(0, 4).toString() !== "ORB1") throw new Error("not an OmniRoute backup");
  const d = crypto.createDecipheriv("aes-256-gcm", key, blob.subarray(4, 16));
  d.setAuthTag(blob.subarray(16, 32));
  return zlib.gunzipSync(Buffer.concat([d.update(blob.subarray(32)), d.final()]));
}

async function remoteSha() {
  const r = await fetch(`${api}?ref=${BRANCH}`, { headers: { ...headers, Accept: "application/vnd.github.object+json" } });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`GitHub ${r.status} ${await r.text()}`);
  return (await r.json()).sha;
}

let lastHash = null, busy = false, holdBackups = false, restoredSha = null;
async function backup(reason) {
  if (!ENABLED) { log(`SKIPPED (${reason}) — backup disabled, missing in Render Environment: ${MISSING}`); return; }
  if (busy || holdBackups) return; busy = true;
  try {
    const plain = await buildBundle();
    const hash = crypto.createHash("sha256").update(JSON.stringify(JSON.parse(plain).files)).digest("hex");
    if (hash === lastHash) { if (reason !== "scheduled") log(`no changes (${reason})`); return; }
    const blob = encrypt(plain); const sha = await remoteSha();
    const r = await fetch(api, { method: "PUT", headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ message: `backup: ${reason}`, content: blob.toString("base64"), branch: BRANCH, ...(sha && { sha }) }) });
    if (!r.ok) throw new Error(`GitHub ${r.status} ${await r.text()}`);
    lastHash = hash; restoredSha = (await r.json()).content?.sha ?? restoredSha;
    log(`saved (${reason}) ${(blob.length / 1024).toFixed(0)} KB`);
  } catch (e) { log("FAILED:", e.message); } finally { busy = false; }
}

async function restore() {
  if (!ENABLED) { log(`DISABLED — missing in Render Environment: ${MISSING}`); return; }
  const hasDb = walk(DATA_DIR).some((f) => /\.(sqlite|db)$/.test(f));
  if (hasDb && process.env.BACKUP_FORCE_RESTORE !== "true") { restoredSha = await remoteSha().catch(() => null); log("local data exists, skipping restore"); return; }
  try {
    const sha = await remoteSha();
    if (!sha) { log("no backup yet — fresh start"); return; }
    // Download by blob SHA (content-addressed, never stale), with retries
    let blob;
    for (let i = 0; i < 5 && !blob; i++) {
      const r = await fetch(`https://api.github.com/repos/${REPO}/git/blobs/${sha}`, { headers: { ...headers, Accept: "application/vnd.github.raw" } });
      if (r.ok) blob = Buffer.from(await r.arrayBuffer()); else await new Promise((z) => setTimeout(z, 2000));
    }
    if (!blob) throw new Error("could not download backup");
    restoredSha = sha;
    const { at, files } = JSON.parse(decrypt(blob));
    for (const rel of Object.keys(files)) for (const ext of ["-wal", "-shm"]) if (!files[rel + ext]) fs.rmSync(path.join(DATA_DIR, rel + ext), { force: true });
    for (const [rel, b64] of Object.entries(files)) {
      const dest = path.join(DATA_DIR, rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, Buffer.from(b64, "base64"));
    }
    lastHash = crypto.createHash("sha256").update(JSON.stringify(files)).digest("hex");
    log(`restored ${Object.keys(files).length} file(s) from backup taken ${at}`);
  } catch (e) { log("RESTORE FAILED:", e.message); }
}

if (process.argv[2] === "--backup-now") { await backup("manual"); process.exit(0); }

fs.mkdirSync(DATA_DIR, { recursive: true });
await restore();

// Render zero-downtime deploys start the NEW instance before the OLD one gets SIGTERM,
// so the old instance's final backup lands a bit AFTER we restored. Watch for it for
// LATE_RESTORE_SEC and, if it appears, reload it (OmniRoute is restarted once).
const LATE_SEC = Number(process.env.BACKUP_LATE_RESTORE_SEC || 240);
let child, stopping = false, restarting = false;
function startChild() {
  child = spawn(process.env.BACKUP_CHILD_CMD || "/app/check-permissions.sh", process.argv.slice(2), { stdio: "inherit", env: process.env });
  child.on("error", (e) => { log("failed to start OmniRoute:", e.message); process.exit(1); });
  child.on("exit", async (code) => {
    if (stopping || restarting) return; stopping = true; clearInterval(timer);
    log(`OmniRoute exited (code ${code}) — backing up before restart`);
    await backup("crash/restart");
    process.exit(code ?? 1);
  });
}
const stopChild = (sig = "SIGTERM") => new Promise((res) => {
  if (!child || child.exitCode !== null) return res();
  child.once("exit", res); child.kill(sig); setTimeout(res, 40_000);
});

startChild();
const timer = ENABLED ? setInterval(() => backup("scheduled"), INTERVAL_MIN * 60_000) : null;

if (ENABLED) {
  holdBackups = true; // never overwrite the old instance's final backup
  const started = Date.now();
  const watch = setInterval(async () => {
    if (stopping) return clearInterval(watch);
    if (Date.now() - started > LATE_SEC * 1000) { clearInterval(watch); holdBackups = false; log("late-restore window closed"); return; }
    const sha = await remoteSha().catch(() => undefined);
    if (sha && sha !== restoredSha) {
      clearInterval(watch);
      log("newer backup from previous instance found — reloading it");
      restarting = true; await stopChild();
      process.env.BACKUP_FORCE_RESTORE = "true"; await restore(); delete process.env.BACKUP_FORCE_RESTORE;
      restarting = false; holdBackups = false; startChild();
    }
  }, 10_000);
}

async function shutdown(sig) {
  if (stopping) return; stopping = true; clearInterval(timer);
  log(`${sig} received — stopping OmniRoute, then backing up`);
  await stopChild(sig);
  holdBackups = false;
  await backup(`shutdown ${sig}`);
  process.exit(0);
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
