/**
 * Settings persistente in config/settings.json.
 * Sunt modificabile din interfata admin si supravietuiesc restartului.
 */
const fs = require('fs').promises;
const path = require('path');
const bcrypt = require('bcryptjs');

const SETTINGS_PATH = path.join(__dirname, '..', '..', 'config', 'settings.json');

const DEFAULTS = {
  brideName: 'Emilia',
  groomName: 'Eugen',
  weddingDate: '29.05.2026',
  welcomeMessage: 'Bine ati venit la nunta noastra! Va rugam sa incarcati pozele facute, pentru a le pastra ca amintire.',
  welcomeMessageRo: 'Bine ati venit la nunta noastra! Va rugam sa incarcati pozele facute, pentru a le pastra ca amintire.',
  welcomeMessageEn: 'Welcome to our wedding! Please upload the photos you take so we can keep them as memories.',
  welcomeMessageRu: 'Добро пожаловать на нашу свадьбу! Пожалуйста, загружайте сделанные фотографии, чтобы сохранить их на память.',
  driveFolderId: '1ijzBLSdCCHX34FKl43fddPcdJshwGXaA',
  driveRefreshToken: '',
  driveConnectedAs: '',
  adminPasswordHash: '',
  maxUploadMb: 100,
  allowMessages: true,
};

let cache = null;

async function ensureDir() {
  const dir = path.dirname(SETTINGS_PATH);
  await fs.mkdir(dir, { recursive: true });
}

async function ensureSettingsFile() {
  await ensureDir();
  try {
    await fs.access(SETTINGS_PATH);
  } catch {
    const initial = { ...DEFAULTS };
    const initialPassword = process.env.ADMIN_INITIAL_PASSWORD || 'admin';
    initial.adminPasswordHash = await bcrypt.hash(initialPassword, 10);
    if (process.env.GOOGLE_DRIVE_FOLDER_ID) {
      initial.driveFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
    }
    await fs.writeFile(SETTINGS_PATH, JSON.stringify(initial, null, 2), 'utf-8');
    console.log('[settings] Fisier de configurare creat la', SETTINGS_PATH);
  }
}

async function getSettings() {
  if (cache) return cache;
  const raw = await fs.readFile(SETTINGS_PATH, 'utf-8');
  cache = { ...DEFAULTS, ...JSON.parse(raw) };
  return cache;
}

async function updateSettings(patch) {
  const current = await getSettings();
  const next = { ...current, ...patch };
  await fs.writeFile(SETTINGS_PATH, JSON.stringify(next, null, 2), 'utf-8');
  cache = next;
  return next;
}

async function verifyAdminPassword(plain) {
  const s = await getSettings();
  if (!s.adminPasswordHash) return false;
  return bcrypt.compare(plain, s.adminPasswordHash);
}

async function setAdminPassword(plain) {
  const hash = await bcrypt.hash(plain, 10);
  return updateSettings({ adminPasswordHash: hash });
}

module.exports = {
  ensureSettingsFile,
  getSettings,
  updateSettings,
  verifyAdminPassword,
  setAdminPassword,
  DEFAULTS,
};
