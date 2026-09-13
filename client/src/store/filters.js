import { create } from 'zustand';

export const useFilterStore = create((set) => ({
  clubId: '',
  coachId: '',
  level: '',
  durationMinutes: '',
  setFilter: (key, value) => set({ [key]: value }),
  reset: () => set({ coachId: '', level: '', durationMinutes: '' }),
}));

export const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const DAY_NAMES_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
