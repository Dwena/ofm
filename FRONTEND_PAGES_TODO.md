# Frontend Pages - Implementation Guide Complet

## 📋 Pages Manquantes à Créer

### ✅ 1. Settings Page - `/app/(app)/settings/page.tsx`
**Status**: À créer
**Complexité**: Moyenne  
**Temps estimé**: 1h

Voir code complet dans ce document section "Settings Page Code"

### ✅ 2. Notifications Page - `/app/(app)/notifications/page.tsx`
**Status**: À créer
**Complexité**: Moyenne
**Temps estimé**: 1h

Fonctionnalités :
- Liste notifications en temps réel
- Mark as read/unread
- Filter par type
- Infinite scroll
- Badge count

### ✅ 3. Stories Viewer - `/app/(app)/stories/[id]/page.tsx`
**Status**: À créer
**Complexité**: Élevée
**Temps estimé**: 2-3h

Fonctionnalités :
- Full-screen immersive
- Swipe navigation (prev/next)
- Progress bar par story
- Auto-play (3-5 sec photo, durée vidéo)
- Tap left/right pour naviguer
- Close avec swipe down

### ✅ 4. Live Streaming Viewer - `/app/(app)/live/[streamId]/page.tsx`
**Status**: À créer  
**Complexité**: Très élevée
**Temps estimé**: 4-5h

Fonctionnalités :
- WebRTC video player
- Live chat sidebar
- Viewer count temps réel
- Send tips during stream
- Reactions/emojis
- Full-screen mode

### ✅ 5. Creator Search/Discovery - `/app/(app)/discover/page.tsx`
**Status**: À créer
**Complexité**: Moyenne
**Temps estimé**: 2h

Fonctionnalités :
- Search bar avec debounce
- Filters (catégorie, prix, popularité)
- Grid de creator cards
- Pagination ou infinite scroll
- Sort options

### ✅ 6. Admin Panel - `/app/(app)/admin/page.tsx`
**Status**: À créer
**Complexité**: Très élevée  
**Temps estimé**: 6-8h

Pages admin :
- `/admin` - Dashboard overview
- `/admin/users` - User management
- `/admin/content` - Content moderation
- `/admin/reports` - Reports queue
- `/admin/analytics` - Platform analytics
- `/admin/settings` - System settings

---

## 🧪 Tests E2E à Créer

### Test 1: Payment Flow - `apps/web/e2e/payment-flow.spec.ts`

```typescript
import { test, expect } from '@playwright/test';

test.describe('Payment Flow', () => {
  test('complete subscription purchase', async ({ page }) => {
    // Login as subscriber
    await page.goto('http://localhost:3000/login');
    await page.fill('[name="email"]', 'david@ofm.com');
    await page.fill('[name="password"]', 'SecurePass123!');
    await page.click('button[type="submit"]');
    
    // Navigate to creator profile
    await page.goto('http://localhost:3000/creator/alice');
    
    // Click subscribe button
    await page.click('text=Subscribe');
    
    // Select tier
    await page.click('text=Premium - €19.99/month');
    
    // Fill Stripe test card
    const stripeFrame = page.frameLocator('iframe[name^="__privateStripeFrame"]');
    await stripeFrame.locator('[name="cardnumber"]').fill('4242424242424242');
    await stripeFrame.locator('[name="exp-date"]').fill('12/34');
    await stripeFrame.locator('[name="cvc"]').fill('123');
    await stripeFrame.locator('[name="postal"]').fill('12345');
    
    // Submit payment
    await page.click('button:has-text("Subscribe Now")');
    
    // Verify success
    await expect(page.locator('text=Subscription successful')).toBeVisible();
    await expect(page.locator('text=You are now subscribed')).toBeVisible();
    
    // Verify access to content
    await page.goto('http://localhost:3000/feed');
    await expect(page.locator('text=Premium Content')).toBeVisible();
  });

  test('send tip to creator', async ({ page }) => {
    await page.goto('http://localhost:3000/login');
    await page.fill('[name="email"]', 'david@ofm.com');
    await page.fill('[name="password"]', 'SecurePass123!');
    await page.click('button[type="submit"]');
    
    await page.goto('http://localhost:3000/creator/alice');
    
    // Click tip button
    await page.click('text=Send Tip');
    
    // Select amount
    await page.click('text=€10');
    
    // Add message
    await page.fill('[name="message"]', 'Great content!');
    
    // Submit
    await page.click('button:has-text("Send Tip")');
    
    await expect(page.locator('text=Tip sent successfully')).toBeVisible();
  });
});
```

### Test 2: Content Upload - `apps/web/e2e/content-upload.spec.ts`

