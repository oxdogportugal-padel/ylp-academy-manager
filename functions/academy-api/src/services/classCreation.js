const { getRow, insertRow, TABLES } = require('../db');
const { required, inRange, oneOf } = require('../utils/validation');
const { withAcademy, assertOwned } = require('../utils/tenant');
const { attemptFulfillFromClass } = require('./waitlist');

const DURATIONS = [60, 90, 120];

/** Shared by the manual "create class" endpoint and "convert alert into a class". */
async function createClass(req, payload) {
  required(payload, ['ClubId', 'CoachId', 'FieldNumber', 'DayOfWeek', 'StartTime', 'DurationMinutes', 'Level']);
  inRange(payload.DayOfWeek, 0, 6, 'DayOfWeek');
  inRange(payload.Level, 0, 10, 'Level');
  oneOf(Number(payload.DurationMinutes), DURATIONS, 'DurationMinutes');

  const club = assertOwned(await getRow(req, TABLES.CLUBS, payload.ClubId), req, 'Club');
  assertOwned(await getRow(req, TABLES.COACHES, payload.CoachId), req, 'Coach');
  inRange(payload.FieldNumber, 1, Number(club.NumberOfFields), 'FieldNumber');

  const row = await insertRow(req, TABLES.CLASSES, withAcademy({
    ClubId: Number(payload.ClubId),
    CoachId: Number(payload.CoachId),
    FieldNumber: Number(payload.FieldNumber),
    DayOfWeek: Number(payload.DayOfWeek),
    StartTime: payload.StartTime,
    DurationMinutes: Number(payload.DurationMinutes),
    Level: Number(payload.Level),
    Capacity: Number(payload.Capacity) || 4,
    Status: 'OPEN',
    EffectiveFrom: payload.EffectiveFrom || new Date().toISOString().slice(0, 10),
    EffectiveTo: payload.EffectiveTo || '',
  }, req));

  const autoFulfilled = await attemptFulfillFromClass(req, row);
  return { class: row, autoFulfilled };
}

module.exports = { createClass };
