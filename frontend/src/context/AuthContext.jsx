import { createContext, useContext, useEffect, useState } from "react";
import { supabase } from "../supabaseClient";

const AuthContext = createContext(null);

const BASE = import.meta.env.VITE_API_URL || "http://localhost:8000";

export function AuthProvider({ children }) {
  const [session, setSession]   = useState(undefined); // undefined = loading
  const [isAdmin, setIsAdmin]   = useState(false);
  const [userId, setUserId]     = useState(null);

  useEffect(() => {
    // Load the current session on mount
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
    });

    // Keep session in sync on auth state changes (login, logout, token refresh)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  // Fetch /me whenever we get a fresh session token
  useEffect(() => {
    if (!session?.access_token) {
      setIsAdmin(false);
      setUserId(null);
      return;
    }
    fetch(`${BASE}/me`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data) {
          setIsAdmin(data.is_admin ?? false);
          setUserId(data.user_id ?? null);
        }
      })
      .catch(() => {});
  }, [session?.access_token]);

  return (
    <AuthContext.Provider value={{ session, isAdmin, userId }}>
      {children}
    </AuthContext.Provider>
  );
}

/** Returns the current Supabase session (null = logged out, undefined = loading). */
export function useSession() {
  return useContext(AuthContext).session;
}

/** Returns the access token string, or null if not logged in. */
export function useAccessToken() {
  const session = useSession();
  return session?.access_token ?? null;
}

/** Returns true if the current user is an admin. */
export function useIsAdmin() {
  return useContext(AuthContext).isAdmin;
}

/** Returns the current user's UUID. */
export function useUserId() {
  return useContext(AuthContext).userId;
}
