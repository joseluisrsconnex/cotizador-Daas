import { Link } from "wouter";
import BrandLogo from "@/components/brand-logo";
import "@/history-auth.css";

export default function LandingPage() {
  return (
    <div className="nt-page">
      <header className="nt-nav">
        <BrandLogo variant="white" />
        <div className="nt-actions">
          <Link href="/sign-in" className="nt-btn ghost" data-testid="link-sign-in">Iniciar sesión</Link>
          <Link href="/sign-up" className="nt-btn" data-testid="link-sign-up">Crear cuenta</Link>
        </div>
      </header>
      <section className="nt-hero">
        <div>
          <span className="nt-kicker">COTIZADOR DAAS</span>
          <h1>Equipos al ritmo de su negocio.</h1>
          <p>Calcule el canon mensual por referencia, exporte la propuesta y conserve un historial de versiones de cada cotización.</p>
          <div className="nt-actions">
            <Link href="/sign-up" className="nt-btn" data-testid="link-hero-sign-up">Comenzar</Link>
            <Link href="/sign-in" className="nt-btn ghost" style={{ color: "#fff", borderColor: "#d4bfff" }} data-testid="link-hero-sign-in">Ya tengo cuenta</Link>
          </div>
        </div>
        <div className="nt-hero-card">
          <BrandLogo variant="white" />
          <div><span>Plazos</span><strong>12 a 60 meses</strong></div>
          <div><span>Paquetes</span><strong>Básico · Intermedio · Premium</strong></div>
          <div><span>Importes</span><strong>USD antes de IVA</strong></div>
        </div>
      </section>
      <section className="nt-steps">
        <article><b>01</b><h2>Configure</h2><p>Cliente, plazo, equipos y paquete de servicio.</p></article>
        <article><b>02</b><h2>Cotice</h2><p>Canon unitario y total por cada referencia, con precisión decimal exacta.</p></article>
        <article><b>03</b><h2>Consulte</h2><p>Cada cotización guardada conserva sus precios y parámetros originales.</p></article>
      </section>
      <section className="nt-cta">
        <h2>Ingrese para crear su próxima cotización.</h2>
        <Link href="/sign-in" className="nt-btn" data-testid="link-cta-sign-in">Iniciar sesión</Link>
      </section>
      <footer className="nt-foot">Novotechno · Plataforma de financiación de activos</footer>
    </div>
  );
}
