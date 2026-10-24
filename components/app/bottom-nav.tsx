"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { House, Files, Presentation, UserCircle, type Icon } from "@phosphor-icons/react";

const items: { href: string; label: string; icon: Icon }[] = [
  { href: "/", label: "Home", icon: House },
  { href: "/documents", label: "Library", icon: Files },
  { href: "/viewer", label: "Board", icon: Presentation },
  { href: "/settings", label: "Account", icon: UserCircle },
];

export function BottomNav() {
  const pathname = usePathname();
  return (
    <nav className="bottom-nav" aria-label="Primary">
      {items.map(item => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        const Glyph = item.icon;
        return (
          <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined}>
            <span className="nav-pill">
              <Glyph size={22} weight={active ? "fill" : "regular"} aria-hidden="true" />
            </span>
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
