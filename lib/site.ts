export const site = {
  name: "VCynic",
  supportEmail: "support@vcynic.ai",
  privacyEmail: "privacy@vcynic.ai",
  legalEntity: process.env.NEXT_PUBLIC_LEGAL_ENTITY_NAME || "VCynic (legal entity details pending)",
  address: process.env.NEXT_PUBLIC_BUSINESS_ADDRESS || "Business address pending before public launch",
  jurisdiction: process.env.NEXT_PUBLIC_GOVERNING_LAW || "Governing law pending before public launch",
};

export const launchDetailsMissing = site.legalEntity.includes("pending") || site.address.includes("pending") || site.jurisdiction.includes("pending");
