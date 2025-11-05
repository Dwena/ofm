# Fonctionnalités UI - Documentation Complète

## Vue d'ensemble

Ce document couvre toutes les fonctionnalités UI avancées implémentées pour la plateforme OFM. Toutes les fonctionnalités sont prêtes à l'emploi et entièrement intégrées.

---

## 1. Lightbox pour les Médias

### Emplacement
`/apps/web/components/ui/lightbox.tsx`

### Description
Composant de visualisation en plein écran pour images et vidéos avec navigation, zoom, et téléchargement.

### Fonctionnalités
- ✅ **Affichage plein écran** avec overlay noir
- ✅ **Navigation** entre médias (flèches, clavier)
- ✅ **Zoom** pour les images (0.5x à 3x)
- ✅ **Téléchargement** des médias
- ✅ **Mode plein écran** natif du navigateur
- ✅ **Miniatures** pour navigation rapide
- ✅ **Support clavier** (ESC, flèches, +/-)
- ✅ **Support vidéo** avec lecture automatique

### Utilisation

```tsx
import { Lightbox } from '@/components/ui/lightbox';

const items = [
  { type: 'image', url: '/image1.jpg', title: 'Photo 1' },
  { type: 'video', url: '/video1.mp4', thumbnail: '/thumb1.jpg' },
];

function MyComponent() {
  const [isOpen, setIsOpen] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);

  return (
    <>
      <button onClick={() => setIsOpen(true)}>Ouvrir la galerie</button>
      <Lightbox
        items={items}
        initialIndex={currentIndex}
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
      />
    </>
  );
}
```

### Raccourcis Clavier
- **ESC**: Fermer le lightbox
- **←/→**: Navigation précédent/suivant
- **+/-**: Zoom avant/arrière (images)

### Props Interface
```typescript
interface MediaItem {
  type: 'image' | 'video';
  url: string;
  thumbnail?: string;
  title?: string;
}

interface LightboxProps {
  items: MediaItem[];
  initialIndex?: number;
  isOpen: boolean;
  onClose: () => void;
}
```

---

## 2. Player Vidéo Custom

### Emplacement
`/apps/web/components/ui/video-player.tsx`

### Description
Lecteur vidéo HTML5 personnalisé avec contrôles complets, vitesse de lecture, et gestion avancée.

### Fonctionnalités
- ✅ **Contrôles personnalisés** (play/pause, volume, progression)
- ✅ **Vitesse de lecture** (0.5x, 0.75x, 1x, 1.25x, 1.5x, 2x)
- ✅ **Barre de progression** avec buffer visible
- ✅ **Contrôle du volume** avec slider
- ✅ **Skip** ±10 secondes
- ✅ **Mode plein écran**
- ✅ **Auto-masquage** des contrôles (3s)
- ✅ **Affichage du temps** (actuel / total)
- ✅ **Support mobile** responsive

### Utilisation

```tsx
import { VideoPlayer } from '@/components/ui/video-player';

function MyComponent() {
  return (
    <VideoPlayer
      src="/video.mp4"
      poster="/thumbnail.jpg"
      autoPlay={false}
      onEnded={() => console.log('Vidéo terminée')}
      className="max-w-4xl mx-auto"
    />
  );
}
```

### Props
```typescript
interface VideoPlayerProps {
  src: string;
  poster?: string;
  autoPlay?: boolean;
  className?: string;
  onEnded?: () => void;
}
```

### Contrôles Disponibles
- **Play/Pause**: Cliquer sur la vidéo ou bouton
- **Skip Back/Forward**: ±10 secondes
- **Volume**: Slider + bouton mute
- **Settings**: Menu de vitesse de lecture
- **Fullscreen**: Bouton plein écran
- **Timeline**: Cliquer pour sauter à un moment précis

### Événements
- `onEnded`: Appelé quand la vidéo se termine

---

## 3. Upload de Fichiers avec Preview

### Emplacement
`/apps/web/components/ui/file-upload.tsx`

### Description
Composant d'upload de fichiers avec drag & drop, preview, validation, et barre de progression.

### Fonctionnalités
- ✅ **Drag & Drop** pour uploader
- ✅ **Preview** des images et vidéos
- ✅ **Validation** (taille, type)
- ✅ **Multi-fichiers** ou fichier unique
- ✅ **Barre de progression** par fichier
- ✅ **Gestion des erreurs** avec messages
- ✅ **Suppression** individuelle
- ✅ **Auto-upload** optionnel
- ✅ **Formatage** des tailles de fichiers
- ✅ **Génération de thumbnails** pour vidéos

### Utilisation

