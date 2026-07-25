import Papa from "papaparse";

export interface ParsedRecipients {
  /** Variable column names, excluding the email column. */
  columns: string[];
  rows: { email: string; variables: Record<string, string> }[];
  /** Rows that had a missing/invalid email address (by 1-based input row). */
  invalidRows: number[];
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function findEmailKey(fields: string[]): string | null {
  return (
    fields.find((f) => /^e-?mail(\s*address)?$/i.test(f.trim())) ??
    fields.find((f) => /mail/i.test(f)) ??
    null
  );
}

/**
 * Parse a delimited blob (CSV from a file, or TSV/CSV pasted from a sheet).
 * The first row must be headers, one of which is an email column.
 */
export function parseDelimited(text: string): ParsedRecipients | { error: string } {
  const result = Papa.parse<Record<string, string>>(text.trim(), {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim(),
  });

  const fields = (result.meta.fields ?? []).filter(Boolean);
  if (fields.length === 0) {
    return { error: "No columns found. The first row should be headers." };
  }

  const emailKey = findEmailKey(fields);
  if (!emailKey) {
    return {
      error: "No email column found. Add a column named 'email'.",
    };
  }

  const columns = fields.filter((f) => f !== emailKey);
  const rows: ParsedRecipients["rows"] = [];
  const invalidRows: number[] = [];

  result.data.forEach((row, i) => {
    const email = (row[emailKey] ?? "").trim();
    if (!EMAIL_RE.test(email)) {
      if (email || Object.values(row).some((v) => v && v.trim())) {
        invalidRows.push(i + 2); // +2: 1-based + header row
      }
      return;
    }
    const variables: Record<string, string> = {};
    for (const col of columns) variables[col] = (row[col] ?? "").trim();
    rows.push({ email, variables });
  });

  return { columns, rows, invalidRows };
}

export function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(email.trim());
}
