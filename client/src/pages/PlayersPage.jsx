import { useState } from 'react';
import { useClubs, useDeletePlayer, usePlayers, useSavePlayer } from '../api/hooks';
import CrudTable from '../components/CrudTable';
import { Badge, Button, Field, Input, Select, Sheet } from '../components/ui';

const empty = { Name: '', Level: 3, Email: '', Phone: '', PreferredClubId: '' };
const LEVELS = Array.from({ length: 21 }, (_, i) => i / 2);

export default function PlayersPage() {
  const { data: players = [] } = usePlayers();
  const { data: clubs = [] } = useClubs();
  const save = useSavePlayer();
  const del = useDeletePlayer();
  const [editing, setEditing] = useState(null);

  const clubName = (id) => clubs.find((c) => String(c.ROWID) === String(id))?.Name || '—';

  return (
    <div className="p-4">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-bold">Players</h1>
        <Button onClick={() => setEditing({ ...empty })}>+ Add player</Button>
      </div>

      <CrudTable
        columns={[
          { key: 'Name', label: 'Name' },
          { key: 'Level', label: 'Level' },
          { key: 'PreferredClubId', label: 'Preferred club', render: (r) => clubName(r.PreferredClubId) },
          { key: 'Status', label: 'Status', render: (r) => <Badge tone={r.Status === 'ACTIVE' ? 'green' : 'amber'}>{r.Status}</Badge> },
        ]}
        rows={players}
        onEdit={setEditing}
        onDelete={(row) => confirm(`Delete ${row.Name}?`) && del.mutate(row.ROWID)}
      />

      <Sheet open={!!editing} onClose={() => setEditing(null)} title={editing?.ROWID ? 'Edit player' : 'Add player'}>
        {editing && (
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate(editing, { onSuccess: () => setEditing(null) });
            }}
          >
            <Field label="Name">
              <Input required value={editing.Name} onChange={(e) => setEditing({ ...editing, Name: e.target.value })} />
            </Field>
            <Field label="Level (0-10)">
              <Select value={editing.Level} onChange={(e) => setEditing({ ...editing, Level: e.target.value })}>
                {LEVELS.map((l) => (
                  <option key={l} value={l}>{l}</option>
                ))}
              </Select>
            </Field>
            <Field label="Preferred club">
              <Select
                required
                value={editing.PreferredClubId}
                onChange={(e) => setEditing({ ...editing, PreferredClubId: e.target.value })}
              >
                <option value="">Select club…</option>
                {clubs.map((c) => (
                  <option key={c.ROWID} value={c.ROWID}>{c.Name}</option>
                ))}
              </Select>
            </Field>
            <Field label="Email (optional)">
              <Input value={editing.Email} onChange={(e) => setEditing({ ...editing, Email: e.target.value })} />
            </Field>
            <Field label="Phone (optional)">
              <Input value={editing.Phone} onChange={(e) => setEditing({ ...editing, Phone: e.target.value })} />
            </Field>
            <Button type="submit">Save</Button>
          </form>
        )}
      </Sheet>
    </div>
  );
}
