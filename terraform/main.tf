terraform {
  required_version = ">= 1.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  backend "s3" {
    bucket         = "ofm-terraform-state"
    key            = "production/terraform.tfstate"
    region         = "eu-west-1"
    encrypt        = true
    dynamodb_table = "ofm-terraform-locks"
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "OFM"
      Environment = var.environment
      ManagedBy   = "Terraform"
    }
  }
}

# VPC
module "vpc" {
  source = "./modules/vpc"

  project_name = var.project_name
  environment  = var.environment
  vpc_cidr     = var.vpc_cidr
  azs          = var.availability_zones
}

# RDS PostgreSQL
module "database" {
  source = "./modules/rds"

  project_name        = var.project_name
  environment         = var.environment
  vpc_id              = module.vpc.vpc_id
  private_subnet_ids  = module.vpc.private_subnet_ids
  db_instance_class   = var.db_instance_class
  db_allocated_storage = var.db_allocated_storage
  db_name             = var.db_name
  db_username         = var.db_username
  db_password         = var.db_password
}

# ElastiCache Redis
module "redis" {
  source = "./modules/elasticache"

  project_name       = var.project_name
  environment        = var.environment
  vpc_id             = module.vpc.vpc_id
  private_subnet_ids = module.vpc.private_subnet_ids
  node_type          = var.redis_node_type
  num_cache_nodes    = var.redis_num_nodes
}

# S3 for media storage
module "s3" {
  source = "./modules/s3"

  project_name = var.project_name
  environment  = var.environment
}

# CloudFront CDN
module "cloudfront" {
  source = "./modules/cloudfront"

  project_name    = var.project_name
  environment     = var.environment
  s3_bucket_id    = module.s3.media_bucket_id
  s3_bucket_arn   = module.s3.media_bucket_arn
  domain_name     = var.domain_name
  certificate_arn = var.acm_certificate_arn
}

# ECS Cluster
module "ecs" {
  source = "./modules/ecs"

  project_name        = var.project_name
  environment         = var.environment
  vpc_id              = module.vpc.vpc_id
  private_subnet_ids  = module.vpc.private_subnet_ids
  public_subnet_ids   = module.vpc.public_subnet_ids

  # API Service
  api_image           = var.api_image
  api_port            = 3001
  api_cpu             = 512
  api_memory          = 1024
  api_desired_count   = 2

  # Web Service
  web_image           = var.web_image
  web_port            = 3000
  web_cpu             = 256
  web_memory          = 512
  web_desired_count   = 2

  # Environment variables
  db_host             = module.database.db_endpoint
  db_name             = var.db_name
  db_username         = var.db_username
  db_password         = var.db_password
  redis_host          = module.redis.redis_endpoint
  s3_bucket_name      = module.s3.media_bucket_name
  cloudfront_domain   = module.cloudfront.distribution_domain
}

# Application Load Balancer
module "alb" {
  source = "./modules/alb"

  project_name       = var.project_name
  environment        = var.environment
  vpc_id             = module.vpc.vpc_id
  public_subnet_ids  = module.vpc.public_subnet_ids
  certificate_arn    = var.acm_certificate_arn

  api_target_group_arn = module.ecs.api_target_group_arn
  web_target_group_arn = module.ecs.web_target_group_arn
}

# Route53 DNS
module "route53" {
  source = "./modules/route53"

  domain_name           = var.domain_name
  alb_dns_name          = module.alb.alb_dns_name
  alb_zone_id           = module.alb.alb_zone_id
  cloudfront_domain     = module.cloudfront.distribution_domain
  cloudfront_zone_id    = module.cloudfront.distribution_zone_id
}

# CloudWatch Logs and Monitoring
module "monitoring" {
  source = "./modules/monitoring"

  project_name = var.project_name
  environment  = var.environment

  ecs_cluster_name     = module.ecs.cluster_name
  api_service_name     = module.ecs.api_service_name
  web_service_name     = module.ecs.web_service_name
  alb_arn              = module.alb.alb_arn
  db_instance_id       = module.database.db_instance_id
  redis_cluster_id     = module.redis.cluster_id
}
