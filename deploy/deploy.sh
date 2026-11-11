#!/usr/bin/env bash
# 症状自查助手 · ECS 部署脚本
# 用法： sudo bash deploy.sh /tmp/symptom-site.zip
# 由 CodeArts Deploy 的「执行 Shell 命令」步骤调用，也可手工执行。
set -euo pipefail

APP_DIR="/var/www/symptom"
ARTIFACT="${1:-/tmp/symptom-site.zip}"
NGINX_CONF="/etc/nginx/conf.d/symptom.conf"

echo "==> 1/4 准备目录"
mkdir -p "$APP_DIR"

echo "==> 2/4 备份当前版本"
if [ -d "$APP_DIR" ] && [ "$(ls -A "$APP_DIR" 2>/dev/null)" ]; then
  rm -rf "${APP_DIR}.bak"
  cp -r "$APP_DIR" "${APP_DIR}.bak"
  echo "    已备份到 ${APP_DIR}.bak"
fi

echo "==> 3/4 解包新版本"
if [ -f "$ARTIFACT" ]; then
  rm -rf "${APP_DIR:?}"/*
  unzip -o -q "$ARTIFACT" -d "$APP_DIR"
  chown -R nginx:nginx "$APP_DIR" 2>/dev/null || chown -R www-data:www-data "$APP_DIR" 2>/dev/null || true
  echo "    已解包：$(ls -1 "$APP_DIR" | tr '\n' ' ')"
else
  echo "    ⚠ 找不到制品 $ARTIFACT，仅刷新配置"
fi

echo "==> 4/4 写入 Nginx 配置并重载"
if [ -f /tmp/nginx-symptom.conf ]; then
  cp /tmp/nginx-symptom.conf "$NGINX_CONF"
else
  echo "    ⚠ 缺少 /tmp/nginx-symptom.conf，跳过配置覆盖"
fi

nginx -t
systemctl reload nginx 2>/dev/null || systemctl restart nginx

echo "==> 完成： http://$(curl -s -m 3 ifconfig.me 2>/dev/null || echo '服务器公网IP'):8080"
