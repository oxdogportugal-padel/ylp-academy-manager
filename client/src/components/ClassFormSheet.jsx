import { useState } from 'react';
import { useCoaches, useSaveClass } from '../api/hooks';
import { DAY_NAMES_LONG } from '../store/filters';
import { Button, Field, Input, Select, Sheet } from './ui';

const DURATIONS = [60, 90, 120];
const LEVELS = Array.from({ length: 21 }, (_, i) => i / 2);

export default function ClassFormSheet({ open, onClose, clubId }) {
  const { data: coaches = [] } = useCoaches();
  const save = useSaveClass();
  const [form, setForm] = useState(null);

  const state = form || {
    ClubId: clubId,
    CoachId: '',
    FieldNumber: 1,
    DayOfWeek: 1,
    StartTime: '18:00',
    DurationMinutes: 60,
    Level: 3,
    Capacity: 4,
  };

  return (
    <Sheet open={open} onClose={onClose} title="Add class">
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate({ ...state, ClubId: clubId }, { onSuccess: () => { setForm(null); onClose(); } });
        }}
      >
        <Field label="Coach">
          <Select required value={state.CoachId} onChange={(e) => setForm({ ...state, CoachId: e.target.value })}>
            <option value="">Select coach…</option>
            {coaches.map((c) => (
              <option key={c.ROWID} value={c.ROWID}>{c.Name}</option>
            ))}
          </Select>
        </Field>
        <Field label="Field number">
          <Input type="number" min={1} required value={state.FieldNumber} onChange={(e) => setForm({ ...state, FieldNumber: e.target.value })} />
        </Field>
        <Field label="Day of week">
          <Select value={state.DayOfWeek} onChange={(e) => setForm({ ...state, DayOfWeek: e.target.value })}>
            {DAY_NAMES_LONG.map((d, i) => (
              <option key={i} value={i}>{d}</option>
            ))}
          </Select>
        </Field>
        <Field label="Start time">
          <Input type="time" required value={state.StartTime} onChange={(e) => setForm({ ...state, StartTime: e.target.value })} />
        </Field>
        <Field label="Duration">
          <Select value={state.DurationMinutes} onChange={(e) => setForm({ ...state, DurationMinutes: e.target.value })}>
            {DURATIONS.map((d) => (
              <option key={d} value={d}>{d} min</option>
            ))}
          </Select>
        </Field>
        <Field label="Level (0-10)">
          <Select value={state.Level} onChange={(e) => setForm({ ...state, Level: e.target.value })}>
            {LEVELS.map((l) => (
              <option key={l} value={l}>{l}</option>
            ))}
          </Select>
        </Field>
        <Field label="Capacity">
          <Input type="number" min={1} value={state.Capacity} onChange={(e) => setForm({ ...state, Capacity: e.target.value })} />
        </Field>
        <Button type="submit">Create class</Button>
      </form>
    </Sheet>
  );
}
