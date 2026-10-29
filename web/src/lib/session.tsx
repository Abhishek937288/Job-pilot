"use client";

import type { AuthConfigDto, UserDto } from "@jobpilot/shared";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, isApiError, onUnauthorized } from "./api";

type SessionStatus = "loading" | "authenticated" | "anonymous";

interface SessionValue {
  status: SessionStatus;
  user: UserDto | null;
  /** Re-reads `GET /auth/me`. */
  refresh: () => Promise<UserDto | null>;
  /** Sets the user after login, signup or guest start; `null` after logout or account deletion. */
  setUser: (user: UserDto | null) => void;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<UserDto | null>(null);
  const [status, setStatus] = useState<SessionStatus>("loading");

  const setUser = useCallback((u: UserDto | null) => {
    setUserState(u);
    setStatus(u ? "authenticated" : "anonymous");
  }, []);

  const refresh = useCallback(async () => {
    try {
      const me = await api<UserDto>("/auth/me");
      setUser(me);
      return me;
    } catch (err) {
      // Only a 401 means "signed out"; keep the current state on network errors.
      if (isApiError(err, 401)) setUser(null);
      else setStatus((s) => (s === "loading" ? "anonymous" : s));
      return null;
    }
  }, [setUser]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => onUnauthorized(() => setUser(null)), [setUser]);

  const value = useMemo(() => ({ status, user, refresh, setUser }), [status, user, refresh, setUser]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside <SessionProvider>");
  return ctx;
}

/**
 * Client-side guard: sends signed-out visitors to `/`. The API still enforces every permission;
 * this only avoids rendering pages that cannot load.
 */
export function useRequireSession(): SessionValue {
  const session = useSession();
  const router = useRouter();
  useEffect(() => {
    if (session.status === "anonymous") router.replace("/");
  }, [session.status, router]);
  return session;
}

/** Sends signed-in visitors away from landing/auth pages. Guests may stay when `allowGuest`. */
export function useRedirectIfSignedIn(to = "/profiles", allowGuest = false): SessionValue {
  const session = useSession();
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => {
    if (session.status !== "authenticated" || !session.user) return;
    if (allowGuest && session.user.isGuest) return;
    if (pathname !== to) router.replace(to);
  }, [session.status, session.user, allowGuest, to, router, pathname]);
  return session;
}

let configPromise: Promise<AuthConfigDto> | null = null;

/** `GET /auth/config`, fetched once per page load. */
export function useAuthConfig(): AuthConfigDto | null {
  const [config, setConfig] = useState<AuthConfigDto | null>(null);
  useEffect(() => {
    let active = true;
    configPromise ??= api<AuthConfigDto>("/auth/config").catch((err: unknown) => {
      configPromise = null;
      throw err;
    });
    configPromise.then(
      (c) => active && setConfig(c),
      () => active && setConfig({ googleEnabled: false, guestEnabled: true }),
    );
    return () => {
      active = false;
    };
  }, []);
  return config;
}
