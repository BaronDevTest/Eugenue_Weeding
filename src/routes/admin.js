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

// QR generator
router.get('/qr', async (req, res, next) => {
  try {
    const publicUrl = process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
    const target = (req.query.target === 'gallery' ? '/gallery' : '/upload');
    const url = publicUrl.replace(/\/$/, '') + target;
    const dataUrl = await QRCode.toDataURL(url, {
      errorCorrectionLevel: 'H',
      margin: 2,
      width: 600,
      color: { dark: '#1a1a1a', light: '#ffffff' },
    });
    res.render('admin/qr', { title: 'QR Code', dataUrl, url, target });
  } catch (err) {
    next(err);
  }
});

// QR download as PNG
router.get('/qr/download', async (req, res, next) => {
  try {
    const publicUrl = process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
    const target = (req.query.target === 'gallery' ? '/gallery' : '/upload');
    const url = publicUrl.replace(/\/$/, '') + target;
    const buffer = await QRCode.toBuffer(url, {
      errorCorrectionLevel: 'H',
      margin: 2,
      width: 1200,
    });
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', `attachment; filename="qr-${target.replace('/', '')}.png"`);
    res.send(buffer);
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
  try {
    await drive.deleteFile(req.params.id);
    res.redirect('/admin/photos');
  } catch (err) {
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
      serviceAccountEmail: drive.getServiceAccountEmail(),
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
      welcomeMessage,
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
      welcomeMessage: (welcomeMessage || '').trim().slice(0, 500),
      driveFolderId: (driveFolderId || '').trim(),
      maxUploadMb: Math.max(1, Math.min(100, parseInt(maxUploadMb, 10) || 25)),
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
          serviceAccountEmail: drive.getServiceAccountEmail(),
        });
      }
      if (newPassword !== confirmPassword) {
        const settings = await getSettings();
        return res.status(400).render('admin/settings', {
          title: 'Setari',
          settings: { ...settings, ...patch },
          message: null,
          error: 'Parolele nu coincid.',
          serviceAccountEmail: drive.getServiceAccountEmail(),
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
