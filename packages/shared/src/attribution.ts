/**
 * Attribution helpers shared by API + web. The same logic that the inbound
 * router uses to extract source_code / post_code is also used by the web app
 * to preview a post package's prefilled WhatsApp text.
 */

export interface ParsedAttribution {
  propertyCode?: string;
  postCode?: string;
  /**
   * PostPlacement.trackingSlug stamped onto the marketplace link from owned
   * channel posts (Telegram, IG, FB pages). When present, it identifies the
   * exact piece of content that produced the lead.
   */
  placementSlug?: string;
}

const PROPERTY_REGEX = /Property\s+(?<property>[A-Z0-9-]+)/i;
const POST_REGEX = /Post\s+(?<post>[A-Z0-9-]+)/i;
// `[ref:ABCD1234]` — short alphanumeric placement slug (8 chars usually).
const PLACEMENT_REGEX = /\[ref:(?<slug>[A-Z0-9]{4,16})\]/i;

export function parseAttribution(text: string): ParsedAttribution {
  const property = text.match(PROPERTY_REGEX)?.groups?.['property'];
  const post = text.match(POST_REGEX)?.groups?.['post'];
  const slug = text.match(PLACEMENT_REGEX)?.groups?.['slug'];
  return {
    propertyCode: property ? property.toUpperCase() : undefined,
    postCode: post ? post.toUpperCase() : undefined,
    placementSlug: slug ? slug.toUpperCase() : undefined,
  };
}

export interface BuildPrefilledTextInput {
  propertyCode: string;
  postCode: string;
}

export function buildPrefilledText(input: BuildPrefilledTextInput): string {
  return `Hi, I am interested in Property ${input.propertyCode} from Post ${input.postCode}`;
}

export interface BuildClickToChatInput extends BuildPrefilledTextInput {
  waMeBaseUrl: string;
}

export function buildClickToChatUrl(input: BuildClickToChatInput): string {
  const text = buildPrefilledText(input);
  return `${input.waMeBaseUrl}?text=${encodeURIComponent(text)}`;
}
