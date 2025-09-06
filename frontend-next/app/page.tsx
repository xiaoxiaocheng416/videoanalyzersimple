'use client';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Card } from '@/components/ui/card';
import { AnalysisProgress } from '@/components/video/AnalysisProgress';
import { ResultsDisplay } from '@/components/video/ResultsDisplay';
import VideoPane from '@/components/video/VideoPane';
import { VideoUploader } from '@/components/video/VideoUploader';
import { VideoAnalyzerAPI } from '@/lib/api';
import { useVideoAnalyzer } from '@/lib/store';
import { clearAllSummaryDrafts } from '../utils/summaryDraft';
import { AlertCircle } from 'lucide-react';
import Image from 'next/image';
import React, { useState, useEffect, useRef } from 'react';

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

  // Video player source (page-level state)
  const [videoSrc, setVideoSrc] = useState<string | null>(null);
  const [videoPoster, setVideoPoster] = useState<string | null>(null);
  const [videoType, setVideoType] = useState<'upload' | 'link'>('upload');
  const [lastLinkUrl, setLastLinkUrl] = useState<string | null>(null);
  const blobUrlRef = useRef<string | null>(null);

  // Cleanup blob URL on unmount
  useEffect(() => {
    return () => {
      if (blobUrlRef.current) {
        try {
          URL.revokeObjectURL(blobUrlRef.current);
        } catch {}
      }
    };
  }, []);

  const handleFileSelect = async (selectedFile: File) => {
    clearAllSummaryDrafts(); // Clear drafts when starting new analysis
    setFile(selectedFile);
    setStage('uploading');
    setProgress(0);

    try {
      setCurrentAnalysisStep('uploading');
      // Prepare a blob URL for immediate playback
      try {
        // Revoke old blob URL if exists
        if (blobUrlRef.current) {
          URL.revokeObjectURL(blobUrlRef.current);
        }
        const blobUrl = URL.createObjectURL(selectedFile);
        blobUrlRef.current = blobUrl;
        setVideoSrc(blobUrl);
        setVideoType('upload');
        setVideoPoster(null);
        setLastLinkUrl(null);
      } catch {}

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
    console.log('[ClearDrafts] clearAllSummaryDrafts called from handleAnalyzeAgain');
    clearAllSummaryDrafts(); // Clear all summary drafts when analyzing another
    // Revoke blob if needed
    if (blobUrlRef.current) {
      try {
        URL.revokeObjectURL(blobUrlRef.current);
      } catch {}
      blobUrlRef.current = null;
    }
    setVideoSrc(null);
    setVideoPoster(null);
    setLastLinkUrl(null);
    setVideoType('upload');
    reset();
  };

  // ---- Minimal URL analyze entry (no style structure changes) ----
  const [linkUrl, setLinkUrl] = useState('');
  const [linkError, setLinkError] = useState<string | null>(null);
  // API base for direct calls (env override, fallback to /api)
  const API_BASE = process.env.NEXT_PUBLIC_API_BASE?.replace(/\/$/, '') || '/api';

  const handleAnalyzeUrl = async () => {
    setLinkError(null);
    const url = linkUrl.trim();
    if (!url) {
      setLinkError('请输入有效的 TikTok 链接');
      return;
    }
    clearAllSummaryDrafts(); // Clear drafts when starting new URL analysis
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
      // Prefer direct playable url for link mode, fallback to HLS on Safari
      const playable = raw?.meta?.playable_url || raw?.analysisResult?.metadata?.playable_url || null;
      const hls = raw?.meta?.hls_url || raw?.analysisResult?.metadata?.hls_url || null;
      const poster = raw?.meta?.poster_url || raw?.analysisResult?.metadata?.poster_url || null;
      setVideoType('link');
      setLastLinkUrl(url);
      if (typeof playable === 'string' && playable.length > 0) {
        setVideoSrc(playable);
        setVideoPoster(poster ?? null);
      } else if (typeof hls === 'string' && hls.length > 0) {
        const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
        const isSafari = /Safari\//.test(ua) && !/Chrome\//.test(ua);
        if (isSafari) {
          setVideoSrc(hls);
          setVideoPoster(poster ?? null);
        } else {
          setVideoSrc(null);
          setVideoPoster(null);
        }
      } else {
        setVideoSrc(null);
        setVideoPoster(null);
      }
      setStage('complete');
    } catch (e) {
      setError(e instanceof Error ? e.message : '链接分析失败');
      setStage('error');
    }
  };

  return (
    <div className="min-h-screen bg-white">
      <div className="container mx-auto px-4 py-12 max-w-6xl">
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

          <h1 className="text-2xl font-normal text-gray-900">video analyzer</h1>
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
                {linkError && <p className="text-xs text-red-600">{linkError}</p>}
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
          <div className="w-full grid grid-cols-1 lg:grid-cols-[384px_minmax(0,1fr)] gap-6 items-start">
            {/* Left: sticky video pane (desktop) */}
            <div className="lg:sticky lg:top-6 order-1 lg:order-none">
              <VideoPane
                src={videoSrc}
                poster={videoPoster}
                type={videoType}
                linkUrl={lastLinkUrl}
              />
            </div>
            {/* Right: results */}
            <div className="min-w-0">
              <ResultsDisplay results={results} onAnalyzeAgain={handleAnalyzeAgain} />
            </div>
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
