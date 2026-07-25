import { prisma } from "@mailhelper/db";
import { requireUserId } from "@/lib/session";
import { Card } from "@/components/ui";
import { SettingsForm } from "./settings-form";

export default async function SettingsPage() {
  const userId = await requireUserId();
  const smtp = await prisma.smtpConfig.findUnique({ where: { userId } });

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-sm text-gray-600">
          Connect the Gmail account Mail Helper will send from.
        </p>
      </div>

      <SettingsForm
        initial={
          smtp
            ? { gmailAddress: smtp.gmailAddress, fromName: smtp.fromName ?? "" }
            : null
        }
      />

      <Card className="bg-gray-50 text-sm">
        <p className="mb-2 font-bold">How to get a Google App Password</p>
        <ol className="list-decimal space-y-1 pl-5 text-gray-700">
          <li>
            Turn on 2-Step Verification at{" "}
            <a
              className="text-blue-700"
              href="https://myaccount.google.com/security"
              target="_blank"
              rel="noreferrer"
            >
              myaccount.google.com/security
            </a>
            .
          </li>
          <li>
            Go to{" "}
            <a
              className="text-blue-700"
              href="https://myaccount.google.com/apppasswords"
              target="_blank"
              rel="noreferrer"
            >
              App passwords
            </a>
            , create one named &ldquo;Mail Helper&rdquo;.
          </li>
          <li>Paste the 16-character password above. We store it encrypted.</li>
        </ol>
      </Card>
    </div>
  );
}
