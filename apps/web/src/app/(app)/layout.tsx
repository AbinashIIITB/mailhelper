import { auth } from "@/auth";
import { Nav } from "@/components/nav";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  return (
    <>
      <Nav email={session?.user?.email} />
      <div className="mx-auto w-full max-w-5xl flex-1 px-5 py-6">{children}</div>
    </>
  );
}