```typescript
import { test, expect } from '@playwright/test';
import path from 'path';

test.describe('Content Upload', () => {
  test('upload image content', async ({ page }) => {
    // Login as creator
    await page.goto('http://localhost:3000/login');
    await page.fill('[name="email"]', 'alice@ofm.com');
    await page.fill('[name="password"]', 'SecurePass123!');
    await page.click('button[type="submit"]');
    
    // Navigate to upload
    await page.goto('http://localhost:3000/creator/upload');
    
    // Upload image file
    const filePath = path.join(__dirname, 'fixtures', 'test-image.jpg');
    await page.setInputFiles('input[type="file"]', filePath);
    
    // Wait for preview
    await expect(page.locator('img[alt="Preview"]')).toBeVisible();
    
    // Fill metadata
    await page.fill('[name="title"]', 'Test Content Upload');
    await page.fill('[name="description"]', 'This is a test upload');
    
    // Select visibility
    await page.click('text=Subscribers Only');
    
    // Set price (PPV)
    await page.check('[name="isPpv"]');
    await page.fill('[name="ppvPrice"]', '9.99');
    
    // Submit
    await page.click('button:has-text("Publish")');
    
    // Verify success
    await expect(page.locator('text=Content published')).toBeVisible();
    
    // Verify content appears in feed
    await page.goto('http://localhost:3000/creator/content');
    await expect(page.locator('text=Test Content Upload')).toBeVisible();
  });

  test('upload video content with processing', async ({ page }) => {
    await page.goto('http://localhost:3000/login');
    await page.fill('[name="email"]', 'alice@ofm.com');
    await page.fill('[name="password"]', 'SecurePass123!');
    await page.click('button[type="submit"]');
    
    await page.goto('http://localhost:3000/creator/upload');
    
    const videoPath = path.join(__dirname, 'fixtures', 'test-video.mp4');
    await page.setInputFiles('input[type="file"]', videoPath);
    
    // Wait for video processing indicator
    await expect(page.locator('text=Processing video')).toBeVisible();
    
    // Wait for completion (may take time)
    await expect(page.locator('text=Video ready')).toBeVisible({ timeout: 60000 });
    
    await page.fill('[name="title"]', 'Test Video Upload');
    await page.click('button:has-text("Publish")');
    
    await expect(page.locator('text=Content published')).toBeVisible();
  });
});
```

### Test 3: Messaging - `apps/web/e2e/messaging.spec.ts`

```typescript
import { test, expect } from '@playwright/test';

test.describe('Messaging', () => {
  test('send and receive messages', async ({ browser }) => {
    // Create two browser contexts (two users)
    const context1 = await browser.newContext();
    const context2 = await browser.newContext();
    
    const page1 = await context1.newPage();
    const page2 = await context2.newPage();
    
    // User 1 (Creator) login
    await page1.goto('http://localhost:3000/login');
    await page1.fill('[name="email"]', 'alice@ofm.com');
    await page1.fill('[name="password"]', 'SecurePass123!');
    await page1.click('button[type="submit"]');
    
    // User 2 (Subscriber) login
    await page2.goto('http://localhost:3000/login');
    await page2.fill('[name="email"]', 'david@ofm.com');
    await page2.fill('[name="password"]', 'SecurePass123!');
    await page2.click('button[type="submit"]');
    
    // User 2 navigates to messages
    await page2.goto('http://localhost:3000/messages');
    
    // Start conversation with alice
    await page2.click('text=New Message');
    await page2.fill('[placeholder="Search users"]', 'alice');
    await page2.click('text=@alice');
    
    // Send message
    const testMessage = 'Hello from E2E test!';
    await page2.fill('[placeholder="Type a message"]', testMessage);
    await page2.press('[placeholder="Type a message"]', 'Enter');
    
    // User 1 should receive message
    await page1.goto('http://localhost:3000/messages');
    
    // Wait for WebSocket message
    await page1.waitForSelector(`text=${testMessage}`, { timeout: 10000 });
    await expect(page1.locator(`text=${testMessage}`)).toBeVisible();
    
    // User 1 replies
    await page1.click(`text=${testMessage}`);
    const replyMessage = 'Thanks for the message!';
    await page1.fill('[placeholder="Type a message"]', replyMessage);
    await page1.press('[placeholder="Type a message"]', 'Enter');
    
    // User 2 should receive reply
    await page2.waitForSelector(`text=${replyMessage}`, { timeout: 10000 });
    await expect(page2.locator(`text=${replyMessage}`)).toBeVisible();
    
    // Cleanup
    await context1.close();
    await context2.close();
  });

  test('typing indicator works', async ({ browser }) => {
    const context1 = await browser.newContext();
    const context2 = await browser.newContext();
    
    const page1 = await context1.newPage();
    const page2 = await context2.newPage();
    
    // Setup both users in conversation
    // ... (login code similar to above)
    
    // User 2 starts typing
    await page2.fill('[placeholder="Type a message"]', 'Test');
    
    // User 1 should see typing indicator
    await expect(page1.locator('text=typing...')).toBeVisible({ timeout: 3000 });
    
    // User 2 stops typing
    await page2.press('[placeholder="Type a message"]', 'Escape');
    await page2.fill('[placeholder="Type a message"]', '');
    
    // Typing indicator should disappear
    await expect(page1.locator('text=typing...')).not.toBeVisible({ timeout: 5000 });
    
    await context1.close();
    await context2.close();
  });
});
```

