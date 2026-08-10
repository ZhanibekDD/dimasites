#!/bin/sh
set -eu

DEPLOY_REPOSITORY="${HOME}/dimasites-deploy"
PUBLIC_DIRECTORY="${HOME}/public_html"
DEPLOY_LOCK="${HOME}/.dimasites-deploy-lock"
MANAGED_MARKER="${PUBLIC_DIRECTORY}/.dimasites-managed"

if ! mkdir "${DEPLOY_LOCK}" 2>/dev/null; then
    echo "Another deployment is already running."
    exit 0
fi

cleanup_lock() {
    rmdir "${DEPLOY_LOCK}" 2>/dev/null || true
}
trap cleanup_lock EXIT
trap 'exit 1' HUP INT TERM

if [ ! -d "${DEPLOY_REPOSITORY}/.git" ]; then
    echo "Repository is missing: ${DEPLOY_REPOSITORY}"
    echo "Clone it before running this script."
    exit 1
fi

git -C "${DEPLOY_REPOSITORY}" fetch --depth 1 origin main
git -C "${DEPLOY_REPOSITORY}" reset --hard FETCH_HEAD
python3 "${DEPLOY_REPOSITORY}/scripts/check_site.py"

mkdir -p "${PUBLIC_DIRECTORY}"
if [ ! -f "${MANAGED_MARKER}" ]; then
    BACKUP_ARCHIVE="${HOME}/stroydnepr-before-git-$(date +%Y%m%d-%H%M%S).tar.gz"
    tar -czf "${BACKUP_ARCHIVE}" -C "${PUBLIC_DIRECTORY}" .
    echo "Initial backup created: ${BACKUP_ARCHIVE}"
fi

rsync -a --delete --exclude='.well-known/' \
    "${DEPLOY_REPOSITORY}/site/" "${PUBLIC_DIRECTORY}/"

git -C "${DEPLOY_REPOSITORY}" rev-parse HEAD > "${PUBLIC_DIRECTORY}/.deploy-version"
touch "${MANAGED_MARKER}"
echo "Stroydnepr.ru deployed successfully."
