// Shared notice and version. Consent is stamped by the server, never by UI time.
export const dataPolicyVersion = 'openai-standard-2026-10-15-v2';
export const subscriptionDataPolicyVersion = 'chatgpt-subscription-2026-10-16-v1';
export const hostedSubscriptionDataPolicyVersion = 'chatgpt-subscription-hosted-2026-10-17-v1';
export const hostedSubscriptionDataPolicyNotice = 'This app sends the story text and pictures needed for generation to the ChatGPT account used by its owner. That account’s data settings apply. Family details, chosen drawings and finished kits are saved privately on the app’s server. Original uploaded photos are removed after processing.';
export const subscriptionDataPolicyNotice = 'This local app sends the story and pictures to the ChatGPT account signed in on this Mac. That account’s ChatGPT data settings apply. It keeps your chosen drawings and finished kits. Uploaded original photos are removed after processing.';
export const subscriptionDataPolicyURL = 'https://openai.com/policies/privacy-policy/';
export const dataPolicyURL = 'https://developers.openai.com/api/docs/guides/your-data';
export const childDataPolicyURL = 'https://developers.openai.com/api/docs/guides/safety-checks/under-18-api-guidance';
export const childDataNotice = 'Real children under 13 need OpenAI zero data retention before their photos or personal story details can be sent. Parent permission alone does not replace that setting. Saved kits are still available.';
export function needsChildDataProtection(record, generationRoute = 'api') {
  if (generationRoute === 'subscription') return false;
  return record?.real === true && (!Number.isInteger(record.hero?.age) || record.hero.age < 13);
}
export const dataPolicyNotice = 'OpenAI receives the story text and photos needed to make your kit. API data is not used to train its models by default. Standard abuse-monitoring logs may keep content for up to 30 days, or longer when law or safety requires it. This app does not keep your original photos. Turning response storage off does not mean OpenAI keeps nothing.';
export const dataPolicyConsentLabel = 'I am a parent or guardian. I understand this notice.';
export function hasCurrentDataConsent(record, version = dataPolicyVersion) {
  const consent = record?.dataPolicyConsent;
  return consent?.accepted === true && consent.version === version && typeof consent.acceptedAt === 'string' && Number.isFinite(Date.parse(consent.acceptedAt)) && !consent.revokedAt;
}
