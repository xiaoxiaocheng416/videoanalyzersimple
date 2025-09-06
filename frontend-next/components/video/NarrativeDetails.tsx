'use client';

import React from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

type Pillars = {
  hook_0_3s?: number;
  display_clarity?: number;
  creator_trust?: number;
  cta_effectiveness?: number;
};

type TimelineItem = {
  segment?: string;
  phase?: string;
  score?: number;
  spoken_excerpt?: string;
  visual_cue?: string;
  issue?: string;
  fix_hint?: string;
};

type Recommendation = {
  problem?: string;
  solution?: string;
  expected_lift?: string | number;
  difficulty?: string;
};

type AnalysisData = {
  overview?: {
    grade?: string;
    score?: number;
    confidence?: string;
    summary?: string;
    main_issue?: string;
  };
  pillars?: Pillars;
  three_dimensional?: {
    market_saturation?: { score?: number; level?: string; reason?: string };
    product_potential?: { grade?: string; reason?: string };
    creator_performance?: {
      score?: number;
      strengths?: string[];
      weaknesses?: string[];
    };
  };
  timeline?: TimelineItem[];
  recommendations?: Recommendation[];
  forecast?: { views_range?: string; gmv_range?: string; pass_probability?: string };
  insights?: { what_worked?: string; what_failed?: string };
  improvement_summary?: string;
  data_quality?: { completeness?: number };
};

function buildNarrativeText(d: AnalysisData): string {
  const lines: string[] = [];

  // Title
  lines.push('Natural Language Narrative');
  lines.push('');

  // Overview
  const o = d.overview ?? {};
  lines.push(
    `Overall Grade ${o.grade ?? '-'} (${o.score ?? '-'} / 100), confidence ${o.confidence ?? '-'}.`,
  );
  if (o.summary) lines.push(o.summary);
  if (o.main_issue) lines.push(`Main optimization opportunity: ${o.main_issue}`);
  lines.push('');

  // Pillars
  const p = d.pillars ?? {};
  lines.push('Pillars:');
  lines.push(`- Hook (0–3s): ${p.hook_0_3s ?? '-'} / 10`);
  lines.push(`- Display clarity: ${p.display_clarity ?? '-'} / 10`);
  lines.push(`- Creator trust: ${p.creator_trust ?? '-'} / 10`);
  lines.push(`- CTA effectiveness: ${p.cta_effectiveness ?? '-'} / 10`);
  lines.push('');

  // Three-dimensional view
  const td = d.three_dimensional ?? {};
  if (td.market_saturation || td.product_potential || td.creator_performance) {
    lines.push('Three-dimensional view:');
    if (td.market_saturation) {
      lines.push(
        `- Market saturation: ${td.market_saturation.level ?? '-'} (score ${
          td.market_saturation.score ?? '-'
        })${td.market_saturation.reason ? ` — ${td.market_saturation.reason}` : ''}`,
      );
    }
    if (td.product_potential) {
      lines.push(
        `- Product potential: ${td.product_potential.grade ?? '-'}$${
          td.product_potential.reason ? ` — ${td.product_potential.reason}` : ''
        }`.replace('$$', ''),
      );
    }
    if (td.creator_performance) {
      const strengths = (td.creator_performance.strengths ?? []).join(', ');
      const weaknesses = (td.creator_performance.weaknesses ?? []).join(', ');
      lines.push(
        `- Creator performance: ${td.creator_performance.score ?? '-'} — strengths: ${
          strengths || '-'
        }${weaknesses ? `; weaknesses: ${weaknesses}` : ''}`,
      );
    }
    lines.push('');
  }

  // Timeline highlights
  const t = d.timeline ?? [];
  if (t.length) {
    lines.push('Timeline highlights:');
    for (const seg of t) {
      const tag = `${seg.segment ?? ''} ${seg.phase ? `(${seg.phase})` : ''}`.trim();
      const score = seg.score != null ? ` — score ${seg.score}` : '';
      if (tag || score) lines.push(`- ${tag}${score}`);
      if (seg.spoken_excerpt) lines.push(`  · Spoken: "${seg.spoken_excerpt}"`);
      if (seg.visual_cue) lines.push(`  · Visual: ${seg.visual_cue}`);
      if (seg.issue) lines.push(`  · Issue: ${seg.issue}`);
      if (seg.fix_hint) lines.push(`  · Hint: ${seg.fix_hint}`);
    }
    lines.push('');
  }

  // Recommendations
  const recs = d.recommendations ?? [];
  if (recs.length) {
    lines.push('Recommendations:');
    recs.forEach((r, i) => {
      lines.push(`${i + 1}. ${r.problem ?? '-'}`);
      if (r.solution) lines.push(`   → ${r.solution}`);
      if (r.expected_lift)
        lines.push(
          `   (Expected lift: ${r.expected_lift}${r.difficulty ? `, difficulty ${r.difficulty}` : ''})`,
        );
    });
    lines.push('');
  }

  // Forecast & insights
  if (d.forecast) {
    lines.push(
      `Forecast: views ${d.forecast.views_range ?? '-'}, GMV ${
        d.forecast.gmv_range ?? '-'
      }, pass probability ${d.forecast.pass_probability ?? '-'}`,
    );
  }
  if (d.insights) {
    if (d.insights.what_worked) lines.push(`What worked: ${d.insights.what_worked}`);
    if (d.insights.what_failed) lines.push(`What missed: ${d.insights.what_failed}`);
  }
  lines.push('');

  // Data quality
  if (d.data_quality?.completeness != null) {
    try {
      const pct = Math.round((d.data_quality.completeness as number) * 100);
      if (!Number.isNaN(pct)) lines.push(`Data completeness: ${pct}%`);
    } catch {}
  }

  return lines.join('\n');
}