```tsx
import { FileUpload } from '@/components/ui/file-upload';
import { mediaApi } from '@/lib/api';

function MyComponent() {
  const handleUpload = async (files: File[]) => {
    const formData = new FormData();
    files.forEach(file => formData.append('files', file));

    await mediaApi.uploadFiles(formData);
  };

  return (
    <FileUpload
      accept="image/*,video/*"
      multiple={true}
      maxSize={100} // 100MB
      maxFiles={10}
      onUpload={handleUpload}
      onChange={(files) => console.log('Files selected:', files)}
    />
  );
}
```

### Props
```typescript
interface FileUploadProps {
  accept?: string; // 'image/*,video/*', '*'
  multiple?: boolean;
  maxSize?: number; // en MB
  maxFiles?: number;
  onUpload?: (files: File[]) => Promise<void>;
  onChange?: (files: UploadedFile[]) => void;
  className?: string;
  disabled?: boolean;
}
```

### Types de Fichiers Supportés
- **Images**: jpg, png, gif, webp, svg
- **Vidéos**: mp4, webm, mov, avi
- **Tous**: Utiliser `accept="*"`

### Validation
- Taille maximale configurable
- Types de fichiers restreints
- Nombre maximum de fichiers
- Messages d'erreur en français

---

## 4. Notifications Push

### Emplacements
- Service Worker: `/apps/web/public/service-worker.js`
- Hook: `/apps/web/hooks/use-push-notifications.ts`
- Composant UI: `/apps/web/components/notifications-manager.tsx`

### Description
Système complet de notifications push avec service worker, gestion des permissions, et notifications locales.

### Fonctionnalités
- ✅ **Service Worker** enregistré automatiquement
- ✅ **Demande de permissions** avec UI
- ✅ **Souscription/Désouscription** aux notifications
- ✅ **Notifications locales** testables
- ✅ **Cache** des ressources offline
- ✅ **Click handlers** pour ouvrir l'app
- ✅ **Background sync** support
- ✅ **Gestion des types** de notifications

### Configuration Service Worker

Le service worker gère:
- Cache des ressources
- Notifications push
- Background sync
- Periodic sync
- Click handlers

### Utilisation du Hook

```tsx
import { usePushNotifications } from '@/hooks/use-push-notifications';

function MyComponent() {
  const {
    isSupported,
    permission,
    isSubscribed,
    subscribe,
    unsubscribe,
    showLocalNotification,
  } = usePushNotifications();

  const handleSubscribe = async () => {
    try {
      await subscribe();
      console.log('Subscribed to push notifications');
    } catch (error) {
      console.error('Failed to subscribe:', error);
    }
  };

  const handleTestNotification = async () => {
    await showLocalNotification({
      title: 'Test',
      body: 'Ceci est un test',
      icon: '/icon.png',
      url: '/dashboard',
    });
  };

  return (
    <div>
      <p>Support: {isSupported ? 'Oui' : 'Non'}</p>
      <p>Permission: {permission}</p>
      <p>Abonné: {isSubscribed ? 'Oui' : 'Non'}</p>
      <button onClick={handleSubscribe}>S'abonner</button>
      <button onClick={handleTestNotification}>Test</button>
    </div>
  );
}
```

### Composant UI

```tsx
import { NotificationsManager } from '@/components/notifications-manager';

// Dans la page de paramètres
<NotificationsManager />
```

### Variables d'Environnement Requises

```env
NEXT_PUBLIC_VAPID_PUBLIC_KEY=your_vapid_public_key
```

### Génération des clés VAPID

```bash
npx web-push generate-vapid-keys
```

### API Backend Requise

Créer les endpoints suivants dans le backend:
- `POST /api/push/subscribe`: Sauvegarder la souscription
- `POST /api/push/unsubscribe`: Supprimer la souscription
- `POST /api/push/send`: Envoyer une notification

---

## 5. Dark Mode

### Emplacements
- Provider: `/apps/web/components/theme-provider.tsx`
- Toggle: `/apps/web/components/theme-toggle.tsx`

### Description
Système de thème complet avec support clair/sombre/système, persistance localStorage, et détection automatique.

### Fonctionnalités
- ✅ **3 modes**: Clair, Sombre, Système
- ✅ **Détection système** automatique
- ✅ **Persistance** localStorage
- ✅ **Synchronisation** avec préférence OS
- ✅ **Transitions** fluides
- ✅ **Support Tailwind** classes dark:
- ✅ **color-scheme** pour éléments natifs

### Configuration

1. **Wrapper l'app avec ThemeProvider**:

