# FanVIP - Production Deployment Guide

This guide covers deploying the FanVIP platform to AWS using Terraform and ECS Fargate.

## Prerequisites

- AWS Account with appropriate permissions
- Terraform >= 1.0
- AWS CLI v2
- Docker
- Node.js 20+
- Domain name with DNS access

## Architecture Overview

The production infrastructure includes:

- **VPC** with public/private subnets across 3 AZs
- **RDS PostgreSQL 15** for database
- **ElastiCache Redis 7** for caching and sessions
- **S3** for media storage with encryption
- **CloudFront** CDN for global content delivery
- **ECS Fargate** for containerized services
- **Application Load Balancer** with HTTPS
- **Route53** for DNS management
- **CloudWatch** for monitoring and logs

## Step 1: Prepare AWS Account

### Create S3 Bucket for Terraform State

```bash
aws s3 mb s3://ofm-terraform-state --region eu-west-1
aws s3api put-bucket-versioning \
  --bucket ofm-terraform-state \
  --versioning-configuration Status=Enabled
```

### Create DynamoDB Table for State Locking

```bash
aws dynamodb create-table \
  --table-name ofm-terraform-locks \
  --attribute-definitions AttributeName=LockID,AttributeType=S \
  --key-schema AttributeName=LockID,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --region eu-west-1
```

### Request ACM Certificate

```bash
aws acm request-certificate \
  --domain-name yourdomain.com \
  --subject-alternative-names "*.yourdomain.com" \
  --validation-method DNS \
  --region eu-west-1
```

Validate the certificate via DNS records.

## Step 2: Configure Terraform

Create `terraform/terraform.tfvars`:

```hcl
aws_region         = "eu-west-1"
project_name       = "ofm"
environment        = "production"
domain_name        = "yourdomain.com"
acm_certificate_arn = "arn:aws:acm:eu-west-1:ACCOUNT_ID:certificate/CERT_ID"

# Database
db_username = "ofm_admin"
db_password = "STRONG_PASSWORD_HERE"  # Use AWS Secrets Manager in production

# Docker Images
api_image = "ACCOUNT_ID.dkr.ecr.eu-west-1.amazonaws.com/ofm-api:latest"
web_image = "ACCOUNT_ID.dkr.ecr.eu-west-1.amazonaws.com/ofm-web:latest"
```

## Step 3: Initialize Terraform

```bash
cd terraform
terraform init
terraform plan
```

Review the plan carefully.

## Step 4: Deploy Infrastructure

```bash
terraform apply
```

This will create:
- VPC and networking (5-10 min)
- RDS database (10-15 min)
- ElastiCache cluster (5-10 min)
- S3 and CloudFront (2-5 min)
- ECS cluster and services (5-10 min)

Total deployment time: ~30-45 minutes

## Step 5: Build and Push Docker Images

### Create ECR Repositories

```bash
aws ecr create-repository --repository-name ofm-api --region eu-west-1
aws ecr create-repository --repository-name ofm-web --region eu-west-1
```

### Build and Push

```bash
# Login to ECR
aws ecr get-login-password --region eu-west-1 | \
  docker login --username AWS --password-stdin ACCOUNT_ID.dkr.ecr.eu-west-1.amazonaws.com

# Build API
docker build -f apps/api/Dockerfile.prod -t ofm-api:latest .
docker tag ofm-api:latest ACCOUNT_ID.dkr.ecr.eu-west-1.amazonaws.com/ofm-api:latest
docker push ACCOUNT_ID.dkr.ecr.eu-west-1.amazonaws.com/ofm-api:latest

# Build Web
docker build -f apps/web/Dockerfile.prod \
  --build-arg NEXT_PUBLIC_API_URL=https://api.yourdomain.com \
  --build-arg NEXT_PUBLIC_APP_URL=https://yourdomain.com \
  -t ofm-web:latest .
docker tag ofm-web:latest ACCOUNT_ID.dkr.ecr.eu-west-1.amazonaws.com/ofm-web:latest
docker push ACCOUNT_ID.dkr.ecr.eu-west-1.amazonaws.com/ofm-web:latest
```

