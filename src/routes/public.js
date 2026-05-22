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
    fileSize: 110 * 1024 * 1024, // 110MB hard cap; cap real vine din settings.maxUploadMb
    files: 50,
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/') || file.mimetype.startsWith('video/')) {
      return cb(null, true);
    }
    cb(new Error('Doar imagini si video-uri sunt acceptate.'));
  },
});

// Landing page
router.get('/', async (req, res) => {
  res.render('index', { title: 'Bun venit' });
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

    const uploaded = [];
    try {
      for (const file of req.files) {
        const result = await drive.uploadFile(file.buffer, file.originalname, file.mimetype, {
          guestName,
          message,
        });
        uploaded.push(result);
      }
    } catch (err) {
      console.error('[upload] Drive error:', err);
      return fail(500, req.t('upload.errorGeneric') + ' (' + err.message + ')');
    }

    if (isXhr) {
      return res.json({ ok: true, count: uploaded.length, redirectTo: `/gallery?uploaded=${uploaded.length}` });
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
