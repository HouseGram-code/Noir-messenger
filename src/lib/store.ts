import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Theme = 'emerald' | 'blue' | 'purple' | 'rose' | 'amber';

export interface UserProfile {
  uid: string;
  name: string;
  username: string;
  avatar: string | null;
  bio: string;
  theme: Theme;
  email?: string;
}

interface AppState {
  userProfile: UserProfile | null;
  activeTab: 'chats' | 'profile';
  theme: Theme;
  setUserProfile: (profile: UserProfile | null) => void;
  setActiveTab: (tab: 'chats' | 'profile') => void;
  setTheme: (theme: Theme) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      userProfile: null,
      activeTab: 'chats',
      theme: 'emerald',
      setUserProfile: (profile) => set({ userProfile: profile }),
      setActiveTab: (tab) => set({ activeTab: tab }),
      setTheme: (theme) => set({ theme }),
    }),
    {
      name: 'app-storage', // unique name for localStorage
    }
  )
);
