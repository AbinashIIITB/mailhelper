"use client";

import Link, { useLinkStatus } from "next/link";
import { Button } from "@/components/ui";

function Inner({ children }: { children: React.ReactNode }) {
  const { pending } = useLinkStatus();
  return <Button loading={pending}>{children}</Button>;
}

/**
 * A button that navigates and shows a spinner until the destination is ready.
 * Plain <Link><Button/></Link> looks inert for the whole server round-trip.
 */
export function LinkButton({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link href={href} className="no-underline">
      <Inner>{children}</Inner>
    </Link>
  );
}
