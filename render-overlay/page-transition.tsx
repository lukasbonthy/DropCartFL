"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { usePathname, useRouter } from "next/navigation";

const smoothEase = [0.16, 1, 0.3, 1] as const;
type NavigationKind = "route" | "auth-forward" | "auth-backward";

function internalDestination(anchor: HTMLAnchorElement) {
  const href = anchor.getAttribute("href");
  if (!href || href.startsWith("#")) return null;
  if (/^(mailto:|tel:|sms:|javascript:)/i.test(href)) return null;
  if (anchor.target && anchor.target !== "_self") return null;
  if (anchor.hasAttribute("download")) return null;
  if (anchor.dataset.noSmoothNav !== undefined) return null;

  const url = new URL(anchor.href, window.location.href);
  if (url.origin !== window.location.origin) return null;
  return url;
}

function authNavigationKind(from: string, to: string): NavigationKind {
  if (from === "/login" && to === "/signup") return "auth-forward";
  if (from === "/signup" && to === "/login") return "auth-backward";
  return "route";
}

export function PageTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const reduceMotion = useReducedMotion();
  const [pending, setPending] = useState(false);
  const [navigationKind, setNavigationKind] = useState<NavigationKind>("route");
  const [employeeAccess, setEmployeeAccess] = useState(false);
  const startedAt = useRef(0);
  const fallbackTimer = useRef<number | null>(null);
  const previousPath = useRef(pathname);
  const prefetched = useRef(new Set<string>());

  const finishNavigation = useCallback((minimumMs = 0) => {
    const elapsed = performance.now() - startedAt.current;
    const delay = Math.max(0, minimumMs - elapsed);
    window.setTimeout(() => setPending(false), delay);
  }, []);

  const beginNavigation = useCallback((kind: NavigationKind = "route") => {
    startedAt.current = performance.now();
    setNavigationKind(kind);
    setPending(true);

    if (fallbackTimer.current) window.clearTimeout(fallbackTimer.current);
    fallbackTimer.current = window.setTimeout(() => setPending(false), 10000);
  }, []);

  // Login and signup are one flow. Warm the opposite route immediately so the
  // browser never needs a full-document navigation just to change auth mode.
  useEffect(() => {
    if (pathname !== "/login" && pathname !== "/signup") return;
    const target = pathname === "/login" ? "/signup" : "/login";
    if (prefetched.current.has(target)) return;
    prefetched.current.add(target);
    router.prefetch(target);
  }, [pathname, router]);

  useEffect(() => {
    let cancelled = false;

    if (pathname !== "/account") {
      setEmployeeAccess(false);
      return;
    }

    fetch("/api/employee/access", {
      cache: "no-store",
      credentials: "same-origin",
    })
      .then(async (response) => {
        const body = await response.json().catch(() => ({})) as { employee?: boolean };
        if (!cancelled) setEmployeeAccess(Boolean(response.ok && body?.employee));
      })
      .catch(() => {
        if (!cancelled) setEmployeeAccess(false);
      });

    return () => {
      cancelled = true;
    };
  }, [pathname]);

  useEffect(() => {
    if (previousPath.current !== pathname) {
      previousPath.current = pathname;
      const authSwap = navigationKind === "auth-forward" || navigationKind === "auth-backward";
      finishNavigation(reduceMotion ? 0 : authSwap ? 230 : 150);
    }
  }, [pathname, navigationKind, reduceMotion, finishNavigation]);

  useEffect(() => {
    function onCustomStart() {
      beginNavigation("route");
    }

    function onPopState() {
      // The browser has already changed its URL. Starting a new pending state
      // here races the router and can leave a progress layer stuck on screen.
      setPending(false);
      setNavigationKind("route");
    }

    function onPageShow() {
      setPending(false);
      setNavigationKind("route");
    }

    function onClick(event: MouseEvent) {
      if (
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) return;

      const target = event.target instanceof Element ? event.target : null;
      const anchor = target?.closest("a[href]") as HTMLAnchorElement | null;
      if (!anchor) return;

      const url = internalDestination(anchor);
      if (!url) return;

      const current = new URL(window.location.href);
      const samePath = url.pathname === current.pathname;
      const sameSearch = url.search === current.search;
      if (samePath && sameSearch) return;

      const kind = authNavigationKind(current.pathname, url.pathname);
      beginNavigation(kind);

      // Upgrade plain same-origin anchors to client routing. This is the key
      // part that prevents the white "new website" document reload flash.
      if (!event.defaultPrevented) {
        event.preventDefault();
        router.push(url.pathname + url.search + url.hash);
      }

      if (samePath && !sameSearch) {
        window.setTimeout(() => finishNavigation(reduceMotion ? 0 : 240), 30);
      }
    }

    function prefetchFromEvent(event: Event) {
      const target = event.target instanceof Element ? event.target : null;
      const anchor = target?.closest("a[href]") as HTMLAnchorElement | null;
      if (!anchor) return;
      const url = internalDestination(anchor);
      if (!url) return;

      const route = url.pathname + url.search;
      if (route === window.location.pathname + window.location.search) return;
      if (prefetched.current.has(route)) return;

      prefetched.current.add(route);
      router.prefetch(route);
    }

    document.addEventListener("click", onClick);
    document.addEventListener("pointerover", prefetchFromEvent, { passive: true });
    document.addEventListener("focusin", prefetchFromEvent);
    window.addEventListener("popstate", onPopState);
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("dropcart:navigation-start", onCustomStart);

    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("pointerover", prefetchFromEvent);
      document.removeEventListener("focusin", prefetchFromEvent);
      window.removeEventListener("popstate", onPopState);
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("dropcart:navigation-start", onCustomStart);
      if (fallbackTimer.current) window.clearTimeout(fallbackTimer.current);
    };
  }, [beginNavigation, finishNavigation, reduceMotion, router]);

  useEffect(() => {
    document.documentElement.classList.toggle("dropcart-route-pending", pending);
    return () => document.documentElement.classList.remove("dropcart-route-pending");
  }, [pending]);


  return (
    <>
      <div className="dropcart-page-shell">{children}</div>

      {pathname === "/account" && employeeAccess && (
        <a
          href="/employee"
          className="dropcart-account-employee-shortcut"
          aria-label="Open employee dashboard"
        >
          <span className="dropcart-account-employee-icon" aria-hidden="true">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
              <path d="M9 7V5.7A1.7 1.7 0 0 1 10.7 4h2.6A1.7 1.7 0 0 1 15 5.7V7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
              <rect x="4" y="7" width="16" height="12" rx="2.5" stroke="currentColor" strokeWidth="1.8"/>
              <path d="M4 11.5c4.9 2.1 11.1 2.1 16 0M10 12.8h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
            </svg>
          </span>
          <span className="dropcart-account-employee-copy">
            <strong>Employee dashboard</strong>
            <small>Open your shift workspace</small>
          </span>
          <span className="dropcart-account-employee-arrow" aria-hidden="true">↗</span>
        </a>
      )}

      <AnimatePresence>
        {pending && !reduceMotion && (
          <motion.div
            key="dropcart-progress"
            className="dropcart-route-layer"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.16, ease: smoothEase }}
            aria-hidden="true"
          >
            <div className="dropcart-route-track">
              <motion.div className="dropcart-route-progress"
                initial={{ scaleX: 0.06 }} animate={{ scaleX: 0.88 }} exit={{ scaleX: 1 }}
                transition={{ duration: 0.9, ease: smoothEase }} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
