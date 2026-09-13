const { zcql, insertRow, updateRow, TABLES } = require('../db');
const { levelFits, csvToNums, enrollmentCount } = require('./matching');
const { withAcademy } = require('../utils/tenant');

const MIN_GROUP_SIZE = 2; // "possible to open a new class with a minimum of 2 players"

function mode(values) {
  if (!values.length) return null;
  const counts = {};
  values.forEach((v) => { counts[v] = (counts[v] || 0) + 1; });
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}

async function openPendingRequests(req, clubId) {
  return zcql(
    req,
    `SELECT * FROM ${TABLES.REQUESTS} WHERE AcademyId = ${req.academyId} AND ClubId = ${Number(clubId)} AND (Status = 'PENDING' OR Status = 'PARTIAL')`
  );
}

/**
 * After a class is created, or a spot frees up in an existing one, pull in
 * any waiting player whose request matches — including partially-fulfilled
 * 2x/week requests looking for their second slot.
 */
async function attemptFulfillFromClass(req, classRow) {
  const used = await enrollmentCount(req, classRow.ROWID);
  let spotsLeft = Number(classRow.Capacity) - used;
  if (spotsLeft <= 0) return [];

  const requests = await openPendingRequests(req, classRow.ClubId);
  const fulfilled = [];

  for (const r of requests) {
    if (spotsLeft <= 0) break;
    if (!levelFits(classRow.Level, r.Level)) continue;

    const days = csvToNums(r.PreferredDays);
    if (days.length && !days.includes(Number(classRow.DayOfWeek))) continue;

    const durations = csvToNums(r.PreferredDurations);
    if (durations.length && !durations.includes(Number(classRow.DurationMinutes))) continue;

    // eslint-disable-next-line no-await-in-loop
    await insertRow(req, TABLES.ENROLLMENTS, withAcademy({
      ClassId: classRow.ROWID,
      PlayerId: r.PlayerId,
      Status: 'CONFIRMED',
      RequestId: r.ROWID,
    }, req));

    const fulfilledSessions = Number(r.FulfilledSessions || 0) + 1;
    const status = fulfilledSessions >= Number(r.SessionsPerWeek) ? 'FULFILLED' : 'PARTIAL';
    // eslint-disable-next-line no-await-in-loop
    await updateRow(req, TABLES.REQUESTS, { ROWID: r.ROWID, FulfilledSessions: fulfilledSessions, Status: status });

    fulfilled.push({ requestId: r.ROWID, playerId: r.PlayerId, status });
    spotsLeft -= 1;
  }

  return fulfilled;
}

/**
 * Groups still-unfulfilled Requests by club + rounded level + shared
 * preferred day, and opens/refreshes a ClassOpeningAlert whenever 2+ players
 * would fit the same new class.
 */
async function scanForClassOpenings(req, clubId) {
  const requests = await openPendingRequests(req, clubId);

  const levelBuckets = {};
  requests.forEach((r) => {
    const key = Math.round(Number(r.Level));
    (levelBuckets[key] = levelBuckets[key] || []).push(r);
  });

  const existingAlerts = await zcql(
    req,
    `SELECT * FROM ${TABLES.ALERTS} WHERE AcademyId = ${req.academyId} AND ClubId = ${Number(clubId)} AND Status = 'OPEN'`
  );

  const results = [];
  const claimed = new Set();

  for (const group of Object.values(levelBuckets)) {
    const dayCounts = {};
    group.forEach((r) => csvToNums(r.PreferredDays).forEach((d) => { dayCounts[d] = (dayCounts[d] || 0) + 1; }));
    const rankedDays = Object.entries(dayCounts).sort((a, b) => b[1] - a[1]);

    for (const [day] of rankedDays) {
      const matches = group.filter(
        (r) => !claimed.has(r.ROWID) && csvToNums(r.PreferredDays).includes(Number(day))
      );
      if (matches.length < MIN_GROUP_SIZE) continue;

      matches.forEach((r) => claimed.add(r.ROWID));
      const level = Math.round(Number(matches[0].Level));
      const suggestedTimeStart = mode(matches.map((r) => r.PreferredTimeStart).filter(Boolean)) || '18:00';
      const suggestedDuration = Number(mode(matches.flatMap((r) => csvToNums(r.PreferredDurations))) || 60);
      const matchingIds = matches.map((r) => r.ROWID).join(',');

      const existing = existingAlerts.find((a) => Number(a.Level) === level && Number(a.SuggestedDayOfWeek) === Number(day));
      let alert;
      if (existing) {
        // eslint-disable-next-line no-await-in-loop
        alert = await updateRow(req, TABLES.ALERTS, {
          ROWID: existing.ROWID,
          SuggestedTimeStart: suggestedTimeStart,
          SuggestedDurationMinutes: suggestedDuration,
          MatchingRequestIds: matchingIds,
        });
      } else {
        // eslint-disable-next-line no-await-in-loop
        alert = await insertRow(req, TABLES.ALERTS, withAcademy({
          ClubId: Number(clubId),
          Level: level,
          SuggestedDayOfWeek: Number(day),
          SuggestedTimeStart: suggestedTimeStart,
          SuggestedDurationMinutes: suggestedDuration,
          MatchingRequestIds: matchingIds,
          Status: 'OPEN',
        }, req));
      }
      results.push(alert);
    }
  }

  return results;
}

module.exports = { attemptFulfillFromClass, scanForClassOpenings, MIN_GROUP_SIZE };
