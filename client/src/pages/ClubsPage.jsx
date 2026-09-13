import { useState } from 'react';
import { useClubs, useDeleteClub, useSaveClub } from '../api/hooks';
import CrudTable from '../components/CrudTable';
import { Button, Field, Input, Sheet } from '../components/ui';

const empty = { Name: '', NumberOfFields: 4, Address: '', Phone: '' };

export default function ClubsPage() {
  const { data: clubs = [] } = useClubs();
  const save = useSaveClub();
  const del = useDeleteClub();
  const [editing, setEditing] = useState(null);

  return (
    <div className="p-4">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-bold">Clubs</h1>
        <Button onClick={() => setEditing({ ...empty })}>+ Add club</Button>
      </div>

      <CrudTable
        columns={[
          { key: 'Name', label: 'Name' },
          { key: 'NumberOfFields', label: 'Fields' },
          { key: 'Address', label: 'Address' },
        ]}
        rows={clubs}
        onEdit={setEditing}
        onDelete={(row) => confirm(`Delete ${row.Name}?`) && del.mutate(row.ROWID)}
      />

      <Sheet open={!!editing} onClose={() => setEditing(null)} title={editing?.ROWID ? 'Edit club' : 'Add club'}>
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
            <Field label="Number of fields">
              <Input
                type="number"
                min={1}
                required
                value={editing.NumberOfFields}
                onChange={(e) => setEditing({ ...editing, NumberOfFields: e.target.value })}
              />
            </Field>
            <Field label="Address (optional)">
              <Input value={editing.Address} onChange={(e) => setEditing({ ...editing, Address: e.target.value })} />
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
