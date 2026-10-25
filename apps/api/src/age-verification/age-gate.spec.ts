import {
  gateContentItem,
  gateContentPage,
  gateMessage,
  gateMessagePage,
  gateStory,
  gateStoryGroups,
  gateStream,
} from './age-gate';

describe('age gate helpers', () => {
  const notVerified = { viewerId: 'fan-1', ageVerified: false };
  const verified = { viewerId: 'fan-1', ageVerified: true };

  const content = {
    id: 'c1',
    creatorId: 'creator-1',
    title: 'Titre',
    ppvPrice: 9.99,
    creator: { id: 'creator-1', avatar: 'https://cdn/avatar.jpg' },
    files: [{ id: 'f1', type: 'IMAGE', url: 'https://signed/1', thumbnailUrl: 'https://signed/1t' }],
    mediaCount: 1,
    isLocked: false,
  };

  it('strips content file URLs and flags the item', () => {
    const gated = gateContentItem(content, notVerified);
    expect(gated.files).toEqual([{ id: 'f1', type: 'IMAGE', url: null, thumbnailUrl: null }]);
    expect(gated).toMatchObject({ ageVerificationRequired: true, title: 'Titre', ppvPrice: 9.99, mediaCount: 1 });
    expect(gated.creator.avatar).toBe('https://cdn/avatar.jpg');
  });

  it('keeps content for verified viewers and for its creator', () => {
    expect(gateContentItem(content, verified)).toBe(content);
    expect(gateContentItem(content, { viewerId: 'creator-1', ageVerified: false })).toBe(content);
  });

  it('leaves locked content (no files) with its own call to action', () => {
    const locked = { ...content, files: [], isLocked: true };
    expect(gateContentItem(locked, notVerified)).toBe(locked);
  });

  it('gates paginated content', () => {
    const page = gateContentPage({ items: [content], total: 1 }, notVerified);
    expect(page.total).toBe(1);
    expect(page.items[0].files[0].url).toBeNull();
  });

  it('strips story media, keeps text stories and own stories', () => {
    const story = { id: 's1', creatorId: 'creator-1', type: 'PHOTO', mediaUrl: 'https://m', thumbnailUrl: 'https://t', caption: 'hi' };
    expect(gateStory(story, notVerified)).toEqual({ ...story, mediaUrl: null, thumbnailUrl: null, ageVerificationRequired: true });
    const text = { id: 's2', creatorId: 'creator-1', type: 'TEXT', mediaUrl: null, thumbnailUrl: null, text: 'hello' };
    expect(gateStory(text, notVerified)).toBe(text);
    expect(gateStory(story, { viewerId: 'creator-1', ageVerified: false })).toBe(story);

    const groups = gateStoryGroups([{ creator: { id: 'creator-1' }, stories: [story] }], notVerified);
    expect(groups[0].stories[0].mediaUrl).toBeNull();
  });

  it('strips received message attachments but not the sender own ones', () => {
    const received = { id: 'm1', senderId: 'creator-1', receiverId: 'fan-1', content: 'Coucou', attachmentUrl: 'https://a', isPpv: true };
    expect(gateMessage(received, notVerified)).toMatchObject({ attachmentUrl: null, content: 'Coucou', ageVerificationRequired: true });
    const sent = { ...received, senderId: 'fan-1', receiverId: 'creator-1' };
    expect(gateMessage(sent, notVerified)).toBe(sent);
    const textOnly = { ...received, attachmentUrl: null };
    expect(gateMessage(textOnly, notVerified)).toBe(textOnly);
    expect(gateMessagePage({ items: [received], total: 1 }, notVerified).items[0].attachmentUrl).toBeNull();
  });

  it('strips live playback URLs but keeps the thumbnail (cover)', () => {
    const stream = { id: 'l1', creatorId: 'creator-1', streamUrl: 'rtmp://x', recordingUrl: 'https://r', thumbnailUrl: 'https://cover' };
    expect(gateStream(stream, notVerified)).toEqual({
      ...stream,
      streamUrl: null,
      recordingUrl: null,
      ageVerificationRequired: true,
    });
    expect(gateStream(stream, verified)).toBe(stream);
  });
});
