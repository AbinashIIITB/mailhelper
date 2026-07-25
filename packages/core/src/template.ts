/**
 * Lightweight mustache-style template merge for campaigns.
 *
 * Placeholders use `{{ variableName }}` syntax. Variable names are matched
 * case-sensitively against recipient column keys. Whitespace inside the
 * braces is ignored.
 */

const PLACEHOLDER_RE = /\{\{\s*([\w.-]+)\s*\}\}/g;

export type Variables = Record<string, unknown>;

/** Extract the unique set of placeholder names used in a template string. */
export function extractPlaceholders(template: string): string[] {
  const found = new Set<string>();
  for (const match of template.matchAll(PLACEHOLDER_RE)) {
    found.add(match[1]);
  }
  return [...found];
}

/** Replace every `{{ name }}` with the matching value; missing → empty string. */
export function mergeTemplate(template: string, variables: Variables): string {
  return template.replace(PLACEHOLDER_RE, (_full, name: string) => {
    const value = variables[name];
    if (value === undefined || value === null) return '';
    return String(value);
  });
}

/**
 * Given a template's placeholders and the columns available on recipients,
 * return the placeholders that have no matching column.
 */
export function missingColumns(
  placeholders: string[],
  columns: string[],
): string[] {
  const set = new Set(columns);
  return placeholders.filter((p) => !set.has(p));
}
