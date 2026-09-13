import { useState } from 'react';
import { useClass, useDeleteClass, useEnrollPlayer, usePlayers, useUnenrollPlayer } from '../api/hooks';
import { Badge, Button, Select, Sheet, Spinner } from './ui';

export default function ClassDetailSheet({ classId, onClose }) {
  const { data: cls, isLoading } = useClass(classId);
  const { data: players = [] } = usePlayers();
  const enroll = useEnrollPlayer();
  const unenroll = useUnenrollPlayer();
  const del = useDeleteClass();
  const [selectedPlayer, setSelectedPlayer] = useState('');

  const enrolledIds = new Set((cls?.players || []).map((p) => p.ROWID));
  const availablePlayers = players.filter((p) => !enrolledIds.has(p.ROWID));

  return (
    <Sheet open={!!classId} onClose={onClose} title="Class details">
      {isLoading || !cls ? (
        <Spinner />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-2 text-sm text-slate-600">
            <Badge>{cls.StartTime}</Badge>
            <Badge>{cls.DurationMinutes} min</Badge>
            <Badge>Level {cls.Level}</Badge>
            <Badge>Field {cls.FieldNumber}</Badge>
          </div>

          <div>
            <h3 className="mb-2 text-sm font-semibold text-slate-700">Players ({cls.players?.length || 0}/{cls.Capacity})</h3>
            <ul className="flex flex-col gap-1">
              {(cls.players || []).map((p) => (
                <li key={p.ROWID} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm">
                  <span>{p.Name} <span className="text-slate-400">· L{p.Level}</span></span>
                  <button
                    className="text-xs font-medium text-red-600 hover:underline"
                    onClick={() => unenroll.mutate({ classId: cls.ROWID, playerId: p.ROWID })}
                  >
                    Remove
                  </button>
                </li>
              ))}
              {!cls.players?.length && <li className="text-sm text-slate-400">No players enrolled yet.</li>}
            </ul>
          </div>

          {(cls.players?.length || 0) < cls.Capacity && (
            <div className="flex gap-2">
              <Select value={selectedPlayer} onChange={(e) => setSelectedPlayer(e.target.value)} className="flex-1">
                <option value="">Add a player…</option>
                {availablePlayers.map((p) => (
                  <option key={p.ROWID} value={p.ROWID}>
                    {p.Name} (L{p.Level})
                  </option>
                ))}
              </Select>
              <Button
                disabled={!selectedPlayer}
                onClick={() => {
                  enroll.mutate({ classId: cls.ROWID, playerId: selectedPlayer });
                  setSelectedPlayer('');
                }}
              >
                Enroll
              </Button>
            </div>
          )}

          <Button
            variant="danger"
            onClick={() => {
              if (confirm('Cancel this class?')) {
                del.mutate(cls.ROWID);
                onClose();
              }
            }}
          >
            Cancel class
          </Button>
        </div>
      )}
    </Sheet>
  );
}
