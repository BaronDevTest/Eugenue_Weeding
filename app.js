/**
 * Wedding QR Gallery - Entry point
 * Compatibil cu Phusion Passenger (cPanel Node.js apps).
 */
require('dotenv').config();

const path = require('path');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const compression = require('compression');

const { ensureSettingsFile } = require('./src/services/settings');
const i18n = require('./src/services/i18n');
const publicRoutes = require('./src/routes/public');
const adminRoutes = require('./src/routes/admin');

const app = express();

// Trust proxy - necesar pe cPanel (Passenger ruleaza in spatele unui reverse proxy)
app.set('trust proxy', 1);

// Engine EJS
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Securitate & performanta
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        fontSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'blob:', 'https://drive.google.com', 'https://*.googleusercontent.com', 'https://lh3.googleusercontent.com'],
        connectSrc: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  })
);
app.use(compression());

// Static - cache lung pentru fonturi (1 an, immutable), 7 zile pentru restul
app.use(
  '/static/fonts',
  express.static(path.join(__dirname, 'public', 'fonts'), {
    maxAge: '365d',
    immutable: true,
    setHeaders: (res) => res.setHeader('Cache-Control', 'public, max-age=31536000, immutable'),
  })
);
app.use('/static', express.static(path.join(__dirname, 'public'), { maxAge: '7d' }));

// Body parsing (multer se ocupa de multipart in rutele specifice)
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(express.json({ limit: '1mb' }));

// Sesiuni
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'fallback-insecure-secret-please-set-env',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 1000 * 60 * 60 * 8, // 8 ore
      secure: process.env.NODE_ENV === 'production',
    },
  })
);

// i18n - se aplica DUPA session pentru a putea folosi req.session
app.use(i18n.middleware);

// Local vars disponibile in toate template-urile
app.use(async (req, res, next) => {
  try {
    const { getSettings } = require('./src/services/settings');
    const settings = await getSettings();
    res.locals.settings = settings;
    res.locals.isAdmin = Boolean(req.session && req.session.isAdmin);
    res.locals.publicUrl = process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
    res.locals.currentPath = req.path;
    res.locals.currentQuery = req.query;
    next();
  } catch (err) {
    next(err);
  }
});

// Rute
app.use('/', publicRoutes);
app.use('/admin', adminRoutes);

// Asigura ca locale + traduceri exista in res.locals chiar daca i18n
// middleware n-a rulat (caz extrem - eroare in middleware-ul anterior)
function ensureLocaleDefaults(res) {
  if (!res.locals.locale) res.locals.locale = i18n.DEFAULT_LOCALE;
  if (!res.locals.supportedLocales) res.locals.supportedLocales = i18n.SUPPORTED;
  if (!res.locals.t) res.locals.t = i18n.getTranslator(res.locals.locale);
  if (!res.locals.settings) {
    res.locals.settings = {
      brideName: 'Emilia',
      groomName: 'Eugen',
      weddingDate: '',
      welcomeMessage: '',
      allowMessages: true,
      maxUploadMb: 25,
    };
  }
}

// 404
app.use((req, res) => {
  ensureLocaleDefaults(res);
  // Pentru cereri XHR/JSON returnam JSON, nu HTML
  if (req.xhr || req.get('X-Requested-With') === 'XMLHttpRequest' || req.accepts(['html', 'json']) === 'json') {
    return res.status(404).json({ ok: false, error: 'Not found' });
  }
  res.status(404).render('error', {
    title: 'Pagina nu a fost gasita',
    message: 'Pagina cautata nu exista.',
    status: 404,
  });
});

// Error handler
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[ERROR]', err);
  ensureLocaleDefaults(res);
  const status = err.status || 500;
  const msg = process.env.NODE_ENV === 'production' ? 'A aparut o eroare neasteptata.' : err.message;
  if (req.xhr || req.get('X-Requested-With') === 'XMLHttpRequest' || req.accepts(['html', 'json']) === 'json') {
    return res.status(status).json({ ok: false, error: msg });
  }
  res.status(status).render('error', {
    title: 'A aparut o eroare',
    message: msg,
    status,
  });
});

// Bootstrap & start
(async () => {
  try {
    await ensureSettingsFile();
    const port = process.env.PORT || 3000;
    app.listen(port, () => {
      console.log(`[wedding-qr] Server pornit pe portul ${port}`);
    });
  } catch (err) {
    console.error('[FATAL] Nu pot porni serverul:', err);
    process.exit(1);
  }
})();

module.exports = app;
