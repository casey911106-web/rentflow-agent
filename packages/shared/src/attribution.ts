/**
 * Attribution helpers shared by API + web. The same logic that the inbound
 * router uses to extract source_code / post_code is also used by the web app
 * to preview a post package's prefilled WhatsApp text.
 */

export interface ParsedAttribution {
  propertyCode?: string;
  postCode?: string;
}

const PROPERTY_REGEX = /Property\s+(?<property>[A-Z0-9-]+)/i;
const POST_REGEX = /Post\s+(?<post>[A-Z0-9-]+)/i;

export function parseAttribution(text: string): ParsedAttribution {
  const property = text.match(PROPERTY_REGEX)?.groups?.['property'];
  const post = text.match(POST_REGEX)?.groups?.['post'];
  return {
    propertyCode: property ? property.toUpperCase() : undefined,
    postCode: post ? post.toUpperCase() : undefined,
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
