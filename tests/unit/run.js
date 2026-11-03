const { sdk, api } = require('./_boot.js');
const { DB, INVITES, setUser, reset } = sdk.__test;

function call(method, payload, asUser) {
  setUser(asUser || null);
  return new Promise((resolve) => {
    const req = { method, url: method === 'GET' ? `/execute?path=${payload.path}` : '/execute',
                  headers: { host: 'x.catalystserverless.eu' },
                  body: method === 'GET' ? undefined : payload };
    const res = { writeHead(){}, end(b){ resolve(JSON.parse(b)); } };
    Promise.resolve(api(req, res)).catch((e) => resolve({ error: 'THREW: ' + e.message }));
  });
}

const OPERATOR = { email_id: 'info@youlovepadel.pt', first_name: 'Luis', last_name: 'Castro' };
const OWNER_A  = { email_id: 'ana@hyve.pt',  first_name: 'Ana',  last_name: 'S' };
const OWNER_B  = { email_id: 'bruno@gaia.pt', first_name: 'Bruno', last_name: 'C' };

let pass = 0, fail = 0;
function check(label, cond, detail) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (detail !== undefined ? ' -> ' + JSON.stringify(detail) : '')); }
}

(async () => {
  reset();
  DB.PlatformAdmins.push({ ROWID: '1', Email: 'info@youlovepadel.pt', Status: 'active' });

  console.log('\nidentity');
  check('unauthenticated is refused', (await call('GET', { path: 'session' }, null)).error === 'Not signed in');
  let s = await call('GET', { path: 'session' }, OPERATOR);
  check('operator recognised', s.isOperator === true, s);
  check('operator has no academy of their own', s.academy === null, s);

  console.log('\noperator creates two academies, each invites its owner');
  let a = await call('POST', { path: 'admin/academy', academy: {
    name: 'The Hyve', ownerEmail: 'ana@hyve.pt', ownerName: 'Ana S',
    maxClubs: 2, maxUsers: 3, plan: 'ACTIVE' } }, OPERATOR);
  let b = await call('POST', { path: 'admin/academy', academy: {
    name: 'Clube Gaia', ownerEmail: 'bruno@gaia.pt', ownerName: 'Bruno C',
    maxClubs: 1, maxUsers: 2, plan: 'TRIAL' } }, OPERATOR);
  check('academy A created', !!a.id, a);
  check('academy B created', !!b.id, b);
  check('owner A invited by email', a.invited === true && INVITES[0].email === 'ana@hyve.pt', INVITES);
  check('owner B invited by email', b.invited === true && INVITES[1].email === 'bruno@gaia.pt', INVITES);
  check('owner recorded on the academy row', DB.AcademyUsers.filter(u => u.Role === 'owner').length === 2);
  check('creating an academy without an owner email is refused',
    (await call('POST', { path: 'admin/academy', academy: { name: 'No Owner' } }, OPERATOR)).error !== undefined);

  console.log('\nnon-operator cannot reach the operator surface');
  check('admin/academies refused', (await call('GET', { path: 'admin/academies' }, OWNER_A)).error === 'Not an operator');
  check('admin/academy refused',
    (await call('POST', { path: 'admin/academy', academy: { name: 'Sneaky', ownerEmail: 'x@y.pt' } }, OWNER_A)).error === 'Not an operator');

  console.log('\ntenancy comes from identity');
  s = await call('GET', { path: 'session' }, OWNER_A);
  check('owner A lands on academy A', s.academy && s.academy.id === a.id, s);
  check('owner A role is owner', s.role === 'owner', s);
  const sb = await call('GET', { path: 'session' }, OWNER_B);
  check('owner B lands on academy B', sb.academy && sb.academy.id === b.id, sb);

  console.log('\nacademy data is scoped');
  await call('POST', { path: 'save', collection: 'venues', record: { name: 'Riverside', courts: 3 } }, OWNER_A);
  await call('POST', { path: 'save', collection: 'venues', record: { name: 'Gaia Courts', courts: 2 } }, OWNER_B);
  const dataA = await call('GET', { path: 'data' }, OWNER_A);
  const dataB = await call('GET', { path: 'data' }, OWNER_B);
  check('A sees only its own club', dataA.venues.length === 1 && dataA.venues[0].name === 'Riverside', dataA.venues);
  check('B sees only its own club', dataB.venues.length === 1 && dataB.venues[0].name === 'Gaia Courts', dataB.venues);

  console.log('\ncross-tenant writes are refused even with a known ROWID');
  const bVenueId = dataB.venues[0].id;
  const steal = await call('POST', { path: 'save', collection: 'venues',
    record: { id: bVenueId, name: 'Hijacked', courts: 9 } }, OWNER_A);
  check('A cannot edit B\'s club', steal.error !== undefined, steal);
  check('B\'s club is untouched', DB.Clubs.find(c => String(c.ROWID) === bVenueId).Name === 'Gaia Courts');
  const del = await call('POST', { path: 'delete', collection: 'venues', id: bVenueId }, OWNER_A);
  check('A cannot delete B\'s club', del.error !== undefined, del);
  check('B\'s club still exists', DB.Clubs.some(c => String(c.ROWID) === bVenueId));

  console.log('\nclient-supplied academy id is ignored, not trusted');
  await call('POST', { path: 'save', collection: 'players',
    record: { name: 'Mole', level: 5, AcademyId: b.id, academyId: b.id } }, OWNER_A);
  check('new player is stamped with A, not the id the client sent',
    DB.Players.every(p => String(p.AcademyId) === String(a.id)), DB.Players.map(p => p.AcademyId));

  console.log('\nplan limits');
  await call('POST', { path: 'save', collection: 'venues', record: { name: 'Second A', courts: 2 } }, OWNER_A);
  const third = await call('POST', { path: 'save', collection: 'venues', record: { name: 'Third A', courts: 2 } }, OWNER_A);
  check('third club refused on a 2-club plan', /plan includes 2/.test(third.error || ''), third);
  const secondB = await call('POST', { path: 'save', collection: 'venues', record: { name: 'Second B', courts: 1 } }, OWNER_B);
  check('second club refused on a 1-club plan', /plan includes 1/.test(secondB.error || ''), secondB);

  console.log('\nseats and invitations');
  const u2 = await call('POST', { path: 'admin/user', user: { academyId: a.id, email: 'rui@hyve.pt', name: 'Rui T', role: 'coach' } }, OPERATOR);
  check('second user invited', u2.invited === true, u2);
  const u3 = await call('POST', { path: 'admin/user', user: { academyId: a.id, email: 'eva@hyve.pt', name: 'Eva M' } }, OPERATOR);
  check('third user fills the 3 seats', u3.invited === true, u3);
  const u4 = await call('POST', { path: 'admin/user', user: { academyId: a.id, email: 'zoe@hyve.pt' } }, OPERATOR);
  check('fourth user refused at the seat limit', /Seat limit/.test(u4.error || ''), u4);
  const dupe = await call('POST', { path: 'admin/user', user: { academyId: b.id, email: 'bruno@gaia.pt' } }, OPERATOR);
  check('duplicate email on the same academy refused', /already/.test(dupe.error || ''), dupe);

  console.log('\nnested data round-trips');
  const co = await call('POST', { path: 'save', collection: 'coaches',
    record: { name: 'Alex', certLevel: 3, venueIds: [dataA.venues[0].id] } }, OWNER_A);
  const kl = await call('POST', { path: 'save', collection: 'classes',
    record: { venueId: dataA.venues[0].id, coachId: co.id, day: 1, start: '19:00',
              duration: 90, level: 5, capacity: null, playerIds: [] } }, OWNER_A);
  const pl = await call('POST', { path: 'save', collection: 'players', record: { name: 'Ana P', level: 5 } }, OWNER_A);
  await call('POST', { path: 'save', collection: 'classes',
    record: { id: kl.id, venueId: dataA.venues[0].id, coachId: co.id, day: 1, start: '19:00',
              duration: 90, level: 5, capacity: null, playerIds: [pl.id] } }, OWNER_A);
  let d2 = await call('GET', { path: 'data' }, OWNER_A);
  check('roster hydrated from the join table', d2.classes[0].playerIds.length === 1, d2.classes[0]);
  check('coach club link hydrated', d2.coaches[0].venueIds.length === 1, d2.coaches[0]);
  await call('POST', { path: 'save', collection: 'classes',
    record: { id: kl.id, venueId: dataA.venues[0].id, coachId: co.id, day: 1, start: '19:00',
              duration: 90, level: 5, capacity: null, playerIds: [] } }, OWNER_A);
  check('removing a player deletes exactly one enrollment', DB.ClassEnrollments.length === 0, DB.ClassEnrollments);

  console.log('\nsuspension and orphans');
  await call('POST', { path: 'admin/academy', academy: { id: b.id, name: 'Clube Gaia', plan: 'SUSPENDED', maxClubs: 1, maxUsers: 2 } }, OPERATOR);
  check('suspended academy is locked out', (await call('GET', { path: 'data' }, OWNER_B)).error === 'suspended');
  check('deleting an academy with clubs refused', /club/.test((await call('POST', { path: 'admin/academy/delete', id: b.id }, OPERATOR)).error || ''));
  check('user with no academy gets a clear answer',
    (await call('GET', { path: 'data' }, { email_id: 'nobody@nowhere.pt' })).error === 'no-academy');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
