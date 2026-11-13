import { useEffect, useRef, type ReactNode } from "react";
import { ClerkProvider, useClerk } from "@clerk/react";
import { publishableKeyFromHost } from "@clerk/react/internal";
import { shadcn } from "@clerk/themes";
import { esES } from "@clerk/localizations";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";

const clerkPubKey = import.meta.env.VITE_CLERK_PROXY_ENABLED === "false"
  ? import.meta.env.VITE_CLERK_PUBLISHABLE_KEY
  : publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_ENABLED === "false"
  ? undefined : import.meta.env.VITE_CLERK_PROXY_URL;
const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
function stripBase(path: string): string {
  return basePath && path.startsWith(basePath) ? path.slice(basePath.length) || "/" : path;
}

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const queryClient = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (prevUserIdRef.current !== undefined && prevUserIdRef.current !== userId) queryClient.clear();
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, queryClient]);
  return null;
}

export default function AuthProvider({ children }: { children: ReactNode }) {
  const [, setLocation] = useLocation();
  return <ClerkProvider
    publishableKey={clerkPubKey}
    proxyUrl={clerkProxyUrl}
    signInUrl={`${basePath}/sign-in`}
    signUpUrl={`${basePath}/sign-up`}
    signInFallbackRedirectUrl={`${basePath}/cotizador`}
    signUpFallbackRedirectUrl={`${basePath}/cotizador`}
    routerPush={path => setLocation(stripBase(path))}
    routerReplace={path => setLocation(stripBase(path), { replace: true })}
    localization={esES}
    appearance={{
      theme: shadcn,
      cssLayerName: "clerk",
      options: { logoPlacement: "inside", logoLinkUrl: basePath || "/",
        logoImageUrl: `${window.location.origin}${basePath}/logo.svg` },
      variables: {
        colorPrimary: "#6D31FA", colorForeground: "#231C35", colorMutedForeground: "#595267",
        colorDanger: "#B42318", colorBackground: "#FFFFFF", colorInput: "#FFFFFF",
        colorInputForeground: "#231C35", colorNeutral: "#595267",
        fontFamily: "Manrope, system-ui, sans-serif", borderRadius: "8px",
      },
      elements: {
        rootBox: { width: "100%", display: "flex", justifyContent: "center" },
        cardBox: { width: "440px", maxWidth: "100%", backgroundColor: "#fff", borderRadius: "12px", overflow: "hidden" },
        card: { backgroundColor: "transparent", boxShadow: "none", border: "0" },
        footer: { backgroundColor: "transparent", boxShadow: "none", border: "0" },
        headerTitle: { color: "#231C35" }, headerSubtitle: { color: "#595267" },
        socialButtonsBlockButtonText: { color: "#231C35" }, formFieldLabel: { color: "#231C35" },
        footerActionLink: { color: "#6D31FA" }, footerActionText: { color: "#595267" },
        dividerText: { color: "#595267" }, identityPreviewEditButton: { color: "#6D31FA" },
        formFieldSuccessText: { color: "#231C35" }, alertText: { color: "#B42318" },
        logoBox: { marginBottom: "16px" }, logoImage: { width: "220px", height: "48px" },
        socialButtonsBlockButton: { backgroundColor: "#fff", borderColor: "#887E98" },
        formButtonPrimary: { backgroundColor: "#6D31FA", color: "#fff" },
        formFieldInput: { backgroundColor: "#fff", color: "#231C35", borderColor: "#887E98" },
        footerAction: { padding: "16px" }, dividerLine: { backgroundColor: "#DDD6E8" },
        alert: { backgroundColor: "#FDF0EF" }, otpCodeFieldInput: { color: "#231C35" },
        formFieldRow: { marginBottom: "12px" }, main: { gap: "16px" },
      },
    }}
  ><ClerkQueryClientCacheInvalidator />{children}</ClerkProvider>;
}
