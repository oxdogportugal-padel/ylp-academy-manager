import { useMemo, useState } from 'react';
import { addDays, format, startOfWeek } from 'date-fns';
import FilterBar from '../components/FilterBar';
import ClassCard from '../components/ClassCard';
import ClassDetailSheet from '../components/ClassDetailSheet';
import ClassFormSheet from '../components/ClassFormSheet';
import { useClasses, useCoaches } from '../api/hooks';
import { useFilterStore, DAY_NAMES } from '../store/filters';
import { Button, EmptyState, Spinner } from '../components/ui';

export default function CalendarPage() {
  const { clubId, coachId, level, durationMinutes } = useFilterStore();
  const { data: classes = [], isLoading } = useClasses({ clubId, coachId, level, durationMinutes });
  const { data: coaches = [] } = useCoaches();
  const [activeClassId, setActiveClassId] = useState(null);
  const [mobileDay, setMobileDay] = useState(new Date().getDay());
  const [showAddClass, setShowAddClass] = useState(false);

  const coachNameById = useMemo(() => Object.fromEntries(coaches.map((c) => [String(c.ROWID), c.Name])), [coaches]);

  const weekDates = useMemo(() => {
    const start = startOfWeek(new Date());
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  }, []);

  const classesByDay = useMemo(() => {
    const map = Array.from({ length: 7 }, () => []);
    classes.forEach((c) => map[Number(c.DayOfWeek)].push(c));
    map.forEach((day) => day.sort((a, b) => a.StartTime.localeCompare(b.StartTime)));
    return map;
  }, [classes]);

  return (
    <div className="flex h-full flex-col">
      <FilterBar />

      {!clubId ? (
        <div className="p-4">
          <EmptyState title="Pick a club to see its schedule" hint="The calendar is filtered by club first, then by coach, level or duration." />
        </div>
      ) : isLoading ? (
        <Spinner />
      ) : (
        <>
          <div className="flex justify-end px-4 pt-3 sm:px-4">
            <Button onClick={() => setShowAddClass(true)}>+ Add class</Button>
          </div>

          {/* Desktop: week grid */}
          <div className="hidden flex-1 grid-cols-7 gap-3 overflow-y-auto p-4 sm:grid">
            {weekDates.map((date, i) => (
              <div key={i} className="flex flex-col gap-2">
                <div className="sticky top-0 rounded-lg bg-slate-100 px-2 py-1 text-center text-xs font-semibold text-slate-600">
                  {DAY_NAMES[i]} <span className="font-normal text-slate-400">{format(date, 'd MMM')}</span>
                </div>
                <div className="flex flex-col gap-2">
                  {classesByDay[i].map((cls) => (
                    <ClassCard
                      key={cls.ROWID}
                      cls={cls}
                      coachName={coachNameById[String(cls.CoachId)]}
                      onClick={() => setActiveClassId(cls.ROWID)}
                    />
                  ))}
                  {!classesByDay[i].length && <p className="px-1 text-xs text-slate-300">No classes</p>}
                </div>
              </div>
            ))}
          </div>

          {/* Mobile: single-day agenda */}
          <div className="flex flex-col gap-3 p-3 sm:hidden">
            <div className="flex justify-between gap-1">
              {weekDates.map((date, i) => (
                <button
                  key={i}
                  onClick={() => setMobileDay(i)}
                  className={`flex flex-1 flex-col items-center rounded-lg py-2 text-xs font-medium ${
                    mobileDay === i ? 'bg-brand-600 text-white' : 'bg-white text-slate-600'
                  }`}
                >
                  <span>{DAY_NAMES[i]}</span>
                  <span className="text-[10px] opacity-80">{format(date, 'd')}</span>
                </button>
              ))}
            </div>

            <div className="flex flex-col gap-2">
              {classesByDay[mobileDay].map((cls) => (
                <ClassCard
                  key={cls.ROWID}
                  cls={cls}
                  coachName={coachNameById[String(cls.CoachId)]}
                  onClick={() => setActiveClassId(cls.ROWID)}
                />
              ))}
              {!classesByDay[mobileDay].length && <EmptyState title="No classes this day" />}
            </div>
          </div>
        </>
      )}

      <ClassDetailSheet classId={activeClassId} onClose={() => setActiveClassId(null)} />
      <ClassFormSheet open={showAddClass} onClose={() => setShowAddClass(false)} clubId={clubId} />
    </div>
  );
}
