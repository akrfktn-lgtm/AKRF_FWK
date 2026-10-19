"use client";

import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { AuthPanel } from "../features/auth/components/auth-panel";
import { AssessmentWorkspace } from "../features/assessment/components/assessment-workspace";
import { supabase } from "../lib/supabase";

export default function AssessmentPage() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    if (!supabase) {
      setAuthReady(true);
      return;
    }
    void supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null);
      setAuthReady(true);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  if (!supabase) return <AuthPanel />;
  if (!authReady) return <main className="auth-screen"><p>Loading secure session...</p></main>;
  if (!user) return <AuthPanel />;
  return <AssessmentWorkspace user={user} />;
}
