import { env } from 'cloudflare:workers';

export interface ServiceTicket {
  ticketId: string;
  serviceName: string;
  statusStep: 1 | 2 | 3;
  status?: string;
  description?: string;
  updatedAt?: string;
}

interface SheetsEnv {
  GOOGLE_SHEET_ID?: string;
  GOOGLE_SHEET_TAB?: string;
  GOOGLE_SERVICE_ACCOUNT_EMAIL?: string;
  GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?: string;
}

interface SheetsValuesResponse {
  values?: string[][];
}

interface GoogleTokenResponse {
  access_token?: string;
  expires_in?: number;
}

const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const DEFAULT_TAB = 'Service_Tickets';

let cachedAccessToken: { value: string; expiresAt: number } | undefined;

function getSheetsEnv(): SheetsEnv {
  return env as unknown as SheetsEnv;
}

function encodeBase64Url(value: string | ArrayBuffer): string {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function privateKeyToBuffer(pem: string): ArrayBuffer {
  const normalized = pem.replace(/\\n/g, '\n');
  const base64 = normalized
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s/g, '');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}

async function createServiceAccountAssertion(email: string, privateKey: string): Promise<string> {
  const issuedAt = Math.floor(Date.now() / 1000);
  const header = encodeBase64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = encodeBase64Url(
    JSON.stringify({
      iss: email,
      scope: SHEETS_SCOPE,
      aud: TOKEN_ENDPOINT,
      iat: issuedAt,
      exp: issuedAt + 3600
    })
  );
  const unsignedToken = `${header}.${claim}`;
  const key = await crypto.subtle.importKey(
    'pkcs8',
    privateKeyToBuffer(privateKey),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsignedToken));
  return `${unsignedToken}.${encodeBase64Url(signature)}`;
}

async function getServiceAccountAccessToken(): Promise<string> {
  if (cachedAccessToken && cachedAccessToken.expiresAt > Date.now() + 60_000) {
    return cachedAccessToken.value;
  }

  const { GOOGLE_SERVICE_ACCOUNT_EMAIL: email, GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: privateKey } = getSheetsEnv();
  if (!email || !privateKey) throw new Error('Google Sheets service account credentials are not configured');

  const assertion = await createServiceAccountAssertion(email, privateKey);
  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion
    })
  });

  const data = (await response.json()) as GoogleTokenResponse;
  if (!response.ok || !data.access_token) {
    throw new Error(`Google token request failed with status ${response.status}`);
  }

  const expiresIn = Math.max(data.expires_in ?? 3600, 60);
  cachedAccessToken = {
    value: data.access_token,
    expiresAt: Date.now() + expiresIn * 1000
  };
  return data.access_token;
}

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function findColumn(headers: string[], candidates: string[]): number {
  const normalizedCandidates = new Set(candidates.map(normalizeHeader));
  return headers.findIndex((header) => normalizedCandidates.has(header));
}

function valueAt(row: string[], index: number): string {
  return index >= 0 ? `${row[index] ?? ''}`.trim() : '';
}

function isInactive(status: string): boolean {
  return ['cancelled', 'canceled', 'closed', 'complete', 'completed', 'resolved'].includes(status.toLowerCase());
}

async function fetchTicketRows(sheetId: string, tabName: string): Promise<string[][]> {
  const accessToken = await getServiceAccountAccessToken();
  const range = encodeURIComponent(tabName);
  const endpoint = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values/${range}`;
  const response = await fetch(endpoint, {
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${accessToken}`
    }
  });

  const data = (await response.json()) as SheetsValuesResponse;
  if (!response.ok) throw new Error(`Google Sheets request failed with status ${response.status}`);
  return data.values ?? [];
}

function mapRowsToTickets(rows: string[][], email: string): ServiceTicket[] {
  const [headerRow, ...dataRows] = rows;
  if (!headerRow) return [];

  const headers = headerRow.map(normalizeHeader);
  const emailColumn = findColumn(headers, [
    'client_email',
    'client_email_address',
    'customer_email',
    'customer_email_address',
    'contact_email',
    'email',
    'email_address',
    'user_email'
  ]);
  const ticketColumn = findColumn(headers, ['ticket_id', 'ticket', 'id']);
  const serviceColumn = findColumn(headers, ['service_name', 'service', 'request_name']);
  const stepColumn = findColumn(headers, ['status_step', 'step', 'progress_step']);
  const statusColumn = findColumn(headers, ['status', 'ticket_status', 'state']);
  const descriptionColumn = findColumn(headers, ['description', 'details', 'request_details']);
  const updatedColumn = findColumn(headers, ['updated_at', 'last_updated', 'date_updated']);

  if (emailColumn < 0 || ticketColumn < 0 || serviceColumn < 0 || stepColumn < 0) {
    throw new Error('Service_Tickets is missing one or more required columns');
  }

  const normalizedEmail = email.trim().toLowerCase();
  return dataRows.flatMap((row) => {
    if (valueAt(row, emailColumn).toLowerCase() !== normalizedEmail) return [];

    const ticketId = valueAt(row, ticketColumn);
    const serviceName = valueAt(row, serviceColumn);
    const parsedStep = Number.parseInt(valueAt(row, stepColumn), 10);
    const status = valueAt(row, statusColumn);

    if (!ticketId || !serviceName || ![1, 2, 3].includes(parsedStep) || isInactive(status)) return [];

    return [
      {
        ticketId,
        serviceName,
        statusStep: parsedStep as 1 | 2 | 3,
        ...(status ? { status } : {}),
        ...(valueAt(row, descriptionColumn) ? { description: valueAt(row, descriptionColumn) } : {}),
        ...(valueAt(row, updatedColumn) ? { updatedAt: valueAt(row, updatedColumn) } : {})
      }
    ];
  });
}

export async function getTicketsForUser(email: string): Promise<{ tickets: ServiceTicket[]; configured: boolean }> {
  const { GOOGLE_SHEET_ID: sheetId, GOOGLE_SERVICE_ACCOUNT_EMAIL: serviceEmail, GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: privateKey } = getSheetsEnv();
  const configured = Boolean(sheetId && serviceEmail && privateKey);

  if (!configured) return { tickets: [], configured: false };

  try {
    const rows = await fetchTicketRows(sheetId!, getSheetsEnv().GOOGLE_SHEET_TAB?.trim() || DEFAULT_TAB);
    return { tickets: mapRowsToTickets(rows, email), configured: true };
  } catch (error) {
    console.error('[sheets] Unable to load Service_Tickets:', error instanceof Error ? error.message : 'unknown error');
    return { tickets: [], configured: true };
  }
}
