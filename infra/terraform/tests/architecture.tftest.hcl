mock_provider "aws" {
  mock_data "aws_availability_zones" {
    defaults = { names = ["us-east-1a", "us-east-1b"] }
  }
  mock_data "aws_ssm_parameter" {
    defaults = { value = "ami-0123456789abcdef0" }
  }
  mock_resource "aws_db_instance" {
    defaults = {
      master_user_secret = [{
        secret_arn    = "arn:aws:secretsmanager:us-east-1:123456789012:secret:fixture"
        kms_key_id    = "fixture"
        secret_status = "active"
      }]
    }
  }
}

variables {
  expected_account_id = "123456789012"
  artifact_bucket     = "firecal-fixture"
}

run "economical_without_rds" {
  command = plan
  assert {
    condition     = length(aws_db_instance.app) == 0 && length(aws_secretsmanager_secret.application) == 0 && length(aws_subnet.database) == 0
    error_message = "O perfil econômico não pode criar RDS, segredos pagos ou subnets de banco."
  }
  assert {
    condition     = aws_instance.app.instance_type == "t3.micro" && aws_instance.app.credit_specification[0].cpu_credits == "standard"
    error_message = "O perfil econômico deve usar micro e não cobrar créditos Unlimited."
  }
  assert {
    condition     = local.runtime_config.analytics_storage == "sqlite" && local.runtime_config.db_master_secret_arn == null
    error_message = "A API econômica deve usar SQLite sem credenciais RDS."
  }
}

run "private_database_and_public_https" {
  command = plan
  variables {
    enable_rds = true
  }
  assert {
    condition     = !aws_db_instance.app[0].publicly_accessible && aws_db_instance.app[0].storage_encrypted
    error_message = "RDS precisa ser privado e criptografado."
  }
  assert {
    condition     = length(aws_subnet.database) == 2 && aws_db_instance.app[0].manage_master_user_password
    error_message = "RDS precisa de duas subnets e senha gerenciada."
  }
  assert {
    condition     = aws_instance.app.metadata_options[0].http_tokens == "required" && aws_instance.app.metadata_options[0].http_put_response_hop_limit == 1
    error_message = "IMDSv2 deve restringir as credenciais ao host."
  }
  assert {
    condition     = aws_vpc_security_group_ingress_rule.http.from_port == 80 && aws_vpc_security_group_ingress_rule.https.from_port == 443 && aws_vpc_security_group_ingress_rule.postgres[0].from_port == 5432
    error_message = "Confira as portas de acesso."
  }
  assert {
    condition     = local.runtime_config.db_username == "firecal_app" && local.runtime_config.domain == "firecalglobal.duckdns.org"
    error_message = "O usuário da aplicação e domínio precisam corresponder à implantação."
  }
}
