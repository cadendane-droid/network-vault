import prisma from '@/lib/prisma';
import { NextResponse } from 'next/server';

export async function GET() {
  const result = await prisma.$queryRaw`SELECT 1 as connected`;
  return NextResponse.json({ result });
}
