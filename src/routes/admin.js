/**
 * Rute admin: login, dashboard, QR, moderare, settings.
 */
const express = require('express');
const QRCode = require('qrcode');

const drive = require('../services/drive');
const {
  getSettings,
  updateSettings,
  verifyAdminPassword,
  setAdminPassword,
} = require('../services/settings');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

// ---- Login ----
router.get('/login', (req, res) => {
  if (req.session && req.session.isAdmin) return res.redirect('/admin');
  res.render('admin/login', { title: 'Admin login', error: null, next: req.query.next || '/admin' });
});

router.post('/login', async (req, res, next) => {
  try {
    const { password, next: nextUrl } = req.body;
    const ok = await verifyAdminPassword(password || '');
    if (!ok) {
      return res.status(401).render('admin/login', {
        title: 'Admin login',
        error: 'Parola incorecta.',
        next: nextUrl || '/admin',
      });
    }
    req.session.isAdmin = true;
    const safeNext = typeof nextUrl === 'string' && nextUrl.startsWith('/') ? nextUrl : '/admin';
    res.redirect(safeNext);
  } catch (err) {
    next(err);
  }
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/admin/login'));
});

// ---- Toate rutele urmatoare cer admin ----
router.use(requireAdmin);

// Dashboard
router.get('/', async (req, res, next) => {
  try {
    const [settings, files, drivetest] = await Promise.all([
      getSettings(),
      drive.listFiles({ pageSize: 1000 }).catch(() => []),
      drive.testConnection().catch((err) => ({ ok: false, error: err.message })),
    ]);
    const imageCount = files.filter(drive.isImage).length;
    const videoCount = files.filter(drive.isVideo).length;
    res.render('admin/dashboard', {
      title: 'Admin',
      stats: { total: files.length, images: imageCount, videos: videoCount },
      drivetest,
      settings,
    });
  } catch (err) {
    next(err);
  }
});

// QR generator - codeaza URL-ul stabil pentru pagina principala
// IMPORTANT: codul codeaza PUBLIC_URL/ (radacina). Acest URL trebuie sa fie
// definitiv inainte de a printa QR-ul pe invitatii.
function getPublicHomeUrl(req) {
  const publicUrl = process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
  return publicUrl.replace(/\/$/, '') + '/';
}

