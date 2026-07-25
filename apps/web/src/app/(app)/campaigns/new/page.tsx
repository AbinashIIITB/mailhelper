"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Input, Label } from "@/components/ui";

export default function NewCampaignPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const res = await fetch("/api/campaigns", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });

    if (!res.ok) {
      setError("Could not create campaign");
      setLoading(false);
      return;
    }
    const { id } = await res.json();
    router.push(`/campaigns/${id}`);
  }

  return (
    <div className="mx-auto max-w-lg space-y-5">
      <h1 className="text-2xl font-bold">New campaign</h1>
      <Card>
        <form onSubmit={onSubmit} className="space-y-3">
          <div>
            <Label htmlFor="name">Campaign name</Label>
            <Input
              id="name"
              placeholder="Semester 1 marks"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoFocus
            />
            <p className="mt-1 text-xs text-gray-500">
              Just for your reference - recipients won&rsquo;t see this.
            </p>
          </div>
          {error && <p className="text-sm text-red-700">{error}</p>}
          <Button type="submit" disabled={loading}>
            {loading ? "Creating..." : "Create"}
          </Button>
        </form>
      </Card>
    </div>
  );
}
