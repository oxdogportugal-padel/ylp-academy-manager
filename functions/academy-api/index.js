const express = require('express');
const cors = require('cors');

const clubsRouter = require('./src/routes/clubs');
const coachesRouter = require('./src/routes/coaches');
const playersRouter = require('./src/routes/players');
const classesRouter = require('./src/routes/classes');
const requestsRouter = require('./src/routes/requests');
const alertsRouter = require('./src/routes/alerts');
const recommendationsRouter = require('./src/routes/recommendations');
const maintenanceRouter = require('./src/routes/maintenance');
const { requireAuth } = require('./src/middleware/auth');

const app = express();

app.use(cors());
app.use(express.json());

const api = express.Router();

// Public: prospective players submit their own intake before they have an
// account, so this stays outside the staff-only auth gate.
api.use('/recommendations', recommendationsRouter);

api.use(requireAuth);
api.use('/clubs', clubsRouter);
api.use('/coaches', coachesRouter);
api.use('/players', playersRouter);
api.use('/classes', classesRouter);
api.use('/requests', requestsRouter);
api.use('/alerts', alertsRouter);
api.use('/maintenance', maintenanceRouter);

// Advanced I/O functions are reachable under /server/<function-name>/...
app.use('/server/academy-api/api/v1', api);

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error(err);
  const status = err.status || 500;
  res.status(status).json({ data: null, error: { message: err.message || 'Internal error' } });
});

module.exports = app;
