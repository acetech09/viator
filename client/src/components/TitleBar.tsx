import { NavLink, useLocation } from 'react-router-dom';
import logoUrl from '../assets/logo.png';

export function TitleBar() {
  const loc = useLocation();
  const onLists = loc.pathname.startsWith('/lists');
  const onSettings = loc.pathname.startsWith('/settings');

  return (
    <div className="titlebar">
      <img className="logo" src={logoUrl} alt="Viator" />
      <span className="brand">VIATOR</span>
      <NavLink to="/lists" className={`tab ${onLists ? 'active' : ''}`}>
        List creator
      </NavLink>
      <NavLink to="/settings" className={`tab ${onSettings ? 'active' : ''}`}>
        Settings
      </NavLink>
      <span className="spacer" />
    </div>
  );
}
