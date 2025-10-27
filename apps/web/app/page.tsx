import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { DollarSign, Users, Lock, TrendingUp, Video, MessageCircle, Star, Heart } from 'lucide-react'

export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
      {/* Hero Section */}
      <div className="container mx-auto px-4 py-16">
        {/* Navigation */}
        <nav className="flex justify-between items-center mb-20">
          <div className="flex items-center space-x-2">
            <div className="w-10 h-10 bg-gradient-to-br from-indigo-600 to-purple-600 rounded-lg flex items-center justify-center">
              <Heart className="w-6 h-6 text-white" />
            </div>
            <span className="text-2xl font-bold bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent">
              OFM
            </span>
          </div>
          <div className="flex items-center space-x-4">
            <Link href="/login">
              <Button variant="ghost">Connexion</Button>
            </Link>
            <Link href="/register">
              <Button className="bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700">
                Commencer
              </Button>
            </Link>
          </div>
        </nav>

        {/* Hero Content */}
        <div className="text-center max-w-4xl mx-auto mb-20">
          <div className="inline-block mb-6">
            <span className="bg-gradient-to-r from-indigo-600 to-purple-600 text-white px-4 py-2 rounded-full text-sm font-medium">
              Plateforme pour Créateurs de Contenu
            </span>
          </div>
          <h1 className="text-5xl md:text-7xl font-bold mb-6 leading-tight">
            Monétisez votre{' '}
            <span className="bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-600 bg-clip-text text-transparent">
              passion
            </span>
          </h1>
          <p className="text-xl text-gray-600 dark:text-gray-300 mb-8 max-w-2xl mx-auto">
            Créez du contenu exclusif, connectez-vous avec vos fans, et générez des revenus récurrents grâce aux abonnements.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/register">
              <Button size="lg" className="bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-lg px-8 py-6">
                Devenir Créateur
              </Button>
            </Link>
            <Link href="/register">
              <Button size="lg" variant="outline" className="text-lg px-8 py-6 border-2">
                S'abonner à des Créateurs
              </Button>
            </Link>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 max-w-4xl mx-auto mb-20">
          {[
            { label: 'Créateurs', value: '1K+', icon: Users },
            { label: 'Revenus Générés', value: '€500K+', icon: DollarSign },
            { label: 'Abonnés Actifs', value: '50K+', icon: Heart },
            { label: 'Contenus', value: '100K+', icon: Video },
          ].map((stat) => (
            <div key={stat.label} className="text-center">
              <div className="flex justify-center mb-2">
                <stat.icon className="w-8 h-8 text-indigo-600" />
              </div>
              <div className="text-3xl font-bold mb-1">{stat.value}</div>
              <div className="text-gray-600 dark:text-gray-400">{stat.label}</div>
            </div>
          ))}
        </div>

        {/* Features */}
        <div className="mb-20">
          <div className="text-center mb-12">
            <h2 className="text-4xl font-bold mb-4">Tout ce dont vous avez besoin</h2>
            <p className="text-xl text-gray-600 dark:text-gray-300">
              Des outils puissants pour développer votre activité de créateur
            </p>
          </div>
          <div className="grid md:grid-cols-3 gap-8">
            {[
              {
                icon: DollarSign,
                title: 'Abonnements Récurrents',
                description: 'Créez plusieurs niveaux d\'abonnement et générez des revenus prévisibles.',
                color: 'from-green-500 to-emerald-600',
              },
              {
                icon: Video,
                title: 'Contenu Multimédia',
                description: 'Partagez des photos, vidéos et messages exclusifs avec vos abonnés.',
                color: 'from-blue-500 to-indigo-600',
              },
              {
                icon: MessageCircle,
                title: 'Messagerie Privée',
                description: 'Interagissez directement avec vos fans via des messages privés.',
                color: 'from-purple-500 to-pink-600',
              },
              {
                icon: Lock,
                title: 'Contenu Premium',
                description: 'Proposez du contenu pay-per-view pour maximiser vos revenus.',
                color: 'from-orange-500 to-red-600',
              },
              {
                icon: TrendingUp,
                title: 'Analytics Détaillées',
                description: 'Suivez vos performances et comprenez votre audience.',
                color: 'from-cyan-500 to-blue-600',
              },
              {
                icon: Star,
                title: 'Pourboires',
                description: 'Permettez à vos fans de vous soutenir avec des pourboires.',
                color: 'from-yellow-500 to-orange-600',
              },
            ].map((feature) => (
              <Card key={feature.title} className="border-2 hover:shadow-lg transition-shadow">
                <CardContent className="p-6">
                  <div className={`w-12 h-12 rounded-lg bg-gradient-to-br ${feature.color} flex items-center justify-center mb-4`}>
                    <feature.icon className="w-6 h-6 text-white" />
                  </div>
                  <h3 className="text-xl font-bold mb-2">{feature.title}</h3>
                  <p className="text-gray-600 dark:text-gray-400">{feature.description}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>

        {/* How it Works */}
        <div className="mb-20">
          <div className="text-center mb-12">
            <h2 className="text-4xl font-bold mb-4">Comment ça marche</h2>
            <p className="text-xl text-gray-600 dark:text-gray-300">
              Lancez votre activité en quelques minutes
            </p>
          </div>
          <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
            {[
              {
                step: '1',
                title: 'Créez votre compte',
                description: 'Inscrivez-vous gratuitement et configurez votre profil créateur.',
              },
              {
                step: '2',
                title: 'Publiez du contenu',
                description: 'Uploadez vos photos, vidéos et créez vos offres d\'abonnement.',
              },
              {
                step: '3',
                title: 'Gagnez de l\'argent',
                description: 'Recevez des paiements de vos abonnés et retirez vos gains.',
              },
            ].map((item) => (
              <div key={item.step} className="text-center">
                <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gradient-to-br from-indigo-600 to-purple-600 flex items-center justify-center text-white text-2xl font-bold">
                  {item.step}
                </div>
                <h3 className="text-2xl font-bold mb-3">{item.title}</h3>
                <p className="text-gray-600 dark:text-gray-400">{item.description}</p>
              </div>
            ))}
          </div>
        </div>

        {/* CTA Section */}
        <div className="bg-gradient-to-r from-indigo-600 to-purple-600 rounded-2xl p-12 text-center text-white">
          <h2 className="text-4xl font-bold mb-4">Prêt à commencer ?</h2>
          <p className="text-xl mb-8 opacity-90">
            Rejoignez des milliers de créateurs qui monétisent leur passion
          </p>
          <Link href="/register">
            <Button size="lg" variant="secondary" className="text-lg px-8 py-6">
              Créer mon compte gratuitement
            </Button>
          </Link>
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-gray-200 dark:border-gray-800 py-8">
        <div className="container mx-auto px-4 text-center text-gray-600 dark:text-gray-400">
          <p>&copy; 2024 OFM. Tous droits réservés.</p>
        </div>
      </footer>
    </div>
  )
}
