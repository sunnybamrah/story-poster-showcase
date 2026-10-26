import { dataPolicyVersion, hasCurrentDataConsent, needsChildDataProtection, childDataNotice } from '../app/data-policy.js';
// Sunny approved standard API policy on October 15. This is not ZDR approval.
export const config = { zeroRetentionApproved: false, standardDataPolicyAllowed: true, familyDataSetupAllowed: true };
export function recordDataConsent(input, now = () => new Date(), version = config.dataPolicyVersion ?? dataPolicyVersion) {
  if (input?.accepted !== true || input.version !== version) throw new Error('Read and accept the current OpenAI data notice first.');
  return { accepted: true, version, acceptedAt: now().toISOString() };
}
export function assertFamilyAllowed(record, settings = config) {
  if (record?.real !== true || settings.zeroRetentionApproved === true) return;
  if (settings.standardDataPolicyAllowed === true && hasCurrentDataConsent(record, settings.dataPolicyVersion ?? dataPolicyVersion)) {
    if (!settings.subscriptionMode) assertChildDataAllowed(record); return;
  }
  throw new Error(settings.standardDataPolicyAllowed === true ? 'Real family details need your permission. Read and accept the current OpenAI data notice.' : 'real families wait for zero retention approval');
}
export function assertPhotoAllowed(record, settings = config, { allowSyntheticPortraits = false } = {}) {
  if (settings.zeroRetentionApproved === true || allowSyntheticPortraits && record?.real === false) return;
  if (settings.standardDataPolicyAllowed === true && hasCurrentDataConsent(record, settings.dataPolicyVersion ?? dataPolicyVersion)) {
    if (!settings.subscriptionMode) assertChildDataAllowed(record); return;
  }
  throw Object.assign(new Error('Photo use needs your permission. Read and accept the current OpenAI data notice.'), { status: 403 });
}
function assertChildDataAllowed(record) {
  if (needsChildDataProtection(record)) throw Object.assign(new Error(childDataNotice), { status: 403, code: 'CHILD_DATA_REQUIRES_ZDR' });
}
