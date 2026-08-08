import { NextResponse } from 'next/server';
import { OPENAPI_V1 } from '@/lib/openapi-v1';

export function GET() {
  return NextResponse.json(OPENAPI_V1, { headers: { 'Cache-Control': 'public, max-age=300', 'X-Content-Type-Options': 'nosniff' } });
}
