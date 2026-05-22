/**
 * Middleware: cere ca user-ul sa fie autentificat ca admin.
 */
function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) {
    return next();
  }
  if (req.method === 'GET' && req.accepts('html')) {
    return res.redirect('/admin/login?next=' + encodeURIComponent(req.originalUrl));
  }
  return res.status(401).json({ error: 'Neautentificat' });
}

module.exports = { requireAdmin };
