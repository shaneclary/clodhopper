import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';

export async function POST(request: Request) {
  const { pin } = await request.json();
  const correctPin = process.env.AUTH_PIN;

  if (!correctPin) {
    console.error('AUTH_PIN not configured');
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
  }

  // Timing-safe comparison to prevent timing attacks
  const pinBuf = Buffer.from(String(pin));
  const correctBuf = Buffer.from(correctPin);

  if (
    pinBuf.length === correctBuf.length &&
    timingSafeEqual(pinBuf, correctBuf)
  ) {
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: 'Invalid PIN' }, { status: 401 });
}
