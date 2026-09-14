export class UserFacingError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'UserFacingError';
  }
}
