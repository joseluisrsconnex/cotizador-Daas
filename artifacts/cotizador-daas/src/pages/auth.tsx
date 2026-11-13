import type { ReactNode } from "react";
import { SignIn, SignUp } from "@clerk/react";
import BrandLogo from "@/components/brand-logo";
import "@/history-auth.css";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

function AuthLayout({ title, text, children }: { title: string; text: string; children: ReactNode }) {
  return (
    <div className="nt-auth">
      <aside className="nt-auth-side">
        <a href={`${basePath}/`} aria-label="Novotechno, inicio"><BrandLogo variant="white" /></a>
        <div><h1>{title}</h1><p>{text}</p></div>
        <span className="nt-kicker">COTIZADOR DAAS</span>
      </aside>
      <main className="nt-auth-main">{children}</main>
    </div>
  );
}

export function SignInPage() {
  return (
    <AuthLayout title="Bienvenido de nuevo" text="Ingrese para cotizar y consultar su historial.">
      <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} />
    </AuthLayout>
  );
}

export function SignUpPage() {
  return (
    <AuthLayout title="Cree su cuenta" text="Acceda al cotizador DaaS de Novotechno.">
      <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} />
    </AuthLayout>
  );
}
