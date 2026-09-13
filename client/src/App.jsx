import { NavLink, Route, Routes } from 'react-router-dom';
import CalendarPage from './pages/CalendarPage';
import ClubsPage from './pages/ClubsPage';
import CoachesPage from './pages/CoachesPage';
import PlayersPage from './pages/PlayersPage';
import IntakePage from './pages/IntakePage';
import AlertsPage from './pages/AlertsPage';
import AcademyGate from './components/AcademyGate';
import AcademySwitcher from './components/AcademySwitcher';

const NAV_ITEMS = [
  { to: '/', label: 'Calendar', icon: '📅', end: true },
  { to: '/intake', label: 'New player', icon: '➕' },
  { to: '/alerts', label: 'Alerts', icon: '🔔' },
  { to: '/clubs', label: 'Clubs', icon: '🏟️' },
  { to: '/coaches', label: 'Coaches', icon: '🎾' },
  { to: '/players', label: 'Players', icon: '🧑' },
];

function NavItem({ to, label, icon, end }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `flex flex-col items-center justify-center gap-0.5 rounded-lg px-2 py-1.5 text-xs font-medium transition-colors sm:flex-row sm:justify-start sm:gap-2 sm:px-3 sm:py-2 sm:text-sm ${
          isActive ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-100'
        }`
      }
    >
      <span className="text-lg sm:text-base">{icon}</span>
      <span>{label}</span>
    </NavLink>
  );
}

export default function App() {
  return (
    <AcademyGate>
      <div className="flex min-h-screen flex-col sm:flex-row">
        {/* Desktop sidebar */}
        <aside className="hidden w-56 shrink-0 border-r border-slate-200 bg-white p-4 sm:block">
          <h1 className="mb-1 px-3 text-lg font-bold text-brand-700">Academy Manager</h1>
          <div className="mb-5">
            <AcademySwitcher />
          </div>
          <nav className="flex flex-col gap-1">
            {NAV_ITEMS.map((item) => (
              <NavItem key={item.to} {...item} />
            ))}
          </nav>
        </aside>

        {/* Mobile top bar */}
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 sm:hidden">
          <h1 className="text-base font-bold text-brand-700">Academy Manager</h1>
          <AcademySwitcher />
        </header>

        <main className="flex-1 overflow-y-auto pb-20 sm:pb-6">
          <Routes>
            <Route path="/" element={<CalendarPage />} />
            <Route path="/intake" element={<IntakePage />} />
            <Route path="/alerts" element={<AlertsPage />} />
            <Route path="/clubs" element={<ClubsPage />} />
            <Route path="/coaches" element={<CoachesPage />} />
            <Route path="/players" element={<PlayersPage />} />
          </Routes>
        </main>

        {/* Mobile bottom nav */}
        <nav className="fixed inset-x-0 bottom-0 z-10 grid grid-cols-6 gap-1 border-t border-slate-200 bg-white p-1.5 sm:hidden">
          {NAV_ITEMS.map((item) => (
            <NavItem key={item.to} {...item} />
          ))}
        </nav>
      </div>
    </AcademyGate>
  );
}
