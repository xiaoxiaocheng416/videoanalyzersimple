import { create } from 'zustand';

export type AnalysisStage = 'idle' | 'uploading' | 'analyzing' | 'complete' | 'error';

interface VideoAnalyzerState {
  stage: AnalysisStage;
  file: File | null;
  progress: number;
  results: any | null;
  error: string | null;
  
  setStage: (stage: AnalysisStage) => void;
  setFile: (file: File | null) => void;
  setProgress: (progress: number) => void;
  setResults: (results: any) => void;
  setError: (error: string | null) => void;
  reset: () => void;
}

export const useVideoAnalyzer = create<VideoAnalyzerState>((set) => ({
  stage: 'idle',
  file: null,
  progress: 0,
  results: null,
  error: null,
  
  setStage: (stage) => set({ stage }),
  setFile: (file) => set({ file }),
  setProgress: (progress) => set({ progress }),
  setResults: (results) => set({ results, stage: 'complete' }),
  setError: (error) => set({ error, stage: 'error' }),
  reset: () => set({ 
    stage: 'idle', 
    file: null, 
    progress: 0, 
    results: null, 
    error: null 
  }),
}));