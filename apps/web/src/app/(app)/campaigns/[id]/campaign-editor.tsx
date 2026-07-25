"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, Input, Label, Textarea, cn } from "@/components/ui";
import { extractPlaceholders, mergeTemplate, missingColumns } from "@/lib/template";
import { parseDelimited, isValidEmail } from "@/lib/recipients";

type Row = { email: string; variables: Record<string, string> };

interface CampaignData {
  id: string;
  name: string;
  subject: string;
  bodyTemplate: string;
  status: string;
  total: number;
  sent: number;
  failed: number;
  recipients: {
    id: string;
    email: string;
    variables: Record<string, string>;
    status: string;
    error: string | null;
  }[];
}

export function CampaignEditor({
  campaign,
  smtpConnected,
}: {
  campaign: CampaignData;
  smtpConnected: boolean;
}) {
  const router = useRouter();
  const locked = campaign.status === "queued" || campaign.status === "sending";
  const showStatus = campaign.status !== "draft";

  const [subject, setSubject] = useState(campaign.subject);
  const [body, setBody] = useState(campaign.bodyTemplate);

  const initialColumns = useMemo(() => {
    const set = new Set<string>();
    for (const r of campaign.recipients)
      Object.keys(r.variables).forEach((k) => set.add(k));
    return [...set];
  }, [campaign.recipients]);

  const [columns, setColumns] = useState<string[]>(initialColumns);
  const [rows, setRows] = useState<Row[]>(
    campaign.recipients.map((r) => ({ email: r.email, variables: r.variables })),
  );
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const placeholders = useMemo(
    () => extractPlaceholders(`${subject}\n${body}`),
    [subject, body],
  );
  const missing = useMemo(
    () => missingColumns(placeholders, columns),
    [placeholders, columns],
  );

  useEffect(() => {
    if (!locked) return;
    const t = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(t);
  }, [locked, router]);

  const previewVars: Record<string, string> = useMemo(() => {
    if (rows[0]) return { email: rows[0].email, ...rows[0].variables };
    const sample: Record<string, string> = {};
    for (const c of columns) sample[c] = `[${c}]`;
    return sample;
  }, [rows, columns]);

  async function saveTemplate() {
    await fetch(`/api/campaigns/${campaign.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: campaign.name, subject, bodyTemplate: body }),
    });
  }

  async function saveRecipients() {
    setError(null);
    const invalid = rows.filter((r) => !isValidEmail(r.email));
    if (invalid.length) {
      setError(`${invalid.length} row(s) have an invalid email address.`);
      return false;
    }
    setSaving(true);
    const res = await fetch(`/api/campaigns/${campaign.id}/recipients`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recipients: rows.map((r) => ({ email: r.email, variables: r.variables })),
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Could not save recipients");
      return false;
    }
    setDirty(false);
    setNotice("Recipients saved");
    return true;
  }

  function applyParsed(text: string, replace: boolean) {
    setError(null);
    const parsed = parseDelimited(text);
    if ("error" in parsed) {
      setError(parsed.error);
      return;
    }
    const newRows = parsed.rows;
    setColumns(replace ? parsed.columns : mergeCols(columns, parsed.columns));
    setRows(replace ? newRows : [...rows, ...newRows]);
    setDirty(true);
    setNotice(
      `Loaded ${newRows.length} recipient(s)` +
        (parsed.invalidRows.length
          ? ` - skipped ${parsed.invalidRows.length} row(s) with a bad email`
          : ""),
    );
  }

  async function onSend() {
    setError(null);
    if (!smtpConnected) {
      setError("Connect your Gmail in Settings first.");
      return;
    }
    if (!subject.trim()) return setError("Add a subject.");
    if (rows.length === 0) return setError("Add at least one recipient.");
    if (missing.length)
      return setError(`These placeholders have no column: ${missing.join(", ")}`);

    setSaving(true);
    await saveTemplate();
    const ok = await saveRecipients();
    if (!ok) {
      setSaving(false);
      return;
    }
    const res = await fetch(`/api/campaigns/${campaign.id}/send`, {
      method: "POST",
    });
    setSaving(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Could not start sending");
      return;
    }
    router.refresh();
  }

  async function onResendFailed() {
    setSaving(true);
    await fetch(`/api/campaigns/${campaign.id}/resend-failed`, {
      method: "POST",
    });
    setSaving(false);
    router.refresh();
  }

  async function onDelete() {
    if (!confirm("Delete this campaign? This cannot be undone.")) return;
    await fetch(`/api/campaigns/${campaign.id}`, { method: "DELETE" });
    router.push("/campaigns");
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/campaigns" className="text-sm text-blue-700">
            &lt; Campaigns
          </Link>
          <h1 className="text-2xl font-bold">{campaign.name}</h1>
          <Badge status={campaign.status} />
        </div>
        <Button variant="ghost" onClick={onDelete} className="text-red-700">
          Delete
        </Button>
      </div>

      {!smtpConnected && (
        <Card className="border-yellow-600 bg-yellow-50 text-sm">
          Connect your Gmail in{" "}
          <Link href="/settings" className="text-blue-700">
            Settings
          </Link>{" "}
          before sending.
        </Card>
      )}

      {showStatus && (
        <StatusPanel
          campaign={campaign}
          locked={locked}
          onResendFailed={onResendFailed}
          busy={saving}
        />
      )}

      {/* Template / message */}
      <Card className="space-y-3">
        <h2 className="text-lg font-bold">1. Write your message</h2>
        <div>
          <Label htmlFor="subject">Subject</Label>
          <Input
            id="subject"
            value={subject}
            disabled={locked}
            onChange={(e) => setSubject(e.target.value)}
            onBlur={saveTemplate}
            placeholder="Your marks, {{ name }}"
          />
        </div>
        <div>
          <Label htmlFor="body">Body</Label>
          <Textarea
            id="body"
            rows={8}
            value={body}
            disabled={locked}
            onChange={(e) => setBody(e.target.value)}
            onBlur={saveTemplate}
            placeholder={"Hi {{ name }},\n\nYour score is {{ marks }}.\n\nRegards"}
          />
          <p className="mt-1 text-xs text-gray-600">
            Type <code className="border border-gray-400 bg-gray-100 px-1">{"{{ column }}"}</code>{" "}
            anywhere to fill in each person&rsquo;s value.
          </p>
        </div>

        {placeholders.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-gray-600">Blanks used:</span>
            {placeholders.map((p) => (
              <span
                key={p}
                className={cn(
                  "border px-2 py-0.5 font-mono",
                  missing.includes(p)
                    ? "border-red-700 bg-red-100 text-red-800"
                    : "border-green-700 bg-green-100 text-green-800",
                )}
              >
                {p}
              </span>
            ))}
            {missing.length > 0 && (
              <span className="text-red-700">
                - add a column below for the red one{missing.length > 1 ? "s" : ""}
              </span>
            )}
          </div>
        )}

        <Preview
          subject={mergeTemplate(subject, previewVars)}
          body={mergeTemplate(body, previewVars)}
        />
      </Card>

      {/* Recipients */}
      <RecipientsSection
        locked={locked}
        columns={columns}
        rows={rows}
        placeholders={placeholders}
        setColumns={setColumns}
        setRows={setRows}
        setDirty={setDirty}
        applyParsed={applyParsed}
      />

      {error && <p className="text-sm text-red-700">{error}</p>}
      {notice && !error && <p className="text-sm text-green-700">{notice}</p>}

      {!locked && (
        <div className="flex items-center gap-3 border-t-2 border-gray-400 pt-4">
          {dirty && (
            <Button variant="secondary" onClick={saveRecipients} disabled={saving}>
              Save recipients
            </Button>
          )}
          <Button onClick={onSend} disabled={saving}>
            {saving
              ? "Working..."
              : `Send to ${rows.length} recipient${rows.length === 1 ? "" : "s"}`}
          </Button>
        </div>
      )}
    </div>
  );
}

function mergeCols(a: string[], b: string[]): string[] {
  const set = new Set(a);
  for (const c of b) set.add(c);
  return [...set];
}

function Preview({ subject, body }: { subject: string; body: string }) {
  return (
    <div className="border border-gray-500 bg-gray-50 p-3 text-sm">
      <p className="mb-1 text-xs font-bold uppercase text-gray-500">
        Preview (first recipient)
      </p>
      <p className="font-bold">{subject || "(no subject)"}</p>
      <p className="mt-2 whitespace-pre-wrap text-gray-800">
        {body || "(empty body)"}
      </p>
    </div>
  );
}

function StatusPanel({
  campaign,
  locked,
  onResendFailed,
  busy,
}: {
  campaign: CampaignData;
  locked: boolean;
  onResendFailed: () => void;
  busy: boolean;
}) {
  const pct = campaign.total
    ? Math.round(((campaign.sent + campaign.failed) / campaign.total) * 100)
    : 0;
  return (
    <Card className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">Sending status</h2>
        {campaign.failed > 0 && !locked && (
          <Button variant="secondary" onClick={onResendFailed} disabled={busy}>
            Resend {campaign.failed} failed
          </Button>
        )}
      </div>
      <div className="h-3 w-full border border-gray-500 bg-white">
        <div className="h-full bg-blue-700" style={{ width: `${pct}%` }} />
      </div>
      <div className="flex gap-6 text-sm">
        <span>{campaign.total} total</span>
        <span className="text-green-700">{campaign.sent} sent</span>
        <span className="text-red-700">{campaign.failed} failed</span>
        {locked && <span className="text-gray-500">refreshing...</span>}
      </div>

      {campaign.recipients.length > 0 && (
        <div className="max-h-72 overflow-auto border border-gray-500">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-gray-200 text-xs uppercase text-gray-700">
              <tr>
                <th className="border-b border-gray-400 px-3 py-2">Email</th>
                <th className="border-b border-gray-400 px-3 py-2">Status</th>
                <th className="border-b border-gray-400 px-3 py-2">Error</th>
              </tr>
            </thead>
            <tbody>
              {campaign.recipients.map((r) => (
                <tr key={r.id} className="border-t border-gray-200">
                  <td className="px-3 py-2">{r.email}</td>
                  <td className="px-3 py-2">
                    <Badge status={r.status} />
                  </td>
                  <td className="max-w-xs truncate px-3 py-2 text-xs text-red-700">
                    {r.error ?? ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function RecipientsSection({
  locked,
  columns,
  rows,
  placeholders,
  setColumns,
  setRows,
  setDirty,
  applyParsed,
}: {
  locked: boolean;
  columns: string[];
  rows: Row[];
  placeholders: string[];
  setColumns: (c: string[]) => void;
  setRows: (r: Row[]) => void;
  setDirty: (d: boolean) => void;
  applyParsed: (text: string, replace: boolean) => void;
}) {
  const [tab, setTab] = useState<"upload" | "paste" | "manual">("upload");
  const [manualView, setManualView] = useState<"list" | "table">("list");
  const [pasteText, setPasteText] = useState("");
  const [newCol, setNewCol] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  // Columns the message actually needs (its blanks), excluding email.
  const templateCols = placeholders.filter((p) => p !== "email");

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => applyParsed(String(reader.result ?? ""), true);
    reader.readAsText(file);
    if (fileRef.current) fileRef.current.value = "";
  }

  function updateCell(i: number, key: string, value: string) {
    const next = rows.slice();
    if (key === "email") next[i] = { ...next[i], email: value };
    else
      next[i] = {
        ...next[i],
        variables: { ...next[i].variables, [key]: value },
      };
    setRows(next);
    setDirty(true);
  }

  function addRow(cols: string[]) {
    const variables: Record<string, string> = {};
    for (const c of cols) variables[c] = "";
    setRows([...rows, { email: "", variables }]);
    setDirty(true);
  }

  function removeRow(i: number) {
    setRows(rows.filter((_, idx) => idx !== i));
    setDirty(true);
  }

  function addColumn() {
    const name = newCol.trim();
    if (!name || columns.includes(name) || name === "email") return;
    setColumns([...columns, name]);
    setRows(
      rows.map((r) => ({ ...r, variables: { ...r.variables, [name]: "" } })),
    );
    setNewCol("");
    setDirty(true);
  }

  // Table view: force the grid columns to match the message's blanks.
  function useTemplateColumns() {
    setColumns(templateCols);
    setRows(
      rows.map((r) => {
        const variables: Record<string, string> = {};
        for (const c of templateCols) variables[c] = r.variables[c] ?? "";
        return { email: r.email, variables };
      }),
    );
    setDirty(true);
  }

  function switchManualView(view: "list" | "table") {
    setManualView(view);
    if (view === "table") useTemplateColumns();
  }

  const tabs = [
    { id: "upload" as const, label: "Upload CSV" },
    { id: "paste" as const, label: "Paste from sheet" },
    { id: "manual" as const, label: "Manual" },
  ];

  return (
    <Card className="space-y-3">
      <h2 className="text-lg font-bold">
        2. Add recipients{" "}
        <span className="text-sm font-normal text-gray-500">({rows.length})</span>
      </h2>

      {/* Instructions for new users */}
      <div className="border border-blue-700 bg-blue-50 p-3 text-sm text-gray-800">
        <p className="mb-1 font-bold">How this works</p>
        <ul className="ml-4 list-disc space-y-1">
          <li>
            Each recipient needs an <b>email</b> address and one value for every
            blank in your message.
          </li>
          <li>
            Example: if your message says{" "}
            <code className="border border-gray-400 bg-white px-1">
              Hi {"{{ name }}"}, your score is {"{{ marks }}"}
            </code>
            , then every recipient needs a <b>name</b> and <b>marks</b> value.
          </li>
          <li>
            Pick a way to add them below. <b>Upload CSV</b> or{" "}
            <b>Paste from sheet</b> is easiest for many people;{" "}
            <b>Manual</b> is good for just a few.
          </li>
          <li>
            The first row of a CSV/paste must be the column names, and one column
            must be called <b>email</b>.
          </li>
        </ul>
      </div>

      {!locked && (
        <>
          <div className="flex border border-gray-500 text-sm">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  "flex-1 border-r border-gray-500 px-3 py-2 last:border-r-0",
                  tab === t.id ? "bg-blue-700 text-white" : "bg-white text-black",
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          {tab === "upload" && (
            <div className="border border-dashed border-gray-500 p-5 text-sm">
              <p className="mb-1 font-bold">Upload a CSV file</p>
              <p className="mb-3 text-gray-700">
                A CSV has a header row (the column names), then one row per person.
                One column must be <b>email</b>. The other columns become the
                blanks in your message. You can export a CSV from Excel or Google
                Sheets (File &gt; Download &gt; CSV).
              </p>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv"
                onChange={onFile}
                className="block text-sm"
              />
            </div>
          )}

          {tab === "paste" && (
            <div className="space-y-2">
              <p className="text-sm text-gray-700">
                Copy the cells from Excel/Google Sheets (including the header row)
                and paste them in the box. You can also just type them separated by
                commas.
              </p>
              <Textarea
                rows={6}
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                placeholder={"email,name,marks\nasha@x.com,Asha,88\nravi@x.com,Ravi,73"}
              />
              <Button
                variant="secondary"
                onClick={() => {
                  applyParsed(pasteText, true);
                  setPasteText("");
                }}
              >
                Load pasted rows
              </Button>
            </div>
          )}

          {tab === "manual" && (
            <div className="space-y-3">
              <p className="text-sm text-gray-700">
                Type recipients in one at a time. Choose a view:
              </p>
              {/* Two manual views: List view and Table view */}
              <div className="flex border border-gray-500 text-sm">
                <button
                  onClick={() => switchManualView("list")}
                  className={cn(
                    "flex-1 border-r border-gray-500 px-3 py-1.5",
                    manualView === "list"
                      ? "bg-gray-200 font-bold text-black"
                      : "bg-white text-black",
                  )}
                >
                  List view
                </button>
                <button
                  onClick={() => switchManualView("table")}
                  className={cn(
                    "flex-1 px-3 py-1.5",
                    manualView === "table"
                      ? "bg-gray-200 font-bold text-black"
                      : "bg-white text-black",
                  )}
                >
                  Table view
                </button>
              </div>

              {manualView === "list" ? (
                <div className="space-y-2">
                  <p className="text-xs text-gray-600">
                    Add your own columns, then add rows and fill each cell.
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <Input
                      value={newCol}
                      onChange={(e) => setNewCol(e.target.value)}
                      placeholder="New column name (e.g. marks)"
                      className="max-w-xs"
                    />
                    <Button variant="secondary" onClick={addColumn}>
                      Add column
                    </Button>
                    <Button variant="secondary" onClick={() => addRow(columns)}>
                      Add row
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs text-gray-600">
                    The columns below are created automatically from the blanks in
                    your message
                    {templateCols.length > 0
                      ? `: ${templateCols.join(", ")}.`
                      : ". Write your message above with {{ blanks }} to create columns."}{" "}
                    Just add rows and fill them in.
                  </p>
                  <div className="flex items-center gap-2">
                    <Button variant="secondary" onClick={() => addRow(templateCols)}>
                      Add row
                    </Button>
                    <Button variant="secondary" onClick={useTemplateColumns}>
                      Refresh columns from message
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {rows.length > 0 && (
        <div className="overflow-x-auto border border-gray-500">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-200 text-xs uppercase text-gray-700">
              <tr>
                <th className="border-b border-r border-gray-400 px-3 py-2">email</th>
                {columns.map((c) => (
                  <th key={c} className="border-b border-r border-gray-400 px-3 py-2">
                    {c}
                  </th>
                ))}
                {!locked && <th className="w-8 border-b border-gray-400" />}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-t border-gray-200">
                  <td className="border-r border-gray-200 px-1 py-1">
                    <CellInput
                      value={r.email}
                      locked={locked}
                      onChange={(v) => updateCell(i, "email", v)}
                    />
                  </td>
                  {columns.map((c) => (
                    <td key={c} className="border-r border-gray-200 px-1 py-1">
                      <CellInput
                        value={r.variables[c] ?? ""}
                        locked={locked}
                        onChange={(v) => updateCell(i, c, v)}
                      />
                    </td>
                  ))}
                  {!locked && (
                    <td className="px-2 text-center">
                      <button
                        onClick={() => removeRow(i)}
                        className="text-gray-500 hover:text-red-700"
                        aria-label="Remove row"
                      >
                        X
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function CellInput({
  value,
  onChange,
  locked,
}: {
  value: string;
  onChange: (v: string) => void;
  locked: boolean;
}) {
  return (
    <input
      value={value}
      disabled={locked}
      onChange={(e) => onChange(e.target.value)}
      className="w-full min-w-32 bg-transparent px-2 py-1 text-sm outline-none focus:bg-yellow-50 disabled:opacity-70"
    />
  );
}
