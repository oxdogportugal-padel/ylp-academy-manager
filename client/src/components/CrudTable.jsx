import { Button } from './ui';

/**
 * Generic mobile-friendly list: a card per row on phones, a table on desktop.
 * columns: [{ key, label, render?(row) }]
 */
export default function CrudTable({ columns, rows, onEdit, onDelete, keyField = 'ROWID' }) {
  if (!rows.length) {
    return <p className="p-4 text-center text-sm text-slate-400">Nothing here yet.</p>;
  }

  return (
    <>
      {/* Desktop table */}
      <table className="hidden w-full text-left text-sm sm:table">
        <thead>
          <tr className="border-b border-slate-200 text-slate-500">
            {columns.map((c) => (
              <th key={c.key} className="px-3 py-2 font-medium">{c.label}</th>
            ))}
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row[keyField]} className="border-b border-slate-100 hover:bg-slate-50">
              {columns.map((c) => (
                <td key={c.key} className="px-3 py-2">{c.render ? c.render(row) : row[c.key]}</td>
              ))}
              <td className="flex justify-end gap-2 px-3 py-2">
                <Button variant="secondary" onClick={() => onEdit(row)}>Edit</Button>
                <Button variant="danger" onClick={() => onDelete(row)}>Delete</Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Mobile cards */}
      <div className="flex flex-col gap-2 sm:hidden">
        {rows.map((row) => (
          <div key={row[keyField]} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
            {columns.map((c) => (
              <div key={c.key} className="flex justify-between py-0.5 text-sm">
                <span className="text-slate-500">{c.label}</span>
                <span className="font-medium">{c.render ? c.render(row) : row[c.key]}</span>
              </div>
            ))}
            <div className="mt-2 flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={() => onEdit(row)}>Edit</Button>
              <Button variant="danger" className="flex-1" onClick={() => onDelete(row)}>Delete</Button>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
