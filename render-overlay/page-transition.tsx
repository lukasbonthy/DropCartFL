"use client";

import type { ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { usePathname } from "next/navigation";

const enterEase = [0.16, 1, 0.3, 1] as const;
const exitEase = [0.4, 0, 1, 1] as const;

export function PageTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const reduceMotion = useReducedMotion();

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={pathname}
        className="dropcart-page-shell"
        initial={
          reduceMotion
            ? false
            : { opacity: 0, y: 9, scale: 0.997 }
        }
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={
          reduceMotion
            ? { opacity: 1 }
            : { opacity: 0, y: -5, scale: 0.999 }
        }
        transition={
          reduceMotion
            ? { duration: 0 }
            : {
                opacity: { duration: 0.2, ease: enterEase },
                y: { duration: 0.34, ease: enterEase },
                scale: { duration: 0.34, ease: enterEase },
              }
        }
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
