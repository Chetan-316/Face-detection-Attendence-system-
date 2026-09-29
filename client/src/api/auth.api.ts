import { apiClient } from './client';
import { LoginResponse, StaffUser } from '../types/auth.types';

export const authApi = {
  async login(username: string, password: string): Promise<LoginResponse> {
    return apiClient<LoginResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
  },

  async getMe(): Promise<{ user: StaffUser }> {
    return apiClient<{ user: StaffUser }>('/auth/me', {
      method: 'GET',
    });
  },
};
