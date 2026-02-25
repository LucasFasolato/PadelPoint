export interface AuthUser {
  userId: string;
  email: string;
  role: string;
}

export interface AuthenticatedRequest extends Request {
  user: AuthUser;
}