```tsx
// app/layout.tsx
import { ThemeProvider } from '@/components/theme-provider';

export default function RootLayout({ children }) {
  return (
    <html lang="fr">
      <body>
        <ThemeProvider defaultTheme="system">
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
```

2. **Ajouter le toggle dans la navigation**:

```tsx
import { ThemeToggle } from '@/components/theme-toggle';

function Header() {
  return (
    <header>
      <ThemeToggle />
    </header>
  );
}
```

### Utilisation du Hook

```tsx
import { useTheme } from '@/components/theme-provider';

function MyComponent() {
  const { theme, setTheme, actualTheme } = useTheme();

  return (
    <div>
      <p>Thème actuel: {theme}</p>
      <p>Thème effectif: {actualTheme}</p>
      <button onClick={() => setTheme('dark')}>Mode sombre</button>
      <button onClick={() => setTheme('light')}>Mode clair</button>
      <button onClick={() => setTheme('system')}>Système</button>
    </div>
  );
}
```

### Tailwind CSS

Utiliser les classes `dark:` pour le mode sombre:

```tsx
<div className="bg-white dark:bg-gray-900 text-black dark:text-white">
  Content
</div>
```

### Variables CSS

Les variables CSS s'adaptent automatiquement avec le thème:

```css
:root {
  --background: 0 0% 100%;
  --foreground: 222.2 84% 4.9%;
}

.dark {
  --background: 222.2 84% 4.9%;
  --foreground: 210 40% 98%;
}
```

---

## 6. Internationalisation (i18n)

### Emplacements
- Système: `/apps/web/lib/i18n/`
- Traductions FR: `/apps/web/lib/i18n/locales/fr.ts`
- Traductions EN: `/apps/web/lib/i18n/locales/en.ts`
- Provider: `/apps/web/components/i18n-provider.tsx`
- Sélecteur: `/apps/web/components/language-selector.tsx`

### Description
Système i18n complet avec support français/anglais, interpolation de variables, et persistance.

### Langues Supportées
- 🇫🇷 Français (par défaut)
- 🇬🇧 English

### Configuration

1. **Wrapper l'app avec I18nProvider**:

```tsx
// app/layout.tsx
import { I18nProvider } from '@/components/i18n-provider';

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        <I18nProvider initialLocale="fr">
          {children}
        </I18nProvider>
      </body>
    </html>
  );
}
```

2. **Ajouter le sélecteur de langue**:

```tsx
import { LanguageSelector } from '@/components/language-selector';

function Header() {
  return (
    <header>
      <LanguageSelector />
    </header>
  );
}
```

### Utilisation des Traductions

```tsx
import { useTranslation, useT } from '@/components/i18n-provider';

function MyComponent() {
  const { t, translate, locale, setLocale } = useTranslation();

  return (
    <div>
      <h1>{t.common.welcome}</h1>
      <p>{t.auth.loginSuccess}</p>

      {/* Avec interpolation */}
      <p>{translate('validation.minLength', { min: 8 })}</p>

      {/* Changer la langue */}
      <button onClick={() => setLocale('en')}>English</button>
      <button onClick={() => setLocale('fr')}>Français</button>
    </div>
  );
}
```

### Structure des Traductions

Les traductions sont organisées par catégories:

```typescript
{
  common: { welcome, login, logout, ... },
  nav: { home, profile, settings, ... },
  auth: { signIn, signUp, ... },
  profile: { editProfile, displayName, ... },
  creator: { becomeCreator, earnings, ... },
  content: { createPost, uploadImage, ... },
  wallet: { balance, requestPayout, ... },
  notifications: { pushNotifications, ... },
  settings: { account, privacy, ... },
  errors: { generic, networkError, ... },
  validation: { required, invalidEmail, ... },
}
```

### Ajouter une Nouvelle Langue

1. Créer `/apps/web/lib/i18n/locales/es.ts`:

```typescript
import { Translations } from './fr';

export const es: Translations = {
  common: {
    welcome: 'Bienvenido',
    // ... toutes les traductions
  },
  // ...
};
```

2. Mettre à jour `/apps/web/lib/i18n/index.ts`:

```typescript
export type Locale = 'fr' | 'en' | 'es';

export const locales: Record<Locale, Translations> = {
  fr,
  en,
  es,
};
```

### Interpolation de Variables

```typescript
// Dans la traduction
minLength: 'Longueur minimale : {min} caractères'

// Dans le code
translate('validation.minLength', { min: 8 })
// Résultat: "Longueur minimale : 8 caractères"
```

---

## 7. Responsive Mobile Complet

### Emplacements
- Layout: `/apps/web/components/responsive-layout.tsx`
- Styles: `/apps/web/styles/responsive.css`

