import { notFound } from "next/navigation";
import { prisma } from "@mailhelper/db";
import { requireUserId } from "@/lib/session";
import { CampaignEditor } from "./campaign-editor";

export default async function CampaignPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const userId = await requireUserId();
  const { id } = await params;

  const [campaign, smtp] = await Promise.all([
    prisma.campaign.findFirst({
      where: { id, userId },
      include: { recipients: { orderBy: { createdAt: "asc" } } },
    }),
    prisma.smtpConfig.findUnique({ where: { userId } }),
  ]);

  if (!campaign) notFound();

  return (
    <CampaignEditor
      smtpConnected={!!smtp}
      campaign={{
        id: campaign.id,
        name: campaign.name,
        subject: campaign.subject,
        bodyTemplate: campaign.bodyTemplate,
        status: campaign.status,
        total: campaign.total,
        sent: campaign.sent,
        failed: campaign.failed,
        recipients: campaign.recipients.map((r) => ({
          id: r.id,
          email: r.email,
          variables: (r.variables ?? {}) as Record<string, string>,
          status: r.status,
          error: r.error,
        })),
      }}
    />
  );
}
