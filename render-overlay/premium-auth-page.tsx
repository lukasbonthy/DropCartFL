"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, ArrowUpRight, Check, Eye, EyeOff, LoaderCircle, LockKeyhole, MapPin, ShieldCheck, ShoppingBag } from "lucide-react";
import { DropcartWordmark } from "@/components/dropcart-wordmark";

type Props = { mode: "login" | "signup"; returnTo?: string };
type AuthResponse = { ok?: boolean; error?: string; redirectTo?: string };

export function AuthPage({ mode, returnTo = "/account" }: Props) {
  const signup = mode === "signup";
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const safeReturnTo = returnTo.startsWith("/") && !returnTo.startsWith("//") && !returnTo.includes("\\") ? returnTo : "/account";
  const modeHref = (target: string) => `/${target}${safeReturnTo === "/account" ? "" : `?return_to=${encodeURIComponent(safeReturnTo)}`}`;
  useEffect(() => { setError(""); setShowPassword(false); }, [mode]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;
    setError("");
    if (!event.currentTarget.reportValidity()) return;
    if (signup && password !== confirmPassword) { setError("Those passwords don’t match yet. Please check them and try again."); return; }
    const form = new FormData(event.currentTarget);
    setLoading(true);
    try {
      const response = await fetch(`/api/auth/${mode}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: signup ? String(form.get("name") ?? "") : undefined, email: String(form.get("email") ?? "").trim(), password, remember: form.get("remember") === "on", returnTo: safeReturnTo }) });
      const result = await response.json() as AuthResponse;
      if (!response.ok || !result.ok) { setError(result.error || "We couldn’t sign you in. Please try again."); return; }
      const requested = typeof result.redirectTo === "string" ? result.redirectTo : safeReturnTo;
      const destination = requested.startsWith("/") && !requested.startsWith("//") && !requested.includes("\\") ? requested : "/account";
      window.dispatchEvent(new Event("dropcart:navigation-start"));
      window.location.assign(signup ? `/welcome?next=${encodeURIComponent(destination)}` : destination);
    } catch { setError("We couldn’t connect just now. Check your connection and try again."); }
    finally { setLoading(false); }
  }

  return <main className="dc-auth">
    <header className="dc-auth-header"><Link href="/" className="brand dc-brand" aria-label="Dropcart home"><DropcartWordmark/></Link><Link href="/" className="dc-auth-back"><ArrowLeft size={17} aria-hidden="true"/><span>Back to home</span></Link></header>
    <div className="dc-auth-layout">
      <aside className="dc-auth-story" aria-label="A lighter day with Dropcart"><span className="dc-location"><MapPin size={15} aria-hidden="true"/> Inverness, Florida</span><div className="dc-auth-story-copy"><p className="dc-eyebrow">A LITTLE HELP GOES A LONG WAY</p><h1>Good to<br/> have a hand.</h1><p>Your groceries. Your home.<br/>One less thing on your list.</p></div><img src="/groceries.webp" width="1536" height="1024" alt="Fresh groceries ready to bring inside"/><div className="dc-auth-story-foot"><ShoppingBag size={21} aria-hidden="true"/><span>Less lifting. More living.</span></div></aside>
      <section className="dc-auth-panel" aria-labelledby="auth-title">
        <div className="dc-auth-tabs" aria-label="Account action"><Link href={modeHref("login")} className={!signup ? "is-active" : ""} aria-current={!signup ? "page" : undefined}>Log in</Link><Link href={modeHref("signup")} className={signup ? "is-active" : ""} aria-current={signup ? "page" : undefined}>Create account</Link></div>
        <div className="dc-auth-form-content" key={mode}>
          <p className="dc-eyebrow">{signup ? "YOUR LIGHTER DAY STARTS HERE" : "MAKE YOURSELF AT HOME"}</p><h2 id="auth-title">{signup ? "A little less to do." : "Welcome back."}</h2><p className="dc-auth-intro">{signup ? "Create your free account to keep your unloads and booking history together." : "Your next unload, saved details, and booking history. All right here."}</p>
          <form className="dc-auth-form" onSubmit={submit} noValidate>
            {signup && <label className="dc-auth-field" htmlFor="auth-name">Your name<input id="auth-name" name="name" type="text" autoComplete="name" placeholder="First and last name" minLength={2} maxLength={70} required disabled={loading}/></label>}
            <label className="dc-auth-field" htmlFor="auth-email">Email address<input id="auth-email" name="email" type="email" inputMode="email" autoComplete="email" placeholder="you@example.com" maxLength={254} required disabled={loading}/></label>
            <div className="dc-auth-field"><label htmlFor="auth-password">Password</label><div className="dc-password-wrap"><input id="auth-password" name="password" type={showPassword ? "text" : "password"} autoComplete={signup ? "new-password" : "current-password"} placeholder={signup ? "Create a password" : "Enter your password"} minLength={signup ? 8 : undefined} maxLength={128} value={password} onChange={event => setPassword(event.target.value)} required disabled={loading} aria-describedby={signup ? "password-help" : undefined}/><button type="button" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? "Hide password" : "Show password"}>{showPassword ? <EyeOff size={19}/> : <Eye size={19}/>}</button></div>{signup && <small id="password-help">Use at least 8 characters.</small>}</div>
            {signup && <label className="dc-auth-field" htmlFor="auth-confirm">Confirm password<input id="auth-confirm" name="confirmPassword" type={showPassword ? "text" : "password"} autoComplete="new-password" placeholder="Enter your password again" value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} maxLength={128} required disabled={loading}/></label>}
            <label className="dc-auth-remember"><input type="checkbox" name="remember" disabled={loading}/> Keep me signed in on this device</label>
            {error && <div className="dc-auth-error" role="alert">{error}</div>}
            <button type="submit" className="dc-button dc-button-dark dc-auth-submit" disabled={loading}>{loading ? <><span>{signup ? "Creating your account…" : "Signing you in…"}</span><LoaderCircle size={20} className="dc-spin" aria-hidden="true"/></> : <><span>{signup ? "Create my account" : "Let’s lighten the load"}</span><ArrowRight size={20} aria-hidden="true"/></>}</button>
            <p className="dc-auth-secure"><LockKeyhole size={14} aria-hidden="true"/> Your account stays private.</p>
          </form>
          <p className="dc-auth-switch">{signup ? "Already have an account?" : "New to Dropcart?"} <Link href={modeHref(signup ? "login" : "signup")}>{signup ? "Log in" : "Create a free account"}</Link></p>
          {!signup && <Link href="/employee/login" className="dc-employee-access"><ShieldCheck size={22} aria-hidden="true"/><span><strong>Part of the Dropcart team?</strong><small>Go to the employee portal</small></span><ArrowUpRight size={19} aria-hidden="true"/></Link>}
          {signup && <div className="dc-auth-benefits"><span><Check size={15} aria-hidden="true"/> Free account</span><span><Check size={15} aria-hidden="true"/> No subscription</span></div>}
        </div>
      </section>
    </div>
    <footer className="dc-auth-footer"><span>© {new Date().getFullYear()} Dropcart</span><span>From your car. To your kitchen.</span></footer>
  </main>;
}