export default function NarrativeDetails({ data, showHeading = true }: { data: AnalysisData; showHeading?: boolean }) {
  const text = buildNarrativeText(data);

  const doCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch (_) {
      // silent
    }
  };

  // When embedded inside AccordionContent, render a plain container (no Card)
  if (showHeading === false) {
    return (
      <div className="space-y-3 leading-7 text-slate-700">
        <div className="flex items-center justify-between mb-1">
          {/* heading hidden by default in accordion usage */}
          <div />
          <Button variant="secondary" size="sm" onClick={doCopy} aria-label="Copy narrative">
            Copy
          </Button>
        </div>
        {text.split('\n').map((line, idx) =>
          line.trim().length === 0 ? (
            <div key={idx} className="h-2" />
          ) : line.startsWith('- ') || /(^\d+\.\s)/.test(line) ? (
            <div key={idx} className="pl-5 before:mr-2 before:content-['•']">
              {line.replace(/^(-\s|\d+\.\s)/, '')}
            </div>
          ) : line.startsWith('  ·') ? (
            <div key={idx} className="pl-8 text-sm text-slate-600">
              {line.replace(/^\s*·\s?/, '• ')}
            </div>
          ) : (
            <p key={idx}>{line}</p>
          ),
        )}
      </div>
    );
  }

  // Standalone Card usage (default)
  return (
    <Card className="mt-6">
      <CardHeader className="flex items-center justify-between gap-4 sm:flex-row sm:items-center">
        <CardTitle>Natural Language Narrative</CardTitle>
        <Button variant="secondary" onClick={doCopy}>
          Copy
        </Button>
      </CardHeader>
      <CardContent>
        <div className="space-y-4 leading-7 text-slate-700">
          {text.split('\n').map((line, idx) =>
            line.trim().length === 0 ? (
              <div key={idx} className="h-2" />
            ) : line.startsWith('- ') || /(^\d+\.\s)/.test(line) ? (
              <div key={idx} className="pl-5 before:mr-2 before:content-['•']">
                {line.replace(/^(-\s|\d+\.\s)/, '')}
              </div>
            ) : line.startsWith('  ·') ? (
              <div key={idx} className="pl-8 text-sm text-slate-600">
                {line.replace(/^\s*·\s?/, '• ')}
              </div>
            ) : (
              <p key={idx}>{line}</p>
            ),
          )}
        </div>
      </CardContent>
    </Card>
  );
}
