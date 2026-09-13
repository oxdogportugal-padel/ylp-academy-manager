import { useClubs, useCoaches } from '../api/hooks';
import { useFilterStore } from '../store/filters';
import { Select } from './ui';

const LEVELS = Array.from({ length: 21 }, (_, i) => i / 2); // 0, 0.5, ... 10
const DURATIONS = [60, 90, 120];

export default function FilterBar() {
  const { data: clubs = [] } = useClubs();
  const { data: coaches = [] } = useCoaches();
  const { clubId, coachId, level, durationMinutes, setFilter } = useFilterStore();

  return (
    <div className="flex flex-wrap gap-2 border-b border-slate-200 bg-white p-3">
      <Select
        value={clubId}
        onChange={(e) => setFilter('clubId', e.target.value)}
        aria-label="Club"
        className="min-w-[9rem] flex-1 sm:flex-none"
      >
        <option value="">Select a club…</option>
        {clubs.map((c) => (
          <option key={c.ROWID} value={c.ROWID}>
            {c.Name}
          </option>
        ))}
      </Select>

      <Select value={coachId} onChange={(e) => setFilter('coachId', e.target.value)} aria-label="Coach" disabled={!clubId}>
        <option value="">All coaches</option>
        {coaches.map((c) => (
          <option key={c.ROWID} value={c.ROWID}>
            {c.Name}
          </option>
        ))}
      </Select>

      <Select value={level} onChange={(e) => setFilter('level', e.target.value)} aria-label="Level" disabled={!clubId}>
        <option value="">All levels</option>
        {LEVELS.map((l) => (
          <option key={l} value={l}>
            Level {l}
          </option>
        ))}
      </Select>

      <Select
        value={durationMinutes}
        onChange={(e) => setFilter('durationMinutes', e.target.value)}
        aria-label="Duration"
        disabled={!clubId}
      >
        <option value="">Any duration</option>
        {DURATIONS.map((d) => (
          <option key={d} value={d}>
            {d} min
          </option>
        ))}
      </Select>
    </div>
  );
}
