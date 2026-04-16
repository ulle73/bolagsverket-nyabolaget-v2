import {
  ALLOWED_BOLAGSSTATUS,
  ALLOWED_COMPANY_STATUSES,
} from '../config.js';

export function isRelevantNewCompany(row) {
  return (
    row['Registreringsdatum'] !== '' &&
    row['Slutdatum'] === '' &&
    row['Bolagsstatus'] === ALLOWED_BOLAGSSTATUS &&
    ALLOWED_COMPANY_STATUSES.has(row['Företagsstatus'])
  );
}

export function splitRows(rows) {
  const full = rows.filter(isRelevantNewCompany).map((row) => ({
    ...row,
    is_new_company: true,
  }));

  const mailOnly = full.filter((row) => row.has_email);

  return { full, mailOnly };
}

export function groupByCounty(rows) {
  return rows.reduce((acc, row) => {
    const key = row.county_slug || 'okant-lan';
    if (!acc[key]) acc[key] = [];
    acc[key].push(row);
    return acc;
  }, {});
}
