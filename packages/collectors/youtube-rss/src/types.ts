export interface RssVideoItem {
  videoId: string;
  channelId: string;
  title: string;
  publishedAt: Date;
  url: string;
}

export interface RssFeed {
  channelId: string;
  items: RssVideoItem[];
}

export class RssParseError extends Error {
  readonly code = "RSS_INVALID" as const;

  constructor(message = "RSS feed is invalid") {
    super(message);
    this.name = "RssParseError";
  }
}

export class RssFetchError extends Error {
  readonly code = "RSS_FETCH_FAILED" as const;

  constructor(message = "RSS feed could not be fetched") {
    super(message);
    this.name = "RssFetchError";
  }
}
