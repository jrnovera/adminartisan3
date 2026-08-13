"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { Session } from "@supabase/supabase-js";
import { getSupabaseClient } from "./supabase";
import { fetchRole, type RoleInfo, type UserRole } from "./roles";

type AuthValue = {
  session: Session | null;
  loading: boolean;
  /** Role fetch is still in flight — distinct from `loading`, which only
   * covers the initial session check. Nav/page guards should treat this as
   * "don't know yet", not "no access". */
  roleLoading: boolean;
  /** `null` = legacy account with no role row = unrestricted (see lib/roles.ts). */
  role: UserRole | null;
  /** True for superadmin OR developer — developer inherits every
   * superadmin-gated capability. Use `isDeveloper` for the few things
   * (Danger Zone, the license freeze) that developer alone should reach. */
  isSuperAdmin: boolean;
  /** True only for the developer role — the sole role exempt from the
   * license freeze, and the only one that can see the Danger Zone. */
  isDeveloper: boolean;
  /** True for admin or superadmin, or a legacy account with no role row.
   * False only for an explicit 'staff' role. */
  isAdminOrAbove: boolean;
  /** A signed-in-but-unapproved self-signup. The app should show a pending
   * message and nothing else — see /login. */
  isPendingApproval: boolean;
  signOut: () => Promise<void>;
};

const defaultValue: AuthValue = {
  session: null,
  loading: true,
  roleLoading: true,
  role: null,
  isSuperAdmin: false,
  isDeveloper: false,
  isAdminOrAbove: true,
  isPendingApproval: false,
  signOut: async () => {},
};

const AuthContext = createContext<AuthValue>(defaultValue);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  // Stored with the id it was fetched for, so a stale result can never be
  // read against a different (or no-longer-current) session.
  const [roleState, setRoleState] = useState<{
    userId: string;
    info: RoleInfo;
  } | null>(null);

  useEffect(() => {
    const supabase = getSupabaseClient();

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, next) => {
        setSession(next);
        setLoading(false);
      }
    );

    return () => listener.subscription.unsubscribe();
  }, []);

  const userId = session?.user.id;
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    fetchRole(userId).then((info) => {
      if (!cancelled) setRoleState({ userId, info });
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const matchesCurrentUser = userId && roleState?.userId === userId;
  const roleLoading = Boolean(userId) && !matchesCurrentUser;
  const info = matchesCurrentUser ? roleState.info : null;

  const role = info?.role ?? null;
  // A legacy row-less account is full access; an explicit row must be
  // approved to count for anything.
  const approved = info ? info.approved : true;
  const isDeveloper = role === "developer" && approved;
  const isSuperAdmin = (role === "superadmin" || isDeveloper) && approved;
  const isAdminOrAbove = approved && (role === null || role !== "staff");
  const isPendingApproval = Boolean(!roleLoading && info && !info.approved);

  const value = useMemo<AuthValue>(
    () => ({
      session,
      loading,
      roleLoading,
      role,
      isSuperAdmin,
      isDeveloper,
      isAdminOrAbove,
      isPendingApproval,
      signOut: async () => {
        await getSupabaseClient().auth.signOut();
      },
    }),
    [
      session,
      loading,
      roleLoading,
      role,
      isSuperAdmin,
      isDeveloper,
      isAdminOrAbove,
      isPendingApproval,
    ]
  );

  return <AuthContext value={value}>{children}</AuthContext>;
}

export function useAuth() {
  return useContext(AuthContext);
}
