"use client";
import { useEffect, useState } from "react";
import { BadgeDollarSign, House, ShoppingBag, UserRound } from "lucide-react";

type Section = "home" | "book" | "pricing" | "account";
export function MobileAppDock({ active = "home", accountHref = "/account" }: { active?: Section; accountHref?: string }) {
  const [current, setCurrent] = useState<Section>(active);
  useEffect(() => {
    if (active === "account") { setCurrent("account"); return; }
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const marker = window.innerHeight * .45;
        const booking = document.getElementById("book")?.getBoundingClientRect();
        const pricing = document.getElementById("pricing")?.getBoundingClientRect();
        setCurrent(booking && booking.top < marker && booking.bottom > marker ? "book" : pricing && pricing.top < marker && pricing.bottom > marker ? "pricing" : "home");
      });
    };
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    update();
    return () => { cancelAnimationFrame(frame); window.removeEventListener("scroll", update); window.removeEventListener("resize", update); };
  }, [active]);
  const items = [
    { section: "home" as const, href: "/", icon: House, label: "Home" },
    { section: "book" as const, href: "/#book", icon: ShoppingBag, label: "Book" },
    { section: "pricing" as const, href: "/#pricing", icon: BadgeDollarSign, label: "Pricing" },
    { section: "account" as const, href: accountHref, icon: UserRound, label: "Account" },
  ];
  return <nav className="mobile-app-dock" aria-label="Mobile app navigation">{items.map(({ section, href, icon: Icon, label }) => <a href={href} key={section} className={current === section ? "is-active" : ""} aria-current={current === section ? (section === "book" || section === "pricing" ? "location" : "page") : undefined}><Icon size={20} strokeWidth={1.7} aria-hidden="true"/><span>{label}</span></a>)}</nav>;
}
