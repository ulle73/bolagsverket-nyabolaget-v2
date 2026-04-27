export const CONTACT_EXPORT_FIELDS = [];

export function cleanValue(value) {
  if (value === null || value === undefined) {
    return '';
  }

  if (typeof value === 'string') {
    return value.trim();
  }

  return value;
}

export function hasValue(value) {
  return Boolean(String(value ?? '').trim());
}

export function isAktiebolag(company) {
  return /aktiebolag/i.test(cleanValue(company?.['Juridisk form']));
}

export function isMarketingProtected(company) {
  return (
    company?.marketingProtection === true ||
    String(company?.['Allabolag marketingProtection'] ?? '').trim().toLowerCase() === 'true'
  );
}

export function getPrimaryEmail(company) {
  const primary = cleanValue(company?.['E-post']);
  if (primary) {
    return primary;
  }

  return cleanValue(company?.email ?? company?.['Allabolag e-post']);
}

export function getPrimaryPhone(company) {
  const candidates = [
    company?.['Telefon'],
    company?.phone,
    company?.mobile,
    company?.phone2,
    company?.mobile2,
    company?.['Allabolag telefon'],
    company?.['Allabolag mobil'],
    company?.['Allabolag telefon2'],
    company?.['Allabolag mobil2'],
  ];

  for (const candidate of candidates) {
    const cleaned = cleanValue(candidate);
    if (cleaned) {
      return cleaned;
    }
  }

  return '';
}

export function buildContactExportFields() {
  return {};
}

export function copyContactExportFields() {
  return {};
}

export function toCheckpointRow(company) {
  return {
    ...company,
    'Primär e-post': getPrimaryEmail(company),
    'Primär telefon': getPrimaryPhone(company),
  };
}
