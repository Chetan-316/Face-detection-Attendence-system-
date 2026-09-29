export type StaffRole = 'ADMIN' | 'WARDEN' | 'GUARD';
export type UserStatus = 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';

export interface StaffUser {
  id: string;
  username: string;
  fullName: string;
  email: string | null;
  role: StaffRole;
  organizationId: string;
  hostelId: string | null;
  status: UserStatus;
}

export interface LoginResponse {
  user: StaffUser;
  token: string;
  expiresIn: number;
}

export interface AuthContextType {
  user: StaffUser | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (token: string, user: StaffUser) => void;
  logout: () => void;
  refreshUser: () => Promise<void>;
}
