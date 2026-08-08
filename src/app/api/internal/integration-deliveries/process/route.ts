import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { processDeliveryBatch } from '@/lib/integrations/delivery-queue';
import { PrismaDeliveryStore } from '@/lib/integrations/prisma-delivery-store';
import { authorizeDeliveryWorker } from '@/lib/integrations/worker-auth';

export async function POST(req: Request) {
  const secret = process.env.DELIVERY_WORKER_SECRET;
  if (!secret || secret.length < 32) {
    return NextResponse.json(
      { error: 'Delivery worker is not configured' },
      { status: 503 },
    );
  }
  if (!authorizeDeliveryWorker(req.headers.get('authorization'), secret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const summary = await processDeliveryBatch({
      store: new PrismaDeliveryStore(prisma),
      workerId: `worker-${randomUUID()}`,
      batchSize: 20,
    });
    return NextResponse.json(summary, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    console.error('[integrations] delivery processor failed:', error);
    return NextResponse.json({ error: 'Delivery processing failed' }, { status: 500 });
  }
}
