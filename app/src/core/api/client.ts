/**
 * Student Progress Platform - REST API Client
 * Connects frontend React client to Node/Express backend
 */
import type {
  StoredReportFile,
  AssignmentScheduleResponse,
  AssignmentScheduleItem,
  BatchLatenessReport,
  BatchDropoutReport,
  DropoutSettings,
  BatchCompletionReport,
  BatchCompletionSettings,
} from '@/types';
import { db } from '@/core/db';

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

const RAW_BASE_URL = (import.meta.env.VITE_API_URL as string | undefined)?.trim() || '';
export const API_BASE = RAW_BASE_URL
  ? `${RAW_BASE_URL.replace(/\/+$/, '')}/api/v1`
  : '/api/v1';

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
      let errData: { message?: string; code?: string; shortReason?: string; checks?: any[] } | undefined;
      try {
        errData = (await res.json()) as { message?: string; code?: string; shortReason?: string; checks?: any[] };
      } catch {
        errData = { message: res.statusText };
      }
      const error: any = new Error(errData?.message || `Request failed with status ${res.status}`);
      error.status = res.status;
      error.code = errData?.code;
      error.shortReason = errData?.shortReason;
      error.checks = errData?.checks;
      throw error;
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

  // --- Batch Analytics & Students ---
  async getBatchOverview(batchId: string, snapshotId?: string): Promise<Record<string, unknown>> {
    const query = snapshotId ? `?snapshotId=${encodeURIComponent(snapshotId)}` : '';
    return this.request<Record<string, unknown>>(`/batches/${batchId}/overview${query}`);
  }

  async getBatchStudents(batchId: string, snapshotId?: string): Promise<{ batchId: string; snapshotId: string; totalStudents: number; students: Record<string, unknown>[] }> {
    const query = snapshotId ? `?snapshotId=${encodeURIComponent(snapshotId)}` : '';
    return this.request<{ batchId: string; snapshotId: string; totalStudents: number; students: Record<string, unknown>[] }>(`/batches/${batchId}/students${query}`);
  }

  async getBatchAssignments(batchId: string, snapshotId?: string): Promise<Record<string, unknown>> {
    const query = snapshotId ? `?snapshotId=${encodeURIComponent(snapshotId)}` : '';
    return this.request<Record<string, unknown>>(`/batches/${batchId}/assignments${query}`);
  }

  async getBatchContent(batchId: string, snapshotId?: string): Promise<Record<string, unknown>> {
    const query = snapshotId ? `?snapshotId=${encodeURIComponent(snapshotId)}` : '';
    return this.request<Record<string, unknown>>(`/batches/${batchId}/content${query}`);
  }

  async getBatchAttendance(batchId: string, snapshotId?: string): Promise<Record<string, unknown>> {
    const query = snapshotId ? `?snapshotId=${encodeURIComponent(snapshotId)}` : '';
    return this.request<Record<string, unknown>>(`/batches/${batchId}/attendance${query}`);
  }

  async getBatchAtRisk(batchId: string, snapshotId?: string): Promise<Record<string, unknown>> {
    const query = snapshotId ? `?snapshotId=${encodeURIComponent(snapshotId)}` : '';
    return this.request<Record<string, unknown>>(`/batches/${batchId}/at-risk${query}`);
  }

  async compareSnapshots(
    batchId: string,
    idA: string,
    idB: string,
    options?: { sameItems?: boolean; tolerance?: number }
  ): Promise<any> {
    const params = new URLSearchParams();
    params.set('snapshots', `${idA},${idB}`);
    if (options?.sameItems) params.set('sameItems', 'true');
    if (options?.tolerance !== undefined) params.set('tolerance', String(options.tolerance));
    return this.request<any>(`/batches/${batchId}/compare?${params.toString()}`);
  }

  async getStudentProfile(studentId: string, batchId?: string): Promise<Record<string, unknown>> {
    const query = batchId ? `?batchId=${encodeURIComponent(batchId)}` : '';
    return this.request<Record<string, unknown>>(`/students/${studentId}${query}`);
  }

  // --- Stored Report Files ---
  async listBatchFiles(batchId: string): Promise<StoredReportFile[]> {
    const data = await this.request<{ files: StoredReportFile[] }>(`/batches/${batchId}/files`);
    return data.files;
  }

  async uploadAcademicWorkbook(
    batchId: string,
    file: File | Blob,
    fileName: string
  ): Promise<{ message: string; file: StoredReportFile }> {
    const formData = new FormData();
    formData.append('file', file, fileName);
    return this.request<{ message: string; file: StoredReportFile }>(`/batches/${batchId}/files/academic`, {
      method: 'POST',
      body: formData,
    });
  }

  async setCurrentAcademicVersion(
    batchId: string,
    fileId: string
  ): Promise<{ message: string; file: StoredReportFile }> {
    return this.request<{ message: string; file: StoredReportFile }>(`/batches/${batchId}/files/${fileId}/current`, {
      method: 'PATCH',
    });
  }

  async deleteReportFile(fileId: string): Promise<void> {
    await this.request<{ message: string }>(`/files/${fileId}?confirm=true`, {
      method: 'DELETE',
    });
  }

  async downloadReportFile(fileId: string, originalName: string): Promise<void> {
    const headers: Record<string, string> = {};
    if (this.accessToken) {
      headers['Authorization'] = `Bearer ${this.accessToken}`;
    }
    const res = await fetch(`${API_BASE}/files/${fileId}/download`, {
      headers,
    });
    if (!res.ok) {
      throw new Error(`Download failed with status ${res.status}`);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = originalName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  // --- Assignment Schedule & Lateness (Stage 2) ---
  async getAssignmentSchedule(batchId: string): Promise<AssignmentScheduleResponse> {
    return this.request<AssignmentScheduleResponse>(`/batches/${batchId}/assignment-schedule`);
  }

  async updateAssignmentSchedule(
    batchId: string,
    schedule: AssignmentScheduleItem[]
  ): Promise<{ message: string; schedule: AssignmentScheduleItem[] }> {
    return this.request<{ message: string; schedule: AssignmentScheduleItem[] }>(
      `/batches/${batchId}/assignment-schedule`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ schedule }),
      }
    );
  }

  async getAssignmentLateness(batchId: string, snapshotId: string): Promise<BatchLatenessReport> {
    return this.request<BatchLatenessReport>(
      `/batches/${batchId}/assignments/lateness?snapshotId=${encodeURIComponent(snapshotId)}`
    );
  }

  // --- Drop-out Risk Analytics (Stage 3) ---
  async getBatchDropout(batchId: string, snapshotId: string): Promise<BatchDropoutReport> {
    return this.request<BatchDropoutReport>(
      `/batches/${batchId}/dropout?snapshotId=${encodeURIComponent(snapshotId)}`
    );
  }

  async updateDropoutSettings(
    batchId: string,
    settings: DropoutSettings
  ): Promise<{ message: string; settings: DropoutSettings }> {
    return this.request<{ message: string; settings: DropoutSettings }>(
      `/batches/${batchId}/dropout/settings`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      }
    );
  }

  async getBatchCompletion(batchId: string, snapshotId: string): Promise<BatchCompletionReport> {
    return this.request<BatchCompletionReport>(
      `/batches/${batchId}/completion?snapshotId=${encodeURIComponent(snapshotId)}`
    );
  }

  async updateCompletionSettings(
    batchId: string,
    settings: BatchCompletionSettings
  ): Promise<{ message: string; settings: BatchCompletionSettings }> {
    return this.request<{ message: string; settings: BatchCompletionSettings }>(
      `/batches/${batchId}/completion/settings`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      }
    );
  }
}

