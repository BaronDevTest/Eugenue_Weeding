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
    fileSize: 50 * 1024 * 1024, // 50MB hard cap; cap mai mic vine din settings
    files: 10,
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

// Endpoint upload
router.post('/upload', upload.array('photos', 10), async (req, res, next) => {
  try {
    const settings = await getSettings();
    const maxBytes = (settings.maxUploadMb || 25) * 1024 * 1024;

    if (!req.files || req.files.length === 0) {
      return res.status(400).render('upload', {
        title: 'Adauga poze',
        error: 'Nu ai selectat nicio poza.',
      });
    }

    for (const f of req.files) {
      if (f.size > maxBytes) {
        return res.status(400).render('upload', {
          title: 'Adauga poze',
          error: `Fisierul "${f.originalname}" depaseste limita de ${settings.maxUploadMb}MB.`,
        });
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
      return res.status(500).render('upload', {
        title: 'Adauga poze',
        error:
          'Nu am putut salva pozele. Te rugam sa incerci din nou sau sa ii spui gazdei. ' +
          '(Detaliu tehnic: ' + err.message + ')',
      });
    }

    res.render('upload-success', {
      title: 'Multumim!',
      count: uploaded.length,
    });
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
      return res.render('gallery', { title: 'Galerie', items: [], driveError: err.message });
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
    res.render('gallery', { title: 'Galerie', items, driveError: null });
  } catch (err) {
    next(err);
  }
});

// Health check
router.get('/healthz', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

module.exports = router;
