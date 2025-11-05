# Configuration CloudFlare CDN pour OFM Platform

## Vue d'ensemble

Ce guide explique comment configurer CloudFlare comme CDN pour la plateforme OFM, incluant la protection DDoS, le cache, et l'optimisation des performances.

## Prérequis

- Un compte CloudFlare (gratuit ou payant)
- Accès DNS au nom de domaine
- CloudFlare API Key

## Configuration Initiale

### 1. Ajouter le Domaine à CloudFlare

1. Connectez-vous à [CloudFlare](https://dash.cloudflare.com/)
2. Cliquez sur "Add Site"
3. Entrez votre domaine: `yourdomain.com`
4. Sélectionnez un plan (Free fonctionne bien pour démarrer)
5. CloudFlare scannera vos DNS records

### 2. Mettre à Jour les Nameservers

CloudFlare vous fournira 2 nameservers. Mettez à jour chez votre registraire:

```
ns1.cloudflare.com
ns2.cloudflare.com
```

⏰ Propagation DNS: 2-48 heures

### 3. Configuration DNS

Ajoutez les enregistrements DNS suivants:

```
Type  Name              Content                    Proxy
A     @                 YOUR_SERVER_IP             Proxied (Orange)
A     www               YOUR_SERVER_IP             Proxied (Orange)
A     api               YOUR_SERVER_IP             Proxied (Orange)
CNAME cdn               YOUR_S3_BUCKET_URL         Proxied (Orange)
```

## Configuration SSL/TLS

### Mode SSL/TLS

1. Allez dans **SSL/TLS** > **Overview**
2. Sélectionnez **Full (strict)**

Cela active le chiffrement de bout en bout.

### Certificats Edge

CloudFlare fournit automatiquement des certificats SSL gratuits. Pour un certificat personnalisé:

1. **SSL/TLS** > **Edge Certificates**
2. Activez:
   - ✅ Always Use HTTPS
   - ✅ HTTP Strict Transport Security (HSTS)
   - ✅ Minimum TLS Version: TLS 1.2
   - ✅ Opportunistic Encryption
   - ✅ TLS 1.3

### Certificat Origine

Créez un certificat origine pour sécuriser la connexion CloudFlare → Serveur:

1. **SSL/TLS** > **Origin Server**
2. Create Certificate
3. Validité: 15 ans
4. Téléchargez:
   - Origin Certificate (`.pem`)
   - Private Key (`.key`)

Installez sur votre serveur:

```bash
# Sauvegarder les certificats
mkdir -p /etc/ssl/cloudflare
echo "YOUR_CERT" > /etc/ssl/cloudflare/cert.pem
echo "YOUR_KEY" > /etc/ssl/cloudflare/key.pem

# Mettre à jour nginx config
ssl_certificate /etc/ssl/cloudflare/cert.pem;
ssl_certificate_key /etc/ssl/cloudflare/key.pem;
```

## Configuration du Cache

### Page Rules

Créez des règles de cache pour optimiser les performances:

**Rule 1: Cache les assets statiques**
```
URL: yourdomain.com/static/*
Settings:
  - Cache Level: Cache Everything
  - Edge Cache TTL: 1 month
  - Browser Cache TTL: 1 month
```

**Rule 2: Cache les images**
```
URL: yourdomain.com/*.{jpg,jpeg,png,gif,webp,svg}
Settings:
  - Cache Level: Cache Everything
  - Edge Cache TTL: 1 week
```

**Rule 3: Bypass cache pour API**
```
URL: api.yourdomain.com/*
Settings:
  - Cache Level: Bypass
```

### Caching Configuration

1. **Caching** > **Configuration**
2. Paramètres:
   - Caching Level: **Standard**
   - Browser Cache TTL: **4 hours**
   - Always Online: **On**

## Performance

### Auto Minify

**Speed** > **Optimization**

Activez Auto Minify pour:
- ✅ JavaScript
- ✅ CSS
- ✅ HTML

### Brotli Compression

Activez la compression Brotli (meilleure que gzip):
- **Speed** > **Optimization** > **Brotli: On**

### Rocket Loader (Optionnel)

Charge les scripts JS de manière asynchrone:
- **Speed** > **Optimization** > **Rocket Loader: On**

⚠️ Testez bien, peut casser certains scripts.

### HTTP/2 & HTTP/3

**Network** > **HTTP/2**: On
**Network** > **HTTP/3 (with QUIC)**: On

## Sécurité

### WAF (Web Application Firewall)

**Security** > **WAF**

Créez des règles personnalisées:

**Bloquer les bots malveillants**
```
(cf.threat_score gt 30) or (cf.bot_management.score lt 30)
Action: Block
```

**Rate Limiting sur API**
```
(http.request.uri.path contains "/api/") and (rate(10s) > 100)
Action: Block
```

### DDoS Protection

CloudFlare offre une protection DDoS automatique.

Configurez:
1. **Security** > **DDoS**
2. Sensibilité: **High**

### Bot Fight Mode

**Security** > **Bots**
- Bot Fight Mode: **On**

Protège contre les bots de scraping.

## Configuration via API

### Installation du CLI

```bash
npm install -g cloudflare-cli
```

### Purger le Cache

```bash
# Via CLI
cf purge-cache --zone-id YOUR_ZONE_ID

# Via API
curl -X POST "https://api.cloudflare.com/client/v4/zones/YOUR_ZONE_ID/purge_cache" \
  -H "X-Auth-Email: YOUR_EMAIL" \
  -H "X-Auth-Key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  --data '{"purge_everything":true}'
```

### Créer une Page Rule

```bash
curl -X POST "https://api.cloudflare.com/client/v4/zones/YOUR_ZONE_ID/pagerules" \
  -H "X-Auth-Email: YOUR_EMAIL" \
  -H "X-Auth-Key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  --data '{
    "targets": [{
      "target": "url",
      "constraint": {
        "operator": "matches",
        "value": "*yourdomain.com/static/*"
      }
    }],
    "actions": [{
      "id": "cache_level",
      "value": "cache_everything"
    }],
    "priority": 1,
    "status": "active"
  }'
```

## Monitoring

### Analytics

**Analytics** > **Traffic**

Métriques disponibles:
- Requêtes totales
- Bande passante économisée
- Menaces bloquées
- Taux de cache hit

### Logs (Plan Pro+)

Activez Logpush pour envoyer les logs vers:
- S3
- Google Cloud Storage
- Azure Blob Storage
- Splunk
- Datadog

## Tests de Performance

### Test du Cache

```bash
# Première requête (MISS)
curl -I https://yourdomain.com/image.jpg

# Deuxième requête (HIT)
curl -I https://yourdomain.com/image.jpg

# Vérifier le header:
cf-cache-status: HIT
```

### Test SSL

```bash
# Vérifier le certificat
openssl s_client -connect yourdomain.com:443 -servername yourdomain.com

# Tester avec SSL Labs
https://www.ssllabs.com/ssltest/analyze.html?d=yourdomain.com
```

## Variables d'Environnement

Ajoutez à `.env.production`:

```bash
CLOUDFLARE_API_KEY=your_api_key
CLOUDFLARE_ZONE_ID=your_zone_id
CLOUDFLARE_EMAIL=your@email.com
CDN_URL=https://yourdomain.com
```

## Troubleshooting

### Erreur 522 (Connection Timed Out)

**Causes**:
- Serveur down
- Firewall bloque CloudFlare
- Timeout trop court

**Solution**:
1. Vérifier que le serveur est accessible
2. Whitelist les IPs CloudFlare dans le firewall
3. Augmenter les timeouts nginx

### Erreur 525 (SSL Handshake Failed)

**Solution**:
- Vérifier que le mode SSL/TLS est "Full (strict)"
- Vérifier que le certificat origine est valide

### Cache non fonctionnel

**Solutions**:
- Vérifier les Page Rules
- Désactiver "Development Mode"
- Purger le cache

## Best Practices

1. ✅ Utilisez **Full (strict)** SSL mode
2. ✅ Activez HTTP/3 pour de meilleures performances
3. ✅ Configurez des Page Rules pour les assets statiques
4. ✅ Activez WAF et Bot Fight Mode
5. ✅ Monitorer les analytics régulièrement
6. ✅ Purger le cache après les déploiements
7. ✅ Tester les changements sur staging d'abord

## Coûts

| Plan | Prix | Fonctionnalités |
|------|------|-----------------|
| Free | 0€ | SSL, DDoS, Cache basique |
| Pro | 20€/mois | WAF, Image Optimization |
| Business | 200€/mois | 100% uptime SLA, priorité support |
| Enterprise | Custom | Tout + personnalisations |

Le plan **Free** est suffisant pour démarrer!

## Ressources

- [CloudFlare Docs](https://developers.cloudflare.com/)
- [CloudFlare API](https://api.cloudflare.com/)
- [CloudFlare Status](https://www.cloudflarestatus.com/)
- [CloudFlare Community](https://community.cloudflare.com/)
