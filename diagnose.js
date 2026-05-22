/**
 * Script de diagnostic pentru cPanel - foloseste doar Node built-ins.
 * Ruleaza prin butonul "Run JS script" din Setup Node.js App.
 * Rezultatul se scrie in diagnose-output.txt din folderul proiectului.
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const LOG = path.join(__dirname, 'diagnose-output.txt');
const out = [];

function log(label, value) {
  out.push('=== ' + label + ' ===');
  out.push(typeof value === 'string' ? value : JSON.stringify(value, null, 2));
  out.push('');
}

function tryRun(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], cwd: __dirname, timeout: 120000 });
  } catch (e) {
    return 'EROARE: ' + (e.message || String(e)) + '\nSTDERR: ' + (e.stderr || '') + '\nSTDOUT: ' + (e.stdout || '');
  }
}

// 1. Info de baza
log('TIMESTAMP', new Date().toISOString());
log('NODE VERSION', process.version);
log('PLATFORM', process.platform + ' ' + process.arch);
log('CWD', __dirname);
log('NODE_ENV', process.env.NODE_ENV || '(unset)');
log('PATH (first 500 chars)', (process.env.PATH || '').slice(0, 500));

// 2. Verifica unde e npm
log('which node', tryRun('which node'));
log('which npm', tryRun('which npm'));
log('npm --version', tryRun('npm --version'));

// 3. Fisierele din proiect
try {
  const files = fs.readdirSync(__dirname).map((f) => {
    try {
      const s = fs.statSync(path.join(__dirname, f));
      return (s.isDirectory() ? 'd' : '-') + ' ' + f + ' (' + s.size + ' bytes)';
    } catch (e) { return f + ' (err: ' + e.message + ')'; }
  });
  log('FILES IN PROJECT', files.join('\n'));
} catch (e) { log('FILES IN PROJECT - ERROR', e.message); }

// 4. node_modules - exista? cat de mare?
const nm = path.join(__dirname, 'node_modules');
if (fs.existsSync(nm)) {
  try {
    const entries = fs.readdirSync(nm);
    log('NODE_MODULES count', String(entries.length) + ' entries');
    log('NODE_MODULES first 20', entries.slice(0, 20).join('\n'));
    log('NODE_MODULES du -sh', tryRun('du -sh node_modules'));
  } catch (e) { log('NODE_MODULES ERROR', e.message); }
} else {
  log('NODE_MODULES', 'NU EXISTA');
}

// 5. package.json
try {
  log('PACKAGE.JSON', fs.readFileSync(path.join(__dirname, 'package.json'), 'utf-8'));
} catch (e) { log('PACKAGE.JSON ERROR', e.message); }

// 6. Verifica disk quota
log('disk free (df -h .)', tryRun('df -h .'));
log('quota -s', tryRun('quota -s 2>&1 || echo "quota command not available"'));

// 7. Ruleaza npm install si capteaza output-ul
log('STARTING NPM INSTALL...', '');
log('npm install output (last 3000 chars)', tryRun('npm install 2>&1').slice(-3000));

// 8. Dupa npm install, verifica iar node_modules
if (fs.existsSync(nm)) {
  try {
    const entries = fs.readdirSync(nm);
    log('NODE_MODULES (after install) count', String(entries.length));
    log('NODE_MODULES (after install) first 20', entries.slice(0, 20).join('\n'));
    log('NODE_MODULES (after install) du -sh', tryRun('du -sh node_modules'));
  } catch (e) { log('NODE_MODULES (after install) ERROR', e.message); }
} else {
  log('NODE_MODULES (after install)', 'INCA NU EXISTA');
}

// 9. Incearca sa porneasca app.js si vezi ce eroare apare
log('TESTING APP STARTUP', tryRun('timeout 5 node -e "require(\'./app.js\')" 2>&1 || echo "(exit)"'));

// Scrie tot in fisier
fs.writeFileSync(LOG, out.join('\n'));
console.log('Diagnostic complet. Output salvat in:', LOG);
console.log('Vezi continutul lui in File Manager.');
