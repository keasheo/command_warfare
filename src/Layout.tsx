import { NavLink, Outlet } from 'react-router-dom'

const links = [
  ['/', 'Dashboard'],
  ['/cards', 'Cards'],
  ['/abilities', 'Abilities'],
  ['/races', 'Races'],
  ['/design-bible', 'Design Bible'],
  ['/rules', 'Rules'],
] as const

export function Layout() {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <h1>Command Warfare</h1>
          <p>Design kit</p>
        </div>
        {links.map(([to, label]) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
          >
            {label}
          </NavLink>
        ))}
      </aside>
      <main className="main">
        <Outlet />
      </main>
    </div>
  )
}
