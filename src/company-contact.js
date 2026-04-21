export const CONTACT_EXPORT_FIELDS = [
  'SCB E-post',
  'SCB Telefon',
  'Allabolag telefon',
  'Allabolag telefon2',
  'Allabolag mobil',
  'Allabolag mobil2',
  'Allabolag fax',
  'Allabolag hemsida',
  'Allabolag e-post',
  'Allabolag marketingProtection',
  'Kontaktperson typ',
  'Kontaktperson namn',
  'Kontaktperson roll',
  'Kontaktperson id',
  'Kontaktperson födelsedatum',
  'Kontaktperson businessPerson',
];

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

function booleanField(value) {
  if (typeof value === 'boolean') {
    return String(value);
  }

  if (typeof value === 'string') {
    return value.trim();
  }

  return '';
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

export function buildContactExportFields(company) {
  const contactPerson =
    company?.contactPerson && typeof company.contactPerson === 'object'
      ? company.contactPerson
      : null;

  return {
    'SCB E-post': cleanValue(company?.['E-post']),
    'SCB Telefon': cleanValue(company?.['Telefon']),
    'Allabolag telefon': cleanValue(company?.phone ?? company?.['Allabolag telefon']),
    'Allabolag telefon2': cleanValue(company?.phone2 ?? company?.['Allabolag telefon2']),
    'Allabolag mobil': cleanValue(company?.mobile ?? company?.['Allabolag mobil']),
    'Allabolag mobil2': cleanValue(company?.mobile2 ?? company?.['Allabolag mobil2']),
    'Allabolag fax': cleanValue(company?.faxNumber ?? company?.['Allabolag fax']),
    'Allabolag hemsida': cleanValue(company?.homePage ?? company?.['Allabolag hemsida']),
    'Allabolag e-post': cleanValue(company?.email ?? company?.['Allabolag e-post']),
    'Allabolag marketingProtection': booleanField(
      company?.marketingProtection ?? company?.['Allabolag marketingProtection'],
    ),
    'Kontaktperson typ': cleanValue(contactPerson?.type ?? company?.['Kontaktperson typ']),
    'Kontaktperson namn': cleanValue(contactPerson?.name ?? company?.['Kontaktperson namn']),
    'Kontaktperson roll': cleanValue(contactPerson?.role ?? company?.['Kontaktperson roll']),
    'Kontaktperson id': cleanValue(contactPerson?.id ?? company?.['Kontaktperson id']),
    'Kontaktperson födelsedatum': cleanValue(
      contactPerson?.birthDate ?? company?.['Kontaktperson födelsedatum'],
    ),
    'Kontaktperson businessPerson': booleanField(
      contactPerson?.businessPerson ?? company?.['Kontaktperson businessPerson'],
    ),
  };
}

export function copyContactExportFields(company) {
  const fields = {};

  for (const fieldName of CONTACT_EXPORT_FIELDS) {
    fields[fieldName] = cleanValue(company?.[fieldName]);
  }

  return fields;
}

export function toCheckpointRow(company) {
  const row = {
    ...company,
    ...buildContactExportFields(company),
    'Primär e-post': getPrimaryEmail(company),
    'Primär telefon': getPrimaryPhone(company),
  };

  if (company?.contactPerson && typeof company.contactPerson === 'object') {
    row.contactPerson = JSON.stringify(company.contactPerson);
  }

  return row;
}
