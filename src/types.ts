export type EntityType = 'song' | 'album';

export type ApiProvider =
  | 'spotify'
  | 'itunes'
  | 'deezer'
  | 'youtube'
  | 'youtubeMusic'
  | 'tidal'
  | 'pandora'
  | 'soundcloud';

export type Platform =
  | 'spotify'
  | 'appleMusic'
  | 'itunes'
  | 'deezer'
  | 'youtube'
  | 'youtubeMusic'
  | 'tidal'
  | 'pandora'
  | 'soundcloud';

export interface PlatformLink {
  url: string;
  nativeAppUriMobile?: string;
  nativeAppUriDesktop?: string;
}

export interface PublicEntity {
  id: string;
  type: EntityType;
  title?: string;
  artistName?: string;
  thumbnailUrl?: string;
  thumbnailWidth?: number;
  thumbnailHeight?: number;
  apiProvider: ApiProvider;
  platforms: Platform[];
}

export interface Entity extends PublicEntity {
  uniqueId: string;
  isrc?: string;
  upc?: string;
  durationMs?: number;
  links: Partial<Record<Platform, PlatformLink>>;
}

export interface LinkRef {
  type: EntityType;
  id: string;
}

export interface SearchTarget {
  type: EntityType;
  title: string;
  artistName: string;
  isrc?: string;
  upc?: string;
  durationMs?: number;
}

export interface LookupOptions {
  country: string;
  songIfSingle: boolean;
}

export interface Provider {
  apiProvider: ApiProvider;
  platformAliases: string[];
  canLookup(): boolean;
  canSearch(): boolean;
  parseUrl(url: URL): LinkRef | null;
  lookup(ref: LinkRef, opts: LookupOptions): Promise<Entity | null>;
  search(target: SearchTarget, country: string): Promise<Entity | null>;
}

export interface LinksResponse {
  entityUniqueId: string;
  userCountry: string;
  pageUrl: string;
  entitiesByUniqueId: Record<string, PublicEntity>;
  linksByPlatform: Partial<Record<Platform, PlatformLink & { entityUniqueId: string }>>;
}
