#!/usr/bin/env bash
# 生产域名 + HTTPS + 反代 一键配置脚本
#
# 在服务器上跑(需要 root)。脚本幂等,重复执行只更新差异。
#
# 用法:
#   1. 改下面的 CONFIG 区域(尤其 REPO_DIR / PM2_WEB / PM2_API),保存
#   2. scp 到服务器: scp scripts/setup-prod.sh root@<server>:/root/
#   3. ssh 进去跑:   bash /root/setup-prod.sh
#   4. 跑完会打印公网 IP, 复制粘贴到 Cloudflare DNS:
#        A  @    <IP>    Proxied
#        A  www  <IP>    Proxied
#        A  ops  <IP>    Proxied   (如果运营域名启用)
#
# 失败 → 脚本会 set -e 立刻停; 任何已写入的 nginx 配置不会自动回滚,
# 但每次写入前会备份 (.bak.<timestamp>)。

set -euo pipefail

# ============== CONFIG (跑之前自检/修改) ==============
PUBLIC_DOMAIN="web.xbozhu.com"                      # 公开站点域名(给访客看)
ADMIN_DOMAIN="admin.xbozhu.com"                     # 运营/工作台域名(只有运营进);留空 "" 表示不分离
INCLUDE_WWW_REDIRECT=0                              # 1 = 也配置 www.${PUBLIC_DOMAIN} → ${PUBLIC_DOMAIN} 跳转(apex 域名才需要,子域不需要)
EMAIL_FOR_CERTBOT="admin@xbozhu.com"                # Let's Encrypt 注册邮箱(用来发到期提醒,主域邮箱即可)
WEB_PORT="3000"                                     # Next web app 本地端口
API_PORT="4000"                                     # Fastify api 本地端口 (next.config rewrites 已指向)
REPO_DIR="/root/Code/ch"                                 # 仓库在服务器上的位置(.env 要改在这里)
PM2_WEB="web"                                       # pm2 list 里 Next web 进程名
PM2_API="api"                                       # pm2 list 里 Fastify api 进程名
# ====================================================

log()  { printf '\033[1;34m[setup]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[setup:warn]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[setup:fatal]\033[0m %s\n' "$*" >&2; exit 1; }

[[ "$EUID" -eq 0 ]] || die "请用 root 跑(sudo bash $0)"
[[ -d "$REPO_DIR" ]] || die "REPO_DIR=$REPO_DIR 不存在,改脚本顶部 CONFIG"

# ---- 1. 依赖 ----
log "确保 nginx / certbot / curl 已装"
apt-get update -y >/dev/null
apt-get install -y nginx certbot python3-certbot-nginx curl >/dev/null

# ---- 2. 写 nginx 配置 ----
NGINX_CONF="/etc/nginx/sites-available/${PUBLIC_DOMAIN}.conf"
NGINX_LINK="/etc/nginx/sites-enabled/${PUBLIC_DOMAIN}.conf"

if [[ -f "$NGINX_CONF" ]]; then
  cp "$NGINX_CONF" "${NGINX_CONF}.bak.$(date +%s)"
  log "已备份旧 nginx 配置 → ${NGINX_CONF}.bak.*"
fi

# 先写一份 "只听 80" 的,跑 certbot 时让它注入 443 server。
# certbot --nginx 模式会自己改写这个文件,所以下面保持精简。
cat >"$NGINX_CONF" <<NGINX_EOF
# ── 公开域名 ${PUBLIC_DOMAIN} (apex) ──
server {
    listen 80;
    listen [::]:80;
    server_name ${PUBLIC_DOMAIN};

    client_max_body_size 10m;

    location / {
        proxy_pass http://127.0.0.1:${WEB_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host              \$host;
        proxy_set_header X-Real-IP         \$remote_addr;
        proxy_set_header X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade           \$http_upgrade;
        proxy_set_header Connection        "upgrade";
        proxy_read_timeout 60s;
    }
}

NGINX_EOF

# www 重定向块 — 只在 INCLUDE_WWW_REDIRECT=1 时追加(apex 域名才需要,子域如 web.xbozhu.com 不需要)
if [[ "$INCLUDE_WWW_REDIRECT" == "1" ]]; then
cat >>"$NGINX_CONF" <<NGINX_EOF
# ── www → 301 跳 apex ──
server {
    listen 80;
    listen [::]:80;
    server_name www.${PUBLIC_DOMAIN};
    return 301 https://${PUBLIC_DOMAIN}\$request_uri;
}
NGINX_EOF
fi

if [[ -n "$ADMIN_DOMAIN" ]]; then
cat >>"$NGINX_CONF" <<NGINX_EOF

# ── 运营域名 ${ADMIN_DOMAIN} ── (同进程,middleware 用 ADMIN_HOSTS 判别)
server {
    listen 80;
    listen [::]:80;
    server_name ${ADMIN_DOMAIN};

    client_max_body_size 50m;

    location / {
        proxy_pass http://127.0.0.1:${WEB_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host              \$host;
        proxy_set_header X-Real-IP         \$remote_addr;
        proxy_set_header X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade           \$http_upgrade;
        proxy_set_header Connection        "upgrade";
        proxy_read_timeout 120s;
    }
}
NGINX_EOF
fi

