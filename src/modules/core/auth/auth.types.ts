export interface AuthUser {
  userId: string;
  email: string;
  role: string;
  cityId?: string | null;
}

export interface AuthenticatedRequest extends Request {
  user: AuthUser;
}
