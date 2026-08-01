import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@mailhelper/db";
import { requireUserId } from "@/lib/session";
import { Card } from "@/components/ui";
import { PasswordForm } from "./password-form";

export default async function AccountPage() {
  const userId = await requireUserId();

  const [user, campaignCount, sentCount, smtp] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, createdAt: true },
    }),
    prisma.campaign.count({ where: { userId } }),
    prisma.recipient.count({
      where: { status: "sent", campaign: { userId } },
    }),
    prisma.smtpConfig.findUnique({ where: { userId } }),
  ]);

  // The session outlived the row (deleted account, wiped database).
  if (!user) redirect("/login");

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Account</h1>
        <p className="text-sm text-gray-600">
          Your profile and sign-in password.
        </p>
      </div>

      <Card>
        <p className="mb-3 font-bold">Profile</p>
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-gray-600">Email</dt>
            <dd className="text-black">{user.email}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-gray-600">Member since</dt>
            <dd className="text-black">
              {user.createdAt.toLocaleDateString("en-GB", {
                day: "numeric",
                month: "long",
                year: "numeric",
                timeZone: "UTC",
              })}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-gray-600">Sending Gmail</dt>
            <dd className="text-black">
              {smtp ? (
                smtp.gmailAddress
              ) : (
                <Link href="/settings" className="text-blue-700">
                  Not connected
                </Link>
              )}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-gray-600">Campaigns</dt>
            <dd className="text-black">{campaignCount}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-gray-600">Emails sent</dt>
            <dd className="text-black">{sentCount}</dd>
          </div>
        </dl>
      </Card>

      <PasswordForm />

      <Card className="bg-gray-50 text-sm text-gray-700">
        Changing your password does not sign you out on other devices — sessions
        are stateless tokens that stay valid until they expire. Sign out
        everywhere by clearing cookies on those devices.
      </Card>
    </div>
  );
}
