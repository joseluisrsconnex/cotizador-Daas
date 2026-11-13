import { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import QuotePage from '@/pages/quote';
import AdminPage from '@/pages/admin';
import BrandLogo from '@/components/brand-logo';
import AuthProvider from '@/components/auth-provider';
import { AppSessionProvider, useAppSession } from '@/hooks/use-app-session';
import LandingPage from '@/pages/landing';
import { SignInPage, SignUpPage } from '@/pages/auth';
import HistoryPage from '@/pages/history';
import SavedQuotePage from '@/pages/saved-quote';
import UsersPage from '@/pages/users';
import { BLOCKED_MESSAGE, ROLE_LABELS, apiErrorMessage } from '@/lib/api-errors';
import { useClerk } from '@clerk/react';
import { Link } from 'wouter';
import {
  Route,
  Switch,
  useLocation,
  Router as WouterRouter,
  Redirect,
} from 'wouter';

const queryClient = new QueryClient();

function AppShell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const { user } = useAppSession();
  const { signOut } = useClerk();
  return <div className="app-frame">
    <aside className="sidebar">
      <Link href="/cotizador" className="brand-lockup" aria-label="Novotechno · Cotizador DaaS — Inicio"><BrandLogo variant="white" className="sidebar-logo" /><span className="brand-type">Novotechno</span></Link>
      <div className="sidebar-rule" />
      <div className="nav-label">ESPACIO DE TRABAJO</div>
      <nav className="side-nav">
        <Link href="/cotizador" className={`nav-item ${location === '/cotizador' ? 'active' : ''}`}><span className="nav-square" />Cotizador<span className="nav-arrow">↗</span></Link>
        <Link href="/cotizaciones" className={`nav-item ${location.startsWith('/cotizaciones') ? 'active' : ''}`}><span className="nav-square" />Cotizaciones<span className="nav-arrow">↗</span></Link>
        {user?.role === "admin" && <Link href="/admin" className={`nav-item ${location === '/admin' ? 'active' : ''}`}><span className="nav-square nav-settings" />Parámetros<span className="nav-arrow">↗</span></Link>}
        {user?.role === "admin" && <Link href="/usuarios" className={`nav-item ${location.startsWith('/usuarios') ? 'active' : ''}`} data-testid="link-nav-users"><span className="nav-square" />Usuarios<span className="nav-arrow">↗</span></Link>}
      </nav>
      <div className="sidebar-bottom"><div className="sidebar-status"><i /> MOTOR DE PRECIOS ACTIVO</div><div className="sidebar-version"><span>Novotechno</span><span>v1.0</span></div></div>
    </aside>
    <div className="app-main"><header className="topbar"><div className="breadcrumb">NOVOTECHNO <span>/</span> {location === '/admin' ? 'PARÁMETROS' : location.startsWith('/usuarios') ? 'USUARIOS' : location.startsWith('/cotizaciones') ? 'HISTORIAL' : 'COTIZADOR'}</div><div className="topbar-right"><span className="account-label"><strong>{user?.name}</strong><small>{user ? ROLE_LABELS[user.role] ?? user.role : ""}</small></span><button className="button logout-button" onClick={() => void signOut({ redirectUrl: import.meta.env.BASE_URL })}>Salir</button></div></header>{children}<footer className="app-footer"><span>Novotechno</span><span>Equipos al ritmo de su negocio.</span></footer></div>
  </div>;
}

function Protected({ children, admin = false }: { children: ReactNode; admin?: boolean }) {
  const session = useAppSession();
  if (session.isLoading) return <main className="page-wrap"><div className="skeleton-heading" /></main>;
  if (!session.signedIn) return <Redirect to="/sign-in" />;
  if (session.blocked) return <BlockedNotice />;
  if (session.error || !session.user) return <main className="page-wrap"><section className="notice error"><h1>No se pudo verificar su cuenta</h1><p>{apiErrorMessage(session.error, "Verifique su correo e inténtelo de nuevo.")}</p><button className="button primary" onClick={session.retry}>Reintentar</button></section></main>;
  if (admin && session.user.role !== "admin") return <AppShell><main className="page-wrap"><section className="notice error"><h1>Acceso restringido</h1><p>Solo un administrador puede acceder a esta sección.</p><Link href="/cotizador" className="button primary">Volver al cotizador</Link></section></main></AppShell>;
  return <AppShell key={`${session.user.id}:${session.user.role}`}>{children}</AppShell>;
}
function BlockedNotice() {
  const { signOut } = useClerk();
  return <main className="page-wrap"><section className="notice error" role="alert" data-testid="state-blocked"><h1>Acceso desactivado</h1><p>{BLOCKED_MESSAGE}</p><button className="button primary" onClick={() => void signOut({ redirectUrl: import.meta.env.BASE_URL })} data-testid="button-blocked-signout">Salir</button></section></main>;
}
function Home() {
  const session = useAppSession();
  return session.signedIn ? <Redirect to="/cotizador" /> : <LandingPage />;
}
function Router() {
  return (
    // Keep a shared shell (sidebar, navbar) outside the boundary so it
    // survives a page crash.
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/sign-in/*?" component={SignInPage} />
        <Route path="/sign-up/*?" component={SignUpPage} />
        <Route path="/cotizador">{() => <Protected><QuotePage /></Protected>}</Route>
        <Route path="/cotizaciones">{() => <Protected><HistoryPage /></Protected>}</Route>
        <Route path="/cotizaciones/:id/versiones/:versionId">{params => <Protected><SavedQuotePage id={params.id} versionId={params.versionId} /></Protected>}</Route>
        <Route path="/cotizaciones/:id">{params => <Protected><SavedQuotePage id={params.id} /></Protected>}</Route>
        <Route path="/usuarios">{() => <Protected admin><UsersPage /></Protected>}</Route>
        <Route path="/admin">{() => <Protected admin><AdminPage /></Protected>}</Route>
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <AuthProvider><AppSessionProvider><Router /></AppSessionProvider></AuthProvider>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
