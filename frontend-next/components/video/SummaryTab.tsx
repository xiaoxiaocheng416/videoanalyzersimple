'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
// quiet copy feedback (no toast)
import { splitIntoParagraphs } from '@/lib/text';
import { useCallback, useMemo, useState } from 'react';

export default function SummaryTab({ summary }: { summary?: string }) {
  const paragraphs = useMemo(() => splitIntoParagraphs(summary ?? '', 3), [summary]);
  const textBlock = useMemo(() => (paragraphs.length ? paragraphs.join('\n\n') : ''), [paragraphs]);
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      if (!textBlock) return;
      await navigator.clipboard.writeText(textBlock);
      setCopied(true);
      // Reset after 2 seconds
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // silent failure
    }
  }, [textBlock]);

  if (!paragraphs.length) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Improvement Summary</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          No summary available for this run.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card data-improvement-summary>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Improvement Summary</CardTitle>
        <Button
          variant="secondary"
          size="sm"
          onClick={handleCopy}
          disabled={!textBlock || copied}
          aria-disabled={!textBlock}
          aria-live="polite"
        >
          {copied ? '✓ Copied' : 'Copy'}
        </Button>
      </CardHeader>
      <CardContent>
        <div className="space-y-3 leading-7 text-slate-700">
          {paragraphs.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>
      </CardContent>
      {/* quiet mode: no global/local toasts */}
    </Card>
  );
}
