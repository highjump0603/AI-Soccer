import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Nav from './components/Nav';
import Footer from './components/Footer';
import Home from './pages/Home';
import MatchDetail from './pages/MatchDetail';
import Admin from './pages/Admin';
import { MatchesProvider } from './lib/MatchesContext';

export default function App() {
  return (
    <MatchesProvider>
      <BrowserRouter>
        <div className="page">
          <Nav />
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/match/:id" element={<MatchDetail />} />
            <Route path="/admin" element={<Admin />} />
          </Routes>
          <Footer />
        </div>
      </BrowserRouter>
    </MatchesProvider>
  );
}
