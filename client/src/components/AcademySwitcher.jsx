import { useMyAcademies } from '../api/hooks';
import { useAcademyStore } from '../store/academy';

export default function AcademySwitcher() {
  const { data: academies = [] } = useMyAcademies();
  const { academyName, setAcademy } = useAcademyStore();

  if (academies.length <= 1) {
    return <p className="truncate px-3 text-xs font-medium text-slate-400">{academyName}</p>;
  }

  return (
    <button
      onClick={() => setAcademy(null)}
      className="flex w-full items-center justify-between rounded-lg px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-100"
      title="Switch academy"
    >
      <span className="truncate font-medium">{academyName}</span>
      <span className="shrink-0 text-brand-600">Switch</span>
    </button>
  );
}
