import { NextResponse } from 'next/server';
import { providers } from '../../providers/index.ts';

export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json({
    status: 'ok',
    providers: Object.fromEntries(
      providers.map((provider) => [
        provider.apiProvider,
        { lookup: provider.canLookup(), search: provider.canSearch() },
      ]),
    ),
  });
}
