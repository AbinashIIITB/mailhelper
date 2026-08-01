import { Card, Skeleton } from "@/components/ui";

/**
 * Shown the instant a signed-in route is navigated to, while the server
 * renders it. Every page in this group queries Postgres before it can return
 * anything, so without a fallback the browser sits on the old page after a
 * click and the app feels stuck.
 */
export default function Loading() {
  return (
    <div className="space-y-5">
      <Skeleton className="h-8 w-48" />
      <div className="space-y-2">
        {[0, 1, 2].map((i) => (
          <Card key={i} className="flex items-center justify-between">
            <div className="space-y-2">
              <Skeleton className="h-4 w-56" />
              <Skeleton className="h-3 w-32" />
            </div>
            <Skeleton className="h-5 w-20" />
          </Card>
        ))}
      </div>
    </div>
  );
}
