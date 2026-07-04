import { Link, useLocation, useNavigate } from 'react-router-dom';

export default function Nav() {
  const location = useLocation();
  const navigate = useNavigate();
  const isAdmin = location.pathname.startsWith('/admin');
  const isHome = !isAdmin;

  function goDashboard(e) {
    e.preventDefault();
    if (location.pathname === '/') {
      document.getElementById('dashboard')?.scrollIntoView({ behavior: 'smooth' });
    } else {
      navigate('/');
      requestAnimationFrame(() => {
        document.getElementById('dashboard')?.scrollIntoView();
      });
    }
  }

  return (
    <nav className="nav">
      <div className="nav-inner">
        <Link className="logo" to="/" onClick={() => window.scrollTo(0, 0)}>
          MATCH<span>AI</span>
        </Link>
        <div className="navlinks">
          <Link className={`navlink ${isHome ? 'active' : ''}`} to="/" onClick={() => window.scrollTo(0, 0)}>
            홈
          </Link>
          <button className="navlink" onClick={goDashboard}>
            예측 대시보드
          </button>
          <Link className={`navlink ${isAdmin ? 'active' : ''}`} to="/admin" onClick={() => window.scrollTo(0, 0)}>
            관리자
          </Link>
        </div>
      </div>
    </nav>
  );
}
