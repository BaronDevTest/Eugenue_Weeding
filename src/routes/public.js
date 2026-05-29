/**
 * Rute publice: landing, upload, galerie.
 */
const express = require('express');
const multer = require('multer');

const drive = require('../services/drive');
const { getSettings } = require('../services/settings');

const router = express.Router();

// Multer in-memory storage - fisierele merg direct in Drive, fara sa atinga disk-ul
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    // 600MB hard cap - suficient pentru videoclipuri de pe telefon (1-3 minute).
    // Cap-ul real vine din settings.maxUploadMb (configurabil 1-500MB din admin).
    fileSize: 600 * 1024 * 1024,
    files: 50,
  },
  fileFilter: (req, file, cb) => {
    // Acceptam doar imagini. Video-urile sunt prea mari pentru fluxul nostru
    // si lasam invitatii sa le impartaseasca pe alt canal (ex: WhatsApp).
    if (file.mimetype.startsWith('image/')) {
      return cb(null, true);
    }
    cb(new Error('Doar imagini sunt acceptate.'));
  },
});

// Landing page
router.get('/', async (req, res) => {
  res.render('index', { title: 'Bun venit', preloadBgImage: '/static/images/main_image.jpg' });
});

// Pagina de upload
router.get('/upload', async (req, res) => {
  res.render('upload', { title: 'Adauga poze' });
});

// Pagina de success - acum redirect la galerie cu flag
router.get('/upload-success', (req, res) => {
  const count = Math.max(1, parseInt(req.query.count, 10) || 1);
  res.redirect(`/gallery?uploaded=${count}`);
});

// Endpoint upload
router.post('/upload', upload.array('photos', 50), async (req, res, next) => {
  const isXhr = req.xhr || req.get('X-Requested-With') === 'XMLHttpRequest' || req.accepts(['json', 'html']) === 'json';

  function fail(status, message) {
    if (isXhr) return res.status(status).json({ ok: false, error: message });
    return res.status(status).render('upload', { title: req.t('upload.title'), error: message });
  }

  try {
    const settings = await getSettings();
    const maxBytes = (settings.maxUploadMb || 25) * 1024 * 1024;

    if (!req.files || req.files.length === 0) {
      return fail(400, req.t('upload.errorNoFiles'));
    }

    for (const f of req.files) {
      if (f.size > maxBytes) {
        return fail(400, req.t('upload.errorTooLarge', { name: f.originalname, max: settings.maxUploadMb }));
      }
    }

    const guestName = (req.body.guestName || '').trim().slice(0, 60);
    const message = (req.body.message || '').trim().slice(0, 280);

    // Upload paralel in Drive - toate fisierele in acelasi timp, nu secvential.
    // Folosim allSettled ca sa nu pierdem upload-urile reusite cand unul singur esueaza.
    const results = await Promise.allSettled(
      req.files.map((file) =>
        drive.uploadFile(file.buffer, file.originalname, file.mimetype, { guestName, message })
      )
    );

    const uploaded = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
    const failed = results.filter((r) => r.status === 'rejected');

    if (failed.length > 0) {
      console.error(
        '[upload] %d/%d failed:',
        failed.length,
        req.files.length,
        failed.map((f) => f.reason && f.reason.message).slice(0, 3)
      );
    }

    if (uploaded.length === 0) {
      const firstErr = failed[0] && failed[0].reason && failed[0].reason.message;
      return fail(500, req.t('upload.errorGeneric') + (firstErr ? ' (' + firstErr + ')' : ''));
    }

    if (isXhr) {
      return res.json({
        ok: true,
        count: uploaded.length,
        failed: failed.length,
        redirectTo: `/gallery?uploaded=${uploaded.length}`,
      });
    }
    res.redirect(`/gallery?uploaded=${uploaded.length}`);
  } catch (err) {
    next(err);
  }
});

// Galerie
router.get('/gallery', async (req, res, next) => {
  try {
    let files;
    try {
      files = await drive.listFiles({ pageSize: 200 });
    } catch (err) {
      console.warn('[gallery] Drive indisponibil:', err.message);
      return res.render('gallery', { title: req.t('gallery.title'), items: [], driveError: err.message, uploaded: 0 });
    }
    const items = files.map((f) => ({
      id: f.id,
      name: f.name,
      mimeType: f.mimeType,
      createdTime: f.createdTime,
      imageUrl: drive.buildImageUrl(f, 'w800'),
      fullUrl: drive.buildImageUrl(f, 'w2000'),
      webViewLink: f.webViewLink,
      isImage: drive.isImage(f),
      isVideo: drive.isVideo(f),
      guestName: (f.properties && f.properties.guestName) || '',
      message: (f.properties && f.properties.message) || f.description || '',
    }));
    const uploaded = Math.max(0, parseInt(req.query.uploaded, 10) || 0);
    res.render('gallery', { title: req.t('gallery.title'), items, driveError: null, uploaded });
  } catch (err) {
    next(err);
  }
});

// Health check
router.get('/healthz', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

module.exports = router;
