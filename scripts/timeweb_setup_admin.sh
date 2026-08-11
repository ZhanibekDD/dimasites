#!/bin/sh
set -eu

PRIVATE_DIRECTORY="${HOME}/dnepr-private"
CONFIG_FILE="${PRIVATE_DIRECTORY}/admin.php"
ADMIN_USER="dnepr"

umask 077
mkdir -p "${PRIVATE_DIRECTORY}"

if [ -f "${CONFIG_FILE}" ]; then
    BACKUP_FILE="${CONFIG_FILE}.backup-$(date +%Y%m%d-%H%M%S)"
    cp "${CONFIG_FILE}" "${BACKUP_FILE}"
    echo "Previous admin access backed up: ${BACKUP_FILE}"
fi

ADMIN_PASSWORD="$(od -An -N12 -tx1 /dev/urandom | tr -d ' \n')"
ADMIN_SALT="$(od -An -N24 -tx1 /dev/urandom | tr -d ' \n')"
PASSWORD_HASH="$(printf '%s' "${ADMIN_SALT}${ADMIN_PASSWORD}" | sha256sum | awk '{print $1}')"

cat > "${CONFIG_FILE}" <<EOF
<?php
return array(
    'username' => '${ADMIN_USER}',
    'salt' => '${ADMIN_SALT}',
    'password_hash' => '${PASSWORD_HASH}',
);
EOF

chmod 0700 "${PRIVATE_DIRECTORY}"
chmod 0600 "${CONFIG_FILE}"

echo ""
echo "DNEPR Lead Engine access created."
echo "URL: https://stroydnepr.ru/admin/"
echo "Login: ${ADMIN_USER}"
echo "Password: ${ADMIN_PASSWORD}"
echo ""
echo "Save this password now. It is shown only once."
