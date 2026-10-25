export interface OwnerPasswordResetRepository {
  resetPasswordAndRevokeSessions(
    email: string,
    passwordHash: string,
  ): Promise<boolean>;
}
