import { create } from 'zustand';
import type { AppSettings } from '@/types';
import { DEFAULT_SETTINGS, getSettings, saveSettings, clearAllLocalData } from '@/core/db';
import { apiClient, BackendUser } from '@/core/api/client';

export type ActiveTab =
  | 'overview'
  | 'assignments'
  | 'content'
  | 'attendance'
  | 'students'
  | 'compare'
  | 'atrisk'
  | 'reports'
  | 'backup'
  | 'settings';

interface PlatformState {
  selectedBatchId: string | null;
  selectedSnapshotId: string | null;
  activeTab: ActiveTab;
  settings: AppSettings;
  isUploadModalOpen: boolean;
  selectedStudentId: string | null;

  // Backend Connection State
  backendConnected: boolean;
  backendUser: BackendUser | null;
  isLoginModalOpen: boolean;

  // Actions
  setSelectedBatchId: (batchId: string | null) => void;
  setSelectedSnapshotId: (snapshotId: string | null) => void;
  setActiveTab: (tab: ActiveTab) => void;
  setUploadModalOpen: (open: boolean) => void;
  setLoginModalOpen: (open: boolean) => void;
  setSelectedStudentId: (studentId: string | null) => void;
  loadSettings: () => Promise<void>;
  updateSettings: (newSettings: Partial<AppSettings>) => Promise<void>;
  togglePiiMask: () => Promise<void>;

  // Backend actions
  checkBackendStatus: () => Promise<boolean>;
  hydrateAuth: () => Promise<void>;
  loginToBackend: (email: string, pass: string) => Promise<{ success: boolean; error?: string }>;
  registerToBackend: (
    name: string,
    email: string,
    pass: string,
    role?: 'admin' | 'manager' | 'trainer'
  ) => Promise<{ success: boolean; error?: string }>;
  logoutFromBackend: () => Promise<void>;
}

export const usePlatformStore = create<PlatformState>((set, get) => ({
  selectedBatchId: null,
  selectedSnapshotId: null,
  activeTab: 'overview',
  settings: DEFAULT_SETTINGS,
  isUploadModalOpen: false,
  selectedStudentId: null,

  backendConnected: false,
  backendUser: apiClient.getUser(),
  isLoginModalOpen: false,

  setSelectedBatchId: (batchId) => set({ selectedBatchId: batchId }),
  setSelectedSnapshotId: (snapshotId) => set({ selectedSnapshotId: snapshotId }),
  setActiveTab: (tab) => set({ activeTab: tab }),
  setUploadModalOpen: (open) => set({ isUploadModalOpen: open }),
  setLoginModalOpen: (open) => set({ isLoginModalOpen: open }),
  setSelectedStudentId: (studentId) => set({ selectedStudentId: studentId }),

  loadSettings: async () => {
    const s = await getSettings();
    set({ settings: s });
  },

  updateSettings: async (newSettings) => {
    const updated = await saveSettings(newSettings);
    set({ settings: updated });
  },

  togglePiiMask: async () => {
    const current = get().settings.maskPii;
    const updated = await saveSettings({ maskPii: !current });
    set({ settings: updated });
  },

  checkBackendStatus: async () => {
    try {
      const res = await apiClient.checkHealth();
      const connected = res.status === 'ok';
      set({ backendConnected: connected, backendUser: apiClient.getUser() });
      return connected;
    } catch {
      set({ backendConnected: false });
      return false;
    }
  },

  hydrateAuth: async () => {
    if (apiClient.isAuthenticated()) {
      try {
        const user = await apiClient.getMe();
        set({ backendUser: user, backendConnected: true });
      } catch {
        apiClient.clearAuth();
        set({ backendUser: null });
      }
    }
  },

  loginToBackend: async (email: string, pass: string) => {
    try {
      await clearAllLocalData();
      const res = await apiClient.login(email, pass);
      set({
        backendUser: res.user,
        backendConnected: true,
        selectedBatchId: null,
        selectedSnapshotId: null,
        selectedStudentId: null,
      });
      return { success: true };
    } catch (err: unknown) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Invalid email or password',
      };
    }
  },

  registerToBackend: async (name: string, email: string, pass: string, role = 'trainer') => {
    try {
      await clearAllLocalData();
      const res = await apiClient.register(name, email, pass, role);
      set({
        backendUser: res.user,
        backendConnected: true,
        selectedBatchId: null,
        selectedSnapshotId: null,
        selectedStudentId: null,
      });
      return { success: true };
    } catch (err: unknown) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Registration failed',
      };
    }
  },

  logoutFromBackend: async () => {
    await apiClient.logout();
    await clearAllLocalData();
    set({
      backendUser: null,
      selectedBatchId: null,
      selectedSnapshotId: null,
      selectedStudentId: null,
    });
  },
}));
