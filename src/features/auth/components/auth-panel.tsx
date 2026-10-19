"use client";

import { useState, type FormEvent } from "react";
import Image from "next/image";
import { ArrowRight, KeyRound } from "lucide-react";
import { supabase } from "../../../lib/supabase";

export function AuthPanel() {
  const [isSignUp, setIsSignUp] = useState(false);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;

    setIsSubmitting(true);
    setMessage("");
    const result = isSignUp
      ? await supabase.auth.signUp({
          email,
          password,
          options: { data: { full_name: fullName } },
        })
      : await supabase.auth.signInWithPassword({ email, password });
    setIsSubmitting(false);

    if (result.error) {
      setMessage(result.error.message);
    } else if (isSignUp && !result.data.session) {
      setMessage("Check your email to confirm the new account, then sign in.");
    }
  }

  return (
    <main className="auth-screen">
      <section className="auth-panel">
        <div className="auth-brand"><span><Image src="/felda-logo.svg" width={40} height={40} alt="Logo FELDA" priority /></span><div><strong>AKRF</strong><small>FELDA WILAYAH KUANTAN</small></div></div>
        {supabase ? <>
          <div className="auth-heading"><span className="auth-kicker"><KeyRound size={13} /> SECURE ACCESS</span><h1>{isSignUp ? "Create your account" : "Welcome back"}</h1><p>Sign in to save and access your assessment records.</p></div>
          <form className="auth-form" onSubmit={submit}>
            {isSignUp && <label>Full name<input autoComplete="name" required value={fullName} onChange={(event) => setFullName(event.target.value.toUpperCase())} /></label>}
            <label>Email address<input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
            <label>Password<input type="password" autoComplete={isSignUp ? "new-password" : "current-password"} minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
            {message && <p className="auth-message" role="status">{message}</p>}
            <button className="auth-submit" type="submit" disabled={isSubmitting}>{isSubmitting ? "Please wait..." : isSignUp ? "Create account" : "Sign in"}<ArrowRight size={16} /></button>
          </form>
          <button className="auth-mode-toggle" type="button" onClick={() => { setIsSignUp((value) => !value); setMessage(""); }}>
            {isSignUp ? "Already have an account? Sign in" : "New user? Create an account"}
          </button>
        </> : <div className="auth-heading auth-setup"><span className="auth-kicker"><KeyRound size={13} /> SETUP REQUIRED</span><h1>Connect Supabase</h1><p>Add your project URL and public anon key to <code>.env.local</code>, then restart the development server.</p><pre>NEXT_PUBLIC_SUPABASE_URL={"<project-url>"}{"\n"}NEXT_PUBLIC_SUPABASE_ANON_KEY={"<anon-key>"}</pre></div>}
      </section>
    </main>
  );
}