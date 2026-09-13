const catalyst = require('zcatalyst-sdk-node');

const TABLES = {
  CLUBS: 'Clubs',
  COACHES: 'Coaches',
  CLUB_COACHES: 'ClubCoaches',
  PLAYERS: 'Players',
  CLASSES: 'Classes',
  ENROLLMENTS: 'ClassEnrollments',
  REQUESTS: 'Requests',
  ALERTS: 'ClassOpeningAlerts',
  APP_USERS: 'AppUsers',
};

function catalystApp(req) {
  return catalyst.initialize(req);
}

function table(req, tableName) {
  return catalystApp(req).datastore().table(tableName);
}

async function zcql(req, query) {
  const rows = await catalystApp(req).zcql().executeZCQLQuery(query);
  // ZCQL returns rows keyed by table name, e.g. [{ Classes: {...} }]
  return rows.map((row) => row[Object.keys(row)[0]]);
}

async function insertRow(req, tableName, data) {
  return table(req, tableName).insertRow(data);
}

async function updateRow(req, tableName, data) {
  return table(req, tableName).updateRow(data);
}

async function deleteRow(req, tableName, rowId) {
  return table(req, tableName).deleteRow(rowId);
}

async function getRow(req, tableName, rowId) {
  return table(req, tableName).getRow(rowId);
}

module.exports = {
  TABLES,
  catalystApp,
  table,
  zcql,
  insertRow,
  updateRow,
  deleteRow,
  getRow,
};
