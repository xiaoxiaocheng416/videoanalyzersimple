import { NextResponse } from 'next/server';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const limit = Number(searchParams.get('limit') || 20);
  const offset = Number(searchParams.get('offset') || 0);
  // Temporary shim: return empty list with proper shape
  return NextResponse.json({ items: [], total: 0, limit, offset });
}

