/**
 * Schema for self-describing system docs. Each scheduler / feature /
 * integration registers a SystemDoc at module init. The /system/* endpoints
 * surface them, the dashboard renders them. When code changes the
 * description, the page reflects it on the next deploy.
 *
 * The convention is: keep docs co-located with the code they describe (as a
 * static class member or const next to the module wiring), so that drift
 * between behavior and documentation requires actively editing the file.
 */
export type SystemDocCategory =
  | 'automation'
  | 'feature'
  | 'integration'
  | 'data-model';

export interface SystemDocConfigurable {
  /** ENV variable or settings key */
  key: string;
  default?: string;
  description?: string;
}

export interface SystemDoc {
  /** Stable identifier — used as URL anchor and dedup key. */
  id: string;
  category: SystemDocCategory;
  /** Short human-readable name shown as the card title. */
  name: string;
  /** ≤ 140 chars summary shown in the list view. */
  shortDescription: string;
  /** Multi-line markdown allowed. Renders inside the card. */
  longDescription: string;
  /** For automations: cron expression in plain English. */
  schedule?: string;
  /** What kicks it off (cron, webhook, button click, etc.). */
  triggers?: string[];
  /** Side effects in user-facing language. */
  effects?: string[];
  /** Env vars / settings the operator can change to tune behavior. */
  configurables?: SystemDocConfigurable[];
  /** "Why this exists" — the operational reason. */
  rationale?: string;
  /** "What you'd see if it stops working" — failure mode hints. */
  observability?: string[];
  /** File paths relative to repo root, for support / debugging. */
  sourceFiles?: string[];
  /** Link inside the dashboard, if relevant (e.g. '/suggestions'). */
  link?: string;
}