### Description
Système responsive complet avec layout adaptatif, breakpoints, et hooks utilitaires.

### Breakpoints

```css
mobile: 0-767px
tablet: 768px-1023px
desktop: 1024px+
```

### Composant ResponsiveLayout

```tsx
import { ResponsiveLayout } from '@/components/responsive-layout';

function Page() {
  const sidebar = (
    <nav>
      <a href="/home">Accueil</a>
      <a href="/profile">Profil</a>
    </nav>
  );

  const header = (
    <div className="flex items-center justify-between w-full">
      <Logo />
      <UserMenu />
    </div>
  );

  return (
    <ResponsiveLayout sidebar={sidebar} header={header}>
      <h1>Contenu de la page</h1>
    </ResponsiveLayout>
  );
}
```

### Fonctionnalités du Layout
- ✅ **Menu mobile** en drawer coulissant
- ✅ **Sidebar desktop** sticky
- ✅ **Header** sticky avec bouton menu
- ✅ **Overlay** pour le mobile menu
- ✅ **Auto-fermeture** au clic extérieur
- ✅ **Prévention du scroll** quand menu ouvert

### Hooks Utilitaires

#### useIsMobile

```tsx
import { useIsMobile } from '@/components/responsive-layout';

function MyComponent() {
  const isMobile = useIsMobile();

  return (
    <div>
      {isMobile ? <MobileView /> : <DesktopView />}
    </div>
  );
}
```

#### useScreenSize

```tsx
import { useScreenSize } from '@/components/responsive-layout';

function MyComponent() {
  const screenSize = useScreenSize(); // 'mobile' | 'tablet' | 'desktop'

  return (
    <div>
      <p>Taille écran: {screenSize}</p>
    </div>
  );
}
```

### Classes Utilitaires CSS

```html
<!-- Grille responsive -->
<div class="grid-responsive">
  <!-- 1 col mobile, 2 tablet, 3 desktop, 4 large -->
</div>

<!-- Container responsive -->
<div class="container-responsive">
  <!-- Padding adaptatif -->
</div>

<!-- Titre responsive -->
<h1 class="heading-responsive">
  <!-- Taille adaptative -->
</h1>

<!-- Flex colonne mobile, ligne desktop -->
<div class="flex-col-mobile">
  <!-- Items -->
</div>

<!-- Affichage conditionnel -->
<div class="mobile-only">Visible mobile uniquement</div>
<div class="desktop-only">Visible desktop uniquement</div>
```

### Image et Vidéo Responsive

```html
<!-- Image responsive -->
<img src="image.jpg" class="image-responsive" alt="..." />

<!-- Vidéo responsive 16:9 -->
<div class="video-responsive">
  <video src="video.mp4"></video>
</div>
```

### Table Responsive

```html
<div class="table-responsive">
  <table>
    <!-- Table content -->
  </table>
</div>
```

### Safe Area (iOS)

```html
<div class="safe-area-top safe-area-bottom">
  <!-- Content avec padding pour le notch -->
</div>
```

### Boutons Touch-Friendly

Sur mobile, tous les boutons ont automatiquement:
- `min-height: 44px`
- `min-width: 44px`

Conforme aux recommandations Apple/Android pour la taille minimale des zones tactiles.

### Scrollbar Custom (Desktop)

```html
<div class="custom-scrollbar overflow-y-auto">
  <!-- Scrollbar stylisée sur desktop -->
</div>
```

### Accessibility

#### Reduced Motion

Les animations sont désactivées automatiquement pour les utilisateurs ayant activé "Reduce Motion":

```css
@media (prefers-reduced-motion: reduce) {
  /* Animations minimales */
}
```

#### High Contrast

Les bordures sont renforcées en mode contraste élevé:

```css
@media (prefers-contrast: high) {
  /* Contraste augmenté */
}
```

---

## Intégration Complète

### app/layout.tsx

```tsx
import { ThemeProvider } from '@/components/theme-provider';
import { I18nProvider } from '@/components/i18n-provider';
import '@/styles/responsive.css';

export default function RootLayout({ children }) {
  return (
    <html lang="fr">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <link rel="manifest" href="/manifest.json" />
      </head>
      <body>
        <ThemeProvider defaultTheme="system">
          <I18nProvider initialLocale="fr">
            {children}
          </I18nProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
```

### Exemple de Page Complète