export const apiClient = new ApiClient();

export async function resolveBackendBatchId(selectedBatchId: string | null): Promise<string> {
  if (!selectedBatchId) return '';
  try {
    const backendBatches = await apiClient.listBatches();

    // 1. Direct UUID match
    const byId = backendBatches.find((b) => b.id === selectedBatchId);
    if (byId) return byId.id;

    // 2. Fetch local batch info from Dexie
    const localBatch = await db.batches.get(selectedBatchId);
    const code = (localBatch?.externalBatchId || '').toLowerCase().trim();
    const name = (localBatch?.name || '').toLowerCase().trim();
    const target = selectedBatchId.toLowerCase().trim();
    const stripped = target.replace(/^batch[-_]/i, '');

    // 3. EXACT match on externalBatchId (e.g. 'B49' === 'B49', or 'BATCH-15748_f261f305' === 'BATCH-15748_f261f305')
    if (code) {
      const byExactCode = backendBatches.find(
        (b) => b.externalBatchId.toLowerCase().trim() === code
      );
      if (byExactCode) return byExactCode.id;
    }

    // 4. EXACT match on name (e.g. 'AFSD' === 'AFSD', or 'Batch 15748' === 'Batch 15748')
    if (name) {
      const byExactName = backendBatches.find(
        (b) => b.name.toLowerCase().trim() === name
      );
      if (byExactName) return byExactName.id;
    }

    // 5. EXACT match of selectedBatchId against externalBatchId or name
    const byTargetExact = backendBatches.find(
      (b) =>
        b.externalBatchId.toLowerCase().trim() === target ||
        b.name.toLowerCase().trim() === target ||
        b.externalBatchId.toLowerCase().trim() === stripped ||
        b.name.toLowerCase().trim() === stripped
    );
    if (byTargetExact) return byTargetExact.id;

    // 6. Prefix match on code (e.g. 'BATCH-15748' matches 'BATCH-15748_f261f305')
    if (code) {
      const byCodePrefix = backendBatches.find((b) => {
        const bCode = b.externalBatchId.toLowerCase().trim();
        return bCode.startsWith(code) || code.startsWith(bCode);
      });
      if (byCodePrefix) return byCodePrefix.id;
    }

    // 7. Substring fallback ONLY if no exact match exists anywhere
    const candidates = backendBatches.filter((b) => {
      const bCode = b.externalBatchId.toLowerCase().trim();
      const bName = b.name.toLowerCase().trim();
      return (
        (name && (bName.includes(name) || name.includes(bName))) ||
        (code && (bCode.includes(code) || code.includes(bCode))) ||
        bName.includes(target) ||
        bCode.includes(target)
      );
    });

    if (candidates.length > 0) {
      if (code) {
        const matchingCode = candidates.find((c) =>
          c.externalBatchId.toLowerCase().includes(code)
        );
        if (matchingCode) return matchingCode.id;
      }
      return candidates[0].id;
    }

    if (localBatch?.externalBatchId) return localBatch.externalBatchId;
  } catch (err) {
    console.warn('Failed to resolve backend batch ID:', err);
  }
  return selectedBatchId;
}
