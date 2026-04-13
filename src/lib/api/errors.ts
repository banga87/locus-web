// API error classes. Thrown by auth/validation helpers, caught by route
// handlers and translated to the error envelope in response.ts.

export class ApiAuthError extends Error {
  constructor(
    public statusCode: 401 | 403,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiAuthError';
  }
}

export class ApiValidationError extends Error {
  constructor(
    public details: unknown,
    message = 'Invalid request.',
  ) {
    super(message);
    this.name = 'ApiValidationError';
  }
}
