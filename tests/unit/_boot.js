/* Test harness for the API function.
 *
 * The unit suites used to run against a hand-copied duplicate of the function.
 * They now load `functions/api/index.js` itself — the file that actually
 * deploys — so a change can never pass the tests and ship broken.
 *
 * Two modules are intercepted before it loads:
 *   zcatalyst-sdk-node → the fake in tests/fake/, which reproduces the real
 *     Data Store's quirks: ZCQL results wrapped under the table name, string
 *     ROWIDs, and row writes that demand an array rather than an object.
 *   express → forced to fail, so index.js takes its documented fallback and
 *     exports the raw (req, res) handler. The deployed bundle has express and
 *     wraps it in an app; the handler underneath is the same function.
 */
'use strict';
const path = require('path');
const Module = require('module');

const FAKE = require.resolve(path.join(__dirname, '..', 'fake', 'zcatalyst-sdk-node', 'index.js'));
const API = path.join(__dirname, '..', '..', 'functions', 'api', 'index.js');

const resolve = Module._resolveFilename;
Module._resolveFilename = function (request) {
  if (request === 'zcatalyst-sdk-node') return FAKE;
  if (request === 'express') {
    const e = new Error("Cannot find module 'express'");
    e.code = 'MODULE_NOT_FOUND';
    throw e;
  }
  return resolve.apply(this, arguments);
};

const sdk = require(FAKE);
const api = require(API);

if (typeof api !== 'function') {
  throw new Error('Expected the raw handler from functions/api/index.js, got ' + typeof api);
}

module.exports = { sdk, api };
