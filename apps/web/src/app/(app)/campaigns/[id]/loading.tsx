import { Card, Skeleton } from "@/components/ui";

/**
 * The campaign page loads every recipient, so it is the slowest route in the
 * app and the one most worth showing a shaped placeholder for.
 */
export default function Loading() {
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-8 w-64" />
      </div>

      <Card className="space-y-3">
        <Skeleton className="h-6 w-52" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-40 w-full" />
      </Card>

      <Card className="space-y-3">
        <Skeleton className="h-6 w-44" />
        <Skeleton className="h-24 w-full" />
      </Card>
    </div>
  );
}
