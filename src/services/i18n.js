/**
 * i18n - sistem simplu de traduceri.
 * Detecteaza limba din: 1) ?lang=xx, 2) cookie/session, 3) Accept-Language header
 * Suporta: ro (default), en, ru
 */
const fs = require('fs');
const path = require('path');

const SUPPORTED = ['ro', 'en', 'ru'];
const DEFAULT_LOCALE = 'ro';

const translations = {};

function loadTranslations() {
  for (const locale of SUPPORTED) {
    const file = path.join(__dirname, '..', '..', 'locales', `${locale}.json`);
    try {
      translations[locale] = JSON.parse(fs.readFileSync(file, 'utf-8'));
    } catch (err) {
      console.warn(`[i18n] Nu am putut incarca ${file}:`, err.message);
      translations[locale] = {};
    }
  }
}
loadTranslations();

function detectFromHeader(acceptLanguage) {
  if (!acceptLanguage) return null;
  // exemplu: "ro-RO,ro;q=0.9,en-US;q=0.8,en;q=0.7,ru;q=0.6"
  const langs = acceptLanguage
    .split(',')
    .map((part) => {
      const [code, q] = part.trim().split(';q=');
      return { code: code.slice(0, 2).toLowerCase(), q: q ? parseFloat(q) : 1.0 };
    })
    .sort((a, b) => b.q - a.q);
  for (const l of langs) {
    if (SUPPORTED.includes(l.code)) return l.code;
  }
  return null;
}

function getTranslator(locale) {
  return function t(key, vars = {}) {
    const fallback = translations[DEFAULT_LOCALE][key];
    let value = (translations[locale] && translations[locale][key]) || fallback || key;
    for (const [k, v] of Object.entries(vars)) {
      value = value.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), v);
    }
    return value;
  };
}

function middleware(req, res, next) {
  // 1. URL ?lang=
  let locale = req.query.lang;
  if (locale && SUPPORTED.includes(locale)) {
    if (req.session) req.session.locale = locale;
  } else if (req.session && req.session.locale && SUPPORTED.includes(req.session.locale)) {
    // 2. session
    locale = req.session.locale;
  } else {
    // 3. Accept-Language header
    locale = detectFromHeader(req.headers['accept-language']) || DEFAULT_LOCALE;
  }

  req.locale = locale;
  req.t = getTranslator(locale);
  res.locals.locale = locale;
  res.locals.supportedLocales = SUPPORTED;
  res.locals.t = req.t;
  next();
}

module.exports = { middleware, SUPPORTED, DEFAULT_LOCALE, getTranslator };
