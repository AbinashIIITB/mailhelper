/**
 * Client-safe copy of the template helpers in @mailhelper/core. Kept separate
 * so client components don't pull the core barrel (which imports nodemailer /
 * node:crypto) into the browser bundle.
 */

const PLACEHOLDER_RE = /\{\{\s*([\w.-]+)\s*\}\}/g;

export function extractPlaceholders(template: string): string[] {
  const found = new Set<string>();
  for (const match of template.matchAll(PLACEHOLDER_RE)) {
    found.add(match[1]);
  }
  return [...found];
}

export function mergeTemplate(
  template: string,
  variables: Record<string, unknown>,
): string {
  return template.replace(PLACEHOLDER_RE, (_full, name: string) => {
    const value = variables[name];
    if (value === undefined || value === null) return "";
    return String(value);
  });
}

export function missingColumns(
  placeholders: string[],
  columns: string[],
): string[] {
  const set = new Set(columns);
  return placeholders.filter((p) => !set.has(p));
}
