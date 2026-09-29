import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import LoginModal from '../components/auth/LoginModal';
import { useAuth } from '../context/AuthContext';

export default function HomepageV2() {
  const [isLoginOpen, setIsLoginOpen] = useState(false);
  const [iframeLoaded, setIframeLoaded] = useState(false);
  const { user, role } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const authorizationId = new URLSearchParams(location.search).get('authorization_id');

  useEffect(() => {
    document.title = 'Kryin Ephor — The OS for Modern Schools';
    if (user && role && authorizationId) {
      navigate(`/oauth/consent?authorization_id=${encodeURIComponent(authorizationId)}`, { replace: true });
    }
  }, [authorizationId, navigate, role, user]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data && event.data.type === 'OPEN_LOGIN_MODAL') {
        if (user && role) {
          if (role === 'superadmin') {
            navigate('/super-admin');
          } else {
            navigate('/dashboard');
          }
        } else {
          setIsLoginOpen(true);
        }
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [user, role, navigate]);

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-[#050505]">
      <LoginModal isOpen={isLoginOpen} onClose={() => setIsLoginOpen(false)} />

      {/* Skeleton loader while iframe loads */}
      {!iframeLoaded && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#050505]">
          <div className="flex flex-col items-center gap-4">
            <div className="w-10 h-10 border-2 border-white/20 border-t-emerald-500 rounded-full animate-spin" />
            <span className="text-white/40 text-sm tracking-widest uppercase">Loading</span>
          </div>
        </div>
      )}

      <iframe
        src="/landing/index.html"
        title="Kryin Ephor"
        className="w-full h-full border-none m-0 p-0 overflow-hidden"
        loading="eager"
        onLoad={() => setIframeLoaded(true)}
        style={{ opacity: iframeLoaded ? 1 : 0, transition: 'opacity 0.3s ease' }}
      />
    </div>
  );
}
