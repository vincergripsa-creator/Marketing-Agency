/**
 * `npm run agency`: keeps the agency running. Builds web/dist if it is missing, then runs the server and starts it again
 * whenever it stops, waiting 2 s to 60 s. Exit code 0 means it was asked to stop, and this script stops with it. Exit code 78
 * means the port is taken, most likely by another agency: this script stops too, since trying again would change nothing.
 * Output goes to runs/agency.log as well as the terminal. No dependency.
 *
 *   node scripts/forever.mjs [--entry <file>] [--log <file>]
 */
import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SERVER = join(ROOT, 'server');
const FIRST_WAIT_MS = 2_000;
const MAX_WAIT_MS = 60_000;
/** A server that lived this long had no boot problem: the next wait starts over. */
const HEALTHY_MS = 120_000;
/** A stop that takes longer than the server's own 5 s limit is stuck. */
const STOP_LIMIT_MS = 8_000;
const LOG_MAX_BYTES = 5_000_000;
/** PORT_BUSY_EXIT of server/src/api/server.ts. */
const PORT_BUSY = 78;

function option(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? resolve(process.argv[i + 1]) : fallback;
}

const entry = option('entry', join(SERVER, 'src', 'api', 'server.ts'));
const logFile = option('log', join(ROOT, 'runs', 'agency.log'));

mkdirSync(dirname(logFile), { recursive: true });
if (existsSync(logFile) && statSync(logFile).size > LOG_MAX_BYTES) renameSync(logFile, `${logFile}.1`);
const log = createWriteStream(logFile, { flags: 'a' });

function say(text) {
  const line = `[agence ${new Date().toISOString()}] ${text}\n`;
  process.stdout.write(line);
  log.write(line);
}

function buildWeb() {
  if (existsSync(join(ROOT, 'web', 'dist', 'index.html'))) return;
  say("Interface absente : construction de web/dist…");
  const res = spawnSync('npm run build', { cwd: ROOT, stdio: 'inherit', shell: true });
  if (res.status !== 0) say("La construction de l'interface a échoué : le serveur tourne sans elle. Il faut d'abord un npm ci complet, sans --omit=optional, puis npm run build.");
}

let child = null;
let stopping = false;
let wait = FIRST_WAIT_MS;

function finish(code) {
  log.end(() => process.exit(code));
}

function run() {
  if (stopping) return;
  const startedAt = Date.now();
  child = spawn(process.execPath, ['--import', 'tsx', entry], { cwd: SERVER, stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
  child.stdout.on('data', (chunk) => { process.stdout.write(chunk); log.write(chunk); });
  child.stderr.on('data', (chunk) => { process.stderr.write(chunk); log.write(chunk); });
  child.on('error', (err) => say(`Lancement impossible : ${err.message}`));
  child.on('close', (code, signal) => {
    child = null;
    if (stopping || code === 0) {
      say('Agence arrêtée.');
      finish(0);
      return;
    }
    if (code === PORT_BUSY) {
      say("Le port est déjà pris, sans doute par une autre agence : celle-ci s'arrête sans toucher au run.");
      finish(1);
      return;
    }
    if (Date.now() - startedAt >= HEALTHY_MS) wait = FIRST_WAIT_MS;
    say(`Le serveur s'est arrêté (${signal ?? `code ${code}`}) : nouveau départ dans ${Math.round(wait / 1000)} s.`);
    setTimeout(run, wait);
    wait = Math.min(MAX_WAIT_MS, wait * 2);
  });
}

/** The server saves and leaves with code 0. A second signal would make it leave without saving, so it only hears what the terminal did not tell it. */
function stop(forward) {
  if (stopping) return;
  stopping = true;
  if (!child) { finish(0); return; }
  if (forward) child.kill('SIGTERM');
  setTimeout(() => child?.kill('SIGKILL'), STOP_LIMIT_MS).unref();
}

process.on('SIGINT', () => stop(false)); // Ctrl+C reaches the whole console
process.on('SIGTERM', () => stop(true));

buildWeb();
run();
