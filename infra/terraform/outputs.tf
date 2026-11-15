output "url" {
  value = "https://${var.domain_name}"
}

output "instance_id" {
  value = aws_instance.app.id
}

output "public_ip" {
  value = aws_eip.app.public_ip
}

output "rds_endpoint" {
  value = var.enable_rds ? aws_db_instance.app[0].endpoint : null
}

output "duckdns_parameter_name" {
  value = local.duckdns_parameter
}

output "deployment_config" {
  value = merge(local.runtime_config, {
    instance_id = aws_instance.app.id, public_ip = aws_eip.app.public_ip
    }
  )
}
