#!/usr/bin/env bash
# Sets up the server Dazbee runs on (ADR-0017): Ubuntu with Docker installed. Run it as root; running
# it again changes only what differs, and fetches Cloudflare's address ranges afresh, so run it again
# when Cloudflare publishes new ones.
#
#   bash setup.sh            the whole setup
#   bash setup.sh firewall   only the DOCKER-USER rules, from the ranges the last setup saved; the
#                            dazbee-firewall service runs this each time Docker starts
#
# It sets up:
#   - the deploy user, in the docker group, owning /opt/dazbee and its live/ and certs/ folders;
#   - ufw allowing SSH in and nothing else;
#   - rules in the DOCKER-USER chain that drop 80 and 443 from anyone outside Cloudflare's ranges, since
#     Docker's published ports pass by ufw; the ranges are saved in /etc/dazbee, and the
#     dazbee-firewall service puts the rules back each time Docker starts, so a reboot keeps them;
#   - 2 GB of swap in /swapfile;
#   - the system nginx stopped and disabled, so Caddy can take port 80.
#
# Then, by hand, once per server:
#   - /opt/dazbee/.env from deploy/env.example, owned root:deploy, mode 640;
#   - in /opt/dazbee/certs, a private key (origin.key, mode 600) and a CSR for dazbee.com and
#     *.dazbee.com made here, and Cloudflare's origin certificate for that CSR as origin.pem
#     (Cloudflare: SSL/TLS > Origin Server > Create Certificate > Use my private key and CSR);
#   - an SSH key pair for deploy, its public key in ~deploy/.ssh/authorized_keys and its private key
#     in the GitHub environment `production` (.github/workflows/deploy.yml says which secrets), then
#     deleted from the server.
set -euo pipefail
shopt -s inherit_errexit

readonly HOME_DIR=/opt/dazbee
readonly RANGES_DIR=/etc/dazbee
readonly CHAIN=DAZBEE-CLOUDFLARE
readonly SWAP_FILE=/swapfile
readonly SWAP_SIZE=2G
readonly SELF=/usr/local/sbin/dazbee-setup
readonly UNIT=/etc/systemd/system/dazbee-firewall.service

log() { printf '%s\n' "$*"; }

# Writes `file` from stdin through a temporary file beside it, so a reader never sees half of it.
write_file() {
  local file=$1
  cat > "$file.new"
  mv -f "$file.new" "$file"
}

# The interface the internet reaches the server on: the one the default route leaves by.
outside_interface() {
  ip -o route show default | awk '{ for (i = 1; i < NF; i++) if ($i == "dev") { print $(i + 1); exit } }'
}

# Fetches Cloudflare's IPv4 or IPv6 ranges into $RANGES_DIR, and fails, keeping the saved list, when
# the answer isn't a list of ranges.
fetch_ranges() {
  local version=$1 pattern list
  case $version in
    v4) pattern='^[0-9]{1,3}(\.[0-9]{1,3}){3}/[0-9]{1,2}$' ;;
    v6) pattern='^[0-9a-f:]+/[0-9]{1,3}$' ;;
  esac
  list=$(curl -fsS --max-time 30 "https://www.cloudflare.com/ips-$version")
  if [ -z "$list" ] || grep -Evq "$pattern" <<< "$list"; then
    echo "Cloudflare's ips-$version is not a list of ranges" >&2
    return 1
  fi
  printf '%s\n' "$list" | write_file "$RANGES_DIR/cloudflare-ips-$version"
  log "firewall: $(wc -l < "$RANGES_DIR/cloudflare-ips-$version") Cloudflare $version ranges saved"
}

# Fills $CHAIN, for iptables or ip6tables, with a return for each saved range and a drop for the rest,
# in one atomic restore, and sends 80 and 443 arriving from outside into it from DOCKER-USER. Matching
# the connection's original port and direction leaves the containers' own connections out to 443.
apply_rules() {
  local command=$1 ranges=$2 interface=$3 port rule
  "$command" -n -L DOCKER-USER > /dev/null 2>&1 || "$command" -N DOCKER-USER
  "$command" -n -L "$CHAIN" > /dev/null 2>&1 || "$command" -N "$CHAIN"
  {
    echo '*filter'
    echo ":$CHAIN - [0:0]"
    sed "s|.*|-A $CHAIN -s & -j RETURN|" "$ranges"
    echo "-A $CHAIN -j DROP"
    echo 'COMMIT'
  } | "$command-restore" --noflush
  for port in 80 443; do
    rule=(DOCKER-USER -i "$interface" -p tcp -m conntrack --ctorigdstport "$port" --ctdir ORIGINAL -j "$CHAIN")
    "$command" -C "${rule[@]}" 2> /dev/null || "$command" -I "${rule[@]}"
  done
}

