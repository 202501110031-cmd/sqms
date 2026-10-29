import React, { useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { AuthProvider, useAuth, roleHome } from './context/AuthContext';
import { LanguageProvider } from './context/LanguageContext';
import { ToastProvider } from './context/ToastContext';
import StaffLayout from './components/StaffLayout';
import { LoadingBlock } from './components/UI';
import HomePage from './pages/HomePage';
import BookPage from './pages/BookPage';
import TrackPage from './pages/TrackPage';
import DisplayPage from './pages/DisplayPage';
import LoginPage from './pages/LoginPage';
import DoctorQueuePage from './pages/DoctorQueuePage';
import FrontDeskPage from './pages/FrontDeskPage';
import AnalyticsPage from './pages/AnalyticsPage';
import TeamPage from './pages/TeamPage';
import AllQueuesPage from './pages/AllQueuesPage';

function ScrollToTop() {
  const location = useLocation();
  useEffect(() => {
    if (!location.hash) window.scrollTo({ top: 0, behavior: 'instant' });
  }, [location.pathname, location.hash]);
  return null;
}

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) {
    return <div className="route-loading"><LoadingBlock label="Checking your access…" /></div>;
  }
  if (!user) return <Navigate to="/staff/login" state={{ from: location.pathname }} replace />;
  return children;
}

function RoleRoute({ roles, children }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/staff/login" replace />;
  if (!roles.includes(user.role)) return <Navigate to={roleHome(user.role)} replace />;
  return children;
}

function StaffHomeRedirect() {
  const { user } = useAuth();
  return <Navigate to={roleHome(user?.role)} replace />;
}

function NotFoundPage() {
  const navigate = useNavigate();
  return (
    <div className="not-found-page">
      <div>
        <span className="not-found-code">404</span>
        <h1>This page has left the queue.</h1>
        <p>The link may be outdated, or you may not have access to this area.</p>
        <button className="btn btn-primary" onClick={() => navigate('/')}>Back to patient portal</button>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <LanguageProvider>
        <ToastProvider>
          <BrowserRouter>
            <ScrollToTop />
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/book" element={<BookPage />} />
              <Route path="/track" element={<TrackPage />} />
              <Route path="/track/:code" element={<TrackPage />} />
              <Route path="/display" element={<DisplayPage />} />
              <Route path="/staff/login" element={<LoginPage />} />
              <Route
                path="/staff"
                element={(
                  <ProtectedRoute>
                    <StaffLayout />
                  </ProtectedRoute>
                )}
              >
                <Route index element={<StaffHomeRedirect />} />
                <Route path="analytics" element={<RoleRoute roles={['admin']}><AnalyticsPage /></RoleRoute>} />
                <Route path="queues" element={<RoleRoute roles={['admin', 'nurse', 'receptionist']}><AllQueuesPage /></RoleRoute>} />
                <Route path="frontdesk" element={<RoleRoute roles={['admin', 'nurse', 'receptionist']}><FrontDeskPage /></RoleRoute>} />
                <Route path="queue" element={<RoleRoute roles={['admin', 'doctor']}><DoctorQueuePage /></RoleRoute>} />
                <Route path="team" element={<RoleRoute roles={['admin']}><TeamPage /></RoleRoute>} />
              </Route>
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </BrowserRouter>
        </ToastProvider>
      </LanguageProvider>
    </AuthProvider>
  );
}
