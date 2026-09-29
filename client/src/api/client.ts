/**
 * Centralized HTTP Client for PRAVAHAx API
 * Handles base URL, Bearer token injection, consistent error parsing, and 401 session expiration.
 *
 * NOTE ON TOKEN STORAGE:
 * In this prototype, localStorage is used solely for the JWT access token.
 * No passwords or sensitive credentials are ever stored.
 * Production deployments should consider migrating to HttpOnly SameSite secure cookies.
 */

const TOKEN_KEY = 'pravahax_access_token';

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api/v1';

export class ApiError extends Error {
  public status: number;
  public code: string;
  public details: Record<string, any>;

  constructor(status: number, message: string, code = 'API_ERROR', details: Record<string, any> = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

let onUnauthorizedCallback: (() => void) | null = null;

export function registerUnauthorizedHandler(callback: () => void) {
  onUnauthorizedCallback = callback;
}

export function getStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setStoredToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch (err) {
    console.error('Failed to persist token in localStorage', err);
  }
}

export function clearStoredToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch (err) {
    console.error('Failed to clear token from localStorage', err);
  }
}

export async function apiClient<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const url = endpoint.startsWith('http')
    ? endpoint
    : `${API_BASE_URL}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;

  const token = getStoredToken();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  let response: Response;
  try {
    response = await fetch(url, {
      ...options,
      headers,
    });
  } catch (error: any) {
    throw new ApiError(0, 'Unable to connect to the server. Please check network connection.', 'NETWORK_ERROR');
  }

  // Handle 401 Unauthorized (Expired or invalid token)
  if (response.status === 401) {
    clearStoredToken();
    if (onUnauthorizedCallback) {
      onUnauthorizedCallback();
    }
  }

  let data: any = null;
  const contentType = response.headers.get('content-type');
  if (contentType && contentType.includes('application/json')) {
    try {
      data = await response.json();
    } catch {
      data = null;
    }
  }

  if (!response.ok) {
    const errorCode = data?.error?.code || `HTTP_${response.status}`;
    let errorMessage = data?.error?.message;

    if (!errorMessage) {
      if (response.status === 401) {
        errorMessage = 'Invalid username or password';
      } else if (response.status === 403) {
        errorMessage = 'You do not have permission to perform this action.';
      } else if (response.status === 404) {
        errorMessage = 'Requested resource was not found.';
      } else if (response.status === 409) {
        errorMessage = 'A conflict occurred with an existing record.';
      } else {
        errorMessage = `Request failed with status ${response.status}`;
      }
    }

    throw new ApiError(response.status, errorMessage, errorCode, data?.error?.details || {});
  }

  return data as T;
}
