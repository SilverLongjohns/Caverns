export interface AuthResult {
  accountId: string;
}

export interface AuthProvider {
  readonly id: 'name' | 'google' | 'discord';
  authenticate(credentials: unknown): Promise<AuthResult | null>;
}
