/**
 * Google Drive service - OAuth2 cu refresh token persistent.
 * Utilizatorul se logheaza o singura data din UI-ul admin.
 * Pozele se incarca in Drive-ul personal al utilizatorului autentificat.
 */
const { google } = require('googleapis');
const { Readable } = require('stream');

const { getSettings, updateSettings } = require('./settings');

const SCOPES = ['https://www.googleapis.com/auth/drive'];

let driveClient = null;
let cachedRefreshToken = null;

function getCredentials() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      'GOOGLE_CLIENT_ID si GOOGLE_CLIENT_SECRET nu sunt setate in .env. ' +
        'Vezi README pentru configurare OAuth.'
    );
  }
  return { clientId, clientSecret };
}

function getRedirectUri(req) {
  if (req) {
    const publicUrl = process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
    return publicUrl.replace(/\/$/, '') + '/admin/drive/callback';
  }
  const publicUrl = process.env.PUBLIC_URL || 'http://localhost:3000';
  return publicUrl.replace(/\/$/, '') + '/admin/drive/callback';
}

function buildOAuthClient(redirectUri) {
  const { clientId, clientSecret } = getCredentials();
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

function generateAuthUrl(req) {
  const oauth = buildOAuthClient(getRedirectUri(req));
  return oauth.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
  });
}

async function handleOAuthCallback(code, req) {
  const oauth = buildOAuthClient(getRedirectUri(req));
  const { tokens } = await oauth.getToken(code);
  if (!tokens.refresh_token) {
    throw new Error(
      'Nu am primit refresh token de la Google. Mergi in Google Account Settings → Security → ' +
        'Third party apps si revoca aplicatia, apoi conecteaza-te din nou.'
    );
  }
  await updateSettings({ driveRefreshToken: tokens.refresh_token });
  cachedRefreshToken = tokens.refresh_token;
  driveClient = null;
  return tokens;
}

async function disconnect() {
  const settings = await getSettings();
  const token = settings.driveRefreshToken;
  if (token) {
    try {
      const oauth = buildOAuthClient(getRedirectUri());
      oauth.setCredentials({ refresh_token: token });
      await oauth.revokeCredentials().catch(() => {});
    } catch {
      // ignoram erorile la revoke
    }
  }
  await updateSettings({ driveRefreshToken: '' });
  cachedRefreshToken = null;
  driveClient = null;
}

async function getDrive() {
  if (driveClient) return driveClient;
  const settings = await getSettings();
  const refreshToken = settings.driveRefreshToken;
  if (!refreshToken) {
    throw new Error('Drive nu este conectat. Mergi in /admin si apasa "Conecteaza Drive".');
  }
  cachedRefreshToken = refreshToken;
  const oauth = buildOAuthClient(getRedirectUri());
  oauth.setCredentials({ refresh_token: refreshToken });
  driveClient = google.drive({ version: 'v3', auth: oauth });
  return driveClient;
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
 */
async function uploadFile(buffer, originalName, mimeType, metadata = {}) {
  const drive = await getDrive();
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

  // Facem fisierul public-readable pentru afisare in galerie fara auth
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

async function listFiles({ pageSize = 100 } = {}) {
  const drive = await getDrive();
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
  const drive = await getDrive();
  await drive.files.delete({ fileId });
}

async function testConnection() {
  try {
    const settings = await getSettings();
    if (!settings.driveRefreshToken) {
      return { ok: false, error: 'Drive nu este conectat. Apasa "Conecteaza Drive" in dashboard.' };
    }
    const folderId = await resolveFolderId();
    const drive = await getDrive();
    const [folder, about] = await Promise.all([
      drive.files.get({ fileId: folderId, fields: 'id, name, mimeType' }),
      drive.about.get({ fields: 'user' }),
    ]);
    return {
      ok: true,
      folder: folder.data,
      user: about.data.user,
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function buildImageUrl(file, size = 'w1200') {
  if (file.thumbnailLink) {
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

async function isConnected() {
  const settings = await getSettings();
  return Boolean(settings.driveRefreshToken);
}

module.exports = {
  uploadFile,
  listFiles,
  deleteFile,
  testConnection,
  buildImageUrl,
  isImage,
  isVideo,
  generateAuthUrl,
  handleOAuthCallback,
  disconnect,
  isConnected,
  getRedirectUri,
};
