variable "aws_profile" {
  type    = string
  default = "firecal-terraform"
}

variable "aws_region" {
  type    = string
  default = "us-east-1"
}

variable "expected_account_id" {
  type = string
  validation {
    condition     = can(regex("^[0-9]{12}$", var.expected_account_id))
    error_message = "Informe o ID da conta pessoal de 12 dígitos."
  }

}

variable "project_name" {
  type    = string
  default = "firecalglobal"
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{2,24}$", var.project_name))
    error_message = "Use 3–25 caracteres minúsculos, números e hífen."
  }

}

variable "artifact_bucket" {
  type        = string
  description = "Bucket privado criado pelo bootstrap."
}

variable "domain_name" {
  type    = string
  default = "firecalglobal.duckdns.org"
  validation {
    condition     = can(regex("^[a-z0-9-]+\\.duckdns\\.org$", var.domain_name))
    error_message = "Informe um subdomínio DuckDNS válido."
  }

}

variable "duckdns_auto_update" {
  type        = bool
  default     = false
  description = "Atualizar DuckDNS por token SSM. Falso usa apontamento manual ao Elastic IP."
}

variable "vpc_cidr" {
  type    = string
  default = "10.42.0.0/16"
}

variable "instance_type" {
  type    = string
  default = "t3.micro"
}

variable "enable_rds" {
  type        = bool
  default     = false
  description = "Ativa RDS pago. O perfil econômico usa SQLite local com fontes no S3."
}

variable "ami_id" {
  type        = string
  default     = null
  description = "AMI Ubuntu 24.04 AMD64 opcional; o padrão vem do SSM público da Canonical."
}

variable "root_volume_gib" {
  type    = number
  default = 10
}

variable "data_volume_gib" {
  type    = number
  default = 30
  validation {
    condition     = var.data_volume_gib >= 30
    error_message = "Reserve pelo menos 30 GiB para dados, caches e builds."
  }

}

variable "db_instance_class" {
  type    = string
  default = "db.t4g.micro"
}

variable "db_engine_version" {
  type    = string
  default = "17"
}

variable "db_storage_gib" {
  type    = number
  default = 20
}

variable "db_max_storage_gib" {
  type    = number
  default = 100
}

variable "db_multi_az" {
  type    = bool
  default = false
}

variable "db_deletion_protection" {
  type    = bool
  default = true
}
