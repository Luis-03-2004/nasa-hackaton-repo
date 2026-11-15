terraform {
  required_version = ">= 1.11, < 2.0"
  required_providers {
    aws = {
      source = "hashicorp/aws", version = "~> 6.0"
    }

  }
  backend "s3" {
  }

}

provider "aws" {
  region              = var.aws_region
  profile             = var.aws_profile
  allowed_account_ids = [var.expected_account_id]
  default_tags {
    tags = {
      Project = var.project_name, Environment = "prod", ManagedBy = "Terraform"
    }
  }

}
