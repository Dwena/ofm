'use client';

import React, { useState } from 'react';
import { Lightbox } from '@/components/ui/lightbox';
import { VideoPlayer } from '@/components/ui/video-player';
import { FileUpload } from '@/components/ui/file-upload';
import { ThemeToggle } from '@/components/theme-toggle';
import { LanguageSelector } from '@/components/language-selector';
import { NotificationsManager } from '@/components/notifications-manager';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useTranslation } from '@/components/i18n-provider';
import { useIsMobile, useScreenSize } from '@/components/responsive-layout';

export default function UIComponentsDemo() {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const screenSize = useScreenSize();

  // Lightbox state
  const [isLightboxOpen, setIsLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);

  const sampleMedia = [
    {
      type: 'image' as const,
      url: 'https://images.unsplash.com/photo-1682687220742-aba13b6e50ba',
      thumbnail: 'https://images.unsplash.com/photo-1682687220742-aba13b6e50ba?w=200',
      title: 'Image de démonstration 1',
    },
    {
      type: 'image' as const,
      url: 'https://images.unsplash.com/photo-1682687221038-404cb8830901',
      thumbnail: 'https://images.unsplash.com/photo-1682687221038-404cb8830901?w=200',
      title: 'Image de démonstration 2',
    },
    {
      type: 'image' as const,
      url: 'https://images.unsplash.com/photo-1682687218147-9806132dc697',
      thumbnail: 'https://images.unsplash.com/photo-1682687218147-9806132dc697?w=200',
      title: 'Image de démonstration 3',
    },
  ];

  const handleFileUpload = async (files: File[]) => {
    console.log('Uploading files:', files);
    // Simulate upload delay
    await new Promise(resolve => setTimeout(resolve, 2000));
    console.log('Upload complete');
  };

  return (
    <div className="container-responsive py-8 space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="heading-responsive">Démonstration des Composants UI</h1>
          <p className="text-muted-foreground mt-2">
            Explorez toutes les fonctionnalités UI avancées de la plateforme
          </p>
        </div>
        <div className="flex items-center gap-2">
          <LanguageSelector />
          <ThemeToggle />
        </div>
      </div>

      {/* Device Info */}
      <Card>
        <CardHeader>
          <CardTitle>Informations de l'Appareil</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <p>
              <strong>Type d'appareil:</strong> {isMobile ? '📱 Mobile' : '💻 Desktop'}
            </p>
            <p>
              <strong>Taille d'écran:</strong>{' '}
              {screenSize === 'mobile' && '📱 Mobile (< 768px)'}
              {screenSize === 'tablet' && '📱 Tablette (768px - 1024px)'}
              {screenSize === 'desktop' && '💻 Desktop (> 1024px)'}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Tabs */}
      <Tabs defaultValue="lightbox" className="w-full">
        <TabsList className="grid w-full grid-cols-2 lg:grid-cols-4">
          <TabsTrigger value="lightbox">Lightbox</TabsTrigger>
          <TabsTrigger value="video">Vidéo</TabsTrigger>
          <TabsTrigger value="upload">Upload</TabsTrigger>
          <TabsTrigger value="notifications">Notifications</TabsTrigger>
        </TabsList>

        {/* Lightbox Demo */}
        <TabsContent value="lightbox" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Lightbox - Visualisation de Médias</CardTitle>
              <CardDescription>
                Cliquez sur une image pour ouvrir le lightbox en plein écran
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {sampleMedia.map((media, index) => (
                  <button
                    key={index}
                    onClick={() => {
                      setLightboxIndex(index);
                      setIsLightboxOpen(true);
                    }}
                    className="relative aspect-square rounded-lg overflow-hidden group cursor-pointer"
                  >
                    <img
                      src={media.thumbnail}
                      alt={media.title}
                      className="w-full h-full object-cover transition-transform group-hover:scale-110"
                    />
                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <span className="text-white font-medium">Voir</span>
                    </div>
                  </button>
                ))}
              </div>

              <div className="mt-6 space-y-2">
                <h4 className="font-medium">Fonctionnalités:</h4>
                <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground">
                  <li>Navigation avec flèches (← →) ou boutons</li>
                  <li>Zoom avant/arrière (+/-) pour les images</li>
                  <li>Téléchargement des médias</li>
                  <li>Mode plein écran (touche F ou bouton)</li>
                  <li>Fermeture avec ESC ou bouton X</li>
                  <li>Miniatures pour navigation rapide</li>
                </ul>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Video Player Demo */}
        <TabsContent value="video" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Lecteur Vidéo Personnalisé</CardTitle>
              <CardDescription>
                Lecteur vidéo avec contrôles avancés et vitesse de lecture
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <VideoPlayer
                src="https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4"
                poster="https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/images/BigBuckBunny.jpg"
              />

              <div className="space-y-2">
                <h4 className="font-medium">Fonctionnalités:</h4>
                <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground">
                  <li>Contrôles personnalisés (play/pause, volume, timeline)</li>
                  <li>Vitesse de lecture ajustable (0.5x à 2x)</li>
                  <li>Skip ±10 secondes</li>
                  <li>Barre de progression avec buffer visible</li>
                  <li>Mode plein écran</li>
                  <li>Auto-masquage des contrôles après 3s</li>
                  <li>Affichage du temps (actuel / total)</li>
                </ul>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* File Upload Demo */}
        <TabsContent value="upload" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Upload de Fichiers avec Preview</CardTitle>
              <CardDescription>
                Glissez-déposez ou cliquez pour uploader des images et vidéos
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <FileUpload
                accept="image/*,video/*"
                multiple={true}
                maxSize={50}
                maxFiles={5}
                onUpload={handleFileUpload}
              />

              <div className="space-y-2">
                <h4 className="font-medium">Fonctionnalités:</h4>
                <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground">
                  <li>Drag & drop pour faciliter l'upload</li>
                  <li>Preview automatique des images</li>
                  <li>Génération de thumbnail pour les vidéos</li>
                  <li>Validation de la taille et du type</li>
                  <li>Barre de progression par fichier</li>
                  <li>Support multi-fichiers</li>
                  <li>Messages d'erreur en français</li>
                  <li>Suppression individuelle des fichiers</li>
                </ul>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Notifications Demo */}
        <TabsContent value="notifications" className="space-y-4">
          <NotificationsManager />

          <Card>
            <CardHeader>
              <CardTitle>À propos des Notifications Push</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Les notifications push vous permettent de rester informé même quand l'application
                n'est pas ouverte. Activez-les pour recevoir des notifications sur:
              </p>
              <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground">
                <li>Nouveaux messages privés</li>
                <li>Nouveaux abonnés</li>
                <li>Nouveaux achats de contenu</li>
                <li>Nouveaux commentaires sur vos posts</li>
                <li>Nouveaux likes et interactions</li>
              </ul>

              <div className="p-4 bg-muted rounded-lg">
                <h4 className="font-medium mb-2">Configuration Requise:</h4>
                <ol className="list-decimal list-inside space-y-1 text-sm text-muted-foreground">
                  <li>Générer des clés VAPID</li>
                  <li>Configurer NEXT_PUBLIC_VAPID_PUBLIC_KEY dans .env</li>
                  <li>Implémenter les endpoints API /api/push/subscribe et /api/push/unsubscribe</li>
                  <li>Utiliser web-push côté serveur pour envoyer les notifications</li>
                </ol>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Additional Features */}
      <div className="grid-responsive">
        <Card>
          <CardHeader>
            <CardTitle>🌓 Dark Mode</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-4">
              Changez entre les modes clair, sombre, ou système avec le bouton en haut à droite.
            </p>
            <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground">
              <li>3 modes disponibles</li>
              <li>Détection automatique du système</li>
              <li>Persistance localStorage</li>
              <li>Transitions fluides</li>
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>🌍 Internationalisation</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-4">
              Changez la langue avec le sélecteur en haut à droite.
            </p>
            <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground">
              <li>Français et Anglais</li>
              <li>150+ traductions</li>
              <li>Interpolation de variables</li>
              <li>Extensible facilement</li>
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>📱 Responsive</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-4">
              L'interface s'adapte à tous les écrans.
            </p>
            <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground">
              <li>Menu drawer sur mobile</li>
              <li>Grilles adaptatives</li>
              <li>Boutons touch-friendly</li>
              <li>Safe area pour iOS</li>
            </ul>
          </CardContent>
        </Card>
      </div>

      {/* Lightbox Component */}
      <Lightbox
        items={sampleMedia}
        initialIndex={lightboxIndex}
        isOpen={isLightboxOpen}
        onClose={() => setIsLightboxOpen(false)}
      />
    </div>
  );
}
