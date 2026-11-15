data "aws_ssm_parameter" "ubuntu" {
  name = "/aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id"
}

locals {
  duckdns_parameter = "/${var.project_name}/duckdns/token"
  runtime_config = {
    region               = var.aws_region
    expected_account_id  = var.expected_account_id
    artifact_bucket      = var.artifact_bucket
    domain               = var.domain_name
    duckdns_auto_update  = var.duckdns_auto_update
    analytics_storage    = var.enable_rds ? "postgres" : "sqlite"
    project_name         = var.project_name
    data_volume_id       = aws_ebs_volume.data.id
    db_host              = var.enable_rds ? aws_db_instance.app[0].address : null
    db_port              = var.enable_rds ? aws_db_instance.app[0].port : null
    db_name              = var.enable_rds ? aws_db_instance.app[0].db_name : null
    db_username          = "firecal_app"
    db_master_secret_arn = var.enable_rds ? aws_db_instance.app[0].master_user_secret[0].secret_arn : null
    db_app_secret_arn    = var.enable_rds ? aws_secretsmanager_secret.application[0].arn : null
    duckdns_parameter    = local.duckdns_parameter
  }

}

resource "aws_iam_role" "app" {
  name = "${var.project_name}-ec2"
  assume_role_policy = jsonencode({
    Version = "2012-10-17", Statement = [{
      Effect = "Allow", Principal = {
        Service = "ec2.amazonaws.com"
      }, Action = "sts:AssumeRole"
      }
    ]
    }
  )
}

resource "aws_iam_role_policy_attachment" "ssm" {
  role       = aws_iam_role.app.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_role_policy" "runtime" {
  name = "${var.project_name}-runtime"
  role = aws_iam_role.app.id
  policy = jsonencode({
    Version = "2012-10-17", Statement = concat([
      {
        Effect = "Allow", Action = ["s3:ListBucket"], Resource = "arn:aws:s3:::${var.artifact_bucket}", Condition = {
          StringLike = {
            "s3:prefix" = ["releases/*", "data/*"]
          }
        }
      },
      {
        Effect = "Allow", Action = ["s3:GetObject"], Resource = ["arn:aws:s3:::${var.artifact_bucket}/releases/*", "arn:aws:s3:::${var.artifact_bucket}/data/*"]
      },
      {
        Effect = "Allow", Action = ["s3:PutObject"], Resource = "arn:aws:s3:::${var.artifact_bucket}/backups/*"
      }
      ], var.enable_rds ? [
      { Effect = "Allow", Action = ["secretsmanager:GetSecretValue", "secretsmanager:DescribeSecret"], Resource = [aws_db_instance.app[0].master_user_secret[0].secret_arn, aws_secretsmanager_secret.application[0].arn] },
      { Effect = "Allow", Action = ["secretsmanager:PutSecretValue"], Resource = [aws_secretsmanager_secret.application[0].arn] }
      ] : [], var.duckdns_auto_update ? [
      { Effect = "Allow", Action = ["ssm:GetParameter"], Resource = "arn:aws:ssm:${var.aws_region}:${var.expected_account_id}:parameter${local.duckdns_parameter}" }
    ] : [])
    }
  )
}

resource "aws_iam_instance_profile" "app" {
  name = "${var.project_name}-ec2"
  role = aws_iam_role.app.name
}

resource "aws_ebs_volume" "data" {
  availability_zone = aws_subnet.public.availability_zone
  size              = var.data_volume_gib
  type              = "gp3"
  encrypted         = true
  tags = {
    Name = "${var.project_name}-data"
  }
  lifecycle {
    prevent_destroy = true
  }

}

resource "aws_instance" "app" {
  ami                         = var.ami_id != null ? var.ami_id : data.aws_ssm_parameter.ubuntu.value
  instance_type               = var.instance_type
  subnet_id                   = aws_subnet.public.id
  vpc_security_group_ids      = [aws_security_group.app.id]
  iam_instance_profile        = aws_iam_instance_profile.app.name
  associate_public_ip_address = true
  credit_specification {
    cpu_credits = "standard"
  }
  metadata_options {
    http_tokens                 = "required"
    http_endpoint               = "enabled"
    http_put_response_hop_limit = 1
  }
  root_block_device {
    volume_size = var.root_volume_gib
    volume_type = "gp3"
    encrypted   = true
  }
  user_data_base64 = base64gzip(templatefile("${path.module}/templates/cloud-init.yaml.tftpl", {
    config         = base64encode(jsonencode(local.runtime_config))
    host_bootstrap = filebase64("${path.module}/../../deploy/aws/host-bootstrap.sh")
    host_runtime   = filebase64("${path.module}/../../deploy/aws/host_runtime.py")
    }
  ))
  user_data_replace_on_change = false
  tags = {
    Name = var.project_name
  }
  lifecycle {
    ignore_changes = [ami]
  }
  depends_on = [aws_iam_role_policy_attachment.ssm, aws_iam_role_policy.runtime, aws_route_table_association.public]
}

resource "aws_volume_attachment" "data" {
  device_name                    = "/dev/sdf"
  volume_id                      = aws_ebs_volume.data.id
  instance_id                    = aws_instance.app.id
  stop_instance_before_detaching = true
}

resource "aws_eip" "app" {
  domain = "vpc"
  tags = {
    Name = var.project_name
  }
}

resource "aws_eip_association" "app" {
  allocation_id = aws_eip.app.id
  instance_id   = aws_instance.app.id
}
