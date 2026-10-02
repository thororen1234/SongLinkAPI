import type { Metadata } from 'next';
import { ErrorPage, LinksPage } from '../../../../components/links-page.tsx';
import { errorBody } from '../../../../../api.ts';
import { resolve } from '../../../../../resolver.ts';

export const dynamic = 'force-dynamic';

type Params = { country: string; type: string; platform: string; id: string };
type Props = { params: Promise<Params> };

function inputFromParams({ country, type, platform, id }: Params) {
  if (!/^[a-z]{2}$/i.test(country) || (type !== 'song' && type !== 'album')) return null;
  return { country: country.toUpperCase(), type, platform, id, songIfSingle: false } as const;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const input = inputFromParams(await params);
  if (!input) return { title: 'Not found' };
  try {
    const data = await resolve(input);
    const entity = data.entitiesByUniqueId[data.entityUniqueId];
    const title = [entity?.title, entity?.artistName].filter(Boolean).join(' - ') || 'Song Link';
    return { title, openGraph: { title, images: entity?.thumbnailUrl ? [entity.thumbnailUrl] : [] } };
  } catch {
    return { title: 'Not found' };
  }
}

export default async function SharePage({ params }: Props) {
  const input = inputFromParams(await params);
  if (!input) return <ErrorPage message="That share link is invalid." />;
  try {
    return <LinksPage data={await resolve(input)} />;
  } catch (error) {
    return <ErrorPage message={errorBody(error).message} />;
  }
}
