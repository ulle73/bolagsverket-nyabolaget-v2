export const REQUIRED_OUTPUT_COLUMNS = [
  'OrgNr',
  'PeOrgNr',
  'Företagsnamn',
  'Firma',
  'COAdress',
  'PostAdress',
  'PostNr',
  'PostOrt',
  'Säteskommun, kod',
  'Säteskommun',
  'Säteslän, kod',
  'Säteslän',
  'Aregion, kod',
  'ARegion',
  'Registreringsdatum',
  'Startdatum',
  'Slutdatum',
  'Företagsstatus, kod',
  'Företagsstatus',
  'Bolagsstatus, kod',
  'Bolagsstatus',
  'Registrerad hos SKV, kod',
  'Registrerad hos SKV',
  'Juridisk form, kod',
  'Juridisk form',
  'Privat/Publikt, kod',
  'Privat/Publikt',
  'E-post',
  'Telefon',
  'Bransch_1, kod',
  'Bransch_1P, kod',
  'Bransch_1',
  'Avdelning_1, kod',
  'Avdelning_1',
  'Antal arbetsställen',
  'Storleksklass',
  'Arbetsgivarstatus',
  'Momsstatus',
  'Fskattstatus',
  'Sektor',
  'Reklam, kod',
  'Reklam',
  'Utskick, kod',
  'Utskick'
];

export const DERIVED_COLUMNS = [
  'is_new_company',
  'has_email',
  'has_phone',
  'county_slug',
  'industry_slug',
  'status_bucket'
];

export const ALLOWED_COMPANY_STATUSES = new Set([
  'Är verksam',
  'Har aldrig varit verksam'
]);

export const ALLOWED_BOLAGSSTATUS = 'Normalläge';
