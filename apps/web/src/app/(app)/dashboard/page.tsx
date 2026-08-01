import Link from "next/link";
import { prisma } from "@mailhelper/db";
import { requireUserId } from "@/lib/session";
import { Badge, Button, Card } from "@/components/ui";

export default async function DashboardPage() {
  const userId = await requireUserId();

  const [smtp, campaigns] = await Promise.all([
    prisma.smtpConfig.findUnique({
      where: { userId },
      select: { id: true },
    }),
    prisma.campaign.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
      take: 5,
      select: {
        id: true,
        name: true,
        status: true,
        total: true,
        sent: true,
        failed: true,
      },
    }),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <Link href="/campaigns/new">
          <Button>New campaign</Button>
        </Link>
      </div>

      {!smtp && (
        <Card className="border-yellow-600 bg-yellow-50">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="font-bold">Connect your Gmail to start sending</p>
              <p className="text-sm text-gray-700">
                Add your Gmail address and an app password in Settings.
              </p>
            </div>
            <Link href="/settings">
              <Button>Connect Gmail</Button>
            </Link>
          </div>
        </Card>
      )}

      <div>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="ml-1 text-lg font-bold">Recent campaigns</h2>
          <Link href="/campaigns" className="text-sm text-blue-700">
            View all
          </Link>
        </div>
        {campaigns.length === 0 ? (
          <Card className="text-sm text-gray-600">
            No campaigns yet. Create your first one to get started.
          </Card>
        ) : (
          <div className="space-y-2">
            {campaigns.map((c) => (
              <Link key={c.id} href={`/campaigns/${c.id}`} className="block no-underline">
                <Card className="flex items-center justify-between hover:bg-gray-50">
                  <div>
                    <p className="font-bold text-black">{c.name}</p>
                    <p className="text-sm text-gray-600">
                      {c.sent}/{c.total} sent
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
    </div>
  );
}
