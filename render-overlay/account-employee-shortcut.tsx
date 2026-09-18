"use client";

import { useEffect, useState } from "react";
import { ArrowUpRight, BriefcaseBusiness } from "lucide-react";
import { usePathname } from "next/navigation";

export function AccountEmployeeShortcut() {
  const pathname = usePathname();
  const [isEmployee, setIsEmployee] = useState(false);

  useEffect(() => {
    let cancelled = false;

    if (pathname !== "/account") {
      setIsEmployee(false);
      return;
    }

    fetch("/api/employee/access", {
      cache: "no-store",
      credentials: "same-origin",
    })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!cancelled) setIsEmployee(Boolean(response.ok && body?.employee));
      })
      .catch(() => {
        if (!cancelled) setIsEmployee(false);
      });

    return () => {
      cancelled = true;
    };
  }, [pathname]);

  if (pathname !== "/account" || !isEmployee) return null;

  return (
    <a
      href="/employee"
      className="dropcart-account-employee-shortcut"
      aria-label="Open employee dashboard"
    >
      <span className="dropcart-account-employee-icon">
        <BriefcaseBusiness size={17} aria-hidden="true" />
      </span>
      <span className="dropcart-account-employee-copy">
        <strong>Employee dashboard</strong>
        <small>Open your shift workspace</small>
      </span>
      <ArrowUpRight
        className="dropcart-account-employee-arrow"
        size={16}
        aria-hidden="true"
      />
    </a>
  );
}
