/**
 * Plain string unions for AI conversation state machines, shared between
 * API and dashboard so the WhatsApp console UI can label states correctly.
 */

export const LEAD_STATES = [
  'initial_contact',
  'identify_property',
  'collect_move_in_date',
  'collect_people_count',
  'collect_budget',
  'collect_area',
  'collect_duration',
  'qualify_lead',
  'suggest_property',
  'ask_viewing_time',
  'schedule_viewing',
  'confirm_viewing',
  'follow_up',
  'human_takeover',
  'closed',
] as const;
export type LeadState = (typeof LEAD_STATES)[number];

export const OWNER_STATES = [
  'ask_availability',
  'parse_response',
  'ask_until_when',
  'confirm_price',
  'update_calendar',
  'notify_admin',
  'closed',
] as const;
export type OwnerState = (typeof OWNER_STATES)[number];

export const FEEDBACK_STATES = [
  'request_rating',
  'request_comments',
  'ask_booking_interest',
  'update_agent_score',
  'closed',
] as const;
export type FeedbackState = (typeof FEEDBACK_STATES)[number];

export type Machine = 'lead' | 'owner' | 'feedback';
