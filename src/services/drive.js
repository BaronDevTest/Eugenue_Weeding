/**
 * Google Drive service - upload, list, delete prin Service Account.
 * Pozele sunt stocate intr-un folder Drive partajat cu service account-ul.
 */
const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const { Readable } = require('stream');

const { getSettings } = require('./settings');

const SCOPES = ['https://www.googleapis.com/auth/drive'];

let driveClient = null;
let serviceAccountEmail = null;

function loadCredentials() {
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    try {
      return JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    } catch (err) {
      throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON nu este JSON valid: ' + err.message);
    }
  }

  const file = process.env.GOOGLE_SERVICE_ACCOUNT_FILE || './service-account.json';
  const absolute = path.isAbsolute(file) ? file : path.join(__dirname, '..', '..', file);
  if (!fs.existsSync(absolute)) {
    throw new Error(
      `Nu gasesc fisierul service-account la ${absolute}. ` +
        'Vezi README pentru configurare Google Drive Service Account.'
    );
  }
  return JSON.parse(fs.readFileSync(absolute, 'utf-8'));
}

function getDrive() {
  if (driveClient) return driveClient;
  const credentials = loadCredentials();
  serviceAccountEmail = credentials.client_email;
  const auth = new google.auth.JWT(credentials.client_email, null, credentials.private_key, SCOPES);
  driveClient = google.drive({ version: 'v3', auth });
  return driveClient;
}

function getServiceAccountEmail() {
  if (!serviceAccountEmail) {
    try {
      const credentials = loadCredentials();
      serviceAccountEmail = credentials.client_email;
    } catch {
      return null;
    }
  }
  return serviceAccountEmail;
}

async function resolveFolderId() {
  const settings = await getSettings();
  const folderId = settings.driveFolderId || process.env.GOOGLE_DRIVE_FOLDER_ID;
  if (!folderId) {
    throw new Error('Folder Drive nu este configurat. Seteaza-l in /admin/settings.');
  }
  return folderId;
}

/**
 * Upload un buffer ca fisier nou in folderul Drive.
 * @param {Buffer} buffer continutul fisierului
 * @param {string} originalName numele original (folosit pentru extensie)
 * @param {string} mimeType
 * @param {object} [metadata] metadata aditional (ex: numele invitatului)
 * @returns {Promise<{id: string, name: string, mimeType: string}>}
 */
async function uploadFile(buffer, originalName, mimeType, metadata = {}) {
  const drive = getDrive();
  const folderId = await resolveFolderId();

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safeName = originalName.replace(/[^a-zA-Z0-9._-]/g, '_');
  const guestPart = metadata.guestName ? `_${metadata.guestName.replace(/[^a-zA-Z0-9_-]/g, '_')}` : '';
  const name = `${timestamp}${guestPart}_${safeName}`;

  const properties = {};
  if (metadata.guestName) properties.guestName = metadata.guestName;
  if (metadata.message) properties.message = metadata.message;

  const response = await drive.files.create({
    requestBody: {
      name,
      parents: [folderId],
      properties,
      description: metadata.message || undefined,
    },
    media: {
      mimeType,
      body: Readable.from(buffer),
    },
    fields: 'id, name, mimeType, createdTime, thumbnailLink, webViewLink, webContentLink',
  });

  // Facem fisierul public-readable pentru a putea fi afisat in galerie fara auth
  try {
    await drive.permissions.create({
      fileId: response.data.id,
      requestBody: { role: 'reader', type: 'anyone' },
    });
  } catch (err) {
    console.warn('[drive] Nu am putut seta permisiunea publica:', err.message);
  }

  return response.data;
}

/**
 * Listeaza fisierele din folder, sortate descrescator dupa data crearii.
 */
async function listFiles({ pageSize = 100 } = {}) {
  const drive = getDrive();
  const folderId = await resolveFolderId();
  const response = await drive.files.list({
    q: `'${folderId}' in parents and trashed = false`,
    fields:
      'files(id, name, mimeType, createdTime, thumbnailLink, webViewLink, webContentLink, properties, description, size)',
    orderBy: 'createdTime desc',
    pageSize,
  });
  return response.data.files || [];
}

async function deleteFile(fileId) {
  const drive = getDrive();
  await drive.files.delete({ fileId });
}

async function testConnection() {
  try {
    const folderId = await resolveFolderId();
    const drive = getDrive();
    const folder = await drive.files.get({
      fileId: folderId,
      fields: 'id, name, mimeType, owners',
    });
    return { ok: true, folder: folder.data, serviceAccountEmail: getServiceAccountEmail() };
  } catch (err) {
    return { ok: false, error: err.message, serviceAccountEmail: getServiceAccountEmail() };
  }
}

/**
 * Returneaza un URL imagine afisabil direct (img tag).
 * Drive ofera thumbnailLink dar are dimensiune fixa - folosim un proxy intern
 * sau forma cu lh3.googleusercontent.com cand este disponibila.
 */
function buildImageUrl(file, size = 'w1200') {
  if (file.thumbnailLink) {
    // thumbnailLink are forma "https://lh3.googleusercontent.com/...=s220"
    // inlocuim cu marimea ceruta
    return file.thumbnailLink.replace(/=s\d+(-c)?$/, `=${size}`);
  }
  return `https://drive.google.com/uc?export=view&id=${file.id}`;
}

function isImage(file) {
  return file.mimeType && file.mimeType.startsWith('image/');
}

function isVideo(file) {
  return file.mimeType && file.mimeType.startsWith('video/');
}

module.exports = {
  uploadFile,
  listFiles,
  deleteFile,
  testConnection,
  buildImageUrl,
  isImage,
  isVideo,
  getServiceAccountEmail,
};
