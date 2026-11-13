import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useAuth } from "@clerk/react";
import { useQueryClient } from "@tanstack/react-query";
import { useGetCurrentUser, type AppUser } from "@workspace/api-client-react";
import { errorStatus, isBlockedError } from "@/lib/api-errors";

interface AppSession {
  user: AppUser | undefined;
  signedIn: boolean;
  isLoading: boolean;
  blocked: boolean;
  error: unknown;
  retry: () => void;
}
const SessionContext = createContext<AppSession | null>(null);
const CURRENT_USER_KEY = "current-user";

export function AppSessionProvider({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn, userId } = useAuth();
  const queryClient = useQueryClient();
  const [blocked, setBlocked] = useState(false);
  const profile = useGetCurrentUser({
    query: { enabled: Boolean(isLoaded && isSignedIn), retry: false,
      queryKey: [CURRENT_USER_KEY, userId], staleTime: 0,
      refetchInterval: 30_000, refetchOnWindowFocus: true },
  });
  const user = isSignedIn && !blocked && profile.data?.id === userId ? profile.data : undefined;

  // Clear every scoped (confidential) cache entry whenever identity or role changes, or on sign-out.
  const scope = isSignedIn ? `${userId ?? ""}:${profile.data?.id === userId ? profile.data?.role ?? "" : ""}` : "signed-out";
  const lastScope = useRef(scope);
  useEffect(() => {
    if (lastScope.current === scope) return;
    const prev = lastScope.current;
    lastScope.current = scope;
    // Ignore the transition from "role unknown" to "role known" for the same user.
    if (prev.endsWith(":") && scope.startsWith(prev)) return;
    queryClient.removeQueries({ predicate: q => q.queryKey[0] !== CURRENT_USER_KEY });
  }, [scope, queryClient]);

  useEffect(() => { if (!isSignedIn) setBlocked(false); }, [isSignedIn, userId]);

  // Detect a 403 "blocked" from /auth/me or from any query/mutation and react immediately.
  useEffect(() => {
    if (profile.error && isBlockedError(profile.error)) setBlocked(true);
    else if (profile.data && !profile.error) setBlocked(false);
  }, [profile.error, profile.data]);
  useEffect(() => {
    const onErr = (e: unknown) => {
      if (isBlockedError(e)) { setBlocked(true); queryClient.removeQueries({ predicate: q => q.queryKey[0] !== CURRENT_USER_KEY }); }
      else if (errorStatus(e) === 403) void queryClient.invalidateQueries({ queryKey: [CURRENT_USER_KEY] });
    };
    const u1 = queryClient.getQueryCache().subscribe(ev => { if (ev.type === "updated" && ev.action.type === "error") onErr(ev.action.error); });
    const u2 = queryClient.getMutationCache().subscribe(ev => { if (ev.type === "updated" && ev.action.type === "error") onErr(ev.action.error); });
    return () => { u1(); u2(); };
  }, [queryClient]);

  return <SessionContext.Provider value={{
    user, signedIn: Boolean(isSignedIn), blocked,
    isLoading: !isLoaded || (Boolean(isSignedIn) && profile.isLoading),
    error: isSignedIn ? profile.error : null,
    retry: () => { void profile.refetch(); },
  }}>{children}</SessionContext.Provider>;
}
export function useAppSession() {
  const session = useContext(SessionContext);
  if (!session) throw new Error("AppSessionProvider missing");
  return session;
}
