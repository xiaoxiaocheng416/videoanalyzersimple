'use client';

import type React from 'react';
import { useEffect, useMemo, useRef } from 'react';

type VideoPaneProps = {
  src?: string | null;
  poster?: string | null;
  type?: 'upload' | 'link';
  linkUrl?: string | null; // fallback for link mode when no direct video src
};

function parseTikTokId(url?: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    // Match /@user/video/1234567890 or /video/1234567890
    const m = u.pathname.match(/\/video\/(\d+)/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

export const VideoPane: React.FC<VideoPaneProps> = ({ src, poster, type = 'upload', linkUrl }) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  
  // Debug logging
  console.log('[VideoPane Debug]', {
    type,
    src: src ? `${src.substring(0, 50)}...` : null,
    linkUrl,
    poster: poster ? 'yes' : 'no',
    willUseVideo: !!src,
    willUseIframe: !src && type === 'link' && linkUrl
  });

  // Ensure video element reloads on src change
  useEffect(() => {
    if (videoRef.current && src) {
      videoRef.current.load();
    }
  }, [src]);

  // Optional PiP button (silent failure)
  const requestPiP = () => {
    const el = videoRef.current as any;
    if (!el) return;
    try {
      if (document.pictureInPictureElement) {
        (document as any).exitPictureInPicture?.().catch(() => {});
      } else {
        el.requestPictureInPicture?.().catch(() => {});
      }
    } catch {}
  };

  const tiktokId = useMemo(
    () => (type === 'link' && !src ? parseTikTokId(linkUrl) : null),
    [type, src, linkUrl],
  );

  return (
    <div className="w-full max-w-sm mx-auto">
      {/* Prefer direct video source if available */}
      {src ? (
        <div className="relative rounded-xl overflow-hidden shadow-md">
          <div className="aspect-[9/16]">
            <video
              ref={videoRef}
              className="w-full h-full object-cover"
              controls
              preload="metadata"
              src={src || undefined}
              poster={poster || undefined}
              key={src} // Ensure component recreates when src changes
            />
          </div>
          <button
            type="button"
            onClick={requestPiP}
            className="absolute top-2 right-2 text-xs px-2 py-1 rounded-md bg-black/50 text-white hover:bg-black/60"
            aria-label="Toggle Picture-in-Picture"
          >
            PiP
          </button>
        </div>
      ) : tiktokId ? (
        // Fallback: TikTok embed (only for link mode when no direct playable_url)
        <div className="relative w-full aspect-[9/16] rounded-md overflow-hidden bg-black/5">
          <iframe
            title="TikTok player"
            className="w-full h-full"
            src={`https://www.tiktok.com/embed/v2/${tiktokId}`}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
          />
        </div>
      ) : (
        <div className="w-full text-sm text-muted-foreground">No video source available.</div>
      )}
    </div>
  );
};

export default VideoPane;
