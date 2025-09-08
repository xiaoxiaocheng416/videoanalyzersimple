'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ResultsDisplay } from '@/components/video/ResultsDisplay';
import VideoPane from '@/components/video/VideoPane';
import { useRouter } from 'next/navigation';
import React, { useEffect, useMemo, useState } from 'react';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE?.replace(/\/$/, '') || '/api';

// Helper to determine why video can't play
const getVideoErrorReason = (result: any): string => {
  if (!result) return 'No analysis result available';
  const meta = result?.meta || {};

  // Check various failure conditions
  if (result.error) return result.error;
  if (meta.error) return meta.error;
  if (meta.blocked) return 'Video blocked by platform';
  if (meta.private) return 'Video is private';
  if (meta.deleted) return 'Video has been deleted';

  // Check if we have any URL at all
  const hasAnyUrl =
    meta.playable_url ||
    meta.playableUrl ||
    result.playable_url ||
    result.playableUrl ||
    meta.hls_url ||
    meta.hlsUrl;

  if (!hasAnyUrl) return 'No playable video URL found';

  return 'Unable to load video';
};

export default function TaskDetailPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const resp = await fetch(`${API_BASE}/tasks/${params.id}`);
        if (!resp.ok) throw new Error(`Failed to load task: ${resp.status}`);
        const json = await resp.json();
        setData(json);
      } catch (e: any) {
        setError(e?.message || 'Load error');
      } finally {
        setLoading(false);
      }
    })();
  }, [params.id]);

  const resultsProp = useMemo(() => {
    const r = data?.result;
    if (!r) return null;
    const ar = r.analysisResult || r; // support stored shape
    const structured = {
      type: 'structured',
      data: ar?.parsed_data || null,
      fullText: ar?.full_analysis,
      metadata: ar?.metadata,
      validation: ar?.validation_status,
      warning: ar?.warning,
      rawResponse: ar?.raw_response || ar?.full_analysis,
    } as any;
    return structured;
  }, [data]);

  // Enhanced video source selection with error reason
  const { videoSrc, videoPoster, errorReason } = useMemo(() => {
    const result = data?.result || {};
    const meta = result?.meta || {};

    // Fault-tolerant extraction of playable URL from all possible locations
    const playable =
      meta?.playable_url ||
      meta?.playableUrl ||
      result?.playable_url ||
      result?.playableUrl ||
      null;

    const hls = (meta as any)?.hls_url || null;
    const poster = (meta as any)?.poster_url || null;
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
    const isSafari = /Safari\//.test(ua) && !/Chrome\//.test(ua);

    // Try to get a playable source
    if (typeof playable === 'string' && playable.length > 0) {
      return { videoSrc: playable, videoPoster: poster, errorReason: null };
    }
    if (typeof hls === 'string' && hls.length > 0 && isSafari) {
      return { videoSrc: hls, videoPoster: poster, errorReason: null };
    }

    // No playable source, provide reason
    return {
      videoSrc: null,
      videoPoster: poster,
      errorReason: getVideoErrorReason(result),
    };
  }, [data]);

  return (
    <div className="min-h-screen bg-white">
      <div className="container mx-auto px-4 py-8 max-w-6xl">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-semibold">Task Detail</h1>
            <p className="text-sm text-muted-foreground">Task ID: {params.id}</p>
          </div>
          <Button
            variant="secondary"
            onClick={() => {
              // Try to restore context when going back
              if (history.length > 1) {
                history.back();
                return;
              }
              // Fallback: construct batch URL from query param or localStorage
              const sp = new URLSearchParams(location.search);
              const fromQuery = sp.get('batch');
              const last =
                typeof localStorage !== 'undefined' ? localStorage.getItem('lastBatchId') : null;
              const id = fromQuery || last;
              router.push(id ? `/batch?batch=${id}` : '/batch');
            }}
          >
            Back to Batch
          </Button>
        </div>

        {loading && <div>Loading...</div>}
        {error && <div className="text-red-600 text-sm">{error}</div>}

        {!loading && !error && (
          <div className="grid grid-cols-1 lg:grid-cols-[384px_minmax(0,1fr)] gap-6 items-start">
            {/* Left: VideoPane (upload tasks: MVP not play) */}
            <div className="lg:sticky lg:top-6 order-1 lg:order-none">
              <VideoPane
                src={videoSrc}
                poster={videoPoster}
                type={data?.kind === 'url' ? 'link' : 'upload'}
                linkUrl={data?.payload?.url}
              />
              {/* Show error reason if video can't play */}
              {!videoSrc && errorReason && (
                <Card className="mt-4">
                  <CardContent className="pt-6">
                    <p className="text-sm text-muted-foreground mb-3">{errorReason}</p>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={async () => {
                          // Retry analysis
                          await fetch(`${API_BASE}/tasks/${params.id}/retry`, { method: 'POST' });
                          window.location.reload();
                        }}
                      >
                        Retry Analysis
                      </Button>
                      {data?.payload?.url && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => window.open(data.payload.url, '_blank')}
                        >
                          Open Original
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
            {/* Right: ResultsDisplay */}
            <div className="min-w-0">
              {resultsProp ? (
                <ResultsDisplay
                  results={resultsProp}
                  onAnalyzeAgain={() => router.push('/batch')}
                />
              ) : (
                <Card>
                  <CardHeader>
                    <CardTitle>Analysis Result</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground">
                      Task has no result yet. Please return to batch and refresh later.
                    </p>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