ln -sf "$NGINX_CONF" "$NGINX_LINK"
nginx -t || die "nginx -t 失败,看上面报错"
systemctl reload nginx
log "nginx HTTP 80 已就绪"

# ---- 3. certbot 申证书 ----
CERT_DOMAINS=("-d" "$PUBLIC_DOMAIN")
[[ "$INCLUDE_WWW_REDIRECT" == "1" ]] && CERT_DOMAINS+=("-d" "www.$PUBLIC_DOMAIN")
[[ -n "$ADMIN_DOMAIN" ]] && CERT_DOMAINS+=("-d" "$ADMIN_DOMAIN")

log "申/续 Let's Encrypt 证书: ${CERT_DOMAINS[*]}"
# --redirect: 自动把 80 跳 443
# --keep-until-expiring: 已签 30+ 天的复用,不每次重申
# --non-interactive --agree-tos -m email: 不弹交互
certbot --nginx \
  --non-interactive --agree-tos --keep-until-expiring \
  -m "$EMAIL_FOR_CERTBOT" --redirect \
  "${CERT_DOMAINS[@]}" \
  || die "certbot 失败,常见原因:(1) DNS A 记录还没解析到本机 (2) 80 端口被防火墙挡"

nginx -t && systemctl reload nginx
log "HTTPS 证书已装,nginx 已 reload"

# ---- 4. 更新 .env ----
ENV_FILE="${REPO_DIR}/.env"
[[ -f "$ENV_FILE" ]] || { warn ".env 不存在,新建一个空的"; touch "$ENV_FILE"; }
cp "$ENV_FILE" "${ENV_FILE}.bak.$(date +%s)"

upsert_env() {
  local key="$1" val="$2"
  if grep -qE "^${key}=" "$ENV_FILE"; then
    # macOS / GNU sed 不通用,这里假设 GNU(线上 ubuntu)
    sed -i -E "s|^${key}=.*|${key}=${val}|" "$ENV_FILE"
  else
    printf '%s=%s\n' "$key" "$val" >>"$ENV_FILE"
  fi
}

upsert_env SITE_URL "https://${PUBLIC_DOMAIN}"
upsert_env NEXT_PUBLIC_SITE_URL "https://${PUBLIC_DOMAIN}"
if [[ -n "$ADMIN_DOMAIN" ]]; then
  upsert_env ADMIN_HOSTS "${ADMIN_DOMAIN}"
fi
log ".env 已更新 (旧版本备份在 ${ENV_FILE}.bak.*)"
log "提醒: ADMIN_PASSWORD 必须已设(空值 = middleware 全放行,生产很危险)"

# ---- 5. 重启 pm2 进程 ----
if command -v pm2 >/dev/null 2>&1; then
  pm2 restart "$PM2_WEB" --update-env || warn "pm2 restart $PM2_WEB 失败(可能进程名不对)"
  pm2 restart "$PM2_API" --update-env || warn "pm2 restart $PM2_API 失败(可能进程名不对)"
  pm2 save || true
else
  warn "pm2 未安装,跳过重启,你自己手动重启进程"
fi

# ---- 6. 输出 IP & 校验 ----
IP="$(curl -fsS https://api.ipify.org || curl -fsS https://ifconfig.me || true)"
echo
echo "============================================================"
echo " 全部完成 ✅"
echo "============================================================"
echo " 公网 IP: ${IP:-<取不到,手动跑 curl ifconfig.me>}"
echo
echo " Cloudflare DNS 填这几条 (类型 A,Proxied 状态):"
# 拆掉 PUBLIC_DOMAIN 子域部分(web.xbozhu.com → web)和 ADMIN_DOMAIN 子域部分。
# 注:如果你 CF 上托管的是 xbozhu.com 这个 apex zone,Name 列只填子域字符串。
public_label="${PUBLIC_DOMAIN%%.*}"
echo "   A  ${public_label}     ${IP:-<IP>}"
if [[ "$INCLUDE_WWW_REDIRECT" == "1" ]]; then
  echo "   A  www.${public_label}   ${IP:-<IP>}"
fi
if [[ -n "$ADMIN_DOMAIN" ]]; then
  admin_label="${ADMIN_DOMAIN%%.*}"
  echo "   A  ${admin_label}   ${IP:-<IP>}"
fi
echo
echo " 解析生效后(通常 1-5 分钟)访问:"
echo "   https://${PUBLIC_DOMAIN}"
[[ "$INCLUDE_WWW_REDIRECT" == "1" ]] && echo "   https://www.${PUBLIC_DOMAIN}   (应该 301 → ${PUBLIC_DOMAIN})"
[[ -n "$ADMIN_DOMAIN" ]] && echo "   https://${ADMIN_DOMAIN}        (运营入口,需要登录)"
echo
echo " 检查命令:"
echo "   curl -I https://${PUBLIC_DOMAIN}"
[[ -n "$ADMIN_DOMAIN" ]] && echo "   curl -I https://${ADMIN_DOMAIN}"
echo "============================================================"
