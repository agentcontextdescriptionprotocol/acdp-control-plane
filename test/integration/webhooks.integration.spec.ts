import { createTestApp, TestAppContext } from '../helpers/test-app';

describe('Webhook subscriptions (integration)', () => {
  let ctx: TestAppContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  beforeEach(async () => {
    await ctx.cleanup();
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  it('creates, lists, and deletes a webhook subscription', async () => {
    const created = (await ctx.client.createWebhook({
      url: 'https://example.com/hook',
      events: ['context_published'],
      secret: 'wh-secret',
    })) as { id: string; url: string; events: string[]; active: boolean };

    expect(created.id).toBeTruthy();
    expect(created.url).toBe('https://example.com/hook');
    expect(created.events).toEqual(['context_published']);
    expect(created.active).toBe(true);

    const listed = (await ctx.client.listWebhooks()) as Array<{ id: string }>;
    expect(listed.find((w) => w.id === created.id)).toBeDefined();

    const delRes = await ctx.client.deleteWebhook(created.id);
    expect(delRes.status).toBe(204);

    const after = (await ctx.client.listWebhooks()) as unknown[];
    expect(after.length).toBe(0);
  });

  it('rejects creation with an invalid URL (400)', async () => {
    const res = await ctx.client.requestRaw('POST', '/webhooks', {
      body: { url: 'not-a-url', secret: 'x' },
    });
    expect(res.status).toBe(400);
  });

  it('rejects creation missing the secret (400)', async () => {
    const res = await ctx.client.requestRaw('POST', '/webhooks', {
      body: { url: 'https://example.com/hook' },
    });
    expect(res.status).toBe(400);
  });
});
