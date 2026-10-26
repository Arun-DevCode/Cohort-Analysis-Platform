/**
 * Student Progress Platform - REST API Client
 * Connects frontend React client to Node/Express backend
 */

export interface BackendUser {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'manager' | 'trainer';
  createdAt: string;
}

export interface BackendBatch {
  id: string;
  name: string;
  externalBatchId: string;
  startDate: string | null;
  createdAt: string;
  trainers?: { id: string; email: string }[];
}

export interface BackendSnapshot {
  id: string;
  batchId: string;
  snapshotDate: string;
  parserVersion: number;
}

export interface UploadResponse {
  message: string;
  uploadId: string;
  snapshot?: {
    snapshotId: string;
    batchId: string;
    snapshotDate: string;
    totalStudents: number;
    averages: {
      assignmentSubmissionAvg: number;
      totalConsumptionAvg: number;
      liveAttendanceAvg: number;
      liveOrRecAvg: number;
    };
  };
  errorReport?: Record<string, unknown>;
}

const API_BASE = '/api/v1';

class ApiClient {
  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private user: BackendUser | null = null;

  constructor() {
    this.accessToken = localStorage.getItem('spp_access_token');
    this.refreshToken = localStorage.getItem('spp_refresh_token');
    const savedUser = localStorage.getItem('spp_user');
    if (savedUser) {
      try {
        this.user = JSON.parse(savedUser);
      } catch {
        this.user = null;
      }
    }
  }

  getUser(): BackendUser | null {
    return this.user;
  }

  isAuthenticated(): boolean {
    return !!this.accessToken;
  }

  private setTokens(access: string, refresh: string, user?: BackendUser) {
    this.accessToken = access;
    this.refreshToken = refresh;
    localStorage.setItem('spp_access_token', access);
    localStorage.setItem('spp_refresh_token', refresh);
    if (user) {
      this.user = user;
      localStorage.setItem('spp_user', JSON.stringify(user));
    }
  }

  clearAuth() {
    this.accessToken = null;
    this.refreshToken = null;
    this.user = null;
    localStorage.removeItem('spp_access_token');
    localStorage.removeItem('spp_refresh_token');
    localStorage.removeItem('spp_user');
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = {
      ...(options.headers as Record<string, string>),
    };

    if (this.accessToken && !headers['Authorization']) {
      headers['Authorization'] = `Bearer ${this.accessToken}`;
    }

    let res = await fetch(`${API_BASE}${endpoint}`, {
      ...options,
      headers,
    });

    // Handle token refresh on 401
    if (res.status === 401 && this.refreshToken && !endpoint.includes('/auth/')) {
      try {
        const refreshRes = await fetch(`${API_BASE}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: this.refreshToken }),
        });

        if (refreshRes.ok) {
          const data = await refreshRes.json();
          this.setTokens(data.tokens.accessToken, data.tokens.refreshToken);
          headers['Authorization'] = `Bearer ${this.accessToken}`;
          res = await fetch(`${API_BASE}${endpoint}`, {
            ...options,
            headers,
          });
        } else {
          this.clearAuth();
        }
      } catch {
        this.clearAuth();
      }
    }

    if (!res.ok) {
      let errData: { message?: string } | undefined;
      try {
        errData = (await res.json()) as { message?: string };
      } catch {
        errData = { message: res.statusText };
      }
      throw new Error(errData?.message || `Request failed with status ${res.status}`);
    }

    return res.json() as Promise<T>;
  }

  // --- Health ---
  async checkHealth(): Promise<{ status: string; database: string }> {
    return this.request<{ status: string; database: string }>('/health');
  }

  // --- Auth ---
  async register(
    name: string,
    email: string,
    password: string,
    role: 'admin' | 'manager' | 'trainer' = 'trainer'
  ): Promise<{ user: BackendUser; tokens: { accessToken: string; refreshToken: string } }> {
    const res = await this.request<{
      user: BackendUser;
      tokens: { accessToken: string; refreshToken: string };
    }>('/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password, role }),
    });
    this.setTokens(res.tokens.accessToken, res.tokens.refreshToken, res.user);
    return res;
  }

  async login(
    email: string,
    password: string
  ): Promise<{ user: BackendUser; tokens: { accessToken: string; refreshToken: string } }> {
    const res = await this.request<{
      user: BackendUser;
      tokens: { accessToken: string; refreshToken: string };
    }>('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    this.setTokens(res.tokens.accessToken, res.tokens.refreshToken, res.user);
    return res;
  }

  async getMe(): Promise<BackendUser> {
    const res = await this.request<{ user: BackendUser }>('/auth/me');
    this.user = res.user;
    localStorage.setItem('spp_user', JSON.stringify(res.user));
    return res.user;
  }

  async logout(): Promise<void> {
    try {
      await this.request('/auth/logout', { method: 'POST' });
    } finally {
      this.clearAuth();
    }
  }

  // --- Batches ---
  async listBatches(): Promise<BackendBatch[]> {
    const data = await this.request<{ batches: BackendBatch[] }>('/batches');
    return data.batches;
  }

  async createBatch(name: string, externalBatchId: string, startDate?: string): Promise<BackendBatch> {
    const data = await this.request<{ batch: BackendBatch }>('/batches', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, externalBatchId, startDate }),
    });
    return data.batch;
  }

  // --- Uploads ---
  async uploadReport(
    batchId: string,
    file: File | Blob,
    fileName: string,
    snapshotDate?: string,
    replace?: boolean
  ): Promise<UploadResponse> {
    const formData = new FormData();
    formData.append('file', file, fileName);
    if (snapshotDate) formData.append('snapshotDate', snapshotDate);
    if (replace) formData.append('replace', 'true');

    return this.request<UploadResponse>(`/batches/${batchId}/uploads`, {
      method: 'POST',
      body: formData,
    });
  }

  async getUploadStatus(uploadId: string): Promise<Record<string, unknown>> {
    const data = await this.request<{ upload: Record<string, unknown> }>(`/uploads/${uploadId}`);
    return data.upload;
  }

  // --- Snapshots ---
  async listSnapshots(batchId: string): Promise<BackendSnapshot[]> {
    const data = await this.request<{ snapshots: BackendSnapshot[] }>(`/batches/${batchId}/snapshots`);
    return data.snapshots;
  }
}

export const apiClient = new ApiClient();
