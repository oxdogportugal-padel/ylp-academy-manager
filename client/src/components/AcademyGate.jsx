import { useEffect, useState } from 'react';
import { useCreateAcademy, useMyAcademies } from '../api/hooks';
import { useAcademyStore } from '../store/academy';
import { Button, Card, Field, Input, Spinner } from './ui';

function CreateAcademyForm({ onCreated }) {
  const [name, setName] = useState('');
  const create = useCreateAcademy();

  return (
    <Card className="mx-auto mt-16 max-w-sm">
      <h1 className="mb-1 text-lg font-bold">Open your padel academy</h1>
      <p className="mb-4 text-sm text-slate-500">
        Each academy is its own private workspace — its clubs, coaches, players and classes are only ever visible to your team.
      </p>
      <form
        className="flex flex-col gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          const academy = await create.mutateAsync({ Name: name });
          onCreated(academy);
        }}
      >
        <Field label="Academy name">
          <Input required autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Lisbon Padel Academy" />
        </Field>
        <Button type="submit" disabled={create.isPending}>Create academy</Button>
      </form>
    </Card>
  );
}

function AcademyPicker({ academies, onSelect }) {
  return (
    <Card className="mx-auto mt-16 max-w-sm">
      <h1 className="mb-4 text-lg font-bold">Choose an academy</h1>
      <div className="flex flex-col gap-2">
        {academies.map((a) => (
          <button
            key={a.ROWID}
            onClick={() => onSelect(a)}
            className="rounded-lg border border-slate-200 p-3 text-left hover:border-brand-400 hover:bg-brand-50"
          >
            <div className="font-medium">{a.Name}</div>
            <div className="text-xs text-slate-500">{a.role}</div>
          </button>
        ))}
      </div>
    </Card>
  );
}

/**
 * Sits above the whole app: makes sure a tenant (Academy) is selected
 * before any club/coach/player/class data loads, and offers onboarding
 * (create) or a switcher (pick) when it isn't.
 */
export default function AcademyGate({ children }) {
  const { data: academies, isLoading } = useMyAcademies();
  const { academyId, setAcademy } = useAcademyStore();

  useEffect(() => {
    if (!isLoading && academies?.length === 1 && !academyId) {
      setAcademy(academies[0]);
    }
  }, [isLoading, academies, academyId, setAcademy]);

  if (isLoading) return <Spinner />;

  if (!academies?.length) {
    return (
      <div className="p-4">
        <CreateAcademyForm onCreated={setAcademy} />
      </div>
    );
  }

  const selected = academies.find((a) => String(a.ROWID) === String(academyId));
  if (!selected) {
    return (
      <div className="p-4">
        <AcademyPicker academies={academies} onSelect={setAcademy} />
      </div>
    );
  }

  return children;
}
