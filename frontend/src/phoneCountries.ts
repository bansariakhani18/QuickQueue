export interface CountryOption {
  name: string
  dialCode: string
}

export const COUNTRIES: CountryOption[] = [
  { name: 'India', dialCode: '91' },
  { name: 'United States / Canada', dialCode: '1' },
  { name: 'United Kingdom', dialCode: '44' },
  { name: 'Australia', dialCode: '61' },
  { name: 'Germany', dialCode: '49' },
  { name: 'France', dialCode: '33' },
  { name: 'United Arab Emirates', dialCode: '971' },
  { name: 'Singapore', dialCode: '65' },
]

export const DEFAULT_DIAL_CODE = '91'