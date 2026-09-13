import { useState } from 'react';
import { useClubs, useCreateRequest, useEnrollPlayer, useRecommendations, useSavePlayer } from '../api/hooks';
import { DAY_NAMES } from '../store/filters';
import { Button, Card, Field, Input, Select } from '../components/ui';

const DURATIONS = [60, 90, 120];
const LEVELS = Array.from({ length: 21 }, (_, i) => i / 2);

const emptyForm = {
  Name: '',
  Email: '',
  Phone: '',
  PreferredClubId: '',
  Level: 3,
  days: [],
  durations: [],
  timeStart: '17:00',
  timeEnd: '21:00',
  sessionsPerWeek: 1,
};

function toggle(list, value) {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export default function IntakePage() {
  const { data: clubs = [] } = useClubs();
  const savePlayer = useSavePlayer();
  const recommend = useRecommendations();
  const enroll = useEnrollPlayer();
  const createRequest = useCreateRequest();

  const [form, setForm] = useState(emptyForm);
  const [player, setPlayer] = useState(null);
  const [result, setResult] = useState(null);
  const [selected, setSelected] = useState([]);
  const [outcome, setOutcome] = useState(null);

  const findClasses = async (e) => {
    e.preventDefault();
    const createdPlayer = await savePlayer.mutateAsync({
      Name: form.Name,
      Email: form.Email,
      Phone: form.Phone,
      Level: form.Level,
      PreferredClubId: form.PreferredClubId,
    });
    setPlayer(createdPlayer);

    const rec = await recommend.mutateAsync({
      clubId: form.PreferredClubId,
      level: form.Level,
      days: form.days,
      durations: form.durations,
      timeStart: form.timeStart,
      timeEnd: form.timeEnd,
      sessionsPerWeek: form.sessionsPerWeek,
    });
    setResult(rec);
    setSelected([]);
  };

  const confirm = async () => {
    for (const classId of selected) {
      // eslint-disable-next-line no-await-in-loop
      await enroll.mutateAsync({ classId, playerId: player.ROWID });
    }

    const remaining = form.sessionsPerWeek - selected.length;
    if (remaining > 0) {
      const req = await createRequest.mutateAsync({
        PlayerId: player.ROWID,
        ClubId: form.PreferredClubId,
        Level: form.Level,
        PreferredDurations: form.durations,
        PreferredDays: form.days,
        PreferredTimeStart: form.timeStart,
        PreferredTimeEnd: form.timeEnd,
        SessionsPerWeek: form.sessionsPerWeek,
        FulfilledSessions: selected.length,
      });
      setOutcome({ enrolledCount: selected.length, waitlisted: true, alerts: req.alerts });
    } else {
      setOutcome({ enrolledCount: selected.length, waitlisted: false });
    }
  };

  if (outcome) {
    return (
      <div className="p-4">
        <Card className="mx-auto max-w-md text-center">
          <h2 className="mb-2 text-lg font-bold">
            {outcome.enrolledCount > 0 ? `${player.Name} is booked in!` : `${player.Name} is on the waitlist`}
          </h2>
          <p className="mb-4 text-sm text-slate-600">
            {outcome.enrolledCount} of {form.sessionsPerWeek} weekly session(s) confirmed.
            {outcome.waitlisted && ' The remaining session will be filled automatically as soon as a matching class opens.'}
          </p>
          {outcome.alerts?.length > 0 && (
            <p className="mb-4 text-sm text-brand-700">
              🎉 This request pushed a slot over the 2-player minimum — check the Alerts tab to open a new class.
            </p>
          )}
          <Button
            onClick={() => {
              setForm(emptyForm);
              setPlayer(null);
              setResult(null);
              setOutcome(null);
            }}
          >
            Add another player
          </Button>
        </Card>
      </div>
    );
  }

  if (result) {
    return (
      <div className="p-4">
        <h1 className="mb-1 text-lg font-bold">Best-fit classes for {form.Name}</h1>
        <p className="mb-4 text-sm text-slate-500">
          Pick up to {form.sessionsPerWeek} class{form.sessionsPerWeek > 1 ? 'es' : ''}.
          {result.partiallyFits && ' Only a partial match was found — the rest will go on the waitlist.'}
        </p>

        <div className="flex flex-col gap-2">
          {result.classes.map((cls) => (
            <label
              key={cls.ROWID}
              className={`flex cursor-pointer items-center justify-between rounded-xl border p-3 ${
                selected.includes(cls.ROWID) ? 'border-brand-500 bg-brand-50' : 'border-slate-200 bg-white'
              }`}
            >
              <div>
                <div className="text-sm font-semibold">
                  {DAY_NAMES[cls.DayOfWeek]} {cls.StartTime} · {cls.DurationMinutes} min
                </div>
                <div className="text-xs text-slate-500">Level {cls.Level} · {cls.spotsLeft} spots left · match {Math.round(cls.matchScore * 100)}%</div>
              </div>
              <input
                type="checkbox"
                disabled={!selected.includes(cls.ROWID) && selected.length >= form.sessionsPerWeek}
                checked={selected.includes(cls.ROWID)}
                onChange={() => setSelected(toggle(selected, cls.ROWID))}
              />
            </label>
          ))}
          {!result.classes.length && (
            <p className="rounded-xl border border-dashed border-slate-300 p-4 text-center text-sm text-slate-500">
              No open classes fit right now — confirming will add {form.Name} to the waitlist.
            </p>
          )}
        </div>

        <Button className="mt-4 w-full" onClick={confirm}>
          {selected.length === form.sessionsPerWeek ? 'Confirm enrollment' : 'Confirm & join waitlist for the rest'}
        </Button>
      </div>
    );
  }

  return (
    <div className="p-4">
      <h1 className="mb-4 text-lg font-bold">New player intake</h1>
      <form className="mx-auto flex max-w-md flex-col gap-3" onSubmit={findClasses}>
        <Field label="Name">
          <Input required value={form.Name} onChange={(e) => setForm({ ...form, Name: e.target.value })} />
        </Field>
        <Field label="Email">
          <Input type="email" value={form.Email} onChange={(e) => setForm({ ...form, Email: e.target.value })} />
        </Field>
        <Field label="Phone">
          <Input value={form.Phone} onChange={(e) => setForm({ ...form, Phone: e.target.value })} />
        </Field>
        <Field label="Preferred club">
          <Select required value={form.PreferredClubId} onChange={(e) => setForm({ ...form, PreferredClubId: e.target.value })}>
            <option value="">Select club…</option>
            {clubs.map((c) => (
              <option key={c.ROWID} value={c.ROWID}>{c.Name}</option>
            ))}
          </Select>
        </Field>
        <Field label="Level (0-10)">
          <Select value={form.Level} onChange={(e) => setForm({ ...form, Level: e.target.value })}>
            {LEVELS.map((l) => (
              <option key={l} value={l}>{l}</option>
            ))}
          </Select>
        </Field>

        <Field label="Preferred days">
          <div className="flex flex-wrap gap-1">
            {DAY_NAMES.map((d, i) => (
              <button
                type="button"
                key={i}
                onClick={() => setForm({ ...form, days: toggle(form.days, i) })}
                className={`rounded-full px-3 py-1 text-xs font-medium ${
                  form.days.includes(i) ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600'
                }`}
              >
                {d}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Preferred duration">
          <div className="flex gap-1">
            {DURATIONS.map((d) => (
              <button
                type="button"
                key={d}
                onClick={() => setForm({ ...form, durations: toggle(form.durations, d) })}
                className={`rounded-full px-3 py-1 text-xs font-medium ${
                  form.durations.includes(d) ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600'
                }`}
              >
                {d} min
              </button>
            ))}
          </div>
        </Field>

        <div className="flex gap-2">
          <Field label="From">
            <Input type="time" value={form.timeStart} onChange={(e) => setForm({ ...form, timeStart: e.target.value })} />
          </Field>
          <Field label="Until">
            <Input type="time" value={form.timeEnd} onChange={(e) => setForm({ ...form, timeEnd: e.target.value })} />
          </Field>
        </div>

        <Field label="Sessions per week">
          <Select value={form.sessionsPerWeek} onChange={(e) => setForm({ ...form, sessionsPerWeek: Number(e.target.value) })}>
            <option value={1}>1x per week</option>
            <option value={2}>2x per week</option>
          </Select>
        </Field>

        <Button type="submit" disabled={savePlayer.isPending || recommend.isPending}>
          Find best-fit classes
        </Button>
      </form>
    </div>
  );
}
