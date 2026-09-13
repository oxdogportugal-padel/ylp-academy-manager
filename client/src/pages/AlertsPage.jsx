import { useState } from 'react';
import { useAlerts, useClubs, useCoaches, useConvertAlert, useDismissAlert } from '../api/hooks';
import { DAY_NAMES } from '../store/filters';
import { Badge, Button, Card, EmptyState, Field, Input, Select } from '../components/ui';

function AlertCard({ alert, clubName }) {
  const { data: coaches = [] } = useCoaches();
  const convert = useConvertAlert();
  const dismiss = useDismissAlert();
  const [form, setForm] = useState({ CoachId: '', FieldNumber: 1, Capacity: 4 });

  const matchCount = (alert.MatchingRequestIds || '').split(',').filter(Boolean).length;

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold">{clubName} · Level {alert.Level}</h3>
          <p className="text-sm text-slate-500">
            Suggested: {DAY_NAMES[alert.SuggestedDayOfWeek]} {alert.SuggestedTimeStart} · {alert.SuggestedDurationMinutes} min
          </p>
        </div>
        <Badge tone="amber">{matchCount} players waiting</Badge>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <Field label="Coach">
          <Select value={form.CoachId} onChange={(e) => setForm({ ...form, CoachId: e.target.value })}>
            <option value="">Select coach…</option>
            {coaches.map((c) => (
              <option key={c.ROWID} value={c.ROWID}>{c.Name}</option>
            ))}
          </Select>
        </Field>
        <Field label="Field #">
          <Input type="number" min={1} className="w-20" value={form.FieldNumber} onChange={(e) => setForm({ ...form, FieldNumber: e.target.value })} />
        </Field>
        <Field label="Capacity">
          <Input type="number" min={2} className="w-20" value={form.Capacity} onChange={(e) => setForm({ ...form, Capacity: e.target.value })} />
        </Field>
        <Button disabled={!form.CoachId} onClick={() => convert.mutate({ ROWID: alert.ROWID, ...form })}>
          Open this class
        </Button>
        <Button variant="secondary" onClick={() => dismiss.mutate(alert.ROWID)}>
          Dismiss
        </Button>
      </div>
    </Card>
  );
}

export default function AlertsPage() {
  const { data: alerts = [] } = useAlerts();
  const { data: clubs = [] } = useClubs();
  const clubName = (id) => clubs.find((c) => String(c.ROWID) === String(id))?.Name || `Club #${id}`;

  return (
    <div className="p-4">
      <h1 className="mb-1 text-lg font-bold">Class opening alerts</h1>
      <p className="mb-4 text-sm text-slate-500">
        Two or more waitlisted players share a club, level, and day — enough to open a new class.
      </p>

      {!alerts.length ? (
        <EmptyState title="No alerts right now" hint="Alerts appear automatically once enough players are waiting on the same slot." />
      ) : (
        <div className="flex flex-col gap-3">
          {alerts.map((a) => (
            <AlertCard key={a.ROWID} alert={a} clubName={clubName(a.ClubId)} />
          ))}
        </div>
      )}
    </div>
  );
}