### Test 4: Creator Dashboard - `apps/web/e2e/creator-dashboard.spec.ts`

```typescript
import { test, expect } from '@playwright/test';

test.describe('Creator Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:3000/login');
    await page.fill('[name="email"]', 'alice@ofm.com');
    await page.fill('[name="password"]', 'SecurePass123!');
    await page.click('button[type="submit"]');
  });

  test('displays earnings statistics', async ({ page }) => {
    await page.goto('http://localhost:3000/creator/stats');
    
    // Check earnings cards
    await expect(page.locator('text=Total Earnings')).toBeVisible();
    await expect(page.locator('text=This Month')).toBeVisible();
    await expect(page.locator('text=Subscribers')).toBeVisible();
    
    // Check charts
    await expect(page.locator('canvas')).toBeVisible();
  });

  test('manage subscription tiers', async ({ page }) => {
    await page.goto('http://localhost:3000/creator/tiers');
    
    // Create new tier
    await page.click('text=Create Tier');
    await page.fill('[name="name"]', 'VIP Tier');
    await page.fill('[name="price"]', '49.99');
    await page.fill('[name="description"]', 'Exclusive VIP access');
    await page.click('button:has-text("Create")');
    
    await expect(page.locator('text=Tier created')).toBeVisible();
    await expect(page.locator('text=VIP Tier')).toBeVisible();
  });

  test('view subscriber list', async ({ page }) => {
    await page.goto('http://localhost:3000/creator/subscribers');
    
    await expect(page.locator('text=Active Subscribers')).toBeVisible();
    
    // Should show subscriber cards
    const subscriberCards = page.locator('[data-testid="subscriber-card"]');
    await expect(subscriberCards).toHaveCount(await subscriberCards.count());
  });
});
```

---

## 📦 Test Fixtures

Créer `apps/web/e2e/fixtures/` avec :

### test-image.jpg
Image 1920x1080 pour tests upload

### test-video.mp4  
Vidéo courte (5-10 sec) pour tests encoding

### test-user.json
```json
{
  "creator": {
    "email": "alice@ofm.com",
    "password": "SecurePass123!",
    "username": "alice"
  },
  "subscriber": {
    "email": "david@ofm.com",
    "password": "SecurePass123!",
    "username": "david"
  },
  "admin": {
    "email": "admin@ofm.com",
    "password": "SecurePass123!",
    "username": "admin"
  }
}
```

---

## 🚀 Commandes pour lancer les tests

```bash
# Installer Playwright browsers (première fois)
cd apps/web
npx playwright install

# Lancer tous les tests
npm run test:e2e

# Lancer un test spécifique
npx playwright test e2e/payment-flow.spec.ts

# Mode UI (interactif)
npm run test:e2e:ui

# Mode debug
npm run test:e2e:debug

# Générer rapport
npx playwright show-report
```

---

## ✅ Checklist Implémentation

### Pages Frontend
- [ ] Settings page
- [ ] Notifications page
- [ ] Stories viewer
- [ ] Live streaming viewer
- [ ] Creator search/discovery
- [ ] Admin panel (dashboard)
- [ ] Admin users management
- [ ] Admin content moderation
- [ ] Admin reports handling

### Tests E2E
- [ ] Payment flow test
- [ ] Content upload test (image)
- [ ] Content upload test (video)
- [ ] Messaging test
- [ ] Typing indicator test
- [ ] Creator dashboard test
- [ ] Subscription tier management test
- [ ] Auth flow test (login/register/2FA)

### Intégrations
- [ ] WebRTC live streaming frontend
- [ ] Push notifications frontend
- [ ] Video encoding progress UI
- [ ] Real-time analytics updates

---

## 📚 Prochaines Étapes

1. **Créer dossiers tests**
   ```bash
   mkdir -p apps/web/e2e/fixtures
   ```

2. **Copier code tests** depuis ce document

3. **Ajouter images/vidéos test** dans fixtures/

4. **Lancer tests**
   ```bash
   npm run test:e2e
   ```

5. **Itérer** sur les tests qui échouent

---

**Temps total estimé** : 20-30 heures pour tout implémenter  
**Priorité 1** : Settings + Notifications + Tests payment (5-6h)  
**Priorité 2** : Stories + Search + Tests messaging (6-8h)  
**Priorité 3** : Live + Admin + Tests complets (10-12h)
