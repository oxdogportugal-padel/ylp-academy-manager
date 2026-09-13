const catalyst = require('zcatalyst-sdk-node');

/**
 * Basic I/O function meant to be scheduled hourly via Catalyst Job
 * Scheduler. It's a safety net for `POST /server/academy-api/api/v1/maintenance/sweep`,
 * which normally already runs on every request/enrollment/cancellation
 * change — this just re-checks in case a client-triggered scan was missed.
 *
 * NOTE: `functions().execute()` invokes another Catalyst function
 * server-to-server. Verify the exact method name against the zcatalyst-sdk-node
 * version pinned in package.json when wiring this up for real — Catalyst's
 * internal function-invocation API has changed across SDK majors.
 */
module.exports = async (context, basicIO) => {
  try {
    const catalystApp = catalyst.initialize(context);
    const response = await catalystApp.functions().execute('academy-api', {
      method: 'POST',
      path: '/server/academy-api/api/v1/maintenance/sweep',
    });
    basicIO.write(JSON.stringify({ ok: true, response }));
  } catch (err) {
    basicIO.write(JSON.stringify({ ok: false, error: err.message }));
  } finally {
    context.closeWithSuccess();
  }
};
