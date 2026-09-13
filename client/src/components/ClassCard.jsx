import { Badge } from './ui';

function endTime(start, duration) {
  const [h, m] = start.split(':').map(Number);
  const total = h * 60 + m + Number(duration);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

export default function ClassCard({ cls, coachName, onClick }) {
  const full = cls.spotsLeft <= 0;
  return (
    <button
      onClick={onClick}
      className="flex w-full flex-col gap-1 rounded-xl border border-slate-200 bg-white p-3 text-left shadow-sm transition-shadow hover:shadow-md"
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-slate-800">
          {cls.StartTime}–{endTime(cls.StartTime, cls.DurationMinutes)}
        </span>
        <Badge tone={full ? 'red' : 'green'}>{full ? 'Full' : `${cls.spotsLeft} spot${cls.spotsLeft === 1 ? '' : 's'} left`}</Badge>
      </div>
      <div className="text-sm text-slate-600">Coach {coachName || `#${cls.CoachId}`} · Field {cls.FieldNumber}</div>
      <div className="flex gap-2 text-xs text-slate-500">
        <span>Level {cls.Level}</span>
        <span>·</span>
        <span>{cls.DurationMinutes} min</span>
        <span>·</span>
        <span>{cls.enrolledCount}/{cls.Capacity} players</span>
      </div>
    </button>
  );
}
