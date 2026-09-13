const { zcql, TABLES } = require('../db');

const LEVEL_FLEXIBILITY = 1; // "same level, with some flexibility of 1 level before or after"

function levelFits(classLevel, playerLevel) {
  return Math.abs(Number(classLevel) - Number(playerLevel)) <= LEVEL_FLEXIBILITY;
}

function csvToNums(csv) {
  return String(csv || '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '')
    .map(Number);
}

function timeToMinutes(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + m;
}

/** Overlap score between a class's [start, start+duration) and a preferred [start,end) window, 0..1. */
function timeOverlapScore(classStart, durationMinutes, prefStart, prefEnd) {
  if (!prefStart || !prefEnd) return 0.5; // no preference stated — neutral score
  const cs = timeToMinutes(classStart);
  const ce = cs + Number(durationMinutes);
  const ps = timeToMinutes(prefStart);
  const pe = timeToMinutes(prefEnd);
  const overlap = Math.max(0, Math.min(ce, pe) - Math.max(cs, ps));
  const windowSize = Math.max(1, pe - ps);
  return Math.min(1, overlap / windowSize);
}

async function openClassesForClub(req, clubId) {
  return zcql(
    req,
    `SELECT * FROM ${TABLES.CLASSES} WHERE ClubId = ${Number(clubId)} AND Status != 'CANCELLED' ORDER BY DayOfWeek ASC, StartTime ASC LIMIT 500`
  );
}

async function enrollmentCount(req, classId) {
  const rows = await zcql(
    req,
    `SELECT ROWID FROM ${TABLES.ENROLLMENTS} WHERE ClassId = ${Number(classId)} AND Status = 'CONFIRMED'`
  );
  return rows.length;
}

/**
 * Ranks open classes at a club against a set of preferences.
 * preferences: { level, days: [0-6], durations: [60,90,120], timeStart, timeEnd }
 */
async function recommendClasses(req, clubId, preferences) {
  const classes = await openClassesForClub(req, clubId);
  const preferredDays = preferences.days && preferences.days.length ? preferences.days.map(Number) : null;
  const preferredDurations = preferences.durations && preferences.durations.length ? preferences.durations.map(Number) : null;

  const scored = [];
  for (const cls of classes) {
    if (!levelFits(cls.Level, preferences.level)) continue;
    const count = await enrollmentCount(req, cls.ROWID);
    if (count >= Number(cls.Capacity)) continue;
    if (preferredDays && !preferredDays.includes(Number(cls.DayOfWeek))) continue;
    if (preferredDurations && !preferredDurations.includes(Number(cls.DurationMinutes))) continue;

    const levelScore = 1 - Math.abs(Number(cls.Level) - Number(preferences.level)) / (LEVEL_FLEXIBILITY + 1);
    const timeScore = timeOverlapScore(cls.StartTime, cls.DurationMinutes, preferences.timeStart, preferences.timeEnd);
    const spaceScore = (Number(cls.Capacity) - count) / Number(cls.Capacity);
    const score = levelScore * 0.5 + timeScore * 0.4 + spaceScore * 0.1;

    scored.push({ ...cls, spotsLeft: Number(cls.Capacity) - count, matchScore: Math.round(score * 100) / 100 });
  }

  scored.sort((a, b) => b.matchScore - a.matchScore);
  return scored;
}

module.exports = { levelFits, csvToNums, timeToMinutes, timeOverlapScore, openClassesForClub, enrollmentCount, recommendClasses, LEVEL_FLEXIBILITY };
