/**
 * Minimal Mustache-style interpolator for prompt templates pulled from the DB.
 * Supports `{{path.to.value}}`. Missing values become empty strings.
 */

const PLACEHOLDER_REGEX = /\{\{\s*([\w.]+)\s*\}\}/g;

export function renderTemplate(template: string, vars: Record<string, unknown>): string {
  return template.replace(PLACEHOLDER_REGEX, (_, path: string) => {
    const value = path.split('.').reduce<unknown>((acc, key) => {
      if (acc && typeof acc === 'object' && key in (acc as Record<string, unknown>)) {
        return (acc as Record<string, unknown>)[key];
      }
      return undefined;
    }, vars);
    return value === undefined || value === null ? '' : String(value);
  });
}
