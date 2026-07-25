"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Input, Label } from "@/components/ui";

export function SettingsForm({
  initial,
}: {
  initial: { gmailAddress: string; fromName: string } | null;
}) {
  const router = useRouter();
  const [gmailAddress, setGmailAddress] = useState(initial?.gmailAddress ?? "");
  const [fromName, setFromName] = useState(initial?.fromName ?? "");
  const [appPassword, setAppPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setOk(false);
    setLoading(true);

    const res = await fetch("/api/smtp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gmailAddress, appPassword, fromName }),
    });

    setLoading(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Something went wrong");
      return;
    }
    setOk(true);
    setAppPassword("");
    router.refresh();
  }

  return (
    <Card>
      <form onSubmit={onSubmit} className="space-y-3">
        <div>
          <Label htmlFor="gmail">Gmail address</Label>
          <Input
            id="gmail"
            type="email"
            placeholder="you@gmail.com"
            value={gmailAddress}
            onChange={(e) => setGmailAddress(e.target.value)}
            required
          />
        </div>
        <div>
          <Label htmlFor="fromName">From name (optional)</Label>
          <Input
            id="fromName"
            placeholder="Prof. Rao"
            value={fromName}
            onChange={(e) => setFromName(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="appPassword">App password</Label>
          <Input
            id="appPassword"
            type="password"
            placeholder={initial ? "already saved (re-enter to change)" : "xxxx xxxx xxxx xxxx"}
            value={appPassword}
            onChange={(e) => setAppPassword(e.target.value)}
            required
          />
          <p className="mt-1 text-xs text-gray-500">
            A 16-character Google App Password - not your normal Gmail password.
          </p>
        </div>

        {error && <p className="text-sm text-red-700">{error}</p>}
        {ok && <p className="text-sm text-green-700">Gmail connected and verified.</p>}

        <Button type="submit" disabled={loading}>
          {loading ? "Verifying..." : initial ? "Update connection" : "Connect Gmail"}
        </Button>
      </form>
    </Card>
  );
}
