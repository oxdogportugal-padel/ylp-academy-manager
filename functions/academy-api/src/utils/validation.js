class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

function required(body, fields) {
  const missing = fields.filter((f) => body[f] === undefined || body[f] === null || body[f] === '');
  if (missing.length) throw new ValidationError(`Missing required field(s): ${missing.join(', ')}`);
}

function inRange(value, min, max, label) {
  const n = Number(value);
  if (Number.isNaN(n) || n < min || n > max) {
    throw new ValidationError(`${label} must be between ${min} and ${max}`);
  }
  return n;
}

function oneOf(value, allowed, label) {
  if (!allowed.includes(value)) {
    throw new ValidationError(`${label} must be one of: ${allowed.join(', ')}`);
  }
  return value;
}

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

module.exports = { ValidationError, required, inRange, oneOf, asyncHandler };
