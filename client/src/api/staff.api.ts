import { apiClient } from './client';
import { StaffRole, UserStatus } from '../types/auth.types';

export interface StaffAccount {
  id: string;
  username: string;
  fullName: string;
  email: string | null;
  role: StaffRole;
  status: UserStatus;
  hostelId: string | null;
  hostel?: {
    id: string;
    code: string;
    name: string;
  } | null;
  createdAt?: string;
}

export const staffApi = {
  async listStaff(): Promise<{ data: StaffAccount[] }> {
    return apiClient<{ data: StaffAccount[] }>('/staff');
  },

  async createStaff(payload: {
    fullName: string;
    username: string;
    email?: string;
    password: string;
    role: 'WARDEN' | 'GUARD';
    hostelId: string;
  }): Promise<StaffAccount> {
    return apiClient<StaffAccount>('/staff', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
};
