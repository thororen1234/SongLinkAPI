import type { Metadata } from 'next';
import { ErrorPage, LinksPage } from '../components/links-page.tsx';
import { errorBody, readResolveInput } from '../../api.ts';
import { resolve } from '../../resolver.ts';

export const dynamic = 'force-dynamic';

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  try {
    const data = await resolve({ ...readResolveInput(await searchParams), songIfSingle: true });
    const entity = data.entitiesByUniqueId[data.entityUniqueId];
    const title = [entity?.title, entity?.artistName].filter(Boolean).join(' - ') || 'Song Link';
    return { title, openGraph: { title, images: entity?.thumbnailUrl ? [entity.thumbnailUrl] : [] } };
  } catch {
    return { title: 'Not found' };
  }
}

export default async function ResolvedPage({ searchParams }: Props) {
  const query = await searchParams;
  if (!query.url) return <ErrorPage message="Paste a song or album URL on the home page." />;
  try {
    return <LinksPage data={await resolve({ ...readResolveInput(query), songIfSingle: true })} />;
  } catch (error) {
    return <ErrorPage message={errorBody(error).message} />;
  }
}
