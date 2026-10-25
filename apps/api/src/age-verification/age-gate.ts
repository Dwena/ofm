/**
 * Helpers stripping explicit media from API responses when the requester's
 * age is not verified. Everything else (texts, prices, creator, counters,
 * avatars, covers) is kept and the item gets `ageVerificationRequired: true`
 * so the web shows a blurred placeholder with a "Vérifier mon âge" button.
 *
 * The requester's own items (a creator managing their own content is a
 * KYC-verified adult) are never stripped.
 */

export interface AgeGateViewer {
  /** Requester id (items they created are left untouched) */
  viewerId?: string | null;
  ageVerified: boolean;
}

const isOwnedBy = (ownerId: unknown, viewerId?: string | null) => !!viewerId && ownerId === viewerId;

/**
 * Content item (content.service serializeContent): files keep their
 * metadata (type, order...) but lose their URLs
 */
export function gateContentItem<T extends Record<string, any>>(item: T, viewer: AgeGateViewer): T {
  if (!item || viewer.ageVerified || isOwnedBy(item.creatorId, viewer.viewerId)) return item;
  // Locked content (no files returned) keeps its subscribe / unlock call to action
  if (!Array.isArray(item.files) || item.files.length === 0) return item;
  return {
    ...item,
    files: item.files.map((file: any) => ({ ...file, url: null, thumbnailUrl: null })),
    ageVerificationRequired: true,
  };
}

export function gateContentItems<T extends Record<string, any>>(items: T[], viewer: AgeGateViewer): T[] {
  return Array.isArray(items) ? items.map((item) => gateContentItem(item, viewer)) : items;
}

/**
 * Paginated result `{ items, ... }` of content
 */
export function gateContentPage<T extends { items?: any[] }>(page: T, viewer: AgeGateViewer): T {
  if (!page || !Array.isArray(page.items)) return page;
  return { ...page, items: gateContentItems(page.items, viewer) };
}

/**
 * Story (stories.service presentStories): media and thumbnail URLs removed
 */
export function gateStory<T extends Record<string, any>>(story: T, viewer: AgeGateViewer): T {
  if (!story || viewer.ageVerified || isOwnedBy(story.creatorId, viewer.viewerId)) return story;
  // Text stories and locked ones (media already removed) are left as they are
  if (!story.mediaUrl && !story.thumbnailUrl) return story;
  return { ...story, mediaUrl: null, thumbnailUrl: null, ageVerificationRequired: true };
}

export function gateStories<T extends Record<string, any>>(stories: T[], viewer: AgeGateViewer): T[] {
  return Array.isArray(stories) ? stories.map((story) => gateStory(story, viewer)) : stories;
}

/**
 * Stories feed: groups `{ creator, stories, ... }`
 */
export function gateStoryGroups<T extends { stories?: any[] }>(groups: T[], viewer: AgeGateViewer): T[] {
  if (!Array.isArray(groups)) return groups;
  return groups.map((group) =>
    Array.isArray(group?.stories) ? { ...group, stories: gateStories(group.stories, viewer) } : group,
  );
}

/**
 * Direct message: attachments received from someone else are removed
 * (PPV or not: a creator may send explicit media in a free message)
 */
export function gateMessage<T extends Record<string, any>>(message: T, viewer: AgeGateViewer): T {
  if (!message || viewer.ageVerified || isOwnedBy(message.senderId, viewer.viewerId)) return message;
  if (!message.attachmentUrl) return message;
  return { ...message, attachmentUrl: null, ageVerificationRequired: true };
}

export function gateMessagePage<T extends { items?: any[] }>(page: T, viewer: AgeGateViewer): T {
  if (!page || !Array.isArray(page.items)) return page;
  return { ...page, items: page.items.map((message) => gateMessage(message, viewer)) };
}

/**
 * Live stream: playback / recording URLs removed (the live's thumbnail is
 * a cover, which the content rules require to be non-explicit)
 */
export function gateStream<T extends Record<string, any>>(stream: T, viewer: AgeGateViewer): T {
  if (!stream || viewer.ageVerified || isOwnedBy(stream.creatorId, viewer.viewerId)) return stream;
  return {
    ...stream,
    ...('streamUrl' in stream ? { streamUrl: null } : {}),
    ...('recordingUrl' in stream ? { recordingUrl: null } : {}),
    ageVerificationRequired: true,
  };
}

export function gateStreams<T extends Record<string, any>>(streams: T[], viewer: AgeGateViewer): T[] {
  return Array.isArray(streams) ? streams.map((stream) => gateStream(stream, viewer)) : streams;
}
