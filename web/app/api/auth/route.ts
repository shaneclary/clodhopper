import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  const { pin } = await request.json();
  const correctPin = process.env.AUTH_PIN;

  if (!correctPin) {
    console.error('AUTH_PIN not configured');
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
  }

  if (pin === correctPin) {
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: 'Invalid PIN' }, { status: 401 });
}
