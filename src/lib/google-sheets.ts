import { google } from 'googleapis';
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
  GCP_SERVICE_ACCOUNT_EMAIL?: string;
  GCP_PRIVATE_KEY?: string;
}

const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';
const DEFAULT_TAB = 'Service_Tickets';

function getSheetsEnv(): SheetsEnv {
  const workerEnv = env as unknown as SheetsEnv;
  // Cloudflare Pages/Node deployments expose project variables through process.env.
  // The request-scoped Worker env fallback keeps the same server-only module usable
  // with the Astro Cloudflare adapter when Node compatibility is not populated.
  const processEnv = typeof process !== 'undefined' ? process.env : undefined;
  const privateKey = typeof process !== 'undefined' ? process.env.GCP_PRIVATE_KEY : undefined;

  return {
    GOOGLE_SHEET_ID: processEnv?.GOOGLE_SHEET_ID ?? workerEnv.GOOGLE_SHEET_ID,
    GOOGLE_SHEET_TAB: processEnv?.GOOGLE_SHEET_TAB ?? workerEnv.GOOGLE_SHEET_TAB,
    GCP_SERVICE_ACCOUNT_EMAIL: processEnv?.GCP_SERVICE_ACCOUNT_EMAIL ?? workerEnv.GCP_SERVICE_ACCOUNT_EMAIL,
    GCP_PRIVATE_KEY: privateKey ?? workerEnv.GCP_PRIVATE_KEY
  };
}

function normalizePrivateKey(privateKey: string): string {
  return privateKey.replace(/\\n/g, '\n').replace(/\r\n/g, '\n').trim();
}

function createJwtClient(email: string, privateKey: string): InstanceType<typeof google.auth.JWT> {
  return new google.auth.JWT({
    email,
    key: normalizePrivateKey(privateKey),
    scopes: [SHEETS_SCOPE]
  });
}

async function fetchTicketRows(sheetId: string, tabName: string, email: string, privateKey: string): Promise<unknown[][]> {
  const auth = createJwtClient(email, privateKey);
  const sheets = google.sheets({ version: 'v4', auth });
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: tabName,
    majorDimension: 'ROWS'
  });

  return (response.data.values ?? []) as unknown[][];
}

function normalizeHeader(value: unknown): string {
  return String(value ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function findColumn(headers: string[], candidates: string[]): number {
  const normalizedCandidates = new Set(candidates.map(normalizeHeader));
  return headers.findIndex((header) => normalizedCandidates.has(header));
}

function valueAt(row: readonly unknown[], index: number): string {
  return index >= 0 ? String(row[index] ?? '').trim() : '';
}

function isInactive(status: string): boolean {
  return ['cancelled', 'canceled', 'closed', 'complete', 'completed', 'resolved'].includes(status.toLowerCase());
}

function mapRowsToTickets(rows: readonly unknown[][], email: string): ServiceTicket[] {
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
  const { GOOGLE_SHEET_ID: sheetId, GOOGLE_SHEET_TAB: tabName, GCP_SERVICE_ACCOUNT_EMAIL: serviceEmail, GCP_PRIVATE_KEY: privateKey } = getSheetsEnv();
  const configured = Boolean(sheetId && serviceEmail && privateKey);

  if (!configured) return { tickets: [], configured: false };

  try {
    const rows = await fetchTicketRows(sheetId!, tabName?.trim() || DEFAULT_TAB, serviceEmail!, privateKey!);
    return { tickets: mapRowsToTickets(rows, email), configured: true };
  } catch (error) {
    console.error('[sheets] Unable to load Service_Tickets:', error instanceof Error ? error.message : 'unknown error');
    return { tickets: [], configured: true };
  }
}
