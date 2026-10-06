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

  async updateStaff(
    id: string,
    payload: {
      fullName?: string;
      email?: string;
      role?: 'WARDEN' | 'GUARD';
      hostelId?: string;
      status?: UserStatus;
    }
  ): Promise<StaffAccount> {
    return apiClient<StaffAccount>(`/staff/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },

  async resetPassword(id: string, password: string): Promise<{ success: boolean; message: string }> {
    return apiClient<{ success: boolean; message: string }>(
      `/staff/${encodeURIComponent(id)}/reset-password`,
      {
        method: 'POST',
        body: JSON.stringify({ password }),
      }
    );
  },
};