router.get('/qr', async (req, res, next) => {
  try {
    const url = getPublicHomeUrl(req);
    const dataUrl = await QRCode.toDataURL(url, {
      errorCorrectionLevel: 'H',
      margin: 3,
      width: 800,
      color: { dark: '#1a1a1a', light: '#ffffff' },
    });
    const isProduction = (process.env.PUBLIC_URL || '').match(/^https:\/\//i)
      && !url.includes('localhost')
      && !url.match(/127\.0\.0\.1|192\.168\.|10\./);
    res.render('admin/qr', { title: 'QR Code', dataUrl, url, isProduction });
  } catch (err) {
    next(err);
  }
});

// QR download as high-res PNG (1500px) - perfect pentru tipar
router.get('/qr/download', async (req, res, next) => {
  try {
    const url = getPublicHomeUrl(req);
    const buffer = await QRCode.toBuffer(url, {
      errorCorrectionLevel: 'H',
      margin: 3,
      width: 1500,
    });
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', 'attachment; filename="QR-nunta-Emilia-Eugen.png"');
    res.send(buffer);
  } catch (err) {
    next(err);
  }
});

// QR download as SVG (vectorial - calitate infinita la tipar)
router.get('/qr/download.svg', async (req, res, next) => {
  try {
    const url = getPublicHomeUrl(req);
    const svg = await QRCode.toString(url, {
      type: 'svg',
      errorCorrectionLevel: 'H',
      margin: 3,
    });
    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Content-Disposition', 'attachment; filename="QR-nunta-Emilia-Eugen.svg"');
    res.send(svg);
  } catch (err) {
    next(err);
  }
});

// ---- OAuth Drive ----
router.get('/drive/connect', async (req, res, next) => {
  try {
    const url = drive.generateAuthUrl(req);
    res.redirect(url);
  } catch (err) {
    next(err);
  }
});

router.get('/drive/callback', async (req, res, next) => {
  try {
    const { code, error } = req.query;
    if (error) {
      return res.status(400).render('admin/drive-result', {
        title: 'Conectare Drive',
        ok: false,
        message: `Google a returnat eroarea: ${error}`,
      });
    }
    if (!code) {
      return res.status(400).render('admin/drive-result', {
        title: 'Conectare Drive',
        ok: false,
        message: 'Codul de autorizare lipseste.',
      });
    }
    await drive.handleOAuthCallback(code, req);
    // Salveaza email-ul user-ului conectat pentru afisare
    try {
      const test = await drive.testConnection();
      if (test.ok && test.user && test.user.emailAddress) {
        await updateSettings({ driveConnectedAs: test.user.emailAddress });
      }
    } catch {
      // ignore
    }
    res.render('admin/drive-result', {
      title: 'Conectare Drive',
      ok: true,
      message: 'Drive conectat cu succes.',
    });
  } catch (err) {
    console.error('[oauth callback]', err);
    res.status(500).render('admin/drive-result', {
      title: 'Conectare Drive',
      ok: false,
      message: 'Eroare la finalizarea conectarii: ' + err.message,
    });
  }
});

router.post('/drive/disconnect', async (req, res, next) => {
  try {
    await drive.disconnect();
    await updateSettings({ driveConnectedAs: '' });
    res.redirect('/admin');
  } catch (err) {
    next(err);
  }
});

// Moderare poze
router.get('/photos', async (req, res, next) => {
  try {
    const files = await drive.listFiles({ pageSize: 1000 });
    const items = files.map((f) => ({
      id: f.id,
      name: f.name,
      mimeType: f.mimeType,
      createdTime: f.createdTime,
      imageUrl: drive.buildImageUrl(f, 'w400'),
      isImage: drive.isImage(f),
      isVideo: drive.isVideo(f),
      guestName: (f.properties && f.properties.guestName) || '',
      message: (f.properties && f.properties.message) || f.description || '',
      size: f.size,
    }));
    res.render('admin/photos', { title: 'Moderare poze', items });
  } catch (err) {
    next(err);
  }
});

router.post('/photos/:id/delete', async (req, res, next) => {
  const isXhr = req.xhr || req.get('X-Requested-With') === 'XMLHttpRequest';
  try {
    await drive.deleteFile(req.params.id);
    if (isXhr) return res.json({ ok: true, id: req.params.id });
    res.redirect('/admin/photos');
  } catch (err) {
    if (isXhr) return res.status(500).json({ ok: false, error: err.message, id: req.params.id });
    next(err);
  }
});

// Bulk delete - primeste { ids: ['id1','id2',...] } via JSON sau form-data
router.post('/photos/delete-bulk', async (req, res, next) => {
  const isXhr = req.xhr || req.get('X-Requested-With') === 'XMLHttpRequest';
  try {
    let ids = req.body.ids;
    if (typeof ids === 'string') ids = ids.split(',').filter(Boolean);
    if (!Array.isArray(ids) || ids.length === 0) {
      if (isXhr) return res.status(400).json({ ok: false, error: 'Nu ai selectat nicio poza.' });
      return res.redirect('/admin/photos');
    }
    const results = [];
    for (const id of ids) {
      try {
        await drive.deleteFile(id);
        results.push({ id, ok: true });
      } catch (err) {
        console.error('[bulk-delete] Eroare la', id, err.message);
        results.push({ id, ok: false, error: err.message });
      }
    }
    const succeeded = results.filter((r) => r.ok).length;
    if (isXhr) return res.json({ ok: true, deleted: succeeded, total: ids.length, results });
    res.redirect('/admin/photos');
  } catch (err) {
    if (isXhr) return res.status(500).json({ ok: false, error: err.message });
    next(err);
  }
});

// Settings
router.get('/settings', async (req, res, next) => {
  try {
    const settings = await getSettings();
    res.render('admin/settings', {
      title: 'Setari',
      settings,
      message: req.query.saved ? 'Setarile au fost salvate.' : null,
      error: null,
      driveConnected: await drive.isConnected(),
    });
  } catch (err) {
    next(err);
  }
});

router.post('/settings', async (req, res, next) => {
  try {
    const {
      brideName,
      groomName,
      weddingDate,
      welcomeMessageRo,
      welcomeMessageEn,
      welcomeMessageRu,
      driveFolderId,
      maxUploadMb,
      allowMessages,
      newPassword,
      confirmPassword,
    } = req.body;

    const patch = {
      brideName: (brideName || '').trim().slice(0, 60),
      groomName: (groomName || '').trim().slice(0, 60),
      weddingDate: (weddingDate || '').trim().slice(0, 20),
      welcomeMessageRo: (welcomeMessageRo || '').trim().slice(0, 500),
      welcomeMessageEn: (welcomeMessageEn || '').trim().slice(0, 500),
      welcomeMessageRu: (welcomeMessageRu || '').trim().slice(0, 500),
      welcomeMessage: (welcomeMessageRo || '').trim().slice(0, 500), // legacy compat
      driveFolderId: (driveFolderId || '').trim(),
      maxUploadMb: Math.max(1, Math.min(500, parseInt(maxUploadMb, 10) || 25)),
      allowMessages: allowMessages === 'on' || allowMessages === 'true' || allowMessages === true,
    };

    if (newPassword) {
      if (newPassword.length < 6) {
        const settings = await getSettings();
        return res.status(400).render('admin/settings', {
          title: 'Setari',
          settings: { ...settings, ...patch },
          message: null,
          error: 'Parola noua trebuie sa aiba minim 6 caractere.',
          driveConnected: await drive.isConnected(),
        });
      }
      if (newPassword !== confirmPassword) {
        const settings = await getSettings();
        return res.status(400).render('admin/settings', {
          title: 'Setari',
          settings: { ...settings, ...patch },
          message: null,
          error: 'Parolele nu coincid.',
          driveConnected: await drive.isConnected(),
        });
      }
      await setAdminPassword(newPassword);
    }

    await updateSettings(patch);
    res.redirect('/admin/settings?saved=1');
  } catch (err) {
    next(err);
  }
});

module.exports = router;
