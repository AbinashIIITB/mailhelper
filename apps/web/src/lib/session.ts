import { redirect } from "next/navigation";
import { auth } from "@/auth";

/** Returns the current user id, or redirects to /login if unauthenticated. */
export async function requireUserId(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }
  return session.user.id;
}
