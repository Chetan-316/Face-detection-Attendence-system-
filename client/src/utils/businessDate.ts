const BUSINESS_TIME_ZONE = 'Asia/Kolkata';
const BUSINESS_UTC_OFFSET = '+05:30';

export function businessDateKey(date: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function addBusinessDays(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

export function businessInstant(dateKey: string, time = '00:00'): string {
  return new Date(`${dateKey}T${time}:00${BUSINESS_UTC_OFFSET}`).toISOString();
}
