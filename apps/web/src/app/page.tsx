import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { Button } from "@/components/ui";
import { LinkButton } from "@/components/link-button";

export default async function Home() {
  const session = await auth();
  if (session?.user) redirect("/dashboard");

  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-20">
      <div className="w-full max-w-2xl border border-gray-500 bg-white p-8">
        <p className="mb-2 text-sm text-gray-600">Free for small orgs</p>
        <h1 className="mb-4 text-3xl font-bold text-black">
          Send everyone their <span className="text-blue-700">own</span> email
        </h1>
        <p className="mb-6 text-base text-gray-800">
          Upload a spreadsheet, write one template with{" "}
          <code className="border border-gray-400 bg-gray-100 px-1">
            {"{{ blanks }}"}
          </code>
          , and Mail Helper sends each person a personalized email from your own
          Gmail - marks, credentials, invoices, anything private.
        </p>
        <div className="flex items-center gap-3">
          <LinkButton href="/signup">Get started free</LinkButton>
          <Link href="/login">
            <Button variant="secondary">Sign in</Button>
          </Link>
        </div>
      </div>
    </main>
  );
}