# Puts the DOCKER-USER rules in place from the saved ranges, for IPv4 and IPv6.
firewall() {
  local interface
  interface=$(outside_interface)
  [ -n "$interface" ] || {
    echo 'no default route, so no interface to filter' >&2
    return 1
  }
  apply_rules iptables "$RANGES_DIR/cloudflare-ips-v4" "$interface"
  apply_rules ip6tables "$RANGES_DIR/cloudflare-ips-v6" "$interface"
  log "firewall: 80 and 443 on $interface only from Cloudflare's ranges"
}

setup_user() {
  getent group docker > /dev/null || {
    echo 'Docker is not installed: there is no docker group' >&2
    return 1
  }
  id -u deploy > /dev/null 2>&1 || useradd --create-home --shell /bin/bash deploy
  usermod -aG docker deploy
  install -d -o deploy -g deploy -m 700 ~deploy/.ssh
  install -d -o deploy -g deploy -m 750 "$HOME_DIR" "$HOME_DIR/live" "$HOME_DIR/certs"
  log "user: deploy, in the docker group, owns $HOME_DIR"
}

setup_ufw() {
  local port
  port=$(sshd -T 2> /dev/null | awk '$1 == "port" { print $2; exit }')
  port=${port:-22}
  ufw default deny incoming > /dev/null
  ufw default allow outgoing > /dev/null
  ufw allow "$port/tcp" comment SSH > /dev/null
  ufw --force enable > /dev/null
  log "ufw: only SSH, on $port, comes in"
}

setup_firewall() {
  install -d -m 755 "$RANGES_DIR"
  fetch_ranges v4
  fetch_ranges v6
  [ "$(realpath "${BASH_SOURCE[0]}")" = "$SELF" ] || install -m 755 "${BASH_SOURCE[0]}" "$SELF"
  write_file "$UNIT" << EOF
[Unit]
Description=Dazbee: 80 and 443 into Docker only from Cloudflare's ranges
After=docker.service
PartOf=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=$SELF firewall

[Install]
WantedBy=docker.service
EOF
  systemctl daemon-reload
  systemctl enable dazbee-firewall.service > /dev/null 2>&1
  systemctl restart dazbee-firewall.service
  log 'firewall: dazbee-firewall puts the rules back each time Docker starts'
}

setup_swap() {
  if ! swapon --show=NAME --noheadings | grep -qx "$SWAP_FILE"; then
    if [ ! -f "$SWAP_FILE" ]; then
      fallocate -l "$SWAP_SIZE" "$SWAP_FILE"
      chmod 600 "$SWAP_FILE"
      mkswap "$SWAP_FILE" > /dev/null
    fi
    swapon "$SWAP_FILE"
  fi
  grep -q "^$SWAP_FILE " /etc/fstab || echo "$SWAP_FILE none swap sw 0 0" >> /etc/fstab
  log "swap: $(swapon --show=SIZE --noheadings "$SWAP_FILE" | tr -d ' ') in $SWAP_FILE"
}

stop_nginx() {
  if systemctl cat nginx.service > /dev/null 2>&1; then
    systemctl disable --now nginx.service > /dev/null 2>&1
    log 'nginx: stopped and disabled'
  else
    log 'nginx: not installed'
  fi
}

[ "$(id -u)" = 0 ] || {
  echo 'run setup.sh as root' >&2
  exit 1
}
case ${1:-} in
  firewall) firewall ;;
  '')
    setup_user
    setup_ufw
    setup_firewall
    setup_swap
    stop_nginx
    ;;
  *)
    echo 'usage: setup.sh [firewall]' >&2
    exit 2
    ;;
esac
