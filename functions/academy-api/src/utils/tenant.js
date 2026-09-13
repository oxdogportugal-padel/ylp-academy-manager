class NotFoundError extends Error {
  constructor(message = 'Not found') {
    super(message);
    this.status = 404;
  }
}

/** Stamps the caller's resolved academy onto a row before insert. */
function withAcademy(data, req) {
  return { ...data, AcademyId: Number(req.academyId) };
}

/**
 * Guards against cross-tenant access by ROWID: throws 404 (not 403) so a
 * caller can't distinguish "doesn't exist" from "belongs to someone else's
 * academy".
 */
function assertOwned(row, req, label = 'Resource') {
  if (!row || Number(row.AcademyId) !== Number(req.academyId)) {
    throw new NotFoundError(`${label} not found`);
  }
  return row;
}

module.exports = { NotFoundError, withAcademy, assertOwned };
