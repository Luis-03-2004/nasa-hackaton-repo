terraform {
  required_version = ">= 1.11, < 2.0"
  required_providers {
    aws = {
      source = "hashicorp/aws", version = "~> 6.0"
    }

  }

}


variable "aws_profile" {
  type    = string
  default = "firecal-terraform"
}

variable "aws_region" {
  type    = string
  default = "us-east-1"
}

variable "expected_account_id" {
  type        = string
  description = "ID da conta pessoal conferida com STS; impede aplicar em outra conta."
  validation {
    condition     = can(regex("^[0-9]{12}$", var.expected_account_id))
    error_message = "Informe o ID AWS de 12 dígitos."
  }

}

variable "project_name" {
  type    = string
  default = "firecalglobal"
}


provider "aws" {
  region              = var.aws_region
  profile             = var.aws_profile
  allowed_account_ids = [var.expected_account_id]
  default_tags {
    tags = {
      Project = var.project_name, ManagedBy = "Terraform", Environment = "prod"
    }
  }

}


resource "aws_s3_bucket" "platform" {
  bucket        = "${var.project_name}-${var.expected_account_id}-${var.aws_region}"
  force_destroy = false
  lifecycle {
    prevent_destroy = true
  }

}

resource "aws_s3_bucket_public_access_block" "platform" {
  bucket                  = aws_s3_bucket.platform.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "platform" {
  bucket = aws_s3_bucket.platform.id
  versioning_configuration {
    status = "Enabled"
  }

}

resource "aws_s3_bucket_server_side_encryption_configuration" "platform" {
  bucket = aws_s3_bucket.platform.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }

}

resource "aws_s3_bucket_ownership_controls" "platform" {
  bucket = aws_s3_bucket.platform.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }

}

resource "aws_s3_bucket_policy" "tls" {
  bucket = aws_s3_bucket.platform.id
  policy = jsonencode({
    Version = "2012-10-17", Statement = [{
      Sid      = "DenyUnencryptedTransport", Effect = "Deny", Principal = "*", Action = "s3:*",
      Resource = [aws_s3_bucket.platform.arn, "${aws_s3_bucket.platform.arn}/*"],
      Condition = {
        Bool = {
          "aws:SecureTransport" = "false"
        }
      }

      }
    ]
    }
  )
}

output "bucket_name" {
  value = aws_s3_bucket.platform.id
}

output "backend_configuration" {
  value = {
    bucket = aws_s3_bucket.platform.id, key = "state/prod/terraform.tfstate", region = var.aws_region, profile = var.aws_profile, encrypt = true, use_lockfile = true
  }

}
