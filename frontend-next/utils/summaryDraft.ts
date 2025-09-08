// utils/summaryDraft.ts
export const draftKey = (id: string) => `summary:${id}`;

export const clearSummaryDraft = (analysisId: string) => {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(draftKey(analysisId));
};

export const clearAllSummaryDrafts = () => {
  if (typeof window === 'undefined') return;
  const prefix = 'summary:';
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const k = localStorage.key(i);
    if (k && k.startsWith(prefix)) localStorage.removeItem(k);
  }
};