## Step 6: Run Database Migrations

```bash
# Connect to ECS task
aws ecs execute-command \
  --cluster ofm-production-cluster \
  --task TASK_ID \
  --container api \
  --interactive \
  --command "/bin/sh"

# Inside container
npx prisma migrate deploy
```

## Step 7: Configure CI/CD

### GitHub Secrets

Add these secrets to your GitHub repository:

- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `AWS_ACCOUNT_ID`
- `NEXT_PUBLIC_API_URL`
- `NEXT_PUBLIC_APP_URL`
- `SLACK_WEBHOOK_URL` (optional)

### Enable GitHub Actions

Push to `main` branch to trigger deployment:

```bash
git push origin main
```

## Step 8: Configure DNS

Get ALB DNS name:

```bash
terraform output alb_dns_name
```

Create Route53 records or update your DNS provider:

```
yourdomain.com        -> ALB DNS (A record or CNAME)
api.yourdomain.com    -> ALB DNS (CNAME)
cdn.yourdomain.com    -> CloudFront (CNAME)
```

## Environment Variables

### API Service

Required environment variables (set in ECS task definition):

```bash
NODE_ENV=production
PORT=3001
DATABASE_URL=postgresql://user:pass@host:5432/ofm
REDIS_URL=redis://host:6379
JWT_SECRET=your-jwt-secret
JWT_REFRESH_SECRET=your-refresh-secret
STRIPE_SECRET_KEY=sk_live_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx
AWS_ACCESS_KEY_ID=xxx
AWS_SECRET_ACCESS_KEY=xxx
AWS_REGION=eu-west-1
AWS_S3_BUCKET=ofm-media-bucket
FRONTEND_URL=https://yourdomain.com
```

### Web Service

```bash
NODE_ENV=production
NEXT_PUBLIC_API_URL=https://api.yourdomain.com
NEXT_PUBLIC_APP_URL=https://yourdomain.com
```

### Live streaming: TURN server

