import { useState } from 'react';
import { useAssignCoachToClub, useClubs, useCoaches, useDeleteCoach, useSaveCoach } from '../api/hooks';
import CrudTable from '../components/CrudTable';
import { Button, Field, Input, Select, Sheet } from '../components/ui';

const empty = { Name: '', Level: 1, Email: '', Phone: '' };

export default function CoachesPage() {
  const { data: coaches = [] } = useCoaches();
  const { data: clubs = [] } = useClubs();
  const save = useSaveCoach();
  const del = useDeleteCoach();
  const assign = useAssignCoachToClub();
  const [editing, setEditing] = useState(null);
  const [assignClub, setAssignClub] = useState('');

  return (
    <div className="p-4">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-bold">Coaches</h1>
        <Button onClick={() => setEditing({ ...empty })}>+ Add coach</Button>
      </div>

      <CrudTable
        columns={[
          { key: 'Name', label: 'Name' },
          { key: 'Level', label: 'Level' },
          { key: 'Email', label: 'Email' },
        ]}
        rows={coaches}
        onEdit={setEditing}
        onDelete={(row) => confirm(`Delete ${row.Name}?`) && del.mutate(row.ROWID)}
      />

      <Sheet open={!!editing} onClose={() => setEditing(null)} title={editing?.ROWID ? 'Edit coach' : 'Add coach'}>
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
            <Field label="Level (1-3)">
              <Select value={editing.Level} onChange={(e) => setEditing({ ...editing, Level: e.target.value })}>
                {[1, 2, 3].map((l) => (
                  <option key={l} value={l}>{l}</option>
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

            {editing.ROWID && (
              <div className="mt-2 border-t border-slate-100 pt-3">
                <Field label="Assign to a club">
                  <div className="flex gap-2">
                    <Select value={assignClub} onChange={(e) => setAssignClub(e.target.value)} className="flex-1">
                      <option value="">Select club…</option>
                      {clubs.map((c) => (
                        <option key={c.ROWID} value={c.ROWID}>{c.Name}</option>
                      ))}
                    </Select>
                    <Button
                      type="button"
                      disabled={!assignClub}
                      onClick={() => {
                        assign.mutate({ clubId: assignClub, coachId: editing.ROWID });
                        setAssignClub('');
                      }}
                    >
                      Assign
                    </Button>
                  </div>
                </Field>
              </div>
            )}
          </form>
        )}
      </Sheet>
    </div>
  );
}
