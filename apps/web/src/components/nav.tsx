"use client";

import { useState } from "react";
import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { Button, Spinner, cn } from "@/components/ui";

const links = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/campaigns", label: "Campaigns" },
  { href: "/settings", label: "Settings" },
  { href: "/account", label: "Account" },
];

/**
 * Lives inside <Link> so it can read that link's navigation state. Server
 * pages here take a database round-trip, which is long enough that a click
 * with no feedback reads as a dead button.
 */
function NavLabel({ label }: { label: string }) {
  const { pending } = useLinkStatus();
  return (
    <span className="inline-flex items-center gap-1.5">
      {label}
      {pending && <Spinner className="size-3" />}
    </span>
  );
}

export function Nav({ email }: { email?: string | null }) {
  const pathname = usePathname();
  const [signingOut, setSigningOut] = useState(false);
  return (
    <header className="border-b-2 border-gray-500 bg-white">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-2">
        <div className="flex items-center gap-5">
          <Link href="/dashboard" className="text-xl font-bold text-blue-700 no-underline">
            Mail Helper
          </Link>
          <nav className="flex items-center gap-3 pt-1">
            {links.map((l) => {
              const active =
                pathname === l.href || pathname.startsWith(l.href + "/");
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  className={cn(
                    "px-1 text-sm",
                    active ? "font-bold text-black underline" : "text-blue-700",
                  )}
                >
                  <NavLabel label={l.label} />
                </Link>
              );
            })}
          </nav>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/account"
            className="hidden text-xs text-gray-600 sm:inline"
          >
            {email}
          </Link>
          <Button
            variant="secondary"
            loading={signingOut}
            onClick={() => {
              setSigningOut(true);
              signOut({ callbackUrl: "/" });
            }}
          >
            Sign out
          </Button>
        </div>
      </div>
    </header>
  );
}