```tsx
'use client';

import { ResponsiveLayout } from '@/components/responsive-layout';
import { ThemeToggle } from '@/components/theme-toggle';
import { LanguageSelector } from '@/components/language-selector';
import { NotificationsManager } from '@/components/notifications-manager';
import { Lightbox } from '@/components/ui/lightbox';
import { VideoPlayer } from '@/components/ui/video-player';
import { FileUpload } from '@/components/ui/file-upload';
import { useTranslation } from '@/components/i18n-provider';

export default function DemoPage() {
  const { t } = useTranslation();

  const sidebar = (
    <nav className="space-y-2">
      <a href="/">{t.nav.home}</a>
      <a href="/profile">{t.nav.profile}</a>
      <a href="/settings">{t.nav.settings}</a>
    </nav>
  );

  const header = (
    <div className="flex items-center justify-between w-full">
      <h1>{t.common.welcome}</h1>
      <div className="flex items-center gap-2">
        <LanguageSelector />
        <ThemeToggle />
      </div>
    </div>
  );

  return (
    <ResponsiveLayout sidebar={sidebar} header={header}>
      <div className="space-y-8">
        {/* Notifications */}
        <NotificationsManager />

        {/* Video Player */}
        <VideoPlayer src="/video.mp4" />

        {/* File Upload */}
        <FileUpload
          accept="image/*,video/*"
          maxSize={50}
          onUpload={async (files) => {
            // Upload logic
          }}
        />

        {/* Media Grid */}
        <div className="grid-responsive">
          {/* Media items */}
        </div>
      </div>
    </ResponsiveLayout>
  );
}
```

---

## Performance et Optimisation

### Lazy Loading

Les composants peuvent être chargés dynamiquement:

```tsx
import dynamic from 'next/dynamic';

const Lightbox = dynamic(() => import('@/components/ui/lightbox').then(mod => ({ default: mod.Lightbox })), {
  ssr: false,
  loading: () => <div>Chargement...</div>,
});
```

### Image Optimization

Utiliser Next.js Image component:

```tsx
import Image from 'next/image';

<Image
  src="/image.jpg"
  alt="Description"
  width={800}
  height={600}
  className="image-responsive"
  loading="lazy"
/>
```

### Code Splitting

Les composants lourds sont automatiquement code-splittés par Next.js.

---

## Tests

### Tests Recommandés

1. **Lightbox**:
   - Navigation entre médias
   - Zoom fonctionnel
   - Raccourcis clavier
   - Mode plein écran

2. **Video Player**:
   - Lecture/pause
   - Contrôle du volume
   - Vitesse de lecture
   - Timeline interactive

3. **File Upload**:
   - Drag & drop
   - Validation des fichiers
   - Preview
   - Upload multiple

4. **Push Notifications**:
   - Demande de permission
   - Abonnement/désabonnement
   - Notification de test
   - Click handlers

5. **Dark Mode**:
   - Toggle entre modes
   - Persistance
   - Détection système

6. **i18n**:
   - Changement de langue
   - Interpolation
   - Persistance

7. **Responsive**:
   - Tester sur mobile, tablet, desktop
   - Menu mobile
   - Layout adaptatif

---

## Troubleshooting

### Service Worker ne se charge pas

```bash
# Vérifier que le fichier existe
ls apps/web/public/service-worker.js

# Vérifier la console du navigateur
# Développeurs > Application > Service Workers
```

### Dark mode ne fonctionne pas

```bash
# Vérifier que Tailwind est configuré pour dark mode
# tailwind.config.js
darkMode: 'class'
```

### i18n ne persiste pas

```bash
# Vérifier localStorage
localStorage.getItem('ofm-locale')
```

---

## Ressources

### Documentation Externe
- [Service Workers MDN](https://developer.mozilla.org/fr/docs/Web/API/Service_Worker_API)
- [Push API MDN](https://developer.mozilla.org/fr/docs/Web/API/Push_API)
- [Tailwind Dark Mode](https://tailwindcss.com/docs/dark-mode)
- [Next.js Image](https://nextjs.org/docs/app/api-reference/components/image)

### Composants Créés
- Lightbox: `components/ui/lightbox.tsx`
- VideoPlayer: `components/ui/video-player.tsx`
- FileUpload: `components/ui/file-upload.tsx`
- ThemeProvider: `components/theme-provider.tsx`
- I18nProvider: `components/i18n-provider.tsx`
- ResponsiveLayout: `components/responsive-layout.tsx`

---

## Conclusion

Toutes les fonctionnalités UI demandées sont maintenant implémentées et prêtes à l'emploi:

- ✅ Lightbox pour les médias
- ✅ Player vidéo custom avec contrôles
- ✅ Upload de fichiers avec preview
- ✅ Notifications push (service worker)
- ✅ Dark mode
- ✅ Internationalisation (i18n)
- ✅ Responsive mobile complet

L'application offre une expérience utilisateur moderne, performante, et accessible sur tous les appareils.
