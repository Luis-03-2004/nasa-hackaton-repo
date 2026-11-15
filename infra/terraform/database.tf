resource "aws_db_subnet_group" "app" {
  count      = var.enable_rds ? 1 : 0
  name       = "${var.project_name}-private"
  subnet_ids = aws_subnet.database[*].id
}

resource "aws_db_parameter_group" "app" {
  count       = var.enable_rds ? 1 : 0
  name_prefix = "${var.project_name}-"
  family      = "postgres${split(".", var.db_engine_version)[0]}"
  parameter {
    name         = "rds.force_ssl"
    value        = "1"
    apply_method = "pending-reboot"
  }

}

resource "aws_db_instance" "app" {
  count                       = var.enable_rds ? 1 : 0
  identifier                  = var.project_name
  engine                      = "postgres"
  engine_version              = var.db_engine_version
  instance_class              = var.db_instance_class
  db_name                     = "firecal"
  username                    = "firecal_admin"
  manage_master_user_password = true
  db_subnet_group_name        = aws_db_subnet_group.app[0].name
  vpc_security_group_ids      = [aws_security_group.database[0].id]
  parameter_group_name        = aws_db_parameter_group.app[0].name
  publicly_accessible         = false
  storage_type                = "gp3"
  allocated_storage           = var.db_storage_gib
  max_allocated_storage       = var.db_max_storage_gib
  storage_encrypted           = true
  multi_az                    = var.db_multi_az
  backup_retention_period     = 7
  copy_tags_to_snapshot       = true
  deletion_protection         = var.db_deletion_protection
  skip_final_snapshot         = false
  final_snapshot_identifier   = "${var.project_name}-final"
  auto_minor_version_upgrade  = true
  allow_major_version_upgrade = false
  apply_immediately           = false
}

resource "aws_secretsmanager_secret" "application" {
  count                   = var.enable_rds ? 1 : 0
  name                    = "${var.project_name}/database-application"
  description             = "Credencial da aplicacao, preenchida no bootstrap sem passar pelo estado Terraform."
  recovery_window_in_days = 7
}
