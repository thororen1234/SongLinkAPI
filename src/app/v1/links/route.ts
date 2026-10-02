import { NextResponse } from 'next/server';
import { errorBody, readResolveInput } from '../../../api.ts';
import { config } from '../../../config.ts';
import { resolve } from '../../../resolver.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  if (config.apiKeys.length && !config.apiKeys.includes(query.get('key') ?? '')) {
    return NextResponse.json(
      { statusCode: 401, code: 'invalid_api_key', message: 'A valid `key` is required' },
      { status: 401, headers: corsHeaders },
    );
  }
  try {
    return NextResponse.json(await resolve(readResolveInput(query)), { headers: corsHeaders });
  } catch (error) {
    const body = errorBody(error);
    return NextResponse.json(body, { status: body.statusCode, headers: corsHeaders });
  }
}
