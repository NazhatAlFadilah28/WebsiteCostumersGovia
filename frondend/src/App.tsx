import { useEffect, useState } from 'react';
import LandingPage from './pages/Ladingpage';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import Dashboard from './pages/Dashboard';
import SearchPage from './pages/SearchPage';
import SeatsPage from './pages/SeatsPage';
import PaymentPage from './pages/PaymentPage';
import { TicketPage } from './pages/TicketPage';
import { ChatbotPage } from './pages/ChatbotPage';
import Pesanan from './pages/Pesanan';
import Jadwal from './pages/Jadwal';
import PickupPage from './pages/PickupPage';
import GoogleCallback from './pages/GoogleCallback';
import SettingsModal from './components/SettingsModal';
import { OPEN_SETTINGS_EVENT, applyTheme, getSavedTheme } from './utils/userSettings';

type ScreenPage =
  | 'landing'
  | 'login'
  | 'register'
  | 'dashboard'
  | 'search'
  | 'seats'
  | 'payment'
  | 'ticket'
  | 'chatbot'
  | 'pesanan'
  | 'jadwal'
  | 'pickup'
  | 'google-callback';

export default function App() {
  // Alur pertama customer selalu dimulai dari Landing Page (Langkah 1), kecuali Google OAuth callback
  const [currentPage, setCurrentPage] = useState<ScreenPage>(() => {
    if (typeof window !== 'undefined') {
      const path = window.location.pathname;
      const search = window.location.search;
      if (
        path.startsWith('/auth/google/callback') ||
        ((search.includes('code=') || search.includes('error=')) &&
          sessionStorage.getItem('google_oauth_pending') === '1')
      ) {
        return 'google-callback';
      }
    }
    return 'landing';
  });

  const [selectedScheduleId, setSelectedScheduleId] = useState<string>('');
  const [activeBookingCode, setActiveBookingCode] = useState<string>('');
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    applyTheme(getSavedTheme());
    const handleOpen = () => setSettingsOpen(true);
    const handleStorage = () => applyTheme(getSavedTheme());
    window.addEventListener(OPEN_SETTINGS_EVENT, handleOpen);
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener(OPEN_SETTINGS_EVENT, handleOpen);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);
  const [pickupFocusBookingCode, setPickupFocusBookingCode] = useState<string>('');

  const handleNavigate = (page: string, params?: { scheduleId?: string; bookingCode?: string }) => {
    if (params?.scheduleId) {
      setSelectedScheduleId(params.scheduleId);
    }
    if (params?.bookingCode) {
      setActiveBookingCode(params.bookingCode);
    }
    if (page === 'pickup') {
      setPickupFocusBookingCode(params?.bookingCode || '');
    }
    setCurrentPage(page as ScreenPage);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <>
      {currentPage === 'landing'   && <LandingPage onNavigate={handleNavigate} />}
      {currentPage === 'login'     && <LoginPage    onNavigate={handleNavigate} />}
      {currentPage === 'register'  && <RegisterPage onNavigate={handleNavigate} />}
      {currentPage === 'dashboard' && <Dashboard    onNavigate={handleNavigate} />}
      {currentPage === 'search'    && <SearchPage   onNavigate={handleNavigate} />}
      {currentPage === 'seats'     && <SeatsPage    scheduleId={selectedScheduleId} onNavigate={handleNavigate} />}
      {currentPage === 'payment'   && <PaymentPage  bookingCode={activeBookingCode} onNavigate={handleNavigate} />}
      {currentPage === 'ticket'    && <TicketPage   bookingCode={activeBookingCode} onNavigate={handleNavigate} />}
      {currentPage === 'chatbot'   && <ChatbotPage  onNavigate={handleNavigate} />}
      {currentPage === 'pesanan'   && <Pesanan      onNavigate={handleNavigate} />}
      {currentPage === 'jadwal'    && <Jadwal       onNavigate={handleNavigate} />}
      {currentPage === 'pickup'    && (
        <PickupPage
          scheduleId={selectedScheduleId}
          bookingCode={pickupFocusBookingCode}
          onNavigate={handleNavigate}
        />
      )}
      {currentPage === 'google-callback' && <GoogleCallback onNavigate={handleNavigate} />}
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </>
  );
}