Live video is sent peer-to-peer (WebRTC) from the creator's browser to each
viewer. STUN alone fails for a noticeable share of viewers (symmetric NAT,
mobile carriers, corporate firewalls), so production needs a TURN relay such as
[coturn](https://github.com/coturn/coturn).

1. Run coturn on a host with a public IP (UDP 3478, TCP 3478, TLS 5349 and the
   relay port range, e.g. UDP 49160-49200, open). Minimal `turnserver.conf`:

   ```
   listening-port=3478
   tls-listening-port=5349
   realm=yourdomain.com
   use-auth-secret
   static-auth-secret=<long random secret>
   min-port=49160
   max-port=49200
   cert=/etc/ssl/turn/fullchain.pem
   pkey=/etc/ssl/turn/privkey.pem
   no-cli
   ```

   A commented `coturn` service is provided in `docker-compose.prod.yml`.

2. Configure the API:

   ```bash
   TURN_URLS=turn:turn.yourdomain.com:3478?transport=udp,turn:turn.yourdomain.com:3478?transport=tcp,turns:turn.yourdomain.com:5349
   TURN_SECRET=<same value as static-auth-secret>
   # optional, defaults to Google's public STUN servers
   STUN_URLS=stun:turn.yourdomain.com:3478
   ```

`GET /streaming/ice-servers` (authenticated) then returns the STUN servers plus
TURN credentials valid for 6 hours, built with the coturn REST API scheme
(`username = <expiry unix>:<userId>`, `credential = base64(HMAC-SHA1(secret, username))`).
The web app fetches them once per live session and falls back to
`NEXT_PUBLIC_ICE_SERVERS` (or Google STUN) when the call fails. Without
`TURN_URLS`/`TURN_SECRET` only STUN is returned, which is fine for development.

### Live streaming: LiveKit SFU

Peer-to-peer lives make the creator's browser upload one copy of the video per
viewer: with 720p at ~2.5 Mbit/s, 10 viewers already need ~25 Mbit/s of upload.
Beyond ~10-20 viewers, run a [LiveKit](https://livekit.io) SFU: the creator
uploads **once** (three simulcast layers: 180p, 360p and the preset's
resolution) and LiveKit forwards to each viewer the layer that fits its player
and bandwidth. The socket.io namespace `/streaming` keeps carrying chat,
reactions, viewer counts, tips, tip menu, donation goals and moderation.

The transport is chosen by the API: with `LIVEKIT_URL`, `LIVEKIT_API_KEY` and
`LIVEKIT_API_SECRET` set, `GET /streaming/:id` and the `join-live-stream` /
`start-broadcast` acknowledgements announce `transport: 'livekit'` and the
browsers get their access token from `POST /streaming/:id/livekit-token`
(publisher token for the creator, hidden subscribe-only token for viewers that
pass the same access rules as the chat: subscription, PPV purchase...). Without
them, `transport: 'p2p'` and the peer-to-peer mesh is used, unchanged.

1. **Server.** A VM with a public IP (2 vCPU / 4 GB handles a few hundred
   viewers per live; LiveKit is mostly bandwidth-bound: plan ~1-2.5 Mbit/s of
   egress per viewer). `docker-compose.prod.yml` has a `livekit` service
   (profile `livekit`, host networking) using
   `infrastructure/livekit/livekit.prod.yaml`:

   ```bash
   docker compose -f docker-compose.prod.yml --profile livekit up -d livekit
   ```

2. **Keys.** Generate a key pair (`docker run --rm livekit/livekit-server:v1.8.4 generate-keys`)
   and set the same values on both sides: `LIVEKIT_KEYS="<key>: <secret>"` for
   LiveKit, `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` for the API. The secret
   must be 32+ characters and never reaches the browsers.

3. **Domain and TLS (wss).** Browsers on an HTTPS site can only open `wss://`:
   give LiveKit its own name (`livekit.yourdomain.com`) and let nginx terminate
   TLS and proxy to `127.0.0.1:7880` with the WebSocket upgrade headers
   (`proxy_http_version 1.1; proxy_set_header Upgrade $http_upgrade;
   proxy_set_header Connection "upgrade"; proxy_read_timeout 1h;`). Then
   `LIVEKIT_URL=wss://livekit.yourdomain.com` on the API. When the API runs on
   the same private network, `LIVEKIT_API_URL=http://<private ip>:7880` avoids
   the round trip through nginx for the room service calls.

4. **Firewall.** Open TCP 443 (nginx), **UDP 7882** (media, single multiplexed
   port; or a range with `rtc.port_range_start/end`) and **TCP 7881** (media
   over TCP). `rtc.use_external_ip: true` makes LiveKit advertise its public IP
   in the ICE candidates (or set `rtc.node_ip`).

5. **TURN for restrictive networks.** Some corporate / hotel networks only let
   TLS on 443 out. LiveKit has a built-in TURN server (`turn:` section): with
   TURN/TLS on 443 (`turn.tls_port: 443`, a dedicated domain such as
   `turn.yourdomain.com` and its certificate, on an IP where 443 is free, or
   behind a TCP load balancer with `external_tls: true`) nearly every viewer
   can connect. The example uses 5349 + UDP 3478; open them as well.

6. **Webhooks (optional).** `webhook.urls: [https://api.yourdomain.com/api/v1/webhooks/livekit]`
   with `webhook.api_key` = `LIVEKIT_API_KEY`. The API verifies the signature
   (JWT signed with the secret, sha256 of the raw body) and keeps the number
   of viewers connected to the video, shown in the creator's "Santé du live"
   (the viewer count of the live itself still comes from the sockets).

When a live ends (`POST /streaming/:id/end`) the API deletes the room
`live-<streamId>`, which disconnects every participant. Rooms of lives left
without being ended close after `room.empty_timeout` (5 min).

Scaling beyond one LiveKit node needs Redis (`redis:` section) for multi-node
routing; a single node is enough for a few hundred viewers per live.

## Monitoring

### CloudWatch Dashboards

Access at: AWS Console > CloudWatch > Dashboards > ofm-production

Metrics include:
- ECS CPU/Memory utilization
- ALB request counts and latency
- RDS connections and queries
- Redis cache hit ratio

### Logs

```bash
# API logs
aws logs tail /ecs/ofm-production-api --follow

# Web logs
aws logs tail /ecs/ofm-production-web --follow
```

### Alarms

Configure CloudWatch Alarms for:
- High CPU/Memory (>80%)
- High error rate (>5%)
- Database connections (>80% max)
- ALB 5xx errors

## Scaling

### Auto Scaling

ECS services are configured with auto-scaling:

- API: Min 2, Max 10 tasks
- Web: Min 2, Max 10 tasks

Scales based on CPU/Memory utilization.

### Manual Scaling

```bash
aws ecs update-service \
  --cluster ofm-production-cluster \
  --service ofm-production-api \
  --desired-count 5
```

## Backup and Disaster Recovery

### Database Backups

RDS automated backups:
- Retention: 7 days
- Backup window: 03:00-04:00 UTC
- Multi-AZ enabled

Manual snapshot:

```bash
aws rds create-db-snapshot \
  --db-instance-identifier ofm-production \
  --db-snapshot-identifier ofm-manual-$(date +%Y%m%d)
```

### Media Backups

S3 versioning enabled. Cross-region replication:

```bash
aws s3api put-bucket-replication \
  --bucket ofm-media-bucket \
  --replication-configuration file://replication.json
```

## Security Best Practices

1. **Use AWS Secrets Manager** for sensitive data
2. **Enable WAF** on CloudFront and ALB
3. **Configure Security Groups** with minimal access
4. **Enable GuardDuty** for threat detection
5. **Use IAM roles** instead of access keys
6. **Enable CloudTrail** for audit logs
7. **Regular security updates** for Docker images
8. **Enable encryption** at rest and in transit

## Cost Optimization

Estimated monthly costs (eu-west-1):

- **ECS Fargate**: ~$150 (4 tasks, 0.5 vCPU, 1GB RAM each)
- **RDS db.t3.medium**: ~$80
- **ElastiCache cache.t3.medium**: ~$65
- **ALB**: ~$25
- **NAT Gateways**: ~$100 (3 AZs)
- **S3 + CloudFront**: Variable (~$50-200)
- **Data Transfer**: Variable

**Total**: ~$470-620/month

Optimization tips:
- Use Spot instances for non-critical tasks
- Enable S3 Intelligent-Tiering
- Reduce NAT Gateways to 1 for non-production
- Use Reserved Instances for predictable workloads

## Rollback Procedure

If deployment fails:

```bash
# Rollback to previous task definition
aws ecs update-service \
  --cluster ofm-production-cluster \
  --service ofm-production-api \
  --task-definition ofm-production-api:PREVIOUS_REVISION

# Or use Terraform
terraform apply -target=module.ecs
```

## Troubleshooting

### Service won't start

Check CloudWatch logs:

```bash
aws logs tail /ecs/ofm-production-api --follow
```

Common issues:
- Environment variables missing
- Database connection failed
- Image pull failed

### Database connection issues

```bash
# Test from ECS task
aws ecs execute-command \
  --cluster ofm-production-cluster \
  --task TASK_ID \
  --container api \
  --interactive \
  --command "/bin/sh"

# Inside container
nc -zv DATABASE_HOST 5432
```

### High latency

- Check CloudFront cache hit ratio
- Review database query performance
- Check Redis connection pool
- Monitor ECS task CPU/Memory

## Support

For issues:
1. Check CloudWatch logs
2. Review Terraform state
3. Contact AWS Support
4. Open GitHub issue

## Next Steps

- Set up monitoring dashboards
- Configure alerting
- Enable AWS Backup
- Implement disaster recovery plan
- Set up staging environment
- Configure CD for automated deployments
