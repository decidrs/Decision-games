// Names are config, never hard-coded: clearance is pending (Tin Meteor, Outlier).
export const config = {
  studioName: process.env.STUDIO_NAME ?? "Tin Meteor",
  gameName: process.env.GAME_NAME ?? "Outlier",
  // Consent wording is a DRAFT until the week 2 text is approved. The version is stamped on every consent row.
  researchConsentWordingVersion: process.env.RESEARCH_CONSENT_WORDING_VERSION ?? "research-consent-DRAFT-0",
  pocketbaseUrl: process.env.POCKETBASE_URL ?? "http://127.0.0.1:8090",
};
