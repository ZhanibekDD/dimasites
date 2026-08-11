#!/bin/sh
set -eu

PRIVATE_DIRECTORY="${HOME}/dnepr-private"
CONFIG_FILE="${PRIVATE_DIRECTORY}/admin.json"
LEGACY_CONFIG_FILE="${PRIVATE_DIRECTORY}/admin.php"
PUBLIC_ADMIN_DIRECTORY="${HOME}/public_html/admin"
WEB_CONFIG_FILE="${PUBLIC_ADMIN_DIRECTORY}/.access.php"
ADMIN_USER="dnepr"

umask 077
mkdir -p "${PRIVATE_DIRECTORY}"
mkdir -p "${PUBLIC_ADMIN_DIRECTORY}"

if [ -f "${CONFIG_FILE}" ]; then
    BACKUP_FILE="${CONFIG_FILE}.backup-$(date +%Y%m%d-%H%M%S)"
    cp "${CONFIG_FILE}" "${BACKUP_FILE}"
    echo "Previous admin access backed up: ${BACKUP_FILE}"
fi

if [ -f "${LEGACY_CONFIG_FILE}" ]; then
    LEGACY_BACKUP_FILE="${LEGACY_CONFIG_FILE}.backup-$(date +%Y%m%d-%H%M%S)"
    cp "${LEGACY_CONFIG_FILE}" "${LEGACY_BACKUP_FILE}"
    rm -f "${LEGACY_CONFIG_FILE}"
    echo "Legacy admin access backed up: ${LEGACY_BACKUP_FILE}"
fi

ADMIN_PASSWORD="$(od -An -N12 -tx1 /dev/urandom | tr -d ' \n')"
ADMIN_SALT="$(od -An -N24 -tx1 /dev/urandom | tr -d ' \n')"
PASSWORD_HASH="$(printf '%s' "${ADMIN_SALT}${ADMIN_PASSWORD}" | sha256sum | awk '{print $1}')"

TEMP_CONFIG_FILE="${CONFIG_FILE}.tmp"
cat > "${TEMP_CONFIG_FILE}" <<EOF
{
  "version": 2,
  "username": "${ADMIN_USER}",
  "salt": "${ADMIN_SALT}",
  "password_hash": "${PASSWORD_HASH}"
}
EOF

mv "${TEMP_CONFIG_FILE}" "${CONFIG_FILE}"

TEMP_WEB_CONFIG_FILE="${WEB_CONFIG_FILE}.tmp"
cat > "${TEMP_WEB_CONFIG_FILE}" <<EOF
<?php
if (!defined('DNEPR_ADMIN_BOOTSTRAP')) {
    header('HTTP/1.1 404 Not Found');
    exit;
}
return array(
    'version' => 3,
    'username' => '${ADMIN_USER}',
    'salt' => '${ADMIN_SALT}',
    'password_hash' => '${PASSWORD_HASH}',
    'data_directory' => '${PRIVATE_DIRECTORY}'
);
EOF

mv "${TEMP_WEB_CONFIG_FILE}" "${WEB_CONFIG_FILE}"

chmod 0700 "${PRIVATE_DIRECTORY}"
chmod 0600 "${CONFIG_FILE}"
chmod 0600 "${WEB_CONFIG_FILE}"

if [ ! -s "${WEB_CONFIG_FILE}" ]; then
    echo "Admin access file was not created: ${WEB_CONFIG_FILE}"
    exit 1
fi

echo ""
echo "DNEPR Lead Engine access created."
echo "URL: https://stroydnepr.ru/admin/"
echo "Login: ${ADMIN_USER}"
echo "Password: ${ADMIN_PASSWORD}"
echo "Config: ${WEB_CONFIG_FILE}"
echo ""
echo "Save this password now. It is shown only once."
