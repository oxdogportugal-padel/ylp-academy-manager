const express = require('express');
const cors = require('cors');

const academiesRouter = require('./src/routes/academies');
const clubsRouter = require('./src/routes/clubs');
const coachesRouter = require('./src/routes/coaches');
const playersRouter = require('./src/routes/players');
const classesRouter = require('./src/routes/classes');
const requestsRouter = require('./src/routes/requests');
const alertsRouter = require('./src/routes/alerts');
const recommendationsRouter = require('./src/routes/recommendations');
const maintenanceRouter = require('./src/routes/maintenance');
const { requireAuth, resolveAcademy } = require('./src/middleware/auth');

const app = express();

app.use(cors());
app.use(express.json());

const api = express.Router();
api.use(requireAuth);

// Academy membership/creation happens before a tenant is resolved — a brand
// new login has no AcademyId yet, and creating one is how they get one.
api.use('/academies', academiesRouter);

// The cron sweeper crosses every tenant by design (see the route file), so
// it also sits outside the single-tenant resolveAcademy gate.
api.use('/maintenance', maintenanceRouter);

// Everything past this point is tenant-scoped: resolveAcademy sets
// req.academyId/req.role from the caller's AppUsers membership, and every
// route below filters and stamps rows by it.
api.use(resolveAcademy);
api.use('/clubs', clubsRouter);
api.use('/coaches', coachesRouter);
api.use('/players', playersRouter);
api.use('/classes', classesRouter);
api.use('/requests', requestsRouter);
api.use('/alerts', alertsRouter);
api.use('/recommendations', recommendationsRouter);

// Advanced I/O functions are reachable under /server/<function-name>/...
app.use('/server/academy-api/api/v1', api);

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error(err);
  const status = err.status || 500;
  res.status(status).json({ data: null, error: { message: err.message || 'Internal error' } });
});

module.exports = app;
