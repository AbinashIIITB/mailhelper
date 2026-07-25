import Link from "next/link";
import { prisma } from "@mailhelper/db";
import { requireUserId } from "@/lib/session";
import { Badge, Button, Card } from "@/components/ui";

export default async function CampaignsPage() {
  const userId = await requireUserId();
  const campaigns = await prisma.campaign.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
  });

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Campaigns</h1>
        <Link href="/campaigns/new">
          <Button>New campaign</Button>
        </Link>
      </div>

      {campaigns.length === 0 ? (
        <Card className="text-sm text-gray-600">No campaigns yet.</Card>
      ) : (
        <div className="space-y-2">
          {campaigns.map((c) => (
            <Link key={c.id} href={`/campaigns/${c.id}`} className="block no-underline">
              <Card className="flex items-center justify-between hover:bg-gray-50">
                <div>
                  <p className="font-bold text-black">{c.name}</p>
                  <p className="text-sm text-gray-600">
                    {c.total} recipient{c.total === 1 ? "" : "s"} - {c.sent} sent
                    {c.failed > 0 && ` - ${c.failed} failed`}
                  </p>
                </div>
                <Badge status={c.status} />
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
