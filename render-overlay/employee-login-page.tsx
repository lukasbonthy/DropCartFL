"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Eye,
  EyeOff,
  LockKeyhole,
  ShieldCheck,
  ShoppingBag,
} from "lucide-react";
import "../employee.css";

function beginSmoothNavigation() {
  window.dispatchEvent(new Event("dropcart:navigation-start"));
}

export default function EmployeeLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/employee/dashboard", { cache: "no-store" })
      .then((response) => {
        if (response.ok) {
          beginSmoothNavigation();
          router.replace("/employee");
        }
      })
      .catch(() => undefined);
  }, [router]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;

    setBusy(true);
    setError("");

    try {
      const response = await fetch("/api/employee/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password, remember }),
      });

      const result = await response.json().catch(() => ({}));

      if (!response.ok || !result?.ok) {
        throw new Error("We couldn't sign you into the employee portal. Check your email and password.");
      }

      beginSmoothNavigation();
      router.push(result?.redirectTo || "/employee");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "We couldn't sign you into the employee portal. Check your email and password.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="employee-login-page">
      <div className="employee-login-shell">
        <a className="employee-login-back" href="/">
          <ArrowLeft size={16} />
          Back to Dropcart
        </a>

        <section className="employee-login-card">
          <div className="employee-login-brand">
            <span className="employee-login-logo"><ShoppingBag size={19} /></span>
            <strong>dropcart</strong>
          </div>

          <div className="employee-login-badge">
            <ShieldCheck size={14} />
            Employee portal
          </div>

          <h1>Welcome back.</h1>
          <p className="employee-login-copy">
            Sign in with your employee-enabled Dropcart account to manage unloads and your shift.
          </p>

          <form onSubmit={submit} className="employee-login-form">
            <label>
              <span>Email address</span>
              <input
                type="email"
                inputMode="email"
                autoComplete="username"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@dropcart.com"
                required
                disabled={busy}
              />
            </label>

            <label>
              <span>Password</span>
              <div className="employee-password-field">
                <input
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Enter your password"
                  required
                  disabled={busy}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((current) => !current)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  disabled={busy}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </label>

            <label className="employee-remember">
              <input
                type="checkbox"
                checked={remember}
                onChange={(event) => setRemember(event.target.checked)}
                disabled={busy}
              />
              <span>Keep me signed in on this device</span>
            </label>

            {error && (
              <div className="employee-login-error" role="alert">
                {error}
              </div>
            )}

            <button className="employee-login-submit" type="submit" disabled={busy}>
              {busy ? "Signing in…" : "Sign in to employee portal"}
              {!busy && <ArrowRight size={18} />}
            </button>
          </form>

          <div className="employee-login-security">
            <LockKeyhole size={14} />
            <span>Employee access is checked after sign-in.</span>
          </div>
        </section>

        <p className="employee-login-footnote">
          Customer account? <a href="/login">Use the regular Dropcart login</a>.
        </p>
      </div>
    </main>
  );
}
