"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { usePathname, useRouter } from "next/navigation";

const smoothEase = [0.16, 1, 0.3, 1] as const;

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

export function PageTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const reduceMotion = useReducedMotion();
  const [pending, setPending] = useState(false);
  const startedAt = useRef(0);
  const fallbackTimer = useRef<number | null>(null);
  const previousPath = useRef(pathname);
  const prefetched = useRef(new Set<string>());

  const finishNavigation = useCallback((minimumMs = 0) => {
    const elapsed = performance.now() - startedAt.current;
    const delay = Math.max(0, minimumMs - elapsed);
    window.setTimeout(() => setPending(false), delay);
  }, []);

  const beginNavigation = useCallback(() => {
    startedAt.current = performance.now();
    setPending(true);

    if (fallbackTimer.current) window.clearTimeout(fallbackTimer.current);
    fallbackTimer.current = window.setTimeout(() => setPending(false), 10000);
  }, []);

  useEffect(() => {
    if (previousPath.current !== pathname) {
      previousPath.current = pathname;
      finishNavigation(reduceMotion ? 0 : 170);
    }
  }, [pathname, reduceMotion, finishNavigation]);

  useEffect(() => {
    function onCustomStart() {
      beginNavigation();
    }

    function onPopState() {
      beginNavigation();
    }

    function onPageShow() {
      setPending(false);
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

      // Hash-only jumps should keep their native smooth scroll and never trigger a route veil.
      if (samePath && sameSearch) return;

      beginNavigation();

      // Next <Link> already prevents the browser navigation. Raw <a> tags do not,
      // so upgrade those to client navigation to avoid full-page/font reload flashes.
      if (!event.defaultPrevented) {
        event.preventDefault();
        router.push(url.pathname + url.search + url.hash);
      }

      // usePathname does not change for a query-only navigation.
      if (samePath && !sameSearch) {
        window.setTimeout(() => finishNavigation(reduceMotion ? 0 : 280), 30);
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

      <AnimatePresence>
        {pending && !reduceMotion && (
          <motion.div
            className="dropcart-route-layer"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16, ease: smoothEase }}
            aria-hidden="true"
          >
            <motion.div
              className="dropcart-route-veil"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18, ease: smoothEase }}
            />
            <div className="dropcart-route-track">
              <motion.div
                className="dropcart-route-progress"
                initial={{ scaleX: 0.04, opacity: 0 }}
                animate={{ scaleX: 0.84, opacity: 1 }}
                exit={{ scaleX: 1, opacity: 0 }}
                transition={{
                  scaleX: { duration: 1.45, ease: smoothEase },
                  opacity: { duration: 0.14 },
                }}
              />
              <motion.div
                className="dropcart-route-sheen"
                initial={{ x: "-140%" }}
                animate={{ x: "170%" }}
                transition={{ duration: 0.9, ease: "easeInOut", repeat: Infinity }}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
