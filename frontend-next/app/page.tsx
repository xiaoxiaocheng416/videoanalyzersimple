'use client';

import React, { useState, useEffect } from 'react';
import { VideoUploader } from '@/components/video/VideoUploader';
import { AnalysisProgress } from '@/components/video/AnalysisProgress';
import { ResultsDisplay } from '@/components/video/ResultsDisplay';
import { useVideoAnalyzer } from '@/lib/store';
import { VideoAnalyzerAPI } from '@/lib/api';
import { AlertCircle } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Card } from '@/components/ui/card';
import Image from 'next/image';

export default function HomePage() {
  const {
    stage,
    file,
    progress,
    results,
    error,
    setStage,
    setFile,
    setProgress,
    setResults,
    setError,
    reset,
  } = useVideoAnalyzer();

  const [currentAnalysisStep, setCurrentAnalysisStep] = useState<
    'uploading' | 'analyzing' | 'generating'
  >('uploading');

  const handleFileSelect = async (selectedFile: File) => {
    setFile(selectedFile);
    setStage('uploading');
    setProgress(0);

    try {
      setCurrentAnalysisStep('uploading');
      
      const rawResults = await VideoAnalyzerAPI.analyzeVideo(selectedFile, (uploadProgress) => {
        if (uploadProgress < 100) {
          setProgress(uploadProgress);
        } else {
          setCurrentAnalysisStep('analyzing');
          setStage('analyzing');
          simulateAnalysisProgress();
        }
      });

      setCurrentAnalysisStep('generating');
      setTimeout(() => {
        const formattedResults = VideoAnalyzerAPI.formatAnalysisResults(rawResults);
        setResults(formattedResults);
        setStage('complete');
      }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to analyze video');
      setStage('error');
    }
  };

  const simulateAnalysisProgress = () => {
    let progress = 0;
    const interval = setInterval(() => {
      progress += Math.random() * 15;
      if (progress >= 100) {
        setProgress(100);
        clearInterval(interval);
      } else {
        setProgress(Math.min(progress, 95));
      }
    }, 1000);
  };

  const handleRemoveFile = () => {
    reset();
  };

  const handleAnalyzeAgain = () => {
    reset();
  };

  // ---- Minimal URL analyze entry (no style structure changes) ----
  const [linkUrl, setLinkUrl] = useState('');
  const [linkError, setLinkError] = useState<string | null>(null);
  // API base for direct calls (env override, fallback to /api)
  const API_BASE = (process.env.NEXT_PUBLIC_API_BASE?.replace(/\/$/, '') || '/api');

  const handleAnalyzeUrl = async () => {
    setLinkError(null);
    const url = linkUrl.trim();
    if (!url) {
      setLinkError('请输入有效的 TikTok 链接');
      return;
    }
    try {
      setStage('uploading');
      setProgress(0);
      setCurrentAnalysisStep('analyzing');
      simulateAnalysisProgress();

      const resp = await fetch(`${API_BASE}/videos/analyze_url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const raw = await resp.json();
      if (!resp.ok) {
        throw new Error(raw?.message || raw?.code || 'Analyze failed');
      }

      const formatted = VideoAnalyzerAPI.formatAnalysisResults(
        raw.analysisResult ? raw : { analysisResult: raw.analysis },
      );
      setResults(formatted);
      setStage('complete');
    } catch (e) {
      setError(e instanceof Error ? e.message : '链接分析失败');
      setStage('error');
    }
  };

  return (
    <div className="min-h-screen bg-white">
      <div className="container mx-auto px-4 py-12 max-w-2xl">
        <div className="text-center mb-8">
          <div className="flex justify-center mb-4">
            <Image
              src="/logo4.png"
              alt="Video Analyzer"
              width={60}
              height={60}
              className="rounded-lg"
              priority
            />
          </div>
          
          <h1 className="text-2xl font-normal text-gray-900">
            video analyzer
          </h1>
        </div>

        {stage === 'idle' && (
          <div className="w-full">
            <Card className="relative overflow-hidden backdrop-blur-xl bg-gradient-to-br from-white/80 to-white/60 dark:from-gray-900/80 dark:to-gray-900/60 border border-white/20 shadow-2xl">
              <div className="p-6 space-y-4">
                <VideoUploader
                  onFileSelect={handleFileSelect}
                  onRemove={handleRemoveFile}
                  isUploading={false}
                />

                {/* Link analyze input (minimal add, no layout changes) */}
                <div className="flex items-center gap-2">
                  <input
                    type="url"
                    value={linkUrl}
                    onChange={(e) => setLinkUrl(e.target.value)}
                    placeholder="Paste TikTok video link"
                    className="flex-1 px-3 py-2 rounded-md border bg-white text-sm"
                  />
                  <button
                    onClick={handleAnalyzeUrl}
                    className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm hover:bg-primary/90"
                  >
                    Analyze link
                  </button>
                </div>
                {linkError && (
                  <p className="text-xs text-red-600">{linkError}</p>
                )}
              </div>
            </Card>
          </div>
        )}

        {(stage === 'uploading' || stage === 'analyzing') && (
          <div className="w-full">
            <AnalysisProgress currentStep={currentAnalysisStep} progress={progress} />
          </div>
        )}

        {stage === 'complete' && results && (
          <div className="w-full">
            <ResultsDisplay results={results} onAnalyzeAgain={handleAnalyzeAgain} />
          </div>
        )}

        {stage === 'error' && (
          <div className="w-full">
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Analysis Failed</AlertTitle>
              <AlertDescription className="mt-2">
                <p className="mb-4">{error}</p>
                <button
                  onClick={handleAnalyzeAgain}
                  className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
                >
                  Try Again
                </button>
              </AlertDescription>
            </Alert>
          </div>
        )}
      </div>
    </div>
  );
}
