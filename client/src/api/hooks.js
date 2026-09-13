import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';

// ---- Clubs ----
export const useClubs = () => useQuery({ queryKey: ['clubs'], queryFn: () => api.get('/clubs') });
export const useClub = (id) => useQuery({ queryKey: ['clubs', id], queryFn: () => api.get(`/clubs/${id}`), enabled: !!id });

export const useSaveClub = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ROWID, ...data }) => (ROWID ? api.put(`/clubs/${ROWID}`, data) : api.post('/clubs', data)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['clubs'] }),
  });
};

export const useDeleteClub = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => api.delete(`/clubs/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['clubs'] }),
  });
};

// ---- Coaches ----
export const useCoaches = () => useQuery({ queryKey: ['coaches'], queryFn: () => api.get('/coaches') });

export const useSaveCoach = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ROWID, ...data }) => (ROWID ? api.put(`/coaches/${ROWID}`, data) : api.post('/coaches', data)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['coaches'] }),
  });
};

export const useDeleteCoach = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => api.delete(`/coaches/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['coaches'] }),
  });
};

export const useAssignCoachToClub = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ clubId, coachId }) => api.post(`/clubs/${clubId}/coaches/${coachId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['coaches'] }),
  });
};

// ---- Players ----
export const usePlayers = () => useQuery({ queryKey: ['players'], queryFn: () => api.get('/players') });

export const useSavePlayer = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ROWID, ...data }) => (ROWID ? api.put(`/players/${ROWID}`, data) : api.post('/players', data)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['players'] }),
  });
};

export const useDeletePlayer = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => api.delete(`/players/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['players'] }),
  });
};

// ---- Classes ----
export const useClasses = (filters) =>
  useQuery({
    queryKey: ['classes', filters],
    queryFn: () => {
      const params = new URLSearchParams(
        Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== undefined && v !== ''))
      );
      return api.get(`/classes?${params.toString()}`);
    },
    enabled: !!filters.clubId,
  });

export const useClass = (id) => useQuery({ queryKey: ['classes', id], queryFn: () => api.get(`/classes/${id}`), enabled: !!id });

export const useSaveClass = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ROWID, ...data }) => (ROWID ? api.put(`/classes/${ROWID}`, data) : api.post('/classes', data)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['classes'] }),
  });
};

export const useDeleteClass = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => api.delete(`/classes/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['classes'] }),
  });
};

export const useEnrollPlayer = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ classId, playerId }) => api.post(`/classes/${classId}/enroll`, { playerId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['classes'] }),
  });
};

export const useUnenrollPlayer = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ classId, playerId }) => api.delete(`/classes/${classId}/enroll/${playerId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['classes'] }),
  });
};

// ---- Requests (waitlist) ----
export const useRequests = (filters = {}) =>
  useQuery({
    queryKey: ['requests', filters],
    queryFn: () => {
      const params = new URLSearchParams(Object.fromEntries(Object.entries(filters).filter(([, v]) => v)));
      return api.get(`/requests?${params.toString()}`);
    },
  });

export const useCreateRequest = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data) => api.post('/requests', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['requests'] });
      qc.invalidateQueries({ queryKey: ['alerts'] });
    },
  });
};

// ---- Alerts ----
export const useAlerts = (clubId) =>
  useQuery({ queryKey: ['alerts', clubId], queryFn: () => api.get(`/alerts${clubId ? `?clubId=${clubId}` : ''}`) });

export const useConvertAlert = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ROWID, ...data }) => api.post(`/alerts/${ROWID}/convert`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['alerts'] });
      qc.invalidateQueries({ queryKey: ['classes'] });
      qc.invalidateQueries({ queryKey: ['requests'] });
    },
  });
};

export const useDismissAlert = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => api.patch(`/alerts/${id}`, { Status: 'DISMISSED' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['alerts'] }),
  });
};

// ---- Recommendations (public intake) ----
export const useRecommendations = () => useMutation({ mutationFn: (data) => api.post('/recommendations', data) });
