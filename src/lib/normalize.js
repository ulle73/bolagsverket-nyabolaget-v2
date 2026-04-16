function cleanValue(value) {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'string') return value;
  return value.replace(/\s+/g, ' ').trim();
}

function slugify(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function normalizeRow(row, outputColumns) {
  const normalized = {};

  for (const column of outputColumns) {
    normalized[column] = cleanValue(row[column] ?? '');
  }

  normalized.is_new_company = false;
  normalized.has_email = normalized['E-post'] !== '';
  normalized.has_phone = normalized['Telefon'] !== '';
  normalized.county_slug = slugify(normalized['Säteslän']);
  normalized.industry_slug = slugify(normalized['Bransch_1']);
  normalized.status_bucket = cleanValue(normalized['Företagsstatus']);

  return normalized;
}
